import { useEffect, useState, useCallback } from 'react';
import { AuthContext } from '../hooks/useAuth';
import { authApi, clearIdentity, getStoredUser, onIdentityChange, setIdentity } from '../services/api';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(getStoredUser);

  // A guest identity is created by the first request that needs one (see
  // services/api.js), so someone who only reads the landing page or checks a
  // certificate never has an account made for them.
  useEffect(() => onIdentityChange(setUser), []);

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
  }, []);

  return (
    <AuthContext.Provider value={{ user, isRegistered: Boolean(user && !user.guest), login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
