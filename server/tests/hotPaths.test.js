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

describe('session registry on the hot path (#53)', () => {
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  /** Count registry calls the terminal makes on every keystroke. */
  function spyRegistry(repos) {
    const counts = { touch: 0, appendCommand: 0 };
    for (const name of Object.keys(counts)) {
      const original = repos.sessions[name].bind(repos.sessions);
      repos.sessions[name] = (...args) => {
        counts[name] += 1;
        return original(...args);
      };
    }
    return counts;
  }

  test('typing 1,000 keystrokes causes at most one activity write; every command is kept', async () => {
    const { repos } = await spyRepos();
    const counts = spyRegistry(repos);
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');

    for (let i = 0; i < 1000; i += 1) manager.touch(sessionId);
    for (let i = 0; i < 20; i += 1) manager.recordCommand(sessionId, `echo ${i}`);
    await settle();
    expect(counts.touch).toBe(0); // the create already stamped the activity time; the throttle holds the rest back
    expect(counts.appendCommand).toBe(20);
    expect((await manager.getHistory(sessionId))).toHaveLength(20);
    await manager.shutdown();
  });

  test('activity is written again once the interval has passed', async () => {
    const { repos } = await spyRepos();
    const counts = spyRegistry(repos);
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false }, limits: { persistIntervalMs: 0 } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');
    await manager.touch(sessionId);
    await manager.touch(sessionId);
    expect(counts.touch).toBe(2);
    await manager.shutdown();
  });

  test('a failing activity or history write never breaks the lab', async () => {
    const { repos } = await spyRepos();
    const manager = createManager({ engine: fakeEngine(), pool: { enabled: false }, limits: { persistIntervalMs: 0 } });
    const { sessionId } = await manager.createSession('u1', 'linux-basics');
    repos.sessions.touch = () => Promise.reject(new Error('database down'));
    repos.sessions.appendCommand = () => Promise.reject(new Error('database down'));
    await manager.touch(sessionId);
    manager.recordCommand(sessionId, 'ls');
    await settle();
    expect(await manager.getSession(sessionId)).toBeTruthy();
    await manager.shutdown();
  });

  test('if the session cannot be recorded the start fails and no sandbox is left running', async () => {
    const { repos } = await spyRepos();
    repos.sessions.upsert = () => Promise.reject(new Error('database down'));
    const engine = fakeEngine();
    const manager = createManager({ engine, pool: { enabled: false } });
    await expect(manager.createSession('u1', 'linux-basics')).rejects.toThrow('database down');
    expect(engine.alive.size).toBe(0);
    await manager.shutdown();
  });

  test('idle reaping reads the registry, so any instance can do it', async () => {
    await spyRepos();
    const engine = fakeEngine();
    const a = createManager({ engine, pool: { enabled: false }, limits: { maxIdleMs: 50 } });
    const b = createManager({ engine, pool: { enabled: false }, limits: { maxIdleMs: 50 } });
    const { sessionId } = await a.createSession('u1', 'linux-basics');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await b.sweep()).toEqual([{ sessionId, reason: 'idle' }]);
    expect(await a.getSession(sessionId)).toBeNull();
  });
});
