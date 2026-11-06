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
const labAccountService = require('../services/labAccountService');
const labService = require('../services/labService');
const { forgetUser } = require('../middleware/auth');

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
        sandbox: await manager.stats(),
        sandboxes: await manager.listSessions(),
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
router.get('/sandboxes', async (req, res, next) => {
  try {
    const sandboxes = await getManager().listSessions();
    res.json({ success: true, data: sandboxes, count: sandboxes.length, stats: await getManager().stats() });
  } catch (err) {
    next(err);
  }
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
    res.json({ success: true, stats: await getManager().stats() });
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

// ── Lab accounts (an ID and password per student, issued here) ──

/**
 * POST /api/admin/lab-accounts  { prefix, count } or { prefix, names: [...] }
 * Makes the accounts and returns their passwords once. Nothing else ever shows them.
 */
router.post('/lab-accounts', async (req, res, next) => {
  try {
    const made = await labAccountService.generate(req.body || {});
    await audit.record(req, 'lab_accounts.generate', { entityType: 'lab_account', meta: { prefix: (req.body.prefix || '').toLowerCase(), count: made.length, first: made[0].username, last: made[made.length - 1].username } });
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ success: true, data: made });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/lab-accounts?search=&limit=&offset= */
router.get('/lab-accounts', async (req, res, next) => {
  try {
    res.json({ success: true, data: await labAccountService.list(req.query) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/lab-accounts/:id/reset-password — a new password, returned once */
router.post('/lab-accounts/:id/reset-password', async (req, res, next) => {
  try {
    const result = await labAccountService.resetPassword(req.params.id);
    forgetUser(result.id);
    await audit.record(req, 'lab_account.reset_password', { entityType: 'lab_account', entityId: result.id, meta: { username: result.username } });
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/** POST /api/admin/lab-accounts/:id/disable and /enable */
for (const [action, disabled] of [['disable', true], ['enable', false]]) {
  router.post(`/lab-accounts/:id/${action}`, async (req, res, next) => {
    try {
      const account = await labAccountService.setDisabled(req.params.id, disabled);
      forgetUser(account.id);
      let closed = 0;
      if (disabled) {
        // A switched-off account loses its running sandboxes too.
        for (const session of (await getManager().listSessions()).filter((s) => s.userId === account.id)) {
          if (await getManager().destroySession(session.sessionId, 'account disabled').catch(() => false)) closed += 1;
        }
        await getRepos().queue.cancel(account.id);
      }
      await audit.record(req, `lab_account.${action}`, { entityType: 'lab_account', entityId: account.id, meta: { username: account.username, sandboxesClosed: closed } });
      res.json({ success: true, data: account, sandboxesClosed: closed });
    } catch (err) {
      next(err);
    }
  });
}

/** GET /api/admin/capacity-plan?days=7 — lab servers needed per day from the slot assignments */
router.get('/capacity-plan', async (req, res, next) => {
  try {
    res.json({ success: true, data: await labService.capacityPlan({ days: req.query.days }) });
  } catch (err) {
    next(err);
  }
});

/** GET /api/admin/lab-funnel?days=7 — where students drop off entering the lab */
router.get('/lab-funnel', async (req, res, next) => {
  try {
    res.json({ success: true, data: await labService.funnel({ days: req.query.days }) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
