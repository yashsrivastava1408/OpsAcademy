/**
 * Sandbox Pool Service — Pre-Warmed Container Standby Engine
 * 
 * Maintains a pool of pre-warmed idle sandboxes in the background.
 * Provides instant (<50ms) sandbox acquisition when users click "Run" or open a lab.
 */

const config = require('../config');
const crypto = require('crypto');

// Array of standby pre-warmed sandboxes: Array<{ standbyId, engineSession, createdAt }>
const standbyPool = [];
let isReplenishing = false;
let engineRef = null;

function setEngine(engine) {
  engineRef = engine;
}

/**
 * Initialize pre-warmed sandbox pool on server startup
 */
async function initializePool(engine) {
  if (engine) engineRef = engine;
  if (!config.sandbox.enablePool) {
    console.log('[SandboxPool] Standby pool disabled via config.');
    return;
  }

  console.log(`[SandboxPool] Initializing standby pool (Target size: ${config.sandbox.poolSize})...`);
  await replenishPool();
}

/**
 * Replenish the standby pool up to config.sandbox.poolSize
 */
async function replenishPool() {
  if (!engineRef || isReplenishing || !config.sandbox.enablePool) return;

  const needed = config.sandbox.poolSize - standbyPool.length;
  if (needed <= 0) return;

  isReplenishing = true;

  try {
    for (let i = 0; i < needed; i++) {
      const standbyId = `pool-${crypto.randomBytes(4).toString('hex')}`;
      try {
        const session = await engineRef.createSandbox(standbyId, 'standby-user', 'standby-lab');
        standbyPool.push({
          standbyContainerId: session.containerId || standbyId,
          sessionId: standbyId,
          session,
          createdAt: Date.now(),
        });
        console.log(`[SandboxPool] Pre-warmed sandbox ready: ${standbyId}`);
      } catch (err) {
        console.warn(`[SandboxPool] Failed to create standby sandbox:`, err.message);
        break; // Stop loop if Docker or PTY engine fails
      }
    }
  } finally {
    isReplenishing = false;
  }
}

/**
 * Acquire a sandbox from the pool (or fallback to on-demand creation)
 */
async function acquireSandbox(sessionId, userId, labId, createOnDemandFn) {
  const startTime = Date.now();

  // Try claiming from standby pool
  if (config.sandbox.enablePool && standbyPool.length > 0) {
    const standbyItem = standbyPool.shift();
    console.log(`[SandboxPool] ⚡ Instant claim from pool for session ${sessionId} (Latency: ${Date.now() - startTime}ms)`);

    // Re-assign session metadata
    const session = standbyItem.session;
    session.sessionId = sessionId;
    session.userId = userId;
    session.labId = labId;
    session.claimedAt = Date.now();
    session.lastActiveAt = Date.now();

    // Trigger async pool replenishment
    setImmediate(() => replenishPool());

    return {
      session,
      claimedFromPool: true,
      latencyMs: Date.now() - startTime,
    };
  }

  // Fallback to on-demand creation if pool is empty or disabled
  console.log(`[SandboxPool] Pool empty/disabled. Creating sandbox on-demand for ${sessionId}...`);
  const session = await createOnDemandFn(sessionId, userId, labId);
  session.claimedAt = Date.now();
  session.lastActiveAt = Date.now();

  // Trigger pool replenishment asynchronously
  setImmediate(() => replenishPool());

  return {
    session,
    claimedFromPool: false,
    latencyMs: Date.now() - startTime,
  };
}

/**
 * Return current pool telemetry metrics
 */
function getPoolStats() {
  return {
    enabled: config.sandbox.enablePool,
    targetPoolSize: config.sandbox.poolSize,
    availableStandby: standbyPool.length,
    isReplenishing,
  };
}

/**
 * Clear and destroy all standby sandboxes (used during server shutdown)
 */
async function clearPool(destroyFn) {
  console.log(`[SandboxPool] Clearing ${standbyPool.length} standby sandboxes...`);
  while (standbyPool.length > 0) {
    const item = standbyPool.pop();
    if (destroyFn) {
      await destroyFn(item.sessionId).catch(() => {});
    }
  }
}

module.exports = {
  setEngine,
  initializePool,
  replenishPool,
  acquireSandbox,
  getPoolStats,
  clearPool,
};
