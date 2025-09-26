import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Spinner, Table } from 'react-bootstrap';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { getThemeName } from '../utils/statusHelpers';

interface BudgetTotals {
  mandatory: number;
  optional: number;
  savings: number;
  income: number;
}

interface BudgetSummaryDoc {
  ownerUid: string;
  totals: BudgetTotals;
  categories?: Array<{ label: string; amount: number; count: number; type: string }>;
  monthly?: Record<string, BudgetTotals>;
  pendingClassification?: PendingClassificationItem[];
  pendingCount?: number;
}

interface PendingClassificationItem {
  transactionId: string;
  description: string;
  amount: number;
  createdISO: string | null;
  defaultCategoryType?: string | null;
  defaultCategoryLabel?: string | null;
}

interface GoalAlignmentGoal {
  goalId: string;
  title: string;
  themeId?: number;
  themeName?: string;
  estimatedCost?: number;
  potId?: string | null;
  potName?: string | null;
  potBalance?: number;
  fundedAmount?: number;
  fundedPercent?: number | null;
  shortfall?: number;
}

interface GoalAlignmentDoc {
  ownerUid: string;
  goals?: GoalAlignmentGoal[];
  themes?: Array<{
    themeId: number;
    themeName: string;
    goalCount: number;
    totalEstimatedCost: number;
    totalPotBalance: number;
    totalShortfall: number;
  }>;
}

interface TransactionRow {
  transactionId: string;
  description: string;
  amount: number;
  createdISO: string | null;
  defaultCategoryType?: string | null;
  defaultCategoryLabel?: string | null;
  userCategoryType?: string | null;
  userCategoryLabel?: string | null;
  merchantName?: string | null;
}

const CATEGORY_OPTIONS = [
  { value: 'mandatory', label: 'Mandatory' },
  { value: 'optional', label: 'Optional' },
  { value: 'savings', label: 'Savings / Pots' },
  { value: 'income', label: 'Income' },
];

const formatCurrency = (value: number | undefined | null) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return amount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
};

