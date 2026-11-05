/**
 * Scheduled housekeeping. Each job takes a named database lock, so running
 * several workers (or the gateway and a worker) never does the same job twice.
 */

const logger = require('../lib/logger');
const { getRepos } = require('../repositories');
const userService = require('../services/userService');

const MINUTE = 60 * 1000;

/** Delete expired guests (with their progress) and expired one-time tokens. */
async function pruneExpired() {
  const guests = await userService.pruneExpiredGuests();
  const tokens = await userService.pruneExpiredTokens();
  if (guests > 0 || tokens > 0) logger.info({ guests, tokens }, 'pruned expired records');
  return { guests, tokens };
}

/** Rebuild the per-college leaderboard view. */
async function refreshLeaderboards() {
  await getRepos().jobs.refreshLeaderboards();
}

const JOBS = [
  { name: 'prune-expired', everyMs: 60 * MINUTE, run: pruneExpired },
  { name: 'refresh-leaderboards', everyMs: MINUTE, run: refreshLeaderboards },
];

/** Run one job under its lock. Errors are logged, never thrown, so one bad job cannot stop the others. */
async function runJob(job) {
  try {
    const outcome = await getRepos().jobs.withLock(job.name, job.run);
    if (outcome && outcome.ran === false) logger.debug({ job: job.name }, 'job skipped, another process holds the lock');
    return outcome;
  } catch (err) {
    logger.error({ job: job.name, err: err.message }, 'job failed');
    return null;
  }
}

/**
 * Start every job on its own timer (plus once now). @returns a function that stops them.
 */
function startJobs(jobs = JOBS) {
  const timers = jobs.map((job) => {
    runJob(job);
    return setInterval(() => runJob(job), job.everyMs);
  });
  return () => timers.forEach((t) => clearInterval(t));
}

module.exports = { JOBS, pruneExpired, refreshLeaderboards, runJob, startJobs };
