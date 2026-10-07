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
const { getStore } = require('./lib/store');
const { getManager } = require('./services/sandboxManager');
const { attachTerminalWebSocket } = require('./services/terminalService');
const { startReaper, stopReaper } = require('./services/reaperService');

const SHUTDOWN_TIMEOUT_MS = 10000;

function start() {
  const app = createApp();
  const server = http.createServer(app);
  const manager = getManager();

  const wss = attachTerminalWebSocket(server, manager);
  startReaper(manager);

  if (config.isProd && config.sandboxMode === 'pty') {
    logger.warn('SANDBOX_MODE=pty gives students a shell on this host with no isolation. Use SANDBOX_MODE=docker for untrusted users.');
  }

  manager.init().catch((err) => logger.warn({ err: err.message }, 'sandbox pool did not initialise'));

  server.listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port, sandboxMode: config.sandboxMode, env: config.env }, 'OpsAcademy API Gateway listening');
  });

  // Stop taking requests, destroy every sandbox, flush the store, then exit.
  let shuttingDown = false;
  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');

    const force = setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS);
    force.unref();

    stopReaper();
    server.close();
    for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
    await manager.shutdown().catch((err) => logger.warn({ err: err.message }, 'error destroying sandboxes'));
    getStore().flush();
    process.exit(0);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  return { app, server };
}

if (require.main === module) {
  start();
}

module.exports = { start };
