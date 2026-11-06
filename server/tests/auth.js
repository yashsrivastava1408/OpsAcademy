/**
 * Signing in for tests, the way the real thing works: a Supabase-style access token (ES256, signed here with a
 * test key the gateway is told to trust), then POST /api/auth/session, which creates the learner's record.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { setSigningKeyForTests } = require('../lib/supabaseAuth');

const KID = 'test-signing-key';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
setSigningKeyForTests(KID, publicKey);

const ISSUER = `${process.env.SUPABASE_URL}/auth/v1`;

/** An access token for `sub`. Anonymous (guest) unless an email is given. */
function accessToken({ sub, name, email = null, emailVerified = true, anonymous = !email, expiresInSeconds = 900, extra = {} }) {
  const claims = {
    iss: ISSUER,
    aud: 'authenticated',
    sub,
    is_anonymous: anonymous,
    user_metadata: name ? { name } : {},
    ...extra,
  };
  if (email) {
    claims.email = email;
    if (emailVerified) claims.email_confirmed_at = '2026-01-01T00:00:00Z';
  }
  return jwt.sign(claims, privateKey, { algorithm: 'ES256', keyid: KID, expiresIn: expiresInSeconds });
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const newId = () => crypto.randomUUID();

/** Sign in as `sub` (creating the record on first use). @returns { token, user, auth, sub } */
async function signIn(app, claims) {
  const token = accessToken(claims);
  const res = await request(app).post('/api/auth/session').set(bearer(token));
  if (res.status !== 200) throw new Error(`test sign-in failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token, user: res.body.user, auth: bearer(token), sub: claims.sub };
}

/** An anonymous learner, like a visitor who just opened a lab. */
const guest = (app, claims = {}) => signIn(app, { sub: newId(), ...claims });

/** A learner with a confirmed email address. */
function registered(app, overrides = {}) {
  const email = overrides.email || `asha${Math.random().toString(36).slice(2)}@example.com`;
  return signIn(app, { sub: newId(), name: 'Asha Rao', ...overrides, email, anonymous: false }).then((who) => ({ ...who, email, name: overrides.name || 'Asha Rao' }));
}

/** A user that already exists in the store (made by the test directly) and the token that goes with them. */
function tokenForUser(user, extra = {}) {
  return accessToken({ sub: user.id, name: user.name, email: user.email || null, anonymous: Boolean(user.guest), ...extra });
}

/** For a test that builds the app in its own module registry (jest.isolateModules): trust the test key there too. */
function trustTestKey() {
  require('../lib/supabaseAuth').setSigningKeyForTests(KID, publicKey);
}

/**
 * A stand-in for the Supabase Auth admin API (what the gateway calls to make, reset and ban Lab ID accounts) and for
 * signing in with a Lab ID, so lab account tests need no network. Call restore() when the test is done.
 */
function fakeSupabaseAdmin() {
  const config = require('../config');
  const { labEmail } = require('../lib/labIdentity');
  const saved = { key: config.supabaseSecretKey, fetch: global.fetch };
  const accounts = new Map(); // supabase id -> { email, name, password, banned }
  const calls = [];
  let failWith = null;

  const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  config.supabaseSecretKey = 'test-secret-key';
  global.fetch = async (url, init = {}) => {
    const match = new URL(url).pathname.match(/\/auth\/v1\/admin\/users(?:\/([^/]+))?$/);
    if (!match) throw new Error(`unexpected request to ${url}`);
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ method: init.method, id: match[1] || null, body });
    if (failWith) return reply(failWith);
    if (init.method === 'POST' && !match[1]) {
      if ([...accounts.values()].some((a) => a.email === body.email)) return reply(422);
      const id = newId(); // unique across tests: the gateway caches which app user a Supabase id belongs to
      accounts.set(id, { email: body.email, name: (body.user_metadata || {}).name, password: body.password, banned: false });
      return reply(200, { id });
    }
    const account = accounts.get(match[1]);
    if (!account) return reply(404);
    if (init.method === 'PUT') {
      if (body.password) account.password = body.password;
      if (body.ban_duration) account.banned = body.ban_duration !== 'none';
      return reply(200, { id: match[1] });
    }
    if (init.method === 'DELETE') { accounts.delete(match[1]); return reply(200); }
    return reply(405);
  };

  return {
    accounts,
    calls,
    /** Make the next admin calls fail with this HTTP status (null to stop). */
    failWith: (status) => { failWith = status; },
    /** Sign in with a Lab ID and password the way Supabase would, then open the learner's session. @returns { status, user, auth, token } */
    async signIn(app, labId, password) {
      const found = [...accounts.entries()].find(([, a]) => a.email === labEmail(labId));
      if (!found || found[1].password !== password) return { status: 401 };
      if (found[1].banned) return { status: 403 };
      const [sub, account] = found;
      const who = await signIn(app, { sub, name: account.name, email: account.email, anonymous: false });
      return { status: 200, ...who };
    },
    restore() { config.supabaseSecretKey = saved.key; global.fetch = saved.fetch; },
  };
}

module.exports = { fakeSupabaseAdmin, trustTestKey, accessToken, bearer, newId, signIn, guest, registered, tokenForUser, privateKey, KID };
