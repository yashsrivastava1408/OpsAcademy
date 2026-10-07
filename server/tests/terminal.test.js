/**
 * Drives the terminal WebSocket against real shells: the same path the
 * browser uses.
 */

const http = require('http');
const WebSocket = require('ws');
const request = require('supertest');
const config = require('../config');
const pty = require('../services/ptyService');
const { createApp } = require('../app');
const { attachTerminalWebSocket, isAllowedOrigin } = require('../services/terminalService');
const { signToken } = require('../middleware/auth');
const { install, waitFor } = require('./helpers');

let server;
let wss;
let ctx;
let port;
const sockets = [];

const alice = { id: 'u_alice', name: 'Alice' };
const bob = { id: 'u_bob', name: 'Bob' };

beforeEach(async () => {
  ctx = install({ engine: pty });
  server = http.createServer(createApp());
  wss = attachTerminalWebSocket(server, ctx.manager);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.terminate();
  await ctx.manager.shutdown();
  wss.close();
  await new Promise((resolve) => server.close(resolve));
});

function url({ sessionId, token }) {
  const params = new URLSearchParams();
  if (sessionId) params.set('sessionId', sessionId);
  if (token) params.set('token', token);
  return `ws://127.0.0.1:${port}/api/terminal?${params}`;
}

/** Open a terminal and collect everything it prints. */
function connect(query, options = {}) {
  const ws = new WebSocket(url(query), options);
  sockets.push(ws);
  const term = { ws, output: '', closed: null };
  ws.on('message', (data) => { term.output += data.toString(); });
  ws.on('close', (code, reason) => { term.closed = { code, reason: reason.toString() }; });
  term.opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('unexpected-response', (req, res) => reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode })));
    ws.on('error', reject);
  });
  term.type = (text) => ws.send(text);
  term.sees = (text) => waitFor(() => term.output.includes(text));
  return term;
}

async function openTerminal(user = alice) {
  const session = await ctx.manager.createSession(user.id, 'linux-basics');
  const term = connect({ sessionId: session.sessionId, token: signToken(user) });
  await term.opened;
  return { term, sessionId: session.sessionId };
}

