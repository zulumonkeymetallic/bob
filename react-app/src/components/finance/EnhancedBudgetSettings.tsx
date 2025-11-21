import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Table, Badge, Row, Col, InputGroup, Alert, Accordion } from 'react-bootstrap';
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

type BudgetMode = 'percentage' | 'fixed';

type BudgetData = {
    mode: BudgetMode;
    monthlyIncome: number; // in pounds
    currency: string;
    categoryBudgets: Record<string, { percent?: number; amount?: number }>; // amount in pence
    updatedAt?: number;
};

const EnhancedBudgetSettings: React.FC = () => {
    const { currentUser } = useAuth();
    const [mode, setMode] = useState<BudgetMode>('percentage');
    const [monthlyIncome, setMonthlyIncome] = useState<number>(3500);
    const [currency, setCurrency] = useState('GBP');
    const [categoryBudgets, setCategoryBudgets] = useState<Record<string, { percent?: number; amount?: number }>>({});
    const [saved, setSaved] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Load budget data
    useEffect(() => {
        const load = async () => {
            if (!currentUser) return;
            setLoading(true);
            try {
                const ref = doc(db, 'finance_budgets_v2', currentUser.uid);
                const snap = await getDoc(ref);
                if (snap.exists()) {
                    const data = snap.data() as BudgetData;
                    setMode(data.mode || 'percentage');
                    setMonthlyIncome(data.monthlyIncome || 3500);
                    setCurrency(data.currency || 'GBP');
                    setCategoryBudgets(data.categoryBudgets || {});
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
                mode,
                monthlyIncome,
                currency,
                categoryBudgets,
                updatedAt: Date.now()
            });
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
    const calculateBucketTotals = (): Record<CategoryBucket, { percent: number; amount: number; count: number }> => {
        const totals: Record<string, { percent: number; amount: number; count: number }> = {};

        DEFAULT_CATEGORIES.forEach(cat => {
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

    // Calculate grand total
    const calculateGrandTotal = (): { percent: number; amount: number } => {
        let totalPercent = 0;
        let totalAmount = 0;

        Object.values(categoryBudgets).forEach(budget => {
            if (mode === 'percentage' && budget.percent) {
                totalPercent += budget.percent;
            } else if (budget.amount) {
                totalAmount += budget.amount;
            }
        });

        if (mode === 'percentage') {
            totalAmount = calculateBudgetAmount(totalPercent, monthlyIncome);
        } else {
            totalPercent = calculateBudgetPercent(totalAmount, monthlyIncome);
        }

        return { percent: totalPercent, amount: totalAmount };
    };

    const bucketTotals = calculateBucketTotals();
    const grandTotal = calculateGrandTotal();
    const remaining = {
        percent: 100 - grandTotal.percent,
        amount: (monthlyIncome * 100) - grandTotal.amount
    };

    // Group categories by bucket
    const categoriesByBucket: Record<CategoryBucket, FinanceCategory[]> = {} as any;
    DEFAULT_CATEGORIES.forEach(cat => {
        if (!categoriesByBucket[cat.bucket]) {
            categoriesByBucket[cat.bucket] = [];
        }
        categoriesByBucket[cat.bucket].push(cat);
    });

    if (loading) {
        return (
            <div className="container py-3">
                <div className="text-center">Loading budgets...</div>
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
                                            <th style={{ width: mode === 'percentage' ? 120 : 140 }}>
                                                {mode === 'percentage' ? '% of Income' : 'Monthly Budget'}
                                            </th>
                                            <th style={{ width: 120 }} className="text-end">
                                                {mode === 'percentage' ? 'Amount' : 'Percentage'}
                                            </th>
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
        </div>
    );
};

export default EnhancedBudgetSettings;
