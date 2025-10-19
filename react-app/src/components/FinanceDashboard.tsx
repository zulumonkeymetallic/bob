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

interface ThemeProgressItem {
  themeId: number;
  themeName: string;
  goalCount: number;
  totalEstimatedCost: number;
  totalPotBalance: number;
  totalShortfall: number;
  fundedPercent?: number | null;
}

interface BudgetSummaryDoc {
  ownerUid: string;
  totals: BudgetTotals;
  categories?: Array<{ label: string; amount: number; count: number; type: string }>;
  monthly?: Record<string, BudgetTotals>;
  spendTimeline?: Array<{ month: string; mandatory: number; optional: number; savings: number; income: number; net?: number }>;
  merchantSummary?: Array<{ merchantKey: string; merchantName: string; totalSpend: number; transactions: number; primaryCategoryType: string; lastTransactionISO?: string | null }>;
  budgetProgress?: Array<{ key: string; budget: number; actual: number; variance: number; utilisation?: number | null }>;
  currency?: string;
  netCashflow?: number;
  themeProgress?: ThemeProgressItem[];
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
  merchantName?: string | null;
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
  themes?: ThemeProgressItem[];
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

const formatCurrency = (value: number | undefined | null, currency: string = 'GBP') => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return amount.toLocaleString('en-GB', { style: 'currency', currency });
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

