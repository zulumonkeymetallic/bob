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
    try {
      console.log('Starting Google sign in...');
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
      
      await firebaseSignOut(auth);
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  useEffect(() => {
    console.log('🔐 Setting up auth state listener...');
    console.log('🔐 Current URL:', window.location.href);
    
    let unsubscribe: (() => void) | undefined;
    
    // Give a moment for SideDoorAuth module initialization
    const initTimeout = setTimeout(() => {
      // Check if test mode was initialized from URL parameters
      if (SideDoorAuth.isTestModeActive()) {
        const testUser = SideDoorAuth.mockAuthState();
        if (testUser) {
          console.log('🧪 Using test user:', testUser.email);
          setCurrentUser(testUser as User);
          setIsTestUser(true);
          return;
        }
      }
      
      // If not in test mode, use regular Firebase auth
      unsubscribe = onAuthStateChanged(auth, user => {
        console.log('🔐 Auth state changed:', user ? user.email : 'null');
        setCurrentUser(user);
        setIsTestUser(false);
      });
    }, 50);

    return () => {
      clearTimeout(initTimeout);
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