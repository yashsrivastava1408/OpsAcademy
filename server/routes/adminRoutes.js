/**
 * Admin Routes — operator view of all sandboxes
 *
 * Disabled unless ADMIN_TOKEN is set; requests need the `x-admin-token` header.
 */

const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const { getManager } = require('../services/sandboxManager');

const router = express.Router();
router.use(requireAdmin);

/**
 * GET /api/admin/sandboxes
 * Every active session, with owners and ids
 */
router.get('/sandboxes', (req, res) => {
  const sandboxes = getManager().listSessions();
  res.json({ success: true, data: sandboxes, count: sandboxes.length, stats: getManager().stats() });
});

/**
 * DELETE /api/admin/sandboxes/:sessionId
 */
router.delete('/sandboxes/:sessionId', async (req, res, next) => {
  try {
    const destroyed = await getManager().destroySession(req.params.sessionId, 'stopped by operator');
    if (!destroyed) return res.status(404).json({ success: false, error: 'Sandbox session not found' });
    res.json({ success: true, message: 'Sandbox destroyed' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/pool/refill
 * Manually trigger pool replenishment
 */
router.post('/pool/refill', async (req, res, next) => {
  try {
    await getManager().replenishPool();
    res.json({ success: true, stats: getManager().stats() });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
