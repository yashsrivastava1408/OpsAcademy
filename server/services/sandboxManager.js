/**
 * Sandbox Manager — Pluggable facade for sandbox engines
 * 
 * Delegates to ptyService or dockerService based on SANDBOX_MODE env var.
 * This is the only module that routes/services should import for sandbox operations.
 */

const config = require('../config');

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

  return engine;
}

/**
 * Create a new sandbox session
 */
async function createSandbox(sessionId, userId, labId) {
  return getEngine().createSandbox(sessionId, userId, labId);
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
};
