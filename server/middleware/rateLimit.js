/**
 * Rate limiters. Authenticated requests are counted per user, everything
 * else per IP address.
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

function limiter(max, message) {
  return rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
    handler: (req, res) => res.status(429).json({ success: false, error: message }),
  });
}

module.exports = {
  api: () => limiter(config.rateLimit.apiPerWindow, 'Too many requests. Please slow down.'),
  auth: () => limiter(config.rateLimit.authPerWindow, 'Too many sign-in attempts. Please wait a minute.'),
  guest: () => limiter(config.rateLimit.guestPerWindow, 'Too many new sessions from this network. Please wait a minute.'),
  sandboxStart: () => limiter(config.rateLimit.sandboxStartPerWindow, 'Too many sandboxes started. Please wait a minute.'),
  agent: () => limiter(config.rateLimit.agentPerWindow, 'Too many AI mentor requests. Please wait a minute.'),
};
