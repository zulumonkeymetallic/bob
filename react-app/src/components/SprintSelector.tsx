import React, { useState, useEffect } from 'react';
import { Dropdown } from 'react-bootstrap';
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Sprint } from '../types';
import { isStatus } from '../utils/statusHelpers';
import logger from '../utils/logger';
import { usePersona } from '../contexts/PersonaContext';

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
  const { currentPersona } = usePersona();

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setLoading(false);
      return;
    }

    logger.debug('sprint', 'Setting up sprint listener for user', { uid: currentUser.uid, persona: currentPersona });

    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('startDate', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q,
      (snapshot) => {
        logger.debug('sprint', 'Received sprint data', { count: snapshot.docs.length });
        const sprintsData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Sprint[];
        
        setSprints(sprintsData);
        setLoading(false);

        // Auto-selection logic should only run when the component loads and there's no selection.
        if (sprintsData.length > 0 && !selectedSprintId) {
          const activeSprint = sprintsData.find(sprint => isStatus(sprint.status, 'active'));
          const plannedSprint = sprintsData.find(sprint => isStatus(sprint.status, 'planned'));
          const fallbackSprint = sprintsData[0];
          
          const preferredSprint = activeSprint || plannedSprint || fallbackSprint;

          if (preferredSprint) {
            logger.info('sprint', 'Auto-selecting sprint', { name: preferredSprint.name, status: preferredSprint.status });
            onSprintChange(preferredSprint.id);
          }
        }
      },
      (error) => {
        logger.error('sprint', 'Error loading sprints', error);
        logger.debug('sprint', 'Error details', {
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
  }, [currentUser, currentPersona]);

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
        {selectedSprintId === '' ? (
          <span>All Sprints</span>
        ) : selectedSprint ? (
          <span>
            <strong>{selectedSprint.name}</strong>
            <small className="ms-2 text-muted">
              ({selectedSprint.status})
            </small>
          </span>
        ) : (
          <span>All Sprints</span>
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu align="end" style={{ minWidth: '300px' }}>
        <Dropdown.Header>Available Sprints</Dropdown.Header>
        <Dropdown.Item
          active={selectedSprintId === ''}
          onClick={() => onSprintChange('')}
        >
          All Sprints
        </Dropdown.Item>
        <Dropdown.Divider />
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
        <Dropdown.Item onClick={() => window.location.href = '/sprints/management'}>
          <span className="me-2">➕</span>
          Manage Sprints
        </Dropdown.Item>
      </Dropdown.Menu>
    </Dropdown>
  );
};

export default SprintSelector;
