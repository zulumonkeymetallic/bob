import React, { useState, useEffect } from 'react';
import { Dropdown } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Sprint } from '../types';

interface SprintSelectorProps {
  selectedSprintId?: string;
  onSprintChange: (sprintId: string) => void;
  className?: string;
}

const SprintSelector: React.FC<SprintSelectorProps> = ({
  selectedSprintId,
  onSprintChange,
  className = ''
}) => {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const { currentUser } = useAuth();

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sprintData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Sprint[];
      
      setSprints(sprintData);
      setLoading(false);

      // Auto-select active sprint if none selected
      if (!selectedSprintId && sprintData.length > 0) {
        const activeSprint = sprintData.find(sprint => sprint.status === 'active');
        if (activeSprint) {
          onSprintChange(activeSprint.id);
        }
      }
    });

    return () => unsubscribe();
  }, [currentUser, selectedSprintId, onSprintChange]);

  const selectedSprint = sprints.find(sprint => sprint.id === selectedSprintId);

  if (loading) {
    return (
      <div className={`d-flex align-items-center ${className}`}>
        <div className="spinner-border spinner-border-sm me-2" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <span>Loading sprints...</span>
      </div>
    );
  }

  return (
    <Dropdown className={className}>
      <Dropdown.Toggle 
        variant="outline-primary" 
        id="sprint-selector"
        className="d-flex align-items-center"
      >
        <span className="me-2">🏃‍♂️</span>
        {selectedSprint ? (
          <span>
            <strong>{selectedSprint.name}</strong>
            <small className="ms-2 text-muted">
              ({selectedSprint.status})
            </small>
          </span>
        ) : (
          <span>Select Sprint</span>
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu align="end" style={{ minWidth: '300px' }}>
        <Dropdown.Header>Available Sprints</Dropdown.Header>
        {sprints.length === 0 ? (
          <Dropdown.Item disabled>
            No sprints found. Create one in Sprint Dashboard.
          </Dropdown.Item>
        ) : (
          sprints.map(sprint => (
            <Dropdown.Item
              key={sprint.id}
              active={sprint.id === selectedSprintId}
              onClick={() => onSprintChange(sprint.id)}
            >
              <div>
                <strong>{sprint.name}</strong>
                <div className="d-flex justify-content-between align-items-center mt-1">
                  <small className="text-muted">
                    {new Date(sprint.startDate).toLocaleDateString()} - 
                    {new Date(sprint.endDate).toLocaleDateString()}
                  </small>
                  <span className={`badge ${
                    sprint.status === 'active' ? 'bg-success' : 
                    sprint.status === 'planned' ? 'bg-warning' : 'bg-secondary'
                  }`}>
                    {sprint.status}
                  </span>
                </div>
                {sprint.objective && (
                  <small className="text-muted d-block mt-1">
                    {sprint.objective.substring(0, 60)}...
                  </small>
                )}
              </div>
            </Dropdown.Item>
          ))
        )}
        <Dropdown.Divider />
        <Dropdown.Item onClick={() => window.location.href = '/sprint-dashboard'}>
          <span className="me-2">➕</span>
          Manage Sprints
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default SprintSelector;
