import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase';
import { sideDoorAuth } from '../services/SideDoorAuth';

interface AuthContextType {
  currentUser: User | null;
  signInWithGoogle: () => Promise<void>;
  signInLocally: (tokenOrEmail?: string) => Promise<void>;
  signOut: () => Promise<void>;
  localLoginEnabled: boolean;
  isTestUser?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isTestUser, setIsTestUser] = useState(false);
  const localLoginEnabled = sideDoorAuth.isLocalEnvironment();

  const signInLocally = useCallback(async (tokenOrEmail?: string) => {
    const localUser = await sideDoorAuth.signInWithTestUser(tokenOrEmail);
    setCurrentUser(localUser as User);
    setIsTestUser(true);
  }, []);

  const signInWithGoogle = async () => {
    if (sideDoorAuth.isTestModeEnabled()) {
      sideDoorAuth.disableTestMode();
      setIsTestUser(false);
    }
    const provider = new GoogleAuthProvider();

    // Force account selection on every login
    provider.setCustomParameters({
      prompt: 'select_account'
    });

    try {
      console.log('Starting Google sign in with account selection...');
      const result = await signInWithPopup(auth, provider);
      console.log('Sign in successful:', result.user.email);
    } catch (error) {
      console.error("Error signing in with Google", error);
      throw error;
    }
  };

  const signOut = useCallback(async () => {
    try {
      if (sideDoorAuth.isCurrentUserTestUser(currentUser as any) || sideDoorAuth.isTestModeEnabled()) {
        sideDoorAuth.disableTestMode();
        setIsTestUser(false);
        setCurrentUser(null);
      }

      // Sign out from Firebase
      await firebaseSignOut(auth);

      // Clear any cached Google session data
      // Note: Google OAuth will still remember the account unless user manually signs out from Google
      console.log('🔐 Successfully signed out from BOB');
      console.log('ℹ️  Note: To change Google accounts, you may need to sign out from Google.com');

    } catch (error) {
      console.error("Error signing out", error);
    }
  }, [currentUser]);

  // Auto-logout disabled — too disruptive for trusted single-user app
  // Set AUTO_LOGOUT_ENABLED = true to re-enable
  const AUTO_LOGOUT_ENABLED = false;
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_LOGOUT_MS = 30 * 60 * 1000; // 30 minutes

  const scheduleAutoLogout = useCallback(() => {
    if (!AUTO_LOGOUT_ENABLED) return;
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
    }
    inactivityTimerRef.current = setTimeout(() => {
      console.warn('🔐 Auto logout triggered after 30 minutes of inactivity');
      signOut().catch((err) => console.error('Auto logout failed', err));
    }, AUTO_LOGOUT_MS);
  }, [signOut]);

  useEffect(() => {
    console.log('🔐 Setting up auth state listener...');
    console.log('🔐 Current URL:', window.location.href);

    let unsubscribe: (() => void) | undefined;

    // STEP 1: Local login support for localhost/dev mode
    const localUser = sideDoorAuth.autoSignIn();
    if (localUser) {
      console.log('🧪 Local test authentication active:', localUser.email);
      setCurrentUser(localUser as User);
      setIsTestUser(true);
      return () => {
        console.log('🧪 Local test auth cleanup');
      };
    }

    // STEP 2: Use regular Firebase auth
    console.log('🔐 Initializing Firebase authentication');
    unsubscribe = onAuthStateChanged(auth, user => {
      console.log('🔐 Auth state changed:', user ? user.email : 'null');
      setCurrentUser(user);
      setIsTestUser(false);
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [localLoginEnabled]);

  useEffect(() => {
    if (!AUTO_LOGOUT_ENABLED) return;
    if (!currentUser) {
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
      return;
    }

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'touchstart'];
    const resetTimer = () => scheduleAutoLogout();

    activityEvents.forEach(event => window.addEventListener(event, resetTimer, { passive: true }));
    const visibilityHandler = () => {
      if (document.visibilityState === 'visible') {
        scheduleAutoLogout();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);

    scheduleAutoLogout();

    return () => {
      activityEvents.forEach(event => window.removeEventListener(event, resetTimer));
      document.removeEventListener('visibilitychange', visibilityHandler);
      if (inactivityTimerRef.current) {
        clearTimeout(inactivityTimerRef.current);
        inactivityTimerRef.current = null;
      }
    };
  }, [currentUser, scheduleAutoLogout]);

  const value = {
    currentUser,
    signInWithGoogle,
    signInLocally,
    signOut,
    localLoginEnabled,
    isTestUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
