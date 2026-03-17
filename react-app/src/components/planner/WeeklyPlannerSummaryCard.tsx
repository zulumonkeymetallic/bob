import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Spinner } from 'react-bootstrap';
import { addDays, format, startOfWeek } from 'date-fns';
import { doc, onSnapshot } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

const WeeklyPlannerSummaryCard: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [planningSummary, setPlanningSummary] = useState<{ acceptedMoves: number; acceptedDefers: number; completedAt?: any } | null>(null);

  const weekStart = useMemo(() => startOfWeek(addDays(new Date(), 7), { weekStartsOn: 1 }), []);
  const weekKey = useMemo(() => format(weekStart, "yyyy-'W'II"), [weekStart]);
  const isPlanningPromptWeek = useMemo(() => {
    const day = new Date().getDay();
    return day === 0 || day === 1;
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setPlanningSummary(null);
      return;
    }
    return onSnapshot(doc(db, 'weekly_checkins', `${currentUser.uid}_${weekKey}`), (snap) => {
      const data = snap.data() as any;
      setPlanningSummary(data?.nextWeekPlanning || null);
    });
  }, [currentUser?.uid, weekKey]);

  const statusLabel = planningSummary?.completedAt
    ? 'Weekly plan reviewed'
    : isPlanningPromptWeek
      ? 'Weekly review due'
      : 'Weekly plan available';

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold">Weekly Planner</div>
        <Badge bg="info">
          {format(weekStart, 'dd MMM')} – {format(addDays(weekStart, 6), 'dd MMM')}
        </Badge>
      </Card.Header>
      <Card.Body>
        {!currentUser?.uid ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner size="sm" animation="border" /> Loading next week…
          </div>
        ) : (
          <>
            <Alert variant={planningSummary?.completedAt ? 'light' : 'warning'} className="py-2 px-3">
              <div className="fw-semibold">{statusLabel}</div>
              <div className="small text-muted mt-1">
                {planningSummary?.completedAt
                  ? `${Number(planningSummary.acceptedMoves || 0)} planned · ${Number(planningSummary.acceptedDefers || 0)} deferred`
                  : 'Review the next 7 days from Overview before the week fills up.'}
              </div>
            </Alert>
            <div className="d-flex flex-wrap gap-2 mb-3">
              <Badge bg="secondary">Week {weekKey.split('W')[1]}</Badge>
              <Badge bg="info">Planned {Number(planningSummary?.acceptedMoves || 0)}</Badge>
              <Badge bg="warning" text="dark">Deferred {Number(planningSummary?.acceptedDefers || 0)}</Badge>
            </div>
            <Button size="sm" variant="outline-primary" onClick={() => navigate('/planner/weekly')}>
              Open 7-day planner
            </Button>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default WeeklyPlannerSummaryCard;
