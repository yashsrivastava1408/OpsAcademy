/**
 * Docker Service — Container-based sandbox engine
 * 
 * Spawns isolated Alpine Linux containers via dockerode.
 * Used when SANDBOX_MODE=docker (VPS with Docker socket access).
 * 
 * Provides the same interface as ptyService.js for seamless swapping.
 */

const Docker = require('dockerode');
const config = require('../config');

let docker;
try {
  docker = new Docker({ socketPath: config.dockerSocketPath });
} catch (err) {
  console.warn('[Docker] Docker not available:', err.message);
}

// Active containers: Map<sessionId, { containerId, createdAt, userId, labId }>
const activeSessions = new Map();

/**
 * Create a new Docker sandbox container
 */
async function createSandbox(sessionId, userId, labId) {
  if (!docker) throw new Error('Docker is not available. Switch to SANDBOX_MODE=pty');

  const container = await docker.createContainer({
    Image: config.sandbox.dockerImage,
    Cmd: ['/bin/sh'],
    Tty: true,
    OpenStdin: true,
    Labels: {
      'opsacademy.session': sessionId,
      'opsacademy.user': userId,
      'opsacademy.lab': labId || 'sandbox',
    },
    HostConfig: {
      Memory: config.sandbox.maxMemoryMB * 1024 * 1024,
      NanoCpus: config.sandbox.maxCpuCores * 1e9,
      NetworkMode: config.sandbox.dockerNetwork,
      SecurityOpt: ['no-new-privileges:true'],
      ReadonlyRootfs: true,
      Mounts: [
        {
          Target: '/home/student',
          Source: `student-vol-${sessionId}`,
          Type: 'volume',
          ReadOnly: false,
        },
        {
          Target: '/tmp',
          Type: 'tmpfs',
          TmpfsOptions: { SizeBytes: 64 * 1024 * 1024 }, // 64MB tmpfs
        },
      ],
    },
  });

  await container.start();

  const session = {
    containerId: container.id,
    container,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    userId,
    labId,
  };

  activeSessions.set(sessionId, session);
  console.log(`[Docker] Created container ${container.id.slice(0, 12)} for session ${sessionId}`);
  return session;
}

/**
 * Touch session activity timestamp
 */
function touchSession(sessionId) {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.lastActiveAt = Date.now();
  }
}

/**
 * Destroy a Docker sandbox container
 */
async function destroySandbox(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  try {
    const container = docker.getContainer(session.containerId);
    await container.stop({ t: 2 }).catch(() => {}); // Ignore if already stopped
    await container.remove({ force: true });
  } catch (err) {
    console.warn(`[Docker] Error removing container for ${sessionId}:`, err.message);
  }

  activeSessions.delete(sessionId);
  console.log(`[Docker] Destroyed sandbox ${sessionId}`);
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
    containerId: session.containerId,
    mode: 'docker',
  };
}

/**
 * Get a Docker exec stream for terminal piping
 * Returns an object with .on('data'), .write(), .resize() methods
 */
async function getContainerStream(sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  const container = docker.getContainer(session.containerId);
  
  const exec = await container.exec({
    Cmd: ['/bin/sh'],
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Tty: true,
  });

  const stream = await new Promise((resolve, reject) => {
    exec.start({ hijack: true, stdin: true }, (err, s) => {
      if (err) return reject(err);
      resolve(s);
    });
  });

  return { stream, exec };
}

/**
 * Resize the container terminal
 */
async function resizeSandbox(sessionId, cols, rows) {
  // Docker resize happens on the exec instance, handled in terminal service
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
      containerId: session.containerId,
      mode: 'docker',
    });
  }
  return list;
}

/**
 * Execute a command inside a container and return output
 * Used for lab verification
 */
async function execInSandbox(sessionId, command) {
  const session = activeSessions.get(sessionId);
  if (!session) throw new Error('Sandbox not found');

  session.lastActiveAt = Date.now();
  const container = docker.getContainer(session.containerId);
  const exec = await container.exec({
    Cmd: ['/bin/sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    exec.start((err, stream) => {
      if (err) return reject(err);
      
      let stdout = '';
      let stderr = '';
      
      stream.on('data', (chunk) => { stdout += chunk.toString(); });
      stream.on('end', () => {
        exec.inspect((err, data) => {
          resolve({
            exitCode: data ? data.ExitCode : 1,
            stdout,
            stderr,
          });
        });
      });
    });
  });
}

module.exports = {
  createSandbox,
  destroySandbox,
  getSandbox,
  getContainerStream,
  resizeSandbox,
  listSandboxes,
  execInSandbox,
  touchSession,
};
