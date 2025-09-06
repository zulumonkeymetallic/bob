import React from 'react';
import { useTheme } from '../contexts/ModernThemeContext';

const TestFirebase: React.FC = () => {
  const { theme } = useTheme();
  return (
    <div>
      <h3>Firebase Test</h3>
      <p>Firebase connection test component coming soon...</p>
    </div>
  );
};

export default TestFirebase;
export {};
