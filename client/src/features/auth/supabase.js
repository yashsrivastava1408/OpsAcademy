// A deployed build is given the project's URL and publishable key. A development build without them uses the local
// stand-in (`npm run auth` in server/ starts it), so nothing real is touched by accident.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || (import.meta.env.DEV ? 'http://127.0.0.1:54321' : undefined);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || (import.meta.env.DEV ? 'local-development-key' : undefined);
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set: sign-in goes through Supabase Auth');
}

// Tokens never reach browser storage (ADR 0003): the session is held in this map, and the
// gateway keeps the refresh token in an HttpOnly cookie. Only the PKCE code verifier, which
// is useless without the emailed code and must survive the redirect to the mail link, goes
// to sessionStorage.
const memory = new Map();
const isVerifier = (key) => key.includes('code-verifier');
const tabStorage = () => {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const storage = {
  getItem: (key) => (isVerifier(key) ? tabStorage()?.getItem(key) ?? null : memory.get(key) ?? null),
  setItem: (key, value) => {
    if (isVerifier(key)) tabStorage()?.setItem(key, value);
    else memory.set(key, value);
  },
  removeItem: (key) => {
    if (isVerifier(key)) tabStorage()?.removeItem(key);
    else memory.delete(key);
  },
};

let clientPromise = null;
/**
 * The Supabase client, loaded the first time it is needed. Restoring a session after a reload goes through the
 * gateway's cookie and does not need it, so a page that only reads never downloads the library.
 */
export function loadSupabase() {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) => createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage,
        persistSession: true, // into `storage` above, which keeps sessions in memory
        autoRefreshToken: false, // the session manager renews through the gateway
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    }));
  }
  return clientPromise;
}

/** Forget the in-memory Supabase session once its refresh token has been handed to the gateway. */
export function forgetSupabaseSession() {
  for (const key of [...memory.keys()]) memory.delete(key);
}

export const supabaseUrlConfigured = supabaseUrl;
export const supabaseKeyConfigured = supabaseAnonKey;
