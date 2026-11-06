/**
 * The signed-in session when Supabase Auth is in use (ADR 0003).
 *
 * The access token lives only in this object's memory; the long-lived refresh token lives in an
 * HttpOnly cookie the gateway sets, so a script on the page can never read it. After a reload the
 * cookie is exchanged for a fresh access token, and the access token is renewed shortly before
 * it expires. Nothing here touches localStorage.
 */

const RENEW_BEFORE_MS = 60 * 1000;
const USABLE_FOR_MS = 15 * 1000;

export function createSessionManager({
  apiBase = '',
  fetchImpl = (...args) => fetch(...args),
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onSignedOut = () => {},
} = {}) {
  let accessToken = null;
  let expiresAt = 0;
  let timer = null;
  let inflight = null;

  const headers = { 'content-type': 'application/json', 'x-requested-with': 'opsacademy' };

  function set(token, at) {
    accessToken = token;
    expiresAt = at;
    if (timer) clearTimer(timer);
    timer = setTimer(() => { refresh().catch(() => {}); }, Math.max(at - now() - RENEW_BEFORE_MS, 1000));
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  function clear() {
    accessToken = null;
    expiresAt = 0;
    if (timer) clearTimer(timer);
    timer = null;
  }

  async function exchange(path, body) {
    const res = await fetchImpl(`${apiBase}/api/auth/${path}`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify(body || {}),
    });
    if (res.status === 401) return null;
    if (!res.ok) throw new Error(`Sign-in service answered ${res.status}`);
    const data = await res.json();
    set(data.accessToken, data.expiresAt);
    return accessToken;
  }

  /** Trade the cookie for a fresh access token. Concurrent callers share one request. @returns the token, or null when signed out */
  function refresh() {
    if (!inflight) {
      inflight = exchange('refresh')
        .then((token) => { if (!token) { clear(); onSignedOut(); } return token; })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  return {
    getAccessToken: () => accessToken,
    /** Right after a Supabase sign-in: give the refresh token to the gateway, which keeps it in the cookie. */
    async adopt(refreshToken) {
      const token = await exchange('cookie', { refreshToken });
      if (!token) throw new Error('That session is no longer valid');
      return token;
    },
    /** A token good for at least a few more seconds, renewing it if needed; null when signed out. */
    async ensure() {
      if (accessToken && expiresAt - now() > USABLE_FOR_MS) return accessToken;
      return refresh();
    },
    refresh,
    /** @param {'local'|'global'} scope  'global' ends the session on every device */
    async signOut(scope = 'local') {
      const token = accessToken;
      clear();
      try {
        await fetchImpl(`${apiBase}/api/auth/logout`, {
          method: 'POST',
          headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
          credentials: 'include',
          body: JSON.stringify({ scope }),
        });
      } catch {
        // the token is gone from memory either way; the cookie expires on its own
      }
    },
  };
}
