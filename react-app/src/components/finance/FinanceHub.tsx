import React, { useState, useMemo } from 'react';
import { Container, Tabs, Tab, Card, Row, Col, Badge, OverlayTrigger, Tooltip, Spinner } from 'react-bootstrap';
import { TrendingUp, TrendingDown, DollarSign, Target, PiggyBank, AlertCircle, Calendar, Info, BarChart3 } from 'lucide-react';
import { useDashboardData } from '../../hooks/useDashboardData';
import TransactionTable from './TransactionTable';
import MerchantMappings from './MerchantMappings';
import GoalPotLinking from './GoalPotLinking';
import * as echarts from 'echarts';
import ReactECharts from 'echarts-for-react';

const FinanceHub: React.FC = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const { data, loading, error } = useDashboardData();

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" />
        <p className="mt-3">Loading financial data...</p>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-5">
        <Card bg="danger" text="white">
          <Card.Body>
            <AlertCircle size={24} className="me-2" />
            Error loading financial data: {error}
          </Card.Body>
        </Card>
      </Container>
    );
  }

  // Stale data warning banner
  const showStaleWarning = data?.isStale && data?.lastUpdatedISO;
  
  return (
    <Container fluid className="p-4">
      {showStaleWarning && (
        <div className="alert alert-warning mb-3 d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center">
            <AlertCircle size={20} className="me-2" />
            <strong>Data may be stale:</strong> Last updated {new Date(data.lastUpdatedISO).toLocaleString('en-GB')}
            {' '}({Math.round((Date.now() - new Date(data.lastUpdatedISO).getTime()) / (1000 * 60 * 60))} hours ago)
          </div>
          <button 
            className="btn btn-sm btn-outline-warning"
            onClick={() => window.location.reload()}
          >
            Refresh Data
          </button>
        </div>
      )}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Finance Hub</h2>
          <p className="text-muted mb-0">Comprehensive spend tracking and financial planning</p>
        </div>
        <Badge bg="info" className="d-flex align-items-center gap-1">
          <Calendar size={14} />
          {data?.currentPeriod || 'Current Period'}
        </Badge>
      </div>

      <Tabs
        activeKey={activeTab}
        onSelect={(k) => setActiveTab(k || 'overview')}
        className="mb-4"
      >
        <Tab eventKey="overview" title={<><BarChart3 size={16} className="me-1" />Overview</>}>
          <OverviewTab data={data} />
        </Tab>

        <Tab eventKey="spend" title="Spend Analytics">
          <SpendAnalyticsTab data={data} />
        </Tab>

        <Tab eventKey="transactions" title="Transactions">
          <TransactionsTab data={data} />
        </Tab>

        <Tab eventKey="insights" title={<><TrendingUp size={16} className="me-1" />Insights</>}>
          <InsightsTab data={data} />
        </Tab>

        <Tab eventKey="goals" title="Goals & Pots">
          <GoalPotLinking />
        </Tab>

        <Tab eventKey="merchants" title="Merchant Management">
          <MerchantMappings />
        </Tab>
      </Tabs>
    </Container>
  );
};

