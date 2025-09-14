import React from 'react';
import ChecklistPanel from './ChecklistPanel';
import { useAuth } from '../contexts/AuthContext';

interface ChecklistItem {
  id: string;
  title: string;
  start?: number;
  end?: number;
  source: 'assignment' | 'task';
}

const MobileChecklistView: React.FC = () => {
  const { currentUser } = useAuth();
  if (!currentUser) return <div className="p-3">Please sign in to view your checklist.</div>;
  return (
    <div className="container py-3" style={{ maxWidth: 720 }}>
      <h4 className="mb-3">Today</h4>
      <ChecklistPanel />
    </div>
  );
};

export default MobileChecklistView;
