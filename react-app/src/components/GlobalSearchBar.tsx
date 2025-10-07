import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const GlobalSearchBar: React.FC = () => {
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Optional: focus on search when coming from a keyboard shortcut in the future
    if ((location.state as any)?.focusSearch) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [location.state]);

  const go = () => {
    const term = q.trim();
    if (!term) return;
    navigate('/tasks', { state: { search: term } });
  };

  return (
    <div style={{ minWidth: 260 }}>
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') go(); }}
        placeholder="Search tasks, stories, goals…"
        aria-label="Global search"
        style={{
          width: '100%',
          padding: '6px 10px',
          borderRadius: 6,
          border: '1px solid var(--notion-border)',
          background: 'var(--notion-bg)',
          color: 'var(--notion-text)',
          fontSize: 14
        }}
      />
    </div>
  );
};

export default GlobalSearchBar;

