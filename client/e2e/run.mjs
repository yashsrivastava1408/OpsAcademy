#!/usr/bin/env node
/**
 * Runs the browser tests against a throwaway stack.
 *
 * Builds the client, starts the AI hub, the gateway (PTY sandboxes, data in a
 * temp folder) and a static server for the build, runs each test file, then
 * stops everything it started. Nothing is written into the repository
 * except client/dist.
 *
 *   npm run e2e                 all tests
 *   npm run e2e -- slow-link    only files whose name contains "slow-link"
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.join(here, '..');
const root = path.join(client, '..');
const PORTS = { hub: 5105, gateway: 4100, app: 4173 };
const API_URL = `http://localhost:${PORTS.gateway}`;
const APP_URL = `http://localhost:${PORTS.app}`;
const TESTS = ['walkthrough.mjs', 'slow-link.mjs', 'features.mjs'].filter((file) => !process.argv[2] || file.includes(process.argv[2]));

// e.g. E2E_STORE_DRIVER=sqlite runs the same tests on the SQLite store.
const extraGatewayEnv = process.env.E2E_STORE_DRIVER ? { STORE_DRIVER: process.env.E2E_STORE_DRIVER } : {};
// Where a failing run leaves its evidence: a screenshot per test file and the servers' logs.
const artifacts = path.join(client, 'e2e-artifacts');
rmSync(artifacts, { recursive: true, force: true });

const scratch = mkdtempSync(path.join(tmpdir(), 'opsacademy-e2e-'));
const children = [];

function start(name, command, args, options) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.log = '';
  child.stdout.on('data', (chunk) => { child.log += chunk; });
  child.stderr.on('data', (chunk) => { child.log += chunk; });
  child.name = name;
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) child.kill('SIGTERM');
  rmSync(scratch, { recursive: true, force: true });
}

async function waitFor(url, accept, seconds = 60) {
  for (let i = 0; i < seconds * 2; i += 1) {
    try {
      const res = await fetch(url);
      if (await accept(res)) return;
    } catch { /* not listening yet */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not come up`);
}

let failed = false;
try {
  console.log('Building the client...');
  const build = spawnSync('npx', ['vite', 'build'], { cwd: client, env: { ...process.env, VITE_API_URL: API_URL }, encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`client build failed\n${build.stdout}${build.stderr}`);

  start('ai-hub', process.env.PYTHON || 'python3', ['app.py'], { cwd: path.join(root, 'ai-hub'), env: { ...process.env, PORT: String(PORTS.hub) } });
  start('gateway', 'node', ['server.js'], {
    cwd: path.join(root, 'server'),
    env: {
      ...process.env,
      PORT: String(PORTS.gateway),
      NODE_ENV: 'development',
      SANDBOX_MODE: 'pty',
      // The same shell on every machine, so the terminal tests see the same echo and completion.
      SANDBOX_SHELL: '/bin/bash',
      AI_HUB_URL: `http://localhost:${PORTS.hub}`,
      DATA_DIR: path.join(scratch, 'data'),
      SANDBOXES_DIR: path.join(scratch, 'sandboxes'),
      LOG_LEVEL: 'warn',
      ADMIN_TOKEN: 'e2e-admin-token',
      ...extraGatewayEnv,
    },
  });
  start('client', 'npx', ['vite', 'preview', '--port', String(PORTS.app), '--strictPort'], { cwd: client });

  await waitFor(`${API_URL}/api/ready`, async (res) => (await res.json()).status === 'ready');
  await waitFor(APP_URL, (res) => res.ok);
  console.log('Stack is up.\n');

  for (const file of TESTS) {
    console.log(`── ${file} ──`);
    const run = spawnSync('node', [path.join(here, file)], { stdio: 'inherit', env: { ...process.env, APP_URL, API_URL, E2E_ARTIFACTS: artifacts } });
    if (run.status !== 0) failed = true;
    console.log('');
  }
} catch (err) {
  failed = true;
  console.error(err.message);
  for (const child of children) console.error(`\n--- ${child.name} log ---\n${child.log.slice(-3000)}`);
} finally {
  if (failed) {
    mkdirSync(artifacts, { recursive: true });
    for (const child of children) writeFileSync(path.join(artifacts, `${child.name}.log`), child.log);
    console.error(`Logs and screenshots from this run are in ${artifacts}`);
  }
  stopAll();
}
process.exit(failed ? 1 : 0);
