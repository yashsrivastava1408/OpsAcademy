/**
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

/** Lab accounts live in Supabase when the gateway no longer signs people in itself and holds the secret key. */
const enabled = () => !config.legacyAuth && Boolean(config.supabaseUrl && config.supabaseSecretKey);

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

const setPassword = (subject, password) => call('PUT', `/users/${encodeURIComponent(subject)}`, { password });
/** A banned user cannot sign in or refresh a session; "none" lifts it. */
const setBanned = (subject, banned) => call('PUT', `/users/${encodeURIComponent(subject)}`, { ban_duration: banned ? '876000h' : 'none' });
const deleteUser = (subject) => call('DELETE', `/users/${encodeURIComponent(subject)}`).catch(() => {});

module.exports = { LAB_EMAIL_DOMAIN, labEmail, enabled, createUser, setPassword, setBanned, deleteUser, LabIdentityError };
