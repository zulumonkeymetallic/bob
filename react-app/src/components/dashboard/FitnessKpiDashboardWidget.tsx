/**
 * FitnessKpiDashboardWidget — compact fitness adherence boxes for the Overview dashboard.
 * Mirrors the FITNESS section of MetricsPage (/fitness): weekly run/swim/cycle targets
 * (12 weeks) + daily steps/sleep/protein targets (30 days) as FitnessKpiGrid boxes.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Card } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import FitnessKpiGrid, { FitnessKpiBox, FitnessKpiRow } from '../fitness/FitnessKpiGrid';

// ── helpers ───────────────────────────────────────────────────────────────────

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

// ── component ─────────────────────────────────────────────────────────────────

const FitnessKpiDashboardWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();

  const [workouts, setWorkouts] = useState<any[]>([]);
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc'),
      limit(2000),
    );
    return onSnapshot(q, snap => setWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setWorkouts([]));
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'health_metrics'),
      where('ownerUid', '==', currentUser.uid),
      limit(120),
    );
    return onSnapshot(q, snap => setHealthMetrics(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setHealthMetrics([]));
  }, [currentUser?.uid]);

  const weeklyRows: FitnessKpiRow[] = useMemo(() => {
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

    return [
      { label: 'Run  30km/wk',  summaryText: `${hitsInLast12(runKms,   30)}/12 wks`, boxes: weekKeys.map((k, i) => ({ key: k, pct: runKms[i]   > 0 ? Math.round((runKms[i]   / 30) * 100) : null, tooltip: `${k}: ${runKms[i].toFixed(1)} km` } as FitnessKpiBox)) },
      { label: 'Swim  4km/wk',  summaryText: `${hitsInLast12(swimKms,   4)}/12 wks`, boxes: weekKeys.map((k, i) => ({ key: k, pct: swimKms[i]  > 0 ? Math.round((swimKms[i]  /  4) * 100) : null, tooltip: `${k}: ${swimKms[i].toFixed(1)} km` } as FitnessKpiBox)) },
      { label: 'Cycle 50km/wk', summaryText: `${hitsInLast12(cycleKms, 50)}/12 wks`, boxes: weekKeys.map((k, i) => ({ key: k, pct: cycleKms[i] > 0 ? Math.round((cycleKms[i] / 50) * 100) : null, tooltip: `${k}: ${cycleKms[i].toFixed(1)} km` } as FitnessKpiBox)) },
    ];
  }, [workouts]);

  const dailyRows: FitnessKpiRow[] = useMemo(() => {
    const days = getLast30Days();
    const byDay: Record<string, any> = {};
    healthMetrics.forEach(m => { if (m.date) byDay[m.date] = m; });

    const stepsVals   = days.map(d => readNum(byDay[d], 'healthkitStepsToday', 'steps', 'manualStepsToday'));
    const sleepVals   = days.map(d => {
      const mins = readNum(byDay[d], 'sleepMinutes', 'healthkitSleepMinutes', 'manualSleepMinutes');
      if (mins !== null) return mins / 60;
      return readNum(byDay[d], 'sleepDurationH');
    });
    const proteinVals = days.map(d => readNum(byDay[d], 'proteinTodayG', 'healthkitProteinTodayG', 'manualProteinG'));

    return [
      { label: 'Steps 12k/day',  summaryText: `${hits(stepsVals, 12000)}/30d`, boxes: days.map((d, i) => ({ key: d, pct: stepsVals[i]   !== null ? Math.round((stepsVals[i]!   / 12000) * 100) : null, tooltip: `${d}: ${stepsVals[i] !== null ? Math.round(stepsVals[i]!).toLocaleString() + ' steps' : 'no data'}` } as FitnessKpiBox)) },
      { label: 'Sleep  8hr/day', summaryText: `${hits(sleepVals, 8)}/30d`,     boxes: days.map((d, i) => ({ key: d, pct: sleepVals[i]   !== null ? Math.round((sleepVals[i]!   /     8) * 100) : null, tooltip: `${d}: ${sleepVals[i] !== null ? sleepVals[i]!.toFixed(1) + 'h' : 'no data'}` } as FitnessKpiBox)) },
      { label: 'Protein 180g',   summaryText: `${hits(proteinVals, 180)}/30d`,  boxes: days.map((d, i) => ({ key: d, pct: proteinVals[i] !== null ? Math.round((proteinVals[i]! /   180) * 100) : null, tooltip: `${d}: ${proteinVals[i] !== null ? Math.round(proteinVals[i]!) + 'g' : 'no data'}` } as FitnessKpiBox)) },
    ];
  }, [healthMetrics]);

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <Activity size={15} />
          Fitness KPIs
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
        <div
          className="text-muted small fw-semibold text-uppercase mb-2"
          style={{ fontSize: '0.65rem', letterSpacing: '0.04em' }}
        >
          Weekly targets (12 weeks)
        </div>
        <div className="mb-3" style={{ overflowX: 'auto' }}>
          <FitnessKpiGrid rows={weeklyRows} />
        </div>
        <div
          className="text-muted small fw-semibold text-uppercase mb-2"
          style={{ fontSize: '0.65rem', letterSpacing: '0.04em' }}
        >
          Daily targets (30 days)
        </div>
        <div style={{ overflowX: 'auto' }}>
          <FitnessKpiGrid rows={dailyRows} />
        </div>
      </Card.Body>
    </Card>
  );
};

export default FitnessKpiDashboardWidget;
