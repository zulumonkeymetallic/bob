import React, { useState, useEffect } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { Wand2, X } from 'lucide-react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import SprintPlannerWizard from './SprintPlannerWizard';
import type { Sprint } from '../../types';

function toMs(value: any): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
  }
  return null;
}

const PlannedSprintBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [plannedSprints, setPlannedSprints] = useState<Sprint[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [wizardSprint, setWizardSprint] = useState<Sprint | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', '==', 0),
    );
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Sprint));
      // Only show if there is no currently active sprint (status=1)
      // We load active separately via a quick check
      setPlannedSprints(list);
    });
  }, [currentUser, currentPersona]);

  const [hasActive, setHasActive] = useState(false);
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', '==', 1),
    );
    return onSnapshot(q, snap => setHasActive(!snap.empty));
  }, [currentUser, currentPersona]);

  // Sort by startDate ascending and only surface the next (earliest) planned sprint.
  // Showing all planned sprints clutters the UI when there's a long pipeline.
  const visible = plannedSprints
    .filter(s => !dismissed.has(s.id))
    .sort((a, b) => (toMs((a as any).startDate) ?? Infinity) - (toMs((b as any).startDate) ?? Infinity))
    .slice(0, 1);

  if (hasActive || visible.length === 0) return null;

  return (
    <>
      {visible.map(sprint => (
        <Alert
          key={sprint.id}
          variant="info"
          className="mb-3 border-0 shadow-sm"
          style={{ borderLeft: '4px solid var(--bs-info)', borderRadius: 8, background: '#e0f2fe' }}
        >
          <div className="d-flex align-items-center justify-content-between gap-2">
            <div style={{ flex: 1 }}>
              <strong>{sprint.name}</strong>
              <span className="ms-2 text-muted" style={{ fontSize: 13 }}>is planned but not yet active</span>
            </div>
            <Button
              size="sm"
              variant="info"
              onClick={() => setWizardSprint(sprint)}
            >
              <Wand2 size={13} className="me-1" />
              Plan this sprint
            </Button>
            <Button
              size="sm"
              variant="outline-secondary"
              style={{ padding: '2px 6px' }}
              onClick={() => setDismissed(prev => new Set([...prev, sprint.id]))}
            >
              <X size={13} />
            </Button>
          </div>
        </Alert>
      ))}
      {wizardSprint && (
        <SprintPlannerWizard
          show={Boolean(wizardSprint)}
          onHide={() => setWizardSprint(null)}
          existingSprint={wizardSprint}
          currentUserId={currentUser?.uid}
          onComplete={() => setWizardSprint(null)}
        />
      )}
    </>
  );
};

export default PlannedSprintBanner;
