import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Row, Col, Badge, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, orderBy, limit, onSnapshot, doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  TimeScale
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, TimeScale);

interface WorkoutDoc {
  id: string;
  ownerUid: string;
  provider: 'strava' | 'parkrun' | string;
  stravaActivityId?: string | number | null;
  type?: string | null;
  sportType?: string | null;
  run?: boolean;
  title?: string | null;
  name?: string;
  event?: string;
  eventSlug?: string;
  eventRunSeqNumber?: number | null;
  eventResultUrl?: string | null;
  startDate?: number; // ms
  utcStartDate?: string;
  distance_m?: number;
  movingTime_s?: number;
  elapsedTime_s?: number;
  avgHeartrate?: number | null;
  perceivedExertion?: number | null;
  rpe?: number | null;
  stravaRpe?: number | null;
  sufferScore?: number | null;
  position?: number | null;
  participantsCount?: number | null;
  percentileTop?: number | null;
  hrZones?: { z1Time_s:number; z2Time_s:number; z3Time_s:number; z4Time_s:number; z5Time_s:number };
}

interface SportPredictionSummary {
  label: string;
  display: string | null;
  deltaSec: number | null;
}

interface SportCardSummary {
  sport: SportSummaryMode;
  label: string;
  ytdKm: number;
  monthKm: number;
  monthDeltaKm: number;
  weekKm: number;
  weekDeltaKm: number;
  predictions: SportPredictionSummary[];
}

function fmtTime(sec?: number | null): string {
  const s = Math.floor(sec || 0);
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), ss = s%60;
  return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}` : `${m}:${String(ss).padStart(2,'0')}`;
}

function paceMinPerKm(w: WorkoutDoc): number | null {
  const distKm = (w.distance_m || 0) / 1000;
  const sec = (w.movingTime_s ?? w.elapsedTime_s ?? 0);
  if (!distKm || !sec) return null;
  return (sec/60) / distKm;
}

function paceMinPer100m(w: WorkoutDoc): number | null {
  const distM = Number(w.distance_m || 0);
  const sec = Number(w.movingTime_s ?? w.elapsedTime_s ?? 0);
  if (!distM || !sec) return null;
  return (sec / 60) / (distM / 100);
}

function speedKmh(w: WorkoutDoc): number | null {
  const distKm = Number(w.distance_m || 0) / 1000;
  const sec = Number(w.movingTime_s ?? w.elapsedTime_s ?? 0);
  if (!distKm || !sec) return null;
  return distKm / (sec / 3600);
}

function resolveWorkoutStartMs(w: WorkoutDoc): number {
  const direct = Number(w.startDate || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const parsed = Date.parse(String(w.utcStartDate || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

type SportMode = 'run' | 'swim' | 'bike';

function getWorkoutSport(w: WorkoutDoc): SportMode | 'other' {
  if (w.provider === 'parkrun') return 'run';
  if (w.run === true) return 'run';
  const type = String(w.type || w.sportType || '').toLowerCase();
  if (type.includes('swim')) return 'swim';
  if (type.includes('ride') || type.includes('bike') || type.includes('cycling')) return 'bike';
  if (type.includes('run') || type.includes('walk') || type.includes('hike')) return 'run';
  return 'other';
}

function workoutMatchesSport(w: WorkoutDoc, sportMode: SportMode): boolean {
  return getWorkoutSport(w) === sportMode;
}

function readWorkoutRpe(w: WorkoutDoc): number | null {
  const raw = Number(w.perceivedExertion ?? w.rpe ?? w.stravaRpe ?? null);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(10, Math.max(1, raw));
}

function deriveRpeFromSuffer(w: WorkoutDoc): number | null {
  const suffer = Number(w.sufferScore ?? null);
  if (!Number.isFinite(suffer) || suffer <= 0) return null;
  return Math.min(10, Math.max(1, suffer / 10));
}

function estimateEquivalentRaceSec(
  distanceKm: number,
  timeSec: number,
  targetKm: number,
  options: { minKm?: number; maxKm?: number; exponent?: number } = {},
): number | null {
  const {
    minKm = 0.2,
    maxKm = 250,
    exponent = 1.06,
  } = options;
  if (!Number.isFinite(distanceKm) || !Number.isFinite(timeSec) || distanceKm <= 0 || timeSec <= 0) return null;
  if (distanceKm < minKm || distanceKm > maxKm) return null;
  return timeSec * Math.pow(targetKm / distanceKm, exponent);
}

type LookbackWindow = '1y' | '2y' | '3y' | 'all';
type SportSummaryMode = SportMode;

function formatSignedKmDelta(deltaKm: number | null): string {
  if (deltaKm == null || !Number.isFinite(deltaKm)) return '—';
  if (Math.abs(deltaKm) < 0.05) return '0.0 km';
  const sign = deltaKm > 0 ? '+' : '-';
  return `${sign}${Math.abs(deltaKm).toFixed(1)} km`;
}

function formatSignedSecDelta(deltaSec: number | null): string {
  if (deltaSec == null || !Number.isFinite(deltaSec)) return '—';
  if (Math.abs(deltaSec) < 0.5) return '0s';
  const sign = deltaSec > 0 ? '+' : '-';
  const abs = Math.round(Math.abs(deltaSec));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  if (h > 0) return `${sign}${h}h ${m}m ${s}s`;
  if (m > 0) return `${sign}${m}m ${s}s`;
  return `${sign}${s}s`;
}

function trendArrow(delta: number | null, lowerIsBetter: boolean): JSX.Element {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.001) {
    return <span className="text-muted ms-1">→</span>;
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0;
  const arrow = delta > 0 ? '↑' : '↓';
  const className = improved ? 'text-success ms-1' : 'text-danger ms-1';
  return <span className={className}>{arrow}</span>;
}

function resolveStravaActivityId(w: WorkoutDoc): string | null {
  const explicit = w.stravaActivityId != null ? String(w.stravaActivityId).trim() : '';
  if (explicit) {
    const m = explicit.match(/(\d{5,})$/);
    return m?.[1] || explicit;
  }
  if (w.provider === 'strava') {
    const m = String(w.id || '').match(/_(\d{5,})$/);
    if (m?.[1]) return m[1];
  }
  return null;
}

function stravaActivityUrl(w: WorkoutDoc): string | null {
  const id = resolveStravaActivityId(w);
  return id ? `https://www.strava.com/activities/${encodeURIComponent(id)}` : null;
}

