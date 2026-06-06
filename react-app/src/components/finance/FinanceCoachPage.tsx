import React, { useState, useMemo } from 'react';
import { Container, Card, Row, Col, Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { Bot, TrendingUp, PiggyBank, AlertCircle, RefreshCw, ExternalLink } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
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
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={10} />
        <circle
          cx={cx} cy={cy} r={r}
          fill="none" stroke={color} strokeWidth={10}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
        <text x={cx} y={cy - 6} textAnchor="middle" fill={color} fontSize={22} fontWeight="700">{Math.round(pct)}</text>
        <text x={cx} y={cy + 14} textAnchor="middle" fill="#9ca3af" fontSize={11}>{label}</text>
      </svg>
    </div>
  );
};

const FinanceCoachPage: React.FC = () => {
  const { data, loading: dataLoading } = useDashboardData();
  const [insights, setInsights] = useState<any[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [insightsAt, setInsightsAt] = useState<Date | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);
  const [convertStatus, setConvertStatus] = useState<Record<string, string>>({});

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

  const verdict = savingsRate >= 20 && overBudget.length === 0
    ? { label: 'Your finances are healthy', color: '#22c55e', bg: '#052e16' }
    : savingsRate >= 10 || overBudget.length <= 2
    ? { label: 'Watch your discretionary spend', color: '#f59e0b', bg: '#431407' }
    : { label: 'Budget alert — action needed', color: '#ef4444', bg: '#3b0a0a' };

  const topCategories = useMemo(() => {
    const byCategory = (data as any)?.byCategory || {};
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
    <div style={{ background: 'linear-gradient(180deg, #0b1220 0%, #111827 100%)', minHeight: '100vh', padding: '24px 0' }}>
      <Container style={{ maxWidth: 720 }}>
        <div className="d-flex justify-content-between align-items-center mb-4 text-white">
          <div>
            <h4 className="mb-1 d-flex align-items-center gap-2"><Bot size={20} /> AI Finance Coach</h4>
            <div className="text-muted small">Spending verdict + AI-powered action plan</div>
          </div>
          <Link to="/finance/dashboard" className="btn btn-sm btn-outline-light"><ExternalLink size={14} className="me-1" />Finance Hub</Link>
        </div>

        {/* Verdict banner */}
        <div
          className="rounded-3 p-3 mb-4 d-flex align-items-center justify-content-between"
          style={{ background: verdict.bg, border: `1px solid ${verdict.color}` }}
        >
          <div>
            <div className="fw-bold mb-1" style={{ color: verdict.color }}>{verdict.label}</div>
            <div className="small text-white-50">
              Savings rate: <strong style={{ color: '#fff' }}>{savingsRate.toFixed(1)}%</strong>
              {overBudget.length > 0 && <> · <span className="text-danger">{overBudget.length} categor{overBudget.length === 1 ? 'y' : 'ies'} over budget</span></>}
            </div>
          </div>
          <PiggyBank size={28} style={{ color: verdict.color, flexShrink: 0 }} />
        </div>

        <Row className="g-3 mb-3">
          {/* Budget health score */}
          <Col md={5}>
            <Card style={{ background: '#111827', border: '1px solid #1f2937', color: '#fff' }}>
              <Card.Header style={{ background: '#0b1220', borderColor: '#1f2937' }} className="small fw-semibold">Budget Health Score</Card.Header>
              <Card.Body className="text-center py-3">
                <BudgetHealthGauge score={budgetScore} label="on budget" />
                <div className="small text-muted mt-2">
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
            <Card style={{ background: '#111827', border: '1px solid #1f2937', color: '#fff', height: '100%' }}>
              <Card.Header style={{ background: '#0b1220', borderColor: '#1f2937' }} className="small fw-semibold">
                <TrendingUp size={14} className="me-1" />Top Spending (30 days)
              </Card.Header>
              <Card.Body className="py-2">
                {topCategories.length === 0 ? (
                  <div className="text-muted small">No category data — categorise transactions first.</div>
                ) : (
                  <ReactECharts option={barOption} style={{ height: 160 }} />
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Over-budget alerts */}
        {overBudget.length > 0 && (
          <Card className="mb-3" style={{ background: '#2f1118', border: '1px solid #ef4444' }}>
            <Card.Header style={{ background: '#3b0a0a', borderColor: '#ef4444' }} className="small fw-semibold text-danger">
              <AlertCircle size={14} className="me-1" />Over-Budget Categories
            </Card.Header>
            <Card.Body className="py-2 px-3">
              {overBudget.map(({ key, actual, budget }) => (
                <div key={key} className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small text-white">{key.replace(/_/g, ' ')}</span>
                  <span className="small text-danger fw-bold">{fmt(actual)} / {fmt(budget)} (+{fmt(actual - budget)})</span>
                </div>
              ))}
            </Card.Body>
          </Card>
        )}

        {/* AI Insights */}
        <Card className="mb-3" style={{ background: '#111827', border: '1px solid #1f2937' }}>
          <Card.Header style={{ background: '#0b1220', borderColor: '#1f2937' }} className="d-flex justify-content-between align-items-center">
            <span className="small fw-semibold text-white"><Bot size={14} className="me-1" />AI Insights</span>
            <div className="d-flex align-items-center gap-2">
              {insightsAt && <span className="small text-muted">Updated {insightsAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>}
              <Button size="sm" variant="outline-light" onClick={refreshInsights} disabled={insightsLoading}>
                {insightsLoading ? <Spinner size="sm" animation="border" /> : <><RefreshCw size={12} className="me-1" />Refresh insights</>}
              </Button>
            </div>
          </Card.Header>
          <Card.Body>
            {insightsError && <Alert variant="danger" className="small">{insightsError}</Alert>}
            {insights.length === 0 && !insightsLoading && (
              <div className="text-muted small">Click "Refresh insights" to analyse your last 90 days of spend and get AI recommendations.</div>
            )}
            {insights.map((action: any) => (
              <div key={action.id} className="border rounded p-3 mb-2" style={{ borderColor: '#1f2937', background: '#0b1220' }}>
                <div className="fw-semibold small text-white mb-1">{action.title}</div>
                <div className="text-muted small mb-2">{action.reason}</div>
                {convertStatus[action.id] ? (
                  <Badge bg="success">{convertStatus[action.id]}</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline-light"
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
          <Card className="mb-3" style={{ background: '#111827', border: '1px solid #1f2937' }}>
            <Card.Header style={{ background: '#0b1220', borderColor: '#1f2937' }} className="small fw-semibold text-white">Subscriptions</Card.Header>
            <Card.Body className="py-2 px-3">
              {subscriptions.map((s) => (
                <div key={s.name} className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small text-white">{s.name}</span>
                  <Badge bg="secondary">{fmt(s.totalPence)}/mo</Badge>
                </div>
              ))}
              <div className="text-muted small mt-2">
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
