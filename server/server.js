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
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    // Allow localhost, any vercel.app domain, and configured CLIENT_URL
    if (
      origin.includes('localhost') ||
      origin.includes('vercel.app') ||
      origin.includes('onrender.com') ||
      origin === config.clientUrl
    ) {
      return callback(null, true);
    }
    return callback(null, true);
  },
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

const unitRoutes = require('./routes/unitRoutes');
const labRoutes = require('./routes/labRoutes');
const authRoutes = require('./routes/authRoutes');
const agentRoutes = require('./routes/agentRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const { startReaper } = require('./services/reaperService');

// ── API Routes ───────────────────────────────────────────────
app.use('/api/sandbox', sandboxRoutes);
app.use('/api/units', unitRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/certificates', certificateRoutes);

// Start background auto-reaper for stale sandboxes
startReaper();

// ── Error Handler ────────────────────────────────────────────
app.use(errorHandler);

// ── HTTP + WebSocket Server ──────────────────────────────────
const server = http.createServer(app);

// Attach WebSocket terminal handler
attachTerminalWebSocket(server);

// ── Start Server ─────────────────────────────────────────────
server.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log('  ╔═══════════════════════════════════════════════╗');
  console.log('  ║          🚀 OpsAcademy API Gateway            ║');
  console.log('  ╠═══════════════════════════════════════════════╣');
  console.log(`  ║  HTTP:      http://0.0.0.0:${config.port}              ║`);
  console.log(`  ║  WebSocket: ws://0.0.0.0:${config.port}/api/terminal   ║`);
  console.log(`  ║  Sandbox:   ${config.sandboxMode.toUpperCase()} mode ${ config.sandboxMode === 'pty' ? '💻' : '🐳'}                    ║`);
  console.log('  ╚═══════════════════════════════════════════════╝');
  console.log('');
});

module.exports = { app, server };
