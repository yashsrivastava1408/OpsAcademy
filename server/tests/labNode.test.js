/**
 * Lab node agent, remote engine, placement and the heartbeat route (ADR 0005):
 * a real gateway-side manager talking HTTP and WebSocket to real agents (with an in-memory engine).
 */
const request = require('supertest');
const config = require('../config');
const { createApp } = require('../app');
const { createAgent } = require('../lab-node/agent');
const { createRemoteEngine } = require('../services/remoteEngine');
const { createManager } = require('../services/sandboxManager');
const { install, waitFor } = require('./helpers');

const TOKEN = 'n'.repeat(40);

/** A sandbox engine that "runs" commands by echoing them and keeps the same interface as the real ones. */
function echoEngine() {
  const boxes = new Map();
  let counter = 0;
  const engine = {
    name: 'echo',
    boxes,
    create: async (engineId) => { boxes.set(engineId, { alive: true, createdAt: Date.now(), exit: [], writes: [], sizes: [] }); },
    destroy: async (engineId) => boxes.delete(engineId),
    isAlive: (engineId) => Boolean(boxes.get(engineId)?.alive),
    onExit: (engineId, fn) => boxes.get(engineId)?.exit.push(fn),
    list: () => [...boxes].map(([engineId, b]) => ({ engineId, alive: b.alive, createdAt: b.createdAt })),
    exec: async (engineId, command) => {
      if (!boxes.has(engineId)) throw new Error('Sandbox not found');
      return { exitCode: 0, stdout: `ran:${command}`, stderr: '' };
    },
    reset: async (engineId) => { boxes.get(engineId).reset = true; },
    attach: async (engineId) => {
      const box = boxes.get(engineId);
      if (!box) return null;
      let send = () => {};
      const terminal = {
        onData(cb) { send = cb; setImmediate(() => cb('prompt$ ')); },
        write(data) { box.writes.push(data); send(`echo:${data}`); },
        resize(cols, rows) { box.sizes.push([cols, rows]); },
        close() { box.closed = true; },
      };
      counter += 1;
      return terminal;
    },
  };
  return engine;
}

async function startAgent(nodeId, { capacity = 2, engine = echoEngine() } = {}) {
  const agent = createAgent({
    engine,
    settings: { nodeId, token: TOKEN, baseUrl: 'http://x', capacity, gatewayUrl: null, heartbeatMs: 10000, poolSize: 0, poolEnabled: false },
  });
  const port = await agent.start(0);
  return { agent, engine, port, baseUrl: `http://127.0.0.1:${port}` };
}

const auth = { Authorization: `Bearer ${TOKEN}` };
let ctx;
let nodes;

beforeEach(async () => {
  ctx = install({ limits: { maxPerUser: 10 } });
  await ctx.repos.users.create({ id: 'u1', name: 'U1', guest: true, createdAt: new Date().toISOString() });
  await ctx.repos.users.create({ id: 'u2', name: 'U2', guest: true, createdAt: new Date().toISOString() });
  nodes = [];
});
afterEach(async () => {
  await ctx.manager.shutdown();
  for (const n of nodes) await n.agent.stop().catch(() => {});
});

async function node(nodeId, options) {
  const n = await startAgent(nodeId, options);
  nodes.push(n);
  await ctx.repos.nodes.heartbeat({ nodeId, baseUrl: n.baseUrl, capacity: options?.capacity ?? 2, running: 0 });
  return n;
}

function remoteManager(settings = {}) {
  return createManager({ engine: createRemoteEngine({ settings: { ...config.node, token: TOKEN, healthyMs: 30000, ...settings } }), limits: { maxPerUser: 10 } });
}

