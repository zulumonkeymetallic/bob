import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, signInAnonymously } from 'firebase/auth';
import { auth } from '../firebase';
// import { SideDoorAuth } from '../services/SideDoorAuth';

interface AuthContextType {
  currentUser: User | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  isTestUser?: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isTestUser, setIsTestUser] = useState(false);

  const signInWithGoogle = async () => {
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
      // Clear test mode if active
      // if (SideDoorAuth.isTestModeActive()) {
      //   SideDoorAuth.disableTestMode();
      //   setIsTestUser(false);
      // }

      // Sign out from Firebase
      await firebaseSignOut(auth);

      // Clear any cached Google session data
      // Note: Google OAuth will still remember the account unless user manually signs out from Google
      console.log('🔐 Successfully signed out from BOB');
      console.log('ℹ️  Note: To change Google accounts, you may need to sign out from Google.com');

    } catch (error) {
      console.error("Error signing out", error);
    }
  }, []);

  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const AUTO_LOGOUT_MS = 30 * 60 * 1000; // 30 minutes

  const scheduleAutoLogout = useCallback(() => {
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

    // STEP 1: Check URL parameters immediately for test mode
    const urlParams = new URLSearchParams(window.location.search);
    const testLogin = urlParams.get('test-login');
    const testMode = urlParams.get('test-mode');

    console.log('🧪 URL Parameters:', { testLogin, testMode });

    if (testLogin && testMode === 'true') {
      console.log('🧪 ✅ Test parameters detected - enabling test authentication immediately');

      // Initialize SideDoorAuth with URL parameters
      // SideDoorAuth.initializeFromUrl();

      // Create test user immediately
      const testUser = {
        uid: 'ai-test-user-12345abcdef',
        email: 'ai-test-agent@bob.local',
        displayName: 'AI Test Agent',
        emailVerified: true,
        isTestUser: true,
        metadata: {
          creationTime: new Date().toISOString(),
          lastSignInTime: new Date().toISOString()
        },
        providerData: [{
          uid: 'ai-test-user-12345abcdef',
          email: 'ai-test-agent@bob.local',
          displayName: 'AI Test Agent',
          providerId: 'test'
        }],
        accessToken: 'mock-test-access-token',
        refreshToken: 'mock-test-refresh-token',
        getIdToken: async () => 'mock-test-id-token',
      };

      console.log('🧪 Setting test user immediately:', testUser.email);
      setCurrentUser(testUser as unknown as User);
      setIsTestUser(true);

      // When using emulator for tests, also sign in to Auth emulator anonymously
      if (process.env.REACT_APP_USE_FIREBASE_EMULATOR === 'true') {
        try {
          console.log('🧪 Connecting to Auth emulator with anonymous sign-in...');
          signInAnonymously(auth)
            .then(() => console.log('🧪 Anonymous auth sign-in complete (emulator)'))
            .catch(err => console.warn('⚠️ Anonymous sign-in failed (emulator):', err?.message));
        } catch (err) {
          console.warn('⚠️ Emulator auth init error:', (err as any)?.message);
        }
      }

      // Clean URL after a delay
      setTimeout(() => {
        const cleanUrl = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
        console.log('🧪 URL cleaned, test authentication active');
      }, 2000);

      return () => {
        console.log('🧪 Test auth cleanup');
      };
    }

    // STEP 2: Check if test mode is already active from previous session
    // if (SideDoorAuth.isTestModeActive()) {
    //   const testUser = SideDoorAuth.mockAuthState();
    //   if (testUser) {
    //     console.log('🧪 Using existing test session:', testUser.email);
    //     setCurrentUser(testUser as unknown as User);
    //     setIsTestUser(true);
    //     return () => {
    //       console.log('🧪 Existing test auth cleanup');
    //     };
    //   }
    // }

    // STEP 3: Use regular Firebase auth for production
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
  }, []);

  useEffect(() => {
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
    signOut,
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
