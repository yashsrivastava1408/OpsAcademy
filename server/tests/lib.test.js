const fs = require('fs');
const os = require('os');
const path = require('path');
const sm2 = require('../lib/sm2');
const units = require('../lib/units');
const { JsonStore, createStore } = require('../lib/store');
const { SqliteStore } = require('../lib/sqliteStore');

describe('sm2', () => {
  const now = Date.UTC(2026, 0, 1);

  test('first three successful reviews are spaced 1 day, 6 days, then by ease', () => {
    let card = sm2.review(null, 4, now);
    expect(card).toMatchObject({ reps: 1, intervalDays: 1, due: now + sm2.DAY_MS, ease: 2.5 });
    card = sm2.review(card, 4, now);
    expect(card).toMatchObject({ reps: 2, intervalDays: 6 });
    card = sm2.review(card, 4, now);
    expect(card).toMatchObject({ reps: 3, intervalDays: 15 });
  });

  test('a forgotten card restarts and comes back within minutes', () => {
    const learned = sm2.review(sm2.review(null, 5, now), 5, now);
    const lapsed = sm2.review(learned, 1, now);
    expect(lapsed).toMatchObject({ reps: 0, intervalDays: 0, due: now + sm2.RELEARN_MS });
    expect(lapsed.ease).toBeLessThan(learned.ease);
  });

  test('ease never drops below the floor and easy answers raise it', () => {
    let card = null;
    for (let i = 0; i < 20; i += 1) card = sm2.review(card, 0, now);
    expect(card.ease).toBe(sm2.MIN_EASE);
    expect(sm2.review(null, 5, now).ease).toBe(2.6);
  });

  test('isDue: new cards are due, scheduled cards are not until their date', () => {
    expect(sm2.isDue(null, now)).toBe(true);
    const card = sm2.review(null, 4, now);
    expect(sm2.isDue(card, now)).toBe(false);
    expect(sm2.isDue(card, now + sm2.DAY_MS)).toBe(true);
  });

  test('out-of-range grades are clamped', () => {
    expect(sm2.review(null, 99, now).ease).toBe(2.6);
    expect(sm2.review(null, -5, now).reps).toBe(0);
  });
});

describe('units', () => {
  test('loads every unit folder with its practice steps', () => {
    const folders = fs.readdirSync(units.UNITS_DIR).filter((f) => fs.existsSync(path.join(units.UNITS_DIR, f, 'unit.json')));
    expect(units.listMeta()).toHaveLength(folders.length);
    expect(units.totalSteps()).toBeGreaterThan(0);
    expect(units.getStep('linux-basics', 1)).toMatchObject({ step: 1 });
    expect(units.getStep('linux-basics', '2')).toMatchObject({ step: 2 });
    expect(units.getStep('linux-basics', 999)).toBeNull();
  });

  test.each(['../../config', '..', 'linux-basics/../git-basics', 'Linux-Basics', '', 'a b', null, undefined, 42])(
    'rejects unit id %p',
    (unitId) => {
      expect(units.isValidUnitId(unitId)).toBe(false);
      expect(units.getUnit(unitId)).toBeNull();
      expect(units.getSteps(unitId)).toEqual([]);
    }
  );

  test('practice content for the browser has no verification commands', () => {
    const practice = units.publicPractice('linux-basics');
    expect(practice.steps.length).toBe(units.getSteps('linux-basics').length);
    for (const step of practice.steps) {
      expect(step).not.toHaveProperty('verification');
      expect(step.autoVerified).toBe(true);
    }
    expect(JSON.stringify(practice)).not.toContain('echo PASS');
  });

  test('every unit has usable flashcards or interview questions, whatever layout it was authored in', () => {
    for (const meta of units.listMeta()) {
      const cards = units.getFlashcards(meta.id);
      const questions = units.getInterviewQuestions(meta.id);
      expect(cards.length + questions.length).toBeGreaterThan(0);
      for (const card of cards) {
        expect(card.front).toEqual(expect.any(String));
        expect(card.back).toEqual(expect.any(String));
      }
      for (const q of questions) {
        expect(q.question).toEqual(expect.any(String));
        expect(q.modelAnswer).toEqual(expect.any(String));
        expect(q.difficulty).toEqual(expect.any(String));
      }
    }
  });

  test('normalisePrepare converts question/answer cards and a `questions` list', () => {
    const result = units.normalisePrepare({
      flashcards: [{ id: 1, question: 'Q?', answer: 'A.' }],
      questions: [{ question: 'Scenario?', answer: 'Do X.', category: 'aws' }],
    });
    expect(result.flashcards).toEqual([{ id: '1', question: 'Q?', answer: 'A.', front: 'Q?', back: 'A.' }]);
    expect(result.interviewQuestions).toEqual([
      { id: 'iq-1', question: 'Scenario?', answer: 'Do X.', category: 'aws', difficulty: 'intermediate', modelAnswer: 'Do X.' },
    ]);
  });

  test('every flashcard and interview question has a unique id within its unit', () => {
    for (const meta of units.listMeta()) {
      for (const items of [units.getFlashcards(meta.id), units.getInterviewQuestions(meta.id)]) {
        const ids = items.map((item) => item.id);
        expect(ids.every(Boolean)).toBe(true);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });
});

describe('JsonStore', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-store-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('persists across instances after flush', () => {
    const file = path.join(dir, 'nested', 'store.json');
    const store = new JsonStore(file);
    store.set('users', 'u1', { name: 'Asha' });
    store.flush();

    const reopened = new JsonStore(file);
    expect(reopened.get('users', 'u1')).toEqual({ name: 'Asha' });
    expect(fs.readdirSync(path.dirname(file))).toEqual(['store.json']);
  });

  test('writes itself after the debounce without an explicit flush', async () => {
    const file = path.join(dir, 'store.json');
    const store = new JsonStore(file, { debounceMs: 10 });
    store.set('users', 'u1', { name: 'Asha' });
    await new Promise((r) => setTimeout(r, 60));
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ users: { u1: { name: 'Asha' } } });
  });

  test('returns copies, so callers cannot mutate stored data by accident', () => {
    const store = new JsonStore(null);
    const doc = { tags: ['a'] };
    store.set('c', '1', doc);
    doc.tags.push('b');
    store.get('c', '1').tags.push('c');
    store.all('c')[0].tags.push('d');
    expect(store.get('c', '1')).toEqual({ tags: ['a'] });
  });

  test('get, find and delete', () => {
    const store = new JsonStore(null);
    expect(store.get('c', 'missing')).toBeNull();
    store.set('c', '1', { n: 1 });
    store.set('c', '2', { n: 2 });
    expect(store.find('c', (d) => d.n > 1)).toEqual([{ n: 2 }]);
    expect(store.delete('c', '1')).toBe(true);
    expect(store.delete('c', '1')).toBe(false);
    expect(store.all('c')).toEqual([{ n: 2 }]);
  });

  test('an in-memory store never touches disk and reports writable', () => {
    const store = new JsonStore(null);
    store.set('c', '1', {});
    store.flush();
    expect(store.isWritable()).toBe(true);
  });
});

