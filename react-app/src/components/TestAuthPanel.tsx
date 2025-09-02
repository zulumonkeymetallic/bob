// BOB v3.5.5 - Test Authentication Component
// Provides easy test user login interface

import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { sideDoorAuth } from '../services/SideDoorAuth';

interface TestAuthPanelProps {
  onClose?: () => void;
}

export const TestAuthPanel: React.FC<TestAuthPanelProps> = ({ onClose }) => {
  const { signInWithTestUser, signInAnonymously, signOut, currentUser, isTestUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTestUserLogin = async (userIdentifier?: string) => {
    setLoading(true);
    setError(null);
    try {
      await signInWithTestUser(userIdentifier);
      console.log('✅ Test user login successful');
      if (onClose) onClose();
    } catch (err: any) {
      console.error('❌ Test user login failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAnonymousLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInAnonymously();
      console.log('✅ Anonymous login successful');
      if (onClose) onClose();
    } catch (err: any) {
      console.error('❌ Anonymous login failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    setLoading(true);
    try {
      await signOut();
      console.log('✅ Sign out successful');
    } catch (err: any) {
      console.error('❌ Sign out failed:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const testUsers = sideDoorAuth.getAvailableTestUsers();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">
            🧪 Test Authentication
          </h2>
          {onClose && (
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              ✕
            </button>
          )}
        </div>

        {currentUser ? (
          <div className="space-y-4">
            <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="flex items-center space-x-2">
                {currentUser.photoURL && (
                  <img
                    src={currentUser.photoURL}
                    alt="Profile"
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {currentUser.displayName || 'Anonymous User'}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-300">
                    {currentUser.email || 'anonymous@test.local'}
                  </p>
                  {isTestUser && (
                    <span className="inline-block px-2 py-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded-full mt-1">
                      Test User
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={handleSignOut}
              disabled={loading}
              className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Quick Login Options:
              </h3>
              
              <button
                onClick={handleAnonymousLogin}
                disabled={loading}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-left"
              >
                🔒 Anonymous User (Quick Test)
              </button>

              {testUsers.map((user, index) => (
                <button
                  key={user.email}
                  onClick={() => handleTestUserLogin(index.toString())}
                  disabled={loading}
                  className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-left flex items-center space-x-2"
                >
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt={user.displayName}
                      className="w-6 h-6 rounded-full"
                    />
                  )}
                  <div>
                    <div className="font-medium">{user.displayName}</div>
                    <div className="text-xs opacity-75">{user.email}</div>
                  </div>
                </button>
              ))}
            </div>

            {error && (
              <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
                <p className="text-sm text-red-800 dark:text-red-200">
                  ❌ {error}
                </p>
              </div>
            )}

            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p>💡 <strong>URL Parameters:</strong></p>
              <p>• <code>?test-login=true</code> - Default test user</p>
              <p>• <code>?test-login=anonymous</code> - Anonymous user</p>
              <p>• <code>?test-login=demo</code> - Demo user</p>
              <p>• <code>?test-login=ai-agent</code> - AI Agent</p>
            </div>
          </div>
        )}

        {loading && (
          <div className="mt-4 text-center">
            <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
              Authenticating...
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TestAuthPanel;
