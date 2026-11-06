/**
 * Internal Routes — called by lab node agents, never by browsers.
 * Every request carries the shared NODE_TOKEN.
 */

const express = require('express');
const config = require('../config');
const { safeEqual } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { getRepos } = require('../repositories');

const router = express.Router();
const NODE_ID = /^[A-Za-z0-9._-]{1,64}$/;

function requireNodeToken(req, res, next) {
  if (!config.node.token) return res.status(404).json({ success: false, error: 'Not found' });
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!safeEqual(given, config.node.token)) return res.status(401).json({ success: false, error: 'Unauthorized' });
  next();
}

/** POST /api/internal/nodes/heartbeat — a lab node announces itself and its load */
router.post('/nodes/heartbeat', requireNodeToken, asyncHandler(async (req, res) => {
  const { nodeId, baseUrl, capacity, running, draining, version } = req.body || {};
  let url = null;
  try {
    url = new URL(baseUrl);
  } catch {
    // rejected below
  }
  if (typeof nodeId !== 'string' || !NODE_ID.test(nodeId)
    || !url || !/^https?:$/.test(url.protocol)
    || !Number.isInteger(capacity) || capacity < 0 || capacity > 100000
    || !Number.isInteger(running) || running < 0) {
    return res.status(400).json({ success: false, error: 'Invalid heartbeat' });
  }
  await getRepos().nodes.heartbeat({
    nodeId, baseUrl: url.origin, capacity, running, draining: draining === true, version: typeof version === 'string' ? version.slice(0, 32) : null,
  });
  res.json({ success: true });
}));

module.exports = router;
