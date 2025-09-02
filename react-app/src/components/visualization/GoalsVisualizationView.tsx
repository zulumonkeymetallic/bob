import React from 'react';
import GoalVizPage from './GoalVizPage';

// Simple wrapper component that redirects to the actual GoalVizPage
const GoalsVisualizationView: React.FC = () => {
  return <GoalVizPage />;
};

export default GoalsVisualizationView;