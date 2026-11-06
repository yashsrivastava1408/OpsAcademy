const { spawnSync } = require('child_process');
const path = require('path');

/** Load config/index.js in a clean production-like process with exactly these environment variables. */
function loadConfig(env) {
  const run = spawnSync('node', ['-e', "require('./config'); console.log('loaded')"], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, NODE_ENV: 'production', ...env },
    encoding: 'utf8',
  });
  return { ok: run.status === 0, out: `${run.stdout}${run.stderr}` };
}

test('a lab node agent starts in production without the gateway\'s secrets', () => {
  const agent = loadConfig({ LAB_NODE: 'on', NODE_TOKEN: 'n'.repeat(40) });
  expect(agent.ok).toBe(true);
});

test('the gateway still refuses to start in production without JWT_SECRET', () => {
  const gateway = loadConfig({});
  expect(gateway.ok).toBe(false);
  expect(gateway.out).toMatch(/JWT_SECRET must be set/);
});

test('a lab node still needs its own token in production', () => {
  const agent = loadConfig({ LAB_NODE: 'on' });
  expect(agent.ok).toBe(false);
  expect(agent.out).toMatch(/NODE_TOKEN/);
});