function parkrunResultUrl(w: WorkoutDoc): string | null {
  const explicit = w.eventResultUrl ? String(w.eventResultUrl).trim() : '';
  if (explicit) return explicit;
  const slug = w.eventSlug ? String(w.eventSlug).trim().toLowerCase() : '';
  const run = Number(w.eventRunSeqNumber || 0);
  if (slug && run > 0) return `https://www.parkrun.org.uk/${encodeURIComponent(slug)}/results/${run}/`;
  if (slug) return `https://www.parkrun.org.uk/${encodeURIComponent(slug)}/results/`;
  return null;
}

function workoutHasDadMarker(w: WorkoutDoc): boolean {
  const text = `${String(w.title || '')} ${String(w.name || '')} ${String(w.event || '')}`.toLowerCase();
  return /\bdad\b/i.test(text);
}

const WorkoutsDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [workouts, setWorkouts] = useState<WorkoutDoc[]>([]);
  const [providerFilter, setProviderFilter] = useState<'all'|'strava'|'parkrun'>('all');
  const [settingsMsg, setSettingsMsg] = useState<string>('');
  const [zoneDisplayMode, setZoneDisplayMode] = useState<'time'|'percent'>('time');
  const [sportMode, setSportMode] = useState<SportMode>('run');
  const [lookbackWindow, setLookbackWindow] = useState<LookbackWindow>('1y');
  const [excludeWithDadFromMetrics, setExcludeWithDadFromMetrics] = useState(true);
  const [fitnessOverview, setFitnessOverview] = useState<any | null>(null);
  const [runAnalysis, setRunAnalysis] = useState<any | null>(null);
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const forcedProvider = useMemo(() => {
    const path = location.pathname || '';
    const fromPath = path === '/parkrun-results' ? 'parkrun' : null;
    const fromQuery = String(queryParams.get('provider') || '').toLowerCase();
    if (fromPath) return fromPath;
    if (fromQuery === 'parkrun' || fromQuery === 'strava') return fromQuery as 'parkrun' | 'strava';
    return null;
  }, [location.pathname, queryParams]);
  const activeProviderFilter = forcedProvider || providerFilter;
  const pageTitle = location.pathname === '/parkrun-results' ? 'Parkrun Results' : 'Fitness Dashboard';
  const sportConfig = useMemo(() => {
    if (sportMode === 'swim') {
      return {
        label: 'Swim',
        primaryTargetKm: 0.8,
        secondaryTargetKm: null as number | null,
        primaryLabel: 'Avg Equivalent 800m (min)',
        secondaryLabel: null as string | null,
        primaryDisplayLabel: 'Predicted 800m',
        secondaryDisplayLabel: null as string | null,
        minKm: 0.2,
        maxKm: 5,
        exponent: 1.04,
      };
    }
    if (sportMode === 'bike') {
      return {
        label: 'Bike',
        primaryTargetKm: 50,
        secondaryTargetKm: null as number | null,
        primaryLabel: 'Avg Equivalent 50k (min)',
        secondaryLabel: null as string | null,
        primaryDisplayLabel: 'Predicted 50k',
        secondaryDisplayLabel: null as string | null,
        minKm: 10,
        maxKm: 250,
        exponent: 1.06,
      };
    }
    return {
      label: 'Run',
      primaryTargetKm: 5,
      secondaryTargetKm: 10,
      primaryLabel: 'Avg Equivalent 5k (min)',
      secondaryLabel: 'Avg Equivalent 10k (min)',
      primaryDisplayLabel: 'Predicted 5K',
      secondaryDisplayLabel: 'Predicted 10K',
      minKm: 3,
      maxKm: 21.2,
      exponent: 1.06,
    };
  }, [sportMode]);

  useEffect(() => {
    if (forcedProvider) setProviderFilter(forcedProvider);
  }, [forcedProvider]);

  useEffect(() => {
    if (forcedProvider === 'parkrun') setSportMode('run');
  }, [forcedProvider]);

  useEffect(() => {
    if (!currentUser) return;
    const qRef = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc'),
      limit(2000)
    );
    const unsub = onSnapshot(qRef, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as WorkoutDoc[];
      setWorkouts(rows);
    });
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setFitnessOverview(null);
      setRunAnalysis(null);
      return;
    }
    const unOverview = onSnapshot(doc(db, 'fitness_overview', currentUser.uid), (snap) => {
      setFitnessOverview(snap.exists() ? snap.data() : null);
    }, () => setFitnessOverview(null));
    const unAnalysis = onSnapshot(doc(db, 'run_analysis', currentUser.uid), (snap) => {
      setRunAnalysis(snap.exists() ? snap.data() : null);
    }, () => setRunAnalysis(null));
    return () => {
      unOverview();
      unAnalysis();
    };
  }, [currentUser]);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        const profileSnap = await getDoc(doc(db, 'profiles', currentUser.uid));
        if (profileSnap.exists()) {
          const p = profileSnap.data() as any;
          setExcludeWithDadFromMetrics(p.excludeWithDadFromMetrics !== false);
        }
      } catch {}
    };
    load();
  }, [currentUser]);

  const minWindowStartMs = useMemo(() => {
    if (lookbackWindow === 'all') return null;
    const now = new Date();
    const yearsBack = lookbackWindow === '1y' ? 1 : lookbackWindow === '2y' ? 2 : 3;
    return Date.UTC(now.getUTCFullYear() - yearsBack, now.getUTCMonth(), now.getUTCDate());
  }, [lookbackWindow]);

  const filtered = useMemo(() => {
    return workouts.filter(w => {
      if (activeProviderFilter !== 'all' && w.provider !== activeProviderFilter) return false;
      if (!workoutMatchesSport(w, sportMode)) return false;
      if (excludeWithDadFromMetrics && workoutHasDadMarker(w)) return false;
      if (minWindowStartMs != null) {
        const startMs = resolveWorkoutStartMs(w);
        if (!startMs || startMs < minWindowStartMs) return false;
      }
      return true;
    });
  }, [workouts, activeProviderFilter, minWindowStartMs, sportMode, excludeWithDadFromMetrics]);

  const overallMonthlyDistance = useMemo(() => {
    const monthlyMap = new Map<string, { runKm: number; swimKm: number; bikeKm: number }>();
    for (const workout of workouts) {
      if (activeProviderFilter !== 'all' && workout.provider !== activeProviderFilter) continue;
      if (excludeWithDadFromMetrics && workoutHasDadMarker(workout)) continue;
      const startMs = resolveWorkoutStartMs(workout);
      if (!startMs) continue;
      if (minWindowStartMs != null && startMs < minWindowStartMs) continue;
      const sport = getWorkoutSport(workout);
      if (sport === 'other') continue;
      const monthKey = (() => {
        const date = new Date(startMs);
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
      })();
      const current = monthlyMap.get(monthKey) || { runKm: 0, swimKm: 0, bikeKm: 0 };
      const distanceKm = Number(workout.distance_m || 0) / 1000;
      if (sport === 'run') current.runKm += distanceKm;
      else if (sport === 'swim') current.swimKm += distanceKm;
      else if (sport === 'bike') current.bikeKm += distanceKm;
      monthlyMap.set(monthKey, current);
    }
    return Array.from(monthlyMap.entries())
      .map(([month, value]) => ({
        month,
        runKm: Number(value.runKm.toFixed(2)),
        swimKm: Number(value.swimKm.toFixed(2)),
        bikeKm: Number(value.bikeKm.toFixed(2)),
        totalKm: Number((value.runKm + value.swimKm + value.bikeKm).toFixed(2)),
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [workouts, activeProviderFilter, minWindowStartMs, excludeWithDadFromMetrics]);

  const overallDistanceChartData = useMemo(() => ({
    labels: overallMonthlyDistance.map((row) => row.month),
    datasets: [
      {
        type: 'bar' as const,
        label: 'Run distance (km)',
        data: overallMonthlyDistance.map((row) => row.runKm),
        backgroundColor: 'rgba(59,130,246,0.7)',
        borderColor: 'rgba(59,130,246,0.95)',
        borderWidth: 1,
        stack: 'distance',
        yAxisID: 'yDistance',
      },
      {
        type: 'bar' as const,
        label: 'Swim distance (km)',
        data: overallMonthlyDistance.map((row) => row.swimKm),
        backgroundColor: 'rgba(16,185,129,0.7)',
        borderColor: 'rgba(16,185,129,0.95)',
        borderWidth: 1,
        stack: 'distance',
        yAxisID: 'yDistance',
      },
      {
        type: 'bar' as const,
        label: 'Bike distance (km)',
        data: overallMonthlyDistance.map((row) => row.bikeKm),
        backgroundColor: 'rgba(245,158,11,0.75)',
        borderColor: 'rgba(245,158,11,0.95)',
        borderWidth: 1,
        stack: 'distance',
        yAxisID: 'yDistance',
      },
      {
        type: 'line' as const,
        label: 'Total distance (km)',
        data: overallMonthlyDistance.map((row) => row.totalKm),
        borderColor: '#111827',
        backgroundColor: 'rgba(17,24,39,0.1)',
        borderWidth: 2,
        pointRadius: 2,
        tension: 0.25,
        yAxisID: 'yDistance',
      },
    ],
  }), [overallMonthlyDistance]);

  const overallDistanceChartOptions: any = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { position: 'top' } },
    scales: {
      x: { stacked: true },
      yDistance: {
        type: 'linear',
        stacked: true,
        title: { display: true, text: 'Distance (km)' },
      },
    },
  }), []);

  const sportCards = useMemo(() => {
    type SportAggregate = {
      ytdKm: number;
      monthKm: number;
      prevMonthKm: number;
      weekKm: number;
      prevWeekKm: number;
    };
    const aggregates: Record<SportSummaryMode, SportAggregate> = {
      run: { ytdKm: 0, monthKm: 0, prevMonthKm: 0, weekKm: 0, prevWeekKm: 0 },
      swim: { ytdKm: 0, monthKm: 0, prevMonthKm: 0, weekKm: 0, prevWeekKm: 0 },
      bike: { ytdKm: 0, monthKm: 0, prevMonthKm: 0, weekKm: 0, prevWeekKm: 0 },
    };

    const nowMs = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const last7StartMs = nowMs - sevenDaysMs;
    const prev7StartMs = nowMs - (2 * sevenDaysMs);
    const now = new Date(nowMs);
    const monthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const prevMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1);
    const nextMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1);

    for (const workout of workouts) {
      if (activeProviderFilter !== 'all' && workout.provider !== activeProviderFilter) continue;
      if (excludeWithDadFromMetrics && workoutHasDadMarker(workout)) continue;
      const sport = getWorkoutSport(workout);
      if (sport === 'other') continue;
      const startMs = resolveWorkoutStartMs(workout);
      if (!startMs) continue;
      const distanceKm = Number(workout.distance_m || 0) / 1000;
      if (!Number.isFinite(distanceKm) || distanceKm <= 0) continue;
      if (startMs >= yearStartMs) aggregates[sport].ytdKm += distanceKm;
      if (startMs >= monthStartMs && startMs < nextMonthStartMs) aggregates[sport].monthKm += distanceKm;
      else if (startMs >= prevMonthStartMs && startMs < monthStartMs) aggregates[sport].prevMonthKm += distanceKm;
      if (startMs >= last7StartMs && startMs <= nowMs) aggregates[sport].weekKm += distanceKm;
      else if (startMs >= prev7StartMs && startMs < last7StartMs) aggregates[sport].prevWeekKm += distanceKm;
    }

    const computePredictionTrend = (
      sport: SportSummaryMode,
      targetKm: number,
      options: { minKm?: number; maxKm?: number; exponent?: number },
    ): { sec: number | null; deltaSec: number | null; display: string | null } => {
      const monthMap = new Map<string, { sumSec: number; count: number }>();
      for (const workout of workouts) {
        if (activeProviderFilter !== 'all' && workout.provider !== activeProviderFilter) continue;
        if (excludeWithDadFromMetrics && workoutHasDadMarker(workout)) continue;
        if (getWorkoutSport(workout) !== sport) continue;
        const startMs = resolveWorkoutStartMs(workout);
        if (!startMs) continue;
        const distanceKm = Number(workout.distance_m || 0) / 1000;
        const timeSec = Number(workout.movingTime_s ?? workout.elapsedTime_s ?? 0);
        if (!Number.isFinite(distanceKm) || !Number.isFinite(timeSec) || distanceKm <= 0 || timeSec <= 0) continue;
        const normalizedSec = estimateEquivalentRaceSec(distanceKm, timeSec, targetKm, options);
        if (normalizedSec == null) continue;
        const monthKey = (() => {
          const date = new Date(startMs);
          return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
        })();
        const bucket = monthMap.get(monthKey) || { sumSec: 0, count: 0 };
        bucket.sumSec += normalizedSec;
        bucket.count += 1;
        monthMap.set(monthKey, bucket);
      }
      const monthlyRows = Array.from(monthMap.entries())
        .map(([month, value]) => ({
          month,
          avgSec: value.count > 0 ? value.sumSec / value.count : null,
        }))
        .filter((row) => row.avgSec != null)
        .sort((a, b) => a.month.localeCompare(b.month));
      const currentSec = monthlyRows.length ? Number(monthlyRows[monthlyRows.length - 1].avgSec) : null;
      const previousSec = monthlyRows.length > 1 ? Number(monthlyRows[monthlyRows.length - 2].avgSec) : null;
      return {
        sec: currentSec != null ? Number(currentSec.toFixed(1)) : null,
        deltaSec: (currentSec != null && previousSec != null) ? Number((currentSec - previousSec).toFixed(1)) : null,
        display: currentSec != null ? fmtTime(currentSec) : null,
      };
    };

    const run5k = computePredictionTrend('run', 5, { minKm: 3, maxKm: 21.2, exponent: 1.06 });
    const run10k = computePredictionTrend('run', 10, { minKm: 3, maxKm: 42.2, exponent: 1.06 });
    const runHalf = computePredictionTrend('run', 21.0975, { minKm: 3, maxKm: 42.2, exponent: 1.06 });
    const swim800 = computePredictionTrend('swim', 0.8, { minKm: 0.2, maxKm: 5, exponent: 1.04 });
    const bike50 = computePredictionTrend('bike', 50, { minKm: 10, maxKm: 250, exponent: 1.06 });

    const runPredictions: SportPredictionSummary[] = [
      {
        label: 'Predicted 5K',
        display: run5k.display || fitnessOverview?.predictions?.fiveKDisplay || runAnalysis?.predicted5kDisplay || null,
        deltaSec: run5k.deltaSec,
      },
      {
        label: 'Predicted 10K',
        display: run10k.display || fitnessOverview?.predictions?.tenKDisplay || runAnalysis?.predicted10kDisplay || null,
        deltaSec: run10k.deltaSec,
      },
      {
        label: 'Predicted Half Marathon',
        display: runHalf.display || fitnessOverview?.predictions?.halfMarathonDisplay || null,
        deltaSec: runHalf.deltaSec,
      },
    ];
    const swimPredictions: SportPredictionSummary[] = [
      {
        label: 'Predicted 800m',
        display: swim800.display || fitnessOverview?.predictions?.swim800mDisplay || null,
        deltaSec: swim800.deltaSec,
      },
    ];
    const bikePredictions: SportPredictionSummary[] = [
      {
        label: 'Predicted 50k',
        display: bike50.display || fitnessOverview?.predictions?.bike50kDisplay || fitnessOverview?.predictions?.bike30miDisplay || null,
        deltaSec: bike50.deltaSec,
      },
    ];

    const sportLabel: Record<SportSummaryMode, string> = {
      run: 'Run',
      swim: 'Swim',
      bike: 'Bike',
    };
    const predictionBySport: Record<SportSummaryMode, SportPredictionSummary[]> = {
      run: runPredictions,
      swim: swimPredictions,
      bike: bikePredictions,
    };

    return (['run', 'swim', 'bike'] as SportSummaryMode[]).map((sport) => ({
      sport,
      label: sportLabel[sport],
      ytdKm: Number(aggregates[sport].ytdKm.toFixed(1)),
      monthKm: Number(aggregates[sport].monthKm.toFixed(1)),
      monthDeltaKm: Number((aggregates[sport].monthKm - aggregates[sport].prevMonthKm).toFixed(1)),
      weekKm: Number(aggregates[sport].weekKm.toFixed(1)),
      weekDeltaKm: Number((aggregates[sport].weekKm - aggregates[sport].prevWeekKm).toFixed(1)),
      predictions: predictionBySport[sport],
    } as SportCardSummary));
  }, [workouts, activeProviderFilter, fitnessOverview, runAnalysis, excludeWithDadFromMetrics]);

  const monthly = useMemo(() => {
    const map = new Map<string, {
      distKm: number;
      sessions: number;
      parkrunTimes: number[];
      z1Min: number;
      z2Min: number;
      z3Min: number;
      z4Min: number;
      z5Min: number;
      rpeSum: number;
      rpeCount: number;
      primarySecSum: number;
      primaryCount: number;
      secondarySecSum: number;
      secondaryCount: number;
      trainingLoad: number;
    }>();
    for (const w of filtered) {
      const ms = resolveWorkoutStartMs(w);
      if (!ms) continue;
      const d = new Date(ms);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      const cur = map.get(key) || {
        distKm: 0,
        sessions: 0,
        parkrunTimes: [],
        z1Min: 0,
        z2Min: 0,
        z3Min: 0,
        z4Min: 0,
        z5Min: 0,
        rpeSum: 0,
        rpeCount: 0,
        primarySecSum: 0,
        primaryCount: 0,
        secondarySecSum: 0,
        secondaryCount: 0,
        trainingLoad: 0,
      };
      const distKm = (w.distance_m || 0)/1000;
      const durationSec = Number(w.movingTime_s ?? w.elapsedTime_s ?? 0);
      cur.distKm += distKm;
      cur.sessions += 1;
      if (sportMode === 'run' && w.provider === 'parkrun') {
        const t = w.elapsedTime_s ?? w.movingTime_s;
        if (t) cur.parkrunTimes.push(t);
      }
      let zoneWeightedMin = 0;
      if (w.hrZones) {
        const z1Min = (w.hrZones.z1Time_s || 0) / 60;
        const z2Min = (w.hrZones.z2Time_s || 0) / 60;
        const z3Min = (w.hrZones.z3Time_s || 0) / 60;
        const z4Min = (w.hrZones.z4Time_s || 0) / 60;
        const z5Min = (w.hrZones.z5Time_s || 0) / 60;
        cur.z1Min += z1Min;
        cur.z2Min += z2Min;
        cur.z3Min += z3Min;
        cur.z4Min += z4Min;
        cur.z5Min += z5Min;
        zoneWeightedMin = (z1Min * 1) + (z2Min * 2) + (z3Min * 3) + (z4Min * 4) + (z5Min * 5);
      }
      const explicitRpe = readWorkoutRpe(w);
      const rpeForTrend = explicitRpe ?? deriveRpeFromSuffer(w);
      if (rpeForTrend != null) {
        cur.rpeSum += rpeForTrend;
        cur.rpeCount += 1;
      }
      if (distKm > 0 && durationSec > 0) {
        const primaryEq = estimateEquivalentRaceSec(distKm, durationSec, sportConfig.primaryTargetKm, {
          minKm: sportConfig.minKm,
          maxKm: sportConfig.maxKm,
          exponent: sportConfig.exponent,
        });
        if (primaryEq != null) {
          cur.primarySecSum += primaryEq;
          cur.primaryCount += 1;
        }
        if (sportConfig.secondaryTargetKm != null) {
          const secondaryEq = estimateEquivalentRaceSec(distKm, durationSec, sportConfig.secondaryTargetKm, {
            minKm: sportConfig.minKm,
            maxKm: sportConfig.maxKm,
            exponent: sportConfig.exponent,
          });
          if (secondaryEq != null) {
            cur.secondarySecSum += secondaryEq;
            cur.secondaryCount += 1;
          }
        }
      }
      const durationMin = durationSec > 0 ? (durationSec / 60) : 0;
      const rpeForLoad = explicitRpe ?? deriveRpeFromSuffer(w);
      const suffer = Number(w.sufferScore ?? 0);
      let load = 0;
      if (Number.isFinite(suffer) && suffer > 0) load += suffer;
      if (zoneWeightedMin > 0) load += zoneWeightedMin * 0.9;
      if (rpeForLoad != null && durationMin > 0) load += rpeForLoad * (durationMin / 12);
      if (load <= 0 && durationMin > 0) load = (durationMin * 0.5) + (distKm * 2.5);
      cur.trainingLoad += load;
      map.set(key, cur);
    }
    const base = Array.from(map.entries()).map(([month, v]) => {
      const times = v.parkrunTimes.slice().sort((a,b)=>a-b);
      const med = times.length ? times[Math.floor(times.length/2)] : null;
      return {
        month,
        parkrunMedianSec: sportMode === 'run' ? med : null,
        distKm: v.distKm,
        sessions: v.sessions,
        z1Min: v.z1Min,
        z2Min: v.z2Min,
        z3Min: v.z3Min,
        z4Min: v.z4Min,
        z5Min: v.z5Min,
        avgRpe: v.rpeCount ? (v.rpeSum / v.rpeCount) : null,
        avgPrimarySec: v.primaryCount ? (v.primarySecSum / v.primaryCount) : null,
        avgSecondarySec: v.secondaryCount ? (v.secondarySecSum / v.secondaryCount) : null,
        trainingLoad: v.trainingLoad,
      };
    }).sort((a,b)=> a.month.localeCompare(b.month));

    let ctl = 0;
    let atl = 0;
    const withLoad = base.map((item) => {
      ctl += (item.trainingLoad - ctl) / 6; // chronic load (slow)
      atl += (item.trainingLoad - atl) / 2; // acute load (fast)
      return {
        ...item,
        fitnessLoad: ctl,
        freshnessLoad: ctl - atl,
      };
    });

    const loadValues = withLoad.map((x) => Number(x.fitnessLoad || 0)).filter((x) => Number.isFinite(x));
    const minLoad = loadValues.length ? Math.min(...loadValues) : 0;
    const maxLoad = loadValues.length ? Math.max(...loadValues) : 0;
    const span = maxLoad - minLoad;

    return withLoad.map((m) => {
      const normalizedFitness = span > 0.001
        ? ((m.fitnessLoad - minLoad) / span) * 100
        : (m.fitnessLoad > 0 ? Math.min(100, m.fitnessLoad) : 0);
      return {
        month: m.month,
        distKm: Number(m.distKm.toFixed(1)),
        sessions: m.sessions,
        parkrunMedianSec: m.parkrunMedianSec,
        z1Min: Number(m.z1Min.toFixed(1)),
        z2Min: Number(m.z2Min.toFixed(1)),
        z3Min: Number(m.z3Min.toFixed(1)),
        z4Min: Number(m.z4Min.toFixed(1)),
        z5Min: Number(m.z5Min.toFixed(1)),
        avgRpe: m.avgRpe != null ? Number(m.avgRpe.toFixed(2)) : null,
        primaryPredictionSec: m.avgPrimarySec != null ? Number(m.avgPrimarySec.toFixed(1)) : null,
        secondaryPredictionSec: m.avgSecondarySec != null ? Number(m.avgSecondarySec.toFixed(1)) : null,
        fitnessScore: Number(normalizedFitness.toFixed(1)),
        freshnessLoad: Number(m.freshnessLoad.toFixed(1)),
      };
    });
  }, [filtered, sportMode, sportConfig]);

  const chartData = useMemo(() => {
    const zoneTotal = (m: any) => (m.z1Min + m.z2Min + m.z3Min + m.z4Min + m.z5Min);
    const zoneValue = (m: any, key: 'z1Min'|'z2Min'|'z3Min'|'z4Min'|'z5Min') => {
      if (zoneDisplayMode === 'percent') {
        const total = zoneTotal(m);
        return total > 0 ? Number(((m[key] / total) * 100).toFixed(1)) : 0;
      }
      return m[key];
    };
    const zoneLabelSuffix = zoneDisplayMode === 'percent' ? '%' : 'min';
    const datasets: any[] = [
      {
        label: `Monthly ${sportConfig.label} Distance (km)`,
        data: monthly.map(m => m.distKm),
        yAxisID: 'yDistance',
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.2)'
      },
    ];
    if (sportMode === 'run') {
      datasets.push({
        label: 'Parkrun 5k Median (min)',
        data: monthly.map(m => m.parkrunMedianSec ? (m.parkrunMedianSec/60) : null),
        yAxisID: 'yParkrun',
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.2)'
      });
    }
    datasets.push({
      label: sportConfig.primaryLabel,
      data: monthly.map(m => m.primaryPredictionSec ? (m.primaryPredictionSec / 60) : null),
      yAxisID: 'yParkrun',
      borderColor: '#0f766e',
      backgroundColor: 'rgba(15,118,110,0.15)',
      borderDash: [6, 4],
      pointRadius: 2,
      tension: 0.25,
    });
    if (sportConfig.secondaryLabel) {
      datasets.push({
        label: sportConfig.secondaryLabel,
        data: monthly.map(m => m.secondaryPredictionSec ? (m.secondaryPredictionSec / 60) : null),
        yAxisID: 'yParkrun',
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.15)',
        borderDash: [4, 4],
        pointRadius: 2,
        tension: 0.25,
      });
    }
    datasets.push({
      label: 'Avg RPE (1-10)',
      data: monthly.map(m => m.avgRpe ?? null),
      yAxisID: 'yRpe',
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139,92,246,0.15)',
      borderWidth: 2,
      tension: 0.25,
    });
    datasets.push({
      label: 'Fitness Level (load trend)',
      data: monthly.map(m => m.fitnessScore),
      yAxisID: 'yFitness',
      borderColor: '#f97316',
      backgroundColor: 'rgba(249,115,22,0.15)',
      borderWidth: 2,
      tension: 0.25,
    });
    datasets.push({
      type: 'bar' as const,
      label: `Zone 1 (${zoneLabelSuffix})`,
      data: monthly.map(m => zoneValue(m, 'z1Min')),
      yAxisID: 'yZones',
      backgroundColor: 'rgba(107,114,128,0.6)',
      stack: 'zones',
    });
    datasets.push({
      type: 'bar' as const,
      label: `Zone 2 (${zoneLabelSuffix})`,
      data: monthly.map(m => zoneValue(m, 'z2Min')),
      yAxisID: 'yZones',
      backgroundColor: 'rgba(96,165,250,0.7)',
      stack: 'zones',
    });
    datasets.push({
      type: 'bar' as const,
      label: `Zone 3 (${zoneLabelSuffix})`,
      data: monthly.map(m => zoneValue(m, 'z3Min')),
      yAxisID: 'yZones',
      backgroundColor: 'rgba(74,222,128,0.8)',
      stack: 'zones',
    });
    datasets.push({
      type: 'bar' as const,
      label: `Zone 4 (${zoneLabelSuffix})`,
      data: monthly.map(m => zoneValue(m, 'z4Min')),
      yAxisID: 'yZones',
      backgroundColor: 'rgba(251,191,36,0.85)',
      stack: 'zones',
    });
    datasets.push({
      type: 'bar' as const,
      label: `Zone 5 (${zoneLabelSuffix})`,
      data: monthly.map(m => zoneValue(m, 'z5Min')),
      yAxisID: 'yZones',
      backgroundColor: 'rgba(248,113,113,0.9)',
      stack: 'zones',
    });
    return {
      labels: monthly.map(m => m.month),
      datasets,
    };
  }, [monthly, zoneDisplayMode, sportConfig, sportMode]);

  const chartOptions:any = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    stacked: false,
    plugins: { legend: { position: 'top' } },
    scales: {
      yDistance: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'Distance (km)' } },
      yParkrun: { type: 'linear', display: true, position: 'right', title: { display: true, text: `Equivalent ${sportConfig.label} Time (min)` }, grid: { drawOnChartArea: false } },
      yRpe: { type: 'linear', display: true, position: 'right', offset: true, min: 0, max: 10, title: { display: true, text: 'Avg RPE (1-10)' }, grid: { drawOnChartArea: false } },
      yFitness: { type: 'linear', display: true, position: 'right', offset: true, min: 0, max: 100, title: { display: true, text: 'Fitness (0-100)' }, grid: { drawOnChartArea: false } },
      yZones: {
        type: 'linear',
        display: true,
        position: 'right',
        title: { display: true, text: zoneDisplayMode === 'percent' ? 'HR Zone Share (%)' : 'HR Zone Time (min)' },
        stacked: true,
        min: 0,
        max: zoneDisplayMode === 'percent' ? 100 : undefined,
        grid: { drawOnChartArea: false }
      }
    }
  };

  const sportPredictions = useMemo(() => {
    let bestPrimarySec: number | null = null;
    let bestSecondarySec: number | null = null;
    for (const w of filtered) {
      const distKm = Number(w.distance_m || 0) / 1000;
      const timeSec = Number(w.movingTime_s ?? w.elapsedTime_s ?? 0);
      if (!Number.isFinite(distKm) || !Number.isFinite(timeSec) || distKm <= 0 || timeSec <= 0) continue;
      const primaryEq = estimateEquivalentRaceSec(distKm, timeSec, sportConfig.primaryTargetKm, {
        minKm: sportConfig.minKm,
        maxKm: sportConfig.maxKm,
        exponent: sportConfig.exponent,
      });
      if (primaryEq != null && (bestPrimarySec == null || primaryEq < bestPrimarySec)) bestPrimarySec = primaryEq;
      if (sportConfig.secondaryTargetKm != null) {
        const secondaryEq = estimateEquivalentRaceSec(distKm, timeSec, sportConfig.secondaryTargetKm, {
          minKm: sportConfig.minKm,
          maxKm: sportConfig.maxKm,
          exponent: sportConfig.exponent,
        });
        if (secondaryEq != null && (bestSecondarySec == null || secondaryEq < bestSecondarySec)) bestSecondarySec = secondaryEq;
      }
    }
    return { primarySec: bestPrimarySec, secondarySec: bestSecondarySec };
  }, [filtered, sportConfig]);
  const latestMonthly = monthly.length ? monthly[monthly.length - 1] : null;
  const sportYtdDistanceKm = useMemo(() => {
    const yearStartMs = Date.UTC(new Date().getUTCFullYear(), 0, 1);
    let total = 0;
    for (const w of workouts) {
      if (activeProviderFilter !== 'all' && w.provider !== activeProviderFilter) continue;
      if (!workoutMatchesSport(w, sportMode)) continue;
      if (excludeWithDadFromMetrics && workoutHasDadMarker(w)) continue;
      const startMs = resolveWorkoutStartMs(w);
      if (!startMs || startMs < yearStartMs) continue;
      total += Number(w.distance_m || 0) / 1000;
    }
    return Number(total.toFixed(2));
  }, [workouts, activeProviderFilter, sportMode, excludeWithDadFromMetrics]);

  const fitnessScoreDisplay = latestMonthly?.fitnessScore ?? fitnessOverview?.fitnessScore ?? runAnalysis?.fitnessScore ?? null;
  const fitnessLevelDisplay = fitnessOverview?.fitnessLevel || null;
  const predictedPrimaryDisplay = sportPredictions.primarySec != null
    ? fmtTime(sportPredictions.primarySec)
    : (
      sportMode === 'run'
        ? (fitnessOverview?.predictions?.fiveKDisplay || runAnalysis?.predicted5kDisplay || null)
        : sportMode === 'swim'
          ? (fitnessOverview?.predictions?.swim800mDisplay || null)
          : (fitnessOverview?.predictions?.bike50kDisplay || fitnessOverview?.predictions?.bike30miDisplay || null)
    );
  const predictedSecondaryDisplay = sportConfig.secondaryDisplayLabel
    ? (
      sportPredictions.secondarySec != null
        ? fmtTime(sportPredictions.secondarySec)
        : (fitnessOverview?.predictions?.tenKDisplay || runAnalysis?.predicted10kDisplay || null)
    )
    : null;
  const rpe30Display = fitnessOverview?.rpe?.avg30 ?? runAnalysis?.averagePairRpe ?? null;
  const visibleSportCards = forcedProvider === 'parkrun'
    ? sportCards.filter((card) => card.sport === 'run')
    : sportCards;

  return (
    <div className="container-fluid py-3">
      <Row className="mb-3">
        <Col>
          <h3>{pageTitle}</h3>
        </Col>
        <Col className="text-end">
          {!forcedProvider && (
            <Form.Select value={providerFilter} onChange={(e)=>setProviderFilter(e.target.value as any)} style={{ display: 'inline-block', width: 180 }}>
              <option value="all">All Providers</option>
              <option value="strava">Strava</option>
              <option value="parkrun">Parkrun</option>
            </Form.Select>
          )}
          <Form.Select
            value={sportMode}
            onChange={(e)=>setSportMode((e.target.value as SportMode) || 'run')}
            style={{ display: 'inline-block', width: 130, marginLeft: 8 }}
            disabled={forcedProvider === 'parkrun'}
          >
            <option value="run">Run</option>
            <option value="swim">Swim</option>
            <option value="bike">Bike</option>
          </Form.Select>
          <Form.Select
            value={lookbackWindow}
            onChange={(e)=>setLookbackWindow((e.target.value as LookbackWindow) || '1y')}
            style={{ display: 'inline-block', width: 140, marginLeft: 8 }}
          >
            <option value="1y">Last 1 year</option>
            <option value="2y">Last 2 years</option>
            <option value="3y">Last 3 years</option>
            <option value="all">All data</option>
          </Form.Select>
          {forcedProvider && (
            <Badge bg={forcedProvider === 'parkrun' ? 'success' : 'primary'}>
              {forcedProvider === 'parkrun' ? 'Parkrun only' : 'Strava only'}
            </Badge>
          )}
        </Col>
      </Row>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap gap-3 small mb-2">
            <span><strong>Fitness:</strong> {fitnessScoreDisplay ?? '—'}{fitnessLevelDisplay ? ` (${fitnessLevelDisplay})` : ''}</span>
            <span><strong>{sportConfig.primaryDisplayLabel}:</strong> {predictedPrimaryDisplay || '—'}</span>
            {sportConfig.secondaryDisplayLabel && (
              <span><strong>{sportConfig.secondaryDisplayLabel}:</strong> {predictedSecondaryDisplay || '—'}</span>
            )}
            <span><strong>RPE (30d):</strong> {rpe30Display != null ? Number(rpe30Display).toFixed(1) : '—'}</span>
            <span><strong>{sportConfig.label} distance YTD:</strong> {sportYtdDistanceKm.toFixed(1)} km</span>
            <span><strong>Window:</strong> {lookbackWindow === '1y' ? '1 year' : lookbackWindow === '2y' ? '2 years' : lookbackWindow === '3y' ? '3 years' : 'all data'}</span>
            <span><strong>Dad filter:</strong> {excludeWithDadFromMetrics ? 'On' : 'Off'}</span>
            <span className="text-muted">Fitness trend uses Strava load (suffer score, HR zones, and RPE) over time.</span>
          </div>
          <Row className="g-2 align-items-end">
            <Col md="auto">
              <Form.Select
                size="sm"
                value={zoneDisplayMode}
                onChange={(e)=>setZoneDisplayMode((e.target.value as 'time'|'percent') || 'time')}
              >
                <option value="time">Zones in Time</option>
                <option value="percent">Zones in %</option>
              </Form.Select>
            </Col>
            <Col md="auto">
              <Form.Check
                type="switch"
                id="exclude-dad-metrics-toggle"
                label="Exclude 'dad' workouts"
                checked={excludeWithDadFromMetrics}
                onChange={async (e) => {
                  const checked = e.target.checked;
                  setExcludeWithDadFromMetrics(checked);
                  if (!currentUser) return;
                  try {
                    await setDoc(doc(db, 'profiles', currentUser.uid), {
                      ownerUid: currentUser.uid,
                      excludeWithDadFromMetrics: checked,
                    }, { merge: true });
                    setSettingsMsg(`Dad-tagged workout filter ${checked ? 'enabled' : 'disabled'}.`);
                  } catch (err: any) {
                    setSettingsMsg(`Failed to update dad filter: ${err?.message || 'unknown error'}`);
                  }
                }}
              />
            </Col>
          </Row>
          {settingsMsg && <Alert variant="light" className="mt-2 mb-0 py-1"><small>{settingsMsg}</small></Alert>}
          <Alert variant="secondary" className="mt-2 mb-0 py-2">
            <small>
              <strong>Automation:</strong> Strava sync runs daily at 03:00 (Europe/London), Parkrun sync runs weekly on Saturday at 14:00 (Europe/London), and Parkrun/Strava correlation, HR enrichment, and fitness metrics are recomputed automatically.
            </small>
          </Alert>
          <div className="text-muted mt-2" style={{fontSize:'0.85rem'}}>
            Configure your Strava/Parkrun connection once in Settings. Ongoing sync is automatic.
          </div>
        </Card.Body>
      </Card>

      <Row className="g-3 mb-3">
        {visibleSportCards.map((card) => (
          <Col key={card.sport} xs={12} md={6} xl={4}>
            <Card className="h-100">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <h6 className="mb-0">{card.label}</h6>
                  <Badge bg={card.sport === 'run' ? 'primary' : card.sport === 'swim' ? 'success' : 'warning'}>
                    {card.sport.toUpperCase()}
                  </Badge>
                </div>
                <div className="small d-flex flex-column gap-1">
                  <div><strong>Distance YTD:</strong> {card.ytdKm.toFixed(1)} km</div>
                  <div>
                    <strong>This month:</strong> {card.monthKm.toFixed(1)} km
                    {trendArrow(card.monthDeltaKm, false)}
                    <span className="text-muted ms-1">({formatSignedKmDelta(card.monthDeltaKm)})</span>
                  </div>
                  <div>
                    <strong>Last 7 days:</strong> {card.weekKm.toFixed(1)} km
                    {trendArrow(card.weekDeltaKm, false)}
                    <span className="text-muted ms-1">({formatSignedKmDelta(card.weekDeltaKm)})</span>
                  </div>
                  {card.predictions.map((prediction) => (
                    <div key={`${card.sport}-${prediction.label}`}>
                      <strong>{prediction.label}:</strong> {prediction.display || '—'}
                      {trendArrow(prediction.deltaSec, true)}
                      <span className="text-muted ms-1">
                        ({formatSignedSecDelta(prediction.deltaSec)})
                      </span>
                    </div>
                  ))}
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Card className="mb-3">
        <Card.Header>
          <strong>Overall Distance Groups</strong>
        </Card.Header>
        <Card.Body style={{ height: '32vh', minHeight: 260 }}>
          <Line data={overallDistanceChartData as any} options={overallDistanceChartOptions as any} />
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Body style={{ height: '40vh', minHeight: 320 }}>
          <Line data={chartData as any} options={chartOptions as any} />
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <strong>Recent Workouts</strong>
        </Card.Header>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>Date</th>
                <th>Provider</th>
                <th>Sport</th>
                <th>Event/Name</th>
                <th>Distance (km)</th>
                <th>Time</th>
                <th>{sportMode === 'swim' ? 'Pace (min/100m)' : sportMode === 'bike' ? 'Speed (km/h)' : 'Pace (min/km)'}</th>
                <th>Avg HR</th>
                <th>RPE</th>
                <th>Pos</th>
                <th>Partic.</th>
                <th>Percentile</th>
                <th>Fitness Inputs</th>
                <th>Links</th>
                <th>Z1 {zoneDisplayMode === 'percent' ? '(%)' : '(min)'}</th>
                <th>Z2 {zoneDisplayMode === 'percent' ? '(%)' : '(min)'}</th>
                <th>Z3 {zoneDisplayMode === 'percent' ? '(%)' : '(min)'}</th>
                <th>Z4 {zoneDisplayMode === 'percent' ? '(%)' : '(min)'}</th>
                <th>Z5 {zoneDisplayMode === 'percent' ? '(%)' : '(min)'}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(w => {
                const date = w.startDate ? new Date(w.startDate) : (w.utcStartDate ? new Date(w.utcStartDate) : null);
                const workoutSport = getWorkoutSport(w);
                const pace = sportMode === 'swim'
                  ? paceMinPer100m(w)
                  : sportMode === 'bike'
                    ? speedKmh(w)
                    : paceMinPerKm(w);
                const hasZoneData = !!w.hrZones;
                const z1s = w.hrZones ? Number(w.hrZones.z1Time_s || 0) : 0;
                const z2s = w.hrZones ? Number(w.hrZones.z2Time_s || 0) : 0;
                const z3s = w.hrZones ? Number(w.hrZones.z3Time_s || 0) : 0;
                const z4s = w.hrZones ? Number(w.hrZones.z4Time_s || 0) : 0;
                const z5s = w.hrZones ? Number(w.hrZones.z5Time_s || 0) : 0;
                const zTotal = z1s + z2s + z3s + z4s + z5s;
                const zoneCell = (sec: number) => {
                  if (!hasZoneData) return '-';
                  if (zoneDisplayMode === 'percent') {
                    return zTotal > 0 ? `${((sec / zTotal) * 100).toFixed(1)}%` : '0.0%';
                  }
                  return (sec / 60).toFixed(1);
                };
                const explicitRpe = readWorkoutRpe(w);
                const derivedRpe = explicitRpe == null ? deriveRpeFromSuffer(w) : null;
                const stravaUrl = stravaActivityUrl(w);
                const parkrunUrl = w.provider === 'parkrun' ? parkrunResultUrl(w) : null;
                const fitnessInputs = [
                  (Number(w.distance_m || 0) > 0) ? 'distance' : null,
                  (Number(w.movingTime_s || w.elapsedTime_s || 0) > 0) ? 'time' : null,
                  (w.avgHeartrate != null) ? 'avgHR' : null,
                  (w.hrZones ? 'zones' : null),
                  (w.perceivedExertion != null) ? 'RPE' : null,
                ].filter(Boolean).join(', ');
                return (
                  <tr key={w.id}>
                    <td>{date ? date.toLocaleDateString() : ''}</td>
                    <td>
                      <Badge bg={w.provider==='parkrun' ? 'success' : 'primary'}>{w.provider}</Badge>
                    </td>
                    <td>{workoutSport}</td>
                    <td>
                      {w.provider==='parkrun' ? (w.event || w.name || '-') : (w.name || w.event || '-')}
                    </td>
                    <td>{((w.distance_m||0)/1000).toFixed(2)}</td>
                    <td>{fmtTime(w.movingTime_s ?? w.elapsedTime_s)}</td>
                    <td>{pace ? pace.toFixed(2) : '-'}</td>
                    <td>{w.avgHeartrate ?? '-'}</td>
                    <td>{explicitRpe != null ? explicitRpe.toFixed(1) : (derivedRpe != null ? `~${derivedRpe.toFixed(1)}` : '-')}</td>
                    <td>{w.position ?? '-'}</td>
                    <td>{w.participantsCount ?? '-'}</td>
                    <td>{w.percentileTop != null ? `${w.percentileTop}%` : '-'}</td>
                    <td>{fitnessInputs || '-'}</td>
                    <td>
                      {(stravaUrl || parkrunUrl) ? (
                        <div className="d-flex flex-wrap gap-2">
                          {stravaUrl && (
                            <a href={stravaUrl} target="_blank" rel="noreferrer">
                              Strava
                            </a>
                          )}
                          {parkrunUrl && (
                            <a href={parkrunUrl} target="_blank" rel="noreferrer">
                              Parkrun
                            </a>
                          )}
                        </div>
                      ) : '-'}
                    </td>
                    <td>{zoneCell(z1s)}</td>
                    <td>{zoneCell(z2s)}</td>
                    <td>{zoneCell(z3s)}</td>
                    <td>{zoneCell(z4s)}</td>
                    <td>{zoneCell(z5s)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default WorkoutsDashboard;
