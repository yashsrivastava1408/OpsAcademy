/**
 * Sandbox Manager — Pluggable facade for sandbox engines
 * 
 * Delegates to ptyService or dockerService based on SANDBOX_MODE env var.
 * This is the only module that routes/services should import for sandbox operations.
 */

const config = require('../config');
const sandboxPoolService = require('./sandboxPoolService');

// Lazy-load the appropriate service based on mode
let engine;

function getEngine() {
  if (engine) return engine;

  if (config.sandboxMode === 'docker') {
    engine = require('./dockerService');
    console.log('[SandboxManager] Using Docker mode 🐳');
  } else {
    engine = require('./ptyService');
    console.log('[SandboxManager] Using PTY mode 💻');
  }

  // Bind pool engine reference
  sandboxPoolService.setEngine(engine);

  return engine;
}

/**
 * Initialize pre-warmed pool on manager startup
 */
async function initPool() {
  const eng = getEngine();
  await sandboxPoolService.initializePool(eng);
}

/**
 * Create a new sandbox session (via pool or fallback)
 */
async function createSandbox(sessionId, userId, labId) {
  const eng = getEngine();
  const result = await sandboxPoolService.acquireSandbox(
    sessionId,
    userId,
    labId,
    (sId, uId, lId) => eng.createSandbox(sId, uId, lId)
  );

  return result.session;
}

/**
 * Update session last-active timestamp
 */
function touchSession(sessionId) {
  const eng = getEngine();
  if (eng.touchSession) {
    eng.touchSession(sessionId);
  }
}

/**
 * Destroy a sandbox session
 */
async function destroySandbox(sessionId) {
  return getEngine().destroySandbox(sessionId);
}

/**
 * Get sandbox info
 */
function getSandbox(sessionId) {
  return getEngine().getSandbox(sessionId);
}

/**
 * List all active sandboxes
 */
function listSandboxes() {
  return getEngine().listSandboxes();
}

/**
 * Execute a command in a sandbox (for lab verification)
 */
async function execInSandbox(sessionId, command) {
  return getEngine().execInSandbox(sessionId, command);
}

/**
 * Get the underlying PTY process (PTY mode only)
 */
function getPtyProcess(sessionId) {
  if (config.sandboxMode !== 'pty') return null;
  return getEngine().getPtyProcess(sessionId);
}

/**
 * Get the Docker container stream (Docker mode only)
 */
async function getContainerStream(sessionId) {
  if (config.sandboxMode !== 'docker') return null;
  return getEngine().getContainerStream(sessionId);
}

/**
 * Resize sandbox terminal
 */
function resizeSandbox(sessionId, cols, rows) {
  return getEngine().resizeSandbox(sessionId, cols, rows);
}

/**
 * Get the current sandbox mode
 */
function getMode() {
  return config.sandboxMode;
}

/**
 * Get pre-warmed pool metrics
 */
function getPoolStats() {
  return sandboxPoolService.getPoolStats();
}

// Auto-initialize pool asynchronously
setImmediate(() => {
  initPool().catch((err) => console.warn('[SandboxManager] Pool init warning:', err.message));
});

module.exports = {
  createSandbox,
  destroySandbox,
  getSandbox,
  listSandboxes,
  execInSandbox,
  getPtyProcess,
  getContainerStream,
  resizeSandbox,
  getMode,
  touchSession,
  getPoolStats,
  initPool,
};
