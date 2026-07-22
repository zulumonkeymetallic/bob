import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Container, Card, Row, Col, Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { Bot, TrendingUp, PiggyBank, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useDashboardData } from '../../hooks/useDashboardData';
import ReactECharts from 'echarts-for-react';
import { Link } from 'react-router-dom';

const fmt = (pence: number) =>
  (pence / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 });

// SVG gauge — same visual pattern as AiCoachPage ReadinessGauge
const BudgetHealthGauge: React.FC<{ score: number; label: string }> = ({ score, label }) => {
  const r = 54;
  const cx = 70;
  const cy = 70;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(100, Math.max(0, score));
  const dash = (pct / 100) * circumference;
  const color = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
  return (
    <div className="d-flex flex-column align-items-center">
      <svg width={140} height={140} viewBox="0 0 140 140">
        <circle cx={cx} cy={cy} r={r} fill="none" style={{ stroke: 'var(--line)' }} strokeWidth={10} />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize={22} fontWeight="700">{Math.round(pct)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" style={{ fill: 'var(--muted)' }} fontSize={11}>{label}</text>
      </svg>
    </div>
  );
};

// Insights older than this trigger a silent background refresh even though the cached
// copy is shown immediately — keeps the page feeling instant without ever blocking on
// the LLM round-trip that generateFinanceActionInsights makes on every call.
const INSIGHTS_STALE_MS = 24 * 60 * 60 * 1000;

const FinanceCoachPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { data, loading: dataLoading } = useDashboardData();
  const [insights, setInsights] = useState<any[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsAt, setInsightsAt] = useState<Date | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertStatus, setConvertStatus] = useState<Record<string, string>>({});
  const hasLoadedCacheRef = useRef(false);

  const income = data?.totalIncome || 0;
  const spend = data?.totalSpend || 0;
  const savingsRate = income > 0 ? ((income - spend) / income) * 100 : 0;

  const budgets: Record<string, number> = (data as any)?.categoryBudgets || {};
  const spend30: Record<string, number> = (data as any)?.spendByCategory || {};
  const budgetRows = Object.entries(budgets)
    .filter(([, v]) => Number(v) > 0)
    .map(([key, budget]) => ({ key, budget: Number(budget), actual: Math.abs(Number(spend30[key] || 0)) }));
  const onBudgetCount = budgetRows.filter((r) => r.actual <= r.budget).length;
  const budgetScore = budgetRows.length > 0 ? Math.round((onBudgetCount / budgetRows.length) * 100) : 100;
  const overBudget = budgetRows.filter((r) => r.actual > r.budget);

  // color-mix against var(--card) instead of a fixed hex so the tint stays subtle in both
  // light and dark mode rather than a hardcoded near-black background looking wrong in light.
  const tint = (color: string) => `color-mix(in srgb, var(--card) 85%, ${color} 15%)`;
  const verdict = savingsRate >= 20 && overBudget.length === 0
    ? { label: 'Your finances are healthy', color: '#22c55e', bg: tint('#22c55e') }
    : savingsRate >= 10 || overBudget.length <= 2
    ? { label: 'Watch your discretionary spend', color: '#f59e0b', bg: tint('#f59e0b') }
    : { label: 'Budget alert — action needed', color: '#ef4444', bg: tint('#ef4444') };

  const topCategories = useMemo(() => {
    const byCategory = (data as any)?.spendByCategory || {};
    return Object.entries(byCategory)
      .map(([key, value]: [string, any]) => ({ name: key.replace(/_/g, ' '), value: Math.abs(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [data]);

  const subscriptions = useMemo(() => {
    const txns: any[] = data?.recentTransactions || [];
    const byMerchant: Record<string, { name: string; totalPence: number }> = {};
    txns.forEach((tx: any) => {
      if (!tx.isSubscription) return;
      const key = tx.merchantKey || tx.merchant || 'unknown';
      if (!byMerchant[key]) byMerchant[key] = { name: tx.merchant || key, totalPence: 0 };
      byMerchant[key].totalPence += Math.abs(Number(tx.amount || 0) * 100);
    });
    return Object.values(byMerchant).sort((a, b) => b.totalPence - a.totalPence).slice(0, 5);
  }, [data]);

  const barOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 100, right: 20, top: 10, bottom: 10 },
    xAxis: { type: 'value', axisLabel: { formatter: (v: number) => `£${(v / 100).toFixed(0)}` } },
    yAxis: { type: 'category', data: topCategories.map((c) => c.name).reverse() },
    series: [{ type: 'bar', data: topCategories.map((c) => c.value).reverse(), color: '#22c55e' }],
  };

  const refreshInsights = async () => {
    setInsightsLoading(true);
    setInsightsError(null);
    try {
      const fn = httpsCallable(functions, 'generateFinanceActionInsights');
      const res: any = await fn({});
      const actions = Array.isArray(res?.data?.actions) ? res.data.actions : [];
      setInsights(actions);
      setInsightsAt(new Date());
    } catch (err: any) {
      setInsightsError(err?.message || 'Failed to generate insights');
    } finally {
      setInsightsLoading(false);
    }
  };

  // Cache-first load: generateFinanceActionInsights always makes an LLM call, so the old
  // "click Refresh, wait" flow meant every page visit paid that latency before showing
  // anything. Read the persisted finance_action_insights doc instantly instead; only fall
  // back to a blocking compute when there's genuinely no cache yet, and silently refresh
  // in the background when the cache is stale.
  useEffect(() => {
    if (!currentUser?.uid || hasLoadedCacheRef.current) return;
    hasLoadedCacheRef.current = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'finance_action_insights', currentUser.uid));
        if (snap.exists()) {
          const cached = snap.data() as any;
          const actions = Array.isArray(cached.actions) ? cached.actions : [];
          const updatedAt: Date | null = cached.updatedAt?.toDate ? cached.updatedAt.toDate() : null;
          setInsights(actions);
          setInsightsAt(updatedAt);
          const isStale = !updatedAt || (Date.now() - updatedAt.getTime()) > INSIGHTS_STALE_MS;
          if (isStale) void refreshInsights();
          return;
        }
      } catch (err) {
        console.warn('[FinanceCoachPage] cached insights lookup failed', err);
      }
      void refreshInsights();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.uid]);

  const convertToStory = async (action: any) => {
    setConvertingId(action.id);
    try {
      const fn = httpsCallable(functions, 'convertFinanceActionToStory');
      const res: any = await fn({ actionId: action.id });
      const storyId = res?.data?.storyId;
      setConvertStatus((prev) => ({ ...prev, [action.id]: storyId ? `Logged as story` : 'Logged' }));
    } catch (err: any) {
      setConvertStatus((prev) => ({ ...prev, [action.id]: 'Failed' }));
    } finally {
      setConvertingId(null);
    }
  };

  if (dataLoading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" />
        <p className="mt-3 text-muted">Loading financial data…</p>
      </Container>
    );
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', padding: '24px 0' }}>
      <Container style={{ maxWidth: 720 }}>
        <div className="d-flex justify-content-between align-items-center mb-4" style={{ color: 'var(--text)' }}>
          <div>
            <h4 className="mb-1 d-flex align-items-center gap-2"><Bot size={20} /> AI Finance Coach</h4>
            <div className="small" style={{ color: 'var(--muted)' }}>Spending verdict + AI-powered action plan</div>
          </div>
          <Link to="/finance/dashboard" className="btn btn-sm btn-outline-secondary"><ExternalLink size={14} className="me-1" />Finance Hub</Link>
        </div>

        {/* Verdict banner */}
        <div
          className="rounded-3 p-3 mb-4 d-flex align-items-center justify-content-between"
          style={{ background: verdict.bg, border: `1px solid ${verdict.color}` }}
        >
          <div>
            <div className="fw-bold mb-1" style={{ color: verdict.color }}>{verdict.label}</div>
            <div className="small" style={{ color: 'var(--text)', opacity: 0.75 }}>
              Savings rate: <strong style={{ color: 'var(--text)', opacity: 1 }}>{savingsRate.toFixed(1)}%</strong>
              {overBudget.length > 0 && <> · <span className="text-danger">{overBudget.length} categor{overBudget.length === 1 ? 'y' : 'ies'} over budget</span></>}
            </div>
          </div>
          <PiggyBank size={28} style={{ color: verdict.color, flexShrink: 0 }} />
        </div>

        <Row className="g-3 mb-3">
          {/* Budget health score */}
          <Col md={5}>
            <Card style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--text)' }}>
              <Card.Header style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' }} className="small fw-semibold">Budget Health Score</Card.Header>
              <Card.Body className="text-center py-3">
                <BudgetHealthGauge score={budgetScore} label="on budget" />
                <div className="small mt-2" style={{ color: 'var(--muted)' }}>
                  {onBudgetCount} / {budgetRows.length} categories within budget
                </div>
                <div className="mt-2 small">
                  Income: <strong>{fmt(income)}</strong> · Spend: <strong className="text-danger">{fmt(spend)}</strong>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Top categories */}
          <Col md={7}>
            <Card style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--text)', height: '100%' }}>
              <Card.Header style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' }} className="small fw-semibold">
                <TrendingUp size={14} className="me-1" />Top Spending (30 days)
              </Card.Header>
              <Card.Body className="py-2">
                {topCategories.length === 0 ? (
                  <div className="small" style={{ color: 'var(--muted)' }}>No category data — categorise transactions first.</div>
                ) : (
                  <ReactECharts option={barOption} style={{ height: 160 }} />
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Over-budget alerts */}
        {overBudget.length > 0 && (
          <Card className="mb-3" style={{ background: 'var(--card)', border: '1px solid #ef4444' }}>
            <Card.Header style={{ background: 'var(--panel)', borderColor: '#ef4444' }} className="small fw-semibold text-danger">
              <AlertCircle size={14} className="me-1" />Over-Budget Categories
            </Card.Header>
            <Card.Body className="py-2 px-3">
              {overBudget.map(({ key, actual, budget }) => (
                <div key={key} className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small" style={{ color: 'var(--text)' }}>{key.replace(/_/g, ' ')}</span>
                  <span className="small text-danger fw-bold">{fmt(actual)} / {fmt(budget)} (+{fmt(actual - budget)})</span>
                </div>
              ))}
            </Card.Body>
          </Card>
        )}

        {/* AI Insights */}
        <Card className="mb-3" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
          <Card.Header style={{ background: 'var(--panel)', borderColor: 'var(--line)' }} className="d-flex justify-content-between align-items-center">
            <span className="small fw-semibold" style={{ color: 'var(--text)' }}><Bot size={14} className="me-1" />AI Insights</span>
            <div className="d-flex align-items-center gap-2">
              {insightsAt && <span className="small" style={{ color: 'var(--muted)' }}>Updated {insightsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
              <Button size="sm" variant="outline-secondary" onClick={refreshInsights} disabled={insightsLoading}>
                {insightsLoading ? <Spinner size="sm" animation="border" /> : <><RefreshCw size={12} className="me-1" />Refresh insights</>}
              </Button>
            </div>
          </Card.Header>
          <Card.Body>
            {insightsError && <Alert variant="danger" className="small">{insightsError}</Alert>}
            {insights.length === 0 && !insightsLoading && (
              <div className="small" style={{ color: 'var(--muted)' }}>Click "Refresh insights" to analyse your last 90 days of spend and get AI recommendations.</div>
            )}
            {insights.map((action: any) => (
              <div key={action.id} className="border rounded p-3 mb-2" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <div className="fw-semibold small mb-1" style={{ color: 'var(--text)' }}>{action.title}</div>
                <div className="small mb-2" style={{ color: 'var(--muted)' }}>{action.reason}</div>
                {convertStatus[action.id] ? (
                  <Badge bg="success">{convertStatus[action.id]}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline-secondary"
                    disabled={convertingId === action.id}
                    onClick={() => convertToStory(action)}
                  >
                    {convertingId === action.id ? <Spinner size="sm" animation="border" /> : 'Log story'}
                  </Button>
                )}
              </div>
            ))}
          </Card.Body>
        </Card>

        {/* Subscriptions */}
        {subscriptions.length > 0 && (
          <Card className="mb-3" style={{ background: 'var(--card)', border: '1px solid var(--line)' }}>
            <Card.Header style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--text)' }} className="small fw-semibold">Subscriptions</Card.Header>
            <Card.Body className="py-2 px-3">
              {subscriptions.map((s) => (
                <div key={s.name} className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small" style={{ color: 'var(--text)' }}>{s.name}</span>
                  <Badge bg="secondary">{fmt(s.totalPence)}/mo</Badge>
                </div>
              ))}
              <div className="small mt-2" style={{ color: 'var(--muted)' }}>
                Total: <strong>{fmt(subscriptions.reduce((s, r) => s + r.totalPence, 0))}</strong>/month in subscriptions
              </div>
            </Card.Body>
          </Card>
        )}
      </Container>
    </div>
  );
};

export default FinanceCoachPage;
