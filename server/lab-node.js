/**
 * Lab node agent entry point: `node lab-node.js` on each lab server.
 * Needs NODE_TOKEN, NODE_BASE_URL (how the gateway reaches this server) and GATEWAY_URL (for heartbeats).
 * See docs/adr/0005-lab-nodes-session-registry-terminal-routing.md.
 */
process.env.LAB_NODE = 'on';
const config = require('./config');
const logger = require('./lib/logger');
const { createAgent } = require('./lab-node/agent');

async function main() {
  const engine = config.node.engine === 'pty' ? require('./services/ptyService') : require('./services/dockerService');
  if (config.isProd && engine.name === 'pty') {
    logger.warn('NODE_ENGINE=pty gives students a shell on this host with no isolation. Use docker.');
  }
  if (!config.node.gatewayUrl) logger.warn('GATEWAY_URL is not set: this node will not announce itself to a gateway');

  const agent = createAgent({
    engine,
    settings: {
      nodeId: config.nodeId,
      token: config.node.token,
      port: config.node.port,
      baseUrl: config.node.baseUrl,
      capacity: config.node.capacity,
      gatewayUrl: config.node.gatewayUrl,
      heartbeatMs: config.node.heartbeatMs,
      poolSize: config.sandbox.poolSize,
      poolEnabled: config.sandbox.enablePool,
    },
  });
  await agent.start();

  const shutdown = async (signal) => {
    logger.info({ signal }, 'lab node draining');
    await agent.drain();
    await agent.stop().catch(() => {});
    process.exit(0); // running sandboxes stay up; the gateway's reconciliation owns them
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err.message }, 'lab node failed to start');
  process.exit(1);
});
