/**
 * Admin Routes — operator view of all sandboxes
 *
 * Platform admins only (role in `memberships`); see ADR 0003.
 */

const express = require('express');
const { requireAdmin } = require('../middleware/rbac');
const config = require('../config');
const { getManager } = require('../services/sandboxManager');
const { getHubClient } = require('../services/aiHubClient');
const { getRepos } = require('../repositories');
const { getMailer } = require('../lib/mailer');
const userService = require('../services/userService');
const progressService = require('../services/progressService');
const audit = require('../services/auditService');

const router = express.Router();
router.use(requireAdmin);

/**
 * GET /api/admin/overview
 * One screen of operator numbers: sandboxes, accounts, and what is configured
 */
router.get('/overview', async (req, res, next) => {
  try {
    const manager = getManager();
    res.json({
      success: true,
      data: {
        uptimeSeconds: Math.round(process.uptime()),
        sandbox: manager.stats(),
        sandboxes: manager.listSessions(),
        users: await userService.counts(),
        progress: await progressService.totals(),
        certificates: await getRepos().certificates.count(),
        services: {
          aiHub: await getHubClient().isHealthy(),
          storeDriver: getRepos().driver,
          storeWritable: await getRepos().ping().then(() => true, () => false),
          emailDelivers: getMailer().delivers,
        },
        limits: {
          maxPerUser: config.sandbox.maxPerUser,
          maxTotal: config.sandbox.maxTotal,
          maxSessionMinutes: config.sandbox.maxSessionMinutes,
          maxInactivityMinutes: config.sandbox.maxInactivityMinutes,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

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
    await audit.record(req, 'sandbox.stop', { entityType: 'sandbox', entityId: req.params.sessionId });
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
    await audit.record(req, 'pool.refill');
    res.json({ success: true, stats: getManager().stats() });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/audit?actorId=&limit=
 * Everything admins and trainers did, newest first
 */
router.get('/audit', async (req, res, next) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 500);
    res.json({ success: true, data: await audit.list({ actorId: req.query.actorId, limit }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
