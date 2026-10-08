/**
 * Sandbox Routes — REST API for managing sandbox sessions
 *
 * Every session belongs to the user who started it. Other users get a 404
 * for it, the same answer as for a session that does not exist.
 */

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const units = require('../lib/units');
const { getManager } = require('../services/sandboxManager');
const telemetryService = require('../services/telemetryService');

const router = express.Router();

const MAX_FILE_PREVIEW_BYTES = 20 * 1024;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_.-][A-Za-z0-9_./ -]{0,255}$/;

function requireOwnedSession(req, res, next) {
  if (!getManager().isOwner(req.params.sessionId, req.user.id)) {
    return res.status(404).json({ success: false, error: 'Sandbox session not found' });
  }
  next();
}

/**
 * GET /api/sandbox/stats
 * Public aggregate numbers: mode, pool level and measured claim latency
 */
router.get('/stats', (req, res) => {
  res.json({ success: true, data: getManager().stats() });
});

/**
 * POST /api/sandbox/start
 * Start a sandbox for a lab, or hand back the one the caller already has
 * running for it (a second tab, or a terminal that lost its connection).
 * Body: { labId? }
 */
router.post('/start', requireAuth, rateLimit.sandboxStart(), async (req, res, next) => {
  try {
    const requested = req.body && req.body.labId;
    const labId = units.isValidUnitId(requested) ? requested : 'sandbox';

    const manager = getManager();
    const running = labId === 'sandbox' ? null : manager.findSession(req.user.id, labId);
    const sandbox = running || await manager.createSession(req.user.id, labId);

    res.status(running ? 200 : 201).json({
      success: true,
      data: { ...sandbox, resumed: Boolean(running), wsUrl: `/api/terminal?sessionId=${sandbox.sessionId}` },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sandbox
 * List the caller's own sandboxes
 */
router.get('/', requireAuth, (req, res) => {
  const sandboxes = getManager().listSessions().filter((s) => s.userId === req.user.id);
  res.json({ success: true, data: sandboxes, count: sandboxes.length, mode: getManager().getMode() });
});

/**
 * DELETE /api/sandbox/:sessionId
 * Destroy a sandbox session
 */
router.delete('/:sessionId', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    await getManager().destroySession(req.params.sessionId, 'stopped');
    res.json({ success: true, message: 'Sandbox destroyed' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sandbox/:sessionId/status
 * Get sandbox session info
 */
router.get('/:sessionId/status', requireAuth, requireOwnedSession, (req, res) => {
  res.json({ success: true, data: getManager().getSession(req.params.sessionId) });
});

/**
 * GET /api/sandbox/:sessionId/telemetry
 * Live file tree, process list and listening ports
 */
router.get('/:sessionId/telemetry', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    // Polled by the inspector panel, so it must not reset the idle timer.
    res.json({ success: true, data: await telemetryService.capture(req.params.sessionId, { touch: false }) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sandbox/:sessionId/history
 * Commands entered in this session's terminal, oldest first
 */
router.get('/:sessionId/history', requireAuth, requireOwnedSession, (req, res) => {
  const manager = getManager();
  const { expiresAt, idleExpiresAt } = manager.getSession(req.params.sessionId);
  res.json({
    success: true,
    data: manager.getHistory(req.params.sessionId),
    // The page polls this, so it also learns when the sandbox will be closed
    // and can warn the student first. Reading it does not count as activity.
    session: { expiresAt, idleExpiresAt, serverTime: Date.now() },
  });
});

/**
 * POST /api/sandbox/:sessionId/keepalive
 * "I'm still here": restart the idle countdown (the maximum age still applies)
 */
router.post('/:sessionId/keepalive', requireAuth, requireOwnedSession, (req, res) => {
  const manager = getManager();
  manager.touch(req.params.sessionId);
  const { expiresAt, idleExpiresAt } = manager.getSession(req.params.sessionId);
  res.json({ success: true, session: { expiresAt, idleExpiresAt, serverTime: Date.now() } });
});

/**
 * GET /api/sandbox/:sessionId/file?path=webapp/src/index.js
 * Read a file from the student's home directory (first 20 KB)
 */
router.get('/:sessionId/file', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    // The path is placed inside a shell command, so only plain relative
    // paths are accepted: no quotes, no `..`, nothing absolute.
    if (!SAFE_RELATIVE_PATH.test(filePath) || filePath.split('/').includes('..')) {
      return res.status(400).json({ success: false, error: 'Invalid file path' });
    }

    const target = `/home/student/${filePath}`;
    const result = await getManager().exec(
      req.params.sessionId,
      `test -f '${target}' && head -c ${MAX_FILE_PREVIEW_BYTES + 1} '${target}'`
    );
    if (result.exitCode !== 0) {
      return res.status(404).json({ success: false, error: 'File not found' });
    }

    const truncated = Buffer.byteLength(result.stdout) > MAX_FILE_PREVIEW_BYTES;
    res.json({
      success: true,
      data: { path: filePath, content: result.stdout.slice(0, MAX_FILE_PREVIEW_BYTES), truncated },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sandbox/:sessionId/reset
 * Wipe the student's home directory to start the lab over
 */
router.post('/:sessionId/reset', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    await getManager().reset(req.params.sessionId);
    res.json({ success: true, message: 'Sandbox reset' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
