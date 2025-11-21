import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Modal, ProgressBar, Row, Spinner, Table } from 'react-bootstrap';
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, where, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { ArrowDown, ArrowUp, CreditCard, DollarSign, PieChart as PieChartIcon, Settings, TrendingUp, Wallet } from 'lucide-react';

// --- Types ---
interface BudgetTotals {
    mandatory: number;
    optional: number;
    savings: number;
    income: number;
}

interface TransactionRow {
    transactionId: string;
    description: string;
    amount: number;
    createdISO: string | null;
    userCategoryType?: string | null;
    userCategoryLabel?: string | null;
    merchantName?: string | null;
    merchantLogo?: string | null;
}

interface BudgetSummaryDoc {
    totals: BudgetTotals;
    monthly?: Record<string, BudgetTotals>;
    spendTimeline?: Array<{ month: string; mandatory: number; optional: number; savings: number; income: number; net?: number }>;
    budgetProgress?: Array<{ key: string; budget: number; actual: number; variance: number; utilisation?: number | null }>;
    categories?: Array<{ label: string; amount: number; count: number; type: string }>;
    currency?: string;
}

interface GoalAlignmentDoc {
    goals?: Array<{
        goalId: string;
        title: string;
        estimatedCost: number;
        potBalance: number;
        fundedPercent: number;
        monthsToSave?: number | null;
        shortfall?: number;
        potName?: string;
    }>;
}

// --- Components ---

const StatCard = ({ title, value, subtext, icon: Icon, trend, color = 'primary' }: any) => (
    <Card className={`border-0 shadow-sm h-100 bg-${color}-subtle`}>
        <Card.Body>
            <div className="d-flex justify-content-between align-items-start mb-2">
                <div className={`p-2 rounded-circle bg-white text-${color}`}>
                    <Icon size={20} />
                </div>
                {trend && (
                    <Badge bg={trend > 0 ? 'danger' : 'success'} pill>
                        {trend > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />} {Math.abs(trend).toFixed(1)}%
                    </Badge>
                )}
            </div>
            <div className="text-muted small text-uppercase fw-bold mb-1">{title}</div>
            <h3 className="mb-0 fw-bold">{value}</h3>
            {subtext && <div className="small text-muted mt-1">{subtext}</div>}
        </Card.Body>
    </Card>
);

