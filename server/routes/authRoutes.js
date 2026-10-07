/**
 * Auth Routes — guest identities, registration, login and profile
 */

const express = require('express');
const { requireAuth, optionalAuth, signToken } = require('../middleware/auth');
const rateLimit = require('../middleware/rateLimit');
const userService = require('../services/userService');

const router = express.Router();
const authLimiter = rateLimit.auth();

function session(user) {
  return { success: true, token: signToken(user), user: userService.publicUser(user) };
}

/**
 * POST /api/auth/guest
 * Issue an anonymous identity so a visitor can start labs without signing up
 */
router.post('/guest', rateLimit.guest(), (req, res) => {
  res.status(201).json(session(userService.createGuest()));
});

/**
 * POST /api/auth/register
 * Body: { name, email, password }. A guest token upgrades that guest in place.
 */
router.post('/register', authLimiter, optionalAuth, async (req, res, next) => {
  try {
    const guestId = req.user && req.user.guest ? req.user.id : null;
    const user = await userService.register(req.body || {}, guestId);
    res.status(201).json(session(user));
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
 * GET /api/auth/me
 */
router.get('/me', requireAuth, (req, res) => {
  const user = userService.getById(req.user.id);
  if (!user) {
    return res.status(401).json({ success: false, error: 'Unauthorized: account no longer exists' });
  }
  res.json({ success: true, user: userService.publicUser(user) });
});

module.exports = router;
