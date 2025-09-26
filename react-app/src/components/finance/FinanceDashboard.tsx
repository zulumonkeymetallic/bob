import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Card, Container, Row, Col, Table, Badge, Button, ProgressBar } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

type Tx = {
  id: string;
  ownerUid: string;
  provider: string;
  accountId: string;
  transactionId: string;
  created: number;
  amount: number; // minor units
  currency: string;
  description?: string;
  category?: string;
};

function formatMoney(minor: number, currency: string) {
  const major = (minor || 0) / 100;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major); } catch { return `${major.toFixed(2)} ${currency}`; }
}

const FinanceDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [currency, setCurrency] = useState('GBP');
  const [monthly, setMonthly] = useState<Array<{ yyyymm: string; spend: number; income: number; categories: Record<string, number> }>>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [budgetCurrency, setBudgetCurrency] = useState('GBP');
  const [onTrack, setOnTrack] = useState<boolean|null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'finance_transactions'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('created', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Tx[];
      setTxs(list);
      const c = list.find(t => t.currency)?.currency || 'GBP';
      setCurrency(c);
    });
    return () => unsub();
  }, [currentUser]);

  // Load monthly aggregates for last 12 months if present
  useEffect(() => {
    if (!currentUser) return;
    const results: Array<{ yyyymm: string; spend: number; income: number; categories: Record<string, number> }> = [];
    const start = new Date(); start.setMonth(start.getMonth()-11, 1); start.setHours(0,0,0,0);
    const ops: Promise<void>[] = [];
    for (let i=0;i<12;i++) {
      const d = new Date(start.getFullYear(), start.getMonth()+i, 1);
      const yyyymm = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
      const ref = doc(db, 'finance_monthly', `${currentUser.uid}_${yyyymm}`);
      ops.push(getDoc(ref).then(snap => { if (snap.exists()) { const v:any = snap.data(); results.push({ yyyymm, spend: v.spend||0, income: v.income||0, categories: v.categories||{} }); }}));
    }
    Promise.all(ops).then(()=> setMonthly(results));
  }, [currentUser]);

  // Compute and show on-track status
  useEffect(() => {
    if (!currentUser) return;
    const compute = async () => {
      try { const callable = httpsCallable(functions, 'financeComputeStatus'); const res:any = await callable({}); setOnTrack(res?.data?.onTrack ?? null); } catch {}
    };
    compute();
  }, [currentUser, budgets]);

  // Load budgets (if configured)
  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_budgets', currentUser.uid);
    getDoc(ref).then(snap => { if (snap.exists()) { const d:any = snap.data(); setBudgets(d.byCategory||{}); setBudgetCurrency(d.currency||'GBP'); } });
  }, [currentUser]);

  const metrics = useMemo(() => {
    const now = Date.now();
    const d30 = now - 30*86400000;
    const d60 = now - 60*86400000;
    let last30 = 0, prev30 = 0;
    const byCat: Record<string, number> = {};
    for (const t of txs) {
      // Monzo spends are negative amounts; treat spends as positive for totals
      const spend = Math.max(0, -(t.amount || 0));
      if (t.created >= d30) last30 += spend;
      else if (t.created >= d60 && t.created < d30) prev30 += spend;
      if (t.created >= d60) {
        const cat = t.category || 'uncategorised';
        byCat[cat] = (byCat[cat] || 0) + spend;
      }
    }
    const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const delta = last30 - prev30;
    return { last30, prev30, delta, topCats };
  }, [txs]);

  const monthLabels = useMemo(() => monthly.slice().sort((a,b)=>a.yyyymm.localeCompare(b.yyyymm)).map(m => `${m.yyyymm.slice(0,4)}-${m.yyyymm.slice(4)}`), [monthly]);
  const spendSeries = useMemo(() => monthly.slice().sort((a,b)=>a.yyyymm.localeCompare(b.yyyymm)).map(m => (m.spend||0)/100), [monthly]);
  const incomeSeries = useMemo(() => monthly.slice().sort((a,b)=>a.yyyymm.localeCompare(b.yyyymm)).map(m => (m.income||0)/100), [monthly]);

  const recomputeMonthly = async () => {
    try { const callable = httpsCallable(functions, 'financeComputeMonthlyAggregates'); await callable({}); }
    catch (e:any) { alert('Recompute failed: ' + (e?.message||'unknown')); }
  };

  return (
    <Container fluid className="py-3">
      <h3 className="mb-3">Finance Dashboard</h3>
      <Row className="g-3">
        <Col md={4}>
          <Card className="h-100">
            <Card.Body>
              <div className="text-muted">Spend (last 30 days)</div>
              <div className="fs-3 fw-bold">{formatMoney(metrics.last30, currency)}</div>
              <div className="small">Prev 30d: {formatMoney(metrics.prev30, currency)} {metrics.delta>=0 ? <Badge bg="danger" className="ms-1">+{formatMoney(metrics.delta, currency)}</Badge> : <Badge bg="success" className="ms-1">{formatMoney(metrics.delta, currency)}</Badge>}</div>
              {onTrack !== null && (
                <div className="mt-2">
                  {onTrack ? <Badge bg="success">On Track</Badge> : <Badge bg="danger">Over Budget</Badge>}
                </div>
              )}
              <div className="mt-3">
                <Button size="sm" variant="outline-secondary" onClick={recomputeMonthly}>Recompute Monthly</Button>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={8}>
          <Card className="h-100">
            <Card.Body style={{ height: 220 }}>
              <div className="mb-2">12-Month Trend</div>
              <Line height={180} data={{
                labels: monthLabels,
                datasets: [
                  { label: 'Spend', data: spendSeries, borderColor: 'rgba(220,53,69,0.9)', backgroundColor: 'rgba(220,53,69,0.2)' },
                  { label: 'Income', data: incomeSeries, borderColor: 'rgba(25,135,84,0.9)', backgroundColor: 'rgba(25,135,84,0.2)' },
                ]
              }} options={{ responsive: true, maintainAspectRatio: false }} />
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Budgets vs Actuals (current 30d) */}
      <Row className="g-3 mt-1">
        <Col md={12}>
          <Card className="h-100">
            <Card.Body>
              <div className="mb-2">Budgets vs Actual (30 days)</div>
              {Object.keys(budgets).length === 0 ? (
                <div className="text-muted small">No budgets configured. Configure under Settings → Finance (Monzo).</div>
              ) : (
                <div className="d-flex flex-column gap-2">
                  {Object.entries(budgets).map(([cat, budgetMinor]) => {
                    const budget = budgetMinor||0;
                    const actual = metrics.topCats.find(([c])=>c===cat)?.[1] || 0;
                    const pct = budget>0 ? Math.min(100, Math.round((actual/budget)*100)) : 0;
                    const variant = budget>0 && actual>budget ? 'danger' : 'success';
                    return (
                      <div key={cat}>
                        <div className="d-flex justify-content-between small"><span>{cat}</span><span>{formatMoney(actual, budgetCurrency)} / {formatMoney(budget, budgetCurrency)}</span></div>
                        <ProgressBar now={pct} variant={variant as any} style={{ height: 8 }} />
                      </div>
                    );
                  })}
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3 mt-1">
        <Col md={6}>
          <Card className="h-100">
            <Card.Body>
              <div className="mb-2">Top Categories (last 60 days)</div>
              <Table size="sm" hover responsive>
                <thead><tr><th>Category</th><th className="text-end">Spend</th></tr></thead>
                <tbody>
                  {metrics.topCats.map(([cat, amt]) => (
                    <tr key={cat}><td>{cat}</td><td className="text-end">{formatMoney(amt, currency)}</td></tr>
                  ))}
                </tbody>
              </Table>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default FinanceDashboard;
