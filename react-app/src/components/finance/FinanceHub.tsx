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

  return (
    <Container fluid className="p-4">
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

export default FinanceHub;
