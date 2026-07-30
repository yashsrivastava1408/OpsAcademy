/**
 * Lab Routes — Verification endpoint for practice tasks
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const sandboxManager = require('../services/sandboxManager');

const router = express.Router();
const UNITS_DIR = path.join(__dirname, '..', 'data', 'units');

/**
 * POST /api/labs/:unitId/verify
 * Execute verification check for a lab step or all steps in a unit
 * Body: { sessionId, stepNumber? }
 */
router.post('/:unitId/verify', async (req, res, next) => {
  try {
    const { unitId } = req.params;
    const { sessionId, stepNumber } = req.body;

    if (!sessionId) {
      return res.status(400).json({ success: false, error: 'Missing sessionId' });
    }

    const practicePath = path.join(UNITS_DIR, unitId, 'practice.json');
    if (!fs.existsSync(practicePath)) {
      return res.status(404).json({ success: false, error: `Practice lab for '${unitId}' not found` });
    }

    const practiceData = JSON.parse(fs.readFileSync(practicePath, 'utf8'));
    const steps = practiceData.steps || [];

    const sandbox = sandboxManager.getSandbox(sessionId);
    if (!sandbox) {
      return res.status(404).json({ success: false, error: 'Active sandbox session not found' });
    }

    const results = [];
    const stepsToVerify = stepNumber
      ? steps.filter((s) => s.step === Number(stepNumber))
      : steps;

    let allPassed = true;

    for (const stepObj of stepsToVerify) {
      if (!stepObj.verification || !stepObj.verification.command) {
        results.push({ step: stepObj.step, passed: true, message: 'No auto-verification required' });
        continue;
      }

      const { command, expectedOutput, check } = stepObj.verification;

      try {
        const execResult = await sandboxManager.execInSandbox(sessionId, command);
        const stdout = (execResult.stdout || '').trim();
        const exitCode = execResult.exitCode;

        let passed = false;
        if (check === 'exact') {
          passed = stdout === expectedOutput;
        } else if (check === 'contains') {
          passed = stdout.includes(expectedOutput);
        } else {
          passed = exitCode === 0;
        }

        if (!passed) allPassed = false;

        results.push({
          step: stepObj.step,
          title: stepObj.title,
          passed,
          stdout,
          expectedOutput,
        });
      } catch (err) {
        allPassed = false;
        results.push({
          step: stepObj.step,
          title: stepObj.title,
          passed: false,
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      allPassed,
      results,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
