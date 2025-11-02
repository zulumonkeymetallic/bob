import React, { useEffect, useMemo } from 'react';
import { Dropdown } from 'react-bootstrap';
import { isStatus } from '../utils/statusHelpers';
import logger from '../utils/logger';
import { useSprint } from '../contexts/SprintContext';
import type { Sprint } from '../types';

interface SprintSelectorProps {
  selectedSprintId?: string;
  onSprintChange?: (sprintId: string) => void;
  className?: string;
}

const SprintSelector: React.FC<SprintSelectorProps> = ({
  selectedSprintId,
  onSprintChange,
  className = '',
}) => {
  const {
    sprints,
    loading,
    selectedSprintId: contextSprintId,
    setSelectedSprintId,
  } = useSprint();

  const effectiveSelectedId = selectedSprintId ?? contextSprintId;

  const selectedSprint = useMemo<Sprint | undefined>(() => {
    if (!effectiveSelectedId) return undefined;
    return sprints.find((s) => s.id === effectiveSelectedId);
  }, [sprints, effectiveSelectedId]);

  useEffect(() => {
    if (loading) return;
    if (sprints.length === 0) return;
    // If nothing selected (null/undefined) try to auto-select an active/planned sprint.
    if (effectiveSelectedId !== undefined && effectiveSelectedId !== null) return;

    const activeSprint = sprints.find((sprint) => isStatus(sprint.status, 'active'));
    // For sprints, the pre-active state is "planning" (status 0)
    const plannedSprint = sprints.find((sprint) => isStatus(sprint.status, 'planning'));
    const fallbackSprint = sprints[0];
    const preferred = activeSprint || plannedSprint || fallbackSprint;

    if (preferred) {
      logger.info('sprint', 'Auto-selecting sprint', {
        id: preferred.id,
        name: preferred.name,
        status: preferred.status,
      });
      setSelectedSprintId(preferred.id);
      onSprintChange?.(preferred.id);
    }
  }, [effectiveSelectedId, loading, onSprintChange, setSelectedSprintId, sprints]);

  const handleSprintChange = (id: string) => {
    if (id === effectiveSelectedId) return;
    setSelectedSprintId(id);
    onSprintChange?.(id);
  };

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
        {effectiveSelectedId === '' ? (
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
          active={effectiveSelectedId === ''}
          onClick={() => handleSprintChange('')}
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
              active={sprint.id === effectiveSelectedId}
              onClick={() => handleSprintChange(sprint.id)}
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
                    isStatus(sprint.status, 'planning') ? 'bg-warning' : 'bg-secondary'
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
