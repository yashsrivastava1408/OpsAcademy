const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pool } = require('pg');
const { migrate } = require('../lib/migrator');
const { readJson, readSqlite, importLegacy, cleanUser, cleanProgress } = require('../lib/legacyImport');

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;
const NOW = Date.parse('2026-11-05T12:00:00Z');

/** A realistic mess: good rows, a duplicate email, an orphan, expired tokens, malformed records. */
function legacy() {
  return {
    users: [
      { id: 'u_ada', name: 'Ada', email: 'Ada@Example.com', password: '$2b$10$hash', guest: false, emailVerified: true, createdAt: '2026-01-01T00:00:00.000Z', registeredAt: '2026-01-02T00:00:00.000Z', profilePublic: true, profileSlug: 'ada-1a2b3c', passwordChangedAt: 1_780_000_000_000 },
      { id: 'u_ben', name: 'Ben', email: 'ben@example.com', password: '$2b$10$hash2', guest: false, createdAt: '2026-02-01T00:00:00.000Z' },
      { id: 'u_ada2', name: 'Ada Again', email: 'ada@example.com', password: 'x', guest: false, createdAt: '2026-03-01T00:00:00.000Z' }, // duplicate email, later account
      { id: 'g_1', name: 'Guest-1', guest: true, createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 'u_bad_slug', name: 'Slug', email: 'slug@example.com', guest: false, profileSlug: 'Bad Slug!', createdAt: '2026-04-01T00:00:00.000Z' },
      { id: 'u_noemail', name: 'Nomail', guest: false, createdAt: '2026-05-01T00:00:00.000Z' }, // registered without email
      { name: 'no id' },
      null,
    ],
    tokens: [
      { hash: 'h_ok', userId: 'u_ada', kind: 'reset', expiresAt: NOW + 60_000 },
      { hash: 'h_old', userId: 'u_ada', kind: 'verify', expiresAt: NOW - 60_000 },
      { hash: 'h_ghost', userId: 'ghost', kind: 'reset', expiresAt: NOW + 60_000 },
      { hash: 'h_bad', userId: 'u_ada', kind: 'other', expiresAt: NOW + 60_000 },
    ],
    progress: [
      { userId: 'u_ada', xp: 140, completedUnits: { linux: 1 }, steps: { 'linux:1': { attempts: 1, fails: 0, passedAt: 5 } }, hints: {}, quizzes: {}, cards: {}, interviews: [], activeDays: ['2026-10-01', 'not-a-day'], daily: {} },
      { userId: 'g_1', xp: 20, activeDays: [] },
      { userId: 'nobody', xp: 999 }, // orphan
      { xp: 5 }, // malformed
    ],
    certificates: [
      { id: 'OPS-0123456789AB', userId: 'u_ada', studentName: 'Ada', unitId: 'linux', unitTitle: 'Linux', score: 96, issuedAt: '2026-10-10T10:20:30.123Z', signature: 'sig' },
      { id: 'OPS-AAAAAAAAAAAA', userId: 'u_ada', studentName: 'Ada', unitId: 'linux', unitTitle: 'Linux', score: 90, issuedAt: '2026-10-11T00:00:00.000Z', signature: 'sig2' }, // second cert, same unit
      { id: 'OPS-BBBBBBBBBBBB', userId: 'nobody', studentName: 'X', unitId: 'linux', unitTitle: 'Linux', score: 90, issuedAt: '2026-10-11T00:00:00.000Z', signature: 's' },
      { id: 'bad', userId: 'u_ada' },
    ],
  };
}

describe('legacy readers and cleaning', () => {
  test('readJson reads store.json collections', () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-')), 'store.json');
    fs.writeFileSync(file, JSON.stringify({ users: { u1: { id: 'u1' } }, emails: { 'a@b.c': { id: 'u1' } }, progress: { u1: { userId: 'u1' } } }));
    const data = readJson(file);
    expect(data.users).toEqual([{ id: 'u1' }]);
    expect(data.progress).toHaveLength(1);
    expect(data.tokens).toEqual([]);
  });

  test('readSqlite reads the documents table', () => {
    const { DatabaseSync } = require('node:sqlite');
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-')), 'store.db');
    const db = new DatabaseSync(file);
    db.exec('create table documents (collection text, id text, doc text, primary key (collection, id))');
    db.prepare('insert into documents values (?, ?, ?)').run('users', 'u1', JSON.stringify({ id: 'u1', name: 'Ada' }));
    db.prepare('insert into documents values (?, ?, ?)').run('certificates', 'OPS-1', JSON.stringify({ id: 'OPS-1' }));
    db.close();
    const data = readSqlite(file);
    expect(data.users).toEqual([{ id: 'u1', name: 'Ada' }]);
    expect(data.certificates).toEqual([{ id: 'OPS-1' }]);
  });

  test('cleanUser normalises emails, slugs and names; cleanProgress drops bad days', () => {
    expect(cleanUser({ id: 'u', name: '  ', email: ' A@B.C ', profileSlug: 'Bad Slug', createdAt: 'nonsense' })).toMatchObject({ name: 'Learner', email: 'a@b.c', profileSlug: null });
    expect(cleanUser({ name: 'x' })).toBeNull();
    expect(cleanProgress({ userId: 'u', xp: -5, activeDays: ['2026-01-01', 'x'], steps: 'bad' })).toMatchObject({ xp: 0, activeDays: ['2026-01-01'], steps: {} });
    expect(cleanProgress({})).toBeNull();
  });
});

