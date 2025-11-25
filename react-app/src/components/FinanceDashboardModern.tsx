import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Modal, ProgressBar, Row, Spinner, Table } from 'react-bootstrap';
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, where, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { ArrowDown, ArrowUp, CreditCard, DollarSign, PieChart as PieChartIcon, Settings, TrendingUp, Wallet } from 'lucide-react';
import { Goal, Story } from '../types';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import ReactECharts from 'echarts-for-react';

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
    potName?: string | null;
    potId?: string | null;
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
    const [pots, setPots] = useState<Record<string, { name: string; balance?: number; currency?: string }>>({});
    const [goals, setGoals] = useState<Goal[]>([]);
    const [stories, setStories] = useState<Story[]>([]);
    const [loading, setLoading] = useState(true);
    const [isRecomputing, setIsRecomputing] = useState(false);
    const [showBudgetModal, setShowBudgetModal] = useState(false);
    const [budgets, setBudgets] = useState<Record<string, number>>({});
    const [filterMode, setFilterMode] = useState<'month' | 'quarter' | 'year' | 'custom'>('month');
    const [startDate, setStartDate] = useState<string>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState<string>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    });

    // --- Data Fetching ---
    // Load pots for name lookup
    useEffect(() => {
        if (!currentUser) return;
        const potsQuery = query(
            collection(db, 'monzo_pots'),
            where('ownerUid', '==', currentUser.uid)
        );
        const unsub = onSnapshot(potsQuery, (snap) => {
            const map: Record<string, { name: string; balance?: number; currency?: string }> = {};
            snap.docs.forEach((d) => {
                const data = d.data() as any;
                const id = data.potId || d.id;
                if (!id) return;
                map[id] = { name: data.name || id, balance: data.balance || 0, currency: data.currency || 'GBP' };
            });
            setPots(map);
        });
        return () => unsub();
    }, [currentUser]);

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
                const metadata = (data.metadata || {}) as Record<string, any>;
                const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
                const potName = potId ? pots[potId]?.name || null : null;
                const amount = typeof data.amount === 'number' && Math.abs(data.amount) < 10 ? data.amount * 100 : data.amount;
                const type = data.userCategoryType || data.defaultCategoryType || null;
                return {
                    transactionId: data.transactionId,
                    description: data.description,
                    amount,
                    createdISO: data.createdISO,
                    userCategoryType: type,
                    userCategoryLabel: data.userCategoryLabel || data.defaultCategoryLabel,
                    merchantName: data.merchant?.name,
                    merchantLogo: data.merchant?.logo,
                    potName,
                    potId,
                } as TransactionRow;
            }));
            setLoading(false);
        });

        getDoc(budgetRef).then(snap => {
            if (snap.exists()) setBudgets(snap.data().byCategory || {});
        });

        return () => { unsubSummary(); unsubAlignment(); unsubTx(); };
    }, [currentUser]);

    // Load goals and stories for progress metrics
    useEffect(() => {
        if (!currentUser) { setGoals([]); return; }
        const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(goalsQuery, (snap) => {
            setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[]);
        });
        return () => unsub();
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser) { setStories([]); return; }
        const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(storiesQuery, (snap) => {
            setStories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Story[]);
        });
        return () => unsub();
    }, [currentUser]);

    // Reattach pot names when pot map updates
    useEffect(() => {
        if (!pots || !transactions.length) return;
        setTransactions((prev) =>
            prev.map((tx) => {
                const potId = tx.potId;
                const potName = potId ? pots[potId]?.name : undefined;
                return potName ? { ...tx, potName } : tx;
            })
        );
    }, [pots, transactions.length]);

    useEffect(() => {
        const now = new Date();
        if (filterMode === 'month') {
            setStartDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
            setEndDate(new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10));
        } else if (filterMode === 'quarter') {
            const q = Math.floor(now.getMonth() / 3);
            const start = new Date(now.getFullYear(), q * 3, 1);
            const end = new Date(now.getFullYear(), (q + 1) * 3, 0);
            setStartDate(start.toISOString().slice(0, 10));
            setEndDate(end.toISOString().slice(0, 10));
        } else if (filterMode === 'year') {
            const start = new Date(now.getFullYear(), 0, 1);
            const end = new Date(now.getFullYear(), 11, 31);
            setStartDate(start.toISOString().slice(0, 10));
            setEndDate(end.toISOString().slice(0, 10));
        }
        // Legacy global hook for older UI buttons/modal expecting refreshMonzoData
        (window as any).refreshMonzoData = async () => {
            const fn = httpsCallable(functions, 'syncMonzoNow');
            await fn({});
        };
    }, [filterMode]);

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

    const parseMonthKey = (m: string) => {
        if (!m) return new Date(NaN);
        if (/^\d{4}-\d{2}$/.test(m)) {
            const [y, mo] = m.split('-').map(Number);
            return new Date(y, mo - 1, 1);
        }
        const maybe = new Date(m);
        return maybe;
    };

    const filteredTimeline = useMemo(() => {
        const source = summary?.spendTimeline || [];
        if (!source.length) return [];
        const start = new Date(startDate);
        const end = new Date(endDate);
        return source.filter((row) => {
            const dt = parseMonthKey((row as any).month);
            return dt >= start && dt <= end;
        });
    }, [summary?.spendTimeline, startDate, endDate]);

    const filteredTotals = useMemo(() => {
        if (filteredTimeline.length) {
            return filteredTimeline.reduce(
                (acc, row: any) => {
                    acc.mandatory += row.mandatory || 0;
                    acc.optional += row.optional || 0;
                    acc.savings += row.savings || 0;
                    acc.income += row.income || 0;
                    return acc;
                },
                { mandatory: 0, optional: 0, savings: 0, income: 0 } as BudgetTotals
            );
        }
        return summary?.totals || { mandatory: 0, optional: 0, savings: 0, income: 0 };
    }, [filteredTimeline, summary?.totals]);

    const goalProgress = useMemo(() => {
        return goals.map((g) => {
            const relatedStories = stories.filter((s) => s.goalId === g.id);
            const totalPoints = relatedStories.reduce((sum, s) => sum + (s.points || 0), 0);
            const donePoints = relatedStories.filter((s) => s.status === 4).reduce((sum, s) => sum + (s.points || 0), 0);
            const potId = (g as any).linkedPotId || g.potId || null;
            const potInfo = potId ? pots[potId] : undefined;
            const potBalance = potInfo?.balance || 0; // pence
            const estimated = g.estimatedCost || 0; // pounds
            const savingsPct = estimated > 0 ? Math.min(100, ((potBalance / 100) / estimated) * 100) : 0;
            const pointsPct = totalPoints > 0 ? Math.min(100, (donePoints / totalPoints) * 100) : (g.status === 2 ? 100 : 0);
            const themeDef = GLOBAL_THEMES.find((t) => t.id === (g as any).theme) || GLOBAL_THEMES[0];
            return {
                ...g,
                totalPoints,
                donePoints,
                pointsPct,
                potBalance,
                savingsPct,
                themeLabel: themeDef.name,
                themeColor: themeDef.color,
            };
        });
    }, [goals, stories, pots]);

    const themeProgress = useMemo(() => {
        const map = new Map<number, { themeId: number; name: string; color: string; totalPoints: number; donePoints: number; estimated: number; saved: number }>();
        goalProgress.forEach((g: any) => {
            const themeId = g.theme || 0;
            const themeDef = GLOBAL_THEMES.find((t) => t.id === themeId) || GLOBAL_THEMES[0];
            const existing = map.get(themeId) || { themeId, name: themeDef.name, color: themeDef.color, totalPoints: 0, donePoints: 0, estimated: 0, saved: 0 };
            existing.totalPoints += g.totalPoints || 0;
            existing.donePoints += g.donePoints || 0;
            existing.estimated += g.estimatedCost || 0;
            existing.saved += (g.potBalance || 0) / 100; // pounds
            map.set(themeId, existing);
        });
        return Array.from(map.values()).map((t) => ({
            ...t,
            pointsPct: t.totalPoints > 0 ? Math.min(100, (t.donePoints / t.totalPoints) * 100) : 0,
            savingsPct: t.estimated > 0 ? Math.min(100, (t.saved / t.estimated) * 100) : 0,
        }));
    }, [goalProgress]);

    const burndownData = useMemo(() => {
        const totalBudget = summary?.budgetProgress?.reduce((acc, b) => acc + b.budget, 0) || 0;
        const spendSoFar = Math.abs(filteredTotals.mandatory + filteredTotals.optional + filteredTotals.savings);
        const start = new Date(startDate);
        const end = new Date(endDate);
        const daysInRange = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const todayIdx = Math.min(daysInRange, Math.round((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const data = [];
        for (let i = 1; i <= daysInRange; i++) {
            const budgetPoint = (totalBudget / daysInRange) * i;
            const linearSpend = spendSoFar && todayIdx ? (spendSoFar / todayIdx) * i : spendSoFar;
            data.push({
                day: i,
                budget: budgetPoint,
                spend: i <= todayIdx ? linearSpend : null,
                projected: i > todayIdx ? (spendSoFar / todayIdx) * i : null
            });
        }
        return data;
    }, [summary?.budgetProgress, filteredTotals, startDate, endDate]);

    const trendData = useMemo(() => {
        const source = filteredTimeline.length ? filteredTimeline : summary?.spendTimeline || [];
        return source.map((m: any) => ({
            name: m.month,
            Mandatory: m.mandatory,
            Optional: m.optional,
            Savings: m.savings
        }));
    }, [filteredTimeline, summary?.spendTimeline]);

    const filteredTransactions = useMemo(
        () => transactions.filter((t) => {
            const cat = (t.userCategoryType || '').toLowerCase();
            return cat !== 'bank_transfer' && cat !== 'unknown';
        }),
        [transactions]
    );

    const burndownOption = {
        tooltip: {
            trigger: 'axis',
            valueFormatter: (val: number) => formatMoney(val || 0),
        },
        legend: { data: ['Budget', 'Spend', 'Projected'] },
        grid: { left: 30, right: 10, bottom: 20, top: 30 },
        xAxis: {
            type: 'category',
            data: burndownData.map((d) => d.day),
            axisLabel: { fontSize: 10 },
        },
        yAxis: {
            type: 'value',
            axisLabel: { formatter: (v: number) => formatMoney(v).replace('£', '£') },
            splitLine: { show: true },
        },
        series: [
            {
                name: 'Budget',
                type: 'line',
                data: burndownData.map((d) => d.budget),
                smooth: true,
                lineStyle: { type: 'dashed', width: 2 },
                symbol: 'none',
            },
            {
                name: 'Spend',
                type: 'line',
                data: burndownData.map((d) => d.spend),
                areaStyle: { opacity: 0.25 },
                smooth: true,
                lineStyle: { color: '#2563eb', width: 3 },
            },
            {
                name: 'Projected',
                type: 'line',
                data: burndownData.map((d) => d.projected),
                smooth: true,
                lineStyle: { color: '#f97316', type: 'dotted', width: 2 },
                symbol: 'none',
            },
        ],
    };

    const trendOption = {
        tooltip: { trigger: 'axis', valueFormatter: (val: number) => formatMoney(val || 0) },
        legend: { data: ['Mandatory', 'Optional', 'Savings'] },
        grid: { left: 50, right: 10, bottom: 20, top: 30 },
        xAxis: { type: 'category', data: trendData.map((d) => d.name) },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => formatMoney(v).replace('£', '£') } },
        series: [
            { name: 'Mandatory', type: 'bar', stack: 'spend', data: trendData.map((d) => Math.abs(d.Mandatory || 0)) },
            { name: 'Optional', type: 'bar', stack: 'spend', data: trendData.map((d) => Math.abs(d.Optional || 0)) },
            { name: 'Savings', type: 'bar', stack: 'spend', data: trendData.map((d) => Math.abs(d.Savings || 0)) },
        ],
        color: ['#f59e0b', '#0ea5e9', '#10b981'],
    };

    if (loading) return <div className="d-flex justify-content-center py-5"><Spinner animation="border" /></div>;

    return (
        <Container fluid className="py-2 bg-light min-vh-100">
            <div className="d-flex justify-content-end">
                <span className="small text-muted">Signed in as: <code>{currentUser?.uid || '—'}</code></span>
            </div>
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

            <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
                <Button size="sm" variant={filterMode === 'month' ? 'primary' : 'outline-secondary'} onClick={() => setFilterMode('month')}>Month</Button>
                <Button size="sm" variant={filterMode === 'quarter' ? 'primary' : 'outline-secondary'} onClick={() => setFilterMode('quarter')}>Quarter</Button>
                <Button size="sm" variant={filterMode === 'year' ? 'primary' : 'outline-secondary'} onClick={() => setFilterMode('year')}>Year</Button>
                <Form.Control
                    type="date"
                    size="sm"
                    style={{ maxWidth: 160 }}
                    value={startDate}
                    onChange={(e) => { setStartDate(e.target.value); setFilterMode('custom'); }}
                />
                <Form.Control
                    type="date"
                    size="sm"
                    style={{ maxWidth: 160 }}
                    value={endDate}
                    onChange={(e) => { setEndDate(e.target.value); setFilterMode('custom'); }}
                />
                <div className="text-muted small">Bank transfers excluded from all charts.</div>
            </div>

            {/* Stats Row - Compact */}
            <Row className="g-2 mb-3">
                <Col xs={6} md={3}>
                    <StatCard
                        title="Mandatory"
                        value={formatMoney(filteredTotals.mandatory || 0)}
                        icon={Wallet}
                        color="warning"
                        subtext="Bills, Rent"
                    />
                </Col>
                <Col xs={6} md={3}>
                    <StatCard
                        title="Optional"
                        value={formatMoney(filteredTotals.optional || 0)}
                        icon={CreditCard}
                        color="info"
                        subtext="Dining, Fun"
                    />
                </Col>
                <Col xs={6} md={3}>
                    <StatCard
                        title="Savings"
                        value={formatMoney(filteredTotals.savings || 0)}
                        icon={PieChartIcon}
                        color="success"
                        subtext="Investments"
                    />
                </Col>
                <Col xs={6} md={3}>
                    <StatCard
                        title="Income"
                        value={formatMoney(filteredTotals.income || 0)}
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
                            <ReactECharts option={burndownOption} style={{ height: 240 }} />
                        </Card.Body>
                    </Card>
                </Col>
                <Col lg={4}>
                    <Card className="border-0 shadow-sm h-100">
                        <Card.Body className="p-2">
                            <Card.Title className="h6">Spend Trends</Card.Title>
                            <ReactECharts option={trendOption} style={{ height: 240 }} />
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
                                    <thead>
                                        <tr className="text-muted small">
                                            <th>Date</th>
                                            <th>Merchant / Pot</th>
                                            <th>Category</th>
                                            <th className="text-end">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredTransactions.map(tx => (
                                            <tr key={tx.transactionId}>
                                                <td>
                                                    <div className="fw-semibold small">{tx.createdISO ? new Date(tx.createdISO).toLocaleDateString() : '—'}</div>
                                                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                                                        {tx.createdISO ? new Date(tx.createdISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                                                    </div>
                                                </td>
                                                <td>
                                                    <div className="fw-semibold text-truncate small" style={{ maxWidth: 180 }}>{tx.merchantName || tx.description}</div>
                                                    <div className="text-muted" style={{ fontSize: '0.7rem' }}>
                                                        {tx.potName
                                                            ? `${tx.amount > 0 ? 'Transfer from' : 'Transfer to'} ${tx.potName}`
                                                            : 'No pot'}
                                                    </div>
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
