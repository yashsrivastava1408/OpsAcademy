/**
 * Terminal Service — WebSocket handler for live terminal streaming
 *
 * Pipes browser keystrokes ↔ sandbox stdin/stdout via WebSocket.
 * The connection is authenticated before the upgrade completes: the caller
 * must present a valid token and own the session they are attaching to.
 */

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const config = require('../config');
const logger = require('../lib/logger');
const metrics = require('../lib/metrics');
const commandGuard = require('../lib/commandGuard');
const { verifyToken } = require('../middleware/auth');
const { getManager } = require('./sandboxManager');

const TERMINAL_PATH = '/api/terminal';
const MAX_PAYLOAD_BYTES = 64 * 1024;
const HEARTBEAT_MS = 30000;
// Far above human typing, low enough to stop a client flooding the shell.
const MAX_MESSAGES_PER_WINDOW = 2000;
const MESSAGE_WINDOW_MS = 10000;

// WebSocket close codes in the application range (4000-4999).
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const CLOSE = { SESSION_ENDED: 4000, POLICY: 4008, FLOOD: 4029 };

function isAllowedOrigin(origin) {
  // Non-browser clients send no Origin header; browsers always do.
  if (!origin || !config.corsOrigins) return true;
  if (config.corsOrigins.includes(origin)) return true;
  return !config.isProd && LOCALHOST_ORIGIN.test(origin);
}

function rejectUpgrade(socket, status, message) {
  socket.write(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`
  );
  socket.destroy();
}

function notice(text) {
  return `\r\n\x1b[1;31m[OpsAcademy]\x1b[0m \x1b[31m${text}\x1b[0m\r\n`;
}

/**
 * Attach WebSocket terminal handler to an HTTP server
 */
function attachTerminalWebSocket(server, manager = getManager()) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== TERMINAL_PATH) return socket.destroy();

    if (!isAllowedOrigin(request.headers.origin)) return rejectUpgrade(socket, 403, 'Origin not allowed');

    // Browsers cannot set headers on a WebSocket, so the token rides in the query string.
    const user = verifyToken(url.searchParams.get('token'));
    if (!user) return rejectUpgrade(socket, 401, 'Unauthorized');

    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId || !manager.getSession(sessionId)) return rejectUpgrade(socket, 404, 'Sandbox not found');
    if (!manager.isOwner(sessionId, user.id)) return rejectUpgrade(socket, 403, 'Forbidden');

    wss.handleUpgrade(request, socket, head, (ws) => {
      handleConnection(ws, sessionId, manager).catch((err) => {
        logger.error({ sessionId, err: err.message }, '[Terminal] connection failed');
        ws.close(1011, 'Terminal failed to start');
      });
    });
  });

  // Heartbeat to keep connections alive behind proxies and drop dead peers
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_MS);
  heartbeat.unref();

  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

async function handleConnection(ws, sessionId, manager) {
  const terminal = await manager.attach(sessionId);
  if (!terminal) {
    ws.close(CLOSE.SESSION_ENDED, 'Sandbox not found');
    return;
  }

  metrics.terminalConnections.inc();
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Sandbox output → browser. A shell writes in many small pieces (a prompt
  // alone can be several); pieces that arrive in the same turn of the event
  // loop go out as one frame. It adds no delay and cuts the frame count for
  // commands with a lot of output.
  let outbox = '';
  const flushOutbox = () => {
    const data = outbox;
    outbox = '';
    if (data && ws.readyState === ws.OPEN) ws.send(data);
  };
  terminal.onData((data) => {
    if (!outbox) setImmediate(flushOutbox);
    outbox += data;
  });

  // If the session is stopped or reaped, close the socket with the reason.
  const unsubscribe = manager.onClose(sessionId, (reason) => {
    if (ws.readyState === ws.OPEN) ws.close(CLOSE.SESSION_ENDED, `Sandbox ${reason}`);
  });

  const lineBuffer = new commandGuard.LineBuffer();
  let windowStart = Date.now();
  let messagesInWindow = 0;

  // Browser → sandbox stdin
  ws.on('message', (msg) => {
    const now = Date.now();
    if (now - windowStart > MESSAGE_WINDOW_MS) {
      windowStart = now;
      messagesInWindow = 0;
    }
    messagesInWindow += 1;
    if (messagesInWindow > MAX_MESSAGES_PER_WINDOW) {
      ws.close(CLOSE.FLOOD, 'Too much input');
      return;
    }

    manager.touch(sessionId);
    const message = msg.toString();

    // Control messages are JSON objects; everything else is terminal input.
    if (message.startsWith('{')) {
      try {
        const parsed = JSON.parse(message);
        if (parsed && parsed.type === 'resize') {
          const cols = Number(parsed.cols);
          const rows = Number(parsed.rows);
          if (cols >= 2 && cols <= 500 && rows >= 2 && rows <= 200) terminal.resize(Math.floor(cols), Math.floor(rows));
          return;
        }
      } catch {
        // Not JSON — it's raw terminal input
      }
    }

    for (const part of lineBuffer.push(message)) {
      if (part.data !== undefined) {
        terminal.write(part.data);
        continue;
      }

      const command = part.line.trim();
      const verdict = commandGuard.check(command);

      if (!verdict.blocked) {
        if (command) manager.recordCommand(sessionId, command);
        terminal.write(part.terminator);
        continue;
      }

      // Clear the typed line instead of running it.
      terminal.write('\x15');
      metrics.commandsBlocked.inc({ rule: verdict.rule });
      const strikes = manager.addStrike(sessionId);
      logger.warn({ sessionId, rule: verdict.rule, strikes }, '[Terminal] blocked command');

      if (strikes >= config.sandbox.maxStrikes) {
        ws.send(notice('Sandbox terminated after repeated blocked commands.'));
        manager.destroySession(sessionId, 'terminated for abuse').catch(() => {});
        return;
      }
      ws.send(notice(`Command blocked (${verdict.rule}). Strike ${strikes} of ${config.sandbox.maxStrikes}.`));
      terminal.write('\r');
    }
  });

  const cleanup = () => {
    unsubscribe();
    terminal.close();
    metrics.terminalConnections.dec();
  };
  ws.once('close', cleanup);
  ws.on('error', (err) => {
    logger.warn({ sessionId, err: err.message }, '[Terminal] socket error');
  });
}

module.exports = { attachTerminalWebSocket, isAllowedOrigin, TERMINAL_PATH, CLOSE };
