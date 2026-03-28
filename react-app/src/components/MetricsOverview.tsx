/**
 * MetricsOverview — unified HabitDash-style dashboard
 *
 * Aggregates recovery, activity, fitness, work-progress, and finance
 * metrics into a single scrollable page with sparkline cards.
 *
 * Data sources:
 *   profiles/{uid}        — today's HealthKit snapshot (steps, sleep, workout mins)
 *   metrics_hrv           — daily HRV readings (last 30 days)
 *   metrics_workouts      — Strava/parkrun workouts (last 90 days)
 *   goals + stories       — theme rings + sprint velocity
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col, Badge } from 'react-bootstrap';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
} from 'recharts';
import {
  Activity,
  Heart,
  Moon,
  Footprints,
  Flame,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
  Target,
  Bike,
  Waves,
  Timer,
  DollarSign,
} from 'lucide-react';
import { collection, doc, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { useTheme } from '../contexts/ThemeContext';
import { GLOBAL_THEMES } from '../constants/globalThemes';

// ─── helpers ────────────────────────────────────────────────────────────────

function toMs(v: any): number {
  if (!v) return 0;
  if (typeof v === 'number') return v;
  if (v?.toMillis) return v.toMillis();
  if (v?.seconds) return v.seconds * 1000;
  const p = new Date(v);
  return isNaN(p.getTime()) ? 0 : p.getTime();
}

function num(src: any, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = Number(src?.[k]);
    if (isFinite(n)) return n;
  }
  return null;
}

function fmtKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`;
}

function fmtHours(h: number) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}h` : `${hh}h ${mm}m`;
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function trendIcon(data: number[], className = '') {
  if (data.length < 3) return <Minus size={14} className={`text-muted ${className}`} />;
  const recent = data.slice(-3).reduce((a, b) => a + b, 0) / 3;
  const prev = data.slice(-6, -3).reduce((a, b) => a + b, 0) / Math.max(data.slice(-6, -3).length, 1);
  const pct = prev === 0 ? 0 : ((recent - prev) / prev) * 100;
  if (pct > 3) return <TrendingUp size={14} className={`text-success ${className}`} />;
  if (pct < -3) return <TrendingDown size={14} className={`text-danger ${className}`} />;
  return <Minus size={14} className={`text-muted ${className}`} />;
}

const RANGE_OPTIONS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
] as const;
type RangeKey = typeof RANGE_OPTIONS[number]['days'];

// ─── MetricCard ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  icon: React.ReactNode;
  title: string;
  value: string | number | null;
  unit?: string;
  subtitle?: string;
  trend?: number[];       // sparkline data
  trendColor?: string;
  badge?: { text: string; variant: string };
  isDark: boolean;
  action?: React.ReactNode;
  fullWidth?: boolean;
}

const MetricCard: React.FC<MetricCardProps> = ({
  icon, title, value, unit, subtitle, trend, trendColor = '#3b82f6', badge, isDark, action, fullWidth,
}) => {
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 12,
        padding: '16px 18px',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: trendColor }}>{icon}</span>
          <span style={{ fontSize: 11, fontWeight: 600, color: muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {badge && (
            <Badge bg={badge.variant} style={{ fontSize: 10 }}>{badge.text}</Badge>
          )}
          {action}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f1f5f9' : '#1e293b', lineHeight: 1 }}>
          {value ?? '—'}
        </span>
        {unit && (
          <span style={{ fontSize: 13, color: muted, fontWeight: 500 }}>{unit}</span>
        )}
        {trend && trend.length > 1 && trendIcon(trend)}
      </div>

      {subtitle && (
        <div style={{ fontSize: 12, color: muted }}>{subtitle}</div>
      )}

      {trend && trend.length > 2 && (
        <div style={{ marginTop: 4, flex: 1, minHeight: 40 }}>
          <ResponsiveContainer width="100%" height={40}>
            <AreaChart data={trend.map((v, i) => ({ i, v }))} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${title.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="v"
                stroke={trendColor}
                strokeWidth={2}
                fill={`url(#grad-${title.replace(/\s/g, '')})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

// ─── SportCard ───────────────────────────────────────────────────────────────

interface SportCardProps {
  icon: React.ReactNode;
  sport: string;
  ytdM: number;
  rangeM: number;
  rangeLabel: string;
  weekM: number;
  color: string;
  barData: Array<{ label: string; km: number }>;
  isDark: boolean;
}

const SportCard: React.FC<SportCardProps> = ({
  icon, sport, ytdM, rangeM, rangeLabel, weekM, color, barData, isDark,
}) => {
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ color }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: isDark ? '#f1f5f9' : '#1e293b' }}>{sport}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: muted }}>YTD</span>
        <span style={{ fontSize: 18, fontWeight: 700, color }}>{fmtKm(ytdM)}</span>
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase' }}>{rangeLabel}</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>{fmtKm(rangeM)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: muted, textTransform: 'uppercase' }}>This week</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b' }}>{fmtKm(weekM)}</div>
        </div>
      </div>
      {barData.length > 1 && (
        <ResponsiveContainer width="100%" height={52}>
          <BarChart data={barData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Bar dataKey="km" fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Tooltip
              contentStyle={{ background: bg, border: `1px solid ${border}`, borderRadius: 6, fontSize: 11 }}
              formatter={(v: number) => [`${v.toFixed(1)} km`, sport]}
              labelFormatter={(l) => l}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
};

// ─── ThemeRing ───────────────────────────────────────────────────────────────

interface ThemeRingProps {
  theme: { id: number; label: string; emoji: string; color: string };
  progressPct: number;
  isDark: boolean;
}

const ThemeRing: React.FC<ThemeRingProps> = ({ theme, progressPct, isDark }) => {
  const clamped = Math.min(100, Math.max(0, progressPct));
  const bg = isDark ? '#1e2433' : '#ffffff';
  const border = isDark ? '#2d3748' : '#e2e8f0';
  const muted = isDark ? '#9ca3af' : '#6b7280';

  const data = [
    { value: clamped },
    { value: Math.max(0, 100 - clamped) },
  ];

  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, borderRadius: 12,
      padding: '12px 10px', textAlign: 'center', height: '100%',
    }}>
      <div style={{ fontSize: 18, marginBottom: 4 }}>{theme.emoji}</div>
      <ResponsiveContainer width="100%" height={64}>
        <PieChart>
          <Pie
            data={data}
            cx="50%" cy="50%"
            innerRadius={24} outerRadius={32}
            startAngle={90} endAngle={-270}
            dataKey="value"
            strokeWidth={0}
            isAnimationActive={false}
          >
            <Cell fill={theme.color} />
            <Cell fill={isDark ? '#374151' : '#e5e7eb'} />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 16, fontWeight: 700, color: theme.color, marginTop: -4 }}>
        {Math.round(clamped)}%
      </div>
      <div style={{ fontSize: 10, color: muted, fontWeight: 600, textTransform: 'uppercase' }}>
        {theme.label}
      </div>
    </div>
  );
};

// ─── Main component ──────────────────────────────────────────────────────────

const MetricsOverview: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId, sprints: allSprints } = useSprint();
  const currentSprint = allSprints.find(s => s.id === selectedSprintId) ?? null;
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [rangeDays, setRangeDays] = useState<RangeKey>(30);

  // Raw data
  const [profile, setProfile] = useState<any>(null);
  const [hrvReadings, setHrvReadings] = useState<Array<{ date: string; value: number }>>([]);
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [stories, setStories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const uid = currentUser?.uid;

  // ── Firestore subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    if (!uid) return;
    const unsub = onSnapshot(doc(db, 'profiles', uid), (snap) => {
      setProfile(snap.exists() ? snap.data() : null);
      setLoading(false);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const q = query(
      collection(db, 'metrics_hrv'),
      where('ownerUid', '==', uid),
      where('date', '>=', cutoffStr),
      orderBy('date', 'asc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      setHrvReadings(
        snap.docs.map((d) => ({ date: d.data().date as string, value: Number(d.data().value ?? d.data().rMSSD ?? d.data().hrv) }))
          .filter((r) => isFinite(r.value) && r.value > 0)
      );
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    const cutoff = Date.now() - 90 * 86_400_000;
    const q = query(
      collection(db, 'metrics_workouts'),
      where('ownerUid', '==', uid),
      orderBy('startDate', 'desc'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((w: any) => (Number(w.startDate) || 0) >= cutoff);
      setWorkouts(docs);
    });
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid || !currentPersona) return;
    const q = query(collection(db, 'goals'), where('ownerUid', '==', uid), where('persona', '==', currentPersona));
    const unsub = onSnapshot(q, (snap) => setGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [uid, currentPersona]);

  useEffect(() => {
    if (!uid || !currentPersona) return;
    const q = query(collection(db, 'stories'), where('ownerUid', '==', uid), where('persona', '==', currentPersona));
    const unsub = onSnapshot(q, (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return unsub;
  }, [uid, currentPersona]);

  // ── Derived metrics ────────────────────────────────────────────────────────

  const rangeMs = rangeDays * 86_400_000;
  const now = Date.now();
  const cutoffMs = now - rangeMs;

  // Today's health snapshot from profiles
  const stepsToday = num(profile, 'healthkitStepsToday', 'manualStepsToday');
  const workoutMinsToday = num(profile, 'healthkitWorkoutMinutesToday', 'manualWorkoutMinutesToday');
  const caloriesToday = num(profile, 'healthkitCaloriesTodayKcal', 'manualCaloriesKcal');
  const sleepMinsLast = num(profile, 'healthkitSleepMinutes', 'manualSleepMinutes');
  const deepSleepMins  = profile ? (profile['healthkitDeepSleepMinutes'] ?? null) as number | null : null;
  const remSleepMins   = profile ? (profile['healthkitRemSleepMinutes']  ?? null) as number | null : null;
  const coreSleepMins  = profile ? (profile['healthkitCoreSleepMinutes'] ?? null) as number | null : null;
  const bodyFatPct = num(profile, 'healthkitBodyFatPct', 'manualBodyFatPct');

  // HRV
  const hrvInRange = useMemo(() =>
    hrvReadings.filter(r => Date.parse(r.date + 'T00:00:00') >= cutoffMs),
    [hrvReadings, cutoffMs]
  );
  const avgHrv = useMemo(() => {
    if (hrvInRange.length === 0) return null;
    return Math.round(hrvInRange.reduce((s, r) => s + r.value, 0) / hrvInRange.length);
  }, [hrvInRange]);
  const latestHrv = hrvInRange.length > 0 ? Math.round(hrvInRange[hrvInRange.length - 1].value) : null;

  // Build weekly HRV bar chart (last 14 days grouped by week)
  const hrvSparkline = useMemo(() =>
    hrvReadings.slice(-30).map(r => r.value),
    [hrvReadings]
  );

  // Workouts in selected range
  const workoutsInRange = useMemo(() =>
    workouts.filter(w => (Number(w.startDate) || 0) >= cutoffMs),
    [workouts, cutoffMs]
  );

  function sportDistM(sport: 'run' | 'swim' | 'bike', ws: any[]): number {
    return ws.filter(w => {
      if (w.provider === 'parkrun' || w.run === true) return sport === 'run';
      const t = String(w.type || w.sportType || '').toLowerCase();
      if (sport === 'swim') return t.includes('swim');
      if (sport === 'bike') return t.includes('ride') || t.includes('bike') || t.includes('cycling');
      return t.includes('run') || t.includes('walk') || t.includes('hike');
    }).reduce((s, w) => s + (Number(w.distance_m) || 0), 0);
  }

  const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
  const ytdWorkouts = useMemo(() => workouts.filter(w => (Number(w.startDate) || 0) >= ytdStart), [workouts, ytdStart]);
  const weekMs = now - 7 * 86_400_000;
  const weekWorkouts = useMemo(() => workouts.filter(w => (Number(w.startDate) || 0) >= weekMs), [workouts, weekMs]);

  function buildBarData(sport: 'run' | 'swim' | 'bike') {
    // Group into weeks for the selected range
    const weeks = Math.ceil(rangeDays / 7);
    return Array.from({ length: weeks }, (_, i) => {
      const wStart = now - (weeks - i) * 7 * 86_400_000;
      const wEnd = wStart + 7 * 86_400_000;
      const ws = workouts.filter(w => {
        const ms = Number(w.startDate) || 0;
        return ms >= wStart && ms < wEnd;
      });
      const label = new Date(wStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      return { label, km: sportDistM(sport, ws) / 1000 };
    });
  }

  // Sprint velocity
  const sprintStories = useMemo(() => {
    if (!currentSprint?.id) return [];
    return stories.filter(s => s.sprintId === currentSprint.id);
  }, [stories, currentSprint]);

  const sprintDonePoints = sprintStories.filter(s => Number(s.status) >= 4).reduce((a, s) => a + (Number(s.points) || 0), 0);
  const sprintTotalPoints = sprintStories.reduce((a, s) => a + (Number(s.points) || 0), 0);
  const sprintVelocityPct = sprintTotalPoints === 0 ? 0 : Math.round((sprintDonePoints / sprintTotalPoints) * 100);

  // Theme progress rings
  const themeProgress = useMemo(() => {
    const themeIds = [1, 2, 3, 4, 5];
    return themeIds.map(tid => {
      const themeGoals = goals.filter(g => g.theme === tid || Number(g.theme) === tid);
      if (themeGoals.length === 0) return { id: tid, pct: 0 };
      const themeStories = stories.filter(s => themeGoals.some(g => g.id === s.goalId));
      const total = themeStories.reduce((a, s) => a + (Number(s.points) || 1), 0);
      const done = themeStories.filter(s => Number(s.status) >= 4).reduce((a, s) => a + (Number(s.points) || 1), 0);
      return { id: tid, pct: total === 0 ? 0 : Math.round((done / total) * 100) };
    });
  }, [goals, stories]);

  // ── UI ─────────────────────────────────────────────────────────────────────

  const panelBg = isDark ? '#131824' : '#f8fafc';
  const sectionLabel = isDark ? '#e2e8f0' : '#1e293b';

  const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{
      fontSize: 13, fontWeight: 700, color: sectionLabel,
      textTransform: 'uppercase', letterSpacing: '0.06em',
      marginBottom: 12, marginTop: 4,
      display: 'flex', alignItems: 'center', gap: 8,
    }}>
      {children}
    </div>
  );

  const THEME_META = [
    { id: 1, label: 'Health',  emoji: '💪', color: '#10b981' },
    { id: 2, label: 'Growth',  emoji: '📈', color: '#3b82f6' },
    { id: 3, label: 'Wealth',  emoji: '💰', color: '#f59e0b' },
    { id: 4, label: 'Tribe',   emoji: '🤝', color: '#8b5cf6' },
    { id: 5, label: 'Home',    emoji: '🏡', color: '#ef4444' },
  ];

  if (loading) {
    return (
      <div style={{ padding: 32, color: isDark ? '#9ca3af' : '#6b7280', textAlign: 'center' }}>
        Loading metrics…
      </div>
    );
  }

  return (
    <div style={{ background: panelBg, minHeight: '100vh', padding: '20px 16px 40px' }}>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20, flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: sectionLabel, margin: 0 }}>
            Metrics
          </h1>
          <div style={{ fontSize: 12, color: isDark ? '#6b7280' : '#9ca3af', marginTop: 2 }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {RANGE_OPTIONS.map(opt => (
            <button
              key={opt.days}
              onClick={() => setRangeDays(opt.days as RangeKey)}
              style={{
                padding: '5px 14px', borderRadius: 20, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600,
                background: rangeDays === opt.days ? '#3b82f6' : (isDark ? '#1e2433' : '#e2e8f0'),
                color: rangeDays === opt.days ? '#fff' : (isDark ? '#9ca3af' : '#64748b'),
                transition: 'background 0.15s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Recovery ───────────────────────────────────────────────────────── */}
      <SectionTitle><Heart size={14} />Recovery</SectionTitle>
      <Row className="g-3 mb-4">
        <Col xs={12} sm={6} lg={3}>
          <MetricCard
            icon={<Activity size={16} />}
            title="HRV"
            value={latestHrv ?? avgHrv}
            unit="ms"
            subtitle={avgHrv != null ? `${rangeDays}d avg: ${avgHrv} ms` : 'No data yet'}
            trend={hrvSparkline}
            trendColor="#10b981"
            isDark={isDark}
            badge={latestHrv && avgHrv
              ? latestHrv >= avgHrv
                ? { text: 'Above avg', variant: 'success' }
                : { text: 'Below avg', variant: 'warning' }
              : undefined}
          />
        </Col>
        <Col xs={12} sm={6} lg={3}>
          <MetricCard
            icon={<Moon size={16} />}
            title="Sleep"
            value={sleepMinsLast != null ? (sleepMinsLast / 60).toFixed(1) : null}
            unit="hrs last night"
            subtitle={(() => {
              if (sleepMinsLast == null) return 'No data yet';
              const parts: string[] = [];
              if (deepSleepMins != null) parts.push(`Deep ${Math.round(deepSleepMins)}m`);
              if (remSleepMins  != null) parts.push(`REM ${Math.round(remSleepMins)}m`);
              if (coreSleepMins != null) parts.push(`Core ${Math.round(coreSleepMins)}m`);
              return parts.length > 0 ? parts.join(' · ') : `${fmtHours(sleepMinsLast / 60)} — target 8h`;
            })()}
            trendColor="#8b5cf6"
            isDark={isDark}
            badge={sleepMinsLast != null
              ? sleepMinsLast >= 450
                ? { text: '✓ Good', variant: 'success' }
                : sleepMinsLast >= 360
                  ? { text: 'Adequate', variant: 'warning' }
                  : { text: 'Short', variant: 'danger' }
              : undefined}
          />
        </Col>
        <Col xs={12} sm={6} lg={3}>
          <MetricCard
            icon={<Zap size={16} />}
            title="Workout mins"
            value={workoutMinsToday != null ? Math.round(workoutMinsToday) : null}
            unit="mins today"
            subtitle="Active minutes from HealthKit"
            trendColor="#f59e0b"
            isDark={isDark}
          />
        </Col>
        <Col xs={12} sm={6} lg={3}>
          <MetricCard
            icon={<Flame size={16} />}
            title="Calories"
            value={caloriesToday != null ? Math.round(caloriesToday) : null}
            unit="kcal today"
            subtitle={bodyFatPct != null ? `Body fat: ${bodyFatPct.toFixed(1)}%` : 'Energy burned today'}
            trendColor="#ef4444"
            isDark={isDark}
          />
        </Col>
      </Row>

      {/* ── Activity ───────────────────────────────────────────────────────── */}
      <SectionTitle><Footprints size={14} />Activity</SectionTitle>
      <Row className="g-3 mb-4">
        <Col xs={12} sm={6} lg={4}>
          <MetricCard
            icon={<Footprints size={16} />}
            title="Steps"
            value={stepsToday != null ? Math.round(stepsToday).toLocaleString() : null}
            unit="today"
            subtitle="Target: 10,000 steps"
            trendColor="#3b82f6"
            isDark={isDark}
            badge={stepsToday != null
              ? stepsToday >= 10000
                ? { text: '✓ Goal hit', variant: 'success' }
                : { text: `${Math.round((stepsToday / 10000) * 100)}%`, variant: 'info' }
              : undefined}
          />
        </Col>
        <Col xs={12} lg={8}>
          {/* HRV trend chart */}
          {hrvReadings.length > 2 && (
            <div style={{
              background: isDark ? '#1e2433' : '#ffffff',
              border: `1px solid ${isDark ? '#2d3748' : '#e2e8f0'}`,
              borderRadius: 12, padding: '16px 18px', height: '100%',
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                HRV Trend — last {rangeDays} days
              </div>
              <ResponsiveContainer width="100%" height={80}>
                <LineChart
                  data={hrvInRange.map(r => ({ date: shortDate(r.date), v: r.value }))}
                  margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#2d3748' : '#f1f5f9'} vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: isDark ? '#6b7280' : '#9ca3af' }} tickLine={false} axisLine={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: isDark ? '#1e2433' : '#fff', border: `1px solid ${isDark ? '#2d3748' : '#e2e8f0'}`, borderRadius: 8, fontSize: 11 }}
                    formatter={(v: number) => [`${v} ms`, 'HRV']}
                  />
                  <Line type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Col>
      </Row>

      {/* ── Fitness ────────────────────────────────────────────────────────── */}
      <SectionTitle><Activity size={14} />Fitness — Run / Swim / Bike</SectionTitle>
      <Row className="g-3 mb-4">
        {([
          { sport: 'run' as const,  label: 'Running', icon: <Activity size={16} />, color: '#3b82f6' },
          { sport: 'swim' as const, label: 'Swimming', icon: <Waves size={16} />,   color: '#06b6d4' },
          { sport: 'bike' as const, label: 'Cycling',  icon: <Bike size={16} />,    color: '#f59e0b' },
        ] as const).map(({ sport, label, icon, color }) => (
          <Col xs={12} md={4} key={sport}>
            <SportCard
              icon={icon}
              sport={label}
              ytdM={sportDistM(sport, ytdWorkouts)}
              rangeM={sportDistM(sport, workoutsInRange)}
              rangeLabel={`Last ${rangeDays}d`}
              weekM={sportDistM(sport, weekWorkouts)}
              color={color}
              barData={buildBarData(sport)}
              isDark={isDark}
            />
          </Col>
        ))}
      </Row>

      {/* ── Work ───────────────────────────────────────────────────────────── */}
      <SectionTitle><Target size={14} />Work progress</SectionTitle>
      <Row className="g-3 mb-4">
        {/* Sprint velocity */}
        <Col xs={12} sm={6} lg={4}>
          <div style={{
            background: isDark ? '#1e2433' : '#ffffff',
            border: `1px solid ${isDark ? '#2d3748' : '#e2e8f0'}`,
            borderRadius: 12, padding: '16px 18px',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: isDark ? '#9ca3af' : '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              {currentSprint?.name ?? 'Current Sprint'} Velocity
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 10 }}>
              <span style={{ fontSize: 28, fontWeight: 700, color: isDark ? '#f1f5f9' : '#1e293b', lineHeight: 1 }}>
                {sprintDonePoints}
              </span>
              <span style={{ fontSize: 13, color: isDark ? '#9ca3af' : '#6b7280' }}>/ {sprintTotalPoints} pts</span>
            </div>
            <div style={{
              background: isDark ? '#2d3748' : '#e5e7eb',
              borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 6,
            }}>
              <div style={{
                height: '100%', borderRadius: 6, width: `${sprintVelocityPct}%`,
                background: sprintVelocityPct >= 80 ? '#10b981' : sprintVelocityPct >= 50 ? '#f59e0b' : '#ef4444',
                transition: 'width 0.3s ease',
              }} />
            </div>
            <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
              {sprintVelocityPct}% complete · {sprintStories.length} stories
            </div>
          </div>
        </Col>

        {/* Theme rings */}
        {THEME_META.map(t => {
          const data = themeProgress.find(p => p.id === t.id);
          return (
            <Col xs={4} sm={3} md={2} lg={true} key={t.id} style={{ minWidth: 100 }}>
              <ThemeRing theme={t} progressPct={data?.pct ?? 0} isDark={isDark} />
            </Col>
          );
        })}
      </Row>

      {/* ── Finance shortcut ───────────────────────────────────────────────── */}
      <SectionTitle><DollarSign size={14} />Finance</SectionTitle>
      <Row className="g-3 mb-4">
        <Col xs={12}>
          <div style={{
            background: isDark ? '#1e2433' : '#ffffff',
            border: `1px solid ${isDark ? '#2d3748' : '#e2e8f0'}`,
            borderRadius: 12, padding: '16px 18px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
            flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: isDark ? '#f1f5f9' : '#1e293b', marginBottom: 4 }}>
                Finance Dashboard
              </div>
              <div style={{ fontSize: 12, color: isDark ? '#9ca3af' : '#6b7280' }}>
                Transactions, budgets, pots and monthly spend analysis
              </div>
            </div>
            <a
              href="/finance/dashboard"
              style={{
                padding: '8px 18px', borderRadius: 8, background: '#3b82f6', color: '#fff',
                fontWeight: 600, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap',
              }}
            >
              Open Finance →
            </a>
          </div>
        </Col>
      </Row>

      {/* ── Links to detailed views ─────────────────────────────────────────── */}
      <Row className="g-3">
        {[
          { label: 'Fitness details', href: '/fitness', color: '#3b82f6' },
          { label: 'Theme progress', href: '/metrics/progress', color: '#10b981' },
          { label: 'Sprint capacity', href: '/sprints/capacity', color: '#f59e0b' },
          { label: 'Habit tracking', href: '/dashboard/habit-tracking', color: '#8b5cf6' },
        ].map(link => (
          <Col xs={6} md={3} key={link.href}>
            <a
              href={link.href}
              style={{
                display: 'block', padding: '12px 14px',
                background: isDark ? '#1e2433' : '#ffffff',
                border: `1px solid ${isDark ? '#2d3748' : '#e2e8f0'}`,
                borderLeft: `4px solid ${link.color}`,
                borderRadius: 10, textDecoration: 'none',
                fontSize: 13, fontWeight: 600,
                color: isDark ? '#e2e8f0' : '#374151',
              }}
            >
              {link.label} →
            </a>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default MetricsOverview;
