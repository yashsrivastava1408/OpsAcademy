/**
 * Lab node agent (ADR 0005).
 *
 * Runs on each lab server and is the only process that controls the container runtime. The gateway
 * calls it over an authenticated internal API; it reports its capacity by heartbeat. It holds no
 * database credentials and knows nothing about users: a sandbox is just an id on this node.
 */

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { rateLimit } = require('express-rate-limit');
const logger = require('../lib/logger');
const { safeEqual } = require('../middleware/auth');
const { createPool } = require('../services/sandboxPoolService');

const VERSION = require('../package.json').version || '0';
const ENGINE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ATTACH_PATH = /^\/v1\/sandboxes\/([A-Za-z0-9_-]{1,64})\/attach$/;
const MAX_FRAME_BYTES = 64 * 1024;

function bearer(headers) {
  const header = headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * @param {object} options
 * @param {object} options.engine  a sandbox engine (dockerService or ptyService)
 * @param {object} options.settings  { nodeId, token, baseUrl, capacity, gatewayUrl, heartbeatMs, poolSize, poolEnabled }
 */
function createAgent({ engine, settings, fetchImpl = (...args) => fetch(...args) }) {
  const { nodeId, token, capacity } = settings;
  if (!token) throw new Error('NODE_TOKEN is required to run a lab node');

  const active = new Set(); // engine ids handed out to sessions (warm standbys are not in here)
  let reserved = 0; // creations in flight
  let draining = false;
  const pool = createPool(engine, { size: settings.poolSize, enabled: settings.poolEnabled });

  const authorised = (headers) => safeEqual(bearer(headers), token);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  // Only the gateway and worker call this API, all from a few addresses, so the ceiling is high: it
  // exists to cap what a stolen token or a runaway caller can do, not to shape normal traffic.
  app.use('/v1', rateLimit({
    windowMs: 60 * 1000,
    limit: 12000,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: 'rate_limited' }),
  }));

  app.get('/v1/health', (req, res) => {
    if (!authorised(req.headers)) return res.status(401).json({ error: 'unauthorized' });
    res.json(snapshot());
  });

  app.use('/v1', (req, res, next) => {
    if (!authorised(req.headers)) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  function snapshot() {
    return { nodeId, capacity, running: active.size, draining, version: VERSION, mode: engine.name, runtime: engine.runtimeName || null, poolAvailable: pool.stats().available };
  }

  const known = (engineId) => ENGINE_ID.test(engineId) && active.has(engineId);

  app.post('/v1/sandboxes', async (req, res) => {
    if (draining) return res.status(503).json({ error: 'draining' });
    // Checked and reserved in one synchronous step, so two requests cannot both take the last seat.
    if (active.size + reserved >= capacity) return res.status(503).json({ error: 'node_full' });
    reserved += 1;
    try {
      const labId = typeof req.body?.labId === 'string' ? req.body.labId.slice(0, 64) : 'sandbox';
      const { engineId, fromPool } = await pool.acquire({ labId });
      active.add(engineId);
      engine.onExit(engineId, () => active.delete(engineId));
      res.status(201).json({ engineId, nodeId, fromPool });
    } catch (err) {
      logger.warn({ err: err.message }, '[LabNode] could not start a sandbox');
      res.status(500).json({ error: 'create_failed' });
    } finally {
      reserved -= 1;
    }
  });

  app.delete('/v1/sandboxes/:engineId', async (req, res) => {
    const { engineId } = req.params;
    if (!ENGINE_ID.test(engineId)) return res.status(400).json({ error: 'bad_id' });
    active.delete(engineId);
    const existed = await engine.destroy(engineId).catch(() => false);
    res.json({ destroyed: Boolean(existed) });
  });

  app.post('/v1/sandboxes/:engineId/exec', async (req, res) => {
    const { engineId } = req.params;
    if (!known(engineId)) return res.status(404).json({ error: 'not_found' });
    const { command, timeoutMs } = req.body || {};
    if (typeof command !== 'string' || !command || command.length > 10000) return res.status(400).json({ error: 'bad_command' });
    try {
      const options = Number.isInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000 ? { timeoutMs } : {};
      res.json(await engine.exec(engineId, command, options));
    } catch (err) {
      res.status(err.message === 'Sandbox not found' ? 404 : 500).json({ error: err.message });
    }
  });

  app.post('/v1/sandboxes/:engineId/reset', async (req, res) => {
    const { engineId } = req.params;
    if (!known(engineId)) return res.status(404).json({ error: 'not_found' });
    try {
      await engine.reset(engineId);
      res.json({ reset: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // What this node is running, so the gateway can find sandboxes no session points at.
  app.get('/v1/sandboxes', (req, res) => {
    res.json({ nodeId, sandboxes: engine.list().map((s) => ({ ...s, active: active.has(s.engineId) })) });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES });

  server.on('upgrade', (request, socket, head) => {
    const match = ATTACH_PATH.exec(request.url.split('?')[0]);
    const refuse = (status, text) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!match) return refuse(404, 'Not Found');
    if (!authorised(request.headers)) return refuse(401, 'Unauthorized');
    if (!known(match[1])) return refuse(404, 'Not Found');
    wss.handleUpgrade(request, socket, head, (ws) => attachTerminal(ws, match[1]));
  });

  async function attachTerminal(ws, engineId) {
    // Frames sent before the shell is attached are held, then replayed in order.
    const early = [];
    const hold = (msg, isBinary) => early.push([msg, isBinary]);
    ws.on('message', hold);
    const terminal = await engine.attach(engineId).catch(() => null);
    if (!terminal) return ws.close(4004, 'Sandbox not found');

    terminal.onData((data) => { if (ws.readyState === ws.OPEN) ws.send(data); });
    // The shell itself ended (the student typed `exit`): tell the gateway, which tells the browser.
    if (terminal.onClose) terminal.onClose(() => { if (ws.readyState === ws.OPEN) ws.close(1000, 'Shell ended'); });
    const onMessage = (msg) => {
      const text = msg.toString();
      if (text.startsWith('{')) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && parsed.type === 'resize') {
            const cols = Number(parsed.cols);
            const rows = Number(parsed.rows);
            if (cols >= 2 && cols <= 500 && rows >= 2 && rows <= 200) terminal.resize(Math.floor(cols), Math.floor(rows));
            return;
          }
        } catch {
          // not a control message: terminal input
        }
      }
      terminal.write(text);
    };
    ws.off('message', hold);
    ws.on('message', onMessage);
    for (const [msg] of early.splice(0)) onMessage(msg);
    ws.once('close', () => terminal.close());
    ws.on('error', () => terminal.close());
  }

  // ── heartbeat to the gateway ─────────────────────────────────
  let timer = null;
  async function beat() {
    if (!settings.gatewayUrl) return;
    try {
      const res = await fetchImpl(`${settings.gatewayUrl.replace(/\/+$/, '')}/api/internal/nodes/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ nodeId, baseUrl: settings.baseUrl, capacity, running: active.size, draining, version: VERSION }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) logger.warn({ status: res.status }, '[LabNode] heartbeat refused');
    } catch (err) {
      logger.warn({ err: err.message }, '[LabNode] heartbeat failed');
    }
  }

  async function start(port = settings.port) {
    if (engine.verifyRuntime) engine.runtimeName = await engine.verifyRuntime(); // throws if the runtime is missing
    if (engine.reconcile) await engine.reconcile().catch(() => {});
    // Sandboxes found after a restart belong to sessions the gateway still knows about.
    for (const s of engine.list()) active.add(s.engineId);
    await new Promise((resolve) => server.listen(port, '0.0.0.0', resolve));
    await beat();
    timer = setInterval(beat, settings.heartbeatMs);
    timer.unref();
    pool.replenish().catch(() => {});
    logger.info({ nodeId, port: server.address().port, capacity, engine: engine.name }, 'lab node agent listening');
    return server.address().port;
  }

  /** Stop taking new sandboxes and tell the gateway; running ones are left alone. */
  async function drain() {
    draining = true;
    await beat();
  }

  async function stop() {
    if (timer) clearInterval(timer);
    for (const ws of wss.clients) ws.close(1001, 'Node shutting down');
    await new Promise((resolve) => server.close(resolve));
    await pool.drain();
  }

  return { app, server, start, stop, drain, beat, snapshot, pool };
}

module.exports = { createAgent };
