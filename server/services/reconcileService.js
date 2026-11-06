/**
 * Cluster-wide reconciliation (ADR 0005, section 7). Compares what the session registry says with what
 * each lab node is really running, and repairs the difference:
 *
 *  - a sandbox on a node that no session points at is an orphan: destroyed;
 *  - a session whose sandbox is gone from its node is dead: its record is dropped;
 *  - a node unreachable for too long loses its session records.
 *
 * Anything younger than the grace period is left alone: a sandbox is started before its record is
 * written, and a record is written before the node's inventory is read.
 */
const config = require('../config');
const logger = require('../lib/logger');
const { getRepos } = require('../repositories');

const GRACE_MS = 2 * 60 * 1000;

async function reconcileNodes({ engine = require('./remoteEngine'), now = Date.now(), graceMs = GRACE_MS } = {}) {
  const repos = getRepos();
  const result = { orphansDestroyed: 0, deadSessionsDropped: 0, unreachableSessionsDropped: 0, nodesChecked: 0 };

  for (const node of await repos.nodes.list()) {
    const rows = await repos.sessions.listByNode(node.nodeId);
    const unseenMs = now - node.lastSeenAt;

    if (unseenMs > config.node.unreachableMs) {
      for (const row of rows) {
        if (await repos.sessions.delete(row.sessionId)) result.unreachableSessionsDropped += 1;
      }
      continue;
    }
    if (unseenMs > config.node.healthyMs) continue; // recently silent: wait, do not guess

    const inventory = await engine.inventory(node);
    if (!inventory) continue;
    result.nodesChecked += 1;

    const recorded = new Set(rows.map((r) => r.engineId));
    const running = new Set(inventory.map((s) => s.engineId));

    for (const box of inventory) {
      if (box.active && !recorded.has(box.engineId) && box.createdAt && now - box.createdAt > graceMs) {
        await engine.destroy(box.engineId, { nodeId: node.nodeId });
        result.orphansDestroyed += 1;
      }
    }
    for (const row of rows) {
      if (!running.has(row.engineId) && now - row.createdAt > graceMs) {
        if (await repos.sessions.delete(row.sessionId)) result.deadSessionsDropped += 1;
      }
    }
  }

  if (Object.values(result).some(Boolean)) logger.info(result, 'reconciled lab nodes');
  return result;
}

module.exports = { reconcileNodes, GRACE_MS };
