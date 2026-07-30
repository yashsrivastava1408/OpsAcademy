/**
 * Terminal Service — WebSocket handler for live terminal streaming
 * 
 * Pipes browser keystrokes ↔ sandbox stdin/stdout via WebSocket.
 * Supports both PTY mode (node-pty) and Docker mode (dockerode streams).
 */

const { WebSocketServer } = require('ws');
const { URL } = require('url');
const sandboxManager = require('./sandboxManager');
const config = require('../config');

/**
 * Attach WebSocket terminal handler to an HTTP server
 */
function attachTerminalWebSocket(server) {
  const wss = new WebSocketServer({ 
    noServer: true,
  });

  // Handle upgrade requests for /api/terminal
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
    
    if (pathname === '/api/terminal') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      ws.send(JSON.stringify({ type: 'error', message: 'Missing sessionId parameter' }));
      ws.close();
      return;
    }

    console.log(`[Terminal] WebSocket connected for session: ${sessionId}`);

    try {
      if (config.sandboxMode === 'pty') {
        handlePtyConnection(ws, sessionId);
      } else {
        await handleDockerConnection(ws, sessionId);
      }
    } catch (err) {
      console.error(`[Terminal] Connection error for ${sessionId}:`, err.message);
      ws.send(JSON.stringify({ type: 'error', message: err.message }));
      ws.close();
    }
  });

  // Heartbeat to keep connections alive (important for Render)
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(heartbeatInterval));

  return wss;
}

/**
 * Handle PTY mode terminal connection
 */
function handlePtyConnection(ws, sessionId) {
  const ptyProcess = sandboxManager.getPtyProcess(sessionId);
  
  if (!ptyProcess) {
    ws.send(JSON.stringify({ type: 'error', message: 'Sandbox not found. Start a sandbox first.' }));
    ws.close();
    return;
  }

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // PTY stdout → Browser WebSocket
  const dataHandler = ptyProcess.onData((data) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  // Browser WebSocket → PTY stdin
  ws.on('message', (msg) => {
    const message = msg.toString();
    
    // Check if it's a control message (JSON)
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
        sandboxManager.resizeSandbox(sessionId, parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — it's raw terminal input
    }

    ptyProcess.write(message);
  });

  // Cleanup on disconnect
  ws.on('close', () => {
    console.log(`[Terminal] WebSocket disconnected for session: ${sessionId}`);
    dataHandler.dispose();
  });

  ws.on('error', (err) => {
    console.error(`[Terminal] WebSocket error for ${sessionId}:`, err.message);
    dataHandler.dispose();
  });
}

/**
 * Handle Docker mode terminal connection
 */
async function handleDockerConnection(ws, sessionId) {
  const result = await sandboxManager.getContainerStream(sessionId);
  
  if (!result) {
    ws.send(JSON.stringify({ type: 'error', message: 'Sandbox container not found.' }));
    ws.close();
    return;
  }

  const { stream } = result;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Container stdout → Browser WebSocket
  stream.on('data', (chunk) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(chunk.toString('utf8'));
    }
  });

  // Browser WebSocket → Container stdin
  ws.on('message', (msg) => {
    const message = msg.toString();
    
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'resize') {
        // Docker resize would happen on exec instance
        return;
      }
    } catch {
      // Raw terminal input
    }

    stream.write(message);
  });

  ws.on('close', () => {
    console.log(`[Terminal] Docker WebSocket disconnected for session: ${sessionId}`);
    stream.end();
  });

  ws.on('error', (err) => {
    console.error(`[Terminal] Docker WebSocket error for ${sessionId}:`, err.message);
    stream.end();
  });
}

module.exports = { attachTerminalWebSocket };