describeDb('importLegacy (real Postgres)', () => {
  let pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
    await migrate(pool);
  });
  afterAll(() => pool.end());
  beforeEach(() => pool.query('truncate users, colleges cascade'));

  const count = async (table) => (await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n;

  test('a dry run reports exactly what would happen and writes nothing', async () => {
    const report = await importLegacy(pool, legacy(), { apply: false, now: NOW });
    expect(report.committed).toBe(false);
    expect(report.verification.ok).toBe(true);
    expect(report.users).toMatchObject({ source: 8, imported: 4 });
    expect(await count('users')).toBe(0);
    expect(await count('progress')).toBe(0);
  });

  test('apply imports, explains every skipped record and verifies', async () => {
    const report = await importLegacy(pool, legacy(), { apply: true, now: NOW });
    expect(report.committed).toBe(true);
    expect(report.verification.ok).toBe(true);

    expect(report.users.imported).toBe(4); // ada, ben, g_1, bad_slug
    expect(report.users.skipped).toEqual({ malformed: 2, email_or_slug_conflict: 1, registered_without_email: 1 });
    expect(report.tokens).toMatchObject({ imported: 1, skipped: { expired: 1, unknown_user: 1, malformed: 1 } });
    expect(report.progress).toMatchObject({ imported: 2, skipped: { orphan_no_user: 1, malformed: 1 } });
    expect(report.certificates).toMatchObject({ imported: 1, skipped: { duplicate_or_present: 1, orphan_no_user: 1, malformed: 1 } });

    const ada = (await pool.query("select * from users where id = 'u_ada'")).rows[0];
    expect(ada).toMatchObject({ email: 'ada@example.com', email_verified: true, profile_public: true, profile_slug: 'ada-1a2b3c', password_hash: '$2b$10$hash' });
    expect(ada.password_changed_at.getTime()).toBe(1_780_000_000_000);
    expect((await pool.query("select profile_slug from users where id = 'u_bad_slug'")).rows[0].profile_slug).toBeNull();
    expect((await pool.query("select 1 from users where id = 'u_ada2'")).rowCount).toBe(0); // earlier account wins

    const progress = (await pool.query("select xp, completed_unit_count, active_days::text[] as days, steps from progress where user_id = 'u_ada'")).rows[0];
    expect(progress).toMatchObject({ xp: 140, completed_unit_count: 1, days: ['2026-10-01'] });
    expect(progress.steps['linux:1'].passedAt).toBe(5);
    const cert = (await pool.query("select score, issued_at from certificates where id = 'OPS-0123456789AB'")).rows[0];
    expect(cert.score).toBe(96);
    expect(cert.issued_at.toISOString()).toBe('2026-10-10T10:20:30.123Z');
  });

  test('running it again changes nothing (idempotent) and never overwrites newer data', async () => {
    await importLegacy(pool, legacy(), { apply: true, now: NOW });
    await pool.query("update progress set xp = 500 where user_id = 'u_ada'");
    const again = await importLegacy(pool, legacy(), { apply: true, now: NOW });
    expect(again.committed).toBe(true);
    expect(again.users.imported).toBe(0);
    expect(again.users.skipped.already_present).toBe(4);
    expect(again.progress.imported).toBe(0);
    expect((await pool.query("select xp from progress where user_id = 'u_ada'")).rows[0].xp).toBe(500);
  });

  test('a failed verification rolls everything back', async () => {
    // A trigger that loses XP on insert makes the stored data disagree with the source.
    await pool.query(`
      create or replace function lose_xp() returns trigger language plpgsql as $$ begin new.xp = 0; return new; end $$;
      create trigger lose_xp_trigger before insert on progress for each row execute function lose_xp();`);
    try {
      const report = await importLegacy(pool, legacy(), { apply: true, now: NOW });
      expect(report.verification.ok).toBe(false);
      expect(report.verification.checks.find((c) => !c.ok).name).toMatch(/XP/);
      expect(report.committed).toBe(false);
    } finally {
      await pool.query('drop trigger lose_xp_trigger on progress; drop function lose_xp()');
    }
    expect(await count('users')).toBe(0);
    expect(await count('progress')).toBe(0);
  });
});
