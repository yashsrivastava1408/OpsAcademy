/**
 * Reaper Service — Periodically cleans up stale sandbox sessions
 * 
 * Scans active sandboxes every 5 minutes and destroys any session older than 30 minutes.
 * Prevents memory leaks and orphan containers on servers like Render.
 */

const sandboxManager = require('./sandboxManager');
const config = require('../config');

let timer = null;

function startReaper() {
  if (timer) return;

  console.log('[Reaper] Auto-reaper background service started 🧹');

  timer = setInterval(() => {
    try {
      const activeSandboxes = sandboxManager.listSandboxes();
      const maxAgeMs = config.sandbox.maxSessionMinutes * 60 * 1000;
      const now = Date.now();

      let reapedCount = 0;

      for (const sb of activeSandboxes) {
        if (now - sb.createdAt > maxAgeMs) {
          console.log(`[Reaper] Reaping stale sandbox ${sb.sessionId} (age: ${Math.round(sb.uptime / 60000)}m)`);
          sandboxManager.destroySandbox(sb.sessionId);
          reapedCount++;
        }
      }

      if (reapedCount > 0) {
        console.log(`[Reaper] Cleaned up ${reapedCount} stale sandbox session(s).`);
      }
    } catch (err) {
      console.warn('[Reaper] Error during cleanup sweep:', err.message);
    }
  }, config.sandbox.reaperIntervalMs);
}

function stopReaper() {
  if (timer) {
    clearInterval(timer);
    timer = null;
    console.log('[Reaper] Auto-reaper stopped.');
  }
}

module.exports = { startReaper, stopReaper };
