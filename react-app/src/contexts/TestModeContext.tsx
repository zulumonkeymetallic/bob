import React, { createContext, useContext, useState, ReactNode } from 'react';

interface TestModeContextType {
  isTestMode: boolean;
  toggleTestMode: () => void;
  testModeLabel: string;
}

const TestModeContext = createContext<TestModeContextType | undefined>(undefined);

interface TestModeProviderProps {
  children: ReactNode;
}

export const TestModeProvider: React.FC<TestModeProviderProps> = ({ children }) => {
  const [isTestMode, setIsTestMode] = useState(() => {
    // Check localStorage for test mode preference
    return localStorage.getItem('bobTestMode') === 'true';
  });

  const toggleTestMode = () => {
    const newTestMode = !isTestMode;
    setIsTestMode(newTestMode);
    localStorage.setItem('bobTestMode', newTestMode.toString());
    
    // Add visual feedback
    if (newTestMode) {
      console.log('🧪 BOB Test Mode ENABLED - Development features active');
    } else {
      console.log('✅ BOB Production Mode - Test features disabled');
    }
  };

  const testModeLabel = isTestMode ? 'TEST MODE' : 'PRODUCTION';

  return (
    <TestModeContext.Provider value={{
      isTestMode,
      toggleTestMode,
      testModeLabel,
    }}>
      {children}
    </TestModeContext.Provider>
  );
};

export const useTestMode = () => {
  const context = useContext(TestModeContext);
  if (context === undefined) {
    throw new Error('useTestMode must be used within a TestModeProvider');
  }
  return context;
};
