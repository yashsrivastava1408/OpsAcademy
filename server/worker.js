/**
 * Background worker process: housekeeping that must not run inside every
 * gateway replica (pruning expired guests and tokens, refreshing the
 * per-college leaderboards). Run it next to the gateway:
 *
 *   node worker.js
 */

const logger = require('./lib/logger');
const config = require('./config');
const { getRepos } = require('./repositories');
const { startJobs } = require('./jobs/maintenance');

async function main() {
  const repos = getRepos();
  if (repos.driver !== 'postgres') {
    logger.error('The worker needs DATABASE_URL (Postgres); the in-memory store is per process.');
    process.exit(1);
  }
  await repos.ping();
  const stop = startJobs();
  logger.info({ env: config.env }, 'OpsAcademy worker started');

  let stopping = false;
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'worker shutting down');
    stop();
    await repos.close().catch(() => {});
    process.exit(0);
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err.message }, 'worker failed to start');
  process.exit(1);
});
