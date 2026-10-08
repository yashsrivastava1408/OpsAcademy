/**
 * PTY engine — local shell sandbox
 *
 * Spawns one shell per sandbox via node-pty, in its own working directory.
 * Used when SANDBOX_MODE=pty (local development and demos).
 *
 * A PTY shell runs as the gateway's own OS user: it is NOT isolated from the
 * host. Never expose PTY mode to untrusted users — use SANDBOX_MODE=docker.
 *
 * Implements the engine interface shared with dockerService.js:
 *   create, destroy, isAlive, exec, attach, reset, onExit, info
 */

const pty = require('node-pty');
const path = require('path');
const fs = require('fs');
const { exec: execChild } = require('child_process');
const config = require('../config');
const logger = require('../lib/logger');

const STUDENT_HOME = '/home/student';
const SYSTEM_PATH = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
// The lab simulators come first, so `docker` in a lab is the simulator even
// on a machine that has the real one installed.
const SANDBOX_PATH = fs.existsSync(config.sandbox.toolsDir) ? `${config.sandbox.toolsDir}:${SYSTEM_PATH}` : SYSTEM_PATH;
const SCROLLBACK_CHARS = 16 * 1024;

// Map<engineId, { pty, cwd, sessionDir, alive, exitListeners }>
const sandboxes = new Map();

// PTY shells all share this machine's network ports, so two students who
// both start a web server on 8080 would collide. Each shell is given its own
// block of ports instead; a block goes back in the pool when its shell ends.
const PORT_BLOCK_SIZE = 10;
const portBlocksInUse = new Set();

function claimPortBlock() {
  let block = 0;
  while (portBlocksInUse.has(block)) block += 1;
  portBlocksInUse.add(block);
  return block;
}

/** The lab port variables for a block: the same names a container gets, different numbers. */
function labPortEnv(block) {
  const env = {};
  Object.keys(config.sandbox.labPorts).forEach((name, index) => {
    env[name] = String(config.sandbox.ptyPortBase + block * PORT_BLOCK_SIZE + index);
  });
  return env;
}

/**
 * Start each shell without the host's startup files and with the lab prompt,
 * so the terminal shows `student@opsacademy` rather than the machine's own
 * user and host name.
 */
function shellProfile(shell) {
  const name = path.basename(shell);
  if (name === 'zsh') {
    return { args: ['-f'], promptEnv: { PROMPT: '%B%F{cyan}student@opsacademy%f%b:%B%F{blue}%~%f%b$ ' } };
  }
  if (name === 'bash') {
    return {
      args: ['--norc', '--noprofile'],
      promptEnv: { PS1: '\\[\\033[1;36m\\]student@opsacademy\\[\\033[0m\\]:\\[\\033[1;34m\\]\\w\\[\\033[0m\\]$ ' },
    };
  }
  return { args: [], promptEnv: { PS1: 'student@opsacademy$ ' } };
}

function create(engineId, { labId } = {}) {
  const sessionDir = path.join(config.sandbox.sandboxesDir, engineId);
  fs.mkdirSync(path.join(sessionDir, 'home', 'student'), { recursive: true });
  // Resolve symlinks (e.g. /var -> /private/var on macOS) so the path the
  // shell reports is the same one mapStudentHome substitutes.
  const studentHome = fs.realpathSync(path.join(sessionDir, 'home', 'student'));

  const shell = config.sandbox.defaultShell;
  const { args, promptEnv } = shellProfile(shell);
  const portBlock = claimPortBlock();
  const labEnv = labPortEnv(portBlock);
  const ptyProcess = pty.spawn(shell, args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: studentHome,
    env: {
      // Minimal environment: nothing from the gateway's own env is inherited.
      HOME: studentHome,
      USER: 'student',
      TERM: 'xterm-256color',
      PATH: SANDBOX_PATH,
      SHELL: shell,
      ...promptEnv,
      LANG: 'en_US.UTF-8',
      LAB_ID: labId || 'sandbox',
      ...labEnv,
    },
  });

  const sandbox = { pty: ptyProcess, cwd: studentHome, sessionDir, alive: true, exitListeners: [], scrollback: '', portBlock, labEnv };
  // Keep the tail of the output so a terminal that attaches later (a
  // pre-warmed shell, or a page reload) is shown the prompt and recent lines.
  ptyProcess.onData((data) => {
    sandbox.scrollback = (sandbox.scrollback + data).slice(-SCROLLBACK_CHARS);
  });
  ptyProcess.onExit(() => {
    sandbox.alive = false;
    for (const listener of sandbox.exitListeners) listener();
  });

  sandboxes.set(engineId, sandbox);
  logger.debug({ engineId }, '[PTY] sandbox created');
  return Promise.resolve();
}

const EXIT_WAIT_MS = 2000;

