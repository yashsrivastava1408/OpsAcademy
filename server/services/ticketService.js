/**
 * Terminal tickets: a browser trades its bearer token for a short-lived, single-use ticket and opens
 * the terminal WebSocket with that, so no JWT ever sits in a URL (and so in access logs).
 * Only the SHA-256 of a ticket is stored.
 */
const crypto = require('crypto');
const { getRepos } = require('../repositories');

const TICKET_TTL_MS = 30 * 1000;

const hash = (ticket) => crypto.createHash('sha256').update(ticket).digest('hex');

/** @returns {{ ticket: string, expiresInMs: number }} */
async function issue(sessionId, userId, now = Date.now()) {
  const ticket = crypto.randomBytes(32).toString('base64url');
  await getRepos().tickets.create({ hash: hash(ticket), sessionId, userId, expiresAt: now + TICKET_TTL_MS });
  return { ticket, expiresInMs: TICKET_TTL_MS };
}

/** Use a ticket. @returns { sessionId, userId }, or null if it is unknown, already used or expired */
async function redeem(ticket) {
  if (typeof ticket !== 'string' || ticket.length < 16 || ticket.length > 128) return null;
  return getRepos().tickets.redeem(hash(ticket));
}

const prune = () => getRepos().tickets.prune();

module.exports = { issue, redeem, prune, TICKET_TTL_MS };
