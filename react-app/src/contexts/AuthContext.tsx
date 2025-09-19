import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut, signInAnonymously, setPersistence, browserLocalPersistence, signInWithRedirect } from 'firebase/auth';
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
    // Prefer local persistence and device language
    try { await setPersistence(auth, browserLocalPersistence); } catch {}
    try { (auth as any).useDeviceLanguage?.(); } catch {}

    // Always prompt account selection
    provider.setCustomParameters({ prompt: 'select_account' });

    // Some environments (iOS/Safari/incognito) block popups — prefer redirect
    const isApple = /iPad|iPhone|iPod|Macintosh/.test(navigator.userAgent);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const preferRedirect = isApple || isSafari;

    const tryRedirect = async () => {
      console.log('🔁 Falling back to Google redirect sign-in...');
      await signInWithRedirect(auth, provider);
    };

    try {
      if (preferRedirect) return await tryRedirect();
      console.log('Starting Google sign in (popup)...');
      const result = await signInWithPopup(auth, provider);
      console.log('Sign in successful:', result.user?.email);
    } catch (error: any) {
      const code = error?.code || '';
      const message = error?.message || '';
      console.warn('Popup sign-in failed:', { code, message });

      // Common cases → fallback to redirect
      const needRedirect = (
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/operation-not-supported-in-this-environment' ||
        code === 'auth/internal-error' ||
        code === 'auth/network-request-failed' ||
        message?.toLowerCase?.().includes('cookie') ||
        message?.toLowerCase?.().includes('third-party')
      );

      if (needRedirect) {
        return await tryRedirect();
      }

      // Helpful guidance for unauthorized domains / App Check
      if (code === 'auth/unauthorized-domain') {
        console.error('Auth domain not authorized. Add current host to Firebase Auth > Authorized domains.');
      }
      if (/app check token is invalid/i.test(message)) {
        console.error('App Check is enforced but not initialized. Ensure App Check site key is configured.');
      }
      throw error;
    }
  };

  const signOut = async () => {
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
  };

  useEffect(() => {
    console.log('🔐 Setting up auth state listener...');
    console.log('🔐 Current URL:', window.location.href);
    try {
      const appCheckFlag = (window as any).RECAPTCHA_V3_SITE_KEY || process.env.REACT_APP_RECAPTCHA_V3_SITE_KEY;
      if (!appCheckFlag) {
        console.warn('ℹ️ App Check site key not detected in env/window — if enforcement is ON, login will fail');
      }
    } catch {}
    
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
