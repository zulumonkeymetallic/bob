import React from 'react';
import ReactDOM from 'react-dom/client';

// Simple test component to verify React is working
function TestApp() {
  return (
    <div style={{ padding: '20px', background: '#f0f0f0', minHeight: '100vh' }}>
      <h1 style={{ color: 'red' }}>🔥 REACT IS WORKING!</h1>
      <p>If you can see this, React is loading properly.</p>
      <p>Current time: {new Date().toLocaleString()}</p>
    </div>
  );
}

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(<TestApp />);
