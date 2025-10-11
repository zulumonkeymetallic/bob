import React from 'react';

const FloatingAssistantButton: React.FC<{ onClick: () => void } > = ({ onClick }) => {
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

