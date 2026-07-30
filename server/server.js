/**
 * OpsAcademy API Gateway
 * 
 * Express server with WebSocket support for terminal streaming.
 * Manages sandbox lifecycles (PTY or Docker mode) and lab orchestration.
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const { attachTerminalWebSocket } = require('./services/terminalService');
const sandboxRoutes = require('./routes/sandboxRoutes');
const errorHandler = require('./middleware/errorHandler');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '.env') });

// ── Express App ──────────────────────────────────────────────
const app = express();

// Middleware
app.use(cors({
  origin: config.clientUrl,
  credentials: true,
}));
app.use(express.json());

// ── Health Check ─────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'opsacademy-gateway',
    sandboxMode: config.sandboxMode,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ───────────────────────────────────────────────
app.use('/api/sandbox', sandboxRoutes);

// Phase 2: Lab routes will be added here
// app.use('/api/labs', labRoutes);
// app.use('/api/auth', authRoutes);

// ── Error Handler ────────────────────────────────────────────
app.use(errorHandler);

// ── HTTP + WebSocket Server ──────────────────────────────────
const server = http.createServer(app);

// Attach WebSocket terminal handler
attachTerminalWebSocket(server);

// ── Start Server ─────────────────────────────────────────────
server.listen(config.port, () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║          🚀 OpsAcademy API Gateway            ║');
  console.log('  ╠═══════════════════════════════════════════════╣');
  console.log(`  ║  HTTP:      http://localhost:${config.port}            ║`);
  console.log(`  ║  WebSocket: ws://localhost:${config.port}/api/terminal ║`);
  console.log(`  ║  Sandbox:   ${config.sandboxMode.toUpperCase()} mode ${ config.sandboxMode === 'pty' ? '💻' : '🐳'}                    ║`);
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
});

module.exports = { app, server };
