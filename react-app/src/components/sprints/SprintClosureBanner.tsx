import React, { useState, useEffect } from 'react';
import { Alert, Button } from 'react-bootstrap';
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
    navigate('/sprints/planning');
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

  return (
    <div className="sprint-closure-banners">
      {visibleSprints.map(sprint => (
        <Alert 
          key={sprint.id}
          variant="warning" 
          dismissible 
          onClose={() => handleDismiss(sprint.id)}
          className="mb-3 border-0 shadow-sm"
          style={{ 
            backgroundColor: '#fff8e1',
            borderLeft: '4px solid #ff9800',
            borderRadius: '8px'
          }}
        >
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center">
              <Clock 
                size={24} 
                className="me-3" 
                style={{ color: '#ff9800' }} 
              />
              <div>
                <div className="fw-bold text-dark">
                  ⏰ Sprint Overdue: "{sprint.name}"
                </div>
                <div className="text-muted small">
                  This sprint ended {formatDaysOverdue(sprint.endDate)} - time to close and retrospective
                </div>
              </div>
            </div>
            
            <div className="d-flex gap-2">
              <Button
                variant="outline-primary"
                size="sm"
                onClick={handlePlanningMatrix}
                className="d-flex align-items-center gap-1"
              >
                <BarChart3 size={16} />
                Planning Matrix
              </Button>
              
              <Button
                variant="primary"
                size="sm"
                onClick={handleCloseSprint}
                className="d-flex align-items-center gap-1"
              >
                <Calendar size={16} />
                Close Sprint
              </Button>
            </div>
          </div>
        </Alert>
      ))}
    </div>
  );
};

export default SprintClosureBanner;
