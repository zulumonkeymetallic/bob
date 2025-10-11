import React, { useMemo, useState } from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useSprint } from '../../contexts/SprintContext';

// Minimal read-only scaffold for Matrix v2
const PlanningMatrixV2: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId } = useSprint();
  const [view, setView] = useState<'matrix'|'kanban'>('matrix');

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 mb-0">Planning Matrix v2</h1>
        <div className="d-flex align-items-center gap-2">
          <Badge bg="secondary">Sprint: {selectedSprintId || 'none'}</Badge>
          <Badge bg="secondary">User: {currentUser?.email?.split('@')[0] || 'anon'}</Badge>
          <Button size="sm" variant="outline-primary" onClick={() => setView(v => v==='matrix'?'kanban':'matrix')}>
            Switch to {view === 'matrix' ? 'Kanban' : 'Matrix'}
          </Button>
        </div>
      </div>

      <Card>
        <Card.Body>
          <div className="text-muted" style={{ fontSize: 14 }}>
            Read‑only scaffold. Next steps:
            <ul>
              <li>Show daily columns with points capacity vs planned</li>
              <li>Roll up goal/theme points; list carryover items</li>
              <li>Hook approvals and calendar sync</li>
            </ul>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default PlanningMatrixV2;

