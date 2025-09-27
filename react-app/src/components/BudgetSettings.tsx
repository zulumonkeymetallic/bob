import React, { useEffect, useMemo, useState } from 'react';
import { Container, Card, Row, Col, Form, Button, Table, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { collection, doc, onSnapshot, query, where, getDoc, setDoc } from 'firebase/firestore';

type CategoryType = 'mandatory' | 'optional' | 'savings' | 'income';

interface FinanceBudgetsDoc {
  currency?: string;
  monthlyIncome?: number;
  byCategory?: Record<string, number>;
  byCategoryPercent?: Record<string, number>;
  byBucket?: Record<string, number>;
}

const DEFAULT_BUCKETS = ['Mandatory', 'Discretionary', 'Savings', 'Income'];

const BudgetSettings: React.FC = () => {
  const { currentUser } = useAuth();
  const [currency, setCurrency] = useState('GBP');
  const [monthlyIncome, setMonthlyIncome] = useState<number>(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [byCategoryPercent, setByCategoryPercent] = useState<Record<string, number>>({});
  const [byBucket, setByBucket] = useState<Record<string, number>>({});
  const [categoryToBucket, setCategoryToBucket] = useState<Record<string, string>>({});
  const [latestIncome, setLatestIncome] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const bRef = doc(db, 'finance_budgets', currentUser.uid);
    const unsubB = onSnapshot(bRef, (snap) => {
      if (snap.exists()) {
        const d = snap.data() as FinanceBudgetsDoc;
        setCurrency(d.currency || 'GBP');
        setMonthlyIncome(Number(d.monthlyIncome || 0));
        setByCategory(d.byCategory || {});
        setByCategoryPercent(d.byCategoryPercent || {});
        setByBucket(d.byBucket || {});
      }
    });
    const mRef = doc(db, 'finance_mapping', currentUser.uid);
    const unsubM = onSnapshot(mRef, (snap) => {
      if (snap.exists()) {
        const d: any = snap.data() || {};
        setCategoryToBucket(d.categoryToBucket || {});
      }
    });
    const sRef = doc(db, 'monzo_budget_summary', currentUser.uid);
    const unsubS = onSnapshot(sRef, (snap) => {
      if (snap.exists()) {
        const d: any = snap.data();
        const monthly = d?.monthly || {};
        const keys = Object.keys(monthly).sort();
        if (keys.length) {
          const last = monthly[keys[keys.length - 1]];
          if (last && typeof last.income === 'number') setLatestIncome(last.income);
        }
      }
    });
    return () => { unsubB(); unsubM(); unsubS(); };
  }, [currentUser]);

  const cats = useMemo(() => Array.from(new Set([
    ...Object.keys(byCategory || {}),
    ...Object.keys(byCategoryPercent || {}),
    ...Object.keys(categoryToBucket || {})
  ])).sort(), [byCategory, byCategoryPercent, categoryToBucket]);

  const recomputeBuckets = () => {
    const income = Number(monthlyIncome || 0);
    const amounts: Record<string, number> = {};
    cats.forEach((cat) => {
      const amt = Number(byCategory[cat] || 0);
      const pct = Number(byCategoryPercent[cat] || 0);
      const derived = amt || (income > 0 ? (pct / 100) * income : 0);
      amounts[cat] = Math.max(0, Math.round(derived));
    });
    const agg: Record<string, number> = {};
    Object.entries(amounts).forEach(([cat, amt]) => {
      const bucket = categoryToBucket[cat] || 'Unassigned';
      agg[bucket] = (agg[bucket] || 0) + amt;
    });
    setByBucket(agg);
    setMessage('Buckets recalculated from categories.');
  };

  const save = async () => {
    if (!currentUser) return;
    setSaving(true);
    setMessage(null);
    try {
      // auto roll-up to buckets
      const income = Number(monthlyIncome || 0);
      const derivedByCategory: Record<string, number> = { ...byCategory };
      Object.entries(byCategoryPercent || {}).forEach(([cat, pct]) => {
        if (income > 0) {
          const amt = Math.round((Number(pct) || 0) / 100 * income);
          if (!Number.isNaN(amt)) derivedByCategory[cat] = amt;
        }
      });
      const agg: Record<string, number> = {};
      Object.entries(derivedByCategory).forEach(([cat, amt]) => {
        const bucket = categoryToBucket[cat] || 'Unassigned';
        agg[bucket] = (agg[bucket] || 0) + (Number(amt) || 0);
      });
      const budgets: FinanceBudgetsDoc = {
        currency,
        monthlyIncome: income,
        byCategory: derivedByCategory,
        byCategoryPercent: byCategoryPercent,
        byBucket: agg
      };
      await setDoc(doc(db, 'finance_budgets', currentUser.uid), budgets, { merge: true });
      setMessage('Budgets saved.');
    } catch (e: any) {
      setMessage('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Container fluid className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Budget Settings</h2>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={recomputeBuckets}>Recalculate Buckets</Button>
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Budgets'}</Button>
        </div>
      </div>
      {message && <Alert variant="info">{message}</Alert>}
      {latestIncome != null && (
        <Alert variant="light">
          Detected latest monthly income: <strong>{latestIncome.toLocaleString('en-GB',{style:'currency',currency})}</strong>
          <Button size="sm" className="ms-2" variant="outline-primary" onClick={()=> setMonthlyIncome(latestIncome || 0)}>Use this</Button>
        </Alert>
      )}
      <Card className="mb-4">
        <Card.Body>
          <Row className="mb-3">
            <Col md={3}>
              <Form.Group>
                <Form.Label>Currency</Form.Label>
                <Form.Select value={currency} onChange={(e)=>setCurrency(e.target.value)}>
                  <option value="GBP">GBP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Monthly Income</Form.Label>
                <Form.Control type="number" value={monthlyIncome} onChange={(e)=> setMonthlyIncome(Number(e.target.value||0))} />
              </Form.Group>
            </Col>
          </Row>

          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Category Budgets</h5>
            <Button size="sm" variant="outline-secondary" onClick={()=>{
              const name = prompt('Enter category name'); if (!name) return; setByCategory(prev=>({ ...prev, [name]: prev[name] || 0 }));
            }}>Add Category</Button>
          </div>
          <Table size="sm" responsive>
            <thead>
              <tr>
                <th>Category</th>
                <th>Bucket</th>
                <th className="text-end">Amount (GBP)</th>
                <th className="text-end">% of Income</th>
              </tr>
            </thead>
            <tbody>
              {cats.length === 0 ? (
                <tr><td colSpan={4} className="text-muted">No categories defined</td></tr>
              ) : (
                cats.map(cat => {
                  const amt = byCategory[cat] || 0;
                  const pct = byCategoryPercent[cat] || (monthlyIncome > 0 ? Math.round((amt / monthlyIncome) * 1000)/10 : 0);
                  const bucket = categoryToBucket[cat] || '';
                  const bucketOptions = Array.from(new Set([...Object.keys(byBucket||{}), ...DEFAULT_BUCKETS]));
                  return (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td>
                        <Form.Select size="sm" value={bucket} onChange={(e)=> setCategoryToBucket(prev=>({ ...prev, [cat]: e.target.value }))}>
                          <option value="">—</option>
                          {bucketOptions.map(b => <option key={b} value={b}>{b}</option>)}
                        </Form.Select>
                      </td>
                      <td className="text-end"><Form.Control type="number" size="sm" value={amt} onChange={(e)=> setByCategory(prev=>({ ...prev, [cat]: Number(e.target.value||0) }))} /></td>
                      <td className="text-end"><Form.Control type="number" size="sm" value={pct} onChange={(e)=> setByCategoryPercent(prev=>({ ...prev, [cat]: Number(e.target.value||0) }))} /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </Table>

          <div className="mt-3">
            <h6>By Bucket (Calculated)</h6>
            <Table size="sm" responsive>
              <thead><tr><th>Bucket</th><th className="text-end">Monthly Budget</th></tr></thead>
              <tbody>
                {Object.keys(byBucket || {}).length === 0 ? (
                  <tr><td colSpan={2} className="text-muted">No buckets calculated yet</td></tr>
                ) : (
                  Object.entries(byBucket).map(([b, amt]) => (
                    <tr key={b}><td>{b}</td><td className="text-end">{(Number(amt)||0).toLocaleString('en-GB',{ style:'currency', currency })}</td></tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default BudgetSettings;

