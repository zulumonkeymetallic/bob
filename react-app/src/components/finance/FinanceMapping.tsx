import React, { useEffect, useRef, useState } from 'react';
import { Card, Row, Col, Form, Table, Button, Badge } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

interface MerchantRule { type: 'mandatory' | 'optional' | 'savings' | 'income'; label: string; }

const FinanceMapping: React.FC = () => {
  const { currentUser } = useAuth();
  const [merchantToCategory, setMerchantToCategory] = useState<Record<string, MerchantRule>>({});
  const [categoryToBucket, setCategoryToBucket] = useState<Record<string, string>>({});
  const [buckets, setBuckets] = useState<string[]>(['Housing','Utilities','Groceries','Transport','Health','Entertainment','General']);
  const [newMerchant, setNewMerchant] = useState('');
  const [newCategoryLabel, setNewCategoryLabel] = useState('');
  const [newBucket, setNewBucket] = useState('');
  const [saved, setSaved] = useState('');
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const csvInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      const ref = doc(db, 'finance_mapping', currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const d: any = snap.data() || {};
        setMerchantToCategory(d.merchantToCategory || {});
        setCategoryToBucket(d.categoryToBucket || {});
        if (Array.isArray(d.buckets)) setBuckets(d.buckets);
      }
    };
    load();
  }, [currentUser]);

  const saveAll = async () => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_mapping', currentUser.uid);
    await setDoc(ref, { merchantToCategory, categoryToBucket, buckets, updatedAt: Date.now() }, { merge: true });
    setSaved('Saved');
    setTimeout(()=>setSaved(''), 1500);
  };

  const download = (filename: string, content: string, mime = 'application/octet-stream') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportJSON = () => {
    const payload = { merchantToCategory, categoryToBucket, buckets };
    download('finance_mapping.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  const exportCSV = () => {
    const rows: string[] = [];
    rows.push(['merchant','type','label','category','bucket'].join(','));
    Object.entries(merchantToCategory).forEach(([m, rule]) => {
      rows.push([
        JSON.stringify(m).slice(1,-1),
        rule.type,
        JSON.stringify(rule.label || '').slice(1,-1),
        '',
        ''
      ].join(','));
    });
    Object.entries(categoryToBucket).forEach(([cat, bucket]) => {
      rows.push([
        '',
        '',
        '',
        JSON.stringify(cat).slice(1,-1),
        JSON.stringify(bucket).slice(1,-1)
      ].join(','));
    });
    download('finance_mapping.csv', rows.join('\n'), 'text/csv');
  };

  const parseCSV = (text: string): { merchants: Record<string, MerchantRule>; catToBucket: Record<string,string>; bucketsSet: Set<string> } => {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return { merchants: {}, catToBucket: {}, bucketsSet: new Set() };
    const header = lines[0].split(',').map(h => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const mi = idx('merchant');
    const ti = idx('type');
    const li = idx('label');
    const ci = idx('category');
    const bi = idx('bucket');
    const outMerchants: Record<string, MerchantRule> = {};
    const outCatToBucket: Record<string, string> = {};
    const buckets = new Set<string>();
    for (let i=1;i<lines.length;i++) {
      const raw = lines[i];
      const cols = raw.split(',');
      const get = (j: number) => (j >=0 && j < cols.length ? cols[j].trim().replace(/^"|"$/g,'') : '');
      const m = mi>=0 ? get(mi).toLowerCase() : '';
      const t = ti>=0 ? get(ti) : '';
      const l = li>=0 ? get(li) : '';
      const c = ci>=0 ? get(ci) : '';
      const b = bi>=0 ? get(bi) : '';
      if (m) {
        const type = (t === 'mandatory' || t === 'optional' || t === 'savings' || t === 'income') ? t : 'optional';
        outMerchants[m] = { type, label: l || m };
      }
      if (c) {
        outCatToBucket[c] = b || 'Unassigned';
        if (b) buckets.add(b);
      }
    }
    return { merchants: outMerchants, catToBucket: outCatToBucket, bucketsSet: buckets };
  };

  const handleImportJSON = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const mtc = data.merchantToCategory || {};
      const ctb = data.categoryToBucket || {};
      const bks = Array.isArray(data.buckets) ? data.buckets : buckets;
      setMerchantToCategory(mtc);
      setCategoryToBucket(ctb);
      setBuckets(bks);
      await saveAll();
      setSaved('Imported');
      setTimeout(()=>setSaved(''), 1500);
    } catch (e) {
      alert('Import JSON failed: ' + (e as any)?.message || 'Unknown');
    }
  };

  const handleImportCSV = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseCSV(text);
      const mergedMerchants = { ...merchantToCategory, ...parsed.merchants };
      const mergedCatToBucket = { ...categoryToBucket, ...parsed.catToBucket };
      const mergedBuckets = Array.from(new Set([...buckets, ...Array.from(parsed.bucketsSet)]));
      setMerchantToCategory(mergedMerchants);
      setCategoryToBucket(mergedCatToBucket);
      setBuckets(mergedBuckets);
      await saveAll();
      setSaved('Imported');
      setTimeout(()=>setSaved(''), 1500);
    } catch (e) {
      alert('Import CSV failed: ' + (e as any)?.message || 'Unknown');
    }
  };

  const addMerchantRule = () => {
    const key = newMerchant.trim().toLowerCase();
    if (!key) return;
    setMerchantToCategory(prev => ({ ...prev, [key]: prev[key] || { type: 'optional', label: key } }));
    setNewMerchant('');
  };

  const addBucket = () => {
    const b = newBucket.trim();
    if (!b) return;
    setBuckets(prev => (prev.includes(b) ? prev : [...prev, b]));
    setNewBucket('');
  };

  const addCategoryMap = () => {
    const cat = newCategoryLabel.trim();
    if (!cat || buckets.length === 0) return;
    setCategoryToBucket(prev => ({ ...prev, [cat]: buckets[0] }));
    setNewCategoryLabel('');
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0">Finance Mapping</h6>
          <div className="d-flex align-items-center gap-2">
            <div className="btn-group btn-group-sm" role="group" aria-label="Import/Export">
              <button className="btn btn-outline-secondary" onClick={exportJSON}>Export JSON</button>
              <button className="btn btn-outline-secondary" onClick={exportCSV}>Export CSV</button>
              <button className="btn btn-outline-primary" onClick={() => jsonInputRef.current?.click()}>Import JSON</button>
              <button className="btn btn-outline-primary" onClick={() => csvInputRef.current?.click()}>Import CSV</button>
            </div>
            {saved && <Badge bg="success">{saved}</Badge>}
          </div>
        </div>
        <input ref={jsonInputRef} type="file" accept="application/json,.json" hidden onChange={(e)=>{ const f = e.target.files?.[0]; if (f) { handleImportJSON(f); e.currentTarget.value=''; } }} />
        <input ref={csvInputRef} type="file" accept="text/csv,.csv" hidden onChange={(e)=>{ const f = e.target.files?.[0]; if (f) { handleImportCSV(f); e.currentTarget.value=''; } }} />
        <Row className="g-3">
          <Col lg={6}>
            <h6>Merchant → Category</h6>
            <div className="d-flex gap-2 mb-2">
              <Form.Control size="sm" placeholder="Merchant name (e.g., amazon)" value={newMerchant} onChange={(e)=>setNewMerchant(e.target.value)} />
              <Button size="sm" variant="outline-secondary" onClick={addMerchantRule}>Add</Button>
            </div>
            <Table size="sm" hover responsive>
              <thead><tr><th>Merchant</th><th>Type</th><th>Label</th></tr></thead>
              <tbody>
                {Object.entries(merchantToCategory).map(([m, rule]) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>
                      <Form.Select size="sm" value={rule.type} onChange={(e)=>setMerchantToCategory(prev => ({ ...prev, [m]: { ...rule, type: e.target.value as any } }))}>
                        <option value="mandatory">Mandatory</option>
                        <option value="optional">Optional</option>
                        <option value="savings">Savings</option>
                        <option value="income">Income</option>
                      </Form.Select>
                    </td>
                    <td>
                      <Form.Control size="sm" value={rule.label} onChange={(e)=>setMerchantToCategory(prev => ({ ...prev, [m]: { ...rule, label: e.target.value } }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Col>
          <Col lg={6}>
            <h6>Category → Bucket</h6>
            <div className="d-flex gap-2 mb-2">
              <Form.Control size="sm" placeholder="Category label (e.g., groceries)" value={newCategoryLabel} onChange={(e)=>setNewCategoryLabel(e.target.value)} />
              <Button size="sm" variant="outline-secondary" onClick={addCategoryMap}>Add</Button>
            </div>
            <Table size="sm" hover responsive>
              <thead><tr><th>Category</th><th>Bucket</th></tr></thead>
              <tbody>
                {Object.entries(categoryToBucket).map(([cat, bucket]) => (
                  <tr key={cat}>
                    <td>{cat}</td>
                    <td>
                      <Form.Select size="sm" value={bucket} onChange={(e)=>setCategoryToBucket(prev => ({ ...prev, [cat]: e.target.value }))}>
                        {[...buckets, 'Unassigned'].map(b => (<option key={b} value={b}>{b}</option>))}
                      </Form.Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="d-flex gap-2">
              <Form.Control size="sm" placeholder="Add bucket (e.g., Household)" value={newBucket} onChange={(e)=>setNewBucket(e.target.value)} />
              <Button size="sm" variant="outline-secondary" onClick={addBucket}>Add Bucket</Button>
            </div>
          </Col>
        </Row>
        <div className="mt-3">
          <Button size="sm" variant="primary" onClick={saveAll}>Save Mapping</Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default FinanceMapping;
