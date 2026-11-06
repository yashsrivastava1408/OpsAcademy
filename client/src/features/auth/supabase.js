import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

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

export const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        storage,
        persistSession: true, // into `storage` above, which keeps sessions in memory
        autoRefreshToken: false, // the session manager renews through the gateway
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  : null;

/** Forget the in-memory Supabase session once its refresh token has been handed to the gateway. */
export function forgetSupabaseSession() {
  for (const key of [...memory.keys()]) memory.delete(key);
}

export const supabaseUrlConfigured = supabaseUrl || null;
export const supabaseKeyConfigured = supabaseAnonKey || null;
