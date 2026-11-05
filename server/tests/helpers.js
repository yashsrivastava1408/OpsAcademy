const { createMemoryRepos, setRepos } = require('../repositories');

/**
 * Fresh repositories for a test. With TEST_REPOS=postgres (and TEST_DATABASE_URL) the whole
 * suite runs against a real database (tests/setup-db.js empties it before every test), so
 * what the services do is proven on Postgres, not only on the in-memory copy.
 */
function newRepos() {
  if (process.env.TEST_REPOS === 'postgres') return require('./setup-db').postgresRepos();
  return createMemoryRepos();
}

/** Make a stored certificate look forged (tests only). */
async function tamperCertificate(repos, id, patch) {
  if (repos.driver === 'postgres') {
    await repos.pool.query('update certificates set student_name = $2 where id = $1', [id, patch.studentName]);
  } else {
    Object.assign(repos._test.certificates.get(id), patch);
  }
}

/** Pretend a user was created `days` ago (tests only). */
async function backdateUser(repos, id, days, now = Date.now()) {
  const when = new Date(now - days * 24 * 60 * 60 * 1000);
  if (repos.driver === 'postgres') {
    await repos.pool.query('update users set created_at = $2 where id = $1', [id, when]);
  } else {
    repos._test.users.get(id).createdAt = when.toISOString();
  }
}
const { createManager, setManager } = require('../services/sandboxManager');
const { setHubClient } = require('../services/aiHubClient');
const { createMailer, setMailer } = require('../lib/mailer');

/** An in-memory sandbox engine that records what the manager asks of it. */
function fakeEngine() {
  const engine = {
    name: 'fake',
    alive: new Set(),
    created: [],
    destroyed: [],
    resets: [],
    exitListeners: new Map(),
    execResult: { exitCode: 0, stdout: '', stderr: '' },
    failCreate: false,
    create(engineId) {
      if (engine.failCreate) return Promise.reject(new Error('engine unavailable'));
      engine.created.push(engineId);
      engine.alive.add(engineId);
      return Promise.resolve();
    },
    destroy(engineId) {
      engine.destroyed.push(engineId);
      return Promise.resolve(engine.alive.delete(engineId));
    },
    isAlive: (engineId) => engine.alive.has(engineId),
    onExit(engineId, listener) {
      engine.exitListeners.set(engineId, listener);
    },
    /** Simulate the shell exiting on its own. */
    exit(engineId) {
      engine.alive.delete(engineId);
      const listener = engine.exitListeners.get(engineId);
      if (listener) listener();
    },
    exec: () => Promise.resolve(engine.execResult),
    attach: () => Promise.resolve({ onData() {}, write() {}, resize() {}, close() {} }),
    reset(engineId) {
      engine.resets.push(engineId);
      return Promise.resolve();
    },
    info: () => ({ mode: 'fake' }),
  };
  return engine;
}

/** A hub client whose answers the test controls. */
function fakeHub() {
  const hub = {
    calls: [],
    down: false,
    hintResponse: null,
    scoreResponse: { score: 80, covered: ['a'], missed: [], feedback: 'Good', source: 'rules' },
    async hint(payload) {
      hub.calls.push({ endpoint: 'hint', payload });
      if (hub.down) throw new Error('hub down');
      return hub.hintResponse || { blocked: false, hint: `tier ${payload.tier} hint`, source: 'rules' };
    },
    /** Streams `hub.streamEvents` if set, otherwise the plain hint as one piece. */
    async* hintStream(payload) {
      hub.calls.push({ endpoint: 'hintStream', payload });
      if (hub.down) throw new Error('hub down');
      if (hub.streamEvents) {
        for (const event of hub.streamEvents) {
          if (event.type === 'throw') throw new Error('hub died mid-stream');
          yield event;
        }
        return;
      }
      const data = hub.hintResponse || { blocked: false, hint: `tier ${payload.tier} hint`, source: 'rules' };
      if (!data.blocked) yield { type: 'delta', text: data.hint };
      yield { type: 'done', data };
    },
    async scan(command) {
      hub.calls.push({ endpoint: 'scan', command });
      if (hub.down) throw new Error('hub down');
      return { safe: true };
    },
    async scoreInterview(payload) {
      hub.calls.push({ endpoint: 'score', payload });
      if (hub.down) throw new Error('hub down');
      return hub.scoreResponse;
    },
    isHealthy: async () => !hub.down,
  };
  return hub;
}

/**
 * Fresh store, manager and hub for one test, installed as the process-wide
 * instances the routes use.
 */
function install({ engine, limits, pool = { enabled: false } } = {}) {
  const repos = newRepos();
  const manager = createManager({ engine, limits, pool });
  const hub = fakeHub();
  setRepos(repos);
  setManager(manager);
  setHubClient(hub);
  const mailer = createMailer({ driver: 'memory' });
  setMailer(mailer);
  return { repos, manager, hub, engine, mailer };
}

function waitFor(predicate, { timeoutMs = 8000, intervalMs = 20 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      let value;
      try {
        value = predicate();
      } catch (err) {
        return reject(err);
      }
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

module.exports = { fakeEngine, fakeHub, install, waitFor, newRepos, tamperCertificate, backdateUser };
