import React from 'react';
import GoalVizPage from './GoalVizPage';
import { useTheme } from '../../contexts/ModernThemeContext';

// Simple wrapper component that redirects to the actual GoalVizPage
const GoalsVisualizationView: React.FC = () => {
  const { theme } = useTheme();
  return <GoalVizPage />;
};

export default GoalsVisualizationView;