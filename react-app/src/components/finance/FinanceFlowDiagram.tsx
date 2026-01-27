import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col, Button, ButtonGroup, Spinner, Alert, Badge, Form } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { functions } from '../../firebase';
import { Calendar, RefreshCw, Activity, TrendingUp, PieChart } from 'lucide-react';
import { PremiumCard } from '../common/PremiumCard';
import ReactECharts from 'echarts-for-react';

type FilterWindow = 'month' | 'quarter' | 'year';

const palette = ['#22c55e', '#0ea5e9', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6', '#f59e0b'];
const formatMoney = (value: number, minimumFractionDigits = 0) =>
  value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits });

const FinanceFlowDiagram: React.FC = () => {
  const { currentUser } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterWindow>('month');
  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  });
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const now = new Date();
      let rangeStart = new Date(startDate);
      let rangeEnd = new Date(endDate);
      if (filter === 'month') {
        rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
        rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      } else if (filter === 'quarter') {
        const q = Math.floor(now.getMonth() / 3);
        rangeStart = new Date(now.getFullYear(), q * 3, 1);
        rangeEnd = new Date(now.getFullYear(), (q + 1) * 3, 0);
      } else if (filter === 'year') {
        rangeStart = new Date(now.getFullYear(), 0, 1);
        rangeEnd = new Date(now.getFullYear(), 11, 31);
      }

      const fetchDashboardData = httpsCallable(functions, 'fetchDashboardData');
      const result = await fetchDashboardData({
        startDate: rangeStart.toISOString(),
        endDate: rangeEnd.toISOString()
      });
      setData((result.data as any).data);
    } catch (err) {
      console.error(err);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, currentUser]);

  const refresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const userBadge = (
    <div className="d-flex justify-content-end text-white mb-2">
      <span className="small">Signed in as: <code>{currentUser?.uid || '—'}</code></span>
    </div>
  );

  const flow = useMemo(() => {
    if (!data) return { nodes: [], links: [] };

    const nodes: { name: string; color?: string }[] = [];
    const links: { source: number; target: number; value: number; color?: string }[] = [];

    const addNode = (name: string, color?: string) => {
      const existing = nodes.findIndex((n) => n.name === name);
      if (existing >= 0) return existing;
      nodes.push({ name, color });
      return nodes.length - 1;
    };

    // Build aggregates from transactions for bucket → category → merchant
    const txs = Array.isArray(data.recentTransactions) ? data.recentTransactions : [];
    const bucketTotals: Record<string, number> = {};
    const bucketCategoryTotals: Record<string, Record<string, number>> = {};
    const categoryMerchantTotals: Record<string, Record<string, number>> = {};

    const formatNodeLabel = (raw: string) =>
      String(raw || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    txs.forEach((t: any) => {
      const amount = typeof t.amount === 'number' ? t.amount : 0;
      if (amount >= 0) return; // only spend
      const bucket = String(t.aiBucket || t.categoryType || 'optional').toLowerCase();
      if (bucket === 'bank_transfer' || bucket === 'income' || bucket === 'net_salary' || bucket === 'irregular_income') return;
      const category = String(t.aiCategoryKey || t.categoryKey || t.aiCategoryLabel || t.categoryLabel || 'uncategorised');
      const merchant = String(t.merchantName || 'merchant');
      bucketTotals[bucket] = (bucketTotals[bucket] || 0) + Math.abs(amount);
      if (!bucketCategoryTotals[bucket]) bucketCategoryTotals[bucket] = {};
      bucketCategoryTotals[bucket][category] = (bucketCategoryTotals[bucket][category] || 0) + Math.abs(amount);
      if (!categoryMerchantTotals[category]) categoryMerchantTotals[category] = {};
      categoryMerchantTotals[category][merchant] = (categoryMerchantTotals[category][merchant] || 0) + Math.abs(amount);
    });

    const root = addNode('Total Spend');

    Object.entries(bucketTotals).forEach(([bucket, val], idx) => {
      const bucketNode = addNode(formatNodeLabel(bucket), palette[idx % palette.length]);
      links.push({ source: root, target: bucketNode, value: val, color: palette[idx % palette.length] });

      const catTotals = Object.entries(bucketCategoryTotals[bucket] || {})
        .sort((a, b) => b[1] - a[1]);
      catTotals.forEach(([cat, catVal], cIdx) => {
        const catNode = addNode(formatNodeLabel(cat), palette[(idx + cIdx) % palette.length]);
        links.push({ source: bucketNode, target: catNode, value: catVal, color: palette[(idx + cIdx) % palette.length] });

        const merchTotals = Object.entries(categoryMerchantTotals[cat] || {})
          .sort((a, b) => b[1] - a[1]);
        merchTotals.forEach(([merchant, merchVal], mIdx) => {
          const merchNode = addNode(formatNodeLabel(merchant), palette[(idx + cIdx + mIdx) % palette.length]);
          links.push({ source: catNode, target: merchNode, value: merchVal, color: palette[(idx + cIdx + mIdx) % palette.length] });
        });
      });
    });

    return { nodes, links };
  }, [data]);

  const sankeyOption = {
    tooltip: {
      trigger: 'item',
      formatter: ({ data }: any) => `${data.name || ''}: ${formatMoney(Math.abs(data.value || 0), 0)}`,
    },
    series: [
      {
        type: 'sankey',
        data: flow.nodes.map((n) => ({ ...n })),
        links: flow.links.map((l) => ({
          source: flow.nodes[l.source]?.name,
          target: flow.nodes[l.target]?.name,
          value: l.value,
          lineStyle: { color: l.color || '#22c55e', opacity: 0.45 },
        })),
        emphasis: { focus: 'adjacency' },
        nodeAlign: 'justify',
        nodeGap: 12,
        layoutIterations: 32,
        lineStyle: { curveness: 0.5 },
      },
    ],
  };

  if (loading && !data) {
    return <div className="d-flex justify-content-center align-items-center py-5"><Spinner animation="border" /></div>;
  }

  if (!data) {
    return <Alert variant="danger" className="m-3">Failed to load spend data.</Alert>;
  }

  const spendByBucket = data.spendByBucket || {};
  const bankTransfer = spendByBucket.bank_transfer || 0;
  const totalSpend = Math.abs((data.totalSpend || 0) - bankTransfer);
  const distributionData = Object.entries(data.spendByCategory || {})
    .filter(([key]) => key !== 'bank_transfer')
    .map(([key, value]: [string, any]) => ({ name: String(key).replace(/_/g, ' '), value: Math.abs(value) }))
    .sort((a, b) => b.value - a.value);

  const trendPoints = (() => {
    const ts = data.timeSeriesByBucket || {};
    const months = new Set<string>();
    Object.values(ts).forEach((arr: any) => (arr || []).forEach((p: any) => months.add(p.month)));
    const sortedMonths = Array.from(months).sort();
    return sortedMonths.map((m) => {
      const row: any = { month: m };
      Object.entries(ts).forEach(([bucket, arr]: [string, any]) => {
        if (['bank_transfer', 'income', 'net_salary', 'irregular_income'].includes(bucket)) return;
        const found = (arr || []).find((p: any) => p.month === m);
        row[bucket] = found ? Math.abs(found.amount || 0) : 0;
      });
      return row;
    });
  })();

  const trendKeys = Object.keys(data.timeSeriesByBucket || {}).filter(
    (b) => !['bank_transfer', 'income', 'net_salary', 'irregular_income'].includes(b)
  );

  const cashFlowPoints = (() => {
    const ts = data.timeSeriesByBucket || {};
    const months = new Set<string>();
    Object.values(ts).forEach((arr: any) => (arr || []).forEach((p: any) => months.add(p.month)));
    const sortedMonths = Array.from(months).sort();
    return sortedMonths.map((month) => {
      let income = 0;
      let outgoing = 0;
      Object.entries(ts).forEach(([bucket, arr]: [string, any]) => {
        const found = (arr || []).find((p: any) => p.month === month);
        if (!found) return;
        const amount = Number(found.amount || 0);
        const lower = String(bucket || '').toLowerCase();
        if (['income', 'net_salary', 'irregular_income'].includes(lower)) {
          income += Math.abs(amount);
        } else if (!['bank_transfer', 'unknown'].includes(lower)) {
          outgoing += Math.abs(amount);
        }
      });
      return { month, income, outgoing };
    });
  })();

  const cashFlowOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: ['Income', 'Outgoing'] },
    grid: { left: 45, right: 10, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: cashFlowPoints.map((p) => p.month) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v, 0) } },
    series: [
      { name: 'Income', type: 'bar', data: cashFlowPoints.map((p) => p.income), color: '#22c55e' },
      { name: 'Outgoing', type: 'bar', data: cashFlowPoints.map((p) => p.outgoing), color: '#ef4444' },
    ],
  };

  const trendOption = {
    tooltip: { trigger: 'axis' },
    legend: { data: trendKeys },
    grid: { left: 45, right: 10, top: 30, bottom: 30 },
    xAxis: { type: 'category', data: trendPoints.map((p) => p.month) },
    yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v, 0) } },
    series: trendKeys.map((key, idx) => ({
      name: key,
      type: 'line',
      smooth: true,
      data: trendPoints.map((p: any) => p[key] || 0),
      areaStyle: { opacity: 0.08 },
      color: palette[idx % palette.length],
    })),
  };

  const distributionOption = {
    tooltip: { trigger: 'item', valueFormatter: (v: number) => formatMoney(v, 0) },
    legend: { bottom: 0, type: 'scroll' },
    series: [
      {
        type: 'pie',
        radius: ['50%', '70%'],
        data: distributionData.map((d, idx) => ({
          ...d,
          itemStyle: { color: palette[idx % palette.length] },
        })),
      },
    ],
  };

  return (
    <div className="container-fluid py-4" style={{ minHeight: '100vh', background: 'radial-gradient(circle at 20% 20%, #1f2937, #0b1021)' }}>
      {userBadge}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 text-white">
        <div>
          <h2 className="fw-bold mb-1 display-6">Cash Flow · Spend Breakdown</h2>
          <div className="d-flex align-items-center gap-2 fs-6">
            <Calendar size={16} />
            <span>{filter === 'month' ? 'This Month' : filter === 'quarter' ? 'This Quarter' : 'This Year'}</span>
          </div>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <ButtonGroup>
            <Button variant={filter === 'month' ? 'primary' : 'outline-light'} onClick={() => setFilter('month')}>Month</Button>
            <Button variant={filter === 'quarter' ? 'primary' : 'outline-light'} onClick={() => setFilter('quarter')}>Quarter</Button>
            <Button variant={filter === 'year' ? 'primary' : 'outline-light'} onClick={() => setFilter('year')}>Year</Button>
          </ButtonGroup>
          <Form.Control
            type="date"
            size="sm"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            style={{ maxWidth: 150 }}
          />
          <Form.Control
            type="date"
            size="sm"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            style={{ maxWidth: 150 }}
          />
          <Button variant="outline-light" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner animation="border" size="sm" className="me-1" /> : <RefreshCw size={16} className="me-1" />}
            Refresh
          </Button>
        </div>
      </div>

      <Row className="g-4">
        <Col lg={8}>
          <PremiumCard title="Spend Breakdown (Buckets → Categories → Merchants)" icon={Activity} height={540} className="bg-dark text-white position-relative">
            <div className="small text-muted mb-2">Sankey of spend direction; hover for amounts.</div>
            <ReactECharts option={sankeyOption} style={{ height: '100%' }} />
          </PremiumCard>
        </Col>
        <Col lg={4}>
          <div className="d-flex flex-column gap-3">
            <PremiumCard title="Total Spend" icon={Activity}>
              <h2 className="fw-bold mb-1 text-danger" style={{ fontSize: '2.1rem' }}>{formatMoney(totalSpend, 0)}</h2>
              <div className="mt-2 text-muted small">Includes mandatory, discretionary, savings transfers.</div>
            </PremiumCard>
            <PremiumCard title="Buckets" icon={Activity}>
                <div className="d-flex flex-column gap-2">
                <div className="d-flex flex-wrap gap-2">
                  <Badge bg="danger" className="fs-6">{formatMoney(totalSpend, 0)}</Badge>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  {Object.entries(spendByBucket || {}).filter(([bucket]) => bucket !== 'bank_transfer').map(([bucket, val], idx) => (
                    <Badge key={bucket} bg="light" text="dark" style={{ border: `1px solid ${palette[idx % palette.length]}` }}>
                      {bucket}: {formatMoney(Math.abs(val as number), 0)}
                    </Badge>
                  ))}
                </div>
              </div>
            </PremiumCard>
            <PremiumCard title="Distribution" icon={PieChart} height={260}>
              <ReactECharts option={distributionOption} style={{ height: '100%' }} />
            </PremiumCard>
            <PremiumCard title="Trend" icon={TrendingUp} height={240}>
              <ReactECharts option={trendOption} style={{ height: '100%' }} />
            </PremiumCard>
          </div>
        </Col>
      </Row>

      <Row className="g-4 mt-1">
        <Col lg={8}>
          <PremiumCard title="Income vs Outgoing" icon={TrendingUp} height={320}>
            <div className="small text-muted mb-2">Monthly comparison from Monzo activity.</div>
            <ReactECharts option={cashFlowOption} style={{ height: '100%' }} />
          </PremiumCard>
        </Col>
        <Col lg={4}>
          <PremiumCard title="Spend Anomalies" icon={Activity} height={320}>
            {Array.isArray(data.anomalyTransactions) && data.anomalyTransactions.length ? (
              <div className="small text-muted overflow-auto" style={{ maxHeight: 240 }}>
                <table className="table table-sm table-dark table-striped mb-0">
                  <thead>
                    <tr>
                      <th>Merchant</th>
                      <th className="text-end">Amount</th>
                      <th>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.anomalyTransactions.map((tx: any) => (
                      <tr key={tx.id}>
                        <td>{tx.merchantName || 'Unknown'}</td>
                        <td className="text-end">{formatMoney(tx.amount || 0, 0)}</td>
                        <td className="small">{tx.aiAnomalyReason || 'Anomaly'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-muted small">No anomalies detected in the last 90 days.</div>
            )}
          </PremiumCard>
        </Col>
      </Row>
    </div>
  );
};

export default FinanceFlowDiagram;
