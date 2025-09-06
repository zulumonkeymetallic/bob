import React from 'react';
import { useTheme } from '../contexts/ModernThemeContext';

interface TestAuthPanelProps {
  onClose?: () => void;
}

export const TestAuthPanel: React.FC<TestAuthPanelProps> = ({ onClose }) => {
  const { theme } = useTheme();
  return (
    <div>
      <p>Test Auth Panel (Disabled in Production)</p>
      {onClose && (
        <button onClick={onClose}>Close</button>
      )}
    </div>
  );
};

export default TestAuthPanel;
