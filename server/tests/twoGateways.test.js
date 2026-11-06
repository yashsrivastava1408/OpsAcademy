/**
 * Proof that the gateway is stateless (P3-11): two real gateway processes share one Postgres and one lab
 * node. A session started through one is used through the other, terminals connect through either, and
 * killing a gateway loses nothing. Needs TEST_DATABASE_URL (runs with the other database tests).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const net = require('net');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { migrate } = require('../lib/migrator');
const { createPostgresRepos } = require('../repositories/postgres');
const { createAgent } = require('../lab-node/agent');

const url = process.env.TEST_DATABASE_URL;
const describeDb = url ? describe : describe.skip;
const TOKEN = 't'.repeat(40);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/** A sandbox engine that echoes what is typed, like a very small shell. */
function echoEngine() {
  const boxes = new Map();
  return {
    name: 'echo',
    boxes,
    create: async (id) => { boxes.set(id, { createdAt: Date.now(), writes: [] }); },
    destroy: async (id) => boxes.delete(id),
    isAlive: (id) => boxes.has(id),
    onExit: () => {},
    list: () => [...boxes].map(([engineId, b]) => ({ engineId, alive: true, createdAt: b.createdAt })),
    exec: async (id, command) => ({ exitCode: 0, stdout: `ran:${command}`, stderr: '' }),
    reset: async () => {},
    attach: async (id) => {
      const box = boxes.get(id);
      let send = () => {};
      return {
        onData(cb) { send = cb; setImmediate(() => cb('prompt$ ')); },
        write(d) { box.writes.push(d); send(`echo:${d}`); },
        resize() {},
        close() {},
      };
    },
  };
}

