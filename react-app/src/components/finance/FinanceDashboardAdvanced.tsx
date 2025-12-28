import React, { useEffect, useState } from 'react';
import { Row, Col, Spinner, Alert, Form, Button, Badge, ButtonGroup } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { PremiumCard } from '../common/PremiumCard';
import ReactECharts from 'echarts-for-react';
import {
    TrendingUp, PieChart as PieIcon,
    Calendar, RefreshCw, Filter, DollarSign,
    ArrowUpRight, ArrowDownRight, CreditCard, Layers
} from 'lucide-react';

const THEME_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#FF6384', '#36A2EB', '#FFCE56'];

const FinanceDashboardAdvanced: React.FC = () => {
    const { currentUser } = useAuth();
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const [filter, setFilter] = useState<'month' | 'quarter' | 'year'>('month');
    const [startDate, setStartDate] = useState<string>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState<string>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    });
    const [viewMode, setViewMode] = useState<'category' | 'bucket'>('category');
    const [editingTx, setEditingTx] = useState<any>(null);
    const [newCategory, setNewCategory] = useState('');

    // Dynamic Theme Colors
    const colors = {
        text: isDark ? '#ffffff' : '#2c3e50',
        textMuted: isDark ? '#9a9a9a' : '#6c757d',
        grid: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        primary: '#e14eca',
        success: '#00f2c3',
        danger: '#fd5d93',
        warning: '#ff8d72',
        info: '#1d8cf8',
        cardBg: isDark ? '#27293d' : '#ffffff',
    };

    const fetchData = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            // Fetch Profile for Sync Status
            const profileSnap = await getDoc(doc(db, 'profiles', currentUser.uid));
            if (profileSnap.exists()) {
                const p = profileSnap.data();
                if (p.monzoLastSyncAt) {
                    setLastSync(p.monzoLastSyncAt.toDate ? p.monzoLastSyncAt.toDate() : new Date(p.monzoLastSyncAt));
                }
            }

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
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // Legacy global hook for older UI buttons/modal expecting refreshMonzoData
        (window as any).refreshMonzoData = async () => {
            const fn = httpsCallable(functions, 'syncMonzoNow');
            await fn({});
            await fetchData();
        };
    }, [filter, startDate, endDate, currentUser]);

    const handleSync = async () => {
        setSyncing(true);
        try {
            const fn = httpsCallable(functions, 'syncMonzoNow');
            await fn();
            await fetchData();
        } catch (e: any) {
            alert('Sync failed: ' + e.message);
        } finally {
            setSyncing(false);
        }
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);

    if (loading && !data) return <div className="p-5 text-center"><Spinner animation="border" variant="primary" /></div>;
    if (!data) return <Alert variant="danger">Failed to load data.</Alert>;

    const userBadge = (
        <div className="d-flex justify-content-end mb-2">
            <span className="small text-muted">Signed in as: <code>{currentUser?.uid || '—'}</code></span>
        </div>
    );

    // Prepare Data
    const bucketEntries = Object.entries(data.spendByBucket || {}).filter(([key]) => key !== 'bank_transfer' && key !== 'unknown');
    const bucketData = bucketEntries
        .map(([key, value]: [string, any]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), value: Math.abs(value) / 100 }))
        .filter(d => d.value > 0);

    const categoryData = Object.entries(data.spendByCategory || {})
        .filter(([key]) => key !== 'bank_transfer' && key !== 'unknown')
        .map(([key, value]: [string, any]) => ({ name: key, value: Math.abs(value) / 100 }))
        .sort((a, b) => b.value - a.value);

    const timeSeriesSourceRaw = viewMode === 'bucket' ? data.timeSeriesByBucket : data.timeSeriesByCategory;
    const timeSeriesSource = Object.fromEntries(
        Object.entries(timeSeriesSourceRaw || {}).filter(([key]) => key !== 'bank_transfer')
    );
    const allMonths = new Set<string>();
    Object.values(timeSeriesSource || {}).forEach((arr: any) => arr.forEach((d: any) => allMonths.add(d.month)));
    const sortedMonths = Array.from(allMonths).sort();
    const trendData = sortedMonths.map(month => {
        const row: any = { month };
        Object.entries(timeSeriesSource || {}).forEach(([key, arr]: [string, any]) => {
            const entry = arr.find((d: any) => d.month === month);
            if (entry) row[key] = Math.abs(entry.amount) / 100;
        });
        return row;
    });
    const activeKeys = Object.keys(timeSeriesSource || {}).slice(0, 5);

    const bankTransferAmount = (data.spendByBucket?.bank_transfer ?? 0);
    const filteredTotalSpend = Math.abs((data.totalSpend || 0) - bankTransferAmount) / 100;

    const trendOption = {
        tooltip: { trigger: 'axis' },
        legend: { data: activeKeys },
        grid: { left: 50, right: 10, top: 30, bottom: 20 },
        xAxis: { type: 'category', data: trendData.map((r: any) => r.month) },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `£${v}` } },
        series: activeKeys.map((key, idx) => ({
            name: key,
            type: 'line',
            stack: 'spend',
            areaStyle: { opacity: 0.2 },
            data: trendData.map((row: any) => Math.abs(row[key] || 0)),
            color: THEME_COLORS[idx % THEME_COLORS.length],
            smooth: true,
            emphasis: { focus: 'series' }
        })),
    };

    const bucketOption = {
        tooltip: { trigger: 'item', valueFormatter: (v: number) => `£${v}` },
        legend: { orient: 'horizontal', bottom: 0 },
        series: [
            {
                type: 'pie',
                radius: ['40%', '70%'],
                label: { show: false },
                data: bucketData.map((d: any, idx: number) => ({
                    value: d.value,
                    name: d.name,
                    itemStyle: { color: THEME_COLORS[idx % THEME_COLORS.length] },
                })),
            },
        ],
    };

    // Local distribution override from transactions to reflect per-transaction overrides
    const localDistribution = ((data.recentTransactions || []) as any[])
        .filter((tx) => {
            const cat = (tx.userCategoryKey || tx.categoryKey || tx.categoryType || '').toLowerCase();
            return cat && cat !== 'bank_transfer' && cat !== 'unknown';
        })
        .reduce((acc: Record<string, number>, tx: any) => {
            const label = tx.userCategoryLabel || tx.categoryLabel || tx.categoryKey || tx.categoryType || 'Uncategorised';
            const rawAmt = typeof tx.amount === 'number' && Math.abs(tx.amount) < 10 ? tx.amount * 100 : tx.amount;
            const amt = Math.abs(rawAmt || 0) / 100;
            acc[label] = (acc[label] || 0) + amt;
            return acc;
        }, {} as Record<string, number>);

    const distributionSource = (() => {
        const local = Object.entries(localDistribution).map(([name, value]) => ({ name, value }));
        if (local.length) return local;
        return viewMode === 'bucket' ? bucketData : categoryData;
    })();
    const distributionOption = {
        tooltip: { trigger: 'item', valueFormatter: (v: number) => `£${v}` },
        legend: { orient: 'horizontal', bottom: 0 },
        series: [
            {
                type: 'pie',
                radius: ['50%', '70%'],
                avoidLabelOverlap: false,
                itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                data: distributionSource.map((d: any, idx: number) => ({
                    value: d.value,
                    name: d.name,
                    itemStyle: { color: THEME_COLORS[idx % THEME_COLORS.length] },
                })),
            },
        ],
    };

    const filteredRecentTransactions = (data.recentTransactions || []).filter(
        (tx: any) => {
            const cat = (tx.categoryKey || tx.categoryType || '').toLowerCase();
            return cat !== 'bank_transfer' && cat !== 'unknown';
        }
    ).map((tx: any) => {
        // Normalize amount if in minor units
        const amt = typeof tx.amount === 'number' && Math.abs(tx.amount) < 10 ? tx.amount * 100 : tx.amount;
        return { ...tx, amount: amt };
    });

    return (
        <div className="container-fluid py-4" style={{ backgroundColor: isDark ? '#1e1e2f' : '#f4f5f7', minHeight: '100vh', color: colors.text }}>
            {userBadge}
            {/* Header */}
            <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-5 gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Financial Overview</h2>
                    <div className="d-flex align-items-center gap-2 text-muted">
                        <Calendar size={16} />
                        <span>{filter === 'month' ? 'This Month' : filter === 'quarter' ? 'This Quarter' : 'This Year'}</span>
                        {lastSync && (
                            <>
                                <span className="mx-1">•</span>
                                <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                                <small>Synced {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                            </>
                        )}
                    </div>
                </div>
                <div className="d-flex gap-2">
                    <ButtonGroup>
                        <Button variant={filter === 'month' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('month')}>Month</Button>
                        <Button variant={filter === 'quarter' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('quarter')}>Quarter</Button>
                        <Button variant={filter === 'year' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('year')}>Year</Button>
                    </ButtonGroup>
                    <Form.Control type="date" size="sm" value={startDate} onChange={(e)=>setStartDate(e.target.value)} style={{ maxWidth: 150 }} />
                    <Form.Control type="date" size="sm" value={endDate} onChange={(e)=>setEndDate(e.target.value)} style={{ maxWidth: 150 }} />
                    <Button variant="outline-primary" onClick={handleSync} disabled={syncing}>
                        {syncing ? <Spinner size="sm" animation="border" /> : <RefreshCw size={18} />}
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <Row className="g-4 mb-4">
                <Col md={4}>
                    <PremiumCard icon={DollarSign} title="Total Spend">
                        <h2 className="fw-bold mb-0" style={{ color: colors.danger }}>
                            {formatCurrency(filteredTotalSpend)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">
                            <ArrowUpRight size={16} className="text-danger me-1" />
                            vs last period (N/A)
                        </p>
                    </PremiumCard>
                </Col>
                <Col md={4}>
                    <PremiumCard icon={CreditCard} title="Discretionary">
                        <h2 className="fw-bold mb-0" style={{ color: colors.info }}>
                            {formatCurrency(Math.abs(data.totalDiscretionarySpend || 0) / 100)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">
                            Safe to spend
                        </p>
                    </PremiumCard>
                </Col>
                <Col md={4}>
                    <PremiumCard icon={Layers} title="Subscriptions">
                        <h2 className="fw-bold mb-0" style={{ color: colors.warning }}>
                            {formatCurrency(Math.abs(data.totalSubscriptionSpend || 0) / 100)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">
                            Recurring costs
                        </p>
                    </PremiumCard>
                </Col>
            </Row>

            {/* Main Charts */}
            <Row className="g-4 mb-4">
                <Col lg={8}>
                    <PremiumCard title="Spend Trend" icon={TrendingUp} height={350}>
                        <ReactECharts option={trendOption} style={{ height: '100%' }} />
                    </PremiumCard>
                </Col>
                <Col lg={4}>
                    <PremiumCard
                        title="Distribution"
                        icon={PieIcon}
                        height={350}
                        action={
                            <ButtonGroup size="sm">
                            <Button variant={viewMode === 'category' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('category')}>Cat</Button>
                            <Button variant={viewMode === 'bucket' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('bucket')}>Bkt</Button>
                        </ButtonGroup>
                    }
                    >
                        <ReactECharts option={distributionOption} style={{ height: '100%' }} />
                    </PremiumCard>
                </Col>
            </Row>

            {/* Bucket split */}
            <Row className="mb-4">
                <Col>
                    <PremiumCard title="Spend by Bucket" icon={PieIcon} height={340}>
                        <ReactECharts option={bucketOption} style={{ height: '100%' }} />
                    </PremiumCard>
                </Col>
            </Row>

            {/* Transactions */}
            <Row>
                <Col>
                    <PremiumCard title="Recent Transactions" icon={CreditCard}>
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0" style={{ color: colors.text }}>
                                <thead>
                                    <tr style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.grid}` }}>
                                        <th>Date</th>
                                        <th>Merchant</th>
                                        <th>Pot</th>
                                        <th>Category</th>
                                        <th className="text-end">Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRecentTransactions?.map((tx: any) => (
                                <tr key={tx.id} style={{ borderColor: colors.grid }}>
                                    <td>{new Date(tx.createdAt._seconds * 1000).toLocaleDateString()}</td>
                                    <td>
                                        <div className="fw-bold">{tx.merchantName}</div>
                                        {tx.isSubscription && <Badge bg="warning" text="dark" className="mt-1">Sub</Badge>}
                                            </td>
                                            <td>{tx.potName || '—'}</td>
                                            <td>
                                                <Badge bg="light" text="dark" className="border">
                                                    {tx.categoryLabel || tx.categoryKey}
                                                </Badge>
                                            </td>
                                            <td className="text-end fw-bold" style={{ color: tx.amount < 0 ? colors.text : colors.success }}>
                                                {formatCurrency(Math.abs(tx.amount) / 100)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </PremiumCard>
                </Col>
            </Row>
        </div>
    );
};

export default FinanceDashboardAdvanced;
