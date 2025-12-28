import React, { useEffect, useMemo, useState } from 'react';
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
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
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
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [key, setKey] = useState('summary');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<any | null>(null);
  const [finance, setFinance] = useState<any | null>(null);
  const [capacity, setCapacity] = useState<any | null>(null);

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

  if (!currentUser) return <Alert variant="warning" className="m-3">Sign in to view the overview.</Alert>;
  if (loading && !summary) return <div className="p-5 text-center" style={{ color: colors.text }}>Loading Command Center...</div>;

  return (
    <div style={{ backgroundColor: colors.bg, minHeight: '100vh', padding: '2rem', transition: 'background-color 0.3s' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fw-bold mb-0" style={{ color: colors.text }}>Command Center</h2>
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
        id="command-center-tabs"
        activeKey={key}
        onSelect={(k) => setKey(k || 'summary')}
        className="mb-4 custom-tabs"
        style={{ borderBottomColor: colors.grid }}
      >
        <Tab eventKey="summary" title="Summary">
          <Row className="g-4 mb-4">
            <Col md={3}>
              <PremiumCard title="Sprint Status" icon={Zap}>
                <h3 className="fw-bold mb-1" style={{ color: colors.warning }}>{Math.round(sprintPercent)}%</h3>
                <small className="text-muted d-block mb-2">
                  {sprintName} • {sprintCompleted}/{sprintTotal} stories{typeof sprintDaysLeft === 'number' ? ` • ${sprintDaysLeft} days left` : ''}
                </small>
                <ProgressBar now={sprintPercent} variant="warning" style={{ height: '6px', backgroundColor: colors.grid }} />
              </PremiumCard>
            </Col>
            <Col md={3}>
              <PremiumCard title="Capacity" icon={Calendar}>
                <h3 className="fw-bold mb-1" style={{ color: colors.success }}>{capacitySummary.free.toFixed(1)}h free</h3>
                <small className="text-muted d-block mb-1">Allocated {capacitySummary.allocated.toFixed(1)}h / {capacitySummary.total.toFixed(1)}h</small>
                <small className="text-muted d-block mb-2">Scheduled {capacitySummary.scheduled.toFixed(1)}h this sprint</small>
                <ProgressBar now={capacitySummary.utilization} variant="success" style={{ height: '6px', backgroundColor: colors.grid }} />
              </PremiumCard>
            </Col>
            <Col md={3}>
              <PremiumCard title="Budget Burn" icon={DollarSign}>
                <h3 className="fw-bold mb-1" style={{ color: colors.info }}>{formatCurrency(totalSpend)}</h3>
                <small className="text-muted d-block mb-2">
                  Discretionary {discretionarySpend ? formatCurrency(discretionarySpend * 100) : '—'} • Subscriptions {subscriptionSpend ? formatCurrency(subscriptionSpend * 100) : '—'}
                </small>
                <ProgressBar now={Math.min(100, totalSpend ? (discretionarySpend ? (discretionarySpend / totalSpend) * 100 : 0) : 0)} variant="info" style={{ height: '6px', backgroundColor: colors.grid }} />
              </PremiumCard>
            </Col>
            <Col md={3}>
              <PremiumCard title="Goals" icon={Target}>
                <h3 className="fw-bold mb-1" style={{ color: colors.primary }}>{goalsDone}/{goalsTotal || '—'}</h3>
                <small className="text-muted d-block mb-2">Completion {Math.round(goalCompletion)}%</small>
                <ProgressBar now={goalCompletion} variant="primary" style={{ height: '6px', backgroundColor: colors.grid }} />
              </PremiumCard>
            </Col>
          </Row>

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

        <Tab eventKey="wealth" title="Wealth">
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
