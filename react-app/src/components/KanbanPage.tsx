import React from 'react';
import { Container } from 'react-bootstrap';
import { useTheme } from '../contexts/ModernThemeContext';

// Legacy component - replaced by ModernKanbanPage
const KanbanPage: React.FC = () => {
  const { theme } = useTheme();
  return (
    <Container fluid className="mt-4">
      <div className="text-center">
        <h2>Legacy Kanban Page</h2>
        <p>This component has been replaced by ModernKanbanPage.</p>
        <p>Please use the main Kanban route which now uses the modern implementation.</p>
      </div>
    </Container>
  );
};

export default KanbanPage;
