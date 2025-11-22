// react-app/src/components/finance/FinanceDashboardAdvanced.tsx
import React, { useEffect, useState } from 'react';
import { Card, Spinner, Alert, Row, Col, ProgressBar, Form, Badge } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import {
    PieChart, Pie, Cell, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    LineChart, Line, ResponsiveContainer, AreaChart, Area, Sankey
} from 'recharts';
import { Brain, Edit2 } from 'lucide-react';

// Premium color palette
const COLORS = {
    mandatory: '#FF6384',
    discretionary: '#36A2EB',
    savings: '#FFCE56',
    income: '#4BC0C0',
    unspecified: '#C9CBCF',
    background: '#1e1e2f',
    cardBg: '#27293d',
    text: '#ffffff',
    textMuted: '#9a9a9a',
    grid: 'rgba(255, 255, 255, 0.1)'
};

const THEME_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#FF6384', '#36A2EB', '#FFCE56'];

// Define types based on backend response
interface DashboardData {
    totalSpend: number;
    spendByBucket: Record<string, number>;
    spendByCategory: Record<string, number>;
    spendByTheme: Record<string, number>;
    spendByGoal: Record<string, number>;
    timeSeriesByGoal: Record<string, Array<{ month: string, amount: number }>>;
    timeSeriesByBucket: Record<string, Array<{ month: string, amount: number }>>;
    timeSeriesByCategory: Record<string, Array<{ month: string, amount: number }>>;
    totalSubscriptionSpend: number;
    totalDiscretionarySpend: number;
    goalProgress: Array<{
        id: string;
        title: string;
        targetAmount: number;
        currentAmount: number;
        linkedPotName: string | null;
        status: number;
    }>;
    burnDown?: Array<{ day: number, ideal: number, actual: number | null }>;
    recentTransactions: Array<{
        id: string;
        merchantName: string;
        amount: number;
        categoryKey: string;
        categoryLabel: string;
        createdAt: any;
        isSubscription?: boolean;
    }>;
}

