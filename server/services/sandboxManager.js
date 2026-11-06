/**
 * Sandbox Manager — owns every student session
 *
 * Maps session ids to sandboxes, enforces per-user and global limits, and
 * hides whether the sandbox is a PTY shell or a Docker container. Routes and
 * services should use this module only, never an engine directly.
 */

const { randomUUID } = require('crypto');
const config = require('../config');
const logger = require('../lib/logger');
const { getRepos } = require('../repositories');
const metrics = require('../lib/metrics');
const { createPool } = require('./sandboxPoolService');

const LATENCY_SAMPLES = 200;

class SandboxError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function loadEngine(mode) {
  if (mode === 'remote') return require('./remoteEngine');
  return mode === 'docker' ? require('./dockerService') : require('./ptyService');
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function createManager({ engine = loadEngine(config.sandboxMode), limits = {}, pool: poolOptions, nodeId = config.nodeId } = {}) {
  const settings = {
    maxPerUser: config.sandbox.maxPerUser,
    maxTotal: config.sandbox.maxTotal,
    maxSessionMs: config.sandbox.maxSessionMinutes * 60 * 1000,
    maxIdleMs: config.sandbox.maxInactivityMinutes * 60 * 1000,
    historyLimit: config.sandbox.historyLimit,
    // Activity is written to the registry at most this often per session (create/destroy are immediate).
    persistIntervalMs: 30 * 1000,
    ...limits,
  };

  // Lab nodes keep their own warm pools; a gateway has no containers to pre-warm.
  const pool = createPool(engine, engine.remote ? { ...poolOptions, enabled: false } : poolOptions);
  // Remote engines need to know which node a sandbox is on.
  const where = (row) => (engine.remote ? { nodeId: row.nodeId } : undefined);
  const registry = () => getRepos().sessions;

  // Everything about a session (owner, node, history, strikes, activity) lives in the registry, so
  // any gateway instance can answer for it. What stays in this process is only what cannot be shared:
  // the sockets listening for a close, writes already in flight, and counters that smooth hot paths.
  const closeListeners = new Map(); // sessionId -> Set<fn>
  const lastWrite = new Map(); // sessionId -> ms of the last activity write
  const strikeCounts = new Map(); // sessionId -> strikes seen by this process
  const historyQueue = new Map(); // sessionId -> tail of the in-order history writes
  // Slots reserved by createSession calls that are still starting a sandbox.
  const pending = new Map();
  const claimLatencies = { pool: [], cold: [] };

  const settle = (promise, what, sessionId) => promise.catch((err) => logger.warn({ err: err.message, sessionId }, `could not ${what}`));

  const pendingTotal = () => [...pending.values()].reduce((n, v) => n + v, 0);

  function refreshGauge() {
    settle(registry().count().then((n) => metrics.sandboxesActive.set(n)), 'count sandboxes');
  }

  /** The engine can only operate sandboxes on its own node (a remote engine covers every node). */
  const owns = (row) => (engine.owns ? engine.owns(row.nodeId) : (row.nodeId || nodeId) === nodeId);

  // Admission checks run one at a time in this process, so a burst of starts from one user cannot all
  // pass the limit before any of them is counted. (Across instances the lab nodes enforce their own cap.)
  let admission = Promise.resolve();
  function admit(userId) {
    const run = admission.then(async () => {
      const mine = (await registry().countByUser(userId)) + (pending.get(userId) || 0);
      if (mine >= settings.maxPerUser) {
        throw new SandboxError(`You already have ${settings.maxPerUser} sandboxes running. Stop one first.`, 429);
      }
      // With lab nodes the nodes' own capacity is the limit; otherwise this host's.
      const full = engine.freeSeats
        ? (await engine.freeSeats()) <= 0
        : (await registry().count()) + pendingTotal() >= settings.maxTotal;
      if (full) throw new SandboxError('All sandboxes are in use. Please try again in a few minutes.', 503);
      pending.set(userId, (pending.get(userId) || 0) + 1);
    });
    admission = run.catch(() => {});
    return run;
  }

  function recordLatency(source, ms) {
    const samples = claimLatencies[source];
    samples.push(ms);
    if (samples.length > LATENCY_SAMPLES) samples.shift();
    metrics.sandboxClaimDuration.observe({ source }, ms / 1000);
  }

  /**
   * Start a sandbox for a user.
   * @throws {SandboxError} 429 when the user is at their limit, 503 when the host is full
   */
  async function createSession(userId, labId = 'sandbox', { slotId = null } = {}) {
    await admit(userId);
    const startedAt = process.hrtime.bigint();
    // The reserved slot is held until the session is recorded, so it is never counted twice or not at all.
    const release = () => {
      const left = pending.get(userId) - 1;
      if (left > 0) pending.set(userId, left);
      else pending.delete(userId);
    };
    let acquired;
    try {
      acquired = await pool.acquire({ labId });
    } catch (err) {
      release();
      throw err;
    }

    const claimMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    recordLatency(acquired.fromPool ? 'pool' : 'cold', claimMs);

    const now = Date.now();
    const row = {
      sessionId: randomUUID(),
      engineId: acquired.engineId,
      nodeId: acquired.nodeId || nodeId,
      slotId: slotId || undefined,
      userId,
      labId,
      createdAt: now,
      lastActiveAt: now,
      fromPool: acquired.fromPool,
      claimMs: Math.round(claimMs * 100) / 100,
      history: [],
      strikes: 0,
    };
    try {
      await registry().upsert(row);
    } catch (err) {
      // Without a record nobody could ever find this sandbox again.
      await engine.destroy(row.engineId, where(row)).catch(() => {});
      throw err;
    } finally {
      release();
    }
    lastWrite.set(row.sessionId, now);
    strikeCounts.set(row.sessionId, 0);
    refreshGauge();

    // If the shell or container exits on its own, drop the session too.
    watchExit(row);

    logger.info({ sessionId: row.sessionId, userId, labId, nodeId: row.nodeId, fromPool: row.fromPool, claimMs: row.claimMs }, 'sandbox started');
    return describe(row);
  }

  function watchExit(row) {
    if (engine.onExit) {
      engine.onExit(row.engineId, () => {
        destroySession(row.sessionId, 'exited').catch(() => {});
      });
    }
  }

  function describe(row) {
    const now = Date.now();
    return {
      sessionId: row.sessionId,
      userId: row.userId,
      labId: row.labId,
      nodeId: row.nodeId,
      createdAt: row.createdAt,
      lastActiveAt: row.lastActiveAt,
      idleMs: now - row.lastActiveAt,
      uptime: now - row.createdAt,
      expiresAt: row.createdAt + settings.maxSessionMs,
      idleExpiresAt: row.lastActiveAt + settings.maxIdleMs,
      fromPool: row.fromPool,
      claimMs: row.claimMs,
      ...(owns(row) ? engine.info(row.engineId) : {}),
    };
  }

  async function getSession(sessionId) {
    const row = await registry().get(sessionId);
    return row ? describe(row) : null;
  }

  /** True when the session exists and belongs to this user. */
  async function isOwner(sessionId, userId) {
    const row = await registry().get(sessionId);
    return Boolean(row && row.userId === userId);
  }

  async function listSessions() {
    return (await registry().all()).map(describe);
  }

  /** The user's running sandbox for a lab, if they have one. */
  async function findSession(userId, labId) {
    const row = (await registry().listByUser(userId)).find((r) => r.labId === labId);
    return row ? describe(row) : null;
  }

  /**
   * Record activity. The registry write is throttled per session (the terminal calls this on every
   * keystroke); pass `force` for an explicit "I'm still here". Returns a promise that settles when the write does.
   */
  function touch(sessionId, { force = false } = {}) {
    const now = Date.now();
    if (!force && now - (lastWrite.get(sessionId) || 0) < settings.persistIntervalMs) return Promise.resolve();
    lastWrite.set(sessionId, now);
    return settle(registry().touch(sessionId, now), 'record sandbox activity', sessionId);
  }

  async function destroySession(sessionId, reason = 'stopped') {
    const row = await registry().get(sessionId);
    if (!row) return false;
    if (!owns(row)) throw new SandboxError('This sandbox is running on another node', 503);
    // Deleting the record is the claim: when two instances race to end a session, one wins.
    if (!(await registry().delete(sessionId))) return false;
    lastWrite.delete(sessionId);
    strikeCounts.delete(sessionId);
    refreshGauge();

    const listeners = closeListeners.get(sessionId);
    closeListeners.delete(sessionId);
    if (listeners) for (const listener of listeners) listener(reason);

    await engine.destroy(row.engineId, where(row));
    logger.info({ sessionId, reason }, 'sandbox destroyed');
    return true;
  }

  /** Be told when the session ends on this instance, e.g. to close its terminal sockets. Returns an unsubscribe function. */
  function onClose(sessionId, listener) {
    if (!closeListeners.has(sessionId)) closeListeners.set(sessionId, new Set());
    closeListeners.get(sessionId).add(listener);
    return () => {
      const set = closeListeners.get(sessionId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) closeListeners.delete(sessionId);
    };
  }

  async function requireRow(sessionId) {
    const row = await registry().get(sessionId);
    if (!row) throw new SandboxError('Sandbox session not found', 404);
    if (!owns(row)) throw new SandboxError('This sandbox is running on another node', 503);
    return row;
  }

  /**
   * Run a command in the sandbox. Pass `touch: false` for background reads
   * (the inspector's polling), so an open but unused tab still goes idle.
   */
  async function exec(sessionId, command, { touch: countsAsActivity = true, ...options } = {}) {
    const row = await requireRow(sessionId);
    if (countsAsActivity) touch(sessionId);
    return engine.exec(row.engineId, command, engine.remote ? { ...options, nodeId: row.nodeId } : options);
  }

  async function attach(sessionId) {
    const row = await registry().get(sessionId);
    if (!row || !owns(row)) return null;
    strikeCounts.set(sessionId, Math.max(strikeCounts.get(sessionId) || 0, row.strikes || 0));
    return engine.attach(row.engineId, where(row));
  }

  async function reset(sessionId) {
    const row = await requireRow(sessionId);
    await touch(sessionId, { force: true });
    await settle(registry().clearHistory(sessionId), 'clear command history', sessionId);
    await engine.reset(row.engineId, where(row));
  }

  /**
   * Remember a command in the session's capped history. Written in the background, one at a time per
   * session, so commands typed quickly are stored in the order they were entered.
   */
  function recordCommand(sessionId, command) {
    const entry = { command, at: Date.now() };
    const previous = historyQueue.get(sessionId) || Promise.resolve();
    const next = previous.then(() => settle(registry().appendCommand(sessionId, entry, settings.historyLimit), 'record command', sessionId));
    historyQueue.set(sessionId, next);
    next.then(() => { if (historyQueue.get(sessionId) === next) historyQueue.delete(sessionId); });
  }

  async function getHistory(sessionId) {
    await historyQueue.get(sessionId); // include commands still being written
    const row = await registry().get(sessionId);
    return row ? row.history || [] : [];
  }

  /**
   * Count a blocked command. Returns the running total at once (from this process's count) and
   * reconciles with the registry in the background, so several tabs or instances cannot undercount.
   */
  function addStrike(sessionId) {
    if (!strikeCounts.has(sessionId)) return 0; // not a session this process has created or attached to
    const strikes = (strikeCounts.get(sessionId) || 0) + 1;
    strikeCounts.set(sessionId, strikes);
    settle(registry().addStrike(sessionId).then((stored) => {
      if (stored > (strikeCounts.get(sessionId) || 0)) strikeCounts.set(sessionId, stored);
    }), 'record strike', sessionId);
    return strikes;
  }

  /**
   * Destroy sessions past their maximum age or idle time.
   * @returns {Promise<Array<{ sessionId: string, reason: string }>>}
   */
  async function sweep(now = Date.now()) {
    const reaped = [];
    const expired = await registry().listExpired({ createdBefore: now - settings.maxSessionMs, activeBefore: now - settings.maxIdleMs });
    for (const row of expired) {
      if (!owns(row)) continue;
      const reason = now - row.createdAt > settings.maxSessionMs ? 'max_age' : 'idle';
      await destroySession(row.sessionId, reason).catch((err) => {
        logger.warn({ sessionId: row.sessionId, err: err.message }, 'reaper failed to destroy sandbox');
      });
      metrics.sandboxesReaped.inc({ reason });
      reaped.push({ sessionId: row.sessionId, reason });
    }
    return reaped;
  }

  /** Aggregate numbers that are safe to show publicly (no session ids). Latencies are this instance's own. */
  async function stats() {
    const summarise = (samples) => {
      const sorted = samples.slice().sort((a, b) => a - b);
      const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
      return { samples: sorted.length, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)) };
    };
    return {
      mode: engine.name,
      activeSessions: await registry().count(),
      capacity: engine.totalCapacity ? await engine.totalCapacity() : settings.maxTotal,
      pool: pool.stats(),
      claimLatencyMs: { pool: summarise(claimLatencies.pool), cold: summarise(claimLatencies.cold) },
    };
  }

  /**
   * Start-up: let the engine find what it still runs, then make the registry and the engine agree for
   * this node's sessions. Records of sessions that expired or whose sandbox died are dropped.
   */
  async function init() {
    if (engine.reconcile) {
      await engine.reconcile().catch((err) => {
        logger.warn({ err: err.message }, 'could not reconcile running sandboxes');
      });
    }

    const keepEngineIds = new Set();
    try {
      const now = Date.now();
      let kept = 0;
      for (const row of await registry().all()) {
        if (!owns(row)) continue;
        const isExpired = (now - row.createdAt > settings.maxSessionMs) || (now - row.lastActiveAt > settings.maxIdleMs);
        const alive = engine.isAlive ? engine.isAlive(row.engineId) : true;
        if (!isExpired && alive) {
          keepEngineIds.add(row.engineId);
          watchExit(row);
          kept += 1;
        } else {
          if (engine.destroy && alive) await engine.destroy(row.engineId).catch(() => {});
          await registry().delete(row.sessionId);
        }
      }
      if (kept > 0) logger.info({ count: kept }, 'kept active student sessions after restart');
    } catch (err) {
      logger.warn({ err: err.message }, 'could not restore sessions from store');
    }
    refreshGauge();

    if (engine.cleanupOrphans) {
      const cleaned = await engine.cleanupOrphans({ keepEngineIds }).catch((err) => {
        logger.warn({ err: err.message }, 'could not clean up orphaned sandboxes');
        return null;
      });
      if (cleaned && Object.values(cleaned).some(Boolean)) logger.info(cleaned, 'removed orphaned sandboxes');
    }
    await pool.replenish();
  }

  /**
   * Stop this process. A gateway using lab nodes owns no sandboxes, so students keep theirs through a
   * gateway restart; an engine that runs sandboxes in this process ends its own, and empties its pool.
   */
  async function shutdown() {
    if (!engine.remote) {
      for (const row of await registry().all().catch(() => [])) {
        if (owns(row)) await destroySession(row.sessionId, 'shutdown').catch(() => {});
      }
    }
    await pool.drain();
  }

  return {
    init,
    shutdown,
    createSession,
    getSession,
    isOwner,
    listSessions,
    findSession,
    touch,
    destroySession,
    onClose,
    exec,
    attach,
    reset,
    recordCommand,
    getHistory,
    addStrike,
    sweep,
    stats,
    replenishPool: () => pool.replenish(),
    getMode: () => engine.name,
    isRemote: Boolean(engine.remote),
  };
}

let defaultManager = null;

/** The process-wide manager, created on first use. */
function getManager() {
  if (!defaultManager) defaultManager = createManager();
  return defaultManager;
}

/** Replace the shared manager (tests). */
function setManager(manager) {
  defaultManager = manager;
}

module.exports = { createManager, getManager, setManager, SandboxError };
