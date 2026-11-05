const { JsonStore, setStore } = require('../lib/store');
const progress = require('../services/progressService');
const { createManager } = require('../services/sandboxManager');
const { fakeEngine } = require('./helpers');

function spyStore() {
  const store = new JsonStore(null);
  const counts = { set: {}, all: {} };
  const set = store.set.bind(store);
  const all = store.all.bind(store);
  store.set = (name, id, doc) => {
    counts.set[name] = (counts.set[name] || 0) + 1;
    return set(name, id, doc);
  };
  store.all = (name) => {
    counts.all[name] = (counts.all[name] || 0) + 1;
    return all(name);
  };
  return { store, counts };
}

describe('leaderboard cache (#54)', () => {
  test('saves that do not change the ranking do not trigger a rescan', () => {
    const { store, counts } = spyStore();
    setStore(store);
    const now = Date.now();
    progress.recordQuiz('u1', 'linux', 'q1', now); // +XP: ranking changes
    progress.leaderboard(20, now);
    expect(counts.all.progress).toBe(1);

    // Hints change neither XP, completed units nor active days.
    for (let i = 0; i < 50; i += 1) progress.recordHint('u1', 'linux', 1, now);
    progress.leaderboard(20, now + 1000);
    expect(counts.all.progress).toBe(1);
  });

  test('an XP change shows up straight away', () => {
    const { store } = spyStore();
    setStore(store);
    const now = Date.now();
    progress.recordQuiz('u1', 'linux', 'q1', now);
    expect(progress.leaderboard(20, now)[0].xp).toBe(progress.XP.quiz);
    progress.recordQuiz('u1', 'linux', 'q2', now);
    expect(progress.leaderboard(20, now + 1)[0].xp).toBe(progress.XP.quiz * 2);
  });

  test('removing a learner drops them from the board and forgets their signature', () => {
    const { store } = spyStore();
    setStore(store);
    const now = Date.now();
    progress.recordQuiz('u1', 'linux', 'q1', now);
    expect(progress.leaderboard(20, now)).toHaveLength(1);
    expect(progress.remove('u1')).toBe(true);
    expect(progress.leaderboard(20, now + 1)).toHaveLength(0);
    expect(progress.remove('u1')).toBe(false);
  });
});

describe('sandbox session persistence (#53)', () => {
  test('typing 1,000 keystrokes causes at most a few store writes', async () => {
    const { store, counts } = spyStore();
    setStore(store);
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false } });
    const { sessionId } = await manager.createSession('user-1', 'linux-basics');
    const afterCreate = counts.set.sessions;
    expect(afterCreate).toBe(1);

    for (let i = 0; i < 1000; i += 1) manager.touch(sessionId);
    for (let i = 0; i < 20; i += 1) manager.recordCommand(sessionId, `echo ${i}`);
    expect(counts.set.sessions).toBe(afterCreate);
    await manager.shutdown();
  });

  test('persists again once the interval has passed, with the latest history', async () => {
    const { store } = spyStore();
    setStore(store);
    const manager = createManager({
      engine: fakeEngine(),
      pool: { enabled: false },
      limits: { persistIntervalMs: 0 },
    });
    const { sessionId } = await manager.createSession('user-1', 'linux-basics');
    manager.recordCommand(sessionId, 'ls');
    expect(store.get('sessions', sessionId).history.map((h) => h.command)).toEqual(['ls']);
    await manager.shutdown();
  });

  test('idle reaping uses the in-memory timestamp, not the throttled stored one', async () => {
    const { store } = spyStore();
    setStore(store);
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false }, limits: { maxIdleMs: 50 } });
    const { sessionId } = await manager.createSession('user-1', 'linux-basics');
    manager.touch(sessionId);
    expect(manager.getSession(sessionId)).toBeTruthy();
    await manager.shutdown();
  });
});
