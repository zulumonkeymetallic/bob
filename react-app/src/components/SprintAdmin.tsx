import React from 'react';
import { Container } from 'react-bootstrap';
import { useTheme } from '../contexts/ModernThemeContext';

const SprintAdmin: React.FC = () => {
  const { theme } = useTheme();
  return (
    <Container className="mt-4">
      <h2>Sprint Administration</h2>
      <p>Sprint management features coming soon...</p>
    </Container>
  );
};

export default SprintAdmin;

export {};
