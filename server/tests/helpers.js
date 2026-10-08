const { JsonStore, setStore } = require('../lib/store');
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
  const store = new JsonStore(null);
  const manager = createManager({ engine, limits, pool });
  const hub = fakeHub();
  setStore(store);
  setManager(manager);
  setHubClient(hub);
  const mailer = createMailer({ driver: 'memory' });
  setMailer(mailer);
  return { store, manager, hub, engine, mailer };
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

module.exports = { fakeEngine, fakeHub, install, waitFor };
