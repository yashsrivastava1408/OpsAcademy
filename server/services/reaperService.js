/**
 * Reaper Service — periodically destroys stale sandbox sessions
 *
 * A session is reaped when it passes its maximum age or has been idle too
 * long. Pre-warmed standby sandboxes are not sessions and are left alone.
 */

const config = require('../config');
const logger = require('../lib/logger');
const { getManager } = require('./sandboxManager');

let timer = null;

function startReaper(manager = getManager(), intervalMs = config.sandbox.reaperIntervalMs) {
  if (timer) return;

  timer = setInterval(() => {
    manager.sweep().then(async (reaped) => {
      if (reaped.length > 0) logger.info({ reaped }, '[Reaper] cleaned up stale sandboxes');
      // Sandboxes of a lab slot that has ended (this gateway's own; with lab nodes the worker does it).
      if (!manager.isRemote) await require('./labService').closeEndedSlots(manager);
    }).catch((err) => {
      logger.warn({ err: err.message }, '[Reaper] sweep failed');
    });
  }, intervalMs);
  timer.unref();
}

function stopReaper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

module.exports = { startReaper, stopReaper };
