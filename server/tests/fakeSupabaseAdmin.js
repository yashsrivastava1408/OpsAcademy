const crypto = require('crypto');

/**
 * A stand-in for the Supabase Auth admin API (what the gateway calls to make, reset and ban Lab ID accounts) and for
 * signing in with a Lab ID, so lab account tests need no network. Call restore() when the test is done.
 */
function fakeSupabaseAdmin() {
  const config = require('../config');
  const { labEmail } = require('../lib/labIdentity');
  const saved = { key: config.supabaseSecretKey, fetch: global.fetch };
  const accounts = new Map(); // supabase id -> { email, name, password, banned }
  const confirmed = new Map(); // supabase id of a self-signed-up user -> is the email confirmed (users a test describes, not Lab IDs)
  const calls = [];
  let failWith = null;

  const reply = (status, body = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  config.supabaseSecretKey = 'test-secret-key';
  global.fetch = async (url, init = {}) => {
    const match = new URL(url).pathname.match(/\/auth\/v1\/admin\/users(?:\/([^/]+))?$/);
    if (!match) throw new Error(`unexpected request to ${url}`);
    const body = init.body ? JSON.parse(init.body) : {};
    calls.push({ method: init.method, id: match[1] || null, body });
    if (failWith) return reply(failWith);
    if (init.method === 'POST' && !match[1]) {
      if ([...accounts.values()].some((a) => a.email === body.email)) return reply(422);
      const id = crypto.randomUUID(); // unique across tests: the gateway caches which app user a Supabase id belongs to
      accounts.set(id, { email: body.email, name: (body.user_metadata || {}).name, password: body.password, banned: false });
      return reply(200, { id });
    }
    if (init.method === 'GET') {
      if (confirmed.has(match[1])) return reply(200, { id: match[1], email_confirmed_at: confirmed.get(match[1]) ? '2026-01-01T00:00:00Z' : null });
      if (accounts.has(match[1])) return reply(200, { id: match[1], email_confirmed_at: '2026-01-01T00:00:00Z' });
      return reply(404);
    }
    const account = accounts.get(match[1]);
    if (!account) return reply(404);
    if (init.method === 'PUT') {
      if (body.password) account.password = body.password;
      if (body.ban_duration) account.banned = body.ban_duration !== 'none';
      return reply(200, { id: match[1] });
    }
    if (init.method === 'DELETE') { accounts.delete(match[1]); return reply(200); }
    return reply(405);
  };

  return {
    accounts,
    calls,
    /** What Supabase will say about whether this user's email address is confirmed. */
    setEmailConfirmed: (subject, isConfirmed) => confirmed.set(subject, isConfirmed),
    /** Make the next admin calls fail with this HTTP status (null to stop). */
    failWith: (status) => { failWith = status; },
    /** Sign in with a Lab ID and password the way Supabase would, then open the learner's session. @returns { status, user, auth, token } */
    async signIn(app, labId, password) {
      const found = [...accounts.entries()].find(([, a]) => a.email === labEmail(labId));
      if (!found || found[1].password !== password) return { status: 401 };
      if (found[1].banned) return { status: 403 };
      const [sub, account] = found;
      const who = await require('./auth').signIn(app, { sub, name: account.name, email: account.email, anonymous: false });
      return { status: 200, ...who };
    },
    restore() { config.supabaseSecretKey = saved.key; global.fetch = saved.fetch; },
  };
}

module.exports = { fakeSupabaseAdmin };
