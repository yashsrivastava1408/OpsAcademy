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

const router = express.Router();
const authLimiter = rateLimit.auth();

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
router.post('/guest', rateLimit.guest(), asyncHandler(async (req, res) => {
  res.status(201).json(session(await userService.createGuest()));
}));

/**
 * POST /api/auth/register
 * Body: { name, email, password }. A guest token upgrades that guest in place.
 */
router.post('/register', authLimiter, optionalAuth, async (req, res, next) => {
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
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const user = await userService.login(req.body || {});
    res.json(session(user));
  } catch (err) {
    next(err);
  }
});

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
router.post('/forgot', authLimiter, async (req, res, next) => {
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
router.post('/reset', authLimiter, async (req, res, next) => {
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
router.post('/verify-email', authLimiter, async (req, res, next) => {
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
router.post('/resend-verification', authLimiter, requireAuth, requireRegistered, async (req, res, next) => {
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
