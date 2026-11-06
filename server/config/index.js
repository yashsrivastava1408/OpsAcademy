const path = require('path');
const os = require('os');

// Load .env file
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';

const DEV_JWT_SECRET = 'dev-only-insecure-default-do-not-use-in-production';

function int(name, fallback) {
  const parsed = parseInt(process.env[name], 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * AI_HUB_URL may arrive as a bare host or host:port (Render's `fromService`
 * gives no scheme), so normalise it to a full URL.
 */
function normaliseUrl(raw, defaultPort) {
  // Local default is 5005: on macOS, port 5000 belongs to AirPlay Receiver.
  if (!raw) return 'http://localhost:5005';
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = `http://${url}`;
  const hasPort = /:\d+$/.test(url.replace(/^https?:\/\//, ''));
  if (!hasPort && !url.startsWith('https://')) url = `${url}:${defaultPort}`;
  return url;
}

// Our own sign-in (email + password, guests, HS256 tokens) is the legacy path. LEGACY_AUTH=off
// completes the move to Supabase Auth (ADR 0003): the gateway then only verifies Supabase sessions.
const legacyAuth = process.env.LEGACY_AUTH !== 'off';

const jwtSecret = process.env.JWT_SECRET || DEV_JWT_SECRET;
if (isProd && jwtSecret === DEV_JWT_SECRET && (legacyAuth || !process.env.CERT_SECRET)) {
  // Signing tokens and certificates with a public default would let anyone forge them.
  throw new Error(legacyAuth ? 'JWT_SECRET must be set when NODE_ENV=production' : 'CERT_SECRET must be set when NODE_ENV=production');
}
if (isProd && !legacyAuth && !(process.env.SUPABASE_URL && process.env.SUPABASE_PUBLISHABLE_KEY)) {
  throw new Error('LEGACY_AUTH=off needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY (nothing else can sign users in)');
}

const config = {
  env,
  isProd,
  isTest: env === 'test',
  port: int('PORT', 4000),

  // 'all' = HTTP API + WebSocket terminal | 'api' = HTTP API only | 'terminal' = WebSocket terminal only
  serviceRole: (process.env.SERVICE_ROLE || 'all').toLowerCase(),

  // 'pty' = local shell via node-pty | 'docker' = Docker containers via dockerode
  sandboxMode: process.env.SANDBOX_MODE || 'pty',

  legacyAuth,

  // JWT (legacy sign-in only)
  jwtSecret,
  jwtExpiry: process.env.JWT_EXPIRY || '7d',
  guestJwtExpiry: '30d',

  // Certificates are signed with their own key so it can be rotated separately.
  certSecret: process.env.CERT_SECRET || `${jwtSecret}:certificates`,

  // Verified emails that are platform admins (the first operator). More are granted
  // with `npm run grant-role`. Comma separated.
  platformAdminEmails: (process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
  // If set, /metrics requires `Authorization: Bearer <token>`.
  metricsToken: process.env.METRICS_TOKEN || null,

  // Email. Without a provider key the links are only written to the log.
  mail: {
    driver: (process.env.MAIL_DRIVER || (process.env.RESEND_API_KEY ? 'resend' : (env === 'test' ? 'memory' : 'log'))).toLowerCase(),
    resendApiKey: process.env.RESEND_API_KEY || null,
    from: process.env.MAIL_FROM || 'OpsAcademy <onboarding@resend.dev>',
  },
  // Where links in emails point (the web app, not this API).
  appUrl: (process.env.APP_URL || process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, ''),

  // AI Hub
  aiHubUrl: normaliseUrl(process.env.AI_HUB_URL, int('AI_HUB_PORT', 5000)),
  aiHubToken: process.env.AI_HUB_TOKEN || null,
  aiHubTimeoutMs: int('AI_HUB_TIMEOUT_MS', 10000),

  dockerSocketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',

  // CORS: when CORS_ORIGINS (or CLIENT_URL) is set, only those origins are
  // allowed. Left unset, any origin may call the API — acceptable because
  // auth is a bearer token, never a cookie, so a foreign site has nothing to ride on.
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  corsOrigins: list('CORS_ORIGINS', process.env.CLIENT_URL ? [process.env.CLIENT_URL] : null),

  // "Lab of the day" bonus on the dashboard. DAILY_CHALLENGE=off disables it.
  dailyChallenge: process.env.DAILY_CHALLENGE !== 'off',


  // Supabase
  supabaseUrl: process.env.SUPABASE_URL || null,
  supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || null,
  // The refresh token lives in this HttpOnly cookie, never in script-readable storage.
  // SameSite=Lax suits a web app and API on the same site; use "none" (needs HTTPS) for different sites.
  authCookie: {
    name: 'oa_rt',
    sameSite: (process.env.AUTH_COOKIE_SAMESITE || 'lax').toLowerCase(),
    secure: isProd || process.env.AUTH_COOKIE_SECURE === 'on',
    maxAgeSeconds: 30 * 24 * 60 * 60,
  },

  // Postgres (Supabase). Use the transaction-pooler connection string here and the
  // direct one for migrations (MIGRATION_DATABASE_URL). Required in production.
  databaseUrl: process.env.DATABASE_URL || null,
  databasePoolSize: int('DATABASE_POOL_SIZE', 10),
  // Optional CA bundle (PEM text or a file path in DATABASE_CA_FILE) to verify the server certificate.
  databaseCa: process.env.DATABASE_CA || (process.env.DATABASE_CA_FILE ? require('fs').readFileSync(process.env.DATABASE_CA_FILE, 'utf8') : null),

  rateLimit: {
    windowMs: 60 * 1000,
    apiPerWindow: int('RATE_LIMIT_API', 300),
    authPerWindow: int('RATE_LIMIT_AUTH', 20),
    // Higher than sign-in: a whole classroom can share one public IP.
    guestPerWindow: int('RATE_LIMIT_GUEST', 60),
    sandboxStartPerWindow: int('RATE_LIMIT_SANDBOX_START', 10),
    agentPerWindow: int('RATE_LIMIT_AGENT', 30),
    // A campus shares one public IP. Requests from these addresses or CIDR
    // ranges (comma separated, e.g. "203.0.113.7,198.51.100.0/24") get their
    // limits multiplied, so a classroom can sign in together without 429s.
    campusIps: (process.env.CAMPUS_IPS || '').split(',').map((v) => v.trim()).filter(Boolean),
    campusMultiplier: int('CAMPUS_RATE_MULTIPLIER', 15),
  },

  // Sandbox settings
  sandbox: {
    maxMemoryMB: int('SANDBOX_MEMORY_MB', 256),
    maxCpuCores: parseFloat(process.env.SANDBOX_CPUS) || 0.5,
    maxPids: int('SANDBOX_PIDS_LIMIT', 128),
    homeSizeMB: int('SANDBOX_HOME_MB', 64),
    maxSessionMinutes: int('SANDBOX_MAX_MINUTES', 30),
    maxInactivityMinutes: int('SANDBOX_IDLE_MINUTES', 15),
    maxPerUser: int('SANDBOX_MAX_PER_USER', 2),
    maxTotal: int('SANDBOX_MAX_TOTAL', 25),
    poolSize: int('SANDBOX_POOL_SIZE', 3),
    enablePool: process.env.ENABLE_SANDBOX_POOL !== 'false',
    reaperIntervalMs: int('SANDBOX_REAPER_INTERVAL_MS', 60 * 1000),
    execTimeoutMs: 10000,
    // 'none' = no network at all | 'internal' = per-session bridge with no route out
    // | 'bridge' = outbound internet allowed (only for labs that need it).
    dockerNetworkMode: process.env.SANDBOX_NETWORK || 'none',
    dockerImage: process.env.SANDBOX_IMAGE || 'opsacademy-sandbox:latest',
    dockerSeccompProfile: process.env.SANDBOX_SECCOMP_PROFILE || null,
    sandboxesDir: process.env.SANDBOXES_DIR || path.join(__dirname, '..', 'sandboxes'),
    // Ports the labs tell a student to use, exported to every sandbox as
    // $WEB_PORT, $APP_PORT and $SITE_PORT. A container has its own loopback,
    // so every container gets these same numbers. PTY shells share the
    // host's ports, so each one is given its own block starting at ptyPortBase.
    labPorts: { WEB_PORT: 8080, APP_PORT: 9090, SITE_PORT: 8000 },
    ptyPortBase: int('SANDBOX_PORT_BASE', 20000),
    // The lab simulators (docker, kubectl, aws). The sandbox image has them in
    // /usr/local/bin; PTY shells get this folder put first on their PATH.
    toolsDir: process.env.SANDBOX_TOOLS_DIR || path.join(__dirname, '..', '..', 'sandbox-image', 'bin'),
    defaultShell: process.env.SANDBOX_SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/sh'),
    // Commands blocked by the terminal tripwire before the session is reaped.
    maxStrikes: 3,
    historyLimit: 200,
  },
};

module.exports = config;