describe('agent API', () => {
  test('every call needs the node token', async () => {
    const { baseUrl } = await node('a');
    for (const headers of [{}, { Authorization: 'Bearer wrong' }, { Authorization: `Bearer ${'x'.repeat(40)}` }]) {
      expect((await fetch(`${baseUrl}/v1/health`, { headers })).status).toBe(401);
      expect((await fetch(`${baseUrl}/v1/sandboxes`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' })).status).toBe(401);
    }
    expect((await fetch(`${baseUrl}/v1/health`, { headers: auth })).status).toBe(200);
  });

  test('creates, runs a command in, resets and destroys a sandbox, and lists what it runs', async () => {
    const { baseUrl } = await node('a');
    const call = (method, path, body) => fetch(`${baseUrl}${path}`, { method, headers: { ...auth, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

    const created = await (await call('POST', '/v1/sandboxes', { labId: 'linux-basics' })).json();
    expect(created).toMatchObject({ nodeId: 'a', fromPool: false });
    const id = created.engineId;

    expect(await (await call('POST', `/v1/sandboxes/${id}/exec`, { command: 'ls' })).json()).toMatchObject({ exitCode: 0, stdout: 'ran:ls' });
    expect((await call('POST', `/v1/sandboxes/${id}/exec`, { command: '' })).status).toBe(400);
    expect((await call('POST', `/v1/sandboxes/${id}/reset`)).status).toBe(200);
    expect((await call('POST', '/v1/sandboxes/nope/exec', { command: 'ls' })).status).toBe(404);
    expect(await (await call('GET', '/v1/sandboxes')).json()).toMatchObject({ nodeId: 'a', sandboxes: [{ engineId: id, active: true, alive: true }] });
    expect(await (await call('GET', '/v1/health')).json()).toMatchObject({ nodeId: 'a', capacity: 2, running: 1, draining: false });

    expect(await (await call('DELETE', `/v1/sandboxes/${id}`)).json()).toEqual({ destroyed: true });
    expect(await (await call('DELETE', `/v1/sandboxes/${id}`)).json()).toEqual({ destroyed: false });
    expect((await call('POST', `/v1/sandboxes/${id}/exec`, { command: 'ls' })).status).toBe(404);
  });

  test('never runs more sandboxes than its capacity, even when requests arrive together', async () => {
    const { baseUrl } = await node('a', { capacity: 3 });
    const create = () => fetch(`${baseUrl}/v1/sandboxes`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
    const statuses = (await Promise.all(Array.from({ length: 8 }, create))).map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    expect(statuses.filter((s) => s === 503)).toHaveLength(5);
  });

  test('a draining node refuses new sandboxes but keeps the ones it has', async () => {
    const n = await node('a');
    const created = await (await fetch(`${n.baseUrl}/v1/sandboxes`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' })).json();
    await n.agent.drain();
    const again = await fetch(`${n.baseUrl}/v1/sandboxes`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
    expect(again.status).toBe(503);
    expect(n.engine.boxes.has(created.engineId)).toBe(true);
  });

  test('heartbeats announce the node to the gateway', async () => {
    const sent = [];
    const agent = createAgent({
      engine: echoEngine(),
      settings: { nodeId: 'hb', token: TOKEN, baseUrl: 'http://hb:7000', capacity: 7, gatewayUrl: 'http://gateway', heartbeatMs: 10000, poolSize: 0, poolEnabled: false },
      fetchImpl: async (url, init) => { sent.push({ url, init }); return { ok: true }; },
    });
    await agent.beat();
    expect(sent[0].url).toBe('http://gateway/api/internal/nodes/heartbeat');
    expect(sent[0].init.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(sent[0].init.body)).toMatchObject({ nodeId: 'hb', baseUrl: 'http://hb:7000', capacity: 7, running: 0, draining: false });
  });
});

describe('heartbeat route on the gateway', () => {
  const beat = { nodeId: 'n1', baseUrl: 'http://10.0.0.5:7000/ignored', capacity: 40, running: 3, version: '1.2.3' };
  afterEach(() => { config.node.token = null; });

  test('does not exist without a node token; refuses a wrong one', async () => {
    const app = createApp();
    expect((await request(app).post('/api/internal/nodes/heartbeat').send(beat)).status).toBe(404);
    config.node.token = TOKEN;
    expect((await request(app).post('/api/internal/nodes/heartbeat').send(beat)).status).toBe(401);
    expect((await request(app).post('/api/internal/nodes/heartbeat').set('Authorization', 'Bearer wrong').send(beat)).status).toBe(401);
  });

  test('stores a valid heartbeat and rejects malformed ones', async () => {
    config.node.token = TOKEN;
    const app = createApp();
    const send = (body) => request(app).post('/api/internal/nodes/heartbeat').set(auth).send(body);
    expect((await send(beat)).status).toBe(200);
    expect(await ctx.repos.nodes.get('n1')).toMatchObject({ baseUrl: 'http://10.0.0.5:7000', capacity: 40, running: 3, draining: false, version: '1.2.3' });
    expect((await send({ ...beat, draining: true })).status).toBe(200);
    expect((await ctx.repos.nodes.get('n1')).draining).toBe(true);
    for (const bad of [{ ...beat, nodeId: 'bad id!' }, { ...beat, baseUrl: 'ftp://x' }, { ...beat, baseUrl: 'nope' }, { ...beat, capacity: -1 }, { ...beat, running: 1.5 }, {}]) {
      expect((await send(bad)).status).toBe(400);
    }
  });
});

describe('gateway with lab nodes', () => {
  test('a session runs on a node, is recorded with it, and works through any gateway instance', async () => {
    const a = await node('node-a');
    const gatewayOne = remoteManager();
    const gatewayTwo = remoteManager();

    const session = await gatewayOne.createSession('u1', 'linux-basics');
    expect(session).toMatchObject({ nodeId: 'node-a', mode: 'remote' });
    expect((await ctx.repos.sessions.get(session.sessionId)).nodeId).toBe('node-a');

    expect((await gatewayTwo.exec(session.sessionId, 'whoami')).stdout).toBe('ran:whoami');
    await gatewayTwo.reset(session.sessionId);
    expect([...a.engine.boxes.values()][0].reset).toBe(true);

    expect(await gatewayTwo.destroySession(session.sessionId, 'stopped')).toBe(true);
    expect(a.engine.boxes.size).toBe(0);
    expect(await gatewayOne.getSession(session.sessionId)).toBeNull();
  });

  test('a gateway restart does not end students\' sandboxes', async () => {
    const a = await node('node-a');
    const gateway = remoteManager();
    const session = await gateway.createSession('u1', 'linux-basics');
    await gateway.shutdown();
    expect(a.engine.boxes.size).toBe(1);
    expect(await remoteManager().getSession(session.sessionId)).toMatchObject({ userId: 'u1' });
  });

  test('places on the node with the most free seats and stops when every node is full', async () => {
    const big = await node('big', { capacity: 3 });
    const small = await node('small', { capacity: 1 });
    const gateway = remoteManager();
    const placed = [];
    for (let i = 0; i < 4; i += 1) placed.push((await gateway.createSession('u1')).nodeId);
    expect(placed.filter((n) => n === 'big')).toHaveLength(3);
    expect(placed.filter((n) => n === 'small')).toHaveLength(1);
    expect(placed[0]).toBe('big'); // emptiest first
    await expect(gateway.createSession('u2')).rejects.toMatchObject({ statusCode: 503 });
    expect(big.engine.boxes.size).toBe(3);
    expect(small.engine.boxes.size).toBe(1);
    expect((await gateway.stats())).toMatchObject({ mode: 'remote', capacity: 4, activeSessions: 4 });
  });

  test('a node that stops sending heartbeats is no longer used', async () => {
    await node('only');
    const gateway = remoteManager({ healthyMs: 60 });
    await expect(gateway.createSession('u1')).resolves.toBeDefined();
    await new Promise((r) => setTimeout(r, 90));
    await expect(gateway.createSession('u1')).rejects.toMatchObject({ statusCode: 503 });
    await ctx.repos.nodes.heartbeat({ nodeId: 'only', baseUrl: nodes[0].baseUrl, capacity: 2, running: 0 });
    await expect(gateway.createSession('u2')).resolves.toBeDefined();
  });

  test('a draining node gets nothing new', async () => {
    await node('a');
    await node('b');
    await ctx.repos.nodes.heartbeat({ nodeId: 'a', baseUrl: nodes[0].baseUrl, capacity: 2, running: 0, draining: true });
    const gateway = remoteManager();
    expect((await gateway.createSession('u1')).nodeId).toBe('b');
    expect((await gateway.createSession('u1')).nodeId).toBe('b');
    await expect(gateway.createSession('u1')).rejects.toMatchObject({ statusCode: 503 });
  });

  test('when the chosen node turns out to be full, the next one is tried', async () => {
    const full = await node('full', { capacity: 1 });
    await node('spare', { capacity: 2 });
    // The gateway believes "full" has plenty of room (a stale heartbeat), the node itself knows better.
    await ctx.repos.nodes.heartbeat({ nodeId: 'full', baseUrl: full.baseUrl, capacity: 9, running: 0 });
    await fetch(`${full.baseUrl}/v1/sandboxes`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' });
    const gateway = remoteManager();
    expect((await gateway.createSession('u1')).nodeId).toBe('spare');
  });

  test('an unreachable node is skipped; a session on it answers 503 instead of hanging', async () => {
    const dead = await node('dead', { capacity: 3 }); // more room, so it is chosen first
    await node('alive', { capacity: 2 });
    const gateway = remoteManager();
    const onDead = await gateway.createSession('u1');
    expect(onDead.nodeId).toBe('dead'); // first in line
    await dead.agent.stop();
    await expect(gateway.exec(onDead.sessionId, 'ls')).rejects.toMatchObject({ statusCode: 503 });
    // new sessions: the dead node still looks healthy for a moment, but the start falls through to the live one
    expect((await gateway.createSession('u2')).nodeId).toBe('alive');
  });
});

describe('terminal stream through the agent', () => {
  test('keystrokes go to the sandbox, output comes back, resize and close are forwarded', async () => {
    const a = await node('node-a');
    const gateway = remoteManager();
    const session = await gateway.createSession('u1');
    const terminal = await gateway.attach(session.sessionId);
    const output = [];
    terminal.onData((d) => output.push(d));

    await waitFor(() => output.join('').includes('prompt$ '), { timeoutMs: 12000 }).catch((e) => { throw new Error('step 1 never happened: ' + e.message + ' output=' + JSON.stringify(output.join(''))); });
    terminal.write('ls\r');
    terminal.resize(120, 40);
    await waitFor(() => output.join('').includes('echo:ls\r'), { timeoutMs: 12000 }).catch((e) => { throw new Error('step 2 never happened: ' + e.message + ' output=' + JSON.stringify(output.join(''))); });
    await waitFor(() => [...a.engine.boxes.values()][0].sizes.length === 1, { timeoutMs: 12000 }).catch((e) => { throw new Error('step 3 never happened: ' + e.message + ' output=' + JSON.stringify(output.join(''))); });
    const box = [...a.engine.boxes.values()][0];
    expect(box.sizes[0]).toEqual([120, 40]);
    expect(box.writes).toEqual(['ls\r']); // the resize message was not typed into the shell

    let closed = false;
    terminal.onClose(() => { closed = true; });
    terminal.close();
    await waitFor(() => closed && box.closed, { timeoutMs: 12000 }).catch((e) => { throw new Error('step 4 never happened: ' + e.message + ' output=' + JSON.stringify(output.join(''))); });
  });

  test('attaching to a session whose node is gone gives null, and a wrong token is refused', async () => {
    const a = await node('node-a');
    const gateway = remoteManager();
    const session = await gateway.createSession('u1');
    await a.agent.stop();
    expect(await gateway.attach(session.sessionId)).toBeNull();

    const b = await node('node-b');
    const stranger = createRemoteEngine({ settings: { ...config.node, token: 'z'.repeat(40) } });
    expect(await stranger.attach('whatever', { nodeId: 'node-b' })).toBeNull();
    expect(b.engine.boxes.size).toBe(0);
  });
});

describe('reconciliation', () => {
  const { reconcileNodes } = require('../services/reconcileService');
  const old = Date.now() - 10 * 60 * 1000; // well past the grace period

  async function record(sessionId, engineId, nodeId, createdAt = old) {
    await ctx.repos.sessions.upsert({ sessionId, engineId, nodeId, userId: 'u1', labId: 'x', createdAt, lastActiveAt: createdAt, fromPool: false, history: [], strikes: 0 });
  }

  test('destroys a sandbox no session points at, but not a young one or a warm standby', async () => {
    const a = await node('node-a', { capacity: 5 });
    const post = () => fetch(`${a.baseUrl}/v1/sandboxes`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: '{}' }).then((r) => r.json());
    const tracked = await post();
    const orphan = await post();
    const young = await post();
    await a.engine.create('standby-1'); // created by the engine directly: a pool standby, not handed out
    a.engine.boxes.get(orphan.engineId).createdAt = old;
    a.engine.boxes.get(tracked.engineId).createdAt = old;
    a.engine.boxes.get('standby-1').createdAt = old;
    await record('s1', tracked.engineId, 'node-a');

    const result = await reconcileNodes({ engine: createRemoteEngine({ settings: { ...config.node, token: TOKEN } }) });
    expect(result).toMatchObject({ orphansDestroyed: 1, deadSessionsDropped: 0, nodesChecked: 1 });
    expect([...a.engine.boxes.keys()].sort()).toEqual([tracked.engineId, young.engineId, 'standby-1'].sort());
  });

  test('drops a session whose sandbox is gone from its node, unless it was only just created', async () => {
    await node('node-a');
    await record('gone', 'missing-1', 'node-a');
    await record('fresh', 'missing-2', 'node-a', Date.now() - 1000);
    const result = await reconcileNodes({ engine: createRemoteEngine({ settings: { ...config.node, token: TOKEN } }) });
    expect(result.deadSessionsDropped).toBe(1);
    expect(await ctx.repos.sessions.get('gone')).toBeNull();
    expect(await ctx.repos.sessions.get('fresh')).not.toBeNull();
  });

  test('a node silent for a while is left alone; one gone for good loses its sessions', async () => {
    await node('node-a');
    await record('s1', 'e1', 'node-a');
    const engine = createRemoteEngine({ settings: { ...config.node, token: TOKEN } });

    const silent = Date.now() + config.node.healthyMs + 1000;
    expect(await reconcileNodes({ engine, now: silent })).toMatchObject({ nodesChecked: 0, unreachableSessionsDropped: 0 });
    expect(await ctx.repos.sessions.get('s1')).not.toBeNull();

    const forgotten = Date.now() + config.node.unreachableMs + 1000;
    expect(await reconcileNodes({ engine, now: forgotten })).toMatchObject({ unreachableSessionsDropped: 1 });
    expect(await ctx.repos.sessions.get('s1')).toBeNull();
  });

  test('a node that cannot be reached is skipped without dropping anything', async () => {
    const a = await node('node-a');
    await record('s1', 'e1', 'node-a');
    await a.agent.stop();
    const result = await reconcileNodes({ engine: createRemoteEngine({ settings: { ...config.node, token: TOKEN } }) });
    expect(result).toMatchObject({ nodesChecked: 0, deadSessionsDropped: 0 });
    expect(await ctx.repos.sessions.get('s1')).not.toBeNull();
  });
});
