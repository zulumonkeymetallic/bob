/**
 * Fitness KPI section for the NotificationStream popover.
 * Condenses FitnessKpiDashboardWidget's rolling-window targets (12wk run/swim/cycle
 * distance, 30d steps/protein hit-streaks) into a compact list shown every few days
 * — same 3-day dismiss pattern as GlobalHealthProgressBanner, so it works on every
 * page rather than only the dashboard's full KPI grid.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

const DISMISS_KEY = 'toolbar-fitness-kpi-banner-dismissed-date';
const DISMISS_DAYS = 3;

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

const GlobalFitnessKpiBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(DISMISS_KEY);
      if (stored) {
        const days = (Date.now() - new Date(stored).getTime()) / 86_400_000;
        if (days < DISMISS_DAYS) { setVisible(false); return; }
      }
    } catch { /* ignore */ }
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) { setWorkouts([]); return; }
    const q = query(collection(db, 'metrics_workouts'), where('ownerUid', '==', currentUser.uid), orderBy('startDate', 'desc'), limit(2000));
    return onSnapshot(q, (snap) => setWorkouts(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setWorkouts([]));
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) { setHealthMetrics([]); return; }
    const q = query(collection(db, 'health_metrics'), where('ownerUid', '==', currentUser.uid), limit(120));
    return onSnapshot(q, (snap) => setHealthMetrics(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setHealthMetrics([]));
  }, [currentUser?.uid]);

  const data = useMemo(() => {
    const weekKeys = getLast12WeekKeys();
    const byWeek: Record<string, { run_m: number; swim_m: number; cycle_m: number }> = {};
    weekKeys.forEach((k) => { byWeek[k] = { run_m: 0, swim_m: 0, cycle_m: 0 }; });
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
    const runKms = weekKeys.map((k) => byWeek[k].run_m / 1000);
    const swimKms = weekKeys.map((k) => byWeek[k].swim_m / 1000);
    const cycleKms = weekKeys.map((k) => byWeek[k].cycle_m / 1000);
    const hitsInLast12 = (vals: number[], target: number) => vals.filter((v) => v >= target).length;

    const days = getLast30Days();
    const byDay: Record<string, any> = {};
    healthMetrics.forEach((m) => { if (m.date) byDay[m.date] = m; });
    const stepsVals = days.map((d) => readNum(byDay[d], 'healthkitStepsToday', 'steps', 'manualStepsToday'));
    const proteinVals = days.map((d) => readNum(byDay[d], 'proteinTodayG', 'healthkitProteinTodayG', 'manualProteinG'));
    const hits = (vals: (number | null)[], target: number) => vals.filter((v) => v !== null && v >= target).length;

    const currentWeekIdx = weekKeys.length - 1;
    return {
      runKm: runKms[currentWeekIdx] || 0,
      swimKm: swimKms[currentWeekIdx] || 0,
      cycleKm: cycleKms[currentWeekIdx] || 0,
      runHits: hitsInLast12(runKms, 30),
      swimHits: hitsInLast12(swimKms, 4),
      cycleHits: hitsInLast12(cycleKms, 50),
      stepsHits: hits(stepsVals, 12000),
      proteinHits: hits(proteinVals, 180),
      hasAnyData: workouts.length > 0 || healthMetrics.length > 0,
    };
  }, [workouts, healthMetrics]);

  if (!visible || !currentUser?.uid || !data.hasAnyData) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, new Date().toISOString()); } catch { /* ignore */ }
    setVisible(false);
  };

  const rows = [
    { label: 'Run', value: `${data.runKm.toFixed(1)}/30km`, hits: `${data.runHits}/12wks` },
    { label: 'Swim', value: `${data.swimKm.toFixed(1)}/4km`, hits: `${data.swimHits}/12wks` },
    { label: 'Cycle', value: `${data.cycleKm.toFixed(1)}/50km`, hits: `${data.cycleHits}/12wks` },
    { label: 'Steps', value: `${data.stepsHits}/30d ≥12k`, hits: null },
    { label: 'Protein', value: `${data.proteinHits}/30d ≥180g`, hits: null },
  ];

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
          Fitness KPIs this week
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => navigate('/fitness')}
            style={{ background: 'none', border: 'none', padding: 0, fontSize: 10, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline' }}
          >
            View all
          </button>
          <button
            onClick={dismiss}
            title="Dismiss for 3 days"
            aria-label="Dismiss"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 18, height: 18, padding: 0, background: 'transparent', border: 'none', borderRadius: 4, color: 'var(--muted)', cursor: 'pointer' }}
          >
            <X size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            style={{
              background: 'var(--notion-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
              padding: '5px 8px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}
          >
            <span style={{ fontSize: 12 }}>{row.label}</span>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{row.value}{row.hits ? ` · ${row.hits}` : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default GlobalFitnessKpiBanner;
