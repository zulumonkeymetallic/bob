import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { onAuthStateChanged, User, GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../firebase';
import { SideDoorAuth } from '../services/SideDoorAuth';

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

  const signOut = async () => {
    try {
      // Clear test mode if active
      if (SideDoorAuth.isTestModeActive()) {
        SideDoorAuth.disableTestMode();
        setIsTestUser(false);
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
  };

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
      SideDoorAuth.initializeFromUrl();
      
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
    if (SideDoorAuth.isTestModeActive()) {
      const testUser = SideDoorAuth.mockAuthState();
      if (testUser) {
        console.log('🧪 Using existing test session:', testUser.email);
        setCurrentUser(testUser as unknown as User);
        setIsTestUser(true);
        return () => {
          console.log('🧪 Existing test auth cleanup');
        };
      }
    }
    
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