import { supabase } from './supabase';

/**
 * 'supabase': sign in through Supabase Auth with the session kept in memory plus an HttpOnly cookie.
 * 'legacy': the gateway's own email + password sign-in (local development and CI, and production
 * until the cutover in docs/adr/0003 is done). Switched with VITE_AUTH_MODE=supabase at build time.
 */
export const authMode = import.meta.env.VITE_AUTH_MODE === 'supabase' && supabase ? 'supabase' : 'legacy';
export const isSupabaseMode = authMode === 'supabase';
