import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Row, Col, Badge, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, orderBy, limit, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { useLocation } from 'react-router-dom';
import { Line } from 'react-chartjs-2';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip as RechartsTooltip } from 'recharts';
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

interface HealthTrendPoint {
  dayKey: string;
  label: string;
  ms: number;
  weightKg: number | null;
  bodyFatPct: number | null;
  steps: number | null;
  caloriesKcal: number | null;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  readiness: number | null;
}

interface RecoveryTrendPoint {
  dayKey: string;
  label: string;
  ms: number;
  hrvMs: number | null;
  vo2Max: number | null;
}

interface ComplianceCardSummary {
  key: string;
  label: string;
  valueLabel: string;
  targetLabel: string;
  progressPct: number | null;
  tone: 'success' | 'warning' | 'secondary';
  labels: string[];
  series: Array<number | null>;
}

const CARDIO_FITNESS_METRIC_KEYS = [
  'healthkitVo2Max',
  'healthkitVO2Max',
  'healthkitCardioFitness',
  'vo2Max',
  'cardioFitness',
  'cardioFitnessVo2Max',
  'appleHealthCardioFitness',
  'appleHealthVo2Max',
];

const clampPercent = (value: number): number => Math.max(0, Math.min(999, Math.round(value)));

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

type ActivityCompositionKey =
  | 'run'
  | 'swim'
  | 'bike'
  | 'walk'
  | 'strength'
  | 'crossfit'
  | 'mobility'
  | 'other';

function getWorkoutSport(w: WorkoutDoc): SportMode | 'other' {
  if (w.provider === 'parkrun') return 'run';
  if (w.run === true) return 'run';
  const type = String(w.type || w.sportType || '').toLowerCase();
  if (type.includes('swim')) return 'swim';
  if (type.includes('ride') || type.includes('bike') || type.includes('cycling')) return 'bike';
  if (type.includes('run') || type.includes('walk') || type.includes('hike')) return 'run';
  return 'other';
}

function classifyWorkoutActivityType(w: WorkoutDoc): ActivityCompositionKey {
  if (w.provider === 'parkrun') return 'run';
  const haystack = `${String(w.type || '')} ${String(w.sportType || '')} ${String(w.title || '')} ${String(w.name || '')} ${String(w.event || '')}`.toLowerCase();
  if (haystack.includes('crossfit')) return 'crossfit';
  if (haystack.includes('strength') || haystack.includes('weights') || haystack.includes('resistance') || haystack.includes('gym')) return 'strength';
  if (haystack.includes('yoga') || haystack.includes('pilates') || haystack.includes('mobility') || haystack.includes('stretch')) return 'mobility';
  if (haystack.includes('swim')) return 'swim';
  if (haystack.includes('ride') || haystack.includes('bike') || haystack.includes('cycling')) return 'bike';
  if (haystack.includes('walk') || haystack.includes('hike')) return 'walk';
  if (haystack.includes('run')) return 'run';
  return getWorkoutSport(w);
}

function workoutMatchesSport(w: WorkoutDoc, sportMode: SportMode): boolean {
  return getWorkoutSport(w) === sportMode;
}

function readWorkoutRpe(w: WorkoutDoc): number | null {
  const raw = Number(w.perceivedExertion ?? w.rpe ?? w.stravaRpe ?? null);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.min(10, Math.max(1, raw));
}

