import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, ProgressBar, Row, Spinner, Table } from 'react-bootstrap';
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { getThemeName } from '../utils/statusHelpers';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Tooltip, Legend);

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
  buckets?: Array<{ label: string; amount: number; count: number }>;
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
  const [bucketBudgets, setBucketBudgets] = useState<Record<string, number>>({});
  const [budgetCurrency, setBudgetCurrency] = useState('GBP');
  // Goal docs for target dates and additional fields
  const [goalsMap, setGoalsMap] = useState<Record<string, any>>({});
  // Daily spend series for burn‑down
  const [dailySpend, setDailySpend] = useState<number[]>([]);
  const [pots, setPots] = useState<any[]>([]);

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

  // Pots for theme pot progress (client fallback if alignment missing balances)
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(query(collection(db, 'monzo_pots'), where('ownerUid','==', currentUser.uid)), (snap) => {
      setPots(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
    });
    return unsub;
  }, [currentUser]);

  // Load goals map for targetDate information
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(query(collection(db, 'goals'), where('ownerUid','==', currentUser.uid)), (snap) => {
      const map: Record<string, any> = {};
      snap.forEach(d => map[d.id] = d.data());
      setGoalsMap(map);
    });
    return unsub;
  }, [currentUser]);

  // Build daily spend series for the current month
  useEffect(() => {
    const run = async () => {
      if (!currentUser) return;
      const now = new Date();
      const y = now.getFullYear();
      const m = now.getMonth();
      const start = new Date(y, m, 1, 0,0,0,0);
      const end = new Date(y, m + 1, 1, 0,0,0,0);
      try {
        const q = query(
          collection(db, 'monzo_transactions'),
          where('ownerUid','==', currentUser.uid),
          where('createdAt','>=', start),
          where('createdAt','<', end),
          orderBy('createdAt','asc')
        ) as any;
        const snap = await (await import('firebase/firestore')).getDocs(q);
        const daysInMonth = new Date(y, m + 1, 0).getDate();
        const daily: number[] = Array.from({ length: daysInMonth }, () => 0);
        snap.forEach(d => {
          const data: any = d.data() || {};
          const ts = data.createdAt?.toDate ? data.createdAt.toDate() : (data.createdAt ? new Date(data.createdAt) : null);
          if (!ts) return;
          const day = ts.getDate();
          const amt = Number(data.amount);
          if (Number.isFinite(amt) && amt < 0) daily[day - 1] += Math.abs(amt);
        });
        for (let i = 1; i < daily.length; i++) daily[i] += daily[i-1];
        setDailySpend(daily);
      } catch (e) {
        setDailySpend([]);
      }
    };
    run();
  }, [currentUser]);

  // Load budgets (optional; defined via Settings → Finance)
  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_budgets', currentUser.uid);
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const d: any = snap.data();
        setBudgets(d.byCategory || {});
        setBucketBudgets(d.byBucket || {});
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

  // Budget burn-down (pace vs day of month)
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const today = new Date();
  const day = today.getDate();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const currentMonth = (summary?.monthly && summary.monthly[currentMonthKey]) || null;
  const monthSpend = (currentMonth?.mandatory || 0) + (currentMonth?.optional || 0);
  const totalCategoryBudget = useMemo(() => Object.values(budgets || {}).reduce((s,v)=> s + (Number(v)||0), 0), [budgets]);
  const expectedSpend = totalCategoryBudget > 0 ? (totalCategoryBudget * (day / Math.max(1, daysInMonth))) : 0;
  const paceDelta = monthSpend - expectedSpend; // >0 means over pace
  const paceStatus: 'ahead'|'behind'|'on' = totalCategoryBudget === 0 ? 'on' : (paceDelta > totalCategoryBudget*0.03 ? 'behind' : (paceDelta < -totalCategoryBudget*0.03 ? 'ahead' : 'on'));

  const burnDownChartData = useMemo(() => {
    if (!dailySpend.length || totalCategoryBudget <= 0) return null as any;
    const labels = Array.from({ length: dailySpend.length }, (_, i) => String(i + 1));
    const pacePerDay = totalCategoryBudget / dailySpend.length;
    const expected = labels.map((_, idx) => pacePerDay * (idx + 1));
    return {
      labels,
      datasets: [
        { label: 'Expected', data: expected, borderColor: '#94a3b8', backgroundColor: 'transparent', tension: 0.2 },
        { label: 'Actual', data: dailySpend, borderColor: '#0ea5e9', backgroundColor: 'transparent', tension: 0.2 },
      ]
    };
  }, [dailySpend, totalCategoryBudget]);

  const spendSpikes = useMemo(() => {
    if (!dailySpend.length) return [] as Array<{ day: number; amount: number }>;
    const diffs: number[] = dailySpend.map((v, i) => i === 0 ? v : (v - dailySpend[i-1]));
    const avg = diffs.reduce((a,b)=>a+b,0) / diffs.length;
    const variance = diffs.reduce((a,b)=> a + Math.pow(b - avg, 2), 0) / diffs.length;
    const std = Math.sqrt(variance);
    const out: Array<{ day: number; amount: number }> = [];
    diffs.forEach((amt, idx) => {
      if (amt > (avg + 1.5*std) && amt > 0) out.push({ day: idx + 1, amount: amt });
    });
    return out.sort((a,b)=> b.amount - a.amount).slice(0,5);
  }, [dailySpend]);

  // Anomalies from recent transactions (outliers by amount)
  const anomalies = useMemo(() => {
    if (!transactions.length) return [] as Array<{ desc: string; amount: number; date: string; link: string }>;
    const spends = transactions.filter(t => t.amount < 0).map(t => Math.abs(t.amount));
    if (spends.length < 5) return [] as any[];
    const avg = spends.reduce((a,b)=>a+b,0) / spends.length;
    const variance = spends.reduce((a,b)=> a + Math.pow(b - avg, 2), 0) / spends.length;
    const std = Math.sqrt(variance);
    const out: Array<{ desc: string; amount: number; date: string; link: string }> = [];
    transactions.forEach(t => {
      if (t.amount < 0 && Math.abs(t.amount) > (avg + 1.5*std)) {
        const desc = t.userCategoryLabel || t.defaultCategoryLabel || t.description || 'Transaction';
        const link = `/finance/transactions?q=${encodeURIComponent(desc.split(' ')[0])}`;
        out.push({ desc, amount: Math.abs(t.amount), date: t.createdISO ? new Date(t.createdISO).toLocaleDateString() : '—', link });
      }
    });
    return out.sort((a,b)=> b.amount - a.amount).slice(0,6);
  }, [transactions]);

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

  const renderDelta = (v: number | null | undefined) => {
    if (v == null || Number.isNaN(v)) return null;
    const up = v > 0;
    const fmt = `${up ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}%`;
    return <Badge bg={up ? 'danger' : 'success'} className="ms-2">{fmt}</Badge>;
  };

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
                  <Card.Title>Mandatory Spend {renderDelta(deltas?.mandatory as any)}</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.mandatory)}</Card.Text>
                  <span className="text-muted">Bills, groceries, commuting</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Optional Spend {renderDelta(deltas?.optional as any)}</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.optional)}</Card.Text>
                  <span className="text-muted">Dining, entertainment, discretionary</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Savings & Pots {renderDelta(deltas?.savings as any)}</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.savings)}</Card.Text>
                  <span className="text-muted">Transfers earmarked for goals</span>
                </Card.Body>
              </Card>
            </Col>
            <Col lg={3} md={6}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Income Recorded {renderDelta(deltas?.income as any)}</Card.Title>
                  <Card.Text className="display-6">{formatCurrency(totals.income)}</Card.Text>
                  <span className="text-muted">Paydays and reimbursements</span>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="gy-4 mt-1">
            {/* Budget Pace (Burn-down) */}
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Budget Pace</Card.Title>
                  {totalCategoryBudget === 0 ? (
                    <Alert variant="light" className="mb-0">Set category budgets in Finance Settings.</Alert>
                  ) : (
                    <>
                      <div className="d-flex justify-content-between small mb-1">
                        <span>Expected by today</span>
                        <span>{formatCurrency(expectedSpend)}</span>
                      </div>
                      <div className="d-flex justify-content-between small mb-2">
                        <span>Actual</span>
                        <span>{formatCurrency(monthSpend)}</span>
                      </div>
                      <div className="d-flex justify-content-between align-items-center">
                        <div>
                          <Badge bg={paceStatus==='behind'?'danger': paceStatus==='ahead'?'success':'secondary'}>
                            {paceStatus === 'behind' ? 'Over pace' : paceStatus === 'ahead' ? 'Under pace' : 'On pace'}
                          </Badge>
                        </div>
                        <div className="small text-muted">Day {day}/{daysInMonth}</div>
                      </div>
                    </>
                  )}
                </Card.Body>
              </Card>
            </Col>
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
                          <td className="text-end fw-semibold">{formatCurrency(projections.spendAnnual || 0)}</td>
                        </tr>
                        <tr>
                          <td className="text-muted">Projected Annual Savings</td>
                          <td className="text-end fw-semibold">{formatCurrency(projections.savingsAnnual || 0)}</td>
                        </tr>
                      </tbody>
                    </Table>
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
            <Col lg={4}>
              <Card className="shadow-sm border-0 h-100">
                <Card.Body>
                  <Card.Title>Buckets</Card.Title>
                  {!summary?.buckets || summary.buckets.length === 0 ? (
                    <Alert variant="light" className="mb-0">No buckets yet.</Alert>
                  ) : (
                    <Table size="sm" hover responsive>
                      <thead><tr><th>Bucket</th><th className="text-end">Amount</th><th className="text-end">Budget</th></tr></thead>
                      <tbody>
                        {summary.buckets.slice(0, 10).map((b, idx) => (
                          <tr key={idx}>
                            <td>{b.label}</td>
                            <td className="text-end">{formatCurrency(b.amount)}</td>
                            <td className="text-end">{bucketBudgets[b.label] != null ? formatCurrency(bucketBudgets[b.label] || 0) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
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
          <Col lg={6}>
            <Card className="shadow-sm border-0 h-100">
              <Card.Body>
                <Card.Title>Anomalies (Recent)</Card.Title>
                {anomalies.length === 0 ? (
                  <Alert variant="light" className="mb-0">No anomalies detected in recent transactions.</Alert>
                ) : (
                  <Table size="sm" responsive>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Description</th>
                        <th className="text-end">Amount</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {anomalies.map((a, idx) => (
                        <tr key={idx}>
                          <td>{a.date}</td>
                          <td>{a.desc}</td>
                          <td className="text-end">{formatCurrency(a.amount)}</td>
                          <td className="text-end"><a className="btn btn-sm btn-outline-secondary" href={a.link}>View</a></td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
          </Col>
          <Col lg={6}>
            <Card className="shadow-sm border-0 h-100">
              <Card.Body>
                <Card.Title>Theme Pot Progress</Card.Title>
                {!alignment?.themes || alignment.themes.length === 0 ? (
                  <Alert variant="light" className="mb-0">No theme alignment found yet.</Alert>
                ) : (
                  <Table size="sm" responsive>
                    <thead>
                      <tr>
                        <th>Theme</th>
                        <th className="text-end">Estimated</th>
                        <th className="text-end">Pot Balance</th>
                        <th className="text-end">Progress</th>
                      </tr>
                    </thead>
                    <tbody>
                      {alignment.themes.map((t) => {
                        const est = t.totalEstimatedCost || 0;
                        // Fallback: compute theme pot balance by matching pot names
                        let bal = t.totalPotBalance || 0;
                        if (!bal && pots.length) {
                          const name = String(t.themeName || getThemeName(t.themeId)).toLowerCase();
                          const synonyms: Record<number, string[]> = { 1:['health','fitness'], 2:['growth','spiritual'], 3:['finance','wealth','money'], 4:['tribe','family','relationships'], 5:['home','living','house'] };
                          const words = synonyms[t.themeId as 1|2|3|4|5] || [name];
                          bal = pots.filter(p => {
                            const n = String(p.name||'').toLowerCase();
                            return words.some(w => n.includes(w));
                          }).reduce((s,p)=> s + Number(p.balance||0)/100, 0);
                        }
                        const pct = est > 0 ? Math.min(100, Math.round((bal / est) * 100)) : 0;
                        return (
                          <tr key={t.themeId}>
                            <td>{t.themeName || getThemeName(t.themeId)}</td>
                            <td className="text-end">{formatCurrency(est)}</td>
                            <td className="text-end">{formatCurrency(bal)}</td>
                            <td className="text-end" style={{ minWidth: 140 }}>
                              <div className="d-flex align-items-center gap-2">
                                <div style={{ flex: 1 }}>
                                  <ProgressBar now={pct} style={{ height: 8 }} />
                                </div>
                                <small className="text-muted" style={{ width: 36, textAlign: 'right' }}>{pct}%</small>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
          </Col>
          <Col lg={6}>
            <Card className="shadow-sm border-0 h-100">
              <Card.Body>
                <Card.Title>Budget Burn‑down</Card.Title>
                {!burnDownChartData ? (
                  <Alert variant="light" className="mb-0">Not enough data for this month.</Alert>
                ) : (
                  <div style={{ height: 240 }}>
                    <Line data={burnDownChartData} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: (v:any)=> (Number(v)||0).toLocaleString('en-GB',{ style:'currency', currency: budgetCurrency }) } } } }} />
                  </div>
                )}
                {spendSpikes.length > 0 && (
                  <div className="mt-3">
                    <h6 className="mb-2">Spend Spikes</h6>
                    <ul className="mb-0" style={{ paddingLeft: 18 }}>
                      {spendSpikes.map(s => (
                        <li key={s.day} className="small">
                          Day {s.day}: {formatCurrency(s.amount)}
                        </li>
                      ))}
                    </ul>
                  </div>
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
