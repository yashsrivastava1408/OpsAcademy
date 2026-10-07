import { useEffect, useState, useCallback } from 'react';
import { AuthContext } from '../hooks/useAuth';
import { authApi, clearIdentity, ensureIdentity, getStoredUser, onIdentityChange, setIdentity } from '../services/api';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);

  useEffect(() => {
    const unsubscribe = onIdentityChange(setUser);
    // Make sure there is an identity before any page needs one.
    ensureIdentity().catch(() => { /* API offline: pages show their own fallbacks */ });
    return unsubscribe;
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authApi.login(email, password);
    setIdentity(res.data.token, res.data.user);
    return res.data.user;
  }, []);

  // Sent with the guest token, so the guest's progress moves to the new account.
  const register = useCallback(async (name, email, password) => {
    const res = await authApi.register(name, email, password);
    setIdentity(res.data.token, res.data.user);
    return res.data.user;
  }, []);

  const logout = useCallback(() => {
    clearIdentity();
    ensureIdentity().catch(() => {});
  }, []);

  return (
    <AuthContext.Provider value={{ user, isRegistered: Boolean(user && !user.guest), login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
