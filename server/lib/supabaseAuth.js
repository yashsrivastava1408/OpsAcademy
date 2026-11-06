/**
 * Supabase JWT verification helper.
 *
 * Verifies Supabase access tokens using the project's JWKS (ES256 public keys)
 * or secret key, so verification happens 100% locally with zero latency.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('./logger');

const JWKS_CACHE = new Map(); // kid -> crypto.KeyObject
const ALLOWED_ALGORITHMS = ['ES256', 'RS256']; // asymmetric only; never trust the header
const AUDIENCE = 'authenticated';
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;
let jwksUrl = null;
let issuer = null;
let lastFetchAt = 0;
let inflight = null;

if (config.supabaseUrl) {
  const base = config.supabaseUrl.replace(/\/+$/, '');
  jwksUrl = `${base}/auth/v1/.well-known/jwks.json`;
  issuer = `${base}/auth/v1`;
}

/**
 * Fetch JWKS public keys from Supabase. Calls are coalesced and, unless
 * `force` is set, limited to one network fetch per minute so unknown key ids
 * cannot be used to hammer Supabase.
 */
function refreshJwks({ force = false } = {}) {
  if (!jwksUrl) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && lastFetchAt && Date.now() - lastFetchAt < MIN_REFRESH_INTERVAL_MS) return Promise.resolve();
  lastFetchAt = Date.now();
  inflight = fetchJwks().finally(() => {
    inflight = null;
  });
  return inflight;
}

async function fetchJwks() {
  try {
    const res = await fetch(jwksUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data.keys)) {
      for (const jwk of data.keys) {
        if (jwk.kid) {
          const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
          JWKS_CACHE.set(jwk.kid, key);
        }
      }
      logger.info({ count: data.keys.length }, '[SupabaseAuth] JWKS keys loaded');
    }
  } catch (err) {
    logger.warn({ err: err.message }, '[SupabaseAuth] Failed to fetch JWKS');
  }
}

// First load at startup; `ready()` lets the server wait for it.
const initialLoad = jwksUrl && !config.isTest ? refreshJwks({ force: true }) : Promise.resolve();
if (jwksUrl && !config.isTest) {
  // Refresh daily
  setInterval(() => refreshJwks({ force: true }), 24 * 60 * 60 * 1000).unref();
}

/** Resolves once the first JWKS load has finished (successfully or not). */
function ready() {
  return initialLoad;
}


/**
 * Synchronously verify a Supabase access token if its key is cached.
 * @returns {object|null} normalized user payload { id, name, email, guest }
 */
function verifySupabaseToken(token) {
  if (!token || typeof token !== 'string') return null;

  try {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || !decoded.header) return null;

    const kid = decoded.header.kid;
    const alg = decoded.header.alg;
    if (!ALLOWED_ALGORITHMS.includes(alg)) return null;

    let key = kid ? JWKS_CACHE.get(kid) : null;

    // If key not yet cached, but we know the algorithm, trigger a background refresh
    if (!key && jwksUrl) {
      refreshJwks();
      return null;
    }

    if (!key) return null;

    const payload = jwt.verify(token, key, { algorithms: ALLOWED_ALGORITHMS, issuer, audience: AUDIENCE });
    if (!payload || !payload.sub) return null;

    const metadata = payload.user_metadata || {};
    return {
      id: payload.sub,
      name: metadata.name || payload.email?.split('@')[0] || 'Learner',
      email: payload.email || null,
      guest: Boolean(payload.is_anonymous),
      emailVerified: Boolean(payload.email_confirmed_at),
      supabase: true,
    };
  } catch {
    return null;
  }
}

/** Tests only: trust this public key without fetching the project's JWKS, so a test can sign its own tokens. */
function setSigningKeyForTests(kid, key) {
  if (!config.isTest) throw new Error('setSigningKeyForTests is for tests only');
  JWKS_CACHE.set(kid, key);
}

module.exports = {
  verifySupabaseToken,
  setSigningKeyForTests,
  refreshJwks,
  ready,
};
