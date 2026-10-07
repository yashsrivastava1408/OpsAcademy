/**
 * Prometheus metrics for the gateway. Scraped from GET /metrics.
 */

const client = require('prom-client');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'opsacademy_' });

const httpDuration = new client.Histogram({
  name: 'opsacademy_http_request_duration_seconds',
  help: 'HTTP request duration by route, method and status',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const sandboxClaimDuration = new client.Histogram({
  name: 'opsacademy_sandbox_claim_duration_seconds',
  help: 'Time to hand a sandbox to a student, split by pool hit or cold start',
  labelNames: ['source'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [registry],
});

const sandboxesActive = new client.Gauge({
  name: 'opsacademy_sandboxes_active',
  help: 'Sandboxes currently assigned to a student',
  registers: [registry],
});

const sandboxPoolAvailable = new client.Gauge({
  name: 'opsacademy_sandbox_pool_available',
  help: 'Pre-warmed sandboxes waiting to be claimed',
  registers: [registry],
});

const sandboxesReaped = new client.Counter({
  name: 'opsacademy_sandboxes_reaped_total',
  help: 'Sandboxes destroyed by the reaper',
  labelNames: ['reason'],
  registers: [registry],
});

const terminalConnections = new client.Gauge({
  name: 'opsacademy_terminal_connections',
  help: 'Open terminal WebSocket connections',
  registers: [registry],
});

const commandsBlocked = new client.Counter({
  name: 'opsacademy_commands_blocked_total',
  help: 'Terminal commands stopped by the abuse tripwire',
  labelNames: ['rule'],
  registers: [registry],
});

const labVerifications = new client.Counter({
  name: 'opsacademy_lab_verifications_total',
  help: 'Lab step verification results',
  labelNames: ['unit', 'result'],
  registers: [registry],
});

const hintRequests = new client.Counter({
  name: 'opsacademy_hint_requests_total',
  help: 'AI mentor hint requests by tier and where the answer came from',
  labelNames: ['tier', 'source'],
  registers: [registry],
});

const aiHubDuration = new client.Histogram({
  name: 'opsacademy_ai_hub_request_duration_seconds',
  help: 'Round-trip time of calls to the AI hub',
  labelNames: ['endpoint', 'outcome'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
  registers: [registry],
});

/**
 * Express middleware recording request duration. Uses the matched route
 * pattern (not the raw URL) so label cardinality stays bounded.
 */
function httpMetrics(req, res, next) {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    end({ method: req.method, route, status: res.statusCode });
  });
  next();
}

module.exports = {
  registry,
  httpMetrics,
  sandboxClaimDuration,
  sandboxesActive,
  sandboxPoolAvailable,
  sandboxesReaped,
  terminalConnections,
  commandsBlocked,
  labVerifications,
  hintRequests,
  aiHubDuration,
};