describe('connection authentication', () => {
  test.each([
    ['no token', () => ({ token: undefined }), 401],
    ['a forged token', () => ({ token: require('jsonwebtoken').sign(alice, 'wrong-secret') }), 401],
    ["someone else's session", () => ({ token: signToken(bob) }), 403],
  ])('rejects %s before upgrading', async (_label, overrides, status) => {
    const session = await ctx.manager.createSession(alice.id);
    const term = connect({ sessionId: session.sessionId, token: signToken(alice), ...overrides() });
    await expect(term.opened).rejects.toMatchObject({ status });
  });

  test('rejects an unknown session', async () => {
    const term = connect({ sessionId: 'no-such-session', token: signToken(alice) });
    await expect(term.opened).rejects.toMatchObject({ status: 404 });
  });

  test('rejects a missing session id', async () => {
    const term = connect({ token: signToken(alice) });
    await expect(term.opened).rejects.toMatchObject({ status: 404 });
  });

  test('other WebSocket paths are refused', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/other`);
    sockets.push(ws);
    await expect(new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); })).rejects.toBeDefined();
  });

  test('a browser origin outside the allow-list is refused when one is configured', async () => {
    config.corsOrigins = ['https://opsacademy.example'];
    try {
      const session = await ctx.manager.createSession(alice.id);
      const query = { sessionId: session.sessionId, token: signToken(alice) };

      await expect(connect(query, { origin: 'https://evil.example' }).opened).rejects.toMatchObject({ status: 403 });
      await expect(connect(query, { origin: 'https://opsacademy.example' }).opened).resolves.toBeUndefined();
    } finally {
      config.corsOrigins = null;
    }
  });
});

describe('isAllowedOrigin', () => {
  afterEach(() => { config.corsOrigins = null; });

  test('everything is allowed until an allow-list is configured', () => {
    expect(isAllowedOrigin('https://anything.example')).toBe(true);
  });

  test('with an allow-list: listed origins, localhost in development, and non-browser clients', () => {
    config.corsOrigins = ['https://opsacademy.example'];
    expect(isAllowedOrigin('https://opsacademy.example')).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
    expect(isAllowedOrigin(undefined)).toBe(true);
    expect(isAllowedOrigin('https://opsacademy.example.evil.com')).toBe(false);
    expect(isAllowedOrigin('http://localhost.evil.com')).toBe(false);
  });
});

describe('terminal streaming', () => {
  test('runs what the student types and streams the output back', async () => {
    const { term } = await openTerminal();
    term.type('echo sum-$((40+2))\r');
    await term.sees('sum-42');
  });

  test('keystrokes sent one at a time behave like typing', async () => {
    const { term } = await openTerminal();
    for (const ch of 'echo one-by-$((0+1))\r') term.type(ch);
    await term.sees('one-by-1');
  });

  test('records the commands entered, for the history panel and the mentor', async () => {
    const { term, sessionId } = await openTerminal();
    term.type('mkdir webapp\r');
    term.type('cd webapp\r');
    term.type('   \r');
    await waitFor(() => ctx.manager.getHistory(sessionId).length === 2);
    expect(ctx.manager.getHistory(sessionId).map((h) => h.command)).toEqual(['mkdir webapp', 'cd webapp']);

    const res = await request(server).get(`/api/sandbox/${sessionId}/history`).set('Authorization', `Bearer ${signToken(alice)}`);
    expect(res.body.data.map((h) => h.command)).toEqual(['mkdir webapp', 'cd webapp']);
  });

  test('resize messages are applied and not typed into the shell', async () => {
    const { term } = await openTerminal();
    term.type(JSON.stringify({ type: 'resize', cols: 91, rows: 27 }));
    term.type('stty size\r');
    await term.sees('27 91');
    expect(term.output).not.toContain('"type":"resize"');
  });

  test('absurd resize values are ignored', async () => {
    const { term } = await openTerminal();
    term.type(JSON.stringify({ type: 'resize', cols: 1e9, rows: -5 }));
    term.type('echo still-$((1+1))\r');
    await term.sees('still-2');
  });

  test('input that merely looks like JSON still reaches the shell', async () => {
    const { term } = await openTerminal();
    term.type('{ echo braces-$((2+3)); }\r');
    await term.sees('braces-5');
  });

  test('two terminals can attach to the same session', async () => {
    const { term, sessionId } = await openTerminal();
    const second = connect({ sessionId, token: signToken(alice) });
    await second.opened;
    term.type('echo shared-$((3+4))\r');
    await second.sees('shared-7');
  });

  test('stopping the sandbox closes the terminal with the reason', async () => {
    const { term, sessionId } = await openTerminal();
    await ctx.manager.destroySession(sessionId, 'stopped');
    await waitFor(() => term.closed);
    expect(term.closed).toEqual({ code: 4000, reason: 'Sandbox stopped' });
  });

  test('a reaped session closes its terminal', async () => {
    const { term } = await openTerminal();
    await ctx.manager.sweep(Date.now() + 24 * 3600 * 1000);
    await waitFor(() => term.closed);
    expect(term.closed.reason).toBe('Sandbox max_age');
  });

  test('closing the browser tab leaves the sandbox running for a reconnect', async () => {
    const { term, sessionId } = await openTerminal();
    term.type('export MARK=kept-$((5+5))\r');
    term.ws.close();
    await waitFor(() => term.closed);

    expect(ctx.manager.getSession(sessionId)).not.toBeNull();
    const again = connect({ sessionId, token: signToken(alice) });
    await again.opened;
    again.type('echo $MARK\r');
    await again.sees('kept-10');
  });

  test('typing keeps the session from going idle', async () => {
    const { term, sessionId } = await openTerminal();
    const before = ctx.manager.getSession(sessionId).lastActiveAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    term.type('x');
    await waitFor(() => ctx.manager.getSession(sessionId).lastActiveAt > before);
  });
});

describe('abuse tripwire', () => {
  test('a blocked command is not executed and the student is told why', async () => {
    const { term, sessionId } = await openTerminal();
    term.type('touch before.txt\r');
    term.type('touch canary.txt; echo c > /proc/sysrq-trigger\r');
    await term.sees('Command blocked (host_escape). Strike 1 of 3.');
    term.type('echo after-$((6+1))\r');
    await term.sees('after-7');

    const files = (await ctx.manager.exec(sessionId, 'ls')).stdout;
    expect(files).toContain('before.txt');
    expect(files).not.toContain('canary.txt');
    expect(ctx.manager.getHistory(sessionId).map((h) => h.command)).toEqual(['touch before.txt', 'echo after-$((6+1))']);
  });

  test('three strikes destroy the sandbox and close the terminal', async () => {
    const { term, sessionId } = await openTerminal();
    for (let i = 0; i < config.sandbox.maxStrikes; i += 1) term.type('nsenter -t 1 -m sh\r');

    await term.sees('Sandbox terminated after repeated blocked commands.');
    await waitFor(() => term.closed);
    expect(term.closed.code).toBe(4000);
    expect(ctx.manager.getSession(sessionId)).toBeNull();
  });

  test('a flood of messages closes the connection', async () => {
    const { term } = await openTerminal();
    for (let i = 0; i < 2100; i += 1) term.type('x');
    await waitFor(() => term.closed);
    expect(term.closed.code).toBe(4029);
  });

  test('an oversized frame is refused', async () => {
    const { term } = await openTerminal();
    term.type('y'.repeat(70 * 1024));
    await waitFor(() => term.closed);
    expect(term.closed.code).toBe(1009);
  });
});
