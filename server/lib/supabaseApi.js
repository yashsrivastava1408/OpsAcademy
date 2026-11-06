/**
 * The two Supabase Auth calls the gateway makes for the cookie session:
 * exchange a refresh token for new tokens, and sign a session out.
 */
const config = require('../config');

class AuthUpstreamError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
  }
}

function endpoint(path) {
  if (!config.supabaseUrl || !config.supabasePublishableKey) throw new AuthUpstreamError('Sign-in is not configured on this server', 503);
  return `${config.supabaseUrl.replace(/\/+$/, '')}/auth/v1/${path}`;
}

/** @returns {{ accessToken, refreshToken, expiresAt }} or null when Supabase refuses the refresh token */
async function refreshSession(refreshToken) {
  const res = await fetch(endpoint('token?grant_type=refresh_token'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.supabasePublishableKey },
    body: JSON.stringify({ refresh_token: refreshToken }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new AuthUpstreamError('Sign-in service is unavailable', 502);
  const body = await res.json();
  return { accessToken: body.access_token, refreshToken: body.refresh_token, expiresAt: body.expires_at ? body.expires_at * 1000 : Date.now() + body.expires_in * 1000 };
}

/** Revoke the session behind an access token. Best effort: failure is not the caller's problem. */
async function signOut(accessToken, scope = 'local') {
  try {
    await fetch(endpoint(`logout?scope=${scope === 'global' ? 'global' : 'local'}`), {
      method: 'POST',
      headers: { apikey: config.supabasePublishableKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // the cookie is cleared regardless
  }
}

module.exports = { refreshSession, signOut, AuthUpstreamError };
