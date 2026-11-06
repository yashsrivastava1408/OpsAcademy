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

/** Drop rate-limit counters whose window has passed. */
async function pruneRateLimits() {
  return getRepos().rateLimits.prune();
}

const JOBS = [
  { name: 'prune-expired', everyMs: 60 * MINUTE, run: pruneExpired },
  { name: 'refresh-leaderboards', everyMs: MINUTE, run: refreshLeaderboards },
  { name: 'prune-rate-limits', everyMs: 10 * MINUTE, run: pruneRateLimits },
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
 * Start every job on its own timer (plus once now). Jobs run one at a time: each holds a database
 * connection for its lock while its queries use another, so running them together would starve a
 * small connection pool. @returns a function that stops them.
 */
function startJobs(jobs = JOBS) {
  let queue = Promise.resolve();
  const enqueue = (job) => {
    queue = queue.then(() => runJob(job)); // runJob never rejects
    return queue;
  };
  const timers = jobs.map((job) => {
    enqueue(job);
    return setInterval(() => enqueue(job), job.everyMs);
  });
  return () => timers.forEach((t) => clearInterval(t));
}

module.exports = { JOBS, pruneExpired, pruneRateLimits, refreshLeaderboards, runJob, startJobs };
