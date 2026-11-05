const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const SUPABASE_URL = 'https://example.supabase.co';

function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-kid', alg: 'ES256', use: 'sig' };
  return { jwk, privateKey };
}

function sign(privateKey, payload, { iss = `${SUPABASE_URL}/auth/v1`, aud = 'authenticated', ...header } = {}) {
  return jwt.sign({ iss, aud, ...payload }, privateKey, {
    algorithm: 'ES256',
    keyid: 'test-kid',
    ...header,
  });
}

function loadModule(fetchImpl) {
  process.env.SUPABASE_URL = SUPABASE_URL;
  global.fetch = fetchImpl;
  let mod;
  jest.isolateModules(() => {
    mod = require('../lib/supabaseAuth');
  });
  return mod;
}

describe('supabaseAuth', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    delete process.env.SUPABASE_URL;
    global.fetch = originalFetch;
  });

  it('returns null for missing or non-string tokens', () => {
    const { verifySupabaseToken } = loadModule(jest.fn());
    expect(verifySupabaseToken()).toBeNull();
    expect(verifySupabaseToken(42)).toBeNull();
    expect(verifySupabaseToken('not-a-jwt')).toBeNull();
  });

  it('verifies a token once its JWKS key is cached and normalizes the user', async () => {
    const { jwk, privateKey } = makeKeys();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [jwk] }) });
    const { verifySupabaseToken, refreshJwks } = loadModule(fetchMock);
    await refreshJwks();

    const token = sign(privateKey, {
      sub: 'user-1',
      email: 'ada@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      user_metadata: { name: 'Ada' },
    });
    expect(verifySupabaseToken(token)).toEqual({
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.com',
      guest: false,
      emailVerified: true,
      supabase: true,
    });
  });

  it('falls back to the email prefix, then "Learner", for the name and flags anonymous users', async () => {
    const { jwk, privateKey } = makeKeys();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [jwk] }) });
    const { verifySupabaseToken, refreshJwks } = loadModule(fetchMock);
    await refreshJwks();

    expect(verifySupabaseToken(sign(privateKey, { sub: 'u2', email: 'grace@example.com' })).name).toBe('grace');
    const anon = verifySupabaseToken(sign(privateKey, { sub: 'u3', is_anonymous: true }));
    expect(anon).toMatchObject({ name: 'Learner', email: null, guest: true, emailVerified: false });
  });

  it('rejects tokens signed by another key, expired tokens and tokens without a subject', async () => {
    const { jwk, privateKey } = makeKeys();
    const other = makeKeys();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [jwk] }) });
    const { verifySupabaseToken, refreshJwks } = loadModule(fetchMock);
    await refreshJwks();

    expect(verifySupabaseToken(sign(other.privateKey, { sub: 'x' }))).toBeNull();
    expect(verifySupabaseToken(sign(privateKey, { sub: 'x', exp: Math.floor(Date.now() / 1000) - 60 }))).toBeNull();
    expect(verifySupabaseToken(sign(privateKey, { email: 'a@b.c' }))).toBeNull();
  });

  it('rejects the wrong issuer, the wrong audience and an unexpected algorithm', async () => {
    const { jwk, privateKey } = makeKeys();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [jwk] }) });
    const { verifySupabaseToken, refreshJwks } = loadModule(fetchMock);
    await refreshJwks();

    expect(verifySupabaseToken(sign(privateKey, { sub: 'x' }, { iss: 'https://evil.example/auth/v1' }))).toBeNull();
    expect(verifySupabaseToken(sign(privateKey, { sub: 'x' }, { aud: 'anon' }))).toBeNull();
    // HS256 token "signed" with a public value: must be refused before any key lookup.
    const hs = jwt.sign({ sub: 'x', iss: `${SUPABASE_URL}/auth/v1`, aud: 'authenticated' }, 'secret', {
      algorithm: 'HS256',
      keyid: 'test-kid',
    });
    expect(verifySupabaseToken(hs)).toBeNull();
    expect(verifySupabaseToken(sign(privateKey, { sub: 'ok' }))).toMatchObject({ id: 'ok' });
  });

  it('fetches the JWKS at most once per minute, however many unknown key ids arrive', async () => {
    const { privateKey } = makeKeys();
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ keys: [] }) });
    const { verifySupabaseToken, refreshJwks } = loadModule(fetchMock);
    await refreshJwks();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 25; i += 1) {
      verifySupabaseToken(sign(privateKey, { sub: 'x' }, { keyid: `unknown-${i}` }));
    }
    await refreshJwks();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await refreshJwks({ force: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('exposes ready() for startup', async () => {
    const { ready } = loadModule(jest.fn());
    await expect(ready()).resolves.toBeUndefined();
  });

  it('returns null and refreshes in the background when the key is not cached yet', () => {
    const { privateKey } = makeKeys();
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 500 });
    const { verifySupabaseToken } = loadModule(fetchMock);

    expect(verifySupabaseToken(sign(privateKey, { sub: 'x' }))).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  });

  it('survives a failing JWKS fetch', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    const { refreshJwks } = loadModule(fetchMock);
    await expect(refreshJwks()).resolves.toBeUndefined();
  });

  it('does nothing when Supabase is not configured', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    let mod;
    jest.isolateModules(() => {
      jest.doMock('../config', () => ({ ...jest.requireActual('../config'), supabaseUrl: null }));
      mod = require('../lib/supabaseAuth');
    });
    await mod.refreshJwks();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
