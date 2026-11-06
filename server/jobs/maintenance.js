/**
 * Scheduled housekeeping. Each job takes a named database lock, so running
 * several workers (or the gateway and a worker) never does the same job twice.
 */

const config = require('../config');
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

/** Let go of unclaimed lab seats and stale waiters, then admit the queue into free seats. */
async function admitLabQueue() {
  return require('../services/labService').admitWaiting();
}

/** End sandboxes whose lab slot is over. */
async function closeEndedSlots() {
  return require('../services/labService').closeEndedSlots();
}

/** Drop expired terminal tickets. */
async function pruneTickets() {
  return require('../services/ticketService').prune();
}

/** End sandboxes past their age or idle limit, wherever they run (one worker at a time, under the lock). */
async function reapSandboxes() {
  return require('../services/sandboxManager').getManager().sweep();
}

/** Compare the session registry with what the lab nodes run, and repair the difference. */
async function reconcileLabNodes() {
  return require('../services/reconcileService').reconcileNodes();
}

const JOBS = [
  { name: 'prune-expired', everyMs: 60 * MINUTE, run: pruneExpired },
  { name: 'refresh-leaderboards', everyMs: MINUTE, run: refreshLeaderboards },
  { name: 'prune-rate-limits', everyMs: 10 * MINUTE, run: pruneRateLimits },
  { name: 'prune-tickets', everyMs: 5 * MINUTE, run: pruneTickets },
  { name: 'admit-lab-queue', everyMs: 5 * 1000, run: admitLabQueue },
  // Only meaningful when sandboxes live on lab nodes; a gateway running its own sandboxes reaps them itself.
  ...(config.sandboxMode === 'remote' ? [
    { name: 'reap-sandboxes', everyMs: MINUTE, run: reapSandboxes },
    { name: 'close-ended-slots', everyMs: MINUTE, run: closeEndedSlots },
    { name: 'reconcile-lab-nodes', everyMs: 2 * MINUTE, run: reconcileLabNodes },
  ] : []),
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

module.exports = { JOBS, admitLabQueue, closeEndedSlots, pruneExpired, pruneRateLimits, pruneTickets, reapSandboxes, reconcileLabNodes, refreshLeaderboards, runJob, startJobs };
