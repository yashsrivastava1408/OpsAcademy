#!/usr/bin/env node
/**
 * Load test: many students using the platform at the same time.
 *
 * Each simulated student does what the lab page does for a real one: gets a
 * guest identity, starts a sandbox, opens the terminal, then for the whole
 * run types commands at a human pace while the page's background polling
 * (command history every 4 s, the inspector every 5 s) carries on, and now
 * and then verifies a lab step and asks the mentor for a hint.
 *
 * It reports what students would feel (keystroke echo, command round trip,
 * verify and hint times), every failed request, and what the gateway
 * process used while it ran.
 *
 * Usage:
 *   node scripts/loadtest.js [baseUrl] [--students 25] [--seconds 60] [--ramp 5]
 *
 * Numbers depend on the machine and on SANDBOX_MODE; quote them with both.
 * The gateway allows 25 sandboxes in total by default (SANDBOX_MAX_TOTAL),
 * so more students than that are expected to be refused.
 */

const WebSocket = require('ws');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? Number(args[index + 1]) : fallback;
};
const BASE = (args.find((a) => a.startsWith('http')) || 'http://localhost:4000').replace(/\/$/, '');
const STUDENTS = flag('students', 25);
const SECONDS = flag('seconds', 60);
const RAMP_SECONDS = flag('ramp', 5);
const UNIT = 'linux-basics';
const TYPING_GAP_MS = 120; // about 8 characters a second
const HISTORY_POLL_MS = 4000;
const TELEMETRY_POLL_MS = 5000;

const now = () => Number(process.hrtime.bigint()) / 1e6;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const samples = { start: [], firstPrompt: [], keystroke: [], command: [], verify: [], hint: [], history: [], telemetry: [] };
const errors = [];
const counts = { keystrokes: 0, commands: 0, requests: 0 };

function fail(what, detail) {
  errors.push(`${what}: ${detail}`);
}

async function api(method, path, token, body) {
  counts.requests += 1;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${json && json.error ? json.error : ''}`);
  return json;
}

/** Time a request and record it, or record the failure. */
async function timed(kind, what, request) {
  const started = now();
  try {
    const result = await request();
    samples[kind].push(now() - started);
    return result;
  } catch (err) {
    fail(what, err.message);
    return null;
  }
}

function openTerminal(sessionId, token) {
  return new Promise((resolve, reject) => {
    const started = now();
    const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/api/terminal?sessionId=${sessionId}&token=${token}`);
    const term = { ws, output: '', closed: null };
    ws.on('message', (data) => {
      if (!term.output) {
        samples.firstPrompt.push(now() - started);
        resolve(term);
      }
      term.output += data.toString();
    });
    ws.on('close', (code, reason) => { term.closed = `${code} ${reason}`; });
    ws.on('error', reject);
    setTimeout(() => reject(new Error('terminal printed nothing within 10s')), 10000).unref();
  });
}

/** Type a command one key at a time, timing each echo, then Enter and wait for its output. */
async function typeCommand(term, command, marker) {
  for (const char of command) {
    if (term.closed) throw new Error(`terminal closed (${term.closed})`);
    const before = term.output.length;
    const started = now();
    term.ws.send(char);
    while (term.output.length === before) {
      if (now() - started > 5000) throw new Error('no echo within 5s');
      await sleep(1);
    }
    samples.keystroke.push(now() - started);
    counts.keystrokes += 1;
    await sleep(TYPING_GAP_MS);
  }
  const started = now();
  const from = term.output.length;
  term.ws.send('\r');
  while (!term.output.slice(from).includes(marker)) {
    if (now() - started > 10000) throw new Error(`no output for "${command}" within 10s`);
    await sleep(2);
  }
  samples.command.push(now() - started);
  counts.commands += 1;
}

