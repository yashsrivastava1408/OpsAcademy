/**
 * Rate limiters. Requests that carry a valid token are counted per user,
 * everything else per IP address. Counting per user matters for a classroom
 * or a college network, where every student shares one public address.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const { verifyToken } = require('./auth');

/** Who to count this request against. The limiter runs before the routes' own auth, so it reads the token itself. */
function requestKey(req) {
  if (req.user) return `user:${req.user.id}`;
  const header = req.headers.authorization;
  const user = header && header.startsWith('Bearer ') ? verifyToken(header.slice('Bearer '.length).trim()) : null;
  return user ? `user:${user.id}` : ipKeyGenerator(req.ip);
}

/**
 * @param {boolean} perUser  count signed-in callers separately. Off for the
 *   sign-in and new-guest limiters: a guest token is free to get, so counting
 *   those per token would let one address try passwords without limit.
 */
function limiter(max, message, { perUser = true } = {}) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: perUser ? requestKey : (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ success: false, error: message }),
  });
}

module.exports = {
  api: () => limiter(config.rateLimit.apiPerWindow, 'Too many requests. Please slow down.'),
  auth: () => limiter(config.rateLimit.authPerWindow, 'Too many sign-in attempts. Please wait a minute.', { perUser: false }),
  guest: () => limiter(config.rateLimit.guestPerWindow, 'Too many new sessions from this network. Please wait a minute.', { perUser: false }),
  sandboxStart: () => limiter(config.rateLimit.sandboxStartPerWindow, 'Too many sandboxes started. Please wait a minute.'),
  agent: () => limiter(config.rateLimit.agentPerWindow, 'Too many AI mentor requests. Please wait a minute.'),
};
