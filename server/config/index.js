const path = require('path');
const os = require('os');

// Load .env file
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const config = {
  port: parseInt(process.env.PORT, 10) || 4000,

  // 'pty' = local shell via node-pty | 'docker' = Docker containers via dockerode
  sandboxMode: process.env.SANDBOX_MODE || 'pty',

  // JWT
  jwtSecret: process.env.JWT_SECRET || (() => {
    console.warn('\x1b[33m⚠  WARNING: JWT_SECRET not set! Using insecure default for development only.\x1b[0m');
    return 'dev-only-insecure-default-do-not-use-in-production';
  })(),
  jwtExpiry: '24h',

  // AI Hub
  aiHubUrl: process.env.AI_HUB_URL || 'http://localhost:5000',

  // Docker socket (auto-detect macOS vs Linux)
  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || (
    os.platform() === 'darwin'
      ? '/var/run/docker.sock'
      : '/var/run/docker.sock'
  ),

  // CORS
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  // Sandbox settings
  sandbox: {
    maxMemoryMB: 256,
    maxCpuCores: 0.5,
    maxSessionMinutes: 30,
    maxInactivityMinutes: 15,
    poolSize: parseInt(process.env.SANDBOX_POOL_SIZE, 10) || 3,
    enablePool: process.env.ENABLE_SANDBOX_POOL !== 'false',
    reaperIntervalMs: 5 * 60 * 1000, // 5 minutes
    sandboxesDir: path.join(__dirname, '..', 'sandboxes'),
    defaultShell: os.platform() === 'darwin' ? '/bin/zsh' : '/bin/sh',
    dockerImage: 'alpine-devops-sandbox:latest',
    dockerNetwork: 'isolated-student-net',
  },

  // MongoDB (Phase 2)
  mongoUri: process.env.MONGO_URI || null,
};

module.exports = config;
