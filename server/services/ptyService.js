/**
 * PTY Service — Local shell sandbox engine
 * 
 * Spawns restricted /bin/sh processes via node-pty for each student session.
 * Used when SANDBOX_MODE=pty (local dev + Render deployment).
 * 
 * Provides the same interface as dockerService.js for seamless swapping.
 */

const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Active PTY processes: Map<sessionId, { pty, createdAt, userId, labId, cwd }>
const activeSessions = new Map();

/**
 * Create a new PTY sandbox session
 */
function createSandbox(sessionId, userId, labId) {
  // Create isolated working directory for this session
  const sessionDir = path.join(config.sandbox.sandboxesDir, sessionId);
  const studentHome = path.join(sessionDir, 'home', 'student');
  
  fs.mkdirSync(studentHome, { recursive: true });

  // Spawn a restricted shell process
  const shell = config.sandbox.defaultShell;
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: studentHome,
    env: {
      // Minimal, restricted environment
      HOME: studentHome,
      USER: 'student',
      TERM: 'xterm-256color',
      PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      SHELL: shell,
      PS1: '\\[\\033[1;36m\\]student@opsacademy\\[\\033[0m\\]:\\[\\033[1;34m\\]\\w\\[\\033[0m\\]$ ',
      LANG: 'en_US.UTF-8',
      // Lab context
      LAB_ID: labId || 'sandbox',
      SESSION_ID: sessionId,
    },
  });

  const session = {
    pty: ptyProcess,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    userId,
    labId,
    cwd: studentHome,
    sessionDir,
  };

  activeSessions.set(sessionId, session);

  console.log(`[PTY] Created sandbox ${sessionId} for user ${userId} (lab: ${labId})`);
  return session;
}

/**
 * Update last active timestamp on session activity
 */
function touchSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastActiveAt = Date.now();
  }
}

/**
 * Destroy a PTY sandbox session
 */
function destroySandbox(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  // Kill the PTY process
  try {
    session.pty.kill();
  } catch (err) {
    console.warn(`[PTY] Error killing process for ${sessionId}:`, err.message);
  }

  // Clean up the session directory
  try {
    fs.rmSync(session.sessionDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`[PTY] Error cleaning dir for ${sessionId}:`, err.message);
  }

  activeSessions.delete(sessionId);
  console.log(`[PTY] Destroyed sandbox ${sessionId}`);
  return true;
}

/**
 * Get sandbox session info
 */
function getSandbox(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return null;
  
  const now = Date.now();
  return {
    sessionId,
    userId: session.userId,
    labId: session.labId,
    createdAt: session.createdAt,
    lastActiveAt: session.lastActiveAt || session.createdAt,
    idleMs: now - (session.lastActiveAt || session.createdAt),
    uptime: now - session.createdAt,
    mode: 'pty',
  };
}

/**
 * Get the raw PTY process for terminal piping
 */
function getPtyProcess(sessionId) {
  const session = activeSessions.get(sessionId);
  return session ? session.pty : null;
}

/**
 * Resize the PTY terminal
 */
function resizeSandbox(sessionId, cols, rows) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.pty.resize(cols, rows);
  }
}

/**
 * List all active sandbox sessions
 */
function listSandboxes() {
  const list = [];
  const now = Date.now();
  for (const [sessionId, session] of activeSessions) {
    list.push({
      sessionId,
      userId: session.userId,
      labId: session.labId,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt || session.createdAt,
      idleMs: now - (session.lastActiveAt || session.createdAt),
      uptime: now - session.createdAt,
      mode: 'pty',
    });
  }
  return list;
}

/**
 * Execute a command inside a sandbox and return output
 * Used for lab verification
 */
function execInSandbox(sessionId, command) {
  return new Promise((resolve, reject) => {
    const session = activeSessions.get(sessionId);
    if (!session) return reject(new Error('Sandbox not found'));

    session.lastActiveAt = Date.now();
    const { exec } = require('child_process');
    exec(command, { 
      cwd: session.cwd,
      timeout: 10000,
      env: {
        HOME: session.cwd,
        PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',
      }
    }, (err, stdout, stderr) => {
      resolve({
        exitCode: err ? err.code || 1 : 0,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      });
    });
  });
}

module.exports = {
  createSandbox,
  destroySandbox,
  getSandbox,
  getPtyProcess,
  resizeSandbox,
  listSandboxes,
  execInSandbox,
  touchSession,
};