describeDb('two gateway instances, one lab node (real processes)', () => {
  let pool;
  let repos;
  let agent;
  let engine;
  let beat;
  const gateways = [];

  async function startGateway() {
    const port = await freePort();
    const child = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'development', PORT: String(port), LOG_LEVEL: 'warn', SERVICE_ROLE: 'all',
        DATABASE_URL: url, DATABASE_POOL_SIZE: '3', JWT_SECRET: 'two-gateways-test-secret',
        SANDBOX_MODE: 'remote', NODE_TOKEN: TOKEN, AI_HUB_URL: 'http://127.0.0.1:1',
        SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '', PLATFORM_ADMIN_EMAILS: '', CORS_ORIGINS: '',
        SANDBOX_REAPER_INTERVAL_MS: '3600000', ENABLE_SANDBOX_POOL: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const gateway = { port, child, base: `http://127.0.0.1:${port}`, log: '' };
    child.stdout.on('data', (d) => { gateway.log += d; });
    child.stderr.on('data', (d) => { gateway.log += d; });
    for (let i = 0; i < 100; i += 1) {
      if (child.exitCode !== null) throw new Error(`gateway exited early:\n${gateway.log}`);
      try {
        if ((await fetch(`${gateway.base}/api/health`)).ok) break;
      } catch {
        // not up yet
      }
      await sleep(100);
    }
    gateways.push(gateway);
    return gateway;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    await pool.query(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'tests', 'bootstrap.sql'), 'utf8'));
    await migrate(pool);
    repos = createPostgresRepos({ pool });

    engine = echoEngine();
    agent = createAgent({ engine, settings: { nodeId: 'two-gw-node', token: TOKEN, baseUrl: 'http://x', capacity: 5, gatewayUrl: null, heartbeatMs: 10000, poolSize: 0, poolEnabled: false } });
    const port = await agent.start(0);
    const announce = () => repos.nodes.heartbeat({ nodeId: 'two-gw-node', baseUrl: `http://127.0.0.1:${port}`, capacity: 5, running: engine.boxes.size });
    await announce();
    beat = setInterval(announce, 5000);
  }, 30000);

  afterAll(async () => {
    clearInterval(beat);
    for (const g of gateways) g.child.kill('SIGKILL');
    await agent.stop().catch(() => {});
    await pool.query("delete from lab_nodes where node_id = 'two-gw-node'");
    await pool.query("delete from users where id in (select user_id from sandbox_sessions) or name like 'Guest-%'");
    await pool.end();
  });

  const call = (gateway, token, method, route, body) => fetch(`${gateway.base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (res) => ({ status: res.status, body: await res.json().catch(() => ({})) }));

  /** Open the terminal through `gateway` with a fresh ticket; resolves to a handle that collects output. */
  async function terminal(gateway, token, sessionId) {
    const { body } = await call(gateway, token, 'POST', `/api/sandbox/${sessionId}/terminal-ticket`);
    const ws = new WebSocket(`ws://127.0.0.1:${gateway.port}/api/terminal?ticket=${body.data.ticket}`);
    const out = { ws, output: '', ticket: body.data.ticket };
    ws.on('message', (d) => { out.output += d.toString(); });
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    out.sees = async (text) => {
      for (let i = 0; i < 100 && !out.output.includes(text); i += 1) await sleep(50);
      return out.output.includes(text);
    };
    return out;
  }

  test('a session started through one gateway is used through the other, and survives the first one dying', async () => {
    const a = await startGateway();
    const b = await startGateway();

    // one learner, one token, valid on both (same database, same secret)
    const guest = await call(a, null, 'POST', '/api/auth/guest');
    expect(guest.status).toBe(201);
    const token = guest.body.token;

    const started = await call(a, token, 'POST', '/api/sandbox/start', { labId: 'linux-basics' });
    expect(started.status).toBe(201);
    const { sessionId } = started.body.data;
    expect(started.body.data.nodeId).toBe('two-gw-node');
    expect(engine.boxes.size).toBe(1);

    // gateway B knows it, runs commands in it, and sees the same resume
    expect((await call(b, token, 'GET', `/api/sandbox/${sessionId}/status`)).body.data).toMatchObject({ sessionId, userId: guest.body.user.id });
    const file = await call(b, token, 'GET', `/api/sandbox/${sessionId}/file?path=notes.txt`);
    expect(file.status).toBe(200);
    expect(file.body.data.content).toContain('ran:');
    expect((await call(b, token, 'POST', '/api/sandbox/start', { labId: 'linux-basics' })).body.data).toMatchObject({ sessionId, resumed: true });

    // a stranger is refused on either gateway
    const other = (await call(a, null, 'POST', '/api/auth/guest')).body.token;
    expect((await call(b, other, 'GET', `/api/sandbox/${sessionId}/status`)).status).toBe(404);

    // the terminal works through A; its command lands in the shared history
    const viaA = await terminal(a, token, sessionId);
    expect(await viaA.sees('prompt$ ')).toBe(true);
    viaA.ws.send('whoami\r');
    expect(await viaA.sees('echo:whoami')).toBe(true);
    // a ticket is good once, on any gateway
    const replay = new WebSocket(`ws://127.0.0.1:${b.port}/api/terminal?ticket=${viaA.ticket}`);
    await expect(new Promise((resolve, reject) => { replay.on('open', resolve); replay.on('unexpected-response', (_q, res) => reject(Object.assign(new Error('refused'), { status: res.statusCode }))); replay.on('error', reject); }))
      .rejects.toMatchObject({ status: 401 });

    // kill gateway A without warning
    viaA.ws.terminate();
    a.child.kill('SIGKILL');
    await sleep(300);

    // nothing was lost: B still has the session, its history, and a working terminal
    expect((await call(b, token, 'GET', `/api/sandbox/${sessionId}/status`)).status).toBe(200);
    const history = await call(b, token, 'GET', `/api/sandbox/${sessionId}/history`);
    expect(history.body.data.map((h) => h.command)).toEqual(['whoami']);
    expect(engine.boxes.size).toBe(1);
    const viaB = await terminal(b, token, sessionId);
    expect(await viaB.sees('prompt$ ')).toBe(true);
    viaB.ws.send('pwd\r');
    expect(await viaB.sees('echo:pwd')).toBe(true);
    viaB.ws.terminate();

    // and B can end it: the node's sandbox goes away and the record with it
    expect((await call(b, token, 'DELETE', `/api/sandbox/${sessionId}`)).status).toBe(200);
    expect(engine.boxes.size).toBe(0);
    expect((await call(b, token, 'GET', `/api/sandbox/${sessionId}/status`)).status).toBe(404);
    expect(await repos.sessions.get(sessionId)).toBeNull();
  }, 60000);
});
