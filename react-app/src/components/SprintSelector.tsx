import React, { useState, useEffect } from 'react';
import { Dropdown } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Sprint } from '../types';
import { isStatus, isTheme } from '../utils/statusHelpers';

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
    if (!currentUser) {
      setLoading(false);
      return;
    }

    console.log('🔄 SprintSelector: Setting up sprint listener for user:', currentUser.uid);

    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc')
    );

    const unsubscribe = onSnapshot(q, 
      (snapshot) => {
        console.log('✅ SprintSelector: Received sprint data:', snapshot.docs.length, 'sprints');
        const sprintData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Sprint[];
        
        setSprints(sprintData);
        setLoading(false);

        // Always try to select active sprint first, then fall back to most recent
        if (sprintData.length > 0) {
          const activeSprint = sprintData.find(sprint => isStatus(sprint.status, 'active'));
          const plannedSprint = sprintData.find(sprint => isStatus(sprint.status, 'planned'));
          const fallbackSprint = sprintData[0]; // Most recent by start date
          
          const preferredSprint = activeSprint || plannedSprint || fallbackSprint;
          
          // If no sprint is selected or current selection is not found, select preferred
          if (!selectedSprintId || !sprintData.find(s => s.id === selectedSprintId)) {
            if (preferredSprint) {
              console.log('🎯 SprintSelector: Auto-selecting sprint:', preferredSprint.name, preferredSprint.status);
              onSprintChange(preferredSprint.id);
            }
          }
        }
      },
      (error) => {
        console.error('❌ SprintSelector: Error loading sprints:', error);
        console.log('🔍 SprintSelector: Error details:', {
          code: error.code,
          message: error.message,
          userUid: currentUser?.uid,
          timestamp: new Date().toISOString()
        });
        setLoading(false);
        setSprints([]);
      }
    );

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

  if (sprints.length === 0) {
    return (
      <div className={`d-flex align-items-center ${className}`}>
        <span className="me-2">🏃‍♂️</span>
        <span className="text-muted">No sprints available</span>
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
                    isStatus(sprint.status, 'active') ? 'bg-success' : 
                    isStatus(sprint.status, 'planned') ? 'bg-warning' : 'bg-secondary'
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
