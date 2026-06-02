/**
 * MetricsPage — /metrics
 *
 * Unified mobile-friendly view of all KPI adherence boxes, organised by goal domain.
 * Replaces the need to visit WorkoutsDashboard + HabitsChoresDashboard separately.
 *
 * Sections:
 *   FITNESS     — weekly Run/Swim/Cycle boxes (12 wks) + daily Steps/Sleep/Protein (30 days)
 *   PROFESSIONAL — manual KPI booleans
 *   AI COMPANY  — manual KPI booleans
 *   GAY TRAVEL  — manual KPI booleans
 *   BOB PLATFORM — manual KPI booleans
 *   HABITS      — per-habit adherence boxes (30 days, from calendar_blocks)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import FitnessKpiGrid, { FitnessKpiBox, FitnessKpiRow } from './fitness/FitnessKpiGrid';
import { CoachVerdictBanner } from './coach/CoachVerdictBanner';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getISOWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function getLast12WeekKeys(): string[] {
  const keys: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    keys.push(getISOWeekKey(d));
  }
  return keys;
}
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
function readNum(src: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = Number(src?.[k]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}
function hits(vals: (number | null)[], target: number): number {
  return vals.filter(v => v !== null && v >= target).length;
}

// ─── Section Header ───────────────────────────────────────────────────────────

const SectionHeader: React.FC<{ title: string; subtitle?: string; colour: string }> = ({ title, subtitle, colour }) => (
  <div style={{ borderLeft: `4px solid ${colour}`, paddingLeft: 10, marginBottom: 12, marginTop: 8 }}>
    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--bs-body-color)' }}>{title}</div>
    {subtitle && <div style={{ fontSize: 11, color: 'var(--bs-secondary)' }}>{subtitle}</div>}
  </div>
);

// ─── Habit Row ────────────────────────────────────────────────────────────────

interface HabitAdherenceRow {
  id: string;
  title: string;
  boxes: FitnessKpiBox[];
  hitsCount: number;
}

function buildHabitRows(tasks: any[], calendarBlocks: any[]): HabitAdherenceRow[] {
  const CHORE_TYPES = new Set(['chore', 'routine', 'habit']);
  const days = getLast30Days();
  const habits = tasks.filter(t => CHORE_TYPES.has(String(t.type || '').toLowerCase()));

  return habits.slice(0, 12).map(habit => {
    const completedDays = new Set<string>();

    // Check calendar_blocks completions linked to this task
    calendarBlocks
      .filter(b => b.taskId === habit.id || b.linkedTaskId === habit.id)
      .forEach(b => {
        const status = String(b.status || '').toLowerCase();
        if (status === 'done' || status === 'complete' || status === 'completed') {
          const start = b.start ? new Date(b.start).toISOString().slice(0, 10) : null;
          if (start) completedDays.add(start);
        }
      });

    // Also check if the task itself has completedAt / doneAt dates in a completions array
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

    return {
      id: habit.id,
      title: habit.title || habit.name || 'Habit',
      boxes,
      hitsCount: completedDays.size,
    };
  });
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const MetricsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();

  const [workouts, setWorkouts] = useState<any[]>([]);
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);

  // ─── Data subscriptions ─────────────────────────────────────────────────────

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc'),
      limit(2000)
    );
    return onSnapshot(q, snap => setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setWorkouts([]));
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', currentUser.uid),
      limit(120)
    );
    return onSnapshot(q, snap => setHealthMetrics(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setHealthMetrics([]));
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) return;
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      limit(500)
    );
    return onSnapshot(q, snap => setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setTasks([]));
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const since = Date.now() - 31 * 24 * 60 * 60 * 1000;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', since),
      limit(500)
    );
    return onSnapshot(q, snap => setCalendarBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setCalendarBlocks([]));
  }, [currentUser?.uid]);

  // ─── Weekly sport KPI data ──────────────────────────────────────────────────

  const weeklyKpiData = useMemo(() => {
    const weekKeys = getLast12WeekKeys();
    const byWeek: Record<string, { run_m: number; swim_m: number; cycle_m: number }> = {};
    weekKeys.forEach(k => { byWeek[k] = { run_m: 0, swim_m: 0, cycle_m: 0 }; });

    for (const w of workouts) {
      const startMs = typeof w.startDate === 'number' ? w.startDate : (w.startDate?.toMillis?.() ?? 0);
      if (!startMs) continue;
      const wk = getISOWeekKey(new Date(startMs));
      if (!byWeek[wk]) continue;
      const dist = Number(w.distance_m || 0);
      const sport = String(w.sportType || w.type || '').toLowerCase();
      if (sport.includes('run') || sport.includes('walk')) byWeek[wk].run_m += dist;
      else if (sport.includes('swim')) byWeek[wk].swim_m += dist;
      else if (sport.includes('cycl') || sport.includes('ride') || sport.includes('bike')) byWeek[wk].cycle_m += dist;
    }

    const runKms   = weekKeys.map(k => byWeek[k].run_m   / 1000);
    const swimKms  = weekKeys.map(k => byWeek[k].swim_m  / 1000);
    const cycleKms = weekKeys.map(k => byWeek[k].cycle_m / 1000);

    const hitsInLast12 = (vals: number[], target: number) => vals.filter(v => v >= target).length;

    return {
      run:   weekKeys.map((k, i) => ({ key: k, pct: runKms[i]   > 0 ? Math.round((runKms[i]   / 30) * 100) : null, tooltip: `${k}: ${runKms[i].toFixed(1)} km` })),
      swim:  weekKeys.map((k, i) => ({ key: k, pct: swimKms[i]  > 0 ? Math.round((swimKms[i]  /  4) * 100) : null, tooltip: `${k}: ${swimKms[i].toFixed(1)} km` })),
      cycle: weekKeys.map((k, i) => ({ key: k, pct: cycleKms[i] > 0 ? Math.round((cycleKms[i] / 50) * 100) : null, tooltip: `${k}: ${cycleKms[i].toFixed(1)} km` })),
      runHits:   hitsInLast12(runKms,   30),
      swimHits:  hitsInLast12(swimKms,   4),
      cycleHits: hitsInLast12(cycleKms, 50),
    };
  }, [workouts]);

  // ─── Daily health KPI data ──────────────────────────────────────────────────

  const dailyKpiData = useMemo(() => {
    const days = getLast30Days();
    const byDay: Record<string, any> = {};
    healthMetrics.forEach(m => { if (m.date) byDay[m.date] = m; });

    const stepsVals   = days.map(d => readNum(byDay[d], 'healthkitStepsToday', 'steps', 'manualStepsToday'));
    const sleepVals   = days.map(d => {
      const mins = readNum(byDay[d], 'sleepMinutes', 'healthkitSleepMinutes', 'manualSleepMinutes');
      if (mins !== null) return mins / 60;
      const h = readNum(byDay[d], 'sleepDurationH');
      return h;
    });
    const proteinVals = days.map(d => readNum(byDay[d], 'proteinTodayG', 'healthkitProteinTodayG', 'manualProteinG'));

    return {
      steps:   days.map((d, i) => ({ key: d, pct: stepsVals[i]   !== null ? Math.round((stepsVals[i]!   / 12000) * 100) : null, tooltip: `${d}: ${stepsVals[i] !== null ? Math.round(stepsVals[i]!).toLocaleString() + ' steps' : 'no data'}` })),
      sleep:   days.map((d, i) => ({ key: d, pct: sleepVals[i]   !== null ? Math.round((sleepVals[i]!   /     8) * 100) : null, tooltip: `${d}: ${sleepVals[i] !== null ? sleepVals[i]!.toFixed(1) + 'h' : 'no data'}` })),
      protein: days.map((d, i) => ({ key: d, pct: proteinVals[i] !== null ? Math.round((proteinVals[i]! /   180) * 100) : null, tooltip: `${d}: ${proteinVals[i] !== null ? Math.round(proteinVals[i]!) + 'g' : 'no data'}` })),
      stepsHits:   hits(stepsVals,   12000),
      sleepHits:   hits(sleepVals,       8),
      proteinHits: hits(proteinVals,   180),
    };
  }, [healthMetrics]);

  // ─── Habit rows ─────────────────────────────────────────────────────────────

  const habitRows = useMemo(() => buildHabitRows(tasks, calendarBlocks), [tasks, calendarBlocks]);

  // ─── Fitness KPI grid rows ──────────────────────────────────────────────────

  const weeklyRows: FitnessKpiRow[] = [
    { label: 'Run  30km/wk',  summaryText: `${weeklyKpiData.runHits}/12 weeks hit target`,  boxes: weeklyKpiData.run   },
    { label: 'Swim  4km/wk',  summaryText: `${weeklyKpiData.swimHits}/12 weeks hit target`, boxes: weeklyKpiData.swim  },
    { label: 'Cycle 50km/wk', summaryText: `${weeklyKpiData.cycleHits}/12 weeks hit target`,boxes: weeklyKpiData.cycle },
  ];

  const dailyRows: FitnessKpiRow[] = [
    { label: 'Steps 12k/day',  summaryText: `${dailyKpiData.stepsHits}/30 days hit target`,   boxes: dailyKpiData.steps   },
    { label: 'Sleep  8hr/day', summaryText: `${dailyKpiData.sleepHits}/30 days hit target`,   boxes: dailyKpiData.sleep   },
    { label: 'Protein 180g',   summaryText: `${dailyKpiData.proteinHits}/30 days hit target`, boxes: dailyKpiData.protein },
  ];

  const habitGridRows: FitnessKpiRow[] = habitRows.map(h => ({
    label: h.title.length > 14 ? h.title.slice(0, 14) + '…' : h.title,
    summaryText: `${h.hitsCount}/30 days completed`,
    boxes: h.boxes,
  }));

  return (
    <div style={{ maxWidth: 680, margin: '0 auto', padding: '12px 12px 40px' }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h5 className="mb-0" style={{ fontWeight: 700 }}>Fitness</h5>
        <div className="d-flex gap-2">
          <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/fitness/full')}>
            Activity Log
          </button>
          <button className="btn btn-sm btn-outline-secondary" onClick={() => navigate('/ai-coach')}>
            AI Coach
          </button>
        </div>
      </div>

      {/* AI Coach readiness banner */}
      <CoachVerdictBanner />

      {/* ── FITNESS ──────────────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <SectionHeader title="FITNESS" subtitle="Goal: Ironman Sep 2027 · Body comp 30% → 22% BF" colour="#22c55e" />

          <div className="mb-3">
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bs-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Weekly Targets (12 weeks)
            </div>
            <FitnessKpiGrid rows={weeklyRows} />
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--bs-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Daily Targets (30 days)
            </div>
            <FitnessKpiGrid rows={dailyRows} />
            {dailyKpiData.stepsHits === 0 && dailyKpiData.sleepHits === 0 && dailyKpiData.proteinHits === 0 && (
              <div className="text-muted small mt-2">
                Daily data syncs from Apple Health via the iOS app. Open BOB on iPhone to trigger a sync.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── PROFESSIONAL ──────────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <SectionHeader title="PROFESSIONAL" subtitle="CTA certification · Crossfuze delivery" colour="#3b82f6" />
          <KpiChecklistRow label="CTA exam registered" goalRef="GR-86741" navigate={navigate} />
          <KpiChecklistRow label="CTA exam passed" goalRef="GR-86741" navigate={navigate} />
          <KpiChecklistRow label="Delivery milestones on track (weekly)" goalRef="GR-86741" navigate={navigate} />
        </div>
      </div>

      {/* ── AI COMPANY ────────────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <SectionHeader title="AI COMPANY (JC1)" subtitle="First revenue Q1 2027" colour="#a855f7" />
          <KpiChecklistRow label="Company registered" goalRef="GR-87526" navigate={navigate} />
          <KpiChecklistRow label="BOB shipped" goalRef="GR-87526" navigate={navigate} />
          <KpiChecklistRow label="First client signed" goalRef="GR-87526" navigate={navigate} />
        </div>
      </div>

      {/* ── GAY TRAVEL ────────────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <SectionHeader title="GAY TRAVEL BUSINESS" subtitle="China trip · Side venture" colour="#f59e0b" />
          <KpiChecklistRow label="China trip dates confirmed" goalRef="GR-94912" navigate={navigate} />
          <KpiChecklistRow label="Website live" goalRef="GR-94912" navigate={navigate} />
          <KpiChecklistRow label="Model defined (tours / content / affiliate)" goalRef="GR-94912" navigate={navigate} />
        </div>
      </div>

      {/* ── BOB PLATFORM ──────────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <SectionHeader title="BOB PLATFORM" subtitle="Track 1 → Track 2 gaps" colour="#ef4444" />
          <KpiChecklistRow label="AI Coach live" goalRef="GR-47791" navigate={navigate} />
          <KpiChecklistRow label="Calendar–goal linking live" goalRef="GR-47791" navigate={navigate} />
          <KpiChecklistRow label="KPI dashboard live" goalRef="GR-47791" navigate={navigate} />
        </div>
      </div>

      {/* ── HABITS ────────────────────────────────────────────────────────────── */}
      {habitGridRows.length > 0 && (
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body">
            <SectionHeader title="HABITS & ROUTINES" subtitle="30-day completion adherence" colour="#6b7280" />
            <FitnessKpiGrid rows={habitGridRows} />
            <div className="text-muted small mt-2">
              Green = completed that day · Orange = partially · Grey = no record
            </div>
          </div>
        </div>
      )}

      {habitGridRows.length === 0 && (
        <div className="card border-0 shadow-sm mb-3">
          <div className="card-body">
            <SectionHeader title="HABITS & ROUTINES" subtitle="No chore/routine tasks found" colour="#6b7280" />
            <p className="text-muted small mb-0">
              Add tasks with type "chore", "routine", or "habit" to see them here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Simple boolean KPI checklist row ─────────────────────────────────────────

const KpiChecklistRow: React.FC<{ label: string; goalRef: string; navigate: (p: string) => void }> = ({ label, goalRef, navigate }) => (
  <div
    className="d-flex align-items-center gap-2 py-1"
    style={{ cursor: 'pointer', borderBottom: '1px solid var(--bs-border-color)' }}
    onClick={() => navigate(`/goals`)}
  >
    <div style={{
      width: 16, height: 16, borderRadius: 3, border: '2px solid var(--bs-border-color)',
      flexShrink: 0, background: 'transparent',
    }} />
    <span style={{ fontSize: 13 }}>{label}</span>
    <span className="ms-auto text-muted" style={{ fontSize: 11 }}>{goalRef}</span>
  </div>
);

export default MetricsPage;
