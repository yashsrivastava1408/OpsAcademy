import { useEffect, useState, useCallback } from 'react';
import { AuthContext } from './useAuth';
import { getStoredUser, onIdentityChange } from '../../shared/services/api';
import { labEmail } from './labEmail';
import * as supabaseIdentity from './supabaseIdentity';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);
  // The session is restored from the cookie after a reload; until that answers we do not know whether anyone
  // is signed in, so pages can wait instead of flashing the login form.
  const [ready, setReady] = useState(false);

  // A guest identity is created by the first request that needs one (see shared/services/api.js), so someone
  // who only reads the landing page or checks a certificate never has an account made for them.
  useEffect(() => onIdentityChange(setUser), []);

  useEffect(() => {
    supabaseIdentity.bootstrap().finally(() => setReady(true));
  }, []);

  const login = useCallback((email, password) => supabaseIdentity.signIn({ email, password }), []);
  // A Lab ID is an account under a made-up address (see labEmail.js).
  const loginWithLabId = useCallback((id, password) => supabaseIdentity.signIn({ email: labEmail(id), password }), []);
  // A guest is upgraded in place, so their progress comes with them. The result says whether the address must be confirmed first.
  const register = useCallback((name, email, password) => supabaseIdentity.signUp({ name, email, password }), []);
  const logout = useCallback((everywhere = false) => supabaseIdentity.signOut(everywhere), []);

  return (
    <AuthContext.Provider value={{ user, ready, isRegistered: Boolean(user && !user.guest), login, loginWithLabId, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