const FinanceDashboardModern: React.FC = () => {
    const { currentUser } = useAuth();
    const [summary, setSummary] = useState<BudgetSummaryDoc | null>(null);
    const [alignment, setAlignment] = useState<GoalAlignmentDoc | null>(null);
    const [transactions, setTransactions] = useState<TransactionRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRecomputing, setIsRecomputing] = useState(false);
    const [showBudgetModal, setShowBudgetModal] = useState(false);
    const [budgets, setBudgets] = useState<Record<string, number>>({});

    // --- Data Fetching ---
    useEffect(() => {
        if (!currentUser) return;
        setLoading(true);

        const summaryRef = doc(db, 'monzo_budget_summary', currentUser.uid);
        const alignmentRef = doc(db, 'monzo_goal_alignment', currentUser.uid);
        const budgetRef = doc(db, 'finance_budgets', currentUser.uid);

        const txQuery = query(
            collection(db, 'monzo_transactions'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('createdISO', 'desc'),
            limit(10)
        );

        const unsubSummary = onSnapshot(summaryRef, (snap) => setSummary(snap.data() as BudgetSummaryDoc));
        const unsubAlignment = onSnapshot(alignmentRef, (snap) => setAlignment(snap.data() as GoalAlignmentDoc));
        const unsubTx = onSnapshot(txQuery, (snap) => {
            setTransactions(snap.docs.map(d => {
                const data = d.data();
                return {
                    transactionId: data.transactionId,
                    description: data.description,
                    amount: data.amount,
                    createdISO: data.createdISO,
                    userCategoryType: data.userCategoryType,
                    userCategoryLabel: data.userCategoryLabel,
                    merchantName: data.merchant?.name,
                    merchantLogo: data.merchant?.logo
                } as TransactionRow;
            }));
            setLoading(false);
        });

        getDoc(budgetRef).then(snap => {
            if (snap.exists()) setBudgets(snap.data().byCategory || {});
        });

        return () => { unsubSummary(); unsubAlignment(); unsubTx(); };
    }, [currentUser]);

    // --- Actions ---
    const recomputeAnalytics = async () => {
        if (!currentUser) return;
        setIsRecomputing(true);
        try {
            await httpsCallable(functions, 'recomputeMonzoAnalytics')({});
        } catch (e) {
            console.error(e);
        } finally {
            setIsRecomputing(false);
        }
    };

    const saveBudgets = async () => {
        if (!currentUser) return;
        await setDoc(doc(db, 'finance_budgets', currentUser.uid), { byCategory: budgets }, { merge: true });
        setShowBudgetModal(false);
        recomputeAnalytics();
    };

    // --- Derived Data ---
    const currency = summary?.currency || 'GBP';
    const formatMoney = (val: number) => val.toLocaleString('en-GB', { style: 'currency', currency });

    const burndownData = useMemo(() => {
        // Mock burndown for now, real implementation would need daily aggregates
        // In a real app, we'd aggregate daily spend from transactions
        if (!summary?.budgetProgress) return [];
        const totalBudget = summary.budgetProgress.reduce((acc, b) => acc + b.budget, 0);
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const today = new Date().getDate();

        const data = [];
        let cumulativeSpend = 0;
        // Linear projection for budget line
        for (let i = 1; i <= daysInMonth; i++) {
            const budgetPoint = (totalBudget / daysInMonth) * i;
            // Mock spend accumulation (randomish)
            if (i <= today) {
                cumulativeSpend += (totalBudget / daysInMonth) * (0.8 + Math.random() * 0.4);
            }
            data.push({
                day: i,
                budget: budgetPoint,
                spend: i <= today ? cumulativeSpend : null,
                projected: i > today ? cumulativeSpend + ((totalBudget - cumulativeSpend) / (daysInMonth - today)) * (i - today) : null
            });
        }
        return data;
    }, [summary]);

    const trendData = useMemo(() => {
        return (summary?.spendTimeline || []).slice(-6).map(m => ({
            name: m.month,
            Mandatory: m.mandatory,
            Optional: m.optional,
            Savings: m.savings
        }));
    }, [summary]);

    if (loading) return <div className="d-flex justify-content-center py-5"><Spinner animation="border" /></div>;

    return (
        <Container fluid className="py-2 bg-light min-vh-100">
            {/* Header */}
            <div className="d-flex justify-content-between align-items-center mb-3">
                <div>
                    <h4 className="fw-bold mb-0">Finance Hub</h4>
                </div>
                <div className="d-flex gap-2">
                    <Button variant="white" size="sm" className="shadow-sm" onClick={() => setShowBudgetModal(true)}>
                        <Settings size={16} className="me-1" /> Budgets
                    </Button>
                    <Button variant="white" size="sm" className="shadow-sm" href="/finance/merchants">
                        <CreditCard size={16} className="me-1" /> Merchants
                    </Button>
                    <Button variant="white" size="sm" className="shadow-sm" href="/finance/categories">
                        <PieChartIcon size={16} className="me-1" /> Categories
                    </Button>
                    <Button variant="primary" size="sm" onClick={recomputeAnalytics} disabled={isRecomputing}>
                        {isRecomputing ? <Spinner size="sm" animation="border" className="me-1" /> : <TrendingUp size={16} className="me-1" />}
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Stats Row - Compact */}
            <Row className="g-2 mb-3">
                <Col xs={6} md={3}>
                    <StatCard
                        title="Mandatory"
                        value={formatMoney(summary?.totals.mandatory || 0)}
                        icon={Wallet}
                        color="warning"
                        subtext="Bills, Rent"
                    />
                </Col>
                <Col xs={6} md={3}>
                    <StatCard
                        title="Optional"
                        value={formatMoney(summary?.totals.optional || 0)}
                        icon={CreditCard}
                        color="info"
                        subtext="Dining, Fun"
                    />
                </Col>
                <Col xs={6} md={3}>
                    <StatCard
                        title="Savings"
                        value={formatMoney(summary?.totals.savings || 0)}
                        icon={PieChartIcon}
                        color="success"
                        subtext="Investments"
                    />
                </Col>
                <Col xs={6} md={3}>
                    <StatCard
                        title="Income"
                        value={formatMoney(summary?.totals.income || 0)}
                        icon={DollarSign}
                        color="primary"
                        subtext="Salary"
                    />
                </Col>
            </Row>

            {/* Charts Row - Reduced Height */}
            <Row className="g-2 mb-3">
                <Col lg={8}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Body className="p-2">
                            <Card.Title className="h6">Budget Burndown</Card.Title>
                            <div style={{ height: 220 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={burndownData}>
                                        <defs>
                                            <linearGradient id="colorSpend" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8} />
                                                <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                                        <YAxis tick={{ fontSize: 12 }} />
                                        <Tooltip formatter={(val: number) => formatMoney(val)} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        <Area type="monotone" dataKey="spend" stroke="#8884d8" fillOpacity={1} fill="url(#colorSpend)" name="Actual Spend" />
                                        <Line type="monotone" dataKey="budget" stroke="#82ca9d" strokeDasharray="5 5" dot={false} name="Budget Line" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={4}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Body className="p-2">
                            <Card.Title className="h6">Spend Trends</Card.Title>
                            <div style={{ height: 220 }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={trendData}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                                        <YAxis hide />
                                        <Tooltip formatter={(val: number) => formatMoney(val)} />
                                        <Legend wrapperStyle={{ fontSize: '12px' }} />
                                        <Bar dataKey="Mandatory" stackId="a" fill="#ffc107" />
                                        <Bar dataKey="Optional" stackId="a" fill="#0dcaf0" />
                                        <Bar dataKey="Savings" stackId="a" fill="#198754" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Bottom Row */}
            <Row className="g-2">
                <Col lg={6}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Body className="p-2">
                            <Card.Title className="h6">Goal Projections</Card.Title>
                            <div className="d-flex flex-column gap-2 mt-2 overflow-auto" style={{ maxHeight: '250px' }}>
                                {alignment?.goals?.map(goal => (
                                    <div key={goal.goalId} className="p-2 border rounded bg-white">
                                        <div className="d-flex justify-content-between mb-1">
                                            <span className="fw-semibold small">{goal.title}</span>
                                            <span className="text-muted small" style={{ fontSize: '0.75rem' }}>
                                                {formatMoney(goal.potBalance)} / {formatMoney(goal.estimatedCost)}
                                            </span>
                                        </div>
                                        <ProgressBar now={goal.fundedPercent} variant={goal.fundedPercent >= 100 ? 'success' : 'primary'} style={{ height: 6 }} />
                                        <div className="d-flex justify-content-between mt-1">
                                            <span className="text-muted" style={{ fontSize: '0.7rem' }}>{goal.potName ? `Linked: ${goal.potName}` : 'No Pot Linked'}</span>
                                            <span className="fw-bold text-primary" style={{ fontSize: '0.7rem' }}>
                                                {goal.monthsToSave ? `${goal.monthsToSave} mo left` : (goal.fundedPercent >= 100 ? 'Funded!' : 'Set budget')}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                                {!alignment?.goals?.length && <Alert variant="light" className="p-2 small">No goals set yet.</Alert>}
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={6}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Body className="p-2">
                            <Card.Title className="h6">Recent Transactions</Card.Title>
                            <div className="overflow-auto" style={{ maxHeight: '250px' }}>
                                <Table hover responsive size="sm" className="align-middle mt-1 mb-0">
                                    <tbody>
                                        {transactions.map(tx => (
                                            <tr key={tx.transactionId}>
                                                <td style={{ width: 40 }}>
                                                    {tx.merchantLogo ? (
                                                        <img src={tx.merchantLogo} alt="" className="rounded-circle" width={24} height={24} />
                                                    ) : (
                                                        <div className="bg-light rounded-circle d-flex align-items-center justify-content-center" style={{ width: 24, height: 24 }}>
                                                            <DollarSign size={12} className="text-muted" />
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="fw-semibold text-truncate small" style={{ maxWidth: 150 }}>{tx.merchantName || tx.description}</div>
                                                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>{new Date(tx.createdISO!).toLocaleDateString()}</div>
                                                </td>
                                                <td>
                                                    <Badge bg="light" text="dark" className="border" style={{ fontSize: '0.7rem' }}>
                                                        {tx.userCategoryLabel || 'Uncategorised'}
                                                    </Badge>
                                                </td>
                                                <td className={`text-end fw-bold small ${tx.amount > 0 ? 'text-success' : ''}`}>
                                                    {formatMoney(Math.abs(tx.amount))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </Table>
                            </div>
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Budget Modal */}
            <Modal show={showBudgetModal} onHide={() => setShowBudgetModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Manage Budgets</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="text-muted small">Set monthly targets for your categories.</p>
                    {summary?.categories?.map(cat => (
                        <Form.Group key={cat.label} className="mb-3">
                            <Form.Label>{cat.label}</Form.Label>
                            <Form.Control
                                type="number"
                                value={budgets[cat.label.toLowerCase()] || ''}
                                onChange={e => setBudgets({ ...budgets, [cat.label.toLowerCase()]: Number(e.target.value) })}
                                placeholder="0.00"
                            />
                        </Form.Group>
                    ))}
                    <hr />
                    <h6 className="mb-3">Bucket Budgets</h6>
                    {['mandatory', 'optional', 'savings'].map(bucket => (
                        <Form.Group key={bucket} className="mb-3">
                            <Form.Label className="text-capitalize">{bucket}</Form.Label>
                            <Form.Control
                                type="number"
                                value={budgets[bucket] || ''}
                                onChange={e => setBudgets({ ...budgets, [bucket]: Number(e.target.value) })}
                                placeholder="0.00"
                            />
                        </Form.Group>
                    ))}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowBudgetModal(false)}>Cancel</Button>
                    <Button variant="primary" onClick={saveBudgets}>Save Budgets</Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default FinanceDashboardModern;
