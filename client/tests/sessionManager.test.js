import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionManager } from '../src/lib/sessionManager.js';

function harness({ responses }) {
  const calls = [];
  let clock = 1_000_000;
  const timers = [];
  const manager = createSessionManager({
    apiBase: 'https://api.test',
    now: () => clock,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return { id: timers.length }; },
    clearTimer: () => {},
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      return { status: next.status, ok: next.status < 400, json: async () => next.body };
    },
  });
  return { manager, calls, timers, tick: (ms) => { clock += ms; } };
}

const tokenReply = (token, ms = 900_000) => ({ status: 200, body: { accessToken: token, expiresAt: 1_000_000 + ms } });

test('adopt sends the refresh token to the gateway with credentials and the app header, and keeps only the access token', async () => {
  const { manager, calls } = harness({ responses: [tokenReply('a1')] });
  assert.equal(await manager.adopt('r1'), 'a1');
  assert.equal(manager.getAccessToken(), 'a1');
  assert.equal(calls[0].url, 'https://api.test/api/auth/cookie');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.headers['x-requested-with'], 'opsacademy');
  assert.deepEqual(JSON.parse(calls[0].init.body), { refreshToken: 'r1' });
});

test('ensure reuses a token that is still good and renews one that is about to expire', async () => {
  const { manager, calls, tick } = harness({ responses: [tokenReply('a1'), tokenReply('a2')] });
  await manager.adopt('r1');
  assert.equal(await manager.ensure(), 'a1');
  assert.equal(calls.length, 1);
  tick(895_000); // 5 s left
  assert.equal(await manager.ensure(), 'a2');
  assert.equal(calls[1].url, 'https://api.test/api/auth/refresh');
});

test('concurrent refreshes share one request', async () => {
  const { manager, calls } = harness({ responses: [tokenReply('a1')] });
  const [a, b] = await Promise.all([manager.refresh(), manager.refresh()]);
  assert.equal(a, 'a1');
  assert.equal(b, 'a1');
  assert.equal(calls.length, 1);
});

test('a refused refresh signs out: token cleared and the listener told', async () => {
  let signedOut = 0;
  const calls = [];
  const manager = createSessionManager({
    fetchImpl: async (url) => { calls.push(url); return { status: 401, ok: false, json: async () => ({}) }; },
    onSignedOut: () => { signedOut += 1; },
    setTimer: () => null,
  });
  assert.equal(await manager.ensure(), null);
  assert.equal(manager.getAccessToken(), null);
  assert.equal(signedOut, 1);
});

test('a renewal is scheduled a minute before expiry', async () => {
  const { manager, timers } = harness({ responses: [tokenReply('a1', 900_000)] });
  await manager.adopt('r1');
  assert.equal(timers.at(-1).ms, 840_000);
});

test('sign out clears memory at once and revokes with the old token', async () => {
  const { manager, calls } = harness({ responses: [tokenReply('a1'), { status: 200, body: {} }] });
  await manager.adopt('r1');
  await manager.signOut('global');
  assert.equal(manager.getAccessToken(), null);
  assert.equal(calls[1].url, 'https://api.test/api/auth/logout');
  assert.equal(calls[1].init.headers.authorization, 'Bearer a1');
  assert.deepEqual(JSON.parse(calls[1].init.body), { scope: 'global' });
});

test('no token is ever written to localStorage', async () => {
  const writes = [];
  globalThis.localStorage = { setItem: (...a) => writes.push(a), getItem: () => null, removeItem() {} };
  const { manager } = harness({ responses: [tokenReply('a1')] });
  await manager.adopt('r1');
  delete globalThis.localStorage;
  assert.deepEqual(writes, []);
});
