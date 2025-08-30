import React from 'react';
import { Container } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();

  if (!currentUser) {
    return <div>Please sign in to view your dashboard.</div>;
  }

  return (
    <Container fluid className="p-4">
      <h2>Dashboard</h2>
      <p>Welcome back, {currentUser.displayName || 'there'}!</p>
      <p>Dashboard functionality is being restored. Please use the Kanban page for now.</p>
    </Container>
  );
};

export default Dashboard;
