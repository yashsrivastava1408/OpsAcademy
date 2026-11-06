/**
 * Rate limiters. Requests that carry a valid token are counted per user,
 * everything else per IP address. Counting per user matters for a classroom
 * or a college network, where every student shares one public address.
 */

const net = require('net');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');
const { verifyToken } = require('./auth');
const { getRepos } = require('../repositories');
const { SharedRateLimitStore } = require('../lib/rateLimitStore');

/** Addresses and ranges from CAMPUS_IPS. Invalid entries are skipped. */
function buildCampusList(entries) {
  const list = new net.BlockList();
  for (const entry of entries) {
    try {
      const [addr, prefix] = entry.split('/');
      const family = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
      if (!net.isIP(addr)) continue;
      if (prefix === undefined) list.addAddress(addr, family);
      else list.addSubnet(addr, Number(prefix), family);
    } catch {
      // ignore a malformed entry rather than refusing to start
    }
  }
  return list;
}

const campusList = buildCampusList(config.rateLimit.campusIps);
const hasCampus = config.rateLimit.campusIps.length > 0;

/** True when the request comes from a configured campus address. */
function isCampus(ip) {
  if (!hasCampus || !ip) return false;
  const clean = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped IPv6
  const family = net.isIPv6(clean) ? 'ipv6' : 'ipv4';
  try {
    return campusList.check(clean, family);
  } catch {
    return false;
  }
}

/** Who to count this request against. The limiter runs before the routes' own auth, so it reads the token itself. */
async function requestKey(req) {
  if (req.user) return `user:${req.user.id}`;
  const header = req.headers.authorization;
  const user = header && header.startsWith('Bearer ') ? await verifyToken(header.slice('Bearer '.length).trim()) : null;
  return user ? `user:${user.id}` : ipKeyGenerator(req.ip);
}

/**
 * @param {boolean} perUser  count signed-in callers separately. Off for the
 *   sign-in and new-guest limiters: a guest token is free to get, so counting
 *   those per token would let one address try passwords without limit.
 */
function limiter(max, message, { perUser = true, shared = null } = {}) {
  // Strict limiters count in the database so every gateway instance shares one total. The broad
  // /api limiter stays in memory: a database round trip on every request would cost more than it protects.
  const useShared = shared && !config.isTest && getRepos().driver === 'postgres';
  return rateLimit({
    ...(useShared ? { store: new SharedRateLimitStore(getRepos, shared), passOnStoreError: true } : {}),
    windowMs: config.rateLimit.windowMs,
    limit: (req) => (isCampus(req.ip) ? max * config.rateLimit.campusMultiplier : max),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: perUser ? requestKey : (req) => ipKeyGenerator(req.ip),
    handler: (req, res) => res.status(429).json({ success: false, error: message }),
  });
}

module.exports = {
  isCampus,
  buildCampusList,
  api: () => limiter(config.rateLimit.apiPerWindow, 'Too many requests. Please slow down.'),
  auth: () => limiter(config.rateLimit.authPerWindow, 'Too many sign-in attempts. Please wait a minute.', { perUser: false, shared: 'auth' }),
  sandboxStart: () => limiter(config.rateLimit.sandboxStartPerWindow, 'Too many sandboxes started. Please wait a minute.', { shared: 'sandbox' }),
  agent: () => limiter(config.rateLimit.agentPerWindow, 'Too many AI mentor requests. Please wait a minute.', { shared: 'agent' }),
};
