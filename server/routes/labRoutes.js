/**
 * Lab Routes — Verification endpoint for practice tasks
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const units = require('../lib/units');
const metrics = require('../lib/metrics');
const { getManager } = require('../services/sandboxManager');
const progressService = require('../services/progressService');

const router = express.Router();
const MAX_OUTPUT_CHARS = 500;

/**
 * Run one step's check in the sandbox.
 * check: 'exact' | 'contains' compare stdout; anything else passes on exit code 0.
 */
async function verifyStep(manager, sessionId, stepObj) {
  const base = { step: stepObj.step, title: stepObj.title };
  if (!stepObj.verification || !stepObj.verification.command) {
    return { ...base, passed: true, message: 'No auto-verification required' };
  }

  const { command, expectedOutput, check } = stepObj.verification;
  try {
    const result = await manager.exec(sessionId, command);
    const stdout = (result.stdout || '').trim();

    let passed;
    if (check === 'exact') passed = stdout === expectedOutput;
    else if (check === 'contains') passed = stdout.includes(expectedOutput);
    else passed = result.exitCode === 0;

    return { ...base, passed, stdout: stdout.slice(0, MAX_OUTPUT_CHARS) };
  } catch (err) {
    return { ...base, passed: false, error: err.message };
  }
}

/**
 * POST /api/labs/:unitId/verify
 * Execute verification check for a lab step or all steps in a unit
 * Body: { sessionId, stepNumber? }
 */
router.post('/:unitId/verify', requireAuth, async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const { sessionId, stepNumber } = req.body || {};
    const manager = getManager();

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Missing sessionId' });
    }

    const steps = units.getSteps(unitId);
    if (steps.length === 0) {
      return res.status(404).json({ success: false, error: 'Practice lab not found' });
    }

    if (!manager.isOwner(sessionId, req.user.id)) {
      return res.status(404).json({ success: false, error: 'Active sandbox session not found' });
    }

    const stepsToVerify = stepNumber === undefined || stepNumber === null
      ? steps
      : steps.filter((s) => s.step === Number(stepNumber));
    if (stepsToVerify.length === 0) {
      return res.status(404).json({ success: false, error: `Step ${stepNumber} not found in this lab` });
    }

    const results = [];
    for (const stepObj of stepsToVerify) {
      const result = await verifyStep(manager, sessionId, stepObj);
      metrics.labVerifications.inc({ unit: unitId, result: result.passed ? 'pass' : 'fail' });
      results.push(result);
    }

    const { xpAwarded, unitCompleted, newlyCompleted } = progressService.recordVerification(req.user.id, unitId, results);
    const passedCount = results.filter((r) => r.passed).length;

    res.json({
      success: true,
      allPassed: passedCount === results.length,
      score: Math.round((passedCount / results.length) * 100),
      xpEarned: xpAwarded,
      unitCompleted,
      newlyCompleted,
      passedCount,
      totalCount: results.length,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.verifyStep = verifyStep;
