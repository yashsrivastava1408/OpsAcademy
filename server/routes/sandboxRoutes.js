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
const ticketService = require('../services/ticketService');

const router = express.Router();

const MAX_FILE_PREVIEW_BYTES = 20 * 1024;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_.-][A-Za-z0-9_./ -]{0,255}$/;

async function requireOwnedSession(req, res, next) {
  try {
    if (!(await getManager().isOwner(req.params.sessionId, req.user.id))) {
      return res.status(404).json({ success: false, error: 'Sandbox session not found' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/sandbox/stats
 * Public aggregate numbers: mode, pool level and measured claim latency
 */
router.get('/stats', async (req, res, next) => {
  try {
    res.json({ success: true, data: await getManager().stats() });
  } catch (err) {
    next(err);
  }
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
    const running = labId === 'sandbox' ? null : await manager.findSession(req.user.id, labId);
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
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const sandboxes = (await getManager().listSessions()).filter((s) => s.userId === req.user.id);
    res.json({ success: true, data: sandboxes, count: sandboxes.length, mode: getManager().getMode() });
  } catch (err) {
    next(err);
  }
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
router.get('/:sessionId/status', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    res.json({ success: true, data: await getManager().getSession(req.params.sessionId) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sandbox/:sessionId/terminal-ticket
 * A single-use ticket (valid 30 s) to open the terminal WebSocket with, instead of the bearer token in the URL
 */
router.post('/:sessionId/terminal-ticket', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    const { ticket, expiresInMs } = await ticketService.issue(req.params.sessionId, req.user.id);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: { ticket, expiresInMs, wsPath: '/api/terminal' } });
  } catch (err) {
    next(err);
  }
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
router.get('/:sessionId/history', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    const session = await getManager().getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Sandbox session not found' });
    res.json({
      success: true,
      data: await getManager().getHistory(req.params.sessionId),
      // The page polls this, so it also learns when the sandbox will be closed
      // and can warn the student first. Reading it does not count as activity.
      session: { expiresAt: session.expiresAt, idleExpiresAt: session.idleExpiresAt, serverTime: Date.now() },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/sandbox/:sessionId/keepalive
 * "I'm still here": restart the idle countdown (the maximum age still applies)
 */
router.post('/:sessionId/keepalive', requireAuth, requireOwnedSession, async (req, res, next) => {
  try {
    const manager = getManager();
    await manager.touch(req.params.sessionId, { force: true });
    const session = await manager.getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ success: false, error: 'Sandbox session not found' });
    res.json({ success: true, session: { expiresAt: session.expiresAt, idleExpiresAt: session.idleExpiresAt, serverTime: Date.now() } });
  } catch (err) {
    next(err);
  }
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