async function student(index, deadline) {
  let token;
  let sessionId;
  const timers = [];
  try {
    token = (await api('POST', '/api/auth/guest')).token;
    const started = await timed('start', `student ${index} start`, () => api('POST', '/api/sandbox/start', token, { labId: UNIT }));
    if (!started) return;
    sessionId = started.data.sessionId;
    const term = await openTerminal(sessionId, token);

    // The lab page's background polling.
    timers.push(setInterval(() => timed('history', `student ${index} history`, () => api('GET', `/api/sandbox/${sessionId}/history`, token)), HISTORY_POLL_MS));
    timers.push(setInterval(() => timed('telemetry', `student ${index} telemetry`, () => api('GET', `/api/sandbox/${sessionId}/telemetry`, token)), TELEMETRY_POLL_MS));

    await sleep(300);
    let round = 0;
    let workDone = false;
    while (now() < deadline) {
      round += 1;
      // The answer is computed by the shell, so the marker is not in the echo of the typed text.
      await typeCommand(term, `echo round-$((${round}*7))-s${index}`, `round-${round * 7}-s${index}`);

      if (round === 2 && !workDone) {
        // Step 2 of the lab, so the verification below has real work to find.
        await typeCommand(term, 'mkdir -p webapp/src webapp/public webapp/config && touch webapp/src/index.js webapp/public/index.html webapp/config/app.conf && echo made-$((6*7))', 'made-42');
        workDone = true;
      }
      if (round % 3 === 0) {
        const result = await timed('verify', `student ${index} verify`, () => api('POST', `/api/labs/${UNIT}/verify`, token, { sessionId, stepNumber: 2 }));
        if (result && workDone && !result.allPassed) fail(`student ${index} verify`, 'step 2 did not pass after the work was done');
      }
      if (round === 4) {
        const hint = await timed('hint', `student ${index} hint`, () => api('POST', '/api/agent/hint', token, { query: 'verify keeps failing, what am I missing?', unitId: UNIT, stepNumber: 3, sessionId }));
        if (hint && hint.data.fallback) fail(`student ${index} hint`, 'answered by the offline fallback, not the AI hub');
      }
      await sleep(400 + Math.random() * 800); // reading the output
    }
    term.ws.close();
  } catch (err) {
    fail(`student ${index}`, err.message);
  } finally {
    timers.forEach(clearInterval);
    if (sessionId) await api('DELETE', `/api/sandbox/${sessionId}`, token).catch((err) => fail(`student ${index} stop`, err.message));
  }
}

/** A few numbers about the gateway process, from its own /metrics. */
async function gatewayUsage() {
  const text = await (await fetch(`${BASE}/metrics`)).text().catch(() => '');
  const value = (name) => {
    const match = text.match(new RegExp(`^${name}(?:\\{[^}]*\\})? ([0-9.e+-]+)$`, 'm'));
    return match ? Number(match[1]) : null;
  };
  return {
    cpuSeconds: value('opsacademy_process_cpu_seconds_total'),
    residentMb: value('opsacademy_process_resident_memory_bytes') === null ? null : value('opsacademy_process_resident_memory_bytes') / 1048576,
    loopLagP99Ms: value('opsacademy_nodejs_eventloop_lag_p99_seconds') === null ? null : value('opsacademy_nodejs_eventloop_lag_p99_seconds') * 1000,
  };
}

function summarise(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
  const round = (v) => (v === undefined ? null : Math.round(v * 10) / 10);
  return { n: sorted.length, p50: round(at(50)), p95: round(at(95)), p99: round(at(99)), max: round(sorted[sorted.length - 1]) };
}

