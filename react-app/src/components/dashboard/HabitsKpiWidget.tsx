/**
 * HabitsKpiWidget — habit/routine adherence boxes for the Overview dashboard.
 * Mirrors the HABITS & ROUTINES section of MetricsPage (/fitness).
 * 30-day completion adherence per habit, shown as FitnessKpiGrid boxes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { CheckSquare } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import FitnessKpiGrid, { FitnessKpiBox, FitnessKpiRow } from '../fitness/FitnessKpiGrid';

function getLast30Days(): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

const CHORE_TYPES = new Set(['routine', 'habit']);

const HabitsKpiWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();

  const [tasks, setTasks] = useState<any[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) return;
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      limit(500),
    );
    return onSnapshot(q, snap => {
      setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }, () => { setTasks([]); setLoading(false); });
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const since = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', since),
      limit(500),
    );
    return onSnapshot(q, snap => setCalendarBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setCalendarBlocks([]));
  }, [currentUser?.uid]);

  const habitRows: FitnessKpiRow[] = useMemo(() => {
    const days = getLast30Days();
    const habits = tasks.filter(t => CHORE_TYPES.has(String(t.type || '').toLowerCase()));

    return habits.slice(0, 12).map(habit => {
      const completedDays = new Set<string>();

      calendarBlocks
        .filter(b => b.taskId === habit.id || b.linkedTaskId === habit.id)
        .forEach(b => {
          const status = String(b.status || '').toLowerCase();
          if (status === 'done' || status === 'complete' || status === 'completed') {
            const start = b.start ? new Date(b.start).toISOString().slice(0, 10) : null;
            if (start) completedDays.add(start);
          }
        });

      if (Array.isArray(habit.completions)) {
        habit.completions.forEach((c: any) => {
          const d = c?.date || c?.completedAt;
          if (d) completedDays.add(String(d).slice(0, 10));
        });
      }

      const boxes: FitnessKpiBox[] = days.map(d => ({
        key: d,
        pct: completedDays.has(d) ? 100 : null,
        tooltip: `${d}: ${completedDays.has(d) ? '✓ done' : 'not done'}`,
      }));

      const label = (habit.title || habit.name || 'Habit').slice(0, 14) + ((habit.title || '').length > 14 ? '…' : '');

      return {
        label,
        summaryText: `${completedDays.size}/30d`,
        boxes,
      };
    });
  }, [tasks, calendarBlocks]);

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <CheckSquare size={15} />
          Habits & Routines
        </div>
        <span
          className="small text-primary"
          style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
          onClick={() => navigate('/fitness')}
        >
          Full view
        </span>
      </Card.Header>
      <Card.Body className="p-3">
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : habitRows.length === 0 ? (
          <div className="text-muted small">
            No chore, routine, or habit tasks found. Add tasks with type "chore", "routine", or "habit" to see adherence here.
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <FitnessKpiGrid rows={habitRows} />
            </div>
            <div className="text-muted mt-2" style={{ fontSize: '0.7rem' }}>
              Green = done · Orange = partial · Grey = no record — last 30 days
            </div>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default HabitsKpiWidget;
