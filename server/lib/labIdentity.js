/**
 * The gateway's server-side calls to Supabase Auth (they use the secret key, which never leaves the server):
 * making, resetting and banning Lab ID accounts, and asking whether someone's email address is confirmed.
 *
 * Lab IDs on Supabase Auth (ADR 0003: one identity system).
 *
 * A Lab ID has no email, but Supabase signs people in by email. So each Lab ID gets a made-up address
 * (`<lab-id>@lab.opsacademy.invalid`) that never receives mail; the browser builds the same address
 * from the ID the student types (see client/src/lib/labEmail.js). The gateway creates the account and
 * sets its password with the secret key, which never leaves the server.
 */
const config = require('../config');

const LAB_EMAIL_DOMAIN = 'lab.opsacademy.invalid';
const labEmail = (username) => `${String(username).trim().toLowerCase()}@${LAB_EMAIL_DOMAIN}`;

/** Lab accounts live in Supabase, so making them needs the project URL and the secret key. */
const configured = () => Boolean(config.supabaseUrl && config.supabaseSecretKey);

class LabIdentityError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function call(method, path, body) {
  const base = `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/admin`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', apikey: config.supabaseSecretKey, authorization: `Bearer ${config.supabaseSecretKey}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new LabIdentityError(`Sign-in service answered ${res.status}`, res.status === 422 ? 409 : 502);
  return res.status === 204 ? null : res.json();
}

/** @returns {Promise<string>} the Supabase user id */
async function createUser({ username, name, password }) {
  const made = await call('POST', '/users', { email: labEmail(username), password, email_confirm: true, user_metadata: { name, lab_id: username } });
  return made.id;
}

/**
 * Has Supabase confirmed this user's email address? A Supabase access token does not say (it has no
 * `email_confirmed_at`, and `user_metadata` can be edited by the user), so this asks Supabase directly.
 * @returns {Promise<boolean>} false when it cannot tell
 */
async function emailConfirmed(subject) {
  try {
    const user = await call('GET', `/users/${encodeURIComponent(subject)}`);
    return Boolean(user && user.email_confirmed_at);
  } catch {
    return false;
  }
}

const setPassword = (subject, password) => call('PUT', `/users/${encodeURIComponent(subject)}`, { password });
/** A banned user cannot sign in or refresh a session; "none" lifts it. */
const setBanned = (subject, banned) => call('PUT', `/users/${encodeURIComponent(subject)}`, { ban_duration: banned ? '876000h' : 'none' });
const deleteUser = (subject) => call('DELETE', `/users/${encodeURIComponent(subject)}`).catch(() => {});

module.exports = { LAB_EMAIL_DOMAIN, labEmail, configured, emailConfirmed, createUser, setPassword, setBanned, deleteUser, LabIdentityError };
