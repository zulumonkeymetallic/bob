import React, { useEffect, useMemo, useState } from 'react';
import { Card, Container, Row, Col, Button, Form, Table, Badge, Alert } from 'react-bootstrap';
import Papa from 'papaparse';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

type CategoryType = 'mandatory' | 'optional' | 'savings' | 'income';

interface FinanceBudgetsDoc {
  currency?: string;
  monthlyIncome?: number;
  byCategory?: Record<string, number>;
  byCategoryPercent?: Record<string, number>; // 0-100
  byBucket?: Record<string, number>;
}

interface FinanceMappingDoc {
  merchantToCategory?: Record<string, { type: CategoryType; label: string }>;
  categoryToBucket?: Record<string, string>;
}

const DEFAULT_BUCKETS = ['Mandatory', 'Discretionary', 'Savings', 'Income'];
const CATEGORY_TYPES: CategoryType[] = ['mandatory', 'optional', 'savings', 'income'];

const FinanceSettings: React.FC = () => {
  const { currentUser } = useAuth();

  // Budgets
  const [currency, setCurrency] = useState('GBP');
  const [monthlyIncome, setMonthlyIncome] = useState<number>(0);
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [byCategoryPercent, setByCategoryPercent] = useState<Record<string, number>>({});
  const [byBucket, setByBucket] = useState<Record<string, number>>({});

  // Mappings
  const [merchantToCategory, setMerchantToCategory] = useState<Record<string, { type: CategoryType; label: string }>>({});
  const [categoryToBucket, setCategoryToBucket] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [latestIncome, setLatestIncome] = useState<number | null>(null);
  const [serverImporting, setServerImporting] = useState(false);
  
  // Recalculate bucket budgets by summing category budgets mapped to each bucket
  const recomputeBucketsFromCategories = () => {
    const income = Number(monthlyIncome || 0);
    // derive per-category amount using either explicit amount or percent of income
    const amounts: Record<string, number> = {};
    const cats = new Set<string>([
      ...Object.keys(byCategory || {}),
      ...Object.keys(byCategoryPercent || {}),
      ...Object.keys(categoryToBucket || {})
    ]);
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
    setMessage('Buckets recalculated from categories. Review and Save Changes to apply.');
  };

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
        const d = snap.data() as FinanceMappingDoc;
        setMerchantToCategory(d.merchantToCategory || {});
        setCategoryToBucket(d.categoryToBucket || {});
      }
    });
    // Detect latest monthly income from analytics summary
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

  const addBudgetCategory = () => {
    const name = prompt('Enter category name (e.g., Gym)');
    if (!name) return;
    setByCategory((prev) => ({ ...prev, [name]: prev[name] || 0 }));
  };
  const addBudgetBucket = () => {
    const name = prompt('Enter bucket name (e.g., Discretionary)');
    if (!name) return;
    setByBucket((prev) => ({ ...prev, [name]: prev[name] || 0 }));
  };
  const addMerchantRule = () => {
    const vendor = prompt('Merchant/Vendor name (as it appears on statement)');
    if (!vendor) return;
    const label = prompt('Category label (e.g., Gym)') || 'Uncategorised';
    const type = (prompt('Type: mandatory | optional | savings | income') || 'optional').toLowerCase() as CategoryType;
    setMerchantToCategory((prev) => ({ ...prev, [vendor.toLowerCase()]: { type: CATEGORY_TYPES.includes(type) ? type : 'optional', label } }));
  };
  const addCategoryBucketRule = () => {
    const category = prompt('Category label (e.g., Gym)');
    if (!category) return;
    const bucket = prompt('Bucket (e.g., Discretionary)') || 'Discretionary';
    setCategoryToBucket((prev) => ({ ...prev, [category]: bucket }));
  };

  const saveAll = async () => {
    if (!currentUser) return;
    setSaving(true);
    setMessage(null);
    try {
      // Derive absolute amounts from % if monthly income is provided
      const derivedByCategory: Record<string, number> = { ...byCategory };
      const income = Number(monthlyIncome || 0);
      if (income > 0) {
        Object.entries(byCategoryPercent || {}).forEach(([cat, pct]) => {
          const amt = Math.round((Number(pct) || 0) / 100 * income);
          if (!Number.isNaN(amt)) derivedByCategory[cat] = amt;
        });
      }
      const budgets: FinanceBudgetsDoc = {
        currency,
        monthlyIncome: Number(monthlyIncome || 0),
        byCategory: Object.fromEntries(Object.entries(derivedByCategory).map(([k, v]) => [k, Number(v) || 0])),
        byCategoryPercent: Object.fromEntries(Object.entries(byCategoryPercent).map(([k, v]) => [k, Math.max(0, Math.min(100, Number(v) || 0))])),
        byBucket: Object.fromEntries(Object.entries(byBucket).map(([k, v]) => [k, Number(v) || 0]))
      };
      await setDoc(doc(db, 'finance_budgets', currentUser.uid), budgets, { merge: true });

      const mapping: FinanceMappingDoc = {
        merchantToCategory: Object.fromEntries(Object.entries(merchantToCategory).map(([k, v]) => [k.toLowerCase(), { type: v.type, label: v.label }])),
        categoryToBucket: categoryToBucket
      };
      await setDoc(doc(db, 'finance_mapping', currentUser.uid), mapping, { merge: true });

      setMessage('Saved. Analytics will refresh shortly.');
    } catch (e: any) {
      setMessage('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const onImportCsv = (file: File) => {
    if (!file) return;
    setImporting(true);
    setMessage(null);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: Papa.ParseResult<any>) => {
        try {
          const rows = Array.isArray(results.data) ? results.data : [];
          const nextMerchant: Record<string, { type: CategoryType; label: string }> = { ...merchantToCategory };
          const nextCatBucket: Record<string, string> = { ...categoryToBucket };
          rows.forEach((r) => {
            const merchant = String(r.Merchant || r.merchant || r.Vendor || r.vendor || r.MERCHANT || '').trim();
            const typeRaw = String(r.Type || r.type || r.CategoryType || '').trim().toLowerCase();
            const label = String(r.Category || r.category || r.Label || r.label || '').trim() || 'Uncategorised';
            const bucket = String(r.Bucket || r.bucket || r.Group || r.group || '').trim();
            if (merchant) {
              const type: CategoryType = ['mandatory','optional','savings','income'].includes(typeRaw) ? (typeRaw as CategoryType) : 'optional';
              nextMerchant[merchant.toLowerCase()] = { type, label };
            }
            if (label && bucket) {
              nextCatBucket[label] = bucket;
            }
          });
          setMerchantToCategory(nextMerchant);
          setCategoryToBucket(nextCatBucket);
          setMessage(`Imported ${rows.length} rows. Review and Save Changes to apply.`);
        } catch (e:any) {
          setMessage('Import failed: ' + (e?.message || 'unknown'));
        } finally {
          setImporting(false);
        }
      },
      error: (err) => {
        setMessage('CSV parse error: ' + (err?.message || String(err)));
        setImporting(false);
      }
    });
  };

  const importFromSample = async () => {
    try {
      setImporting(true);
      const res = await fetch('/data/merchant_mapping.csv');
      if (!res.ok) throw new Error('Sample file not found');
      const text = await res.text();
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results: Papa.ParseResult<any>) => {
          const rows = Array.isArray(results.data) ? results.data : [];
          const nextMerchant: Record<string, { type: CategoryType; label: string }> = { ...merchantToCategory };
          const nextCatBucket: Record<string, string> = { ...categoryToBucket };
          rows.forEach((r) => {
            const merchant = String(r.Merchant || r.merchant || r.Vendor || r.vendor || r.MERCHANT || '').trim();
            const typeRaw = String(r.Type || r.type || r.CategoryType || '').trim().toLowerCase();
            const label = String(r.Category || r.category || r.Label || r.label || '').trim() || 'Uncategorised';
            const bucket = String(r.Bucket || r.bucket || r.Group || r.group || r.buycket || '').trim();
            if (merchant) {
              const type: CategoryType = ['mandatory','optional','savings','income'].includes(typeRaw) ? (typeRaw as CategoryType) : 'optional';
              nextMerchant[merchant.toLowerCase()] = { type, label };
            }
            if (label && bucket) nextCatBucket[label] = bucket;
          });
          setMerchantToCategory(nextMerchant);
          setCategoryToBucket(nextCatBucket);
          setMessage(`Loaded ${rows.length} rows from sample mapping. Review and Save Changes to apply.`);
          setImporting(false);
        },
        error: (err) => { setMessage('Import failed: ' + (err?.message || String(err))); setImporting(false); }
      });
    } catch (e: any) {
      setMessage('Import failed: ' + (e?.message || 'unknown'));
      setImporting(false);
    }
  };

  const serverImportFromSample = async () => {
    try {
      setServerImporting(true);
      const res = await fetch('/data/merchant_mapping.csv');
      if (!res.ok) throw new Error('Sample file not found');
      const csvText = await res.text();
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../firebase');
      const fn = httpsCallable(functions, 'importFinanceMappings');
      const out: any = await fn({ csvText });
      setMessage(`Server import: ${out?.data?.importedRows || 0} rows. Merchants=${out?.data?.merchants || 0}, Categories=${out?.data?.categories || 0}.`);
    } catch (e: any) {
      setMessage('Server import failed: ' + (e?.message || 'unknown'));
    } finally {
      setServerImporting(false);
    }
  };

  const percentBudgetPreview = useMemo(() => {
    const income = Number(monthlyIncome || 0);
    const entries = Object.entries(byCategoryPercent || {});
    return entries.map(([cat, pct]) => ({ cat, pct: Number(pct) || 0, amount: Math.round((Number(pct) || 0) / 100 * income) }));
  }, [monthlyIncome, byCategoryPercent]);

  return (
    <Container fluid className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Finance Settings</h2>
        <div>
          <Button variant="outline-secondary" className="me-2" onClick={() => window.history.back()}>Back</Button>
          <Button variant="primary" onClick={saveAll} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button>
          <Button variant="outline-primary" className="ms-2" onClick={serverImportFromSample} disabled={serverImporting} title="Server-import the bundled merchant mapping into Firebase">
            {serverImporting ? 'Importing…' : 'Server Import Sample Mapping'}
          </Button>
        </div>
      </div>

      {message && <Alert variant="info">{message}</Alert>}

      {/* Budgets */}
      <Card className="mb-4">
        <Card.Header><strong>Budgets</strong></Card.Header>
        <Card.Body>
          {latestIncome != null && (
            <Alert variant="light">
              Detected latest monthly income from analytics: <strong>{latestIncome.toLocaleString('en-GB', { style:'currency', currency })}</strong>
              <Button size="sm" className="ms-2" variant="outline-primary" onClick={()=> setMonthlyIncome(latestIncome || 0)}>Use this</Button>
            </Alert>
          )}
          <Row className="mb-3">
            <Col md={3}>
              <Form.Group>
                <Form.Label>Currency</Form.Label>
                <Form.Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="GBP">GBP</option>
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Monthly Income</Form.Label>
                <Form.Control type="number" value={monthlyIncome} onChange={(e) => setMonthlyIncome(Number(e.target.value || 0))} />
              </Form.Group>
            </Col>
          </Row>

          {/* Unified Category Budget Setter */}
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Category Budgets</h5>
            <Button size="sm" variant="outline-secondary" onClick={addBudgetCategory}>Add Category</Button>
          </div>
          <Table size="sm" responsive>
            <thead>
              <tr>
                <th style={{minWidth:180}}>Category</th>
                <th style={{minWidth:160}}>Bucket</th>
                <th className="text-end" style={{minWidth:160}}>Amount (GBP)</th>
                <th className="text-end" style={{minWidth:160}}>% of Income</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const cats = Array.from(new Set([
                  ...Object.keys(byCategory || {}),
                  ...Object.keys(byCategoryPercent || {}),
                  ...Object.keys(categoryToBucket || {})
                ])).sort();
                if (cats.length === 0) return (
                  <tr><td colSpan={4} className="text-muted">No categories defined</td></tr>
                );
                return cats.map((cat) => {
                  const amt = byCategory[cat] || 0;
                  const pct = byCategoryPercent[cat] || (monthlyIncome > 0 ? Math.round((amt / monthlyIncome) * 1000) / 10 : 0);
                  const bucket = categoryToBucket[cat] || '';
                  const bucketOptions = Array.from(new Set([...Object.keys(byBucket||{}), ...DEFAULT_BUCKETS]));
                  return (
                    <tr key={cat}>
                      <td>{cat}</td>
                      <td>
                        <Form.Select size="sm" value={bucket} onChange={(e)=> setCategoryToBucket(prev => ({ ...prev, [cat]: e.target.value }))}>
                          <option value="">—</option>
                          {bucketOptions.map(b => <option key={b} value={b}>{b}</option>)}
                        </Form.Select>
                      </td>
                      <td className="text-end">
                        <Form.Control type="number" size="sm" value={amt}
                          onChange={(e)=> setByCategory(prev => ({ ...prev, [cat]: Number(e.target.value || 0) }))} />
                      </td>
                      <td className="text-end">
                        <Form.Control type="number" size="sm" value={pct}
                          onChange={(e)=> setByCategoryPercent(prev => ({ ...prev, [cat]: Number(e.target.value || 0) }))} />
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </Table>

          <div className="mt-3">
            <h6>By Bucket (Optional)</h6>
            <Table size="sm" responsive>
              <thead><tr><th>Bucket</th><th className="text-end">Monthly Budget</th></tr></thead>
              <tbody>
                {Object.keys(byBucket).length === 0 && (
                  <tr><td colSpan={2} className="text-muted">No buckets yet</td></tr>
                )}
                {Object.entries(byBucket).map(([b, amt]) => (
                  <tr key={b}>
                    <td>{b}</td>
                    <td className="text-end">
                      <Form.Control type="number" size="sm" value={amt}
                        onChange={(e) => setByBucket((prev) => ({ ...prev, [b]: Number(e.target.value || 0) }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="d-flex gap-2">
              <Button size="sm" variant="outline-secondary" onClick={addBudgetBucket}>Add Bucket</Button>
              <Button size="sm" variant="outline-primary" onClick={recomputeBucketsFromCategories}>Recalculate from categories</Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      {/* Mappings */}
      <Card className="mb-4">
        <Card.Header><strong>Category & Bucket Mapping</strong></Card.Header>
        <Card.Body>
          <div className="mb-3 d-flex align-items-center gap-2">
            <Form.Label className="mb-0">Bulk Import (CSV)</Form.Label>
            <Form.Control type="file" accept=".csv" size="sm" style={{ maxWidth: 320 }} onChange={(e)=>{ const input = e.target as HTMLInputElement; const f=input.files && input.files[0]; if (f) onImportCsv(f); }} disabled={importing} />
            {importing && <span className="text-muted">Importing…</span>}
            <Button size="sm" variant="outline-secondary" onClick={importFromSample} disabled={importing}>Load Sample Mapping</Button>
          </div>
          <Row>
            <Col md={6} className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Merchant → Category</h5>
                <Button size="sm" variant="outline-secondary" onClick={addMerchantRule}>Add Rule</Button>
              </div>
              <Table size="sm" responsive>
                <thead><tr><th>Merchant/Vendor (normalized)</th><th>Type</th><th>Category Label</th></tr></thead>
                <tbody>
                  {Object.keys(merchantToCategory).length === 0 ? (
                    <tr><td colSpan={3} className="text-muted">No merchant rules yet</td></tr>
                  ) : (
                    Object.entries(merchantToCategory).map(([vendor, cfg]) => (
                      <tr key={vendor}>
                        <td>{vendor}</td>
                        <td>
                          <Form.Select size="sm" value={cfg.type}
                            onChange={(e) => setMerchantToCategory((prev) => ({ ...prev, [vendor]: { ...cfg, type: e.target.value as CategoryType } }))}
                          >
                            {CATEGORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                          </Form.Select>
                        </td>
                        <td>
                          <Form.Control size="sm" value={cfg.label}
                            onChange={(e) => setMerchantToCategory((prev) => ({ ...prev, [vendor]: { ...cfg, label: e.target.value } }))} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Col>
            <Col md={6} className="mb-3">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Category → Bucket</h5>
                <Button size="sm" variant="outline-secondary" onClick={addCategoryBucketRule}>Add Mapping</Button>
              </div>
              <Table size="sm" responsive>
                <thead><tr><th>Category</th><th>Bucket</th></tr></thead>
                <tbody>
                  {Object.keys(categoryToBucket).length === 0 ? (
                    <tr><td colSpan={2} className="text-muted">No category mappings yet</td></tr>
                  ) : (
                    Object.entries(categoryToBucket).map(([cat, bucket]) => (
                      <tr key={cat}>
                        <td>{cat}</td>
                        <td>
                          <Form.Control size="sm" value={bucket}
                            onChange={(e) => setCategoryToBucket((prev) => ({ ...prev, [cat]: e.target.value }))} />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </Table>
            </Col>
          </Row>
          <Alert variant="light" className="mt-2">
            Note: Transactions are auto-categorised using these rules. Totals roll up by category, then bucket, and surface on the Finance dashboard and goals alignment.
          </Alert>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default FinanceSettings;
