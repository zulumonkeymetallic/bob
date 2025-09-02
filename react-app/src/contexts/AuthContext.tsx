import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { 
  onAuthStateChanged, 
  User, 
  GoogleAuthProvider, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword as firebaseSignInWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth';
import { auth } from '../firebase';
import { sideDoorAuth } from '../services/SideDoorAuth';

interface AuthContextType {
  currentUser: User | null;
  signInWithGoogle: () => Promise<void>;
  signInWithEmailAndPassword: (email: string, password: string) => Promise<void>;
  signUpWithEmailAndPassword: (email: string, password: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  isTestUser?: boolean;
  signInWithTestUser: (userIdentifier?: string) => Promise<void>;
  signInAnonymously: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isTestUser, setIsTestUser] = useState(false);

  const signInWithEmailAndPassword = async (email: string, password: string) => {
    try {
      console.log('🔐 Signing in with email and password...');
      const result = await firebaseSignInWithEmailAndPassword(auth, email, password);
      console.log('✅ Email/password sign in successful:', result.user.email);
    } catch (error: any) {
      console.error("❌ Error signing in with email/password", error);
      
      // Handle specific errors
      switch (error.code) {
        case 'auth/invalid-email':
          throw new Error('Please enter a valid email address.');
        case 'auth/user-disabled':
          throw new Error('This account has been disabled. Please contact support.');
        case 'auth/user-not-found':
          throw new Error('No account found with this email. Please check your credentials or sign up.');
        case 'auth/wrong-password':
          throw new Error('Incorrect password. Please try again.');
        default:
          throw new Error(`Sign-in failed: ${error.message}`);
      }
    }
  };

  const signUpWithEmailAndPassword = async (email: string, password: string) => {
    try {
      console.log('🔐 Creating new account with email and password...');
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log('✅ Account created successfully:', result.user.email);
    } catch (error: any) {
      console.error("❌ Error creating account", error);
      
      // Handle specific errors
      switch (error.code) {
        case 'auth/email-already-in-use':
          throw new Error('This email address is already in use by another account.');
        case 'auth/invalid-email':
          throw new Error('Please enter a valid email address.');
        case 'auth/weak-password':
          throw new Error('Password is too weak. Must be at least 6 characters.');
        default:
          throw new Error(`Account creation failed: ${error.message}`);
      }
    }
  };

  const resetPassword = async (email: string) => {
    try {
      console.log('🔐 Sending password reset email...');
      await sendPasswordResetEmail(auth, email);
      console.log('✅ Password reset email sent to:', email);
    } catch (error: any) {
      console.error("❌ Error sending password reset email", error);
      
      switch (error.code) {
        case 'auth/invalid-email':
          throw new Error('Please enter a valid email address.');
        case 'auth/user-not-found':
          throw new Error('No account found with this email address.');
        default:
          throw new Error(`Failed to send password reset email: ${error.message}`);
      }
    }
  };

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

  const signInWithTestUser = async (userIdentifier?: string) => {
    try {
      const user = await sideDoorAuth.signInWithTestUser();
      setIsTestUser(true);
    } catch (error) {
      console.error("Error signing in with test user", error);
      throw error;
    }
  };

  const signInAnonymously = async () => {
    try {
      const user = await sideDoorAuth.signInAnonymously();
      setIsTestUser(true);
    } catch (error) {
      console.error("Error signing in anonymously", error);
      throw error;
    }
  };

  const signOut = async () => {
    try {
      // Sign out from Firebase
      await firebaseSignOut(auth);
      
      // Clear any cached Google session data
      console.log('🔐 Successfully signed out from BOB');
      console.log('ℹ️  Note: To change Google accounts, you may need to sign out from Google.com');
      
    } catch (error) {
      console.error("Error signing out", error);
    }
  };

  useEffect(() => {
    console.log('🔐 Setting up enhanced auth state listener...');
    
    // Auto-detect test mode and authenticate if needed
    const initializeAuth = async () => {
      try {
        const testUser = await sideDoorAuth.autoSignIn();
        if (testUser) {
          console.log('🧪 Auto test login successful:', testUser.email);
          setIsTestUser(true);
          // Don't return here - still set up Firebase listener for state changes
        }
      } catch (error) {
        console.warn('🧪 Auto test login failed:', error);
        // Continue with regular Firebase auth
      }
    };

    // Initialize test auth if applicable
    initializeAuth();

    // Set up Firebase auth state listener
    const unsubscribe = onAuthStateChanged(auth, user => {
      console.log('🔐 Auth state changed:', user ? user.email : 'null');
      setCurrentUser(user);
      
      // Update test user status
      if (user) {
        setIsTestUser(user.email?.endsWith('@bob.local') || user.email?.endsWith('@test.local') || user.isAnonymous || false);
      } else {
        setIsTestUser(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const value = {
    currentUser,
    signInWithGoogle,
    signInWithEmailAndPassword,
    signUpWithEmailAndPassword,
    resetPassword,
    signOut,
    isTestUser,
    signInWithTestUser,
    signInAnonymously,
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