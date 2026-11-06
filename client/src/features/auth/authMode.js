import { supabase } from './supabase';

/**
 * 'supabase': sign in through Supabase Auth, with the session kept in memory plus an HttpOnly cookie. This is
 * what every deployed build uses: the client is configured with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 * 'legacy': the gateway's own email + password sign-in. Only a build with no Supabase settings gets it (local
 * development and the browser tests), and the gateway refuses it in production.
 */
export const authMode = supabase ? 'supabase' : 'legacy';
export const isSupabaseMode = authMode === 'supabase';
