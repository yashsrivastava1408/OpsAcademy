/**
 * Auth Routes — guest identities, registration, login and profile
 */

const express = require('express');
const { requireAuth, optionalAuth, requireRegistered, signToken, forgetUser } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const rateLimit = require('../middleware/rateLimit');
const config = require('../config');
const { getMailer } = require('../lib/mailer');
const userService = require('../services/userService');
const { readCookie, serializeCookie } = require('../lib/cookies');
const supabaseApi = require('../lib/supabaseApi');

const router = express.Router();
const authLimiter = rateLimit.auth();

/** Endpoints of the old sign-in. They disappear (404) once LEGACY_AUTH=off. */
function legacyOnly(req, res, next) {
  if (config.legacyAuth) return next();
  res.status(404).json({ success: false, error: 'Not found' });
}

function session(user) {
  return { success: true, token: signToken(user), user: userService.publicUser(user) };
}

/**
 * Where a link goes when no mail provider is set up. Outside production the
 * link is returned to the caller so the flow can be tried; in production it
 * only reaches the server log, never the response.
 */
function devLink(link) {
  return !config.isProd && !getMailer().delivers ? link : undefined;
}

/** Emails are sent in the background: a slow mail provider must not slow the request, or reveal which addresses have accounts. */
function sendLater(message) {
  getMailer().send(message).catch(() => {});
}

async function sendVerification(user) {
  const link = `${config.appUrl}/verify-email?token=${await userService.createEmailVerification(user.id)}`;
  sendLater({
    to: user.email,
    subject: 'Confirm your OpsAcademy email address',
    text: `Hi ${user.name},\n\nConfirm your email address by opening this link (valid for 24 hours):\n${link}\n\nIf you did not create an OpsAcademy account, ignore this message.`,
  });
  return link;
}

/**
 * POST /api/auth/guest
 * Issue an anonymous identity so a visitor can start labs without signing up
 */
router.post('/guest', legacyOnly, rateLimit.guest(), asyncHandler(async (req, res) => {
  res.status(201).json(session(await userService.createGuest()));
}));

/**
 * POST /api/auth/register
 * Body: { name, email, password }. A guest token upgrades that guest in place.
 */
router.post('/register', legacyOnly, authLimiter, optionalAuth, async (req, res, next) => {
  try {
    const guestId = req.user && req.user.guest ? req.user.id : null;
    const user = await userService.register(req.body || {}, guestId);
    const link = await sendVerification(user);
    res.status(201).json({ ...session(user), devVerifyLink: devLink(link) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', legacyOnly, authLimiter, async (req, res, next) => {
  try {
    const user = await userService.login(req.body || {});
    res.json(session(user));
  } catch (err) {
    next(err);
  }
});

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
  const user = req.user.supabase ? await userService.ensureSupabaseUser(req.user) : await userService.getById(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });
  }
  res.json({ success: true, user: userService.publicUser(user) });
}));

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const user = await userService.getById(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });
  }
  res.json({ success: true, user: userService.publicUser(user) });
}));

/**
 * POST /api/auth/forgot
 * Body: { email }. Always answers the same, whether or not the account exists.
 */
router.post('/forgot', legacyOnly, authLimiter, async (req, res, next) => {
  try {
    const mailer = getMailer();
    const found = await userService.requestPasswordReset(req.body && req.body.email);
    let link;
    if (found) {
      link = `${config.appUrl}/reset-password?token=${found.token}`;
      sendLater({
        to: found.user.email,
        subject: 'Reset your OpsAcademy password',
        text: `Hi ${found.user.name},\n\nOpen this link to choose a new password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, ignore this message; your password stays the same.`,
      });
    }
    res.json({
      success: true,
      message: 'If an account uses that email address, a reset link is on its way.',
      // The page can say so plainly when this server cannot send email.
      emailConfigured: mailer.delivers,
      devResetLink: link && devLink(link),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/reset
 * Body: { token, password }. Signs the user in with the new password.
 */
router.post('/reset', legacyOnly, authLimiter, async (req, res, next) => {
  try {
    const { token, password } = req.body || {};
    const user = await userService.resetPassword(token, password);
    forgetUser(user.id);
    res.json(session(user));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/verify-email
 * Body: { token }
 */
router.post('/verify-email', legacyOnly, authLimiter, async (req, res, next) => {
  try {
    const user = await userService.verifyEmail(req.body && req.body.token);
    res.json({ success: true, user: userService.publicUser(user) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/resend-verification
 * Send the signed-in account a new confirmation link
 */
router.post('/resend-verification', legacyOnly, authLimiter, requireAuth, requireRegistered, async (req, res, next) => {
  try {
    const user = await userService.getById(req.user.id);
    if (!user) return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });
    if (user.emailVerified) return res.json({ success: true, alreadyVerified: true });
    const link = await sendVerification(user);
    res.json({ success: true, emailConfigured: getMailer().delivers, devVerifyLink: devLink(link) });
  } catch (err) {
    next(err);
  }
});

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
