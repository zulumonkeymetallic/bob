import React, { useEffect, useMemo } from 'react';
import { Dropdown } from 'react-bootstrap';
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
  const DISABLE_SELECTOR = (() => {
    try {
      const env: any = (typeof process !== 'undefined' ? (process as any).env : {}) || {};
      return env.REACT_APP_SPRINT_SELECTOR_DISABLED === 'true';
    } catch { return false; }
  })();
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

  const now = Date.now();
  const isSprintComplete = (s: Sprint) => {
    const ended = typeof s.endDate === 'number' && s.endDate > 0 ? s.endDate < now : false;
    const statusComplete = s.status === 2;
    return statusComplete || ended;
  };
  const isSprintActive = (s: Sprint) => s.status === 1 && !isSprintComplete(s);
  const isSprintPlanned = (s: Sprint) => s.status === 0 && !isSprintComplete(s);
  const isSprintCancelled = (s: Sprint) => s.status === 3;

  const getSprintStatusLabel = (s: Sprint) => {
    if (s.status === 0) return 'PLANNED';
    if (s.status === 1) return 'ACTIVE';
    if (s.status === 2) return 'COMPLETE';
    if (s.status === 3) return 'CANCELLED';
    return 'UNKNOWN';
  };

  useEffect(() => {
    if (loading) return;
    if (sprints.length === 0) return;
    // Respect explicit user choice including empty string in storage
    const savedPref = (() => { try { return localStorage.getItem('bob_selected_sprint'); } catch { return null; } })();
    const noSavedPreference = savedPref === null || savedPref === undefined;
    // Only auto-select when there is no explicit selection AND no saved preference
    if ((effectiveSelectedId !== undefined && effectiveSelectedId !== null && effectiveSelectedId !== '') || !noSavedPreference) return;

    const activeSprint = sprints.find((sprint) => sprint.status === 1);
    const plannedSprint = sprints.find((sprint) => sprint.status === 0);
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

  if (DISABLE_SELECTOR) {
    return (
      <div className={`d-flex align-items-center ${className}`} title="Sprint selection disabled for test">
        <span className="me-2">🏃‍♂️</span>
        <span>All Sprints</span>
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
            {isSprintActive(selectedSprint) && (
              <span className="badge bg-success ms-2">ACTIVE</span>
            )}
            {isSprintPlanned(selectedSprint) && (
              <span className="badge bg-warning text-dark ms-2">PLANNED</span>
            )}
            {isSprintComplete(selectedSprint) && (
              <span className="badge bg-secondary ms-2">COMPLETE</span>
            )}
            {isSprintCancelled(selectedSprint) && (
              <span className="badge bg-danger ms-2">CANCELLED</span>
            )}
          </span>
        ) : (
          <span>All Sprints</span>
        )}
      </Dropdown.Toggle>

      <Dropdown.Menu align="end" style={{ minWidth: '300px', zIndex: 2000 }}>
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
          sprints
            .filter((sprint) => {
              // Hide completed sprints unless currently selected
              if (isSprintComplete(sprint) && sprint.id !== effectiveSelectedId) return false;
              return true;
            })
            .map(sprint => (
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
                      isSprintActive(sprint) ? 'bg-success' :
                      isSprintPlanned(sprint) ? 'bg-warning' :
                      isSprintCancelled(sprint) ? 'bg-danger' :
                      isSprintComplete(sprint) ? 'bg-secondary' : 'bg-secondary'
                    }`}>
                      {isSprintActive(sprint) ? 'ACTIVE' :
                        isSprintPlanned(sprint) ? 'PLANNED' :
                        isSprintCancelled(sprint) ? 'CANCELLED' :
                        isSprintComplete(sprint) ? 'COMPLETE' : getSprintStatusLabel(sprint)}
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
