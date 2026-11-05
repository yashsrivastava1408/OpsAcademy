const { createMemoryRepos, setRepos } = require('../repositories');
const progress = require('../services/progressService');
const { createManager } = require('../services/sandboxManager');
const { fakeEngine } = require('./helpers');

/** Memory repositories that count calls to the methods under test. */
async function spyRepos(userIds = ['u1']) {
  const repos = createMemoryRepos();
  const counts = { leaderboard: 0, upserts: 0 };
  const board = repos.progress.leaderboard.bind(repos.progress);
  repos.progress.leaderboard = (...args) => {
    counts.leaderboard += 1;
    return board(...args);
  };
  const upsert = repos.sessions.upsert.bind(repos.sessions);
  repos.sessions.upsert = (...args) => {
    counts.upserts += 1;
    return upsert(...args);
  };
  setRepos(repos);
  for (const id of userIds) await repos.users.create({ id, name: id, guest: true, createdAt: new Date().toISOString() });
  return { repos, counts };
}

describe('leaderboard cache (#54)', () => {
  test('updates that do not change the ranking do not trigger a re-query', async () => {
    const { counts } = await spyRepos();
    const now = Date.now();
    await progress.recordQuiz('u1', 'linux', 'q1', now); // +XP: ranking changes
    await progress.leaderboard(20, now);
    expect(counts.leaderboard).toBe(1);

    // Hints change neither XP, completed units nor active days.
    for (let i = 0; i < 50; i += 1) await progress.recordHint('u1', 'linux', 1, now);
    await progress.leaderboard(20, now + 1000);
    expect(counts.leaderboard).toBe(1);
  });

  test('an XP change shows up straight away', async () => {
    await spyRepos();
    const now = Date.now();
    await progress.recordQuiz('u1', 'linux', 'q1', now);
    expect((await progress.leaderboard(20, now))[0].xp).toBe(progress.XP.quiz);
    await progress.recordQuiz('u1', 'linux', 'q2', now);
    expect((await progress.leaderboard(20, now + 1))[0].xp).toBe(progress.XP.quiz * 2);
  });

  test('removing a learner drops them from the board', async () => {
    await spyRepos();
    const now = Date.now();
    await progress.recordQuiz('u1', 'linux', 'q1', now);
    expect(await progress.leaderboard(20, now)).toHaveLength(1);
    expect(await progress.remove('u1')).toBe(true);
    expect(await progress.leaderboard(20, now + 1)).toHaveLength(0);
    expect(await progress.remove('u1')).toBe(false);
  });
});

describe('sandbox session persistence (#53)', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  test('typing 1,000 keystrokes causes at most a few store writes', async () => {
    const { counts } = await spyRepos();
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');
    const afterCreate = counts.upserts;
    expect(afterCreate).toBe(1);

    for (let i = 0; i < 1000; i += 1) manager.touch(sessionId);
    for (let i = 0; i < 20; i += 1) manager.recordCommand(sessionId, `echo ${i}`);
    expect(counts.upserts).toBe(afterCreate);
    await manager.shutdown();
  });

  test('persists again once the interval has passed, with the latest history', async () => {
    const { repos } = await spyRepos();
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false }, limits: { persistIntervalMs: 0 } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');
    manager.recordCommand(sessionId, 'ls');
    await settle();
    const stored = (await repos.sessions.all()).find((s) => s.sessionId === sessionId);
    expect(stored.history.map((h) => h.command)).toEqual(['ls']);
    await manager.shutdown();
  });

  test('a failing database write never breaks the lab', async () => {
    const { repos } = await spyRepos();
    repos.sessions.upsert = () => Promise.reject(new Error('database down'));
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');
    manager.touch(sessionId);
    await settle();
    expect(manager.getSession(sessionId)).toBeTruthy();
    await manager.shutdown();
  });

  test('idle reaping uses the in-memory timestamp, not the throttled stored one', async () => {
    await spyRepos();
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false }, limits: { maxIdleMs: 50 } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');
    manager.touch(sessionId);
    expect(manager.getSession(sessionId)).toBeTruthy();
    await manager.shutdown();
  });
});
