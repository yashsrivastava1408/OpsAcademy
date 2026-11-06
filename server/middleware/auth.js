/**
 * Authentication middleware
 *
 * Every API caller has a Supabase identity: a registered account (including Lab IDs) or an anonymous
 * guest. That identity owns sandboxes and progress, so limits and access checks have something to attach to.
 * Only Supabase access tokens are accepted (ADR 0003); verification is local, against the project's signing keys.
 */

const crypto = require('crypto');
const { getRepos } = require('../repositories');
const { verifySupabaseToken } = require('../lib/supabaseAuth');

// A Supabase user maps to an app user through `identities` (accounts migrated from the old sign-in
// keep their original id). New Supabase users have no row there and use their Supabase id.
const IDENTITY_TTL_MS = 30 * 1000;
const UNLINKED_TTL_MS = 5 * 1000;
const identityCaches = new WeakMap(); // repositories -> Map<sub, { userId|null, at }>

function identityCache() {
  const repos = getRepos();
  let cache = identityCaches.get(repos);
  if (!cache) {
    cache = new Map();
    identityCaches.set(repos, cache);
  }
  return cache;
}

/** Forget a cached identity lookup (right after linking one). */
function forgetIdentity(subject) {
  identityCache().delete(subject);
}

async function resolveSupabaseUser(payload) {
  if (!payload || !payload.supabase) return payload;
  const cache = identityCache();
  let hit = cache.get(payload.id);
  if (!hit || Date.now() - hit.at >= (hit.userId ? IDENTITY_TTL_MS : UNLINKED_TTL_MS)) {
    hit = { userId: await getRepos().identities.getUserId('supabase', payload.id), at: Date.now() };
    if (cache.size > 5000) cache.clear();
    cache.set(payload.id, hit);
  }
  return hit.userId ? { ...payload, id: hit.userId, subject: payload.id } : payload;
}

/**
 * @returns the user behind a Supabase access token, or null if the token is missing, expired or forged.
 * Read-only: a first-time user is created by POST /api/auth/session.
 */
async function verifyToken(token) {
  if (!token) return null;
  return resolveSupabaseUser(verifySupabaseToken(token));
}

function tokenFromRequest(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

async function requireAuth(req, res, next) {
  try {
    const user = await verifyToken(tokenFromRequest(req));
    if (!user) {
      return res.status(401).json({ success: false, error: 'Unauthorized: missing, expired or invalid token' });
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** Attaches req.user when a valid token is present, but lets the request through either way. */
async function optionalAuth(req, res, next) {
  try {
    req.user = await verifyToken(tokenFromRequest(req));
    next();
  } catch (err) {
    next(err);
  }
}

/** For features that need a real account, such as certificates. */
function requireRegistered(req, res, next) {
  if (!req.user || req.user.guest) {
    return res.status(403).json({ success: false, error: 'Create an account to use this feature' });
  }
  next();
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

module.exports = requireAuth;
module.exports.requireAuth = requireAuth;
module.exports.optionalAuth = optionalAuth;
module.exports.requireRegistered = requireRegistered;
module.exports.verifyToken = verifyToken;
module.exports.forgetIdentity = forgetIdentity;
module.exports.safeEqual = safeEqual;
