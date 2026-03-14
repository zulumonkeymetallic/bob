import React, { useEffect, useMemo, useState } from 'react';
import { Row, Col, Button, ButtonGroup, Spinner, Alert, Badge, Form } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../contexts/AuthContext';
import { functions } from '../../firebase';
import { Calendar, RefreshCw, Activity, TrendingUp, PieChart } from 'lucide-react';
import { PremiumCard } from '../common/PremiumCard';
import ReactECharts from 'echarts-for-react';
import { normalizeMerchantKey } from './financeInsights';

type FilterWindow = '7d' | '30d' | '60d' | '90d' | '6m' | 'year' | 'all' | 'custom';
type ActionFilter = 'all' | 'with' | 'without';

const palette = ['#22c55e', '#0ea5e9', '#f97316', '#8b5cf6', '#ef4444', '#14b8a6', '#f59e0b'];
const formatMoney = (value: number, minimumFractionDigits = 0) =>
  value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits });

const FinanceFlowDiagram: React.FC = () => {
  const { currentUser } = useAuth();
  const [data, setData] = useState<any>(null);
  const [analysisRows, setAnalysisRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterWindow>('30d');
  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    return new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });
  const [refreshing, setRefreshing] = useState(false);
  const [bucketFilter, setBucketFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [merchantFilter, setMerchantFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');
  const [actionMerchantKeys, setActionMerchantKeys] = useState<string[]>([]);

  const fetchData = async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const now = new Date();
      let rangeStart = new Date(startDate);
      let rangeEnd = new Date(endDate);
      if (filter === '7d') {
        rangeEnd = now;
        rangeStart = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      } else if (filter === '30d') {
        rangeEnd = now;
        rangeStart = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      } else if (filter === '60d') {
        rangeEnd = now;
        rangeStart = new Date(now.getTime() - (60 * 24 * 60 * 60 * 1000));
      } else if (filter === '90d') {
        rangeEnd = now;
        rangeStart = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      } else if (filter === '6m') {
        rangeEnd = now;
        rangeStart = new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
      } else if (filter === 'year') {
        rangeStart = new Date(now.getFullYear(), 0, 1);
        rangeEnd = new Date(now.getFullYear(), 11, 31);
      } else if (filter === 'all') {
        rangeStart = new Date('2018-01-01T00:00:00.000Z');
        rangeEnd = now;
      }

      const fetchDashboardData = httpsCallable(functions, 'fetchDashboardData');
      const fetchEnhancementData = httpsCallable(functions, 'fetchFinanceEnhancementData');
      const [dashboardRes, enhancementRes] = await Promise.all([
        fetchDashboardData({
          startDate: rangeStart.toISOString(),
          endDate: rangeEnd.toISOString()
        }),
        fetchEnhancementData({
          startDate: rangeStart.toISOString(),
          endDate: rangeEnd.toISOString()
        }),
      ]);
      setData((dashboardRes.data as any).data);
      const enhancement = (enhancementRes.data as any) || {};
      setAnalysisRows(Array.isArray(enhancement.analysisRows) ? enhancement.analysisRows : []);
      const keys = Array.isArray(enhancement.actions)
        ? enhancement.actions
            .map((action: any) => normalizeMerchantKey(action.merchantKey || action.merchantName || ''))
            .filter(Boolean)
        : [];
      setActionMerchantKeys(Array.from(new Set(keys)));
    } catch (err) {
      console.error(err);
      setData(null);
      setAnalysisRows([]);
      setActionMerchantKeys([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, currentUser, startDate, endDate]);

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

  const rowsForCharts = useMemo(() => {
    const actionKeys = new Set(actionMerchantKeys);
    return (analysisRows || []).filter((row: any) => {
      const bucket = String(row.bucket || '').toLowerCase();
      if (bucket === 'bank_transfer' || bucket === 'income' || bucket === 'net_salary' || bucket === 'irregular_income' || bucket === 'unknown') return false;
      if (bucketFilter !== 'all' && bucket !== bucketFilter) return false;
      const category = String(row.categoryKey || row.categoryLabel || 'uncategorized');
      if (categoryFilter !== 'all' && category !== categoryFilter) return false;
      const merchant = String(row.merchantKey || row.merchantName || 'unknown');
      if (merchantFilter !== 'all' && merchant !== merchantFilter) return false;
      if (actionFilter !== 'all') {
        const hasAction = actionKeys.has(normalizeMerchantKey(row.merchantKey || row.merchantName || row.merchant || ''));
        if (actionFilter === 'with' && !hasAction) return false;
        if (actionFilter === 'without' && hasAction) return false;
      }
      return true;
    });
  }, [analysisRows, bucketFilter, categoryFilter, merchantFilter, actionFilter, actionMerchantKeys]);

  const bucketOptions = useMemo(() => {
    const set = new Set<string>();
    (analysisRows || []).forEach((row: any) => {
      const bucket = String(row.bucket || '').toLowerCase();
      if (!bucket || bucket === 'bank_transfer' || bucket === 'income' || bucket === 'unknown') return;
      set.add(bucket);
    });
    return Array.from(set).sort();
  }, [analysisRows]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    (analysisRows || []).forEach((row: any) => {
      const category = String(row.categoryKey || row.categoryLabel || 'uncategorized');
      set.add(category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [analysisRows]);

  const merchantOptions = useMemo(() => {
    const set = new Set<string>();
    (analysisRows || []).forEach((row: any) => {
      const merchant = String(row.merchantKey || row.merchantName || 'unknown');
      set.add(merchant);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [analysisRows]);

  const flow = useMemo(() => {
    if (!rowsForCharts.length) return { nodes: [], links: [] };

    const nodes: { name: string; color?: string }[] = [];
    const links: { source: number; target: number; value: number; color?: string }[] = [];

    const addNode = (name: string, color?: string) => {
      const existing = nodes.findIndex((n) => n.name === name);
      if (existing >= 0) return existing;
      nodes.push({ name, color });
      return nodes.length - 1;
    };

    const bucketTotals: Record<string, number> = {};
    const bucketCategoryTotals: Record<string, Record<string, number>> = {};
    const categoryMerchantTotals: Record<string, Record<string, number>> = {};

    const formatNodeLabel = (raw: string) =>
      String(raw || '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());

    rowsForCharts.forEach((t: any) => {
      const amount = Number(t.amountPence || 0) / 100;
      if (!Number.isFinite(amount) || amount <= 0) return;
      const bucket = String(t.bucket || 'discretionary').toLowerCase();
      const category = String(t.categoryLabel || t.categoryKey || 'uncategorised');
      const merchant = String(t.merchantName || t.merchantKey || 'merchant');
      bucketTotals[bucket] = (bucketTotals[bucket] || 0) + amount;
      if (!bucketCategoryTotals[bucket]) bucketCategoryTotals[bucket] = {};
      bucketCategoryTotals[bucket][category] = (bucketCategoryTotals[bucket][category] || 0) + amount;
      if (!categoryMerchantTotals[category]) categoryMerchantTotals[category] = {};
      categoryMerchantTotals[category][merchant] = (categoryMerchantTotals[category][merchant] || 0) + amount;
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
  }, [rowsForCharts]);

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

  const spendByBucket = rowsForCharts.reduce((acc: Record<string, number>, row: any) => {
    const bucket = String(row.bucket || 'unknown').toLowerCase();
    const amount = Number(row.amountPence || 0) / 100;
    if (!Number.isFinite(amount)) return acc;
    acc[bucket] = (acc[bucket] || 0) + amount;
    return acc;
  }, {});
  const totalSpend = rowsForCharts.reduce((sum: number, row: any) => sum + (Number(row.amountPence || 0) / 100), 0);
  const distributionData = Object.entries(
    rowsForCharts.reduce((acc: Record<string, number>, row: any) => {
      const category = String(row.categoryLabel || row.categoryKey || 'uncategorized').replace(/_/g, ' ');
      const amount = Number(row.amountPence || 0) / 100;
      acc[category] = (acc[category] || 0) + amount;
      return acc;
    }, {})
  )
    .map(([name, value]) => ({ name, value: Number(value) || 0 }))
    .sort((a, b) => b.value - a.value);

  const trendPoints = (() => {
    const months = new Set<string>();
    rowsForCharts.forEach((row: any) => months.add(String(row.month || '').trim()));
    const sortedMonths = Array.from(months).filter(Boolean).sort();
    return sortedMonths.map((month) => {
      const row: any = { month };
      rowsForCharts.forEach((item: any) => {
        if (item.month !== month) return;
        const bucket = String(item.bucket || 'unknown').toLowerCase();
        row[bucket] = (row[bucket] || 0) + (Number(item.amountPence || 0) / 100);
      });
      return row;
    });
  })();

  const trendKeys = Object.keys(
    rowsForCharts.reduce((acc: Record<string, number>, row: any) => {
      const bucket = String(row.bucket || 'unknown').toLowerCase();
      acc[bucket] = (acc[bucket] || 0) + 1;
      return acc;
    }, {})
  );

  const cashFlowPoints = (() => {
    const incomeByMonth: Record<string, number> = {};
    const ts = data?.timeSeriesByBucket || {};
    Object.entries(ts).forEach(([bucket, arr]: [string, any]) => {
      if (!['income', 'net_salary', 'irregular_income'].includes(String(bucket).toLowerCase())) return;
      (arr || []).forEach((point: any) => {
        const month = String(point.month || '');
        const amount = Math.abs(Number(point.amount || 0));
        incomeByMonth[month] = (incomeByMonth[month] || 0) + amount;
      });
    });
    const outgoingByMonth: Record<string, number> = {};
    rowsForCharts.forEach((row: any) => {
      const month = String(row.month || '');
      outgoingByMonth[month] = (outgoingByMonth[month] || 0) + (Number(row.amountPence || 0) / 100);
    });
    const months = Array.from(new Set([...Object.keys(incomeByMonth), ...Object.keys(outgoingByMonth)])).sort();
    return months.map((month) => ({
      month,
      income: incomeByMonth[month] || 0,
      outgoing: outgoingByMonth[month] || 0,
    }));
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
    <div className="container-fluid py-4" style={{ minHeight: '100vh', background: 'linear-gradient(180deg, #0b1220 0%, #111827 100%)' }}>
      {userBadge}
      <div className="d-flex flex-wrap justify-content-between align-items-center mb-4 text-white gap-3">
        <div>
          <h2 className="fw-semibold mb-1">Spend Breakdown</h2>
          <div className="d-flex align-items-center gap-2">
            <Calendar size={16} />
            <span>
              {filter === '7d' && 'Last 7 days'}
              {filter === '30d' && 'Last 30 days'}
              {filter === '60d' && 'Last 60 days'}
              {filter === '90d' && 'Last 90 days'}
              {filter === '6m' && 'Last 6 months'}
              {filter === 'year' && 'This year'}
              {filter === 'all' && 'All history'}
              {filter === 'custom' && 'Custom range'}
            </span>
          </div>
        </div>
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <ButtonGroup>
            <Button variant={filter === '7d' ? 'primary' : 'outline-light'} onClick={() => setFilter('7d')}>7D</Button>
            <Button variant={filter === '30d' ? 'primary' : 'outline-light'} onClick={() => setFilter('30d')}>30D</Button>
            <Button variant={filter === '60d' ? 'primary' : 'outline-light'} onClick={() => setFilter('60d')}>60D</Button>
            <Button variant={filter === '90d' ? 'primary' : 'outline-light'} onClick={() => setFilter('90d')}>90D</Button>
            <Button variant={filter === '6m' ? 'primary' : 'outline-light'} onClick={() => setFilter('6m')}>6M</Button>
            <Button variant={filter === 'year' ? 'primary' : 'outline-light'} onClick={() => setFilter('year')}>Year</Button>
            <Button variant={filter === 'all' ? 'primary' : 'outline-light'} onClick={() => setFilter('all')}>All</Button>
            <Button variant={filter === 'custom' ? 'primary' : 'outline-light'} onClick={() => setFilter('custom')}>Custom</Button>
          </ButtonGroup>
          <Form.Control
            type="date"
            size="sm"
            value={startDate}
            onChange={(e) => {
              setFilter('custom');
              setStartDate(e.target.value);
            }}
            style={{ maxWidth: 150 }}
          />
          <Form.Control
            type="date"
            size="sm"
            value={endDate}
            onChange={(e) => {
              setFilter('custom');
              setEndDate(e.target.value);
            }}
            style={{ maxWidth: 150 }}
          />
          <Button variant="outline-light" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Spinner animation="border" size="sm" className="me-1" /> : <RefreshCw size={16} className="me-1" />}
            Refresh
          </Button>
        </div>
      </div>

      <Row className="g-3 mb-3">
        <Col md={3}>
          <Form.Label className="text-white-50 small">Bucket</Form.Label>
          <Form.Select size="sm" value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
            <option value="all">All buckets</option>
            {bucketOptions.map((bucket) => (
              <option key={bucket} value={bucket}>{bucket}</option>
            ))}
          </Form.Select>
        </Col>
        <Col md={3}>
          <Form.Label className="text-white-50 small">Category</Form.Label>
          <Form.Select size="sm" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="all">All categories</option>
            {categoryOptions.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </Form.Select>
        </Col>
        <Col md={3}>
          <Form.Label className="text-white-50 small">Merchant</Form.Label>
          <Form.Select size="sm" value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)}>
            <option value="all">All merchants</option>
            {merchantOptions.map((merchant) => (
              <option key={merchant} value={merchant}>{merchant}</option>
            ))}
          </Form.Select>
        </Col>
        <Col md={3}>
          <Form.Label className="text-white-50 small">Recommended action</Form.Label>
          <Form.Select size="sm" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as ActionFilter)}>
            <option value="all">All</option>
            <option value="with">With action</option>
            <option value="without">Without action</option>
          </Form.Select>
        </Col>
      </Row>

      <Row className="g-4">
        <Col lg={8}>
          <PremiumCard title="Spend Breakdown (Buckets → Categories → Merchants)" icon={Activity} height={540} className="position-relative">
            <div className="small text-muted mb-2">Sankey of spend direction using the active filters.</div>
            <ReactECharts option={sankeyOption} style={{ height: '100%' }} />
          </PremiumCard>
        </Col>
        <Col lg={4}>
          <div className="d-flex flex-column gap-3">
            <PremiumCard title="Total Spend" icon={Activity}>
              <h2 className="fw-bold mb-1 text-danger" style={{ fontSize: '2.1rem' }}>{formatMoney(totalSpend, 0)}</h2>
              <div className="mt-2 text-muted small">Calculated from filtered bucket/category/merchant rows.</div>
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
            <div className="small text-muted mb-2">Outgoing respects selected filters; income tracks selected date range.</div>
            <ReactECharts option={cashFlowOption} style={{ height: '100%' }} />
          </PremiumCard>
        </Col>
        <Col lg={4}>
          <PremiumCard title="Spend Anomalies" icon={Activity} height={320}>
            {Array.isArray(data.anomalyTransactions) && data.anomalyTransactions.length ? (
              <div className="small text-muted overflow-auto" style={{ maxHeight: 240 }}>
                <table className="table table-sm table-striped mb-0">
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
