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

module.exports = { fakeSupabaseAdmin: require('./fakeSupabaseAdmin').fakeSupabaseAdmin, trustTestKey, accessToken, bearer, newId, signIn, guest, registered, tokenForUser, privateKey, KID };