// Overview Tab - High-level metrics
const OverviewTab: React.FC<{ data: any }> = ({ data }) => {
  const metrics = useMemo(() => {
    const spend = data?.totalSpend || 0;
    const income = data?.totalIncome || 0;
    const savings = data?.totalSavings || 0;
    const discretionary = data?.discretionarySpend || 0;
    const mandatory = data?.mandatorySpend || 0;

    return {
      netCashflow: income - spend,
      totalSpend: spend,
      totalIncome: income,
      totalSavings: savings,
      discretionary,
      mandatory,
      savingsRate: income > 0 ? (savings / income) * 100 : 0,
    };
  }, [data]);

  return (
    <Row className="g-4">
      <Col md={6} lg={3}>
        <MetricCard
          title="Net Cashflow"
          value={`£${(metrics.netCashflow / 100).toFixed(2)}`}
          icon={metrics.netCashflow >= 0 ? <TrendingUp /> : <TrendingDown />}
          variant={metrics.netCashflow >= 0 ? 'success' : 'danger'}
          tooltip="Total income minus total spending for the period. Positive means you're saving money."
        />
      </Col>

      <Col md={6} lg={3}>
        <MetricCard
          title="Total Income"
          value={`£${(metrics.totalIncome / 100).toFixed(2)}`}
          icon={<DollarSign />}
          variant="success"
          tooltip="All money received including salary, bonuses, and irregular income."
        />
      </Col>

      <Col md={6} lg={3}>
        <MetricCard
          title="Total Spend"
          value={`£${(metrics.totalSpend / 100).toFixed(2)}`}
          icon={<TrendingDown />}
          variant="primary"
          tooltip="Total spending across all categories (excluding transfers and income)."
        />
      </Col>

      <Col md={6} lg={3}>
        <MetricCard
          title="Savings Rate"
          value={`${metrics.savingsRate.toFixed(1)}%`}
          icon={<PiggyBank />}
          variant="info"
          tooltip="Percentage of income saved. Target: 20%+ is excellent, 10-20% is good."
        />
      </Col>

      <Col md={6}>
        <Card className="h-100">
          <Card.Header className="d-flex align-items-center justify-content-between">
            <span>Spending Breakdown</span>
            <OverlayTrigger overlay={<Tooltip>Mandatory vs Discretionary spending</Tooltip>}>
              <Info size={16} className="text-muted" />
            </OverlayTrigger>
          </Card.Header>
          <Card.Body>
            <div className="mb-3">
              <div className="d-flex justify-content-between mb-2">
                <span>Mandatory</span>
                <Badge bg="danger">£{(metrics.mandatory / 100).toFixed(2)}</Badge>
              </div>
              <div className="progress" style={{ height: '20px' }}>
                <div
                  className="progress-bar bg-danger"
                  style={{ width: `${(metrics.mandatory / metrics.totalSpend) * 100}%` }}
                >
                  {((metrics.mandatory / metrics.totalSpend) * 100).toFixed(0)}%
                </div>
              </div>
            </div>

            <div>
              <div className="d-flex justify-content-between mb-2">
                <span>Discretionary</span>
                <Badge bg="warning">£{(metrics.discretionary / 100).toFixed(2)}</Badge>
              </div>
              <div className="progress" style={{ height: '20px' }}>
                <div
                  className="progress-bar bg-warning"
                  style={{ width: `${(metrics.discretionary / metrics.totalSpend) * 100}%` }}
                >
                  {((metrics.discretionary / metrics.totalSpend) * 100).toFixed(0)}%
                </div>
              </div>
            </div>
          </Card.Body>
        </Card>
      </Col>

      <Col md={6}>
        <Card className="h-100">
          <Card.Header className="d-flex align-items-center justify-content-between">
            <span>Recent Activity</span>
            <OverlayTrigger overlay={<Tooltip>Last 5 transactions</Tooltip>}>
              <Info size={16} className="text-muted" />
            </OverlayTrigger>
          </Card.Header>
          <Card.Body>
            <TransactionTable
              transactions={(data?.recentTransactions || []).slice(0, 5)}
              compact
              showActions={false}
              showSubscription={false}
              maxHeight="300px"
            />
          </Card.Body>
        </Card>
      </Col>

      <Col md={12}>
        <Card>
          <Card.Header className="d-flex align-items-center justify-content-between">
            <span>Uncategorized Transactions</span>
            <OverlayTrigger overlay={<Tooltip>Transactions needing categorization for accurate reporting</Tooltip>}>
              <Badge bg="warning" className="d-flex align-items-center gap-1">
                <AlertCircle size={14} />
                {(data?.uncategorizedCount || 0)} uncategorized
              </Badge>
            </OverlayTrigger>
          </Card.Header>
          <Card.Body>
            {data?.uncategorizedCount > 0 ? (
              <div className="alert alert-warning">
                <strong>Action Required:</strong> You have {data.uncategorizedCount} uncategorized transactions.
                Go to the <strong>Transactions</strong> or <strong>Merchant Management</strong> tab to categorize them for better insights.
              </div>
            ) : (
              <div className="alert alert-success">
                ✅ All transactions are categorized! Your financial data is accurate.
              </div>
            )}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

// Metric Card Component with Tooltip
const MetricCard: React.FC<{
  title: string;
  value: string;
  icon: React.ReactNode;
  variant: string;
  tooltip: string;
}> = ({ title, value, icon, variant, tooltip }) => (
  <Card className="h-100">
    <Card.Body>
      <div className="d-flex justify-content-between align-items-start mb-2">
        <div className={`text-${variant}`}>{icon}</div>
        <OverlayTrigger overlay={<Tooltip>{tooltip}</Tooltip>}>
          <Info size={16} className="text-muted" style={{ cursor: 'help' }} />
        </OverlayTrigger>
      </div>
      <h6 className="text-muted mb-1">{title}</h6>
      <h3 className="mb-0">{value}</h3>
    </Card.Body>
  </Card>
);

// Spend Analytics Tab
const SpendAnalyticsTab: React.FC<{ data: any }> = ({ data }) => {
  const [chartFilter, setChartFilter] = useState<{ type: string | null; value: string | null }>({
    type: null,
    value: null,
  });

  const pieChartData = useMemo(() => {
    const byCategory = data?.byCategory || {};
    return Object.entries(byCategory)
      .map(([key, value]: [string, any]) => ({
        name: key,
        value: Math.abs(value),
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [data]);

  const pieOption = {
    tooltip: { trigger: 'item' },
    legend: { top: '5%', left: 'center' },
    series: [
      {
        name: 'Spend by Category',
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
        label: { show: false, position: 'center' },
        emphasis: {
          label: { show: true, fontSize: 20, fontWeight: 'bold' },
        },
        labelLine: { show: false },
        data: pieChartData,
      },
    ],
  };

  const filteredTransactions = useMemo(() => {
    if (!chartFilter.type || !chartFilter.value) return data?.recentTransactions || [];

    return (data?.recentTransactions || []).filter((tx: any) => {
      if (chartFilter.type === 'category') {
        const category = tx.userCategoryLabel || tx.aiCategoryLabel || tx.defaultCategoryLabel;
        return category === chartFilter.value;
      }
      return true;
    });
  }, [data, chartFilter]);

  return (
    <Row className="g-4">
      <Col md={6}>
        <Card>
          <Card.Header className="d-flex align-items-center justify-content-between">
            <span>Spend by Category</span>
            <OverlayTrigger overlay={<Tooltip>Click a slice to filter transactions below</Tooltip>}>
              <Info size={16} className="text-muted" />
            </OverlayTrigger>
          </Card.Header>
          <Card.Body>
            <ReactECharts
              option={pieOption}
              style={{ height: '400px' }}
              onEvents={{
                click: (params: any) => {
                  setChartFilter({ type: 'category', value: params.name });
                },
              }}
            />
          </Card.Body>
        </Card>
      </Col>

      <Col md={6}>
        <Card>
          <Card.Header>
            <div className="d-flex align-items-center justify-content-between">
              <span>Filtered Transactions</span>
              {chartFilter.value && (
                <Badge
                  bg="primary"
                  className="cursor-pointer"
                  onClick={() => setChartFilter({ type: null, value: null })}
                >
                  {chartFilter.value} ✕
                </Badge>
              )}
            </div>
          </Card.Header>
          <Card.Body>
            <TransactionTable
              transactions={filteredTransactions.slice(0, 20)}
              compact
              showActions={false}
              maxHeight="400px"
            />
          </Card.Body>
        </Card>
      </Col>

      <Col md={12}>
        <Card>
          <Card.Header className="d-flex align-items-center justify-content-between">
            <span>All Transactions</span>
            <OverlayTrigger overlay={<Tooltip>Complete transaction history with filtering options</Tooltip>}>
              <Info size={16} className="text-muted" />
            </OverlayTrigger>
          </Card.Header>
          <Card.Body>
            <TransactionTable
              transactions={data?.recentTransactions || []}
              showActions
              filterUncategorised
              maxHeight="600px"
            />
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

// Transactions Tab
const TransactionsTab: React.FC<{ data: any }> = ({ data }) => (
  <Card>
    <Card.Header className="d-flex align-items-center justify-content-between">
      <span>All Transactions</span>
      <OverlayTrigger overlay={<Tooltip>Edit categories inline or use Merchant Management for bulk updates</Tooltip>}>
        <Info size={16} className="text-muted" />
      </OverlayTrigger>
    </Card.Header>
    <Card.Body>
      <TransactionTable
        transactions={data?.recentTransactions || []}
        showActions
        filterUncategorised
        maxHeight="calc(100vh - 300px)"
      />
    </Card.Body>
  </Card>
);

// Insights Tab — category trends, budget vs actual, net worth, subscriptions
const InsightsTab: React.FC<{ data: any }> = ({ data }) => {
  const palette = ['#22c55e', '#0ea5e9', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6', '#f59e0b'];
  const fmt = (v: number) => (v / 100).toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 0 });

  // Category spend trend — top 5 categories month-by-month
  const { trendOption, topCategories } = useMemo(() => {
    const ts: Record<string, any[]> = data?.timeSeriesByCategory || {};
    const totals: Record<string, number> = {};
    Object.entries(ts).forEach(([cat, points]) => {
      totals[cat] = (points || []).reduce((s: number, p: any) => s + Math.abs(Number(p.amount || 0)), 0);
    });
    const top5 = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k);
    const months = Array.from(new Set(
      top5.flatMap((cat) => (ts[cat] || []).map((p: any) => String(p.month || '')))
    )).sort();
    const option = {
      tooltip: { trigger: 'axis' },
      legend: { data: top5, bottom: 0 },
      grid: { left: 55, right: 10, top: 20, bottom: 60 },
      xAxis: { type: 'category', data: months },
      yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `£${(v / 100).toFixed(0)}` } },
      series: top5.map((cat, idx) => ({
        name: cat,
        type: 'bar',
        stack: 'spend',
        data: months.map((m) => {
          const pt = (ts[cat] || []).find((p: any) => p.month === m);
          return Math.abs(Number(pt?.amount || 0));
        }),
        color: palette[idx % palette.length],
      })),
    };
    return { trendOption: option, topCategories: top5 };
  }, [data]);

  // Budget vs actual — 30d spend vs budget per category
  const budgetVsActual = useMemo(() => {
    const budgets: Record<string, number> = data?.categoryBudgets || {};
    const spend30: Record<string, number> = data?.spendByCategory || {};
    return Object.entries(budgets)
      .filter(([k, v]) => Number(v) > 0)
      .map(([key, budgetPence]) => ({
        key,
        budget: Number(budgetPence),
        actual: Math.abs(Number(spend30[key] || 0)),
      }))
      .sort((a, b) => b.budget - a.budget)
      .slice(0, 10);
  }, [data]);

  // Subscriptions list
  const subscriptions = useMemo(() => {
    const txns: any[] = data?.recentTransactions || [];
    const byMerchant: Record<string, { name: string; totalPence: number; count: number }> = {};
    txns.forEach((tx: any) => {
      if (!tx.isSubscription) return;
      const key = tx.merchantKey || tx.merchant || 'unknown';
      if (!byMerchant[key]) byMerchant[key] = { name: tx.merchant || key, totalPence: 0, count: 0 };
      byMerchant[key].totalPence += Math.abs(Number(tx.amount || 0) * 100);
      byMerchant[key].count++;
    });
    return Object.values(byMerchant).sort((a, b) => b.totalPence - a.totalPence);
  }, [data]);

  return (
    <Row className="g-4">
      <Col md={12}>
        <Card>
          <Card.Header>
            <span>Spend Trend — Top 5 Categories</span>
          </Card.Header>
          <Card.Body>
            {topCategories.length === 0 ? (
              <p className="text-muted">No time series data available. Categorise your transactions first.</p>
            ) : (
              <ReactECharts option={trendOption} style={{ height: 320 }} />
            )}
          </Card.Body>
        </Card>
      </Col>

      <Col md={8}>
        <Card>
          <Card.Header>Budget vs Actual (30 days)</Card.Header>
          <Card.Body>
            {budgetVsActual.length === 0 ? (
              <p className="text-muted">Set category budgets in the Budgets tab to see this comparison.</p>
            ) : (
              <div className="d-flex flex-column gap-3">
                {budgetVsActual.map(({ key, budget, actual }) => {
                  const pct = budget > 0 ? Math.min(120, (actual / budget) * 100) : 0;
                  const over = actual > budget;
                  return (
                    <div key={key}>
                      <div className="d-flex justify-content-between mb-1">
                        <span className="small">{key.replace(/_/g, ' ')}</span>
                        <span className={`small ${over ? 'text-danger fw-bold' : 'text-muted'}`}>
                          {fmt(actual)} / {fmt(budget)}
                          {over && ' ▲'}
                        </span>
                      </div>
                      <div className="progress" style={{ height: 10 }}>
                        <div
                          className={`progress-bar ${over ? 'bg-danger' : 'bg-success'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card.Body>
        </Card>
      </Col>

      <Col md={4}>
        <Card className="mb-3">
          <Card.Header>Subscriptions</Card.Header>
          <Card.Body style={{ maxHeight: 300, overflowY: 'auto' }}>
            {subscriptions.length === 0 ? (
              <p className="text-muted small">No subscriptions detected. Mark transactions as subscriptions in the Transactions view.</p>
            ) : (
              <div className="d-flex flex-column gap-1">
                {subscriptions.map((s) => (
                  <div key={s.name} className="d-flex justify-content-between align-items-center">
                    <span className="small">{s.name}</span>
                    <Badge bg="secondary">{fmt(s.totalPence)}/mo est.</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>Savings Rate Indicator</Card.Header>
          <Card.Body>
            {(() => {
              const income = data?.totalIncome || 0;
              const spend = data?.totalSpend || 0;
              const rate = income > 0 ? ((income - spend) / income) * 100 : 0;
              const color = rate >= 20 ? 'success' : rate >= 10 ? 'warning' : 'danger';
              return (
                <div>
                  <h3 className={`text-${color}`}>{rate.toFixed(1)}%</h3>
                  <div className="progress mb-2" style={{ height: 12 }}>
                    <div className={`progress-bar bg-${color}`} style={{ width: `${Math.min(100, rate)}%` }} />
                  </div>
                  <div className="small text-muted">
                    {rate >= 20 ? 'Excellent — above 20% target' : rate >= 10 ? 'Good — target 20%+ for FIRE' : 'Low — aim for 10%+ minimum'}
                  </div>
                </div>
              );
            })()}
          </Card.Body>
        </Card>
      </Col>
    </Row>
  );
};

export default FinanceHub;
