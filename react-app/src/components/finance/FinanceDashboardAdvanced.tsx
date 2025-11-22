// react-app/src/components/finance/FinanceDashboardAdvanced.tsx
import React, { useEffect, useState } from 'react';
import { Card, Spinner, Alert, Row, Col, ProgressBar, Form, Badge } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';
import {
    PieChart, Pie, Cell, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
    LineChart, Line, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { Brain } from 'lucide-react';

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

const THEME_COLORS = [
    '#e040fb', '#00e676', '#2979ff', '#ff9100', '#ff1744', '#00b0ff'
];

// Define types based on backend response
interface DashboardData {
    totalSpend: number;
    spendByBucket: Record<string, number>;
    spendByCategory: Record<string, number>;
    spendByTheme: Record<string, number>;
    spendByGoal: Record<string, number>;
    timeSeriesByGoal: Record<string, Array<{ month: string, amount: number }>>;
    goalProgress: Array<{
        id: string;
        title: string;
        targetAmount: number;
        currentAmount: number;
        linkedPotName: string | null;
        status: number;
    }>;
    burnDown?: Array<{ day: number, ideal: number, actual: number | null }>;
}

const FinanceDashboardAdvanced: React.FC = () => {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<'month' | 'quarter' | 'year'>('month');
    const [llmSummary, setLlmSummary] = useState<string | null>(null);

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
            const summary = `You've spent £${(Math.abs(d.totalSpend) / 100).toFixed(2)} this ${filter}. Top spending category is ${topCat ? topCat[0] : 'none'}.`;
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
    }, []);

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
        .map(([key, value]) => ({ name: key, amount: Math.abs(value) / 100 }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8);

    const themeData = Object.entries(data.spendByTheme)
        .map(([key, value]) => ({ name: key, value: Math.abs(value) / 100 }))
        .filter(d => d.value > 0);

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);

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

            {/* Top Row: Buckets & Themes */}
            <Row className="g-4 mb-4">
                <Col md={6} lg={4}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Body>
                            <h5 className="card-title fw-bold mb-3">Spend by Bucket</h5>
                            <div style={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={bucketData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={80}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {bucketData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={Object.values(COLORS)[index % 5]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                        <Legend verticalAlign="bottom" height={36} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                <Col md={6} lg={4}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Body>
                            <h5 className="card-title fw-bold mb-3">Spend by Theme</h5>
                            <div style={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={themeData}
                                            cx="50%"
                                            cy="50%"
                                            outerRadius={80}
                                            dataKey="value"
                                            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        >
                                            {themeData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={THEME_COLORS[index % THEME_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>

                <Col md={12} lg={4}>
                    <Card className="h-100 shadow-sm border-0">
                        <Card.Body>
                            <h5 className="card-title fw-bold mb-3">Top Categories</h5>
                            <div style={{ height: 300 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={categoryData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                        <XAxis type="number" hide />
                                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 12 }} />
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                        <Bar dataKey="amount" fill="#8884d8" radius={[0, 4, 4, 0]}>
                                            {categoryData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={THEME_COLORS[index % THEME_COLORS.length]} />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

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
