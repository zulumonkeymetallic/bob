import React, { useState } from 'react';

interface FloatingAssistantButtonProps {
  onClick: () => void;
  isOpen?: boolean;
}

const FloatingAssistantButton: React.FC<FloatingAssistantButtonProps> = ({ onClick, isOpen = false }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={isOpen ? 'Close Assistant' : 'BOB Assistant (Vertex AI)'}
      aria-label="BOB Assistant"
      style={{
        position: 'fixed',
        right: 24,
        bottom: 88,
        zIndex: 1041,
        width: 48,
        height: 48,
        borderRadius: '50%',
        border: 'none',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        background: isOpen
          ? 'var(--bs-secondary)'
          : hovered
          ? 'var(--bs-primary)'
          : 'var(--bs-primary)',
        color: '#fff',
        boxShadow: hovered
          ? '0 6px 20px rgba(0,0,0,0.3)'
          : '0 3px 10px rgba(0,0,0,0.2)',
        transform: isOpen ? 'rotate(45deg)' : hovered ? 'scale(1.08)' : 'scale(1)',
        transition: 'transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease',
      }}
    >
      {isOpen ? '✕' : '🤖'}
    </button>
  );
};

export default FloatingAssistantButton;
