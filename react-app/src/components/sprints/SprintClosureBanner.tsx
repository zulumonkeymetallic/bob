import React, { useState, useEffect } from 'react';
import { Clock, Calendar, BarChart3 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { useNavigate } from 'react-router-dom';

const DAY_MS = 24 * 60 * 60 * 1000;

interface Sprint {
  id: string;
  name: string;
  title?: string;
  startDate?: number | null;
  endDate?: number | null;
  status: number;
  ownerUid: string;
  persona: string;
}

function toMillis(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (value > 0 && value < 1e11) return value * 1000; // seconds -> ms
    return value;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.toDate === 'function') return value.toDate().getTime();
    if (typeof value.seconds === 'number') {
      const nanos = Number(value.nanoseconds ?? value.nanos ?? 0);
      return value.seconds * 1000 + Math.round(nanos / 1e6);
    }
  }
  return null;
}

const SprintClosureBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const [overdueSprints, setOverdueSprints] = useState<Sprint[]>([]);
  const [dismissedSprints, setDismissedSprints] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', '==', 1) // Only active sprints
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const now = Date.now();
      const overdueSprintsList: Sprint[] = [];
      
      snapshot.docs.forEach(doc => {
        const sprintData = doc.data();
        const startMs = toMillis(sprintData.startDate);
        const endMs = toMillis(sprintData.endDate);
        const sprint: Sprint = {
          id: doc.id,
          name: sprintData.name || sprintData.title || `Sprint ${doc.id.slice(-6).toUpperCase()}`,
          title: sprintData.title,
          startDate: startMs,
          endDate: endMs,
          status: sprintData.status,
          ownerUid: sprintData.ownerUid,
          persona: sprintData.persona
        };
        
        // Check if sprint is past its end date
        if (endMs && endMs < now) {
          overdueSprintsList.push(sprint);
        }
      });
      
      setOverdueSprints(overdueSprintsList);
    });

    return () => unsubscribe();
  }, [currentUser, currentPersona]);

  // Load dismissed sprints from localStorage
  useEffect(() => {
    const dismissed = new Set<string>();
    overdueSprints.forEach(sprint => {
      const wasDismissed = localStorage.getItem(`sprint-banner-dismissed-${sprint.id}`);
      if (wasDismissed) {
        dismissed.add(sprint.id);
      }
    });
    setDismissedSprints(dismissed);
  }, [overdueSprints]);

  const handleCloseSprint = () => {
    navigate('/sprints/management');
  };

  const handlePlanningMatrix = () => {
    navigate('/planner?level=sprint');
  };

  const handleDismiss = (sprintId: string) => {
    const newDismissed = new Set(dismissedSprints);
    newDismissed.add(sprintId);
    setDismissedSprints(newDismissed);
    localStorage.setItem(`sprint-banner-dismissed-${sprintId}`, 'true');
  };

  const formatDaysOverdue = (endDateMs?: number | null): string => {
    if (!endDateMs) return 'overdue';
    const now = Date.now();
    const daysOverdue = Math.max(1, Math.ceil((now - endDateMs) / DAY_MS));
    return daysOverdue === 1 ? '1 day overdue' : `${daysOverdue} days overdue`;
  };

  // Filter out dismissed sprints
  const visibleSprints = overdueSprints.filter(sprint => !dismissedSprints.has(sprint.id));

  if (visibleSprints.length === 0) {
    return null;
  }

  // Matches the plain-row style the rest of the notification dropdown already uses
  // (DeferralCandidatesBanner, CheckInBanner, CoachVerdictBanner's compact mode) instead of
  // a full-width react-bootstrap Alert with its own colour/icon/button chrome — this was the
  // one banner in the panel that never got migrated. Per Jim, 2026-07-25.
  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)', marginBottom: 6 }}>
        Sprint overdue
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleSprints.map(sprint => (
          <div
            key={sprint.id}
            style={{
              background: 'var(--notion-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
              padding: '5px 6px 5px 8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={13} style={{ flexShrink: 0, color: 'var(--text-danger, #dc2626)' }} />
              <span
                style={{ fontSize: 12, fontWeight: 600, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={sprint.name}
              >
                {sprint.name}
              </span>
              <span
                role="button"
                tabIndex={0}
                style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline', flexShrink: 0 }}
                onClick={() => handleDismiss(sprint.id)}
              >
                Dismiss
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
              <span style={{ fontSize: 10, color: 'var(--muted)', flex: 1 }}>
                {formatDaysOverdue(sprint.endDate)} — time to close and retrospective
              </span>
              <button
                onClick={handlePlanningMatrix}
                title="Planning Matrix"
                aria-label="Planning Matrix"
                style={quickActionButtonStyle('var(--brand, #5f77dc)')}
              >
                <BarChart3 size={14} />
              </button>
              <button
                onClick={handleCloseSprint}
                title="Close Sprint"
                aria-label="Close Sprint"
                style={quickActionButtonStyle('var(--text-success, #15803d)')}
              >
                <Calendar size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

function quickActionButtonStyle(color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 22, height: 22, flexShrink: 0, padding: 0,
    background: 'transparent', border: 'none', borderRadius: 6,
    color, cursor: 'pointer',
  };
}

export default SprintClosureBanner;
