import React, { useEffect, useMemo, useState } from 'react';
import { Card, Form, Button, Table, Badge, Row, Col, InputGroup, Alert, Accordion, Spinner } from 'react-bootstrap';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import {
    DEFAULT_CATEGORIES,
    FinanceCategory,
    BUCKET_LABELS,
    BUCKET_COLORS,
    CategoryBucket,
    calculateBudgetAmount,
    calculateBudgetPercent
} from '../../utils/financeCategories';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../firebase';

type BudgetMode = 'percentage' | 'fixed';

type BudgetData = {
    mode: BudgetMode;
    monthlyIncome: number; // in pounds
    currency: string;
    categoryBudgets: Record<string, { percent?: number; amount?: number }>; // amount in pence
    updatedAt?: number;
};

type CategoryItem = FinanceCategory & { isCustom?: boolean };

const EnhancedBudgetSettings: React.FC = () => {
    const { currentUser } = useAuth();
    const [mode, setMode] = useState<BudgetMode>('percentage');
    const [monthlyIncome, setMonthlyIncome] = useState<number>(3500);
    const [currency, setCurrency] = useState('GBP');
    const [categoryBudgets, setCategoryBudgets] = useState<Record<string, { percent?: number; amount?: number }>>({});
    const [saved, setSaved] = useState<string>('');
    const [loading, setLoading] = useState(true);
    const [goals, setGoals] = useState<any[]>([]);
    const [goalAllocation, setGoalAllocation] = useState<number>(20); // Default 20% for goals
    const [customCategories, setCustomCategories] = useState<CategoryItem[]>([]);
    const [legacyBudgetLoaded, setLegacyBudgetLoaded] = useState(false);
    const [categorySpend, setCategorySpend] = useState<Record<string, { d30: number; d90: number; ytd: number }>>({});

    // Load budget data
    useEffect(() => {
    const load = async () => {
            if (!currentUser) return;
            setLoading(true);
            try {
                // Load aggregated spend for budgets (30d, 90d, YTD) excluding bank_transfer/unknown
                try {
                    const fn = httpsCallable(functions, 'fetchDashboardData');
                    const now = new Date();
                    const startYear = new Date(now.getFullYear(), 0, 1).toISOString();
                    const resp: any = await fn({ startDate: startYear, endDate: now.toISOString() });
                    const data = resp?.data?.data || {};
                    const spendByCategory = data.spendByCategory || {};
                    const timeSeriesByCategory = data.timeSeriesByCategory || {};
                    const agg: Record<string, { d30: number; d90: number; ytd: number }> = {};
                    const today = new Date();
                    const daysAgo = (iso: string) => Math.round((today.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
                    // YTD
                    Object.entries(spendByCategory).forEach(([key, val]) => {
                        if (key === 'bank_transfer' || key === 'unknown') return;
                        agg[key] = { d30: 0, d90: 0, ytd: Math.abs(Number(val) || 0) / 100 };
                    });
                    // Rolling windows from time series
                    Object.entries(timeSeriesByCategory || {}).forEach(([key, entries]: any) => {
                        if (key === 'bank_transfer' || key === 'unknown') return;
                        entries.forEach((row: any) => {
                            const age = daysAgo(row.month + '-01');
                            const amt = Math.abs(row.amount || 0) / 100;
                            if (!agg[key]) agg[key] = { d30: 0, d90: 0, ytd: 0 };
                            if (age <= 30) agg[key].d30 += amt;
                            if (age <= 90) agg[key].d90 += amt;
                        });
                    });
                    setCategorySpend(agg);
                } catch (err) {
                    console.warn('Failed to load category spend aggregates', err);
                }

                // Fetch custom categories saved by the user (finance_categories collection)
                try {
                    const categoriesRef = doc(db, 'finance_categories', currentUser.uid);
                    const categoriesSnap = await getDoc(categoriesRef);
                    if (categoriesSnap.exists()) {
                        const data = categoriesSnap.data() as any;
                        const arr = Array.isArray(data.categories) ? data.categories : [];
                        const normalized = arr.map((c: any) => ({
                            key: c.key,
                            label: c.label || c.key,
                            bucket: c.bucket || 'optional',
                            isDefault: false,
                            isCustom: true
                        })) as CategoryItem[];
                        setCustomCategories(normalized);
                    }
                } catch (err) {
                    console.warn('Failed to load custom categories', err);
                }

                const ref = doc(db, 'finance_budgets_v2', currentUser.uid);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    const data = snap.data() as BudgetData;
                    setMode(data.mode || 'percentage');
                    setMonthlyIncome(data.monthlyIncome || 3500);
                    setCurrency(data.currency || 'GBP');
                    setCategoryBudgets(data.categoryBudgets || {});
                    // Load goal allocation if saved, otherwise default
                    if ((data as any).goalAllocation) setGoalAllocation((data as any).goalAllocation);
                } else {
                    // Initialize defaults from category definitions
                    const initialBudgets: Record<string, { percent?: number; amount?: number }> = {};
                    DEFAULT_CATEGORIES.forEach(cat => {
                        if (cat.budgetPercent) {
                            initialBudgets[cat.key] = { percent: cat.budgetPercent };
                        }
                    });
                    setCategoryBudgets(initialBudgets);
                }

                // Fallback: if v2 missing, try legacy finance_budgets to avoid empty UI
                if (!snap.exists()) {
                    try {
                        const legacyRef = doc(db, 'finance_budgets', currentUser.uid);
                        const legacySnap = await getDoc(legacyRef);
                        if (legacySnap.exists()) {
                            const data = legacySnap.data() as any;
                            const byCategory = data.byCategory || {};
                            const derived: Record<string, { percent?: number; amount?: number }> = {};
                            Object.entries(byCategory).forEach(([key, val]) => {
                                const num = Number(val);
                                if (!Number.isFinite(num)) return;
                                // Treat legacy numbers as percent when <= 100, otherwise assume currency in pounds
                                if (num <= 100) {
                                    derived[key] = { percent: num, amount: calculateBudgetAmount(num, monthlyIncome) };
                                } else {
                                    const amountPence = Math.round(num * 100);
                                    derived[key] = { amount: amountPence, percent: calculateBudgetPercent(amountPence, monthlyIncome) };
                                }
                            });
                            if (Object.keys(derived).length) {
                                setCategoryBudgets((prev) => Object.keys(prev).length ? prev : derived);
                                setLegacyBudgetLoaded(true);
                            }
                        }
                    } catch (err) {
                        console.warn('Failed to load legacy budget doc', err);
                    }
                }

                // Load goals
                const { collection, query, where, getDocs } = await import('firebase/firestore');
                const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
                const gSnap = await getDocs(q);
                const gList = gSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter((g: any) => g.status !== 2);
                setGoals(gList);

            } catch (error) {
                console.error('Error loading budgets:', error);
            } finally {
                setLoading(false);
            }
        };
        load();
    }, [currentUser]);

    // Save budget data
    const save = async () => {
        if (!currentUser) return;
        try {
            const ref = doc(db, 'finance_budgets_v2', currentUser.uid);
            await setDoc(ref, {
                ownerUid: currentUser.uid,
                mode,
                monthlyIncome: safeMonthlyIncome,
                currency,
                categoryBudgets,
                goalAllocation,
                updatedAt: Date.now()
            });

            // Also persist a lightweight legacy doc so older screens pick up category numbers
            const legacyRef = doc(db, 'finance_budgets', currentUser.uid);
            const byCategory: Record<string, number> = {};
            Object.entries(categoryBudgets).forEach(([key, val]) => {
                const normalizedKey = key.trim().toLowerCase();
                if (!normalizedKey) return;
                const derived = mode === 'percentage'
                    ? calculateBudgetAmount(val.percent || 0, monthlyIncome) / 100 // pounds
                    : (val.amount || 0) / 100; // pounds
                byCategory[normalizedKey] = Number.isFinite(derived) ? Number(derived.toFixed(2)) : 0;
            });
            await setDoc(legacyRef, { byCategory, currency, monthlyIncome, ownerUid: currentUser.uid, updatedAt: Date.now() }, { merge: true });

            setSaved('Saved');
            setTimeout(() => setSaved(''), 2000);
        } catch (error) {
            console.error('Error saving budgets:', error);
            setSaved('Error saving');
        }
    };

    // Load sample budget data
    const loadSampleBudget = () => {
        const sampleBudgets: Record<string, { percent?: number; amount?: number }> = {};
        DEFAULT_CATEGORIES.forEach(cat => {
            if (cat.budgetPercent) {
                sampleBudgets[cat.key] = {
                    percent: cat.budgetPercent,
                    amount: calculateBudgetAmount(cat.budgetPercent, monthlyIncome)
                };
            }
        });
        setCategoryBudgets(sampleBudgets);
        setSaved('Sample loaded - remember to save!');
        setTimeout(() => setSaved(''), 3000);
    };

    // Update budget for a category
    const updateBudget = (categoryKey: string, value: string, isPercent: boolean) => {
        const numValue = parseFloat(value) || 0;

        if (isPercent) {
            setCategoryBudgets(prev => ({
                ...prev,
                [categoryKey]: {
                    percent: numValue,
                    amount: calculateBudgetAmount(numValue, monthlyIncome)
                }
            }));
        } else {
            // Fixed amount in pounds, convert to pence
            const amountPence = Math.round(numValue * 100);
            setCategoryBudgets(prev => ({
                ...prev,
                [categoryKey]: {
                    amount: amountPence,
                    percent: calculateBudgetPercent(amountPence, monthlyIncome)
                }
            }));
        }
    };

    // Get budget value for display
    const getBudgetValue = (categoryKey: string): { percent: number; amount: number } => {
        const budget = categoryBudgets[categoryKey];
        if (!budget) return { percent: 0, amount: 0 };

        if (mode === 'percentage' && budget.percent !== undefined) {
            return {
                percent: budget.percent,
                amount: calculateBudgetAmount(budget.percent, monthlyIncome)
            };
        } else if (budget.amount !== undefined) {
            return {
                percent: calculateBudgetPercent(budget.amount, monthlyIncome),
                amount: budget.amount
            };
        }

        return { percent: 0, amount: 0 };
    };

    // Calculate totals by bucket
    const allCategories = useMemo(() => {
        // Combine defaults, custom categories, and any categories that only exist because the user saved a budget
        const map = new Map<string, CategoryItem>();
        DEFAULT_CATEGORIES.forEach(cat => map.set(cat.key, { ...cat, isCustom: false }));
        customCategories.forEach(cat => {
            if (!map.has(cat.key)) map.set(cat.key, cat);
        });
        Object.keys(categoryBudgets).forEach(key => {
            const normalized = key.trim();
            if (normalized && !map.has(normalized)) {
                map.set(normalized, {
                    key: normalized,
                    label: normalized,
                    bucket: 'optional' as CategoryBucket,
                    isDefault: false,
                    isCustom: true
                } as CategoryItem);
            }
        });
        return Array.from(map.values());
    }, [customCategories, categoryBudgets]);

    const bucketIndex = useMemo(() => {
        const m = new Map<string, CategoryBucket>();
        allCategories.forEach((cat) => m.set(cat.key, cat.bucket));
        return m;
    }, [allCategories]);

    const calculateBucketTotals = (): Record<CategoryBucket, { percent: number; amount: number; count: number }> => {
        const totals: Record<string, { percent: number; amount: number; count: number }> = {};

        allCategories.forEach(cat => {
            if (!totals[cat.bucket]) {
                totals[cat.bucket] = { percent: 0, amount: 0, count: 0 };
            }

            const budget = getBudgetValue(cat.key);
            totals[cat.bucket].percent += budget.percent;
            totals[cat.bucket].amount += budget.amount;
            totals[cat.bucket].count += 1;
        });

        return totals as Record<CategoryBucket, { percent: number; amount: number; count: number }>;
    };

    const safeMonthlyIncome = Number.isFinite(monthlyIncome) ? monthlyIncome : 0;

    // Calculate grand total
    const calculateGrandTotal = (): { percent: number; amount: number } => {
        let totalPercent = 0;
        let totalAmount = 0;

        Object.entries(categoryBudgets).forEach(([key, budget]) => {
            const bucket = bucketIndex.get(key) || 'optional';
            // Exclude income and bank transfers from allocation math
            if (bucket === 'net_salary' || bucket === 'irregular_income' || bucket === 'bank_transfer') {
                return;
            }
            if (mode === 'percentage' && budget.percent) {
                totalPercent += budget.percent;
            } else if (budget.amount) {
                totalAmount += budget.amount;
            }
        });

        if (mode === 'percentage') {
            totalAmount = calculateBudgetAmount(totalPercent, safeMonthlyIncome);
        } else {
            totalPercent = calculateBudgetPercent(totalAmount, safeMonthlyIncome);
        }

        return { percent: totalPercent, amount: totalAmount };
    };

    const calculateGoalTotal = () => {
        const amount = calculateBudgetAmount(goalAllocation, safeMonthlyIncome);
        return { percent: goalAllocation, amount };
    };

    const bucketTotals = calculateBucketTotals();
    const grandTotal = calculateGrandTotal();
    const goalTotal = calculateGoalTotal();

    // Add goals to grand total
    grandTotal.percent += goalTotal.percent;
    grandTotal.amount += goalTotal.amount;

    const remaining = {
        percent: 100 - grandTotal.percent,
        amount: (monthlyIncome * 100) - grandTotal.amount
    };

    // Group categories by bucket (include savings buckets so parent totals stay accurate)
    const categoriesByBucket: Record<CategoryBucket, FinanceCategory[]> = {} as any;
    allCategories
        .filter((cat) => cat.bucket !== 'bank_transfer' && cat.bucket !== 'unknown')
        .forEach(cat => {
            if (!categoriesByBucket[cat.bucket]) {
                categoriesByBucket[cat.bucket] = [];
            }
            categoriesByBucket[cat.bucket].push(cat);
        });

    if (loading) {
        return (
            <div className="container py-3">
                <div className="d-flex justify-content-center align-items-center py-4 gap-2">
                    <Spinner animation="border" size="sm" />
                    <span className="text-muted">Loading budgets…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="container py-3">
            <h3>Enhanced Budgets</h3>
            <p className="text-muted">
                Set budget percentages based on your monthly income. Budgets help track spending vs. targets.
            </p>

            <Card className="mb-3">
                <Card.Body>
                    <Row className="g-3 align-items-end mb-3">
                        <Col md={4}>
                            <Form.Label>Monthly Net Income</Form.Label>
                            <InputGroup>
                                <InputGroup.Text>{currency === 'GBP' ? '£' : currency}</InputGroup.Text>
                                <Form.Control
                                    type="number"
                                    min="0"
                                    step="100"
                                    value={monthlyIncome}
                                    onChange={(e) => setMonthlyIncome(parseFloat(e.target.value) || 0)}
                                    placeholder="3500"
                                />
                            </InputGroup>
                            <Form.Text className="text-muted">Your take-home pay after tax</Form.Text>
                        </Col>

                        <Col md={3}>
                            <Form.Label>Currency</Form.Label>
                            <Form.Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                                <option value="GBP">GBP (£)</option>
                                <option value="USD">USD ($)</option>
                                <option value="EUR">EUR (€)</option>
                            </Form.Select>
                        </Col>

                        <Col md={3}>
                            <Form.Label>Budget Mode</Form.Label>
                            <Form.Select value={mode} onChange={(e) => setMode(e.target.value as BudgetMode)}>
                                <option value="percentage">% of Income</option>
                                <option value="fixed">Fixed Amounts</option>
                            </Form.Select>
                        </Col>

                        <Col md={2}>
                            <div className="d-flex gap-1">
                                <Button variant="primary" onClick={save} style={{ flex: 1 }}>
                                    Save
                                </Button>
                                <Button variant="outline-secondary" onClick={loadSampleBudget} title="Load sample budget data">
                                    Sample
                                </Button>
                            </div>
                            {saved && <Badge bg={saved.includes('Error') ? 'danger' : 'success'} className="mt-2 d-block">{saved}</Badge>}
                            {legacyBudgetLoaded && <Badge bg="info" className="mt-2 d-block">Loaded legacy budgets</Badge>}
                        </Col>
                    </Row>

                    <Alert variant="info" className="mb-0">
                        <strong>Total Allocated:</strong> {grandTotal.percent.toFixed(1)}% (£{(grandTotal.amount / 100).toFixed(2)}) •
                        <strong className="ms-2">Remaining:</strong> {remaining.percent.toFixed(1)}% (£{(remaining.amount / 100).toFixed(2)})
                    </Alert>
                </Card.Body>
            </Card>

            <Accordion defaultActiveKey={['mandatory', 'discretionary']} alwaysOpen>
                {Object.entries(categoriesByBucket).map(([bucket, categories]) => {
                    const bucketTotal = bucketTotals[bucket as CategoryBucket];
                    const bucketColor = BUCKET_COLORS[bucket as CategoryBucket];

                    if (bucket === 'bank_transfer' || bucket === 'unknown') return null;
                    return (
                        <Accordion.Item eventKey={bucket} key={bucket}>
                            <Accordion.Header>
                                <div className="d-flex justify-content-between align-items-center w-100 pe-3">
                                    <span>
                                        <span
                                            className="badge me-2"
                                            style={{ backgroundColor: bucketColor }}
                                        >
                                            {categories.length}
                                        </span>
                                        {BUCKET_LABELS[bucket as CategoryBucket]}
                                    </span>
                                    <span className="text-muted small">
                                        {bucketTotal.percent.toFixed(1)}% • £{(bucketTotal.amount / 100).toFixed(2)}
                                    </span>
                                </div>
                            </Accordion.Header>
                            <Accordion.Body>
                                <Table size="sm" hover responsive>
                                    <thead>
                                        <tr>
                                            <th>Category</th>
                                            <th style={{ width: mode === 'percentage' ? 170 : 180 }}>
                                                {mode === 'percentage' ? '% of Income' : 'Monthly Budget'}
                                            </th>
                                            <th style={{ width: 120 }} className="text-end">
                                                {mode === 'percentage' ? 'Amount' : 'Percentage'}
                                            </th>
                                            <th className="text-end">30d</th>
                                            <th className="text-end">90d</th>
                                            <th className="text-end">YTD</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {categories.map(cat => {
                                            const budget = getBudgetValue(cat.key);

                                            return (
                                                <tr key={cat.key}>
                                                    <td>{cat.label}</td>
                                                    <td>
                                                        {mode === 'percentage' ? (
                                                            <InputGroup size="sm">
                                                                <Form.Control
                                                                    type="number"
                                                                    min="0"
                                                                    max="100"
                                                                    step="0.1"
                                                                    value={budget.percent || ''}
                                                                    onChange={(e) => updateBudget(cat.key, e.target.value, true)}
                                                                    placeholder="0"
                                                                    style={{ minWidth: 110 }}
                                                                />
                                                                <InputGroup.Text>%</InputGroup.Text>
                                                            </InputGroup>
                                                        ) : (
                                                            <InputGroup size="sm">
                                                                <InputGroup.Text>{currency}</InputGroup.Text>
                                                                <Form.Control
                                                                    type="number"
                                                                    min="0"
                                                                    step="1"
                                                                    value={(budget.amount / 100) || ''}
                                                                    onChange={(e) => updateBudget(cat.key, e.target.value, false)}
                                                                    placeholder="0"
                                                                />
                                                            </InputGroup>
                                                        )}
                                                    </td>
                                                    <td className="text-end text-muted small">
                                                        {mode === 'percentage' ? (
                                                            `£${(budget.amount / 100).toFixed(2)}`
                                                        ) : (
                                                            `${budget.percent.toFixed(1)}%`
                                                        )}
                                                    </td>
                                                    <td className="text-end text-muted small">£{(categorySpend[cat.key]?.d30 || 0).toFixed(2)}</td>
                                                    <td className="text-end text-muted small">£{(categorySpend[cat.key]?.d90 || 0).toFixed(2)}</td>
                                                    <td className="text-end text-muted small">£{(categorySpend[cat.key]?.ytd || 0).toFixed(2)}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </Table>
                            </Accordion.Body>
                        </Accordion.Item>
                    );
                })}
            </Accordion>

            <Card className="mt-4">
                <Card.Header className="bg-success text-white d-flex justify-content-between align-items-center">
                    <span>Goals & Savings (Populated from Goals)</span>
                    <span>{goalAllocation}% • £{(goalTotal.amount / 100).toFixed(2)}</span>
                </Card.Header>
                <Card.Body>
                    <Row className="align-items-center mb-3">
                        <Col md={6}>
                            <Form.Label>Percentage of Net Salary towards Goals</Form.Label>
                            <InputGroup>
                                <Form.Control
                                    type="number"
                                    min="0"
                                    max="100"
                                    value={goalAllocation}
                                    onChange={(e) => setGoalAllocation(parseFloat(e.target.value) || 0)}
                                />
                                <InputGroup.Text>%</InputGroup.Text>
                            </InputGroup>
                            <Form.Text className="text-muted">
                                This amount is distributed across your active goals.
                            </Form.Text>
                        </Col>
                        <Col md={6}>
                            <Alert variant="success" className="mb-0 py-2">
                                <strong>Monthly Contribution:</strong> £{(goalTotal.amount / 100).toFixed(2)}
                            </Alert>
                        </Col>
                    </Row>

                    <h6 className="mt-4 mb-3">Active Goals</h6>
                    {goals.length === 0 ? (
                        <p className="text-muted">No active goals found. Create goals to see them here.</p>
                    ) : (
                        <Table size="sm" hover>
                            <thead>
                                <tr>
                                    <th>Goal</th>
                                    <th>Target</th>
                                    <th>Linked Pot</th>
                                </tr>
                            </thead>
                            <tbody>
                                {goals.map(g => (
                                    <tr key={g.id}>
                                        <td>{g.title}</td>
                                        <td>{g.estimatedCost ? `£${g.estimatedCost}` : 'Not set'}</td>
                                        <td>
                                            {g.linkedPotId || g.potId ? (
                                                <Badge bg="success">Linked</Badge>
                                            ) : (
                                                <Badge bg="secondary">Not Linked</Badge>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </Table>
                    )}
                </Card.Body>
            </Card>

        </div>
    );
};

export default EnhancedBudgetSettings;
