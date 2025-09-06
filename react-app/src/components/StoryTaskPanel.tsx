import React from 'react';
import { useTheme } from '../contexts/ModernThemeContext';

const StoryTaskPanel: React.FC = () => {
  const { theme } = useTheme();
  return (
    <div>
      <h3>Story Task Panel</h3>
      <p>Story task management panel coming soon...</p>
    </div>
  );
};

export default StoryTaskPanel;
export {};
