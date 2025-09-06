import React from 'react';
import { useTheme } from '../contexts/ModernThemeContext';

const KanbanContainer: React.FC = () => {
  const { theme } = useTheme();
  return (
    <div>
      <h3>Kanban Container</h3>
      <p>Kanban container component coming soon...</p>
    </div>
  );
};

export default KanbanContainer;
export {};
