import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { DEV_KEY } from './api';

const AuthContext = createContext(null);

// Dev bypass — when VITE_DEV_KEY is set in a dev build, skip Google auth so the
// redesign can be driven from browser automation. REST calls carry x-dev-key;
// Firestore realtime is off in this mode (see useNotifications' REST fallback).
const DEV_USER = { uid: 'dev', email: 'dev@axiom', dev: true };

export function AuthProvider({ children }) {
  const [user, setUser] = useState(DEV_KEY ? DEV_USER : undefined);

  useEffect(() => {
    if (DEV_KEY) return;
    return onAuthStateChanged(auth, setUser);
  }, []);

  const value = {
    user,
    signIn: () => signInWithPopup(auth, googleProvider),
    signOut: () => (DEV_KEY ? null : signOut(auth)),
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
