#!/usr/bin/env node
/**
 * Latency benchmark against a running gateway.
 *
 * Measures what a student actually waits for:
 *   start     POST /api/sandbox/start round trip (pool hit or cold start)
 *   prompt    WebSocket connect until the shell prints its first output
 *   keystroke one character sent until its echo comes back
 *
 * Usage:
 *   node scripts/benchmark.js [baseUrl] [--sandboxes 15] [--keystrokes 200]
 *
 * Numbers depend on the machine and on SANDBOX_MODE; quote them with both.
 */

const WebSocket = require('ws');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:4000').replace(/\/$/, '');
const SANDBOXES = flag('sandboxes', 15);
const KEYSTROKES = flag('keystrokes', 200);

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function summarise(samples) {
  const sorted = samples.slice().sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const round = (v) => (v === undefined ? null : Math.round(v * 10) / 10);
  return { n: sorted.length, p50: round(at(50)), p95: round(at(95)), max: round(sorted[sorted.length - 1]) };
}

async function post(path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

function connect(sessionId, token) {
  return new Promise((resolve, reject) => {
    const started = now();
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/terminal?sessionId=${sessionId}&token=${token}`);
    const term = { ws, output: '', promptMs: null };
    ws.on('message', (data) => {
      if (term.promptMs === null) {
        term.promptMs = now() - started;
        resolve(term);
      }
      term.output += data.toString();
    });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('terminal printed nothing within 5s of connecting')), 5000).unref();
  });
}

/** Send one character and wait for the terminal to echo it. */
async function keystroke(term, char) {
  const before = term.output.length;
  const started = now();
  term.ws.send(char);
  while (term.output.length === before) {
    if (now() - started > 2000) throw new Error('no echo within 2s');
    await new Promise((resolve) => setImmediate(resolve));
  }
  return now() - started;
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const before = (await (await fetch(`${BASE}/api/sandbox/stats`)).json()).data;
  console.log(`\nBenchmark against ${BASE}  (sandbox mode: ${health.sandboxMode}, pool: ${before.pool.enabled ? `${before.pool.targetSize} warm` : 'off'})\n`);

  const start = { pool: [], cold: [] };
  const prompt = [];
  const keys = [];

  for (let i = 0; i < SANDBOXES; i += 1) {
    const { token } = await post('/api/auth/guest');

    const t0 = now();
    const { data: session } = await post('/api/sandbox/start', token, { labId: 'linux-basics' });
    start[session.fromPool ? 'pool' : 'cold'].push(now() - t0);

    const term = await connect(session.sessionId, token);
    prompt.push(term.promptMs);

    if (i === 0) {
      await sleep(500); // let the shell finish printing its prompt
      for (let k = 0; k < KEYSTROKES; k += 1) keys.push(await keystroke(term, 'x'));
    }

    term.ws.close();
    await fetch(`${BASE}/api/sandbox/${session.sessionId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    await sleep(before.pool.enabled ? 400 : 50); // give the pool time to refill, as between real students
  }

  const report = {
    mode: health.sandboxMode,
    pool: before.pool.enabled,
    startFromPoolMs: summarise(start.pool),
    startColdMs: summarise(start.cold),
    firstPromptMs: summarise(prompt),
    keystrokeEchoMs: summarise(keys),
  };

  const row = (label, s) => console.log(`  ${label.padEnd(34)} ${s.n ? `p50 ${String(s.p50).padStart(7)} ms   p95 ${String(s.p95).padStart(7)} ms   max ${String(s.max).padStart(7)} ms   (n=${s.n})` : 'no samples'}`);
  row('start sandbox (pool hit)', report.startFromPoolMs);
  row('start sandbox (cold)', report.startColdMs);
  row('connect to first shell output', report.firstPromptMs);
  row('keystroke to echo', report.keystrokeEchoMs);
  console.log(`\n${JSON.stringify(report)}\n`);
}

main().catch((err) => {
  console.error(`Benchmark failed: ${err.message}`);
  process.exit(1);
});