// The services only know the store interface, so both stores must behave the same.
describe.each([
  ['JsonStore', () => new JsonStore(null)],
  ['SqliteStore', () => new SqliteStore(':memory:')],
])('store contract: %s', (_name, create) => {
  let store;
  beforeEach(() => { store = create(); });

  test('get, set, delete and all', () => {
    expect(store.get('users', 'u1')).toBeNull();
    expect(store.all('users')).toEqual([]);

    store.set('users', 'u1', { id: 'u1', name: 'Asha', tags: ['a'] });
    store.set('users', 'u2', { id: 'u2', name: 'Ravi' });
    store.set('progress', 'u1', { xp: 20 });
    expect(store.get('users', 'u1')).toEqual({ id: 'u1', name: 'Asha', tags: ['a'] });
    expect(store.all('users').map((u) => u.id).sort()).toEqual(['u1', 'u2']);
    expect(store.all('progress')).toEqual([{ xp: 20 }]);

    store.set('users', 'u1', { id: 'u1', name: 'Asha Rao' });
    expect(store.get('users', 'u1').name).toBe('Asha Rao');
    expect(store.all('users')).toHaveLength(2);

    expect(store.delete('users', 'u1')).toBe(true);
    expect(store.delete('users', 'u1')).toBe(false);
    expect(store.get('users', 'u1')).toBeNull();
    expect(store.find('users', (u) => u.name === 'Ravi')).toEqual([{ id: 'u2', name: 'Ravi' }]);
  });

  test('returns copies, so callers cannot change stored data by accident', () => {
    store.set('c', '1', { tags: ['a'] });
    store.get('c', '1').tags.push('b');
    store.all('c')[0].tags.push('c');
    expect(store.get('c', '1')).toEqual({ tags: ['a'] });
  });

  test('ids with unusual characters (emails) are kept apart', () => {
    store.set('emails', 'a.b+c@example.com', { id: 'u1' });
    store.set('emails', "o'brien@example.com", { id: 'u2' });
    expect(store.get('emails', 'a.b+c@example.com')).toEqual({ id: 'u1' });
    expect(store.get('emails', "o'brien@example.com")).toEqual({ id: 'u2' });
    expect(store.isWritable()).toBe(true);
    expect(() => store.flush()).not.toThrow();
  });
});

describe('SqliteStore on disk', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-sqlite-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  test('data survives closing and reopening the database', () => {
    const file = path.join(dir, 'nested', 'store.db');
    const store = new SqliteStore(file);
    store.set('users', 'u1', { name: 'Asha' });
    store.close();

    const reopened = new SqliteStore(file);
    expect(reopened.get('users', 'u1')).toEqual({ name: 'Asha' });
    reopened.close();
  });

  test('switching from the JSON file keeps every account, and happens once', () => {
    const json = new JsonStore(path.join(dir, 'store.json'));
    json.set('users', 'u1', { id: 'u1', name: 'Asha' });
    json.set('emails', 'asha@example.com', { id: 'u1' });
    json.set('progress', 'u1', { userId: 'u1', xp: 120 });
    json.flush();

    const settings = { isTest: false, dataDir: dir, storeDriver: 'sqlite' };
    const first = createStore(settings);
    expect(first).toBeInstanceOf(SqliteStore);
    expect(first.get('progress', 'u1')).toEqual({ userId: 'u1', xp: 120 });
    expect(first.all('users')).toHaveLength(1);
    first.set('progress', 'u1', { userId: 'u1', xp: 150 });
    first.close();

    // The next start must not overwrite newer data with the old file.
    const second = createStore(settings);
    expect(second.get('progress', 'u1').xp).toBe(150);
    second.close();

    expect(createStore({ isTest: false, dataDir: dir, storeDriver: 'json' })).toBeInstanceOf(JsonStore);
    expect(createStore({ isTest: true, dataDir: dir, storeDriver: 'sqlite' })).toBeInstanceOf(JsonStore);
  });
});
