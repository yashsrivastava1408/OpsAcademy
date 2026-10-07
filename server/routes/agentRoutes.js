/**
 * Agent Routes — gateway to the Python AI hub
 *
 * The gateway gathers the context the mentor needs (the lab step, what the
 * student typed, what is in their sandbox) so the hub answers from ground
 * truth instead of the student's description alone.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const units = require('../lib/units');
const metrics = require('../lib/metrics');
const logger = require('../lib/logger');
const { getManager } = require('../services/sandboxManager');
const { getHubClient } = require('../services/aiHubClient');
const telemetryService = require('../services/telemetryService');
const progressService = require('../services/progressService');

const router = express.Router();
const MAX_TIER = 3;
const MAX_QUERY_CHARS = 1000;
const HISTORY_FOR_HINT = 15;

router.use(requireAuth, rateLimit.agent());

/**
 * Hint used when the AI hub is unreachable: built only from the step's own
 * instructions, so it can never reveal more than the lab page already shows.
 */
function fallbackHint(step, tier) {
  if (!step) return 'Re-read the step instructions and check each command for typos.';
  if (tier === 1) return `Focus on what this step is asking for: ${step.description}`;
  const tasks = (step.tasks || []).map((task, i) => `${i + 1}. ${task}`).join('\n');
  if (tier === 2) return `Work through the tasks one at a time and check the result of each before moving on:\n${tasks}`;
  return `Do the tasks in order, then press Verify to see which check still fails:\n${tasks}`;
}

/**
 * POST /api/agent/hint
 * Body: { query, unitId, stepNumber, sessionId?, tier? }
 *
 * Hints are tiered (1 nudge, 2 diagnostic, 3 syntax). A student can only ask
 * for a tier one above the hints they have already used on that step.
 */
router.post('/hint', async (req, res, next) => {
  try {
    const body = req.body || {};
    const query = typeof body.query === 'string' ? body.query.slice(0, MAX_QUERY_CHARS) : '';
    const unitId = units.isValidUnitId(body.unitId) ? body.unitId : null;
    const stepNumber = Number(body.stepNumber) || 1;
    const step = unitId ? units.getStep(unitId, stepNumber) : null;

    if (!query.trim()) {
      return res.status(400).json({ success: false, error: 'Ask a question to get a hint' });
    }

    const unlocked = Math.min(MAX_TIER, (unitId ? progressService.hintCount(req.user.id, unitId, stepNumber) : 0) + 1);
    const requested = Number(body.tier);
    const tier = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, unlocked) : unlocked;

    const manager = getManager();
    const ownsSession = body.sessionId && manager.isOwner(body.sessionId, req.user.id);
    const commandHistory = ownsSession
      ? manager.getHistory(body.sessionId).slice(-HISTORY_FOR_HINT).map((entry) => entry.command)
      : [];
    const telemetry = ownsSession ? await telemetryService.capture(body.sessionId) : null;

    let data;
    try {
      data = await getHubClient().hint({
        query,
        unitId: unitId || 'general',
        stepNumber,
        tier,
        step: step
          ? {
              title: step.title,
              description: step.description,
              tasks: step.tasks || [],
              verificationCommand: step.verification ? step.verification.command : null,
            }
          : null,
        commandHistory,
        containerTelemetry: telemetry
          ? { fileTree: telemetry.fileTree, ports: telemetry.ports, maxDepth: telemetry.maxDepth, truncated: telemetry.truncated }
          : null,
      });
    } catch (err) {
      logger.warn({ err: err.message }, '[Agent Gateway] AI hub unavailable, using fallback hint');
      data = { blocked: false, hint: fallbackHint(step, tier), tier, source: 'fallback', fallback: true };
    }

    if (!data.blocked && unitId) progressService.recordHint(req.user.id, unitId, stepNumber);
    metrics.hintRequests.inc({ tier: String(tier), source: data.blocked ? 'blocked' : data.source || 'hub' });

    res.json({
      success: true,
      data: { ...data, tier, maxTier: MAX_TIER, nextTier: !data.blocked && tier < MAX_TIER ? tier + 1 : null },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/agent/scan
 * Body: { command }
 */
router.post('/scan', async (req, res, next) => {
  try {
    const command = req.body && typeof req.body.command === 'string' ? req.body.command.slice(0, 4096) : '';
    try {
      res.json({ success: true, data: await getHubClient().scan(command) });
    } catch {
      // The hub is down: say so rather than reporting the command as safe.
      res.status(503).json({ success: false, error: 'Command scanner is unavailable' });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.fallbackHint = fallbackHint;
