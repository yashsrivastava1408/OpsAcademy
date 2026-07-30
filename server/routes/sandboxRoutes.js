/**
 * Sandbox Routes — REST API for managing sandbox sessions
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const sandboxManager = require('../services/sandboxManager');

const router = express.Router();

/**
 * POST /api/sandbox/start
 * Create a new sandbox session
 * Body: { userId?, labId? }
 */
router.post('/start', async (req, res, next) => {
  try {
    const { userId = 'anonymous', labId = 'sandbox' } = req.body;
    const sessionId = uuidv4();

    await sandboxManager.createSandbox(sessionId, userId, labId);

    const sandbox = sandboxManager.getSandbox(sessionId);

    res.status(201).json({
      success: true,
      data: {
        sessionId,
        ...sandbox,
        wsUrl: `/api/terminal?sessionId=${sessionId}`,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/sandbox/:sessionId
 * Destroy a sandbox session
 */
router.delete('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const destroyed = await sandboxManager.destroySandbox(sessionId);

    if (!destroyed) {
      return res.status(404).json({
        success: false,
        error: 'Sandbox session not found',
      });
    }

    res.json({ success: true, message: 'Sandbox destroyed' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sandbox/:sessionId/status
 * Get sandbox session info
 */
router.get('/:sessionId/status', (req, res) => {
  const { sessionId } = req.params;
  const sandbox = sandboxManager.getSandbox(sessionId);

  if (!sandbox) {
    return res.status(404).json({
      success: false,
      error: 'Sandbox session not found',
    });
  }

  res.json({ success: true, data: sandbox });
});

/**
 * GET /api/sandbox
 * List all active sandboxes
 */
router.get('/', (req, res) => {
  const sandboxes = sandboxManager.listSandboxes();
  res.json({
    success: true,
    data: sandboxes,
    count: sandboxes.length,
    mode: sandboxManager.getMode(),
  });
});

module.exports = router;
