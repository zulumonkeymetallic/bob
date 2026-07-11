/**
 * Self-contained fitness KPI banner for the toolbar bell row.
 * Condenses FitnessKpiDashboardWidget's rolling-window targets (12wk run/swim/cycle
 * distance, 30d steps/protein hit-streaks) into a one-line reminder shown every
 * few days — same 3-day dismiss pattern as GlobalHealthProgressBanner, so it works
 * on every page rather than only the dashboard's full KPI grid.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from 'react-bootstrap';
import { Activity, X } from 'lucide-react';
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

  return (
    <Card className="mb-1" style={{ background: 'linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)', border: 'none', color: '#fff', boxShadow: '0 3px 10px rgba(14,165,233,0.15)' }}>
      <Card.Body style={{ padding: '6px 10px' }}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <div style={{ width: 22, height: 22, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Activity size={12} />
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Fitness KPIs this week</div>
            <div style={{ marginTop: 1, fontSize: 10, opacity: 0.9 }}>
              Run {data.runKm.toFixed(1)}/30km · Swim {data.swimKm.toFixed(1)}/4km · Cycle {data.cycleKm.toFixed(1)}/50km
            </div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 10, opacity: 0.9, whiteSpace: 'nowrap' }}>
            12wk hits: R{data.runHits} S{data.swimHits} C{data.cycleHits} · 30d: {data.stepsHits} steps, {data.proteinHits} protein
          </div>
          <Button variant="outline-light" size="sm" style={{ fontSize: 10, padding: '2px 7px' }} onClick={() => navigate('/fitness')}>Fitness</Button>
          <button onClick={dismiss} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', cursor: 'pointer', padding: 3, borderRadius: 3, display: 'flex', alignItems: 'center', flexShrink: 0 }} title="Dismiss for 3 days">
            <X size={13} />
          </button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default GlobalFitnessKpiBanner;
