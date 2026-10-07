/**
 * Express application — routes and middleware, without the network listener.
 * server.js starts it; tests import it directly.
 */

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./lib/logger');
const metrics = require('./lib/metrics');
const { getStore } = require('./lib/store');
const rateLimit = require('./middleware/rateLimit');
const errorHandler = require('./middleware/errorHandler');
const { safeEqual } = require('./middleware/auth');
const { getManager } = require('./services/sandboxManager');
const { getHubClient } = require('./services/aiHubClient');
const authRoutes = require('./routes/authRoutes');
const sandboxRoutes = require('./routes/sandboxRoutes');
const unitRoutes = require('./routes/unitRoutes');
const labRoutes = require('./routes/labRoutes');
const agentRoutes = require('./routes/agentRoutes');
const interviewRoutes = require('./routes/interviewRoutes');
const progressRoutes = require('./routes/progressRoutes');
const certificateRoutes = require('./routes/certificateRoutes');
const adminRoutes = require('./routes/adminRoutes');

const PREFLIGHT_MAX_AGE_SECONDS = 2 * 60 * 60; // the most Chrome will honour
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function corsOrigin(origin, callback) {
  // No Origin header: curl, health checks, server-to-server.
  if (!origin || !config.corsOrigins) return callback(null, true);
  if (config.corsOrigins.includes(origin)) return callback(null, true);
  if (!config.isProd && LOCALHOST_ORIGIN.test(origin)) return callback(null, true);
  return callback(null, false);
}

function createApp() {
  const app = express();

  // Behind Render / an ingress the client IP is in X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  // maxAge lets the browser remember the preflight answer. Without it almost
  // every API call from the web app is preceded by an extra OPTIONS request.
  app.use(cors({ origin: corsOrigin, maxAge: PREFLIGHT_MAX_AGE_SECONDS }));
  // Lesson content is 10-25 KB of JSON per unit; gzip cuts it to about a quarter.
  app.use(compression());
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === '/api/health' || req.url === '/api/ready' || req.url === '/metrics' },
  }));
  app.use(metrics.httpMetrics);

  // ── Health Checks ────────────────────────────────────────────
  // Liveness: the process is up.
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'opsacademy-gateway',
      sandboxMode: config.sandboxMode,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness: the gateway can do useful work. The AI hub is reported but
  // does not fail the probe, because hints fall back without it.
  app.get('/api/ready', async (req, res) => {
    const checks = {
      store: getStore().isWritable(),
      aiHub: await getHubClient().isHealthy(),
    };
    const ready = checks.store;
    res.status(ready ? 200 : 503).json({
      status: ready ? (checks.aiHub ? 'ready' : 'degraded') : 'not_ready',
      checks,
      sandbox: getManager().stats(),
    });
  });

  // ── Prometheus Metrics ───────────────────────────────────────
  app.get('/metrics', async (req, res) => {
    if (config.metricsToken) {
      const header = req.headers.authorization || '';
      if (!safeEqual(header, `Bearer ${config.metricsToken}`)) {
        return res.status(401).end();
      }
    }
    res.set('Content-Type', metrics.registry.contentType);
    res.end(await metrics.registry.metrics());
  });

  // ── API Routes ───────────────────────────────────────────────
  app.use('/api', rateLimit.api());
  app.use('/api/auth', authRoutes);
  app.use('/api/sandbox', sandboxRoutes);
  app.use('/api/units', unitRoutes);
  app.use('/api/labs', labRoutes);
  app.use('/api/agent', agentRoutes);
  app.use('/api/interview', interviewRoutes);
  app.use('/api/progress', progressRoutes);
  app.use('/api/certificates', certificateRoutes);
  app.use('/api/admin', adminRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // ── Error Handler ────────────────────────────────────────────
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