  const currency = summary?.currency || budgetCurrency || 'GBP';
  const formatMoney = (value: number | undefined | null) => formatCurrency(value, currency);
  const totals = summary?.totals || { mandatory: 0, optional: 0, savings: 0, income: 0 };
  const netCashflow = summary?.netCashflow ?? (totals.income - (totals.mandatory + totals.optional + totals.savings));
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
    const timeline = summary?.spendTimeline;
    if (Array.isArray(timeline) && timeline.length > 0) {
      return timeline.map((item) => ({
        month: item.month,
        values: {
          mandatory: item.mandatory || 0,
          optional: item.optional || 0,
          savings: item.savings || 0,
          income: item.income || 0,
          net: item.net != null ? item.net : (item.income - ((item.mandatory || 0) + (item.optional || 0) + (item.savings || 0))),
        },
      }));
    }
    if (!summary?.monthly) return [];
    return Object.entries(summary.monthly)
      .sort(([a], [b]) => (a > b ? 1 : -1))
      .map(([month, values]) => ({ month, values: { ...values, net: (values.income || 0) - ((values.mandatory || 0) + (values.optional || 0) + (values.savings || 0)) } }));
  }, [summary?.spendTimeline, summary?.monthly]);

  // Projections based on average of available months
  const projections = useMemo(() => {
    const entries = monthlySeries;
    if (!entries || entries.length === 0) return { spendAnnual: null as number | null, savingsAnnual: null as number | null };
    const sums = entries.reduce((acc, e) => {
      acc.spend += (e.values.mandatory || 0) + (e.values.optional || 0);
      acc.savings += (e.values.savings || 0);
      return acc;
    }, { spend: 0, savings: 0 });
    const avgSpend = sums.spend / entries.length;
    const avgSavings = sums.savings / entries.length;
    return { spendAnnual: avgSpend * 12, savingsAnnual: avgSavings * 12 };
  }, [monthlySeries]);

  // Short-window deltas (last 3 vs previous 3 months)
  const deltas = useMemo(() => {
    const n = monthlySeries.length;
    const window = n >= 6 ? 3 : n >= 4 ? 2 : 0;
    if (window === 0) return null as null | Record<string, number>;
    const last = monthlySeries.slice(n - window);
    const prev = monthlySeries.slice(n - 2*window, n - window);
    const sumType = (arr: typeof monthlySeries, key: keyof BudgetTotals) => arr.reduce((acc, e) => acc + (e.values[key] || 0), 0);
    const pct = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
    return {
      mandatory: pct(sumType(last, 'mandatory'), sumType(prev, 'mandatory')),
      optional: pct(sumType(last, 'optional'), sumType(prev, 'optional')),
      savings: pct(sumType(last, 'savings'), sumType(prev, 'savings')),
      income: pct(sumType(last, 'income'), sumType(prev, 'income')),
    } as Record<string, number | null> as any;
  }, [monthlySeries]);

  const formatCategory = (type: string | null | undefined) => {
    if (!type) return 'Uncategorised';
    const normalized = type.toLowerCase();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const renderDelta = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return null;
    const up = v > 0;
    const fmt = `${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`;
    return <Badge bg={up ? 'danger' : 'success'} className="ms-2">{fmt}</Badge>;
  };

  const budgetLines = useMemo(() => {
    if (summary?.budgetProgress && summary.budgetProgress.length > 0) {
      return summary.budgetProgress.map((item) => ({
        key: item.key || 'Budget',
        actual: item.actual || 0,
        budget: item.budget || 0,
        variance: item.variance != null ? item.variance : ((item.budget || 0) - (item.actual || 0)),
        utilisation: item.utilisation != null ? item.utilisation : (item.budget > 0 ? (item.actual / item.budget) * 100 : null),
      }));
    }
    if (!summary || Object.keys(budgets).length === 0) return [] as Array<{ key: string; actual: number; budget: number; variance: number; utilisation: number | null }>;
    const actualByLabel: Record<string, number> = {};
    for (const c of summary.categories || []) {
      const label = String(c.label || '').toLowerCase();
      if (!label) continue;
      actualByLabel[label] = (actualByLabel[label] || 0) + (c.amount || 0);
    }
    const out: Array<{ key: string; actual: number; budget: number; variance: number; utilisation: number | null }> = [];
    for (const [rawKey, budgetMinor] of Object.entries(budgets)) {
      const key = rawKey.toLowerCase();
      const actual = actualByLabel[key] || 0;
      const budget = Number(budgetMinor || 0);
      const variance = budget - actual;
      const utilisation = budget > 0 ? (actual / budget) * 100 : null;
      out.push({ key: rawKey, actual, budget, variance, utilisation });
    }
    return out.sort((a, b) => (b.actual - b.budget) - (a.actual - a.budget));
  }, [summary, budgets]);

  const merchantSummary = useMemo(() => {
    const merchants = summary?.merchantSummary || [];
    return merchants.slice(0, 6);
  }, [summary?.merchantSummary]);

  const themeProgress = useMemo(() => {
    if (summary?.themeProgress && summary.themeProgress.length > 0) return summary.themeProgress;
    return alignment?.themes || [];
  }, [summary?.themeProgress, alignment?.themes]);


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
          <Button variant="outline-secondary" as="a" href="/finance/merchants">
            Manage Merchants
          </Button>
          <Button variant="outline-secondary" as="a" href="/finance/categories">
            Categories
          </Button>
          <Button variant="outline-secondary" as="a" href="/finance/budgets">
            Budgets
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
                  <Card.Title>Mandatory Spend {renderDelta(deltas?.mandatory as any)}</Card.Title>
                  <Card.Text className="display-6">{formatMoney(totals.mandatory)}</Card.Text>
                  <span className="text-muted">Bills, groceries, commuting</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Optional Spend {renderDelta(deltas?.optional as any)}</Card.Title>
                  <Card.Text className="display-6">{formatMoney(totals.optional)}</Card.Text>
                  <span className="text-muted">Dining, entertainment, discretionary</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Savings & Pots {renderDelta(deltas?.savings as any)}</Card.Title>
                  <Card.Text className="display-6">{formatMoney(totals.savings)}</Card.Text>
                  <span className="text-muted">Transfers earmarked for goals</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Income Recorded {renderDelta(deltas?.income as any)}</Card.Title>
                  <Card.Text className="display-6">{formatMoney(totals.income)}</Card.Text>
                  <div className={`small fw-semibold ${netCashflow >= 0 ? 'text-success' : 'text-danger'}`}>
                    Net Cashflow: {formatMoney(netCashflow)}
                  </div>
                  <span className="text-muted">Paydays and reimbursements</span>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="gy-4 mt-1">
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Budgets vs Actual</Card.Title>
                  {budgetLines.length === 0 ? (
                    <Alert variant="light" className="mb-0">No budgets configured. Set budgets under Settings → Finance.</Alert>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {budgetLines.map((line) => {
                        const pct = line.budget > 0 ? Math.min(100, Math.round((line.actual / line.budget) * 100)) : 0;
                        const over = line.budget > 0 && line.actual > line.budget;
                        return (
                          <div key={line.key}>
                            <div className="d-flex justify-content-between small"><span>{line.key}</span><span>{formatMoney(line.actual)} / {formatMoney(line.budget)}</span></div>
                            <ProgressBar now={pct} variant={over ? 'danger' : 'success'} style={{ height: 8 }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
              </Card.Body>
              </Card>
            </Col>
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Merchant Hotspots</Card.Title>
                  {merchantSummary.length === 0 ? (
                    <Alert variant="light" className="mb-0">No spend data yet.</Alert>
                  ) : (
                    <Table size="sm" borderless className="mb-0">
                      <tbody>
                        {merchantSummary.map((merchant) => (
                          <tr key={merchant.merchantKey}>
                            <td>
                              <div className="fw-semibold">{merchant.merchantName}</div>
                              <div className="text-muted small">
                                {formatCategory(merchant.primaryCategoryType)}
                                {merchant.lastTransactionISO ? ` · ${new Date(merchant.lastTransactionISO).toLocaleDateString('en-GB')}` : ''}
                                { (merchant as any).isRecurring ? ' · Recurring' : '' }
                              </div>
                            </td>
                            <td className="text-end fw-semibold">{formatMoney(merchant.totalSpend)}</td>
                            <td className="text-end text-muted small">{merchant.transactions} tx</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
              </Card.Body>
            </Card>
            </Col>
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Projections</Card.Title>
                  {!projections.spendAnnual && !projections.savingsAnnual ? (
                    <Alert variant="light" className="mb-0">Insufficient data for projections.</Alert>
                  ) : (
                    <Table size="sm" borderless className="mb-0">
                      <tbody>
                        <tr>
                          <td className="text-muted">Projected Annual Spend</td>
                          <td className="text-end fw-semibold">{formatMoney(projections.spendAnnual || 0)}</td>
                        </tr>
                        <tr>
                          <td className="text-muted">Projected Annual Savings</td>
                          <td className="text-end fw-semibold">{formatMoney(projections.savingsAnnual || 0)}</td>
                        </tr>
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="gy-4 mt-1">
            <Col lg={12}>
              <Card className="shadow-sm border-0">
                <Card.Body>
                  <Card.Title>Budget Burndown (This Month)</Card.Title>
                  {budgetLines.length === 0 ? (
                    <Alert variant="light" className="mb-0">Configure budgets to enable the burndown view.</Alert>
                  ) : (
                    (() => {
                      const now = new Date();
                      const totalDays = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
                      const day = now.getDate();
                      const monthPct = Math.round((day / totalDays) * 100);
                      const totals = budgetLines.reduce((acc, l) => { acc.b += l.budget; acc.a += l.actual; return acc; }, { a:0, b:0 });
                      const spendPct = totals.b > 0 ? Math.min(100, Math.round((totals.a / totals.b) * 100)) : 0;
                      const over = totals.a > totals.b * (day/totalDays + 0.05); // 5% tolerance
                      return (
                        <>
                          <div className="d-flex justify-content-between small mb-1">
                            <span>Time elapsed</span>
                            <span>{monthPct}%</span>
                          </div>
                          <ProgressBar now={monthPct} variant="secondary" style={{ height: 6 }} className="mb-2" />
                          <div className="d-flex justify-content-between small mb-1">
                            <span>Spend vs Budget</span>
                            <span>{spendPct}% ({formatMoney(totals.a)} / {formatMoney(totals.b)})</span>
                          </div>
                          <ProgressBar now={spendPct} variant={over ? 'danger' : 'success'} style={{ height: 8 }} />
                        </>
                      );
                    })()
                  )}
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
                                {formatMoney(Math.abs(tx.amount))}
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
                          {item.merchantName && (
                            <div className="text-muted small">Merchant: {item.merchantName}</div>
                          )}
                          <div className="small text-muted d-flex justify-content-between">
                            <span>{item.createdISO ? new Date(item.createdISO).toLocaleDateString('en-GB') : '—'}</span>
                            <span>{formatMoney(item.amount)}</span>
                          </div>
                          <Badge bg="secondary" className="mt-2">
                            Default: {formatCategory(item.defaultCategoryType || 'optional')}
                          </Badge>
                        </div>
                      ))}
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
                            <td className="text-end">{formatMoney(goal.estimatedCost)}</td>
                            <td className="text-end">{formatMoney(goal.potBalance)}</td>
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
            <Col lg={5}>
              <Card className="shadow-sm border-0">
                <Card.Body>
                  <Card.Title>Theme Progress</Card.Title>
                  {themeProgress.length === 0 ? (
                    <Alert variant="light" className="mb-0">Link goals to pots to track progress.</Alert>
                  ) : (
                    <Table size="sm" borderless className="mb-0">
                      <tbody>
                        {themeProgress.map((theme) => (
                          <tr key={theme.themeId || theme.themeName}>
                            <td>
                              <div className="fw-semibold">{theme.themeName}</div>
                              <div className="text-muted small">{theme.goalCount} goal{theme.goalCount === 1 ? '' : 's'}</div>
                            </td>
                            <td className="text-end">
                              <div>{formatPercent(theme.fundedPercent)}</div>
                              <div className="text-muted small">{formatMoney(theme.totalPotBalance)} / {formatMoney(theme.totalEstimatedCost)}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  )}
                </Card.Body>
              </Card>
              <Card className="shadow-sm border-0 mt-3">
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
                          <th className="text-end">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {monthlySeries.map(({ month, values }) => (
                          <tr key={month}>
                            <td>{month}</td>
                            <td className="text-end">{formatMoney(values.mandatory)}</td>
                            <td className="text-end">{formatMoney(values.optional)}</td>
                            <td className="text-end">{formatMoney(values.savings)}</td>
                            <td className="text-end">{formatMoney(values.income)}</td>
                            <td className="text-end">{formatMoney(values.net)}</td>
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
                            <td className="text-end">{formatMoney(g.estimatedCost)}</td>
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
