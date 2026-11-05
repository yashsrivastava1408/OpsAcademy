const fs = require('fs');
const os = require('os');
const path = require('path');
const { SupabaseStore, PAGE_SIZE } = require('../lib/supabaseStore');

/** Minimal in-memory stand-in for the parts of supabase-js the store uses. */
function fakeClient({ rows = [], failWrites = 0, failLoad = false } = {}) {
  const tables = { documents: [...rows], profiles: [] };
  const calls = { ranges: [], upserts: [], deletes: 0 };
  let remainingFailures = failWrites;

  function query(table) {
    const state = { op: 'select', payload: null, range: null, match: null };
    const q = {
      select: () => q,
      order: () => q,
      range: (from, to) => {
        state.range = [from, to];
        calls.ranges.push([from, to]);
        return q;
      },
      upsert: (payload) => {
        state.op = 'upsert';
        state.payload = payload;
        return q;
      },
      delete: () => {
        state.op = 'delete';
        return q;
      },
      match: (m) => {
        state.match = m;
        return q;
      },
      then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
    };
    function run() {
      if (state.op === 'select') {
        if (failLoad) return { data: null, error: { message: 'load failed' } };
        const [from, to] = state.range;
        return { data: tables[table].slice(from, to + 1), error: null };
      }
      if (remainingFailures > 0) {
        remainingFailures -= 1;
        return { data: null, error: { message: 'write failed' } };
      }
      if (state.op === 'upsert') {
        const list = Array.isArray(state.payload) ? state.payload : [state.payload];
        calls.upserts.push({ table, list });
        for (const row of list) {
          const i = tables[table].findIndex((r) => r.collection === row.collection && r.id === row.id);
          if (i >= 0) tables[table][i] = row;
          else tables[table].push(row);
        }
      } else {
        calls.deletes += 1;
        tables[table] = tables[table].filter((r) => !(r.collection === state.match.collection && r.id === state.match.id));
      }
      return { data: null, error: null };
    }
    return q;
  }
  return { from: query, tables, calls };
}

const make = (client, extra = {}) => new SupabaseStore({ client, retryBaseMs: 1, ...extra });

describe('SupabaseStore loading (#49, #50)', () => {
  it('loads every row across pages instead of one capped select', async () => {
    const rows = Array.from({ length: PAGE_SIZE * 2 + 5 }, (_, i) => ({
      collection: 'users',
      id: String(i),
      doc: { id: String(i) },
    }));
    const client = fakeClient({ rows });
    const store = make(client);
    await store.ready();
    expect(store.all('users')).toHaveLength(PAGE_SIZE * 2 + 5);
    expect(client.calls.ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, PAGE_SIZE * 2 - 1],
      [PAGE_SIZE * 2, PAGE_SIZE * 3 - 1],
    ]);
  });

  it('is not writable until the preload finishes', async () => {
    const store = make(fakeClient());
    expect(store.isWritable()).toBe(false);
    await store.ready();
    expect(store.isWritable()).toBe(true);
  });

  it('stays not writable and rejects ready() when the load fails', async () => {
    const store = make(fakeClient({ failLoad: true }));
    await expect(store.ready()).rejects.toThrow('load failed');
    expect(store.isWritable()).toBe(false);
  });

  it('requires credentials when no client is injected', () => {
    const saved = ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_KEY'].map((k) => [k, process.env[k]]);
    for (const [k] of saved) delete process.env[k];
    try {
      expect(() => new SupabaseStore({ supabaseUrl: '', supabaseKey: '' })).toThrow(/requires SUPABASE_URL/);
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v;
    }
  });
});

describe('SupabaseStore one-time import (#51)', () => {
  let file;
  beforeEach(() => {
    file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sbstore-')), 'store.json');
    fs.writeFileSync(file, JSON.stringify({ users: { u1: { id: 'u1', name: 'Ada' } } }));
  });

  it('imports store.json on the first boot only', async () => {
    const client = fakeClient();
    const first = make(client, { importPath: file });
    await first.ready();
    expect(first.get('users', 'u1')).toEqual({ id: 'u1', name: 'Ada' });
    expect(client.tables.documents.some((r) => r.collection === '_meta' && r.id === 'json_import')).toBe(true);

    // Edit the live copy, then boot again with the same file present.
    first.set('users', 'u1', { id: 'u1', name: 'Ada Lovelace' });
    await first.flush();
    const upsertsBefore = client.calls.upserts.length;

    const second = make(client, { importPath: file });
    await second.ready();
    expect(second.get('users', 'u1').name).toBe('Ada Lovelace');
    expect(client.calls.upserts.length).toBe(upsertsBefore);
  });

  it('never overwrites documents that already exist in Supabase', async () => {
    const client = fakeClient({ rows: [{ collection: 'users', id: 'u1', doc: { id: 'u1', name: 'Existing' } }] });
    const store = make(client, { importPath: file });
    await store.ready();
    expect(store.get('users', 'u1').name).toBe('Existing');
  });

  it('ignores a missing or unreadable import file', async () => {
    const store = make(fakeClient(), { importPath: path.join(os.tmpdir(), 'nope-store.json') });
    await store.ready();
    fs.writeFileSync(file, '{not json');
    expect(await store.importJson(file)).toBe(0);
  });
});

describe('SupabaseStore writes (#52)', () => {
  it('persists set and delete and mirrors users into profiles', async () => {
    const client = fakeClient();
    const store = make(client);
    await store.ready();
    store.set('users', 'u1', { id: 'u1', name: 'Ada', email: 'a@b.c' });
    store.set('progress', 'u1', { xp: 5 });
    expect(store.delete('progress', 'u1')).toBe(true);
    expect(store.delete('progress', 'missing')).toBe(false);
    await store.flush();
    expect(client.tables.documents.map((r) => `${r.collection}/${r.id}`)).toEqual(['users/u1']);
    expect(client.tables.profiles).toHaveLength(1);
    expect(store.isWritable()).toBe(true);
  });

  it('retries a failing write and succeeds', async () => {
    const client = fakeClient({ failWrites: 2 });
    const store = make(client);
    await store.ready();
    store.set('progress', 'u1', { xp: 1 });
    await store.flush();
    expect(client.tables.documents).toHaveLength(1);
    expect(store.writeFailures).toBe(0);
  });

  it('surfaces a write that keeps failing, then recovers on the next success', async () => {
    const client = fakeClient({ failWrites: 3 });
    const store = make(client);
    await store.ready();
    store.set('progress', 'u1', { xp: 1 });
    await store.flush();
    expect(store.writeFailures).toBe(1);
    expect(store.lastWriteError).toBe('write failed');
    expect(store.isWritable()).toBe(false);

    store.set('progress', 'u1', { xp: 2 });
    await store.flush();
    expect(store.isWritable()).toBe(true);
  });

  it('flush waits for pending writes', async () => {
    const client = fakeClient();
    const store = make(client);
    await store.ready();
    for (let i = 0; i < 20; i += 1) store.set('progress', `u${i}`, { xp: i });
    await store.flush();
    expect(client.tables.documents).toHaveLength(20);
    expect(store.pendingWrites.size).toBe(0);
  });

  it('returns clones so callers cannot mutate cached documents', async () => {
    const store = make(fakeClient());
    await store.ready();
    store.set('users', 'u1', { id: 'u1', tags: ['a'] });
    store.get('users', 'u1').tags.push('b');
    expect(store.get('users', 'u1').tags).toEqual(['a']);
    expect(store.find('users', (u) => u.id === 'u1')).toHaveLength(1);
    await store.flush();
  });
});
