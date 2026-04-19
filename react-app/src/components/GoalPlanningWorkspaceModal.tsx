import React, { useMemo, useState } from 'react';
import { Button, ButtonGroup, Modal } from 'react-bootstrap';
import type { Goal } from '../types';
import { getGoalDisplayPath } from '../utils/goalHierarchy';

type WorkspaceView = 'roadmap' | 'planner' | 'matrix';

interface Props {
  show: boolean;
  goal: Goal | null;
  allGoals: Goal[];
  onHide: () => void;
}

const GoalPlanningWorkspaceModal: React.FC<Props> = ({
  show,
  goal,
  allGoals,
  onHide,
}) => {
  const [view, setView] = useState<WorkspaceView>('roadmap');

  React.useEffect(() => {
    if (show) {
      setView('roadmap');
    }
  }, [goal?.id, show]);

  const goalTypeLabel = useMemo(() => {
    if (!goal) return 'Goal';
    if ((goal as any)?.goalKind === 'umbrella') return 'Program goal';
    if ((goal as any)?.goalKind === 'execution') return 'Leaf goal';
    return 'Goal';
  }, [goal]);

  const displayPath = useMemo(() => {
    if (!goal?.id) return '';
    return getGoalDisplayPath(goal.id, allGoals);
  }, [allGoals, goal?.id]);

  const iframeSrc = useMemo(() => {
    if (!goal?.id) return 'about:blank';
    const params = new URLSearchParams({
      embed: '1',
      goalId: goal.id,
    });
    if (goal.theme != null) {
      params.set('themeId', String(goal.theme));
    }
    if (view === 'matrix') {
      params.set('groupBy', 'goal');
    }
    const path = view === 'roadmap'
      ? '/goals/roadmap-v6'
      : view === 'planner'
        ? '/goals/year-planner'
        : '/sprints/planning';
    return `${path}?${params.toString()}`;
  }, [goal?.id, goal?.theme, view]);

  return (
    <Modal show={show} onHide={onHide} centered size="xl" dialogClassName="modal-90w">
      <Modal.Header closeButton>
        <div>
          <Modal.Title style={{ fontSize: 18 }}>{goal?.title || 'Goal planning workspace'}</Modal.Title>
          <div className="text-muted small">
            {goalTypeLabel}{displayPath ? ` · ${displayPath}` : ''}
          </div>
        </div>
      </Modal.Header>
      <Modal.Body style={{ padding: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid rgba(0,0,0,0.08)',
            background: 'rgba(59, 130, 246, 0.04)',
          }}
        >
          <div className="text-muted small">
            Switch between the roadmap, year planner, and sprint matrix without losing the current goal context.
          </div>
          <ButtonGroup size="sm">
            <Button variant={view === 'roadmap' ? 'primary' : 'outline-primary'} onClick={() => setView('roadmap')}>
              Roadmap
            </Button>
            <Button variant={view === 'planner' ? 'primary' : 'outline-primary'} onClick={() => setView('planner')}>
              Planner
            </Button>
            <Button variant={view === 'matrix' ? 'primary' : 'outline-primary'} onClick={() => setView('matrix')}>
              Sprint Matrix
            </Button>
          </ButtonGroup>
        </div>
        <iframe
          title={`${goal?.title || 'Goal'} ${view}`}
          src={iframeSrc}
          style={{
            width: '100%',
            height: '72vh',
            border: 'none',
            background: '#fff',
          }}
        />
      </Modal.Body>
    </Modal>
  );
};

export default GoalPlanningWorkspaceModal;
