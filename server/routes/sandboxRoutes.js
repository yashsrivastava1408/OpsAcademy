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
 * GET /api/sandbox/:sessionId/telemetry
 * Live container file tree, process list, and listening port inspection
 */
router.get('/:sessionId/telemetry', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const sandbox = sandboxManager.getSandbox(sessionId);

    if (!sandbox) {
      return res.status(404).json({ success: false, error: 'Sandbox session not found' });
    }

    let filesRaw = '';
    let psRaw = '';
    let portsRaw = '';

    try {
      const filesExec = await sandboxManager.execInSandbox(sessionId, 'find /home/student -maxdepth 3 -not -path "*/.*"');
      filesRaw = filesExec.stdout || '';
    } catch { /* ignore */ }

    try {
      const psExec = await sandboxManager.execInSandbox(sessionId, 'ps aux 2>/dev/null || ps -ef');
      psRaw = psExec.stdout || '';
    } catch { /* ignore */ }

    try {
      const portsExec = await sandboxManager.execInSandbox(sessionId, 'netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null');
      portsRaw = portsExec.stdout || '';
    } catch { /* ignore */ }

    // Parse file list
    const fileList = filesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && line !== '/home/student')
      .map((pathStr) => {
        const relPath = pathStr.replace('/home/student/', '');
        const parts = relPath.split('/');
        const isDir = !relPath.includes('.') || pathStr.endsWith('/');
        return {
          name: parts[parts.length - 1],
          path: relPath,
          type: isDir ? 'directory' : 'file',
          depth: parts.length - 1,
        };
      });

    // Parse process list
    const processList = psRaw
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 10)
      .map((line) => {
        const parts = line.split(/\s+/);
        return {
          user: parts[0] || 'root',
          pid: parts[1] || '1',
          cpu: parts[2] || '0.0',
          mem: parts[3] || '0.0',
          command: parts.slice(10).join(' ') || parts.slice(7).join(' ') || line,
        };
      });

    // Parse listening ports
    const ports = Array.from(
      new Set(
        (portsRaw.match(/:(8080|8000|80|443|3000|5000|5432|6379|9090)\b/g) || []).map((p) => p.replace(':', ''))
      )
    );

    res.json({
      success: true,
      data: {
        sessionId,
        fileTree: fileList,
        processes: processList,
        ports,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});
router.get('/metrics', (req, res) => {
  const sandboxes = sandboxManager.listSandboxes();
  const poolStats = sandboxManager.getPoolStats();

  res.json({
    success: true,
    data: {
      mode: sandboxManager.getMode(),
      activeSessions: sandboxes.length,
      sandboxes,
      pool: poolStats,
      timestamp: new Date().toISOString(),
    },
  });
});

/**
 * POST /api/sandbox/pool/refill
 * Manually trigger pool replenishment
 */
router.post('/pool/refill', async (req, res, next) => {
  try {
    await sandboxManager.initPool();
    res.json({
      success: true,
      message: 'Pool replenishment triggered',
      pool: sandboxManager.getPoolStats(),
    });
  } catch (err) {
    next(err);
  }
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