function toMillis(value: any): number {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value?.seconds != null) return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function readNumericValue(source: any, ...keys: string[]): number | null {
  for (const key of keys) {
    const parsed = Number(source?.[key]);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function resolveMetricDateMs(metric: any): number {
  const rawDate = metric?.date;
  if (typeof rawDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const parsed = Date.parse(`${rawDate}T00:00:00`);
    if (Number.isFinite(parsed)) return parsed;
  }
  return toMillis(metric?.updatedAt) || toMillis(metric?.createdAt) || 0;
}

function resolveObservedMetricMs(metric: any): number {
  return Number(metric?.observedAt || 0) || toMillis(metric?.observedAt) || resolveMetricDateMs(metric);
}

function formatMetricLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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

function formatMinutesCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

function formatPercentCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value)}%`;
}

const ACTIVITY_COMPOSITION_COLORS: Record<ActivityCompositionKey, string> = {
  run: '#2563eb',
  swim: '#0f766e',
  bike: '#d97706',
  walk: '#16a34a',
  strength: '#7c3aed',
  crossfit: '#dc2626',
  mobility: '#0891b2',
  other: '#6b7280',
};

const ACTIVITY_COMPOSITION_LABELS: Record<ActivityCompositionKey, string> = {
  run: 'Run',
  swim: 'Swim',
  bike: 'Bike',
  walk: 'Walk / Hike',
  strength: 'Strength',
  crossfit: 'CrossFit',
  mobility: 'Mobility',
  other: 'Other',
};

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
  const [healthProfile, setHealthProfile] = useState<any | null>(null);
  const [healthMetrics, setHealthMetrics] = useState<any[]>([]);
  const [vo2Metrics, setVo2Metrics] = useState<any[]>([]);
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
    if (!currentUser) {
      setHealthProfile(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'profiles', currentUser.uid), (snap) => {
      const profile = snap.exists() ? snap.data() : null;
      setHealthProfile(profile);
      setExcludeWithDadFromMetrics(profile?.excludeWithDadFromMetrics !== false);
    }, () => setHealthProfile(null));
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setHealthMetrics([]);
      return;
    }
    const qRef = query(
      collection(db, 'metrics_hrv'),
      where('ownerUid', '==', currentUser.uid),
      limit(120)
    );
    const unsub = onSnapshot(qRef, (snap) => {
      setHealthMetrics(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    }, () => setHealthMetrics([]));
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setVo2Metrics([]);
      return;
    }
    const qRef = query(
      collection(db, 'metric_values'),
      where('ownerUid', '==', currentUser.uid),
      where('metricKey', 'in', CARDIO_FITNESS_METRIC_KEYS),
      limit(180)
    );
    const unsub = onSnapshot(qRef, (snap) => {
      setVo2Metrics(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
    }, () => setVo2Metrics([]));
    return () => unsub();
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

  const currentHealthSnapshot = useMemo(() => {
    if (!healthProfile) return null;
    return {
      sourceLabel: ['authorized', 'synced'].includes(String(healthProfile.healthkitStatus || '').toLowerCase()) ? 'HealthKit' : 'Manual',
      weightKg: readNumericValue(healthProfile, 'healthkitWeightKg', 'manualWeightKg'),
      bodyFatPct: readNumericValue(healthProfile, 'healthkitBodyFatPct', 'manualBodyFatPct'),
      vo2Max: readNumericValue(
        healthProfile,
        'healthkitVo2Max',
        'healthkitVO2Max',
        'healthkitCardioFitness',
        'vo2Max',
        'cardioFitness',
        'cardioFitnessVo2Max',
        'appleHealthCardioFitness',
        'appleHealthVo2Max',
      ),
      stepsToday: readNumericValue(healthProfile, 'healthkitStepsToday', 'manualStepsToday'),
      distanceKmToday: readNumericValue(healthProfile, 'healthkitDistanceKmToday', 'manualDistanceKmToday'),
      workoutMinutesToday: readNumericValue(healthProfile, 'healthkitWorkoutMinutesToday', 'manualWorkoutMinutesToday'),
      caloriesTodayKcal: readNumericValue(healthProfile, 'healthkitCaloriesTodayKcal', 'manualCaloriesKcal'),
      proteinTodayG: readNumericValue(healthProfile, 'healthkitProteinTodayG', 'manualProteinG'),
      fatTodayG: readNumericValue(healthProfile, 'healthkitFatTodayG', 'manualFatG'),
      carbsTodayG: readNumericValue(healthProfile, 'healthkitCarbsTodayG', 'manualCarbsG'),
      readinessScore: readNumericValue(healthProfile, 'healthkitReadinessScore'),
      targetWeightKg: readNumericValue(healthProfile, 'targetWeightKg', 'healthTargetWeightKg'),
      targetBodyFatPct: readNumericValue(healthProfile, 'targetBodyFatPct', 'healthTargetBodyFatPct', 'bodyFatTarget'),
      weeksToTargetBodyFat: readNumericValue(healthProfile, 'weeksToTargetBodyFat'),
    };
  }, [healthProfile]);

  const healthTrendRows = useMemo(() => {
    const latestByDay = new Map<string, { snapshotMs: number; row: HealthTrendPoint }>();
    for (const metric of healthMetrics) {
      const metricMs = resolveMetricDateMs(metric);
      if (!metricMs) continue;
      const dayKey = new Date(metricMs).toISOString().slice(0, 10);
      const snapshotMs = toMillis(metric.updatedAt) || toMillis(metric.createdAt) || metricMs;
      const row: HealthTrendPoint = {
        dayKey,
        label: formatMetricLabel(metricMs),
        ms: metricMs,
        weightKg: readNumericValue(metric, 'weightKg', 'healthkitWeightKg', 'manualWeightKg'),
        bodyFatPct: readNumericValue(metric, 'bodyFatPct', 'healthkitBodyFatPct', 'manualBodyFatPct'),
        steps: readNumericValue(metric, 'steps', 'healthkitStepsToday', 'manualStepsToday'),
        caloriesKcal: readNumericValue(metric, 'caloriesTodayKcal', 'healthkitCaloriesTodayKcal', 'manualCaloriesKcal'),
        proteinG: readNumericValue(metric, 'proteinTodayG', 'healthkitProteinTodayG', 'manualProteinG'),
        fatG: readNumericValue(metric, 'fatTodayG', 'healthkitFatTodayG', 'manualFatG'),
        carbsG: readNumericValue(metric, 'carbsTodayG', 'healthkitCarbsTodayG', 'manualCarbsG'),
        readiness: readNumericValue(metric, 'readinessScore', 'healthkitReadinessScore'),
      };
      const existing = latestByDay.get(dayKey);
      if (!existing || snapshotMs >= existing.snapshotMs) {
        latestByDay.set(dayKey, { snapshotMs, row });
      }
    }

    return Array.from(latestByDay.values())
      .map(({ row }) => row)
      .sort((a, b) => a.ms - b.ms)
      .slice(-30);
  }, [healthMetrics]);

  const activityTrendRows = useMemo(() => {
    const byDay = new Map<string, {
      dayKey: string;
      label: string;
      ms: number;
      steps: number | null;
      workoutMinutes: number;
      distanceKm: number;
    }>();

    for (const row of healthTrendRows) {
      byDay.set(row.dayKey, {
        dayKey: row.dayKey,
        label: row.label,
        ms: row.ms,
        steps: row.steps,
        workoutMinutes: 0,
        distanceKm: 0,
      });
    }

    for (const workout of workouts) {
      if (excludeWithDadFromMetrics && workoutHasDadMarker(workout)) continue;
      const startMs = resolveWorkoutStartMs(workout);
      if (!startMs) continue;
      const dayKey = new Date(startMs).toISOString().slice(0, 10);
      const current = byDay.get(dayKey) || {
        dayKey,
        label: formatMetricLabel(startMs),
        ms: startMs,
        steps: null,
        workoutMinutes: 0,
        distanceKm: 0,
      };
      current.workoutMinutes += Number(workout.movingTime_s ?? workout.elapsedTime_s ?? 0) / 60;
      current.distanceKm += Number(workout.distance_m || 0) / 1000;
      byDay.set(dayKey, current);
    }

    if (currentHealthSnapshot) {
      const todayMs = Date.now();
      const todayKey = new Date(todayMs).toISOString().slice(0, 10);
      const current = byDay.get(todayKey) || {
        dayKey: todayKey,
        label: formatMetricLabel(todayMs),
        ms: todayMs,
        steps: null,
        workoutMinutes: 0,
        distanceKm: 0,
      };
      if (currentHealthSnapshot.stepsToday != null) current.steps = currentHealthSnapshot.stepsToday;
      if (currentHealthSnapshot.workoutMinutesToday != null) current.workoutMinutes = Math.max(current.workoutMinutes, currentHealthSnapshot.workoutMinutesToday);
      if (currentHealthSnapshot.distanceKmToday != null) current.distanceKm = Math.max(current.distanceKm, currentHealthSnapshot.distanceKmToday);
      current.ms = Math.max(current.ms, todayMs);
      current.label = formatMetricLabel(current.ms);
      byDay.set(todayKey, current);
    }

    return Array.from(byDay.values())
      .sort((a, b) => a.ms - b.ms)
      .slice(-30);
  }, [healthTrendRows, workouts, excludeWithDadFromMetrics, currentHealthSnapshot]);

  const recoveryTrendRows = useMemo<RecoveryTrendPoint[]>(() => {
    const byDay = new Map<string, RecoveryTrendPoint>();

    for (const metric of healthMetrics) {
      const metricMs = resolveMetricDateMs(metric);
      if (!metricMs) continue;
      const dayKey = new Date(metricMs).toISOString().slice(0, 10);
      const hrvValue = readNumericValue(metric, 'value', 'rMSSD', 'hrv');
      const current = byDay.get(dayKey) || {
        dayKey,
        label: formatMetricLabel(metricMs),
        ms: metricMs,
        hrvMs: null,
        vo2Max: null,
      };
      if (hrvValue != null) current.hrvMs = hrvValue;
      current.ms = Math.max(current.ms, metricMs);
      current.label = formatMetricLabel(current.ms);
      byDay.set(dayKey, current);
    }

    for (const metric of vo2Metrics) {
      const metricMs = resolveObservedMetricMs(metric);
      if (!metricMs) continue;
      const dayKey = new Date(metricMs).toISOString().slice(0, 10);
      const vo2Value = readNumericValue(
        metric,
        'value',
        'vo2Max',
        'healthkitVo2Max',
        'healthkitVO2Max',
        'healthkitCardioFitness',
        'cardioFitness',
        'cardioFitnessVo2Max',
        'appleHealthCardioFitness',
        'appleHealthVo2Max',
      );
      if (vo2Value == null) continue;
      const current = byDay.get(dayKey) || {
        dayKey,
        label: formatMetricLabel(metricMs),
        ms: metricMs,
        hrvMs: null,
        vo2Max: null,
      };
      current.vo2Max = vo2Value;
      current.ms = Math.max(current.ms, metricMs);
      current.label = formatMetricLabel(current.ms);
      byDay.set(dayKey, current);
    }

    return Array.from(byDay.values())
      .sort((a, b) => a.ms - b.ms)
      .slice(-30);
  }, [healthMetrics, vo2Metrics]);

  const bodyCompositionChartData = useMemo(() => ({
    labels: healthTrendRows.map((row) => row.label),
    datasets: [
      {
        label: 'Weight (kg)',
        data: healthTrendRows.map((row) => row.weightKg),
        borderColor: '#0d6efd',
        backgroundColor: 'rgba(13, 110, 253, 0.15)',
        yAxisID: 'yWeight',
        spanGaps: true,
      },
      {
        label: 'Body fat %',
        data: healthTrendRows.map((row) => row.bodyFatPct),
        borderColor: '#dc3545',
        backgroundColor: 'rgba(220, 53, 69, 0.15)',
        yAxisID: 'yBodyFat',
        spanGaps: true,
      },
    ],
  }), [healthTrendRows]);

  const bodyCompositionChartOptions: any = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      yWeight: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Weight (kg)' },
      },
      yBodyFat: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Body fat %' },
        grid: { drawOnChartArea: false },
      },
    },
  }), []);

  const activityChartData = useMemo(() => ({
    labels: activityTrendRows.map((row) => row.label),
    datasets: [
      {
        label: 'Steps',
        data: activityTrendRows.map((row) => row.steps),
        borderColor: '#198754',
        backgroundColor: 'rgba(25, 135, 84, 0.12)',
        yAxisID: 'ySteps',
        spanGaps: true,
      },
      {
        label: 'Workout minutes',
        data: activityTrendRows.map((row) => Number(row.workoutMinutes.toFixed(1))),
        borderColor: '#fd7e14',
        backgroundColor: 'rgba(253, 126, 20, 0.12)',
        yAxisID: 'yActivity',
        spanGaps: true,
      },
      {
        label: 'Distance (km)',
        data: activityTrendRows.map((row) => Number(row.distanceKm.toFixed(2))),
        borderColor: '#6f42c1',
        backgroundColor: 'rgba(111, 66, 193, 0.12)',
        yAxisID: 'yActivity',
        spanGaps: true,
      },
    ],
  }), [activityTrendRows]);

  const activityChartOptions: any = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      ySteps: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Steps' },
      },
      yActivity: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Minutes / km' },
        grid: { drawOnChartArea: false },
      },
    },
  }), []);

  const recoveryChartData = useMemo(() => ({
    labels: recoveryTrendRows.map((row) => row.label),
    datasets: [
      {
        label: 'HRV (ms)',
        data: recoveryTrendRows.map((row) => row.hrvMs),
        borderColor: '#dc3545',
        backgroundColor: 'rgba(220, 53, 69, 0.12)',
        yAxisID: 'yHrv',
        spanGaps: true,
      },
      {
        label: 'Cardio Fitness (VO2 Max)',
        data: recoveryTrendRows.map((row) => row.vo2Max),
        borderColor: '#0d6efd',
        backgroundColor: 'rgba(13, 110, 253, 0.12)',
        yAxisID: 'yVo2',
        spanGaps: true,
      },
    ],
  }), [recoveryTrendRows]);

  const recoveryChartOptions: any = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      yHrv: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'HRV (ms)' },
      },
      yVo2: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Cardio Fitness' },
        grid: { drawOnChartArea: false },
      },
    },
  }), []);

  const nutritionChartData = useMemo(() => ({
    labels: healthTrendRows.map((row) => row.label),
    datasets: [
      {
        label: 'Protein (g)',
        data: healthTrendRows.map((row) => row.proteinG),
        borderColor: '#20c997',
        backgroundColor: 'rgba(32, 201, 151, 0.12)',
        yAxisID: 'yMacros',
        spanGaps: true,
      },
      {
        label: 'Fat (g)',
        data: healthTrendRows.map((row) => row.fatG),
        borderColor: '#ffc107',
        backgroundColor: 'rgba(255, 193, 7, 0.12)',
        yAxisID: 'yMacros',
        spanGaps: true,
      },
      {
        label: 'Carbs (g)',
        data: healthTrendRows.map((row) => row.carbsG),
        borderColor: '#6610f2',
        backgroundColor: 'rgba(102, 16, 242, 0.12)',
        yAxisID: 'yMacros',
        spanGaps: true,
      },
      {
        label: 'Calories',
        data: healthTrendRows.map((row) => row.caloriesKcal),
        borderColor: '#dc3545',
        backgroundColor: 'rgba(220, 53, 69, 0.12)',
        yAxisID: 'yCalories',
        spanGaps: true,
      },
    ],
  }), [healthTrendRows]);

  const nutritionChartOptions: any = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      yMacros: {
        type: 'linear',
        position: 'left',
        title: { display: true, text: 'Macros (g)' },
      },
      yCalories: {
        type: 'linear',
        position: 'right',
        title: { display: true, text: 'Calories' },
        grid: { drawOnChartArea: false },
      },
    },
  }), []);

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

  const workoutTargetModel = useMemo(() => {
    const explicitTargetMinutes = readNumericValue(
      healthProfile,
      'weeklyWorkoutTargetMinutes',
      'targetWorkoutMinutesPerWeek',
      'workoutTargetMinutesWeekly',
      'healthTargetWorkoutMinutesWeekly',
      'targetExerciseMinutesWeekly',
    );
    const awakeHoursPerDay = Math.max(0, readNumericValue(
      healthProfile,
      'awakeHoursPerDay',
      'targetAwakeHoursPerDay',
      'healthAwakeHoursPerDay',
    ) ?? 16);
    const workHoursPerDay = Math.max(0, readNumericValue(
      healthProfile,
      'workHoursPerDay',
      'targetWorkHoursPerDay',
      'healthWorkHoursPerDay',
    ) ?? 8);
    const workoutPctOfFreeTime = Math.max(1, readNumericValue(
      healthProfile,
      'targetWorkoutPctOfFreeTime',
      'weeklyWorkoutTargetPercent',
      'weeklyExerciseTimePercent',
      'trainingTimePercent',
    ) ?? 20);
    const discretionaryHoursPerWeek = Math.max(0, awakeHoursPerDay - workHoursPerDay) * 7;
    const derivedTargetMinutes = Math.round(discretionaryHoursPerWeek * (workoutPctOfFreeTime / 100) * 60);
    const hasDerivedConfig = readNumericValue(
      healthProfile,
      'awakeHoursPerDay',
      'targetAwakeHoursPerDay',
      'healthAwakeHoursPerDay',
      'workHoursPerDay',
      'targetWorkHoursPerDay',
      'healthWorkHoursPerDay',
      'targetWorkoutPctOfFreeTime',
      'weeklyWorkoutTargetPercent',
      'weeklyExerciseTimePercent',
      'trainingTimePercent',
    ) != null;
    const treatExplicitAsLegacyFallback = explicitTargetMinutes === 240 && !hasDerivedConfig;
    const usesDerivedTarget = explicitTargetMinutes == null || treatExplicitAsLegacyFallback;
    return {
      targetMinutes: usesDerivedTarget ? derivedTargetMinutes : Math.max(1, Math.round(explicitTargetMinutes)),
      awakeHoursPerDay,
      workHoursPerDay,
      workoutPctOfFreeTime,
      discretionaryHoursPerWeek,
      usesDerivedTarget,
    };
  }, [healthProfile]);

  const workoutTargetMinutesPerWeek = workoutTargetModel.targetMinutes;

  const workoutTimeSummary = useMemo(() => {
    const nowMs = Date.now();
    const weekStartMs = nowMs - (7 * 24 * 60 * 60 * 1000);
    const prevWeekStartMs = nowMs - (14 * 24 * 60 * 60 * 1000);
    let currentMinutes = 0;
    let previousMinutes = 0;
    const byActivity = new Map<ActivityCompositionKey, number>();

    workouts.forEach((workout) => {
      if (activeProviderFilter !== 'all' && workout.provider !== activeProviderFilter) return;
      if (excludeWithDadFromMetrics && workoutHasDadMarker(workout)) return;
      const startMs = resolveWorkoutStartMs(workout);
      if (!startMs) return;
      const minutes = Number(workout.movingTime_s ?? workout.elapsedTime_s ?? 0) / 60;
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      if (startMs >= weekStartMs && startMs <= nowMs) {
        currentMinutes += minutes;
        const key = classifyWorkoutActivityType(workout);
        byActivity.set(key, (byActivity.get(key) || 0) + minutes);
      } else if (startMs >= prevWeekStartMs && startMs < weekStartMs) {
        previousMinutes += minutes;
      }
    });

    const breakdown = Array.from(byActivity.entries())
      .map(([key, minutes]) => ({
        key,
        label: ACTIVITY_COMPOSITION_LABELS[key],
        minutes: Number(minutes.toFixed(1)),
      }))
      .sort((a, b) => b.minutes - a.minutes);

    const pct = workoutTargetMinutesPerWeek > 0
      ? Math.round((currentMinutes / workoutTargetMinutesPerWeek) * 100)
      : null;

    return {
      currentMinutes: Number(currentMinutes.toFixed(1)),
      previousMinutes: Number(previousMinutes.toFixed(1)),
      deltaMinutes: Number((currentMinutes - previousMinutes).toFixed(1)),
      progressPct: pct != null ? Math.max(0, Math.min(999, pct)) : null,
      breakdown,
    };
  }, [workouts, activeProviderFilter, excludeWithDadFromMetrics, workoutTargetMinutesPerWeek]);

  const healthTargets = useMemo(() => ({
    stepTarget: readNumericValue(
      healthProfile,
      'targetStepsPerDay',
      'dailyStepTarget',
      'healthTargetStepsPerDay',
      'stepTarget',
    ) ?? 10000,
    distanceTargetKm: readNumericValue(
      healthProfile,
      'targetDistanceKmPerDay',
      'dailyDistanceTargetKm',
      'healthTargetDistanceKmPerDay',
      'distanceTargetKm',
    ) ?? 5,
    workoutTargetMinutesPerDay: Math.max(1, Math.round(workoutTargetMinutesPerWeek / 7)),
    proteinTargetG: readNumericValue(healthProfile, 'targetProteinG', 'dailyProteinTargetG', 'healthTargetProteinG'),
    fatTargetG: readNumericValue(healthProfile, 'targetFatG', 'dailyFatTargetG', 'healthTargetFatG'),
    carbsTargetG: readNumericValue(healthProfile, 'targetCarbsG', 'dailyCarbsTargetG', 'healthTargetCarbsG'),
    caloriesTargetKcal: readNumericValue(healthProfile, 'targetCaloriesKcal', 'dailyCaloriesTargetKcal', 'healthTargetCaloriesKcal'),
  }), [healthProfile, workoutTargetMinutesPerWeek]);

  const complianceSparklineOptions: any = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (context: any) => {
            const value = Number(context.parsed?.y);
            return Number.isFinite(value) ? `${Math.round(value)}% of target` : 'No data';
          },
        },
      },
    },
    scales: {
      x: { display: false, grid: { display: false } },
      y: { display: false, grid: { display: false }, min: 0, max: 100 },
    },
    elements: {
      point: { radius: 0, hoverRadius: 3 },
      line: { tension: 0.35, borderWidth: 2 },
    },
  }), []);

  const complianceCards = useMemo<ComplianceCardSummary[]>(() => {
    const last7Activity = activityTrendRows.slice(-7);
    const last7Health = healthTrendRows.slice(-7);
    const toTone = (pct: number | null): ComplianceCardSummary['tone'] => (
      pct == null ? 'secondary' : pct >= 100 ? 'success' : pct >= 70 ? 'warning' : 'secondary'
    );
    const adherencePct = (actual: number | null, target: number | null): number | null => {
      if (actual == null || target == null || target <= 0) return null;
      return clampPercent((actual / target) * 100);
    };
    const macroTodayComponents = [
      adherencePct(currentHealthSnapshot?.proteinTodayG ?? null, healthTargets.proteinTargetG),
      adherencePct(currentHealthSnapshot?.fatTodayG ?? null, healthTargets.fatTargetG),
      adherencePct(currentHealthSnapshot?.carbsTodayG ?? null, healthTargets.carbsTargetG),
      adherencePct(currentHealthSnapshot?.caloriesTodayKcal ?? null, healthTargets.caloriesTargetKcal),
    ].filter((value): value is number => value != null);
    const macroTodayPct = macroTodayComponents.length
      ? Math.round(macroTodayComponents.reduce((sum, value) => sum + value, 0) / macroTodayComponents.length)
      : null;

    const macroSeries = last7Health.map((row) => {
      const parts = [
        adherencePct(row.proteinG, healthTargets.proteinTargetG),
        adherencePct(row.fatG, healthTargets.fatTargetG),
        adherencePct(row.carbsG, healthTargets.carbsTargetG),
        adherencePct(row.caloriesKcal, healthTargets.caloriesTargetKcal),
      ].filter((value): value is number => value != null);
      return parts.length ? Math.round(parts.reduce((sum, value) => sum + value, 0) / parts.length) : null;
    });

    return [
      {
        key: 'steps',
        label: 'Steps Compliance',
        valueLabel: currentHealthSnapshot?.stepsToday != null
          ? `${Math.round(currentHealthSnapshot.stepsToday).toLocaleString()} steps`
          : 'No steps today',
        targetLabel: `${healthTargets.stepTarget.toLocaleString()} target`,
        progressPct: currentHealthSnapshot?.stepsToday != null
          ? clampPercent((currentHealthSnapshot.stepsToday / healthTargets.stepTarget) * 100)
          : null,
        tone: toTone(currentHealthSnapshot?.stepsToday != null
          ? clampPercent((currentHealthSnapshot.stepsToday / healthTargets.stepTarget) * 100)
          : null),
        labels: last7Activity.map((row) => row.label),
        series: last7Activity.map((row) => row.steps != null ? clampPercent((row.steps / healthTargets.stepTarget) * 100) : null),
      },
      {
        key: 'distance',
        label: 'Distance Compliance',
        valueLabel: currentHealthSnapshot?.distanceKmToday != null
          ? `${currentHealthSnapshot.distanceKmToday.toFixed(1)} km`
          : 'No distance today',
        targetLabel: `${healthTargets.distanceTargetKm.toFixed(1)} km target`,
        progressPct: currentHealthSnapshot?.distanceKmToday != null
          ? clampPercent((currentHealthSnapshot.distanceKmToday / healthTargets.distanceTargetKm) * 100)
          : null,
        tone: toTone(currentHealthSnapshot?.distanceKmToday != null
          ? clampPercent((currentHealthSnapshot.distanceKmToday / healthTargets.distanceTargetKm) * 100)
          : null),
        labels: last7Activity.map((row) => row.label),
        series: last7Activity.map((row) => row.distanceKm > 0 ? clampPercent((row.distanceKm / healthTargets.distanceTargetKm) * 100) : 0),
      },
      {
        key: 'workout',
        label: 'Workout Compliance',
        valueLabel: currentHealthSnapshot?.workoutMinutesToday != null
          ? `${Math.round(currentHealthSnapshot.workoutMinutesToday)} min`
          : 'No workout today',
        targetLabel: `${healthTargets.workoutTargetMinutesPerDay} min/day target`,
        progressPct: currentHealthSnapshot?.workoutMinutesToday != null
          ? clampPercent((currentHealthSnapshot.workoutMinutesToday / healthTargets.workoutTargetMinutesPerDay) * 100)
          : null,
        tone: toTone(currentHealthSnapshot?.workoutMinutesToday != null
          ? clampPercent((currentHealthSnapshot.workoutMinutesToday / healthTargets.workoutTargetMinutesPerDay) * 100)
          : null),
        labels: last7Activity.map((row) => row.label),
        series: last7Activity.map((row) => row.workoutMinutes > 0 ? clampPercent((row.workoutMinutes / healthTargets.workoutTargetMinutesPerDay) * 100) : 0),
      },
      {
        key: 'macros',
        label: 'Macro Compliance',
        valueLabel: macroTodayPct != null ? `${macroTodayPct}% of plan` : 'No macro data today',
        targetLabel: 'Protein, fat, carbs, calories',
        progressPct: macroTodayPct,
        tone: toTone(macroTodayPct),
        labels: last7Health.map((row) => row.label),
        series: macroSeries,
      },
    ];
  }, [activityTrendRows, currentHealthSnapshot, healthTargets, healthTrendRows]);

  const activityComposition30d = useMemo(() => {
    const nowMs = Date.now();
    const startMs = nowMs - (30 * 24 * 60 * 60 * 1000);
    const byActivity = new Map<ActivityCompositionKey, { minutes: number; sessions: number }>();

    workouts.forEach((workout) => {
      if (activeProviderFilter !== 'all' && workout.provider !== activeProviderFilter) return;
      if (excludeWithDadFromMetrics && workoutHasDadMarker(workout)) return;
      const workoutStartMs = resolveWorkoutStartMs(workout);
      if (!workoutStartMs || workoutStartMs < startMs || workoutStartMs > nowMs) return;
      const minutes = Number(workout.movingTime_s ?? workout.elapsedTime_s ?? 0) / 60;
      if (!Number.isFinite(minutes) || minutes <= 0) return;
      const key = classifyWorkoutActivityType(workout);
      const current = byActivity.get(key) || { minutes: 0, sessions: 0 };
      current.minutes += minutes;
      current.sessions += 1;
      byActivity.set(key, current);
    });

    return Array.from(byActivity.entries())
      .map(([key, value]) => ({
        key,
        name: ACTIVITY_COMPOSITION_LABELS[key],
        value: Number(value.minutes.toFixed(1)),
        sessions: value.sessions,
        color: ACTIVITY_COMPOSITION_COLORS[key],
      }))
      .sort((a, b) => b.value - a.value);
  }, [workouts, activeProviderFilter, excludeWithDadFromMetrics]);

  const activityCompositionTotalMinutes = useMemo(
    () => activityComposition30d.reduce((sum, entry) => sum + entry.value, 0),
    [activityComposition30d]
  );

  const activityCompositionWithShare = useMemo(() => (
    activityComposition30d.map((entry) => ({
      ...entry,
      pct: activityCompositionTotalMinutes > 0 ? Math.round((entry.value / activityCompositionTotalMinutes) * 100) : 0,
    }))
  ), [activityComposition30d, activityCompositionTotalMinutes]);

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

      <Row className="g-3 mb-3">
        <Col xs={12} lg={5}>
          <Card className="h-100">
            <Card.Header className="py-2">
              <strong>Workout Time KPI</strong>
            </Card.Header>
            <Card.Body className="py-2">
              <div className="d-flex align-items-start justify-content-between gap-3 flex-wrap mb-3">
                <div>
                  <div className="text-muted small">Last 7 days</div>
                  <div className="fw-semibold" style={{ fontSize: '1.15rem', lineHeight: 1.2 }}>
                    {formatMinutesCompact(workoutTimeSummary.currentMinutes)} / {formatMinutesCompact(workoutTargetMinutesPerWeek)}
                  </div>
                  <div className="text-muted small">
                    {workoutTimeSummary.progressPct != null ? `${workoutTimeSummary.progressPct}% of target` : 'No target set'}
                    {' · '}
                    {workoutTimeSummary.deltaMinutes === 0
                      ? 'Flat vs previous week'
                      : `${workoutTimeSummary.deltaMinutes > 0 ? '+' : ''}${formatMinutesCompact(Math.abs(workoutTimeSummary.deltaMinutes))} vs previous week`}
                  </div>
                  <div className="text-muted small mt-1">
                    {workoutTargetModel.usesDerivedTarget
                      ? `${formatPercentCompact(workoutTargetModel.workoutPctOfFreeTime)} of ${formatMinutesCompact(workoutTargetModel.discretionaryHoursPerWeek * 60)} discretionary time/week`
                      : 'Explicit weekly workout target'}
                  </div>
                </div>
                <Badge bg={
                  (workoutTimeSummary.progressPct || 0) >= 100
                    ? 'success'
                    : (workoutTimeSummary.progressPct || 0) >= 70
                      ? 'warning'
                      : 'secondary'
                }>
                  {(workoutTimeSummary.progressPct || 0) >= 100 ? 'On target' : (workoutTimeSummary.progressPct || 0) >= 70 ? 'Building' : 'Below target'}
                </Badge>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: 'rgba(15, 23, 42, 0.08)',
                  overflow: 'hidden',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: `${Math.max(0, Math.min(100, workoutTimeSummary.progressPct || 0))}%`,
                    height: '100%',
                    background: (workoutTimeSummary.progressPct || 0) >= 100 ? '#198754' : (workoutTimeSummary.progressPct || 0) >= 70 ? '#fd7e14' : '#0d6efd',
                  }}
                />
              </div>
              <div className="d-flex flex-wrap gap-2">
                {workoutTimeSummary.breakdown.length === 0 ? (
                  <div className="text-muted small">No workout-time data recorded this week yet.</div>
                ) : (
                  workoutTimeSummary.breakdown.slice(0, 6).map((entry) => (
                    <Badge key={entry.key} bg="light" text="dark" pill>
                      {entry.label}: {formatMinutesCompact(entry.minutes)}
                    </Badge>
                  ))
                )}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col xs={12} lg={7}>
          <Card className="h-100">
            <Card.Header className="py-2">
              <strong>30-Day Training Composition</strong>
            </Card.Header>
            <Card.Body className="py-2">
              {activityCompositionWithShare.length === 0 ? (
                <div className="text-muted small">No recent workout composition data yet.</div>
              ) : (
                <Row className="g-3 align-items-center">
                  <Col xs={12} md={5} style={{ height: 210 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={activityCompositionWithShare}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={46}
                          outerRadius={76}
                          paddingAngle={3}
                          labelLine={false}
                          label={({ value, percent }: any) => {
                            const pct = Math.round((Number(percent) || 0) * 100);
                            if (pct < 9) return '';
                            return `${pct}% · ${formatMinutesCompact(Number(value))}`;
                          }}
                        >
                          {activityCompositionWithShare.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip formatter={(value: number, name: string, meta: any) => [`${formatMinutesCompact(value)} · ${meta?.payload?.pct || 0}%`, `${name}${meta?.payload?.sessions ? ` · ${meta.payload.sessions} sessions` : ''}`]} />
                      </PieChart>
                    </ResponsiveContainer>
                  </Col>
                  <Col xs={12} md={7}>
                    <div className="d-flex flex-column gap-2">
                      {activityCompositionWithShare.map((entry) => (
                        <div key={entry.key} className="d-flex align-items-center justify-content-between gap-2">
                          <div className="d-flex align-items-center gap-2">
                            <span style={{ width: 10, height: 10, borderRadius: 999, background: entry.color, display: 'inline-block' }} />
                            <span className="small fw-semibold">{entry.name}</span>
                          </div>
                          <div className="text-muted small">
                            {entry.pct}% · {formatMinutesCompact(entry.value)} · {entry.sessions} sessions
                          </div>
                        </div>
                      ))}
                    </div>
                  </Col>
                </Row>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mb-3">
        {complianceCards.map((card) => (
          <Col key={card.key} xs={12} md={6} xl={3}>
            <Card className="h-100">
              <Card.Body>
                <div className="d-flex align-items-start justify-content-between gap-3 mb-2">
                  <div>
                    <div className="text-muted small">{card.label}</div>
                    <div className="fw-semibold">{card.valueLabel}</div>
                    <div className="text-muted small">{card.targetLabel}</div>
                  </div>
                  <Badge bg={card.tone}>
                    {card.progressPct != null ? `${card.progressPct}%` : 'Pending'}
                  </Badge>
                </div>
                <div style={{ height: 54 }}>
                  {card.series.some((value) => value != null) ? (
                    <Line
                      data={{
                        labels: card.labels,
                        datasets: [{
                          data: card.series,
                          borderColor: card.tone === 'success' ? '#198754' : card.tone === 'warning' ? '#fd7e14' : '#0d6efd',
                          backgroundColor: 'transparent',
                          fill: false,
                          spanGaps: true,
                        }],
                      } as any}
                      options={complianceSparklineOptions}
                    />
                  ) : (
                    <div className="text-muted small">No recent data yet.</div>
                  )}
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      {(currentHealthSnapshot || healthTrendRows.length > 0 || activityTrendRows.length > 0) && (
        <>
          <Card className="mb-3">
            <Card.Header>
              <strong>Health Snapshot</strong>
            </Card.Header>
            <Card.Body>
              <div className="d-flex flex-wrap gap-3 small mb-2">
                <span><strong>Source:</strong> {currentHealthSnapshot?.sourceLabel || '—'}</span>
                <span><strong>Weight:</strong> {currentHealthSnapshot?.weightKg != null ? `${currentHealthSnapshot.weightKg.toFixed(1)} kg` : '—'}</span>
                <span><strong>Body Fat:</strong> {currentHealthSnapshot?.bodyFatPct != null ? `${currentHealthSnapshot.bodyFatPct.toFixed(1)}%` : '—'}</span>
                <span><strong>Cardio Fitness:</strong> {currentHealthSnapshot?.vo2Max != null ? currentHealthSnapshot.vo2Max.toFixed(1) : '—'}</span>
                <span><strong>Target:</strong> {currentHealthSnapshot?.targetWeightKg != null ? `${currentHealthSnapshot.targetWeightKg.toFixed(1)} kg` : '—'} / {currentHealthSnapshot?.targetBodyFatPct != null ? `${currentHealthSnapshot.targetBodyFatPct.toFixed(1)}%` : '—'}</span>
                <span><strong>Steps Today:</strong> {currentHealthSnapshot?.stepsToday != null ? Math.round(currentHealthSnapshot.stepsToday).toLocaleString() : '—'}</span>
                <span><strong>Workout Today:</strong> {currentHealthSnapshot?.workoutMinutesToday != null ? `${Math.round(currentHealthSnapshot.workoutMinutesToday)} min` : '—'}</span>
                <span><strong>Distance Today:</strong> {currentHealthSnapshot?.distanceKmToday != null ? `${currentHealthSnapshot.distanceKmToday.toFixed(2)} km` : '—'}</span>
                <span><strong>Macros:</strong> {currentHealthSnapshot?.proteinTodayG != null ? `P ${Math.round(currentHealthSnapshot.proteinTodayG)}g` : 'P —'} · {currentHealthSnapshot?.fatTodayG != null ? `F ${Math.round(currentHealthSnapshot.fatTodayG)}g` : 'F —'} · {currentHealthSnapshot?.carbsTodayG != null ? `C ${Math.round(currentHealthSnapshot.carbsTodayG)}g` : 'C —'}</span>
                <span><strong>Calories:</strong> {currentHealthSnapshot?.caloriesTodayKcal != null ? `${Math.round(currentHealthSnapshot.caloriesTodayKcal)} kcal` : '—'}</span>
                <span><strong>ETA:</strong> {currentHealthSnapshot?.weeksToTargetBodyFat != null ? `${Math.round(currentHealthSnapshot.weeksToTargetBodyFat)} weeks to body-fat target` : '—'}</span>
              </div>
              <div className="text-muted mt-1" style={{ fontSize: '0.8rem' }}>
                Workout target basis: {workoutTargetModel.usesDerivedTarget
                  ? `${workoutTargetModel.awakeHoursPerDay}h awake/day − ${workoutTargetModel.workHoursPerDay}h work/day = ${formatMinutesCompact(workoutTargetModel.discretionaryHoursPerWeek * 60)} discretionary time/week; target set to ${workoutTargetModel.workoutPctOfFreeTime}%`
                  : `${formatMinutesCompact(workoutTargetMinutesPerWeek)} explicit weekly target`}
              </div>
              <div className="text-muted" style={{ fontSize: '0.85rem' }}>
                Health trends combine profile targets, HealthKit/manual metrics, and workout history so the drill-down shows body composition, daily activity, and nutrition in one place.
              </div>
            </Card.Body>
          </Card>

          <Row className="g-3 mb-3">
            <Col xs={12} xl={6}>
              <Card className="h-100">
                <Card.Header>
                  <strong>Body Composition Trend</strong>
                </Card.Header>
                <Card.Body style={{ height: '32vh', minHeight: 260 }}>
                  {healthTrendRows.some((row) => row.weightKg != null || row.bodyFatPct != null) ? (
                    <Line data={bodyCompositionChartData as any} options={bodyCompositionChartOptions as any} />
                  ) : (
                    <div className="text-muted small">No body-composition trend data yet.</div>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} xl={6}>
              <Card className="h-100">
                <Card.Header>
                  <strong>Daily Activity Trend</strong>
                </Card.Header>
                <Card.Body style={{ height: '32vh', minHeight: 260 }}>
                  {activityTrendRows.some((row) => row.steps != null || row.workoutMinutes > 0 || row.distanceKm > 0) ? (
                    <Line data={activityChartData as any} options={activityChartOptions as any} />
                  ) : (
                    <div className="text-muted small">No activity trend data yet.</div>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} xl={6}>
              <Card className="h-100">
                <Card.Header>
                  <strong>Recovery + Cardio Fitness</strong>
                </Card.Header>
                <Card.Body style={{ height: '32vh', minHeight: 260 }}>
                  {recoveryTrendRows.some((row) => row.hrvMs != null || row.vo2Max != null) ? (
                    <Line data={recoveryChartData as any} options={recoveryChartOptions as any} />
                  ) : (
                    <div className="text-muted small">No HRV or Cardio Fitness trend data yet.</div>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col xs={12} xl={6}>
              <Card className="h-100">
                <Card.Header>
                  <strong>Nutrition Trend</strong>
                </Card.Header>
                <Card.Body style={{ height: '32vh', minHeight: 260 }}>
                  {healthTrendRows.some((row) => row.caloriesKcal != null || row.proteinG != null || row.fatG != null || row.carbsG != null) ? (
                    <Line data={nutritionChartData as any} options={nutritionChartOptions as any} />
                  ) : (
                    <div className="text-muted small">No nutrition trend data yet.</div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}

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
