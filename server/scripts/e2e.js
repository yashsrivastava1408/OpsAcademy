#!/usr/bin/env node
/**
 * End-to-end check against a running gateway (and AI hub).
 *
 * Plays a student from first visit to certificate: starts a sandbox, types
 * the whole Linux Fundamentals lab into the terminal over WebSocket, verifies
 * each step, asks the mentor for hints, answers an interview question,
 * creates an account and checks the certificate publicly. Also checks that a
 * second user cannot touch the first user's sandbox.
 *
 * Usage:
 *   node scripts/e2e.js [baseUrl]        default http://localhost:4000
 *
 * Exits 1 if any check fails.
 */

const WebSocket = require('ws');

const BASE = (process.argv[2] || process.env.E2E_BASE_URL || 'http://localhost:4000').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const UNIT = 'linux-basics';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
}

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* metrics are plain text */ }
  return { status: res.status, json, text };
}

function waitFor(predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 25);
    };
    tick();
  });
}

function openTerminal(sessionId, token) {
  const ws = new WebSocket(`${WS_BASE}/api/terminal?sessionId=${sessionId}&token=${token}`);
  const term = { ws, output: '', closed: null, status: null };
  ws.on('message', (data) => { term.output += data.toString(); });
  ws.on('close', (code, reason) => { term.closed = { code, reason: reason.toString() }; });
  term.ready = new Promise((resolve) => {
    ws.on('open', () => resolve(true));
    ws.on('unexpected-response', (req, res) => { term.status = res.statusCode; resolve(false); });
    ws.on('error', () => resolve(false));
  });
  let marker = 0;
  /** Type a command and wait until the shell has finished running it. */
  term.run = async (command) => {
    marker += 1;
    const done = `__done_${marker}_`;
    // The marker is assembled by the shell, so it only appears once the command has run.
    ws.send(`${command}; echo ${done}$((1+1))\r`);
    await waitFor(() => term.output.includes(`${done}2`));
  };
  return term;
}

