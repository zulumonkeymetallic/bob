/**
 * FitnessStripWidget — single-row compact summary replacing the standalone fitnessKpiBoxes
 * and habitsGrid dashboard widgets. Shows today's readiness, current habit streak, and one
 * headline daily KPI (steps vs 12k target), then links out to /fitness for the full detail
 * already covered by MetricsPage (recoveryMetrics/activityMetrics/fitnessMetrics/sprintVelocity
 * widgets and the dedicated page). Data-fetching mirrors CoachVerdictBanner's coach_daily read
 * (readiness) and HabitsKpiWidget's tasks + calendar_blocks read (streak); steps target mirrors
 * FitnessKpiDashboardWidget's health_metrics read.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from 'react-bootstrap';
import { collection, doc, onSnapshot, query, where, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { HeartPulse, Flame, Footprints, ArrowRight } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import type { CoachDaily } from '../../types/CoachTypes';

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function readNum(src: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = Number(src?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

const CHORE_TYPES = new Set(['routine', 'habit']);
const STEPS_TARGET = 12000;

const READINESS_COLOR: Record<string, string> = {
  green: '#1f9d63',
  amber: '#d39e00',
  red: '#d63344',
};

const FitnessStripWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const uid = currentUser?.uid;

  // Readiness — mirrors CoachVerdictBanner's coach_daily/{uid}_{today} read.
  const [coachData, setCoachData] = useState<CoachDaily | null>(null);
  useEffect(() => {
    if (!uid) { setCoachData(null); return; }
    const docRef = doc(db, 'coach_daily', `${uid}_${todayStr()}`);
    return onSnapshot(docRef, (snap) => {
      setCoachData(snap.exists() ? (snap.data() as CoachDaily) : null);
    }, () => setCoachData(null));
  }, [uid]);

  // Habit streak inputs — mirrors HabitsKpiWidget's tasks + calendar_blocks reads.
  const [habitTasks, setHabitTasks] = useState<any[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  useEffect(() => {
    if (!uid || !currentPersona) { setHabitTasks([]); return; }
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', uid),
      where('persona', '==', currentPersona),
      limit(500),
    );
    return onSnapshot(q, (snap) => setHabitTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setHabitTasks([]));
  }, [uid, currentPersona]);
  useEffect(() => {
    if (!uid) { setCalendarBlocks([]); return; }
    const since = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', uid),
      where('start', '>=', since),
      limit(500),
    );
    return onSnapshot(q, (snap) => setCalendarBlocks(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setCalendarBlocks([]));
  }, [uid]);

  // Headline KPI input — mirrors FitnessKpiDashboardWidget's health_metrics read.
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);
  useEffect(() => {
    if (!uid) { setHealthMetrics([]); return; }
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', uid),
      limit(120),
    );
    return onSnapshot(q, (snap) => setHealthMetrics(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setHealthMetrics([]));
  }, [uid]);

  // Current habit streak: the longest run of consecutive completed days, ending today (or
  // yesterday if today hasn't been logged yet so the streak isn't shown as broken pre-emptively),
  // taken across all chore/routine/habit-type tasks. Same completion sources as HabitsKpiWidget
  // (completed calendar_blocks linked to the task, plus a raw `completions` array on the task).
  const currentStreak = useMemo(() => {
    const habits = habitTasks.filter((t) => CHORE_TYPES.has(String(t.type || '').toLowerCase()));
    if (habits.length === 0) return 0;

    let best = 0;
    habits.forEach((habit) => {
      const completedDays = new Set<string>();
      calendarBlocks
        .filter((b) => b.taskId === habit.id || b.linkedTaskId === habit.id)
        .forEach((b) => {
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

      let streak = 0;
      const cursor = new Date();
      if (!completedDays.has(cursor.toISOString().slice(0, 10))) {
        cursor.setDate(cursor.getDate() - 1);
      }
      while (completedDays.has(cursor.toISOString().slice(0, 10))) {
        streak += 1;
        cursor.setDate(cursor.getDate() - 1);
      }
      if (streak > best) best = streak;
    });
    return best;
  }, [habitTasks, calendarBlocks]);

  // Headline KPI: today's steps vs the 12k/day target — the one number that reads as "did I
  // move today," applies every single day (unlike the sport-specific weekly run/swim/cycle rows),
  // and needs no interpretation. Run/swim/cycle/sleep/protein detail all still live at /fitness.
  const todaySteps = useMemo(() => {
    const todayDoc = healthMetrics.find((m) => m.date === todayStr());
    return readNum(todayDoc, 'healthkitStepsToday', 'steps', 'manualStepsToday');
  }, [healthMetrics]);

  const readinessPct = coachData ? Math.round((coachData.readinessScore ?? 0) * 100) : null;
  const readinessColor = coachData?.readinessLabel ? READINESS_COLOR[coachData.readinessLabel] || 'var(--bs-secondary)' : 'var(--bs-secondary)';
  const readinessText = coachData?.readinessLabel
    ? `${coachData.readinessLabel.charAt(0).toUpperCase()}${coachData.readinessLabel.slice(1)} · ${readinessPct}%`
    : 'No data';

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <HeartPulse size={15} />
          Fitness & Health
        </div>
        <span
          className="small text-primary d-inline-flex align-items-center gap-1"
          style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
          onClick={() => navigate('/fitness')}
        >
          View all <ArrowRight size={12} />
        </span>
      </Card.Header>
      <Card.Body className="p-3">
        <div className="d-flex align-items-center flex-wrap gap-3">
          <div className="d-flex align-items-center gap-2">
            <HeartPulse size={14} style={{ color: readinessColor, flexShrink: 0 }} />
            <div>
              <div className="text-muted text-uppercase" style={{ fontSize: 10, letterSpacing: '0.04em' }}>Readiness</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>{readinessText}</div>
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: 'var(--bs-border-color)' }} />
          <div className="d-flex align-items-center gap-2">
            <Flame size={14} className="text-warning" style={{ flexShrink: 0 }} />
            <div>
              <div className="text-muted text-uppercase" style={{ fontSize: 10, letterSpacing: '0.04em' }}>Habit streak</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>{currentStreak} day{currentStreak === 1 ? '' : 's'}</div>
            </div>
          </div>
          <div style={{ width: 1, height: 28, background: 'var(--bs-border-color)' }} />
          <div className="d-flex align-items-center gap-2">
            <Footprints size={14} className="text-success" style={{ flexShrink: 0 }} />
            <div>
              <div className="text-muted text-uppercase" style={{ fontSize: 10, letterSpacing: '0.04em' }}>Steps today</div>
              <div className="fw-semibold" style={{ fontSize: 13 }}>
                {todaySteps != null ? `${Math.round(todaySteps).toLocaleString()} / ${(STEPS_TARGET / 1000).toFixed(0)}k` : 'No data'}
              </div>
            </div>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};

export default FitnessStripWidget;
