/**
 * Identity when Supabase Auth is in use. Knows how to sign in, sign up, sign out, recover a
 * password, turn a guest into a member and restore the session after a reload. It talks to the
 * gateway with fetch (not the axios instance) so services/api.js can depend on it.
 */
import { normalizeApiBase } from '../lib/apiBase';
import { createSessionManager } from '../lib/sessionManager';
import { supabase, forgetSupabaseSession, supabaseUrlConfigured, supabaseKeyConfigured } from '../lib/supabase';

const apiBase = normalizeApiBase(import.meta.env.VITE_API_URL);

let user = null;
const listeners = new Set();
function setUser(next) {
  user = next;
  listeners.forEach((listener) => listener(user));
}

const sessions = createSessionManager({ apiBase, onSignedOut: () => setUser(null) });

export const getUser = () => user;
export const getAccessToken = () => sessions.getAccessToken();
export const onUserChange = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
/** Replace the stored user record (e.g. after confirming an email address). */
export const replaceUser = setUser;
export const clearLocal = () => setUser(null);
/** Force a new access token (the current one was refused). */
export const renew = () => sessions.refresh();

/** Create the app's record for the signed-in Supabase user (and link or upgrade it); returns the app user. */
async function loadUser(token) {
  const res = await fetch(`${apiBase}/api/auth/session`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  if (!res.ok) throw new Error(`Could not load your account (${res.status})`);
  const body = await res.json();
  setUser(body.user);
  return body.user;
}

/** After any Supabase sign-in: hand the refresh token to the gateway's cookie, then forget it here. */
async function finish(session) {
  try {
    const token = await sessions.adopt(session.refresh_token);
    return await loadUser(token);
  } finally {
    forgetSupabaseSession();
  }
}

function fail(error) {
  if (error) throw Object.assign(new Error(error.message), { response: { data: { error: error.message }, status: error.status } });
}

/** Page load: if the cookie holds a session, restore it. Never creates a guest. @returns the user or null */
export async function bootstrap() {
  const token = await sessions.ensure().catch(() => null);
  if (!token) return null;
  return loadUser(token).catch(() => null);
}

let pendingGuest = null;
/** A token for the current session, starting a guest (anonymous sign-in) if nobody is signed in. */
export function ensureIdentity() {
  if (!pendingGuest) {
    pendingGuest = (async () => {
      const existing = await sessions.ensure().catch(() => null);
      if (existing) {
        if (!user) await loadUser(existing).catch(() => {});
        return existing;
      }
      const { data, error } = await supabase.auth.signInAnonymously();
      fail(error);
      await finish(data.session);
      return sessions.getAccessToken();
    })().finally(() => { pendingGuest = null; });
  }
  return pendingGuest;
}

export const isGuest = () => Boolean(user?.guest);

/**
 * Create an account. A guest is upgraded in place (same user id, so progress is kept): the address is
 * added to their anonymous Supabase user and becomes permanent when they confirm it by email.
 * @returns {{ user?: object, needsConfirmation?: boolean }}
 */
export async function signUp({ name, email, password }) {
  const redirectTo = `${window.location.origin}/auth/callback`;
  if (isGuest() && sessions.getAccessToken()) {
    const res = await fetch(`${supabaseUrlConfigured.replace(/\/+$/, '')}/auth/v1/user?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', apikey: supabaseKeyConfigured, authorization: `Bearer ${sessions.getAccessToken()}` },
      body: JSON.stringify({ email, password, data: { name } }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      fail({ message: body.msg || body.message || 'Could not create the account', status: res.status });
    }
    return { needsConfirmation: true };
  }
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: redirectTo } });
  fail(error);
  if (!data.session) return { needsConfirmation: true };
  return { user: await finish(data.session) };
}

export async function signIn({ email, password }) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  fail(error);
  return finish(data.session);
}

export async function signInWithProvider(provider) {
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: `${window.location.origin}/auth/callback` } });
  fail(error);
}

export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
  fail(error);
}

/** On /reset-password or /auth/callback: the mail link carries a code; turn it into a session. @returns the Supabase session or null */
export async function sessionFromLink() {
  const { data, error } = await supabase.auth.getSession();
  fail(error);
  return data.session;
}

/** Set the new password for the session that the reset link started, then sign in with it. */
export async function completePasswordReset(password) {
  const session = await sessionFromLink();
  if (!session) throw Object.assign(new Error('This link is invalid or has expired. Ask for a new one.'), { response: { data: { error: 'This link is invalid or has expired. Ask for a new one.' } } });
  const { error } = await supabase.auth.updateUser({ password });
  fail(error);
  return finish(session);
}

/** On /auth/callback after confirming an email or an SSO sign-in. */
export async function completeCallback() {
  const session = await sessionFromLink();
  if (!session) return null;
  return finish(session);
}

/** @param {boolean} everywhere  end the session on every device */
export async function signOut(everywhere = false) {
  await sessions.signOut(everywhere ? 'global' : 'local');
  forgetSupabaseSession();
  setUser(null);
}
