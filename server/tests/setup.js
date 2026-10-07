// Runs before each test file: keep sandbox working directories out of the repo.
const os = require('os');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.SANDBOXES_DIR = path.join(os.tmpdir(), `opsacademy-test-${process.pid}`);
delete process.env.ADMIN_TOKEN;
delete process.env.METRICS_TOKEN;
delete process.env.CORS_ORIGINS;
delete process.env.CLIENT_URL;

// Tests create many users and sandboxes from one address; the limiters get
// their own tests with low limits.
for (const name of ['API', 'AUTH', 'GUEST', 'SANDBOX_START', 'AGENT']) {
  process.env[`RATE_LIMIT_${name}`] = '100000';
}
