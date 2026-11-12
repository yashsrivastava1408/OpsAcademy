/**
 * Auth Routes — the cookie session around Supabase sign-in, the learner record, and the profile switch.
 * Sign-in itself (passwords, guests, email links) is done by Supabase Auth in the browser.
 */

const express = require('express');
const { requireAuth, requireRegistered } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const rateLimit = require('../middleware/rateLimit');
const config = require('../config');
const { loadAccess, forgetAccess } = require('../middleware/rbac');
const userService = require('../services/userService');
const { readCookie, serializeCookie } = require('../lib/cookies');
const supabaseApi = require('../lib/supabaseApi');

const router = express.Router();
const authLimiter = rateLimit.auth();

/**
 * The learner as the app shows them, plus their roles so the top bar knows whether to offer the Admin or the
 * college Schedule link. Roles only decide what to show: every admin route checks the role again on the server.
 */
async function withRoles(user, identity) {
  // Read fresh (the record may have just changed, for instance an email just confirmed) and leave nothing cached,
  // so this lookup never changes how the roles cache behaves for the rest of the API.
  forgetAccess(user.id);
  const access = await loadAccess(identity);
  forgetAccess(user.id);
  return { ...userService.publicUser(user), roles: access.roles };
}

// ── Cookie session for Supabase sign-in ─────────────────────────
// The browser holds the access token in memory only. The long-lived refresh token is kept in an
// HttpOnly cookie that scripts cannot read; these endpoints store it, rotate it and clear it.

const COOKIE_PATH = '/api/auth';
const cookieOptions = (maxAgeSeconds) => ({ ...config.authCookie, maxAgeSeconds, path: COOKIE_PATH });

/** A custom header cannot be sent cross-site without a CORS preflight, which only allowed origins pass. */
function requireAppHeader(req, res, next) {
  if (req.get('x-requested-with') !== 'opsacademy') {
    return res.status(400).json({ success: false, error: 'Missing X-Requested-With header' });
  }
  next();
}

async function startCookieSession(res, refreshToken) {
  const session = await supabaseApi.refreshSession(refreshToken);
  if (!session) return null;
  res.set('Set-Cookie', serializeCookie(config.authCookie.name, session.refreshToken, cookieOptions(config.authCookie.maxAgeSeconds)));
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, accessToken: session.accessToken, expiresAt: session.expiresAt });
  return session;
}

/** POST /api/auth/cookie — right after a Supabase sign-in: hand over the refresh token, keep only the cookie. */
router.post('/cookie', authLimiter, requireAppHeader, asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  if (typeof refreshToken !== 'string' || !refreshToken) {
    return res.status(400).json({ success: false, error: 'refreshToken is required' });
  }
  if (!(await startCookieSession(res, refreshToken))) {
    res.status(401).json({ success: false, error: 'That session is no longer valid' });
  }
}));

/** POST /api/auth/refresh — new access token from the cookie; the refresh token rotates every time. */
router.post('/refresh', authLimiter, requireAppHeader, asyncHandler(async (req, res) => {
  const refreshToken = readCookie(req, config.authCookie.name);
  if (!refreshToken) return res.status(401).json({ success: false, error: 'No session' });
  if (!(await startCookieSession(res, refreshToken))) {
    res.set('Set-Cookie', serializeCookie(config.authCookie.name, '', cookieOptions(0)));
    res.status(401).json({ success: false, error: 'Session expired' });
  }
}));

/** POST /api/auth/logout — clear the cookie and revoke the session ({ scope: 'global' } signs out every device). */
router.post('/logout', authLimiter, requireAppHeader, asyncHandler(async (req, res) => {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ') && config.supabaseUrl) {
    await supabaseApi.signOut(header.slice('Bearer '.length).trim(), req.body && req.body.scope);
  }
  res.set('Set-Cookie', serializeCookie(config.authCookie.name, '', cookieOptions(0)));
  res.json({ success: true });
}));

/**
 * POST /api/auth/session
 * First call after a Supabase sign-in: creates the learner's record if needed.
 * Token verification itself never writes, so this is the one explicit write.
 */
router.post('/session', authLimiter, requireAuth, asyncHandler(async (req, res) => {
  const user = await userService.ensureSupabaseUser(req.user);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });
  }
  res.json({ success: true, user: await withRoles(user, req.user) });
}));

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await userService.getById(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });
  }
  res.json({ success: true, user: await withRoles(user, req.user) });
}));

/**
 * POST /api/auth/profile
 * Body: { public }. Turn the shareable profile page on or off.
 */
router.post('/profile', requireAuth, requireRegistered, async (req, res, next) => {
  try {
    const user = await userService.setProfilePublic(req.user.id, Boolean(req.body && req.body.public));
    res.json({ success: true, user: userService.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
