/**
 * Remote engine — sandboxes on lab nodes (ADR 0005).
 *
 * Implements the same engine interface as dockerService and ptyService, but every call goes to the
 * lab node agent that owns the sandbox. The gateway using it has no Docker socket. Which node a
 * sandbox lives on is recorded in the session registry and passed in as `nodeId`.
 */

const WebSocket = require('ws');
const config = require('../config');
const logger = require('../lib/logger');
const { getRepos } = require('../repositories');

const NODE_CACHE_MS = 5000;
const CALL_TIMEOUT_MS = 15000;
const ATTACH_TIMEOUT_MS = 8000;

function problem(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

function createRemoteEngine({ fetchImpl = (...args) => fetch(...args), WebSocketImpl = WebSocket, settings = config.node } = {}) {
  const nodeCache = new Map(); // nodeId -> { node, at }
  const inflight = new Map(); // nodeId -> creations this process has started and not yet recorded

  async function nodeById(nodeId) {
    const hit = nodeCache.get(nodeId);
    if (hit && Date.now() - hit.at < NODE_CACHE_MS) return hit.node;
    const node = await getRepos().nodes.get(nodeId);
    nodeCache.set(nodeId, { node, at: Date.now() });
    return node;
  }

  const headers = () => ({ 'content-type': 'application/json', authorization: `Bearer ${settings.token}` });

  async function call(node, method, path, body) {
    let res;
    try {
      res = await fetchImpl(`${node.baseUrl.replace(/\/+$/, '')}${path}`, {
        method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn({ nodeId: node.nodeId, err: err.message }, '[RemoteEngine] lab node unreachable');
      throw problem('The lab server is not responding. Please try again.', 503);
    }
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  }

  /** What a node says it is running, or null if it cannot be reached. */
  async function inventory(node) {
    try {
      const { status, json } = await call(node, 'GET', '/v1/sandboxes');
      return status === 200 ? json.sandboxes || [] : null;
    } catch {
      return null;
    }
  }

  /** Healthy nodes with free seats, emptiest first. */
  async function candidates() {
    const nodes = await getRepos().nodes.listHealthy(settings.healthyMs);
    const out = [];
    for (const node of nodes) {
      // The registry knows sessions the node's last heartbeat does not yet; use whichever is higher.
      const recorded = (await getRepos().sessions.listByNode(node.nodeId)).length;
      const free = node.capacity - Math.max(node.running, recorded) - (inflight.get(node.nodeId) || 0);
      if (free > 0) out.push({ node, free });
    }
    return out.sort((a, b) => b.free - a.free);
  }

  async function totalCapacity() {
    return (await getRepos().nodes.listHealthy(settings.healthyMs)).reduce((n, node) => n + node.capacity, 0);
  }

  /** Seats left across healthy nodes (admission control for the manager). */
  async function freeSeats() {
    return (await candidates()).reduce((n, c) => n + c.free, 0);
  }

  /** Start a sandbox on the least-loaded node. @returns { engineId, nodeId, fromPool } */
  async function create(_ignoredId, { labId } = {}) {
    const tried = new Set();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const choice = (await candidates()).find((c) => !tried.has(c.node.nodeId));
      if (!choice) break;
      const { node } = choice;
      tried.add(node.nodeId);
      inflight.set(node.nodeId, (inflight.get(node.nodeId) || 0) + 1);
      try {
        const { status, json } = await call(node, 'POST', '/v1/sandboxes', { labId });
        if (status === 201) return { engineId: json.engineId, nodeId: node.nodeId, fromPool: Boolean(json.fromPool) };
        if (status !== 503) throw problem('Could not start a sandbox. Please try again.', 502);
        // 503: that node is full or draining; the next one may have room.
      } catch (err) {
        if (err.statusCode !== 503) throw err;
        // unreachable: try the next node
      } finally {
        const left = (inflight.get(node.nodeId) || 1) - 1;
        if (left > 0) inflight.set(node.nodeId, left);
        else inflight.delete(node.nodeId);
      }
    }
    throw problem('All sandboxes are in use. Please try again in a few minutes.', 503);
  }

  async function nodeFor(options) {
    const node = options && options.nodeId ? await nodeById(options.nodeId) : null;
    if (!node) throw problem('The lab server for this sandbox is not available.', 503);
    return node;
  }

  async function destroy(engineId, options) {
    try {
      const node = await nodeFor(options);
      const { status } = await call(node, 'DELETE', `/v1/sandboxes/${encodeURIComponent(engineId)}`);
      return status === 200;
    } catch (err) {
      // The session is already gone from the registry; reconciliation removes a container that outlives it.
      logger.warn({ engineId, err: err.message }, '[RemoteEngine] could not destroy sandbox on its node');
      return false;
    }
  }

  async function exec(engineId, command, options = {}) {
    const node = await nodeFor(options);
    const { status, json } = await call(node, 'POST', `/v1/sandboxes/${encodeURIComponent(engineId)}/exec`, { command, timeoutMs: options.timeoutMs });
    if (status === 404) throw new Error('Sandbox not found');
    if (status !== 200) throw problem(json.error || 'The command could not be run', 502);
    return json;
  }

  async function reset(engineId, options = {}) {
    const node = await nodeFor(options);
    const { status } = await call(node, 'POST', `/v1/sandboxes/${encodeURIComponent(engineId)}/reset`);
    if (status !== 200) throw problem('The sandbox could not be reset', 502);
  }

  /** Open the terminal stream; resolves to the same terminal object the local engines return, or null. */
  async function attach(engineId, options = {}) {
    const node = await nodeFor(options).catch(() => null);
    if (!node) return null;
    const url = `${node.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '')}/v1/sandboxes/${encodeURIComponent(engineId)}/attach`;
    const ws = new WebSocketImpl(url, { headers: { authorization: `Bearer ${settings.token}` }, handshakeTimeout: ATTACH_TIMEOUT_MS });

    // Listeners are attached before the connection finishes opening: the node may send the first output
    // (the prompt, the recent scrollback) in the same turn as the handshake, and it must not be lost.
    let onData = null;
    let onClose = null;
    let closed = false;
    const held = []; // output that arrives before anyone is listening
    ws.on('message', (data) => {
      const text = data.toString();
      if (onData) onData(text);
      else held.push(text);
    });
    ws.on('close', () => { closed = true; if (onClose) onClose(); });
    ws.on('error', () => {});

    const opened = await new Promise((resolve) => {
      ws.once('open', () => resolve(true));
      ws.once('error', () => resolve(false));
      ws.once('unexpected-response', () => resolve(false));
    });
    if (!opened) {
      ws.terminate();
      return null;
    }

    return {
      onData(callback) {
        onData = callback;
        for (const text of held.splice(0)) callback(text);
      },
      /** Called when the node connection ends (container exited, node restarted, network drop). */
      onClose(callback) {
        onClose = callback;
        if (closed) callback(); // it ended before anyone asked
      },
      write(data) { if (ws.readyState === ws.OPEN) ws.send(data); },
      resize(cols, rows) { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resize', cols, rows })); },
      close() { ws.close(); },
    };
  }

  return {
    name: 'remote',
    remote: true,
    owns: () => true,
    create,
    destroy,
    exec,
    reset,
    attach,
    freeSeats,
    totalCapacity,
    inventory,
    isAlive: () => true,
    onExit: () => {},
    info: () => ({ mode: 'remote' }),
    candidates,
    // The agents own their containers; nothing to adopt or sweep from here.
    reconcile: null,
    cleanupOrphans: null,
  };
}

let shared = null;
module.exports = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'createRemoteEngine') return createRemoteEngine;
    if (!shared) shared = createRemoteEngine();
    return shared[prop];
  },
});
