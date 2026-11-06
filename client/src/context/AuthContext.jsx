import { useEffect, useState, useCallback } from 'react';
import { AuthContext } from '../hooks/useAuth';
import { authApi, clearIdentity, getStoredUser, onIdentityChange, setIdentity } from '../services/api';
import { isSupabaseMode } from '../lib/authMode';
import * as supabaseIdentity from '../services/supabaseIdentity';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  // With Supabase the session is restored from the cookie after a reload; until that answers we do
  // not know whether anyone is signed in, so pages can wait instead of flashing the login form.
  const [ready, setReady] = useState(!isSupabaseMode);

  // A guest identity is created by the first request that needs one (see
  // services/api.js), so someone who only reads the landing page or checks a
  // certificate never has an account made for them.
  useEffect(() => onIdentityChange(setUser), []);

  useEffect(() => {
    if (!isSupabaseMode) return;
    supabaseIdentity.bootstrap().finally(() => setReady(true));
  }, []);

  const login = useCallback(async (email, password) => {
    if (isSupabaseMode) return supabaseIdentity.signIn({ email, password });
    const res = await authApi.login(email, password);
    setIdentity(res.data.token, res.data.user);
    return res.data.user;
  }, []);

  // Sent with the guest token, so the guest's progress moves to the new account.
  // With Supabase the address must be confirmed first: the result says so ({ needsConfirmation: true }).
  const register = useCallback(async (name, email, password) => {
    if (isSupabaseMode) return supabaseIdentity.signUp({ name, email, password });
    const res = await authApi.register(name, email, password);
    setIdentity(res.data.token, res.data.user);
    return { user: res.data.user };
  }, []);

  const logout = useCallback((everywhere = false) => {
    if (isSupabaseMode) return supabaseIdentity.signOut(everywhere);
    clearIdentity();
    return Promise.resolve();
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, isRegistered: Boolean(user && !user.guest), login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
