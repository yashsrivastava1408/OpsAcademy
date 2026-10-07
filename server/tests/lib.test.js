const fs = require('fs');
const os = require('os');
const path = require('path');
const sm2 = require('../lib/sm2');
const units = require('../lib/units');
const { JsonStore } = require('../lib/store');

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
