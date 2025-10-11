import React from 'react';
import { Button } from 'react-bootstrap';

interface FloatingAssistantButtonProps {
  onClick: () => void;
}

const FloatingAssistantButton: React.FC<FloatingAssistantButtonProps> = ({ onClick }) => {
  return (
    <button
      className="md-fab"
      onClick={onClick}
      title="Assistant"
      style={{ position: 'fixed', right: 24, bottom: 88, zIndex: 1040 }}
    >
      💬
    </button>
  );
};

export default FloatingAssistantButton;

