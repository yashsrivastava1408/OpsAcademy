/**
 * OpsAcademy API Gateway
 *
 * Express server with WebSocket support for terminal streaming.
 * Manages sandbox lifecycles (PTY or Docker mode) and lab orchestration.
 */

const http = require('http');
const config = require('./config');
const logger = require('./lib/logger');
const { createApp } = require('./app');
const { getRepos } = require('./repositories');
const { startJobs } = require('./jobs/maintenance');
const { getManager } = require('./services/sandboxManager');
const { attachTerminalWebSocket } = require('./services/terminalService');
const { startReaper, stopReaper } = require('./services/reaperService');

const SHUTDOWN_TIMEOUT_MS = 10000;

async function start() {
  const role = config.serviceRole;
  // Never serve a request before the keys and the database are reachable.
  await require('./lib/supabaseAuth').ready();
  const repos = getRepos();
  try {
    await repos.ping();
  } catch (err) {
    logger.error({ err: err.message }, 'database is not reachable; refusing to start');
    process.exit(1);
  }
  if (config.isProd && repos.driver !== 'postgres') {
    logger.error('Production needs DATABASE_URL (Postgres). Refusing to start on the in-memory store.');
    process.exit(1);
  }
  const manager = getManager();
  let stopJobs = () => {};
  let app = null;
  let server = null;
  let wss = null;

  if (role === 'terminal') {
    server = http.createServer((req, res) => {
      if (req.url === '/health' || req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok', service: 'opsacademy-terminal', uptime: process.uptime() }));
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Terminal service only. Connect via WebSocket to /api/terminal');
    });
    wss = attachTerminalWebSocket(server, manager);
    logger.info({ port: config.port, role }, 'OpsAcademy Terminal Service starting');
  } else {
    app = createApp();
    server = http.createServer(app);
    if (role === 'all') {
      wss = attachTerminalWebSocket(server, manager);
    }
  }

  if (role !== 'terminal') {
    startReaper(manager);
    // With Postgres a separate worker process does the housekeeping; without it (local
    // development, in-memory) there is only this process.
    if (repos.driver !== 'postgres') stopJobs = startJobs();
  }

  if (config.isProd && config.sandboxMode === 'pty') {
    logger.warn('SANDBOX_MODE=pty gives students a shell on this host with no isolation. Use SANDBOX_MODE=docker for untrusted users.');
  }

  manager.init().catch((err) => logger.warn({ err: err.message }, 'sandbox pool did not initialise'));

  server.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, role, sandboxMode: config.sandboxMode, env: config.env }, 'OpsAcademy service listening');
  });

  // Stop taking requests, destroy every sandbox, flush the store, then exit.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal, role }, 'shutting down');

    const force = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    force.unref();

    if (role !== 'terminal') stopReaper();
    server.close();
    if (wss) {
      for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    }
    await manager.shutdown().catch((err) => logger.warn({ err: err.message }, 'error destroying sandboxes'));
    stopJobs();
    await repos.close().catch(() => {});
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server, wss };
}

if (require.main === module) {
  start().catch((err) => {
    logger.error({ err: err.message }, 'failed to start');
    process.exit(1);
  });
}

module.exports = { start };
