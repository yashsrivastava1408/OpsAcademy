/**
 * Sandbox Pool — pre-warmed standby sandboxes
 *
 * Keeps a few idle sandboxes ready so a student does not wait for a cold
 * start. The pool only holds engine handles; a sandbox becomes a session
 * when sandboxManager claims one and binds a session id to it.
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');

function createPool(engine, { size = config.sandbox.poolSize, enabled = config.sandbox.enablePool } = {}) {
  const standby = []; // engineIds, oldest first
  let replenishing = null;

  function newEngineId() {
    return crypto.randomBytes(8).toString('hex');
  }

  function publish() {
    metrics.sandboxPoolAvailable.set(standby.length);
  }

  /** Top the pool back up to its target size. Concurrent calls share one run. */
  function replenish() {
    if (!enabled) return Promise.resolve();
    if (replenishing) return replenishing;

    replenishing = (async () => {
      while (standby.length < size) {
        const engineId = newEngineId();
        try {
          await engine.create(engineId, { labId: 'standby' });
          standby.push(engineId);
          publish();
        } catch (err) {
          // Stop rather than spin: the engine is unavailable (e.g. Docker is down).
          logger.warn({ err: err.message }, '[SandboxPool] could not pre-warm a sandbox');
          break;
        }
      }
    })().finally(() => {
      replenishing = null;
    });

    return replenishing;
  }

  /**
   * Hand out a sandbox: a pre-warmed one if a live one is waiting, otherwise
   * a cold start.
   * @returns {Promise<{ engineId: string, fromPool: boolean }>}
   */
  async function acquire({ labId } = {}) {
    while (standby.length > 0) {
      const engineId = standby.shift();
      publish();
      if (engine.isAlive(engineId)) {
        setImmediate(() => replenish().catch(() => {}));
        return { engineId, fromPool: true };
      }
      // A standby shell that died while waiting is discarded, not handed out.
      await engine.destroy(engineId).catch(() => {});
    }

    const engineId = newEngineId();
    await engine.create(engineId, { labId });
    setImmediate(() => replenish().catch(() => {}));
    return { engineId, fromPool: false };
  }

  /** Destroy all standby sandboxes (shutdown). */
  async function drain() {
    if (replenishing) await replenishing.catch(() => {});
    while (standby.length > 0) {
      await engine.destroy(standby.pop()).catch(() => {});
    }
    publish();
  }

  function stats() {
    return {
      enabled,
      targetSize: enabled ? size : 0,
      available: standby.length,
      replenishing: Boolean(replenishing),
    };
  }

  return { acquire, replenish, drain, stats };
}

module.exports = { createPool };
