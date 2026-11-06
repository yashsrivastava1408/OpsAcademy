// Runs before each test file: keep sandbox working directories out of the repo.
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.SANDBOXES_DIR = path.join(os.tmpdir(), `opsacademy-test-${process.pid}`);
// The lab of the day depends on the date; its own tests switch it on.
process.env.DAILY_CHALLENGE = 'off';
delete process.env.PLATFORM_ADMIN_EMAILS;
delete process.env.METRICS_TOKEN;
delete process.env.CORS_ORIGINS;
delete process.env.CLIENT_URL;
// Tests sign their own Supabase-style tokens (tests/auth.js); no request ever leaves for a real project.
process.env.SUPABASE_URL = 'https://tests.supabase.test';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
delete process.env.SUPABASE_KEY;
delete process.env.SUPABASE_SECRET_KEY;

// Tests create many users and sandboxes from one address; the limiters get
// their own tests with low limits.
for (const name of ['API', 'AUTH', 'SANDBOX_START', 'AGENT']) {
  process.env[`RATE_LIMIT_${name}`] = '100000';
}
