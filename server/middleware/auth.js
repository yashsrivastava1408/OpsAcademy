/**
 * JWT authentication middleware
 *
 * Every API caller has an identity: either a registered account or a guest
 * token issued by POST /api/auth/guest. That identity owns sandboxes and
 * progress, so limits and access checks have something to attach to.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getRepos } = require('../repositories');
const { verifySupabaseToken } = require('../lib/supabaseAuth');

function signToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, guest: Boolean(user.guest) },
    config.jwtSecret,
    { expiresIn: user.guest ? config.guestJwtExpiry : config.jwtExpiry }
  );
}

// A password reset must sign out older tokens, which needs a look at the user's record.
// The answer is cached for a few seconds per process so a busy learner does not cost a
// query per request; a reset handled by this process clears it at once.
const PASSWORD_CHECK_TTL_MS = 5000;
const passwordCaches = new WeakMap(); // repositories -> Map<userId, { value, at }>

function passwordCache() {
  const repos = getRepos();
  let cache = passwordCaches.get(repos);
  if (!cache) {
    cache = new Map();
    passwordCaches.set(repos, cache);
  }
  return cache;
}

async function passwordChangedAt(userId) {
  const cache = passwordCache();
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < PASSWORD_CHECK_TTL_MS) return hit.value;
  const user = await getRepos().users.getById(userId);
  const value = user && user.passwordChangedAt ? user.passwordChangedAt : null;
  if (cache.size > 5000) cache.clear();
  cache.set(userId, { value, at: Date.now() });
  return value;
}

/** Forget what is cached about a user (after their password changes). */
function forgetUser(userId) {
  passwordCache().delete(userId);
}

/** @returns the token payload, or null if the token is missing, expired or forged */
async function verifyToken(token) {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    // Not one of ours: it may be a Supabase access token.
    // Read-only: a first-time Supabase user is created by POST /api/auth/session.
    return verifySupabaseToken(token);
  }

  // Resetting a password signs out every session started before it, so a
  // stolen token stops working. Guests have no password to change.
  if (!payload.guest) {
    const changedAt = await passwordChangedAt(payload.id);
    if (changedAt && payload.iat * 1000 < changedAt) return null;
  }
  return payload;
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
module.exports.signToken = signToken;
module.exports.verifyToken = verifyToken;
module.exports.forgetUser = forgetUser;
module.exports.safeEqual = safeEqual;
