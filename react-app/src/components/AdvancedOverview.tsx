import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Row, Col, ProgressBar, Badge, Tab, Tabs, Alert, Button } from 'react-bootstrap';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  LineChart,
  Line,
  AreaChart,
  Area,
  Legend,
  CartesianGrid,
} from 'recharts';
import { Activity, Target, Zap, TrendingUp, DollarSign, Calendar, CheckCircle, Heart } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useTheme } from '../contexts/ThemeContext';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { PremiumCard } from './common/PremiumCard';

const toDate = (value: any): Date | null => {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const formatCurrency = (pence: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format((pence || 0) / 100);

const AdvancedOverview: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const navigate = useNavigate();

  const [key, setKey] = useState('summary');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<any | null>(null);
  const [finance, setFinance] = useState<any | null>(null);
  const [capacity, setCapacity] = useState<any | null>(null);
  const [velocityData, setVelocityData] = useState<any[]>([]);
  const [velocityLoading, setVelocityLoading] = useState(false);
  const [velocityError, setVelocityError] = useState('');
  const budgetRef = useRef<HTMLDivElement | null>(null);
  const capacityRef = useRef<HTMLDivElement | null>(null);
  const financeRef = useRef<HTMLDivElement | null>(null);

  const colors = {
    bg: isDark ? '#1e1e2f' : '#f4f5f7',
    text: isDark ? '#ffffff' : '#2c3e50',
    textMuted: isDark ? '#9a9a9a' : '#6c757d',
    primary: '#e14eca',
    secondary: '#00f2c3',
    warning: '#ff8d72',
    info: '#1d8cf8',
    success: '#00f2c3',
    danger: '#fd5d93',
    grid: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
    chartColors: ['#e14eca', '#00f2c3', '#1d8cf8', '#ff8d72', '#fd5d93', '#a78bfa'],
  };
  const velocityPlanColor = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(30,41,59,0.15)';

  const isStoryDone = (status: any) => {
    if (typeof status === 'number') return status >= 4;
    const str = String(status || '').toLowerCase();
    return ['done', 'complete', 'completed', 'closed', 'archived'].some((s) => str.includes(s));
  };

  const loadData = async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const previewFn = httpsCallable(functions, 'previewDailySummary');
      const financeFn = httpsCallable(functions, 'fetchDashboardData');

      const [summaryRes, financeRes] = await Promise.all([
        previewFn({}),
        financeFn({ startDate: start.toISOString(), endDate: end.toISOString() }),
      ]);

      const summaryData = (summaryRes.data as any)?.summary || (summaryRes.data as any)?.result || (summaryRes.data as any);
      const financeData = (financeRes.data as any)?.data || (financeRes.data as any);
      setSummary(summaryData);
      setFinance(financeData);

      if (summaryData?.sprintProgress?.sprintId) {
        try {
          const capacityFn = httpsCallable(functions, 'calculateSprintCapacity');
          const capRes = await capacityFn({ sprintId: summaryData.sprintProgress.sprintId });
          setCapacity(capRes.data);
        } catch (capErr) {
          console.warn('capacity fetch failed', capErr);
        }
      } else {
        setCapacity(null);
      }
    } catch (e: any) {
      console.error(e);
      setError(e?.message || 'Failed to load overview');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (!currentUser) return;
    loadData();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setVelocityData([]);
      return;
    }
    let cancelled = false;
    const loadVelocity = async () => {
      setVelocityLoading(true);
      setVelocityError('');
      try {
        const sprintSnap = await getDocs(
          query(
            collection(db, 'sprints'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('endDate', 'desc'),
            limit(8)
          )
        );
        const sprintsAll = sprintSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any)
        }));
        if (!sprintsAll.length) {
          if (!cancelled) setVelocityData([]);
          return;
        }
        const sprints = sprintsAll;
        const sprintIds = sprints.map((s) => s.id);
        if (!sprintIds.length) {
          if (!cancelled) setVelocityData([]);
          return;
        }
        const storySnap = await getDocs(
          query(
            collection(db, 'stories'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            where('sprintId', 'in', sprintIds)
          )
        );
        const bySprint = new Map<string, { completedPoints: number; totalPoints: number; completedStories: number; totalStories: number }>();
        sprintIds.forEach((id) => {
          bySprint.set(id, { completedPoints: 0, totalPoints: 0, completedStories: 0, totalStories: 0 });
        });
        storySnap.docs.forEach((docSnap) => {
          const data = docSnap.data() as any;
          const sprintId = data.sprintId;
          if (!sprintId || !bySprint.has(sprintId)) return;
          const points = Number(data.points || 0) || 0;
          const row = bySprint.get(sprintId)!;
          row.totalPoints += points;
          row.totalStories += 1;
          if (isStoryDone(data.status)) {
            row.completedPoints += points;
            row.completedStories += 1;
          }
        });
        const data = [...sprints]
          .reverse()
          .map((s) => {
            const row = bySprint.get(s.id) || { completedPoints: 0, totalPoints: 0, completedStories: 0, totalStories: 0 };
            return {
              sprint: s.name || s.ref || `Sprint ${String(s.id).slice(0, 4)}`,
              completedPoints: row.completedPoints,
              totalPoints: row.totalPoints,
              completedStories: row.completedStories,
              totalStories: row.totalStories
            };
          });
        if (!cancelled) setVelocityData(data);
      } catch (err) {
        console.warn('Failed to load sprint velocity', err);
        if (!cancelled) {
          setVelocityError('Unable to load sprint velocity.');
          setVelocityData([]);
        }
      } finally {
        if (!cancelled) setVelocityLoading(false);
      }
    };
    loadVelocity();
    return () => {
      cancelled = true;
    };
  }, [currentUser, currentPersona]);

  const handleRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const goalCompletion = summary?.goalProgress?.percentComplete ?? 0;
  const goalsTotal = summary?.goalProgress?.total ?? 0;
  const goalsDone = summary?.goalProgress?.completed ?? 0;

  const sprintPercent = summary?.sprintProgress?.percentComplete ?? 0;
  const sprintName = summary?.sprintProgress?.sprintName || 'No active sprint';
  const sprintCompleted = summary?.sprintProgress?.completedStories ?? 0;
  const sprintTotal = summary?.sprintProgress?.totalStories ?? 0;
  const sprintDaysLeft = useMemo(() => {
    const end = summary?.sprintProgress?.endDate;
    const endDate = end ? toDate(end) : null;
    if (!endDate) return null;
    return Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }, [summary]);

  const capacitySummary = {
    total: capacity?.totalCapacityHours ?? 0,
    allocated: capacity?.allocatedHours ?? 0,
    free: capacity?.freeCapacityHours ?? 0,
    utilization: capacity?.utilization ? Math.min(150, Math.round(capacity.utilization * 100)) : 0,
    scheduled: capacity?.scheduledHours ?? 0,
  };

  const spendByBucketData = useMemo(() => {
    return Object.entries(finance?.spendByBucket || {})
      .filter(([key]) => key !== 'bank_transfer' && key !== 'unknown')
      .map(([key, value]) => ({ name: key, value: Math.abs(value as number) / 100 }))
      .sort((a, b) => b.value - a.value);
  }, [finance]);

  const burnDownData = useMemo(() => {
    return (finance?.burnDown || []).map((d: any) => ({
      day: d.day,
      ideal: (d.ideal || 0) / 100,
      actual: d.actual != null ? (d.actual / 100) : null,
    }));
  }, [finance]);

  const goalTitleLookup = useMemo(() => {
    const map = new Map<string, string>();
    (summary?.goalProgress?.goals || []).forEach((g: any) => {
      if (g.id) map.set(g.id, g.title || g.goalTitle || g.id);
    });
    return map;
  }, [summary]);

  const goalBreakdown = useMemo(() => {
    const entries = Object.entries(capacity?.breakdownByGoal || {});
    return entries
      .map(([goalId, values]: [string, any]) => ({
        name: goalTitleLookup.get(goalId) || goalId || 'Goal',
        allocated: Number(values?.allocated || 0),
        utilized: Number(values?.utilized || 0),
      }))
      .sort((a, b) => b.allocated - a.allocated)
      .slice(0, 6);
  }, [capacity, goalTitleLookup]);

  const themeBreakdown = useMemo(() => {
    const entries = Object.entries(capacity?.scheduledByTheme || capacity?.breakdownByTheme || {});
    return entries
      .map(([theme, hours]: [string, any]) => ({ theme, hours: Number(hours || 0) }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 6);
  }, [capacity]);

  const hrvTrend = useMemo(() => {
    const hrv = summary?.fitness?.hrv;
    if (!hrv) return [];
    const points = [];
    if (hrv.last30Avg) points.push({ label: '30d avg', value: hrv.last30Avg });
    if (hrv.last7Avg) points.push({ label: '7d avg', value: hrv.last7Avg });
    if (hrv.trendPct != null) points.push({ label: 'Trend', value: hrv.trendPct });
    return points;
  }, [summary]);

  const categoryTrend = useMemo(() => {
    if (!finance?.timeSeriesByCategory) return [];
    const totals = Object.entries(finance?.spendByCategory || {});
    const topKeys = totals
      .sort((a, b) => Math.abs((b[1] as number)) - Math.abs((a[1] as number)))
      .slice(0, 4)
      .map(([key]) => key);
    const monthSet = new Set<string>();
    topKeys.forEach((k) => {
      (finance.timeSeriesByCategory?.[k] || []).forEach((row: any) => monthSet.add(row.month));
    });
    const months = Array.from(monthSet).sort();
    return months.map((month) => {
      const row: any = { month };
      topKeys.forEach((k) => {
        const entry = (finance.timeSeriesByCategory?.[k] || []).find((r: any) => r.month === month);
        row[k] = entry ? Math.abs(entry.amount || 0) / 100 : 0;
      });
      return row;
    });
  }, [finance]);

  const financeAlerts = summary?.financeAlerts || [];
  const monzoUpdated = summary?.monzo?.updatedAt ? toDate(summary.monzo.updatedAt) : null;
  const discretionarySpend = finance?.totalDiscretionarySpend ? Math.abs(finance.totalDiscretionarySpend) / 100 : null;
  const subscriptionSpend = finance?.totalSubscriptionSpend ? Math.abs(finance.totalSubscriptionSpend) / 100 : null;
  const totalSpend = Math.abs(finance?.totalSpend || 0) / 100;
  const fitnessScore = summary?.fitness?.fitnessScore || null;
  const lastWorkout = summary?.fitness?.lastWorkout || null;
  const topTheme = themeBreakdown[0];
  const topGoal = goalBreakdown[0];

  const openTab = (nextKey: string, ref?: React.RefObject<HTMLDivElement>) => {
    setKey(nextKey);
    if (ref?.current) {
      setTimeout(() => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    }
  };

  if (!currentUser) return <Alert variant="warning" className="m-3">Sign in to view metrics.</Alert>;
  if (loading && !summary) return <div className="p-5 text-center" style={{ color: colors.text }}>Loading Metrics...</div>;

  return (
    <div style={{ backgroundColor: colors.bg, minHeight: '100vh', padding: '2rem', transition: 'background-color 0.3s' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fw-bold mb-0" style={{ color: colors.text }}>Metrics</h2>
          <p className="text-muted mb-0">
            Snapshot powered by Firestore + Functions. Monzo last updated: {monzoUpdated ? monzoUpdated.toLocaleString() : 'unknown'}.
          </p>
        </div>
        <div className="d-flex gap-2 align-items-center">
          <Badge bg="secondary" className="d-flex align-items-center gap-2 px-3 py-2">
            <CheckCircle size={16} /> Goals {Math.round(goalCompletion)}%
          </Badge>
          <Badge bg="info" text="dark" className="d-flex align-items-center gap-2 px-3 py-2">
            <Activity size={16} /> Capacity {capacitySummary.utilization}%
          </Badge>
          <Button size="sm" variant="outline-secondary" onClick={handleRefresh} disabled={loading || refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh data'}
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger" className="mb-3">{error}</Alert>}

      <Tabs
        id="metrics-tabs"
        activeKey={key}
        onSelect={(k) => setKey(k || 'summary')}
        className="mb-4 custom-tabs"
        style={{ borderBottomColor: colors.grid }}
      >
        <Tab eventKey="summary" title="Summary">
          <Row className="g-4 mb-4">
            <Col md={4} xl={2}>
              <button
                type="button"
                className="btn p-0 text-start w-100"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => navigate('/sprints/capacity')}
                aria-label="Open sprint metrics"
              >
                <PremiumCard title="Sprint Metrics" icon={Zap}>
                  <h3 className="fw-bold mb-1" style={{ color: colors.warning }}>{Math.round(sprintPercent)}%</h3>
                  <small className="text-muted d-block mb-2">
                    {sprintName} • {sprintCompleted}/{sprintTotal} stories{typeof sprintDaysLeft === 'number' ? ` • ${sprintDaysLeft} days left` : ''}
                  </small>
                  <ProgressBar now={sprintPercent} variant="warning" style={{ height: '6px', backgroundColor: colors.grid }} />
                </PremiumCard>
              </button>
            </Col>
            <Col md={4} xl={2}>
              <button
                type="button"
                className="btn p-0 text-start w-100"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => openTab('capacity', capacityRef)}
                aria-label="Open capacity metrics"
              >
                <PremiumCard title="Capacity" icon={Calendar}>
                  <h3 className="fw-bold mb-1" style={{ color: colors.success }}>{capacitySummary.free.toFixed(1)}h free</h3>
                  <small className="text-muted d-block mb-1">Allocated {capacitySummary.allocated.toFixed(1)}h / {capacitySummary.total.toFixed(1)}h</small>
                  <small className="text-muted d-block mb-2">Utilization {capacitySummary.utilization}%</small>
                  <ProgressBar now={capacitySummary.utilization} variant="success" style={{ height: '6px', backgroundColor: colors.grid }} />
                </PremiumCard>
              </button>
            </Col>
            <Col md={4} xl={2}>
              <button
                type="button"
                className="btn p-0 text-start w-100"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => openTab('summary', budgetRef)}
                aria-label="Open budget charts"
              >
                <PremiumCard title="Budget Burn" icon={DollarSign}>
                  <h3 className="fw-bold mb-1" style={{ color: colors.info }}>{formatCurrency(totalSpend)}</h3>
                  <small className="text-muted d-block mb-2">
                    Discretionary {discretionarySpend ? formatCurrency(discretionarySpend * 100) : '—'} • Subscriptions {subscriptionSpend ? formatCurrency(subscriptionSpend * 100) : '—'}
                  </small>
                  <ProgressBar now={Math.min(100, totalSpend ? (discretionarySpend ? (discretionarySpend / totalSpend) * 100 : 0) : 0)} variant="info" style={{ height: '6px', backgroundColor: colors.grid }} />
                </PremiumCard>
              </button>
            </Col>
            <Col md={4} xl={2}>
              <button
                type="button"
                className="btn p-0 text-start w-100"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => navigate('/metrics/progress')}
                aria-label="Open progress by goal"
              >
                <PremiumCard title="Goal Progress" icon={Target}>
                  <h3 className="fw-bold mb-1" style={{ color: colors.primary }}>{goalsDone}/{goalsTotal || '—'}</h3>
                  <small className="text-muted d-block mb-2">Completion {Math.round(goalCompletion)}%</small>
                  <ProgressBar now={goalCompletion} variant="primary" style={{ height: '6px', backgroundColor: colors.grid }} />
                </PremiumCard>
              </button>
            </Col>
            <Col md={4} xl={2}>
              <button
                type="button"
                className="btn p-0 text-start w-100"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => navigate('/metrics/progress')}
                aria-label="Open progress by theme"
              >
                <PremiumCard title="Theme Progress" icon={Activity}>
                  <h3 className="fw-bold mb-1" style={{ color: colors.secondary }}>
                    {topTheme?.hours ? `${topTheme.hours.toFixed(1)}h` : '—'}
                  </h3>
                  <small className="text-muted d-block mb-2">
                    Top theme {topTheme?.theme || '—'} · {themeBreakdown.length} themes
                  </small>
                  <div className="text-muted small">
                    {topGoal ? `Top goal: ${topGoal.name}` : 'Open progress view'}
                  </div>
                </PremiumCard>
              </button>
            </Col>
            <Col md={4} xl={2}>
              <button
                type="button"
                className="btn p-0 text-start w-100"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => openTab('finance', financeRef)}
                aria-label="Open finance metrics"
              >
                <PremiumCard title="Finance" icon={DollarSign}>
                  <h3 className="fw-bold mb-1" style={{ color: colors.info }}>{formatCurrency(totalSpend)}</h3>
                  <small className="text-muted d-block mb-2">Spend tracking & category trends</small>
                  <div className="text-muted small">
                    {spendByBucketData[0]?.name ? `Top bucket: ${spendByBucketData[0].name}` : 'Open finance charts'}
                  </div>
                </PremiumCard>
              </button>
            </Col>
          </Row>

          <div ref={budgetRef} />
          <Row className="g-4 mb-4">
            <Col md={6}>
              <PremiumCard title="Spend by Bucket" icon={DollarSign} height={320}>
                {spendByBucketData.length === 0 ? (
                  <div className="text-muted small">No spend data in this window.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={spendByBucketData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={4}>
                        {spendByBucketData.map((entry, idx) => (
                          <Cell key={entry.name} fill={colors.chartColors[idx % colors.chartColors.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(val: number) => formatCurrency(val * 100)} contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
            <Col md={6}>
              <PremiumCard title="Budget Burn-down" icon={TrendingUp} height={320}>
                {burnDownData.length === 0 ? (
                  <div className="text-muted small">No burn-down for this month.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={burnDownData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="day" stroke={colors.textMuted} />
                      <YAxis stroke={colors.textMuted} tickFormatter={(v) => `£${v}`} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Legend />
                      <Line type="monotone" dataKey="ideal" name="Ideal" stroke={colors.textMuted} strokeDasharray="5 5" />
                      <Line type="monotone" dataKey="actual" name="Actual" stroke={colors.primary} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
          </Row>

          <Row className="g-4 mb-4">
            <Col md={12}>
              <PremiumCard title="Sprint Velocity (last 8 sprints)" icon={Zap} height={280}>
                {velocityLoading && (
                  <div className="text-muted small">Loading sprint velocity…</div>
                )}
                {!velocityLoading && velocityError && (
                  <div className="text-danger small">{velocityError}</div>
                )}
                {!velocityLoading && !velocityError && velocityData.length === 0 && (
                  <div className="text-muted small">No sprint history available.</div>
                )}
                {!velocityLoading && !velocityError && velocityData.length > 0 && (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={velocityData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="sprint" stroke={colors.textMuted} tick={{ fontSize: 12 }} />
                      <YAxis stroke={colors.textMuted} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Legend />
                      <Bar dataKey="totalPoints" name="Planned pts" fill={velocityPlanColor} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="completedPoints" name="Completed pts" fill={colors.success} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
          </Row>

          <Row className="g-4">
            <Col md={6}>
              <PremiumCard title="Capacity Allocation" icon={Calendar} height={320}>
                {goalBreakdown.length === 0 ? (
                  <div className="text-muted small">No capacity data yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={goalBreakdown} margin={{ left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="name" stroke={colors.textMuted} tick={{ fontSize: 12 }} />
                      <YAxis stroke={colors.textMuted} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Legend />
                      <Bar dataKey="allocated" name="Allocated (h)" fill={colors.info} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="utilized" name="Utilised (h)" fill={colors.success} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
            <Col md={6}>
              <PremiumCard title="Recovery & HRV" icon={Heart} height={320}>
                {hrvTrend.length === 0 ? (
                  <div className="text-muted small">Connect a fitness source to see HRV.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hrvTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="label" stroke={colors.textMuted} />
                      <YAxis stroke={colors.textMuted} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Line type="monotone" dataKey="value" stroke={colors.danger} strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                )}
                <div className="mt-3 small text-muted">
                  {fitnessScore ? <>Fitness score {fitnessScore}. </> : null}
                  {lastWorkout ? <>Last session: {lastWorkout.title || lastWorkout.name || 'Workout'} ({lastWorkout.provider || '—'})</> : null}
                </div>
              </PremiumCard>
            </Col>
          </Row>

          {financeAlerts.length > 0 && (
            <Alert variant="warning" className="mt-4 mb-0">
              <strong>Finance alerts:</strong> {financeAlerts.join('; ')}
            </Alert>
          )}
        </Tab>

        <Tab eventKey="finance" title="Finance">
          <div ref={financeRef} />
          <Row className="g-4 mb-4">
            <Col md={6}>
              <PremiumCard title="Category Momentum" icon={TrendingUp} height={340}>
                {categoryTrend.length === 0 ? (
                  <div className="text-muted small">No classified spend trend yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={categoryTrend} stackOffset="expand">
                      <defs>
                        <linearGradient id="wealthA" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={colors.primary} stopOpacity={0.8} />
                          <stop offset="95%" stopColor={colors.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="month" stroke={colors.textMuted} />
                      <YAxis stroke={colors.textMuted} tickFormatter={(v) => `£${v}`} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Legend />
                      {Object.keys(categoryTrend[0] || {}).filter((k) => k !== 'month').map((key, idx) => (
                        <Area
                          key={key}
                          type="monotone"
                          dataKey={key}
                          stackId="1"
                          stroke={colors.chartColors[idx % colors.chartColors.length]}
                          fill={colors.chartColors[idx % colors.chartColors.length]}
                          fillOpacity={0.35}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
            <Col md={6}>
              <PremiumCard title="Top Buckets" icon={DollarSign} height={340}>
                {spendByBucketData.length === 0 ? (
                  <div className="text-muted small">No spend buckets available.</div>
                ) : (
                  <ul className="list-unstyled mb-0 small">
                    {spendByBucketData.slice(0, 6).map((bucket, idx) => (
                      <li key={bucket.name} className="d-flex justify-content-between align-items-center py-1">
                        <span className="d-flex align-items-center gap-2">
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 4, backgroundColor: colors.chartColors[idx % colors.chartColors.length] }} />
                          {bucket.name}
                        </span>
                        <span className="fw-semibold">{formatCurrency(bucket.value * 100)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </PremiumCard>
            </Col>
          </Row>
        </Tab>

        <Tab eventKey="capacity" title="Capacity">
          <div ref={capacityRef} />
          <Row className="g-4 mb-4">
            <Col md={6}>
              <PremiumCard title="Goal Allocation" icon={Target} height={360}>
                {goalBreakdown.length === 0 ? (
                  <div className="text-muted small">No capacity by goal yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={goalBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="name" stroke={colors.textMuted} tick={{ fontSize: 12 }} />
                      <YAxis stroke={colors.textMuted} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Legend />
                      <Bar dataKey="allocated" name="Allocated (h)" fill={colors.info} radius={[4, 4, 0, 0]} />
                      <Bar dataKey="utilized" name="Utilised (h)" fill={colors.success} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
            <Col md={6}>
              <PremiumCard title="Theme Distribution" icon={Activity} height={360}>
                {themeBreakdown.length === 0 ? (
                  <div className="text-muted small">No themed hours yet.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={themeBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="theme" stroke={colors.textMuted} tick={{ fontSize: 12 }} />
                      <YAxis stroke={colors.textMuted} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Bar dataKey="hours" name="Hours" fill={colors.primary} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
          </Row>
        </Tab>

        <Tab eventKey="health" title="Health">
          <Row className="g-4 mb-4">
            <Col md={6}>
              <PremiumCard title="HRV & Recovery" icon={Heart} height={340}>
                {hrvTrend.length === 0 ? (
                  <div className="text-muted small">Connect fitness data to populate HRV.</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={hrvTrend}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
                      <XAxis dataKey="label" stroke={colors.textMuted} />
                      <YAxis stroke={colors.textMuted} />
                      <Tooltip contentStyle={{ backgroundColor: colors.bg, border: 'none', color: colors.text, borderRadius: '8px' }} />
                      <Line type="monotone" dataKey="value" stroke={colors.danger} strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </PremiumCard>
            </Col>
            <Col md={6}>
              <PremiumCard title="Latest Session" icon={CheckCircle} height={340}>
                {lastWorkout ? (
                  <div className="small">
                    <div className="fw-semibold mb-1">{lastWorkout.title || lastWorkout.name || 'Workout'}</div>
                    <div className="text-muted mb-2">{lastWorkout.provider || '—'} · {lastWorkout.startDate || lastWorkout.startTime || ''}</div>
                    <div className="d-flex flex-wrap gap-2">
                      {lastWorkout.distance_m ? <Badge bg="secondary">Distance {(lastWorkout.distance_m / 1000).toFixed(1)} km</Badge> : null}
                      {lastWorkout.duration_s ? <Badge bg="secondary">Duration {(lastWorkout.duration_s / 60).toFixed(0)} min</Badge> : null}
                    </div>
                  </div>
                ) : (
                  <div className="text-muted small">No workouts logged yet.</div>
                )}
              </PremiumCard>
            </Col>
          </Row>
        </Tab>
      </Tabs>
    </div>
  );
};

export default AdvancedOverview;