const formatPercent = (value: number | undefined | null) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)}%`;
};

const FinanceDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [summary, setSummary] = useState<BudgetSummaryDoc | null>(null);
  const [alignment, setAlignment] = useState<GoalAlignmentDoc | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rowEdits, setRowEdits] = useState<Record<string, { categoryType: string; label: string }>>({});
  const [savingTx, setSavingTx] = useState<string | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [budgetCurrency, setBudgetCurrency] = useState('GBP');

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    const summaryRef = doc(db, 'monzo_budget_summary', currentUser.uid);
    const alignmentRef = doc(db, 'monzo_goal_alignment', currentUser.uid);
    const transactionsQuery = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(25)
    );

    const unsubSummary = onSnapshot(summaryRef, (snap) => {
      setSummary((snap.exists() ? (snap.data() as BudgetSummaryDoc) : null));
    });
    const unsubAlignment = onSnapshot(alignmentRef, (snap) => {
      setAlignment((snap.exists() ? (snap.data() as GoalAlignmentDoc) : null));
    });
    const unsubTx = onSnapshot(transactionsQuery, (snap) => {
      const rows: TransactionRow[] = snap.docs.map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          transactionId: data.transactionId,
          description: data.description || data.defaultCategoryLabel || data.merchant?.name || 'Transaction',
          amount: Number(data.amount != null ? data.amount : (data.amountMinor || 0) / 100),
          createdISO: data.createdISO || null,
          defaultCategoryType: data.defaultCategoryType || null,
          defaultCategoryLabel: data.defaultCategoryLabel || null,
          userCategoryType: data.userCategoryType || null,
          userCategoryLabel: data.userCategoryLabel || null,
          merchantName: data.merchant?.name || null,
        };
      });
      setTransactions(rows);
      setLoading(false);
    }, (err) => {
      console.error('Failed to load Monzo transactions', err);
      setError('Unable to load Monzo transactions.');
      setLoading(false);
    });

    return () => {
      unsubSummary();
      unsubAlignment();
      unsubTx();
    };
  }, [currentUser]);

  // Load budgets (optional; defined via Settings → Finance)
  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_budgets', currentUser.uid);
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const d: any = snap.data();
        setBudgets(d.byCategory || {});
        setBudgetCurrency(d.currency || 'GBP');
      }
    }).catch(() => {});
  }, [currentUser]);

  useEffect(() => {
    setRowEdits((prev) => {
      const next = { ...prev };
      transactions.forEach((tx) => {
        if (!next[tx.transactionId]) {
          const derivedType = tx.userCategoryType || tx.defaultCategoryType || 'optional';
          const derivedLabel = tx.userCategoryLabel || tx.defaultCategoryLabel || tx.description;
          next[tx.transactionId] = {
            categoryType: derivedType,
            label: derivedLabel,
          };
        }
      });
      return next;
    });
  }, [transactions]);

  const totals = summary?.totals || { mandatory: 0, optional: 0, savings: 0, income: 0 };
  const pendingClassification = summary?.pendingClassification || [];
  const pendingCount = summary?.pendingCount || 0;

  const handleEditChange = (transactionId: string, field: 'categoryType' | 'label', value: string) => {
    setRowEdits((prev) => ({
      ...prev,
      [transactionId]: {
        categoryType: field === 'categoryType' ? value : (prev[transactionId]?.categoryType || 'optional'),
        label: field === 'label' ? value : (prev[transactionId]?.label || ''),
      },
    }));
  };

  const updateCategory = async (transactionId: string) => {
    if (!currentUser) return;
    const edit = rowEdits[transactionId];
    if (!edit) return;
    try {
      setSavingTx(transactionId);
      const fn = httpsCallable(functions, 'updateMonzoTransactionCategory');
      await fn({
        transactionId,
        categoryType: edit.categoryType,
        label: edit.label || null,
      });
    } catch (err: any) {
      console.error('Failed to update category', err);
      setError(err?.message || 'Failed to update category');
    } finally {
      setSavingTx(null);
    }
  };

  const recomputeAnalytics = async () => {
    if (!currentUser) return;
    try {
      setIsRecomputing(true);
      const fn = httpsCallable(functions, 'recomputeMonzoAnalytics');
      await fn({});
    } catch (err: any) {
      console.error('Failed to recompute analytics', err);
      setError(err?.message || 'Failed to recompute analytics');
    } finally {
      setIsRecomputing(false);
    }
  };

  const monthlySeries = useMemo(() => {
    if (!summary?.monthly) return [];
    return Object.entries(summary.monthly)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([month, values]) => ({ month, values }));
  }, [summary?.monthly]);

  // Budgets vs Actuals (current window from summary.categories)
  const budgetsView = useMemo(() => {
    if (!summary || !Array.isArray(summary.categories) || Object.keys(budgets).length === 0) return [] as Array<{ key: string; actual: number; budget: number }>;
    const actualByLabel: Record<string, number> = {};
    for (const c of summary.categories) {
      const label = String(c.label || '').toLowerCase();
      if (!label) continue;
      actualByLabel[label] = (actualByLabel[label] || 0) + (c.amount || 0);
    }
    const out: Array<{ key: string; actual: number; budget: number }> = [];
    for (const [rawKey, budgetMinor] of Object.entries(budgets)) {
      const key = rawKey.toLowerCase();
      const actual = actualByLabel[key] || 0;
      const budget = Number(budgetMinor || 0);
      out.push({ key: rawKey, actual, budget });
    }
    return out.sort((a,b) => (b.actual - b.budget) - (a.actual - a.budget));
  }, [summary, budgets]);

  // Identify goals/themes without a matched Monzo pot
  const goalsMissingPots = useMemo(() => (alignment?.goals || []).filter(g => !g.potName), [alignment?.goals]);

  // Rough "time to target" estimation: use average monthly savings from summary.monthly
  const monthlySavings = useMemo(() => {
    const months = summary?.monthly ? Object.values(summary.monthly) : [];
    const valid = months.filter(m => typeof m?.savings === 'number');
    if (valid.length === 0) return 0;
    const total = valid.reduce((acc, m:any) => acc + (m.savings||0), 0);
    return total / valid.length;
  }, [summary?.monthly]);


  if (!currentUser) {
    return (
      <div className="container py-5">
        <Alert variant="warning">Sign in to view finance insights.</Alert>
      </div>
    );
  }

  return (
    <div className="container-fluid py-4">
      <Row className="mb-4 align-items-center">
        <Col>
          <h1 className="mb-2">Finance Hub</h1>
          <p className="text-muted mb-0">
            Review Monzo transactions, categorise spending, and track pot funding against life goals.
          </p>
        </Col>
        <Col xs="auto" className="d-flex gap-2 align-items-center">
          <Button variant="outline-primary" onClick={recomputeAnalytics} disabled={isRecomputing}>
            {isRecomputing ? <Spinner animation="border" size="sm" className="me-2" /> : null}
            Refresh Analytics
          </Button>
          <Button variant="primary" as="a" href="/settings?tab=integrations">
            Open Integrations Settings
          </Button>
        </Col>
      </Row>

      {error && (
        <Alert variant="danger" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          <Row className="gy-4">
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Mandatory Spend</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.mandatory)}</Card.Text>
                  <span className="text-muted">Bills, groceries, commuting</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Optional Spend</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.optional)}</Card.Text>
                  <span className="text-muted">Dining, entertainment, discretionary</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Savings & Pots</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.savings)}</Card.Text>
                  <span className="text-muted">Transfers earmarked for goals</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Income Recorded</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.income)}</Card.Text>
                  <span className="text-muted">Paydays and reimbursements</span>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="gy-4 mt-1">
            <Col lg={8}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Recent Transactions</Card.Title>
                  <Table responsive hover size="sm" className="align-middle">
                    <thead>
                      <tr>
                        <th style={{ width: '18%' }}>Date</th>
                        <th>Description</th>
                        <th style={{ width: '12%' }} className="text-end">Amount</th>
                        <th style={{ width: '18%' }}>Category</th>
                        <th style={{ width: '22%' }}>Label</th>
                        <th style={{ width: '12%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.length === 0 && (
                        <tr>
                          <td colSpan={6} className="text-center text-muted py-4">
                            No transactions synced yet. Connect Monzo from Settings → Integrations.
                          </td>
                        </tr>
                      )}
                      {transactions.map((tx) => {
                        const edit = rowEdits[tx.transactionId] || { categoryType: tx.userCategoryType || tx.defaultCategoryType || 'optional', label: tx.userCategoryLabel || tx.defaultCategoryLabel || tx.description };
                        const formattedDate = tx.createdISO ? new Date(tx.createdISO).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                        return (
                          <tr key={tx.transactionId}>
                            <td>{formattedDate}</td>
                            <td>
                              <div className="fw-semibold">{tx.description}</div>
                              {tx.merchantName && tx.merchantName !== tx.description && (
                                <div className="text-muted small">{tx.merchantName}</div>
                              )}
                            </td>
                            <td className="text-end">
                              <span className={tx.amount < 0 ? 'text-danger' : 'text-success'}>
                                {formatCurrency(Math.abs(tx.amount))}
                              </span>
                            </td>
                            <td>
                              <Form.Select
                                size="sm"
                                value={edit.categoryType}
                                onChange={(e) => handleEditChange(tx.transactionId, 'categoryType', e.target.value)}
                              >
                                {CATEGORY_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </Form.Select>
                            </td>
                            <td>
                              <Form.Control
                                size="sm"
                                value={edit.label}
                                onChange={(e) => handleEditChange(tx.transactionId, 'label', e.target.value)}
                              />
                            </td>
                            <td className="text-end">
                              <Button
                                size="sm"
                                variant="outline-primary"
                                onClick={() => updateCategory(tx.transactionId)}
                                disabled={savingTx === tx.transactionId}
                              >
                                {savingTx === tx.transactionId ? 'Saving…' : 'Save'}
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Classification Queue</Card.Title>
                  <p className="text-muted mb-2">
                    {pendingCount > 0
                      ? `${pendingCount} transactions still rely on defaults. Prioritise mandatory vs optional tagging to sharpen budget insights.`
                      : 'All transactions have custom categories. Great job!'}
                  </p>
                  {pendingClassification.length === 0 ? (
                    <Alert variant="success" className="mb-0">No pending items.</Alert>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {pendingClassification.map((item) => (
                        <div key={item.transactionId} className="border rounded p-2">
                          <div className="fw-semibold">{item.description}</div>
                          <div className="small text-muted d-flex justify-content-between">
                            <span>{item.createdISO ? new Date(item.createdISO).toLocaleDateString('en-GB') : '—'}</span>
                            <span>{formatCurrency(item.amount)}</span>
                          </div>
                          <Badge bg="secondary" className="mt-2">
                            Default: {item.defaultCategoryType || 'optional'}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  )}
              </Card.Body>
            </Card>
          </Col>
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Budgets vs Actual</Card.Title>
                  {budgetsView.length === 0 ? (
                    <Alert variant="light" className="mb-0">No budgets configured. Set budgets under Settings → Finance.</Alert>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {budgetsView.map(({ key, actual, budget }) => {
                        const pct = budget > 0 ? Math.min(100, Math.round((actual / budget) * 100)) : 0;
                        const over = budget > 0 && actual > budget;
                        return (
                          <div key={key}>
                            <div className="d-flex justify-content-between small"><span>{key}</span><span>{formatCurrency(actual)} / {formatCurrency(budget)}</span></div>
                            <ProgressBar now={pct} variant={over ? 'danger' : 'success'} style={{ height: 8 }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="gy-4 mt-1">
            <Col lg={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Goal & Pot Alignment</Card.Title>
                  {alignment?.goals && alignment.goals.length > 0 ? (
                    <Table size="sm" responsive hover className="align-middle">
                      <thead>
                        <tr>
                          <th>Goal</th>
                          <th>Theme</th>
                          <th className="text-end">Estimated Cost</th>
                          <th className="text-end">Pot Balance</th>
                          <th className="text-end">Progress</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alignment.goals.map((goal) => (
                          <tr key={goal.goalId}>
                            <td>
                              <div className="fw-semibold">{goal.title}</div>
                              <div className="text-muted small">{goal.potName ? `Pot: ${goal.potName}` : 'No pot linked'}</div>
                            </td>
                            <td>
                              <Badge bg="light" text="dark">
                                {goal.themeName || getThemeName(goal.themeId)}
                              </Badge>
                            </td>
                            <td className="text-end">{formatCurrency(goal.estimatedCost)}</td>
                            <td className="text-end">{formatCurrency(goal.potBalance)}</td>
                            <td className="text-end">
                              <div>{formatPercent(goal.fundedPercent)}</div>
                              {goal.estimatedCost && monthlySavings > 0 && (
                                <div className="small text-muted">ETA: {(() => {
                                  const shortfall = Math.max((goal.estimatedCost||0) - (goal.potBalance||0), 0);
                                  const months = shortfall > 0 ? (shortfall / monthlySavings) : 0;
                                  return months > 0 ? `${Math.ceil(months)} mo` : '—';
                                })()}</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : (
                    <Alert variant="info" className="mb-0">
                      No goals found yet. Add estimated costs in Goals to unlock funding forecasts.
                    </Alert>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col lg={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Monthly Spend Trends</Card.Title>
                  {monthlySeries.length === 0 ? (
                    <Alert variant="light" className="mb-0">Sync transactions to populate monthly trends.</Alert>
                  ) : (
                    <Table size="sm" responsive className="align-middle">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th className="text-end">Mandatory</th>
                          <th className="text-end">Optional</th>
                          <th className="text-end">Savings</th>
                          <th className="text-end">Income</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlySeries.map(({ month, values }) => (
                          <tr key={month}>
                            <td>{month}</td>
                            <td className="text-end">{formatCurrency(values.mandatory)}</td>
                            <td className="text-end">{formatCurrency(values.optional)}</td>
                            <td className="text-end">{formatCurrency(values.savings)}</td>
                            <td className="text-end">{formatCurrency(values.income)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
              </Card.Body>
            </Card>
          </Col>
          {goalsMissingPots && goalsMissingPots.length > 0 && (
            <Col lg={12}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Goals without a Monzo Pot</Card.Title>
                  <Table size="sm" responsive hover className="align-middle">
                    <thead>
                      <tr>
                        <th>Goal</th>
                        <th>Theme</th>
                        <th className="text-end">Estimated Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {goalsMissingPots.map((g) => (
                        <tr key={g.goalId}>
                          <td>{g.title}</td>
                          <td>{g.themeName || getThemeName(g.themeId)}</td>
                          <td className="text-end">{formatCurrency(g.estimatedCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <Alert variant="info" className="mb-0">Tip: Create or rename a pot to match the goal title for automatic alignment.</Alert>
                </Card.Body>
              </Card>
            </Col>
          )}
        </Row>
        </>
      )}
    </div>
  );
};

export default FinanceDashboard;
