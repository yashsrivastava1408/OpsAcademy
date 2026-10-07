import { createContext, useContext } from 'react';

export const AuthContext = createContext(null);

/** The signed-in user (guest or registered) and the login/register/logout actions. */
export default function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