async function main() {
  const health = await (await fetch(`${BASE}/api/health`)).json();
  const stats = (await (await fetch(`${BASE}/api/sandbox/stats`)).json()).data;
  console.log(`\nLoad test against ${BASE}: ${STUDENTS} students for ${SECONDS}s (sandbox mode: ${health.sandboxMode}, capacity ${stats.capacity}, pool ${stats.pool.enabled ? stats.pool.targetSize : 'off'})\n`);

  const before = await gatewayUsage();
  const startedAt = now();
  const deadline = startedAt + SECONDS * 1000;
  let peak = 0;
  const watcher = setInterval(async () => {
    const live = await fetch(`${BASE}/api/sandbox/stats`).then((res) => res.json()).catch(() => null);
    if (live) peak = Math.max(peak, live.data.activeSessions);
  }, 1000);

  await Promise.all(Array.from({ length: STUDENTS }, async (_, index) => {
    await sleep((RAMP_SECONDS * 1000 * index) / STUDENTS);
    await student(index + 1, deadline);
  }));
  clearInterval(watcher);
  const elapsed = (now() - startedAt) / 1000;
  const after = await gatewayUsage();
  const left = (await (await fetch(`${BASE}/api/sandbox/stats`)).json()).data.activeSessions;

  const report = {
    mode: health.sandboxMode,
    students: STUDENTS,
    seconds: Math.round(elapsed),
    peakSandboxes: peak,
    sandboxesLeftRunning: left,
    keystrokes: counts.keystrokes,
    commands: counts.commands,
    httpRequests: counts.requests,
    errors: errors.length,
    startSandboxMs: summarise(samples.start),
    firstPromptMs: summarise(samples.firstPrompt),
    keystrokeEchoMs: summarise(samples.keystroke),
    commandMs: summarise(samples.command),
    verifyStepMs: summarise(samples.verify),
    hintMs: summarise(samples.hint),
    historyPollMs: summarise(samples.history),
    telemetryPollMs: summarise(samples.telemetry),
    gateway: {
      cpuPercentOfOneCore: before.cpuSeconds === null ? null : Math.round(((after.cpuSeconds - before.cpuSeconds) / elapsed) * 1000) / 10,
      residentMbBefore: before.residentMb === null ? null : Math.round(before.residentMb),
      residentMbAfter: after.residentMb === null ? null : Math.round(after.residentMb),
      eventLoopLagP99Ms: after.loopLagP99Ms === null ? null : Math.round(after.loopLagP99Ms * 10) / 10,
    },
  };

  const row = (label, s) => console.log(`  ${label.padEnd(30)} ${s.n ? `p50 ${String(s.p50).padStart(7)} ms   p95 ${String(s.p95).padStart(7)} ms   p99 ${String(s.p99).padStart(7)} ms   max ${String(s.max).padStart(7)} ms   (n=${s.n})` : 'no samples'}`);
  row('start a sandbox', report.startSandboxMs);
  row('connect to first shell output', report.firstPromptMs);
  row('keystroke to echo', report.keystrokeEchoMs);
  row('Enter to command output', report.commandMs);
  row('verify a lab step', report.verifyStepMs);
  row('mentor hint', report.hintMs);
  row('history poll', report.historyPollMs);
  row('inspector poll', report.telemetryPollMs);
  console.log(`\n  ${counts.keystrokes} keystrokes, ${counts.commands} commands, ${counts.requests} HTTP requests in ${report.seconds}s; peak ${peak} sandboxes at once; ${left} left running afterwards`);
  console.log(`  gateway: ${report.gateway.cpuPercentOfOneCore}% of one CPU core, memory ${report.gateway.residentMbBefore} -> ${report.gateway.residentMbAfter} MB, event-loop lag p99 ${report.gateway.eventLoopLagP99Ms} ms`);
  console.log(`  errors: ${errors.length}`);
  const kinds = new Map();
  for (const error of errors) {
    const key = error.replace(/student \d+/g, 'student N').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, 'ID');
    kinds.set(key, (kinds.get(key) || 0) + 1);
  }
  for (const [kind, count] of [...kinds].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${count} x ${kind}`);
  console.log(`\n${JSON.stringify(report)}\n`);
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`Load test failed: ${err.message}`);
  process.exit(2);
});