async function main() {
  console.log(`\nOpsAcademy end-to-end check against ${BASE}\n`);

  // ── Service health ──────────────────────────────────────────
  const health = await api('GET', '/api/health');
  check('gateway is healthy', health.status === 200 && health.json.status === 'ok');
  const mode = health.json.sandboxMode;
  // Docker sandboxes have the real /home/student; PTY mode maps it to a per-session folder.
  const home = mode === 'docker' ? '/home/student' : '~';

  const ready = await api('GET', '/api/ready');
  check('gateway is ready and the AI hub is reachable', ready.json.status === 'ready', JSON.stringify(ready.json.checks));

  // ── Identity and sandbox ────────────────────────────────────
  const guest = (await api('POST', '/api/auth/guest')).json;
  const token = guest.token;
  check('visitor gets a guest identity', Boolean(token) && guest.user.guest === true);

  check('sandbox cannot be started without a token', (await api('POST', '/api/sandbox/start', { body: {} })).status === 401);

  const started = await api('POST', '/api/sandbox/start', { token, body: { labId: UNIT } });
  const session = started.json.data;
  check('sandbox starts', started.status === 201 && Boolean(session.sessionId), started.text);
  console.log(`        mode=${session.mode} fromPool=${session.fromPool} claim=${session.claimMs}ms`);

  const status = await api('GET', `/api/sandbox/${session.sessionId}/status`, { token });
  check('a sandbox claimed from the pool is found by its session id', status.status === 200);

  const term = openTerminal(session.sessionId, token);
  check('terminal WebSocket connects', await term.ready);

  // ── Isolation between users ─────────────────────────────────
  const other = (await api('POST', '/api/auth/guest')).json.token;
  check("another user cannot read this sandbox's status", (await api('GET', `/api/sandbox/${session.sessionId}/status`, { token: other })).status === 404);
  check("another user cannot stop this sandbox", (await api('DELETE', `/api/sandbox/${session.sessionId}`, { token: other })).status === 404);
  const intruder = openTerminal(session.sessionId, other);
  check("another user's terminal connection is refused (403)", (await intruder.ready) === false && intruder.status === 403);
  const anonymous = openTerminal(session.sessionId, '');
  check('a terminal connection without a token is refused (401)', (await anonymous.ready) === false && anonymous.status === 401);

  // ── The lab ─────────────────────────────────────────────────
  const verify = async (stepNumber) => (await api('POST', `/api/labs/${UNIT}/verify`, { token, body: { sessionId: session.sessionId, stepNumber } })).json;
  const stepPassed = async (n) => { const r = await verify(n); return r.results[0].passed; };

  check('step 2 fails before any work is done', (await stepPassed(2)) === false);

  await term.run('pwd');
  await term.run('ls -la');
  check('terminal runs commands and streams output', term.output.includes('__done_2_2'));

  await term.run('mkdir webapp');
  await term.run('mkdir webapp/src');

  // Mentor, mid-lab: two directories and all three files are still missing.
  const hint = async (extra = {}) => (await api('POST', '/api/agent/hint', {
    token, body: { query: 'verify keeps failing, what am I missing?', unitId: UNIT, stepNumber: 2, sessionId: session.sessionId, ...extra },
  })).json.data;

  const tier1 = await hint();
  check('hint tier 1 comes from the AI hub, not the fallback', tier1.tier === 1 && !tier1.fallback, JSON.stringify(tier1).slice(0, 200));
  const tier2 = await hint();
  check('hint tier 2 names what is missing in this sandbox', tier2.tier === 2 && tier2.hint.includes('webapp/public') && tier2.hint.includes('webapp/config'), tier2.hint);
  check('hint tier 2 does not list what already exists as missing', !tier2.diagnostics.missing.includes('webapp/src'));
  const tier3 = await hint();
  check('hint tier 3 points at the next task with a command form', tier3.tier === 3 && tier3.hint.includes('mkdir -p <dir>') && tier3.nextTier === null, tier3.hint);
  check('no hint reveals the verification command', ![tier1, tier2, tier3].some((h) => h.hint.includes('echo PASS')));

  await term.run('mkdir webapp/public webapp/config');
  await term.run('touch webapp/src/index.js webapp/public/index.html webapp/config/app.conf');
  check('step 2 passes after creating the project structure', await stepPassed(2));

  check('step 3 fails before the files have content', (await stepPassed(3)) === false);
  await term.run(`echo '<html><body><h1>OpsAcademy</h1></body></html>' > webapp/public/index.html`);
  await term.run(`echo "console.log('OpsAcademy');" > webapp/src/index.js`);
  check('step 3 passes after writing the files', await stepPassed(3));

  check('step 4 fails before permissions are set', (await stepPassed(4)) === false);
  await term.run('chmod +x webapp/src/index.js');
  await term.run('chmod 444 webapp/config/app.conf');
  check('step 4 passes after chmod', await stepPassed(4));

  check('step 5 fails before the log exists', (await stepPassed(5)) === false);
  await term.run(`for i in $(seq 1 50); do echo "Line $i: $([ $((i % 3)) -eq 0 ] && echo ERROR || echo INFO) message" >> ${home}/app.log; done`);
  await term.run(`grep ERROR ${home}/app.log | wc -l`);
  check('step 5 passes after creating the log', await stepPassed(5));

  check('step 7 fails before the script exists', (await stepPassed(7)) === false);
  await term.run(`cd ${home} && echo '#!/bin/bash' > heartbeat.sh && echo 'date >> ${home}/heartbeat.log' >> heartbeat.sh`);
  await term.run('chmod +x heartbeat.sh && ./heartbeat.sh && cat heartbeat.log');
  check('step 7 passes after creating and running the script', await stepPassed(7));

  // ── History, telemetry, tripwire ────────────────────────────
  const history = (await api('GET', `/api/sandbox/${session.sessionId}/history`, { token })).json.data.map((h) => h.command);
  check('typed commands are recorded in session history', history.some((c) => c.startsWith('mkdir webapp/public')) && history.length >= 10, `${history.length} commands`);

  const telemetry = (await api('GET', `/api/sandbox/${session.sessionId}/telemetry`, { token })).json.data;
  const paths = telemetry.fileTree.map((f) => f.path);
  check('telemetry lists the files the student created', paths.includes('webapp/config/app.conf') && paths.includes('heartbeat.sh'), paths.join(','));

  const before = term.output.length;
  term.ws.send('nsenter -t 1 -m sh\r');
  await waitFor(() => term.output.slice(before).includes('Command blocked (host_escape)')).catch(() => {});
  check('a hostile command is blocked with a visible warning', term.output.slice(before).includes('Command blocked (host_escape). Strike 1 of 3'));
  await term.run('echo still-alive');
  check('the terminal still works after a blocked command', true);

  // ── Whole-unit verification and progress ────────────────────
  const full = await verify();
  check('the whole unit verifies and is marked complete', full.allPassed && full.unitCompleted, JSON.stringify(full.results.map((r) => [r.step, r.passed])));

  const progress = (await api('GET', '/api/progress', { token })).json.data;
  check('progress shows the unit completed, XP earned and a streak', progress.completedUnits.includes(UNIT) && progress.xp >= 240 && progress.streak.current === 1, JSON.stringify({ xp: progress.xp, streak: progress.streak }));
  check('hints used are recorded as a weak topic', progress.weakTopics.some((w) => w.unitId === UNIT && w.hints === 3));

  // ── Learn / Prepare features ────────────────────────────────
  const learn = (await api('GET', `/api/units/${UNIT}/learn`)).json.data;
  const section = (learn.sections || learn.modules).find((s) => s.quiz);
  const quiz = (await api('POST', '/api/progress/quiz', { token, body: { unitId: UNIT, sectionId: section.id, answerIndex: section.quiz.correctIndex } })).json;
  check('a correct quiz answer is checked server-side and awards XP', quiz.correct === true && quiz.xpAwarded === 25);

  const practice = (await api('GET', `/api/units/${UNIT}/practice`)).text;
  check('lab content sent to the browser has no verification commands', !practice.includes('verification') && !practice.includes('echo PASS'));

  const deck = (await api('GET', `/api/progress/flashcards/${UNIT}`, { token })).json.data;
  const reviewed = (await api('POST', `/api/progress/flashcards/${UNIT}/${deck.cards[0].id}/review`, { token, body: { grade: 4 } })).json.data;
  const deckAfter = (await api('GET', `/api/progress/flashcards/${UNIT}`, { token })).json.data;
  check('reviewing a flashcard schedules it for later', reviewed.intervalDays === 1 && deckAfter.dueCount === deck.dueCount - 1);

  const questions = (await api('GET', `/api/interview/${UNIT}/questions`, { token })).json.data;
  const answerQuestion = async (answer) => {
    const res = await api('POST', `/api/interview/${UNIT}/${questions[0].id}/answer`, { token, body: { answer } });
    if (res.status !== 200) throw new Error(`interview scoring returned ${res.status}: ${res.text}`);
    return res.json.data;
  };
  const good = await answerQuestion( 'First I run df -h to see which partition is full. Then du -sh on the top directories to find what is using the space, and find with -size to locate large files, usually under /var/log. I clean up by rotating logs with logrotate and removing old archives, and I prevent it happening again with log rotation and disk usage alerts.');
  const weak = await answerQuestion('I would restart the server and hope that the problem goes away by itself.');
  check('a strong interview answer scores well and a weak one does not', good.score >= 70 && weak.score < 30 && good.xpAwarded === 30, `good=${good.score} weak=${weak.score}`);
  check('interview feedback lists covered and missed key points', good.covered.length >= 3 && weak.missed.length >= 3);

  // ── Certificate ─────────────────────────────────────────────
  const guestCert = await api('POST', '/api/certificates', { token, body: { unitId: UNIT } });
  check('a guest cannot be issued a certificate', guestCert.status === 403);

  const email = `e2e-${Date.now()}@example.com`;
  const account = (await api('POST', '/api/auth/register', { token, body: { name: 'E2E Student', email, password: 'correct-horse-battery' } })).json;
  check('registering keeps the guest account and its progress', account.user.id === guest.user.id && account.user.guest === false);
  const userToken = account.token;

  const cert = (await api('POST', '/api/certificates', { token: userToken, body: { unitId: UNIT, studentName: 'Someone Else' } })).json.data;
  check('a certificate is issued in the account holder\'s name', /^OPS-[0-9A-F]{12}$/.test(cert.id) && cert.studentName === 'E2E Student');

  const notEarned = await api('POST', '/api/certificates', { token: userToken, body: { unitId: 'kubernetes-basics' } });
  check('no certificate for a unit that was not completed', notEarned.status === 403);

  const publicCheck = await api('GET', `/api/certificates/verify/${cert.id}`);
  check('anyone can verify the certificate by its ID', publicCheck.json.verified === true && publicCheck.json.data.unitTitle === 'Linux Fundamentals');
  check('a made-up certificate ID does not verify', (await api('GET', '/api/certificates/verify/OPS-0123456789AB')).status === 404);

  const board = (await api('GET', '/api/progress/leaderboard', { token: userToken })).json.data;
  check('the leaderboard includes this learner', board.some((row) => row.you && row.name === 'E2E Student'));

  const login = await api('POST', '/api/auth/login', { body: { email, password: 'correct-horse-battery' } });
  check('the new account can log in', login.status === 200 && login.json.user.id === guest.user.id);
  check('a wrong password is rejected', (await api('POST', '/api/auth/login', { body: { email, password: 'wrong' } })).status === 401);

  // ── Reset, stop, metrics ────────────────────────────────────
  await api('POST', `/api/sandbox/${session.sessionId}/reset`, { token });
  check('reset wipes the sandbox so the lab can be redone', (await stepPassed(2)) === false);

  const publicStats = await api('GET', '/api/sandbox/stats');
  check('public stats report measured claim latency without session ids', publicStats.status === 200 && !publicStats.text.includes(session.sessionId));
  check('the admin sandbox list is not publicly reachable', [403, 404].includes((await api('GET', '/api/admin/sandboxes')).status));

  await api('DELETE', `/api/sandbox/${session.sessionId}`, { token });
  await waitFor(() => term.closed, 5000).catch(() => {});
  check('stopping the sandbox closes the terminal', Boolean(term.closed) && term.closed.code === 4000, JSON.stringify(term.closed));
  check('the stopped sandbox is gone', (await api('GET', `/api/sandbox/${session.sessionId}/status`, { token })).status === 404);

  const metrics = await api('GET', '/metrics');
  check('Prometheus metrics are exported', metrics.status === 200
    && /opsacademy_lab_verifications_total\{unit="linux-basics",result="pass"\}/.test(metrics.text)
    && /opsacademy_commands_blocked_total\{rule="host_escape"\} [1-9]/.test(metrics.text)
    && /opsacademy_hint_requests_total/.test(metrics.text));

  const stats = publicStats.json.data;
  console.log(`\n        claim latency (ms): pool ${JSON.stringify(stats.claimLatencyMs.pool)} cold ${JSON.stringify(stats.claimLatencyMs.cold)}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.\n`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nE2E aborted: ${err.stack || err.message}`);
  process.exit(1);
});