const FinanceDashboardAdvanced: React.FC = () => {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'month' | 'quarter' | 'year'>('month');
    const [llmSummary, setLlmSummary] = useState<string | null>(null);

    const [viewMode, setViewMode] = useState<'category' | 'bucket'>('category');
    const [editingTx, setEditingTx] = useState<any>(null);
    const [newCategory, setNewCategory] = useState('');

    const fetchData = async () => {
        setLoading(true);
        try {
            // Calculate dates based on filter
            const now = new Date();
            let startDate = new Date();
            let endDate = new Date();

            if (filter === 'month') {
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
                endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            } else if (filter === 'quarter') {
                const q = Math.floor(now.getMonth() / 3);
                startDate = new Date(now.getFullYear(), q * 3, 1);
                endDate = new Date(now.getFullYear(), (q + 1) * 3, 0);
            } else if (filter === 'year') {
                startDate = new Date(now.getFullYear(), 0, 1);
                endDate = new Date(now.getFullYear(), 11, 31);
            }

            const fetchDashboardData = httpsCallable(functions, 'fetchDashboardData');
            const result = await fetchDashboardData({
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            });

            const d = (result.data as any).data as DashboardData;
            setData(d);

            // Generate simple heuristic summary (placeholder for LLM)
            const topCat = Object.entries(d.spendByCategory).sort((a, b) => b[1] - a[1])[0];
            const summary = `You've spent ${formatCurrency(Math.abs(d.totalSpend) / 100)} this ${filter}. Top spending category is ${topCat ? topCat[0] : 'none'}.`;
            setLlmSummary(summary);

        } catch (err) {
            console.error(err);
            setError('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [filter]);

    if (loading) {
        return (
            <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
                <Spinner animation="border" variant="primary" />
            </div>
        );
    }

    if (error) {
        return <Alert variant="danger">{error}</Alert>;
    }

    if (!data) return null;

    // Transform data for charts
    const bucketData = Object.entries(data.spendByBucket)
        .map(([key, value]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), value: Math.abs(value) / 100 }))
        .filter(d => d.value > 0);

    const categoryData = Object.entries(data.spendByCategory)
        .map(([key, value]) => ({ name: key, value: Math.abs(value) / 100 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);

    const themeData = Object.entries(data.spendByTheme)
        .map(([key, value]) => ({ name: key, value: Math.abs(value) / 100 }))
        .filter(d => d.value > 0);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);

    // Prepare Time Series Data for the selected view
    const timeSeriesSource = viewMode === 'bucket' ? data.timeSeriesByBucket : data.timeSeriesByCategory;
    // Flatten for LineChart: [{ month: '2023-01', groceries: 100, rent: 500 }, ...]
    const allMonths = new Set<string>();
    Object.values(timeSeriesSource || {}).forEach(arr => arr.forEach(d => allMonths.add(d.month)));
    const sortedMonths = Array.from(allMonths).sort();

    const trendData = sortedMonths.map(month => {
        const row: any = { month };
        Object.entries(timeSeriesSource || {}).forEach(([key, arr]) => {
            const entry = arr.find(d => d.month === month);
            if (entry) row[key] = Math.abs(entry.amount) / 100;
        });
        return row;
    });

    const activeKeys = Object.keys(timeSeriesSource || {}).slice(0, 5); // Limit lines to top 5

    // Prepare Sankey Data
    const sankeyNodes: { name: string }[] = [{ name: 'Total Spend' }];
    const sankeyLinks: { source: number; target: number; value: number }[] = [];
    const nodeMap = new Map<string, number>();
    nodeMap.set('Total Spend', 0);

    // Add Buckets
    Object.entries(data.spendByBucket).forEach(([bucket, val]) => {
        if (val < 0) {
            const name = bucket.charAt(0).toUpperCase() + bucket.slice(1);
            if (!nodeMap.has(name)) {
                nodeMap.set(name, sankeyNodes.length);
                sankeyNodes.push({ name });
            }
            sankeyLinks.push({ source: 0, target: nodeMap.get(name)!, value: Math.abs(val) / 100 });
        }
    });

    // Add Categories
    Object.entries(data.spendByCategory).forEach(([cat, val]) => {
        if (val < 0) {
            // Find which bucket this category belongs to (heuristic or map)
            // For now, we don't have direct category->bucket map in dashboard data, 
            // but we can infer or just link from bucket if we had the map.
            // Since we don't have the map easily available here without passing it, 
            // we might need to fetch it or just link from 'Total Spend' if we can't link to bucket.
            // BUT, the user wants "Spend tracking look like thjis" (Sankey).
            // Ideally: Total -> Bucket -> Category.
            // I'll use a simplified flow: Total -> Category for now if bucket mapping is missing, 
            // OR I can use the `spendByBucket` to just show Total -> Bucket.
            // Wait, `spendByCategory` keys are like 'groceries'.
            // I'll try to link them to buckets if I can.
            // Actually, I can't easily know the bucket for each category without the map.
            // I'll just do Total -> Buckets for now as it's robust.
            // User asked for "individual transactions... make the spend tracking look like this".
            // The image shows "Total Expenses" -> Categories.
            // So I will do Total -> Top 15 Categories.

            const name = cat;
            if (!nodeMap.has(name)) {
                nodeMap.set(name, sankeyNodes.length);
                sankeyNodes.push({ name });
            }
            // Link from Total directly for now as I lack the bucket map here.
            // sankeyLinks.push({ source: 0, target: nodeMap.get(name)!, value: Math.abs(val) / 100 });
        }
    });

    // REVISED SANKEY: Total -> Buckets. 
    // And if I can, Buckets -> Categories. 
    // I'll just do Total -> Buckets for now as it's robust.
    // User asked for "individual transactions... make the spend tracking look like this".
    // The image shows "Total Expenses" -> Categories.
    // So I will do Total -> Top 15 Categories.

    const sankeyNodes2: { name: string }[] = [{ name: 'Total Expenses' }];
    const sankeyLinks2: { source: number; target: number; value: number }[] = [];

    Object.entries(data.spendByCategory)
        .sort((a, b) => a[1] - b[1]) // Sort by spend (negative) ascending (most negative first)
        .slice(0, 15)
        .forEach(([cat, val]) => {
            if (val < 0) {
                const name = cat;
                sankeyNodes2.push({ name });
                sankeyLinks2.push({ source: 0, target: sankeyNodes2.length - 1, value: Math.abs(val) / 100 });
            }
        });

    const handleEditTx = (tx: any) => {
        setEditingTx(tx);
        setNewCategory(tx.categoryKey || '');
    };

    const saveTxCategory = async () => {
        if (!editingTx) return;
        try {
            const fn = httpsCallable(functions, 'setTransactionCategoryOverride');
            await fn({ transactionId: editingTx.id, categoryKey: newCategory });
            setEditingTx(null);
            fetchData(); // Refresh
        } catch (e) {
            console.error(e);
            alert('Failed to save category');
        }
    };

    return (
        <div className="container-fluid py-4" style={{ backgroundColor: '#f8f9fa', minHeight: '100vh' }}>
            <div className="d-flex justify-content-between align-items-center mb-4">
                <div>
                    <h2 className="fw-bold mb-0">Financial Analytics</h2>
                    <p className="text-muted mb-0">Overview of spending, themes, and goal progress</p>
                </div>
                <div className="d-flex gap-3 align-items-center">
                    <Form.Select
                        value={filter}
                        onChange={(e) => setFilter(e.target.value as any)}
                        style={{ width: 'auto' }}
                    >
                        <option value="month">This Month</option>
                        <option value="quarter">This Quarter</option>
                        <option value="year">This Year</option>
                    </Form.Select>
                    <div className="text-end">
                        <h3 className="fw-bold text-primary mb-0">{formatCurrency(Math.abs(data.totalSpend) / 100)}</h3>
                        <small className="text-muted">Total Spend</small>
                    </div>
                </div>
            </div>

            {/* LLM Summary / Insights */}
            <Card className="mb-4 border-0 shadow-sm bg-white">
                <Card.Body className="d-flex align-items-start gap-3">
                    <div className="p-2 bg-light rounded-circle text-primary">
                        <Brain size={24} />
                    </div>
                    <div>
                        <h5 className="fw-bold mb-1">AI Insights</h5>
                        <p className="mb-0 text-muted">{llmSummary}</p>
                    </div>
                </Card.Body>
            </Card>

            {/* Subscription & Discretionary Metrics */}
            <Row className="g-4 mb-4">
                <Col md={6}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <h5 className="fw-bold mb-0">Subscription Spend</h5>
                                <Badge bg="warning" text="dark">Monthly Recurring</Badge>
                            </div>
                            <h3 className="fw-bold mb-1">{formatCurrency(Math.abs(data.totalSubscriptionSpend || 0) / 100)}</h3>
                            <p className="text-muted small mb-0">Total spend on flagged subscriptions this period.</p>
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={6}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <h5 className="fw-bold mb-0">Discretionary Spend</h5>
                                <Badge bg="info">Flexible</Badge>
                            </div>
                            <h3 className="fw-bold mb-1">{formatCurrency(Math.abs(data.totalDiscretionarySpend || 0) / 100)}</h3>
                            <p className="text-muted small mb-0">Spend on non-essential items (Dining, Shopping, etc).</p>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Sankey Diagram */}
            <Card className="mb-4 border-0 shadow-sm">
                <Card.Header className="bg-white border-0 pt-4 px-4">
                    <h5 className="fw-bold mb-0">Spending Flow</h5>
                </Card.Header>
                <Card.Body>
                    <div style={{ height: 400 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <Sankey
                                data={{ nodes: sankeyNodes2, links: sankeyLinks2 }}
                                node={{ stroke: '#77c878', strokeWidth: 2 }}
                                nodePadding={50}
                                margin={{ left: 20, right: 20, top: 20, bottom: 20 }}
                                link={{ stroke: '#77c878' }}
                            >
                                <Tooltip />
                            </Sankey>
                        </ResponsiveContainer>
                    </div>
                </Card.Body>
            </Card>

            {/* Spending Breakdown with Toggle */}
            <Card className="mb-4 border-0 shadow-sm">
                <Card.Header className="bg-white border-0 pt-4 px-4 d-flex justify-content-between align-items-center">
                    <h5 className="fw-bold mb-0">Spending Breakdown</h5>
                    <div className="btn-group">
                        <button
                            className={`btn btn-sm ${viewMode === 'category' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setViewMode('category')}
                        >
                            By Category
                        </button>
                        <button
                            className={`btn btn-sm ${viewMode === 'bucket' ? 'btn-primary' : 'btn-outline-primary'}`}
                            onClick={() => setViewMode('bucket')}
                        >
                            By Bucket
                        </button>
                    </div>
                </Card.Header>
                <Card.Body>
                    <Row>
                        <Col lg={6}>
                            <h6 className="text-muted mb-3 text-center">Distribution</h6>
                            <div style={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={viewMode === 'bucket' ? bucketData : categoryData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        >
                                            {(viewMode === 'bucket' ? bucketData : categoryData).map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={THEME_COLORS[index % THEME_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                        <Legend verticalAlign="bottom" height={36} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </Col>
                        <Col lg={6}>
                            <h6 className="text-muted mb-3 text-center">Trend Over Time</h6>
                            <div style={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="month" />
                                        <YAxis tickFormatter={(val) => `£${val}`} />
                                        <Tooltip formatter={(val: number) => formatCurrency(val)} />
                                        <Legend />
                                        {activeKeys.map((key, index) => (
                                            <Area
                                                key={key}
                                                type="monotone"
                                                dataKey={key}
                                                stackId="1"
                                                stroke={THEME_COLORS[index % THEME_COLORS.length]}
                                                fill={THEME_COLORS[index % THEME_COLORS.length]}
                                            />
                                        ))}
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </Col>
                    </Row>
                </Card.Body>
            </Card>

            {/* Budget Burn Down (Only show for Month view) */}
            {filter === 'month' && data.burnDown && (
                <Card className="mb-4 border-0 shadow-sm">
                    <Card.Body>
                        <h5 className="fw-bold mb-3">Monthly Budget Burn Down</h5>
                        <div style={{ height: 300 }}>
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={data.burnDown}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                    <XAxis dataKey="day" />
                                    <YAxis tickFormatter={(val) => `£${val / 100}`} />
                                    <Tooltip formatter={(val: number) => formatCurrency(val / 100)} />
                                    <Legend />
                                    <Line type="monotone" dataKey="ideal" stroke="#adb5bd" strokeDasharray="5 5" name="Ideal Path" dot={false} />
                                    <Line type="monotone" dataKey="actual" stroke="#0d6efd" strokeWidth={3} name="Actual Remaining" />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    </Card.Body>
                </Card>
            )}

            {/* Transaction List */}
            <Card className="mb-4 border-0 shadow-sm">
                <Card.Header className="bg-white border-0 pt-4 px-4">
                    <h5 className="fw-bold mb-0">Recent Transactions</h5>
                </Card.Header>
                <Card.Body>
                    <div className="table-responsive">
                        <table className="table table-hover align-middle">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Merchant</th>
                                    <th>Category</th>
                                    <th className="text-end">Amount</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.recentTransactions?.map(tx => (
                                    <tr key={tx.id}>
                                        <td>{new Date(tx.createdAt._seconds * 1000).toLocaleDateString()}</td>
                                        <td>
                                            {tx.merchantName}
                                            {tx.isSubscription && <Badge bg="warning" text="dark" className="ms-2">Sub</Badge>}
                                        </td>
                                        <td>
                                            <Badge bg="light" text="dark" className="border">
                                                {tx.categoryLabel || tx.categoryKey}
                                            </Badge>
                                        </td>
                                        <td className="text-end">{formatCurrency(Math.abs(tx.amount) / 100)}</td>
                                        <td className="text-end">
                                            <button className="btn btn-sm btn-link text-secondary" onClick={() => handleEditTx(tx)}>
                                                <Edit2 size={16} />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card.Body>
            </Card>

            {/* Edit Category Modal */}
            {editingTx && (
                <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                    <div className="modal-dialog">
                        <div className="modal-content">
                            <div className="modal-header">
                                <h5 className="modal-title">Edit Category</h5>
                                <button type="button" className="btn-close" onClick={() => setEditingTx(null)}></button>
                            </div>
                            <div className="modal-body">
                                <p><strong>Merchant:</strong> {editingTx.merchantName}</p>
                                <Form.Group>
                                    <Form.Label>Category</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={newCategory}
                                        onChange={(e) => setNewCategory(e.target.value)}
                                        placeholder="e.g. groceries, dining_out"
                                    />
                                    <Form.Text className="text-muted">Enter category key (e.g. 'groceries')</Form.Text>
                                </Form.Group>
                            </div>
                            <div className="modal-footer">
                                <button type="button" className="btn btn-secondary" onClick={() => setEditingTx(null)}>Cancel</button>
                                <button type="button" className="btn btn-primary" onClick={saveTxCategory}>Save Changes</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Goal Progress Section */}
            <h4 className="fw-bold mb-3">Goal Progress</h4>
            <Row className="g-4 mb-4">
                {data.goalProgress.map((goal) => {
                    const progress = goal.targetAmount > 0
                        ? Math.min(100, (goal.currentAmount / goal.targetAmount) * 100)
                        : 0;
                    const isCompleted = progress >= 100;

                    // Get time series for this goal if available
                    const timeSeries = data.timeSeriesByGoal[goal.id]?.map(d => ({
                        ...d,
                        amount: Math.abs(d.amount) / 100 // Convert to pounds
                    })) || [];

                    return (
                        <Col md={6} xl={4} key={goal.id}>
                            <Card className="h-100 shadow-sm border-0">
                                <Card.Body>
                                    <div className="d-flex justify-content-between align-items-start mb-2">
                                        <h5 className="fw-bold mb-0 text-truncate" title={goal.title}>{goal.title}</h5>
                                        {goal.linkedPotName && (
                                            <Badge bg="success" className="ms-2">
                                                <i className="bi bi-bank me-1"></i>
                                                {goal.linkedPotName}
                                            </Badge>
                                        )}
                                    </div>

                                    <div className="mb-3">
                                        <div className="d-flex justify-content-between mb-1">
                                            <small className="text-muted">Progress</small>
                                            <small className="fw-bold">{progress.toFixed(1)}%</small>
                                        </div>
                                        <ProgressBar
                                            now={progress}
                                            variant={isCompleted ? "success" : "primary"}
                                            style={{ height: '8px', borderRadius: '4px' }}
                                        />
                                        <div className="d-flex justify-content-between mt-1">
                                            <small className="text-muted">{formatCurrency(goal.currentAmount / 100)} saved</small>
                                            <small className="text-muted">Target: {formatCurrency(goal.targetAmount / 100)}</small>
                                        </div>
                                    </div>

                                    {timeSeries.length > 0 && (
                                        <div style={{ height: 100, marginTop: '1rem' }}>
                                            <ResponsiveContainer width="100%" height="100%">
                                                <AreaChart data={timeSeries}>
                                                    <defs>
                                                        <linearGradient id={`colorGradient-${goal.id}`} x1="0" y1="0" x2="0" y2="1">
                                                            <stop offset="5%" stopColor="#82ca9d" stopOpacity={0.8} />
                                                            <stop offset="95%" stopColor="#82ca9d" stopOpacity={0} />
                                                        </linearGradient>
                                                    </defs>
                                                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                                    <Area
                                                        type="monotone"
                                                        dataKey="amount"
                                                        stroke="#82ca9d"
                                                        fillOpacity={1}
                                                        fill={`url(#colorGradient-${goal.id})`}
                                                    />
                                                </AreaChart>
                                            </ResponsiveContainer>
                                            <small className="text-muted d-block text-center mt-1">Recent Activity</small>
                                        </div>
                                    )}
                                </Card.Body>
                            </Card>
                        </Col>
                    );
                })}
                {data.goalProgress.length === 0 && (
                    <Col>
                        <Alert variant="info">
                            No active goals found. Create goals and link them to Monzo pots to see progress here.
                        </Alert>
                    </Col>
                )}
            </Row>
        </div>
    );
};

export default FinanceDashboardAdvanced;
