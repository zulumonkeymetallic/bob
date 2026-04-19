import React from 'react';

interface TestAuthPanelProps {
  onClose?: () => void;
}

export const TestAuthPanel: React.FC<TestAuthPanelProps> = ({ onClose }) => {
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