/**
 * Kill the shell and remove its directory. The directory is removed only
 * after the shell has exited: a shell that is still shutting down can write
 * into its home (zsh saves history on exit) and leave the folder behind.
 */
async function destroy(engineId) {
  const sandbox = sandboxes.get(engineId);
  if (!sandbox) return false;
  sandboxes.delete(engineId);
  sandbox.exitListeners = [];
  portBlocksInUse.delete(sandbox.portBlock);

  if (sandbox.alive) {
    const exited = new Promise((resolve) => {
      sandbox.exitListeners.push(resolve);
      setTimeout(resolve, EXIT_WAIT_MS).unref();
    });
    try {
      sandbox.pty.kill();
    } catch (err) {
      logger.warn({ engineId, err: err.message }, '[PTY] error killing shell');
    }
    await exited;
  }

  try {
    await fs.promises.rm(sandbox.sessionDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } catch (err) {
    logger.warn({ engineId, err: err.message }, '[PTY] error cleaning directory');
  }

  return true;
}

function isAlive(engineId) {
  const sandbox = sandboxes.get(engineId);
  return Boolean(sandbox && sandbox.alive);
}

/** Register a callback for when the shell exits on its own (e.g. the student typed `exit`). */
function onExit(engineId, listener) {
  const sandbox = sandboxes.get(engineId);
  if (sandbox) sandbox.exitListeners.push(listener);
}

/**
 * Labs are written against the container layout, where the student's home
 * is /home/student. In PTY mode that home is a per-session directory, so
 * point those paths at it.
 */
function mapStudentHome(command, cwd) {
  return command.split(STUDENT_HOME).join(cwd);
}

/**
 * Run a command in the sandbox's working directory and capture its output.
 * Used for lab verification and telemetry.
 */
function exec(engineId, command, { timeoutMs = config.sandbox.execTimeoutMs } = {}) {
  const sandbox = sandboxes.get(engineId);
  if (!sandbox) return Promise.reject(new Error('Sandbox not found'));

  return new Promise((resolve) => {
    execChild(
      mapStudentHome(command, sandbox.cwd),
      {
        cwd: sandbox.cwd,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        shell: '/bin/sh',
        // The lab checks need the same port numbers the student's shell has.
        env: { HOME: sandbox.cwd, PATH: SANDBOX_PATH, ...sandbox.labEnv },
      },
      (err, stdout, stderr) => {
        resolve({
          exitCode: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          stdout: mapHomeBack(String(stdout), sandbox.cwd),
          stderr: String(stderr),
        });
      }
    );
  });
}

/** Show the student's home as /home/student in captured output, matching the labs. */
function mapHomeBack(output, cwd) {
  return output.split(cwd).join(STUDENT_HOME);
}

/**
 * Attach a terminal to the sandbox shell. Several terminals may attach to
 * the same shell (e.g. after a page reload).
 */
function attach(engineId) {
  const sandbox = sandboxes.get(engineId);
  if (!sandbox || !sandbox.alive) return Promise.resolve(null);

  const disposables = [];
  return Promise.resolve({
    onData(callback) {
      if (sandbox.scrollback) callback(sandbox.scrollback);
      disposables.push(sandbox.pty.onData(callback));
    },
    write(data) {
      if (sandbox.alive) sandbox.pty.write(data);
    },
    resize(cols, rows) {
      if (sandbox.alive) sandbox.pty.resize(cols, rows);
    },
    close() {
      for (const disposable of disposables) disposable.dispose();
    },
  });
}

/** Wipe the student's home directory so the lab can be started over. */
function reset(engineId) {
  const sandbox = sandboxes.get(engineId);
  if (!sandbox) return Promise.reject(new Error('Sandbox not found'));

  for (const entry of fs.readdirSync(sandbox.cwd)) {
    fs.rmSync(path.join(sandbox.cwd, entry), { recursive: true, force: true });
  }
  sandbox.scrollback = '';
  if (sandbox.alive) sandbox.pty.write('\x03cd ~ && clear\r');
  return Promise.resolve();
}

function info() {
  return { mode: 'pty' };
}

/** The lab port variables of one sandbox (tests). */
function labEnvOf(engineId) {
  const sandbox = sandboxes.get(engineId);
  return sandbox ? { ...sandbox.labEnv } : null;
}

/** Remove working directories left behind by a previous gateway process. */
function cleanupOrphans() {
  const dir = config.sandbox.sandboxesDir;
  if (!fs.existsSync(dir)) return Promise.resolve({ directories: 0 });

  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    if (sandboxes.has(entry)) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    removed += 1;
  }
  return Promise.resolve({ directories: removed });
}

module.exports = { name: 'pty', create, destroy, isAlive, onExit, exec, attach, reset, info, cleanupOrphans, mapStudentHome, labEnvOf };
