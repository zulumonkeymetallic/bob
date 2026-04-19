import React, { useEffect, useMemo, useState } from 'react';
import { Card, Table, Button, Form, Badge, Alert, Spinner, Toast, ToastContainer } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { CategoryBucket, DEFAULT_CATEGORIES, BUCKET_LABELS, mergeFinanceCategories, FinanceCategory } from '../../utils/financeCategories';

type CategoryItem = FinanceCategory;

const DEFAULTS: CategoryItem[] = DEFAULT_CATEGORIES.map((c) => ({
  key: c.key,
  label: c.label,
  bucket: c.bucket,
  isDefault: true,
}));

const CategoriesBuckets: React.FC = () => {
  const { currentUser } = useAuth();
  const [items, setItems] = useState<CategoryItem[]>(DEFAULTS);
  const [newLabel, setNewLabel] = useState('');
  const [newBucket, setNewBucket] = useState<CategoryBucket>('discretionary');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ show: boolean; msg: string; variant: 'success' | 'danger' }>({ show: false, msg: '', variant: 'success' });
  const bucketOptions = useMemo(
    () =>
      [
        ['mandatory', 'Mandatory'],
        ['discretionary', 'Discretionary'],
        ['short_saving', 'Savings'],
        ['net_salary', 'Income'],
        ['irregular_income', 'Income (Irregular)'],
        ['investment', 'Investment'],
        ['bank_transfer', 'Bank transfer'],
        ['debt_repayment', 'Debt repayment'],
        ['unknown', 'Unknown'],
      ].filter(([key]) => BUCKET_LABELS[key as CategoryBucket]),
    []
  );

  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_categories', currentUser.uid);
    setLoading(true);
    getDoc(ref)
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          const arr = Array.isArray(data.categories) ? data.categories : [];
          if (arr.length) {
            setItems(mergeFinanceCategories(arr as FinanceCategory[]));
          }
        }
      })
      .catch((err) => console.error('Failed to load categories', err))
      .finally(() => setLoading(false));
  }, [currentUser]);

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!key) return;
    if (items.some(i => i.key === key)) return;
    setItems([...items, { key, label, bucket: newBucket, isDefault: false }]);
    setNewLabel('');
  };

  const save = async () => {
    if (!currentUser) return;
    setSaving(true); setSavedMsg('');
    try {
      const payload = {
        ownerUid: currentUser.uid,
        categories: items,
        updatedAt: Date.now(),
      };
      console.info('Saving finance categories', payload);
      await setDoc(doc(db, 'finance_categories', currentUser.uid), payload, { merge: true });
      console.info('Finance categories saved');
      const snap = await getDoc(doc(db, 'finance_categories', currentUser.uid));
      console.info('Re-fetched finance categories', snap.data());
      if (snap.exists()) {
        const arr = Array.isArray((snap.data() as any).categories) ? (snap.data() as any).categories : [];
        setItems(mergeFinanceCategories(arr as FinanceCategory[]));
      }
      setSavedMsg('Saved');
      setToast({ show: true, msg: 'Categories saved', variant: 'success' });
      setTimeout(()=>setSavedMsg(''), 2000);
    } catch (err) {
      console.error('Failed to save finance categories', err);
      setToast({ show: true, msg: 'Save failed', variant: 'danger' });
    } finally { setSaving(false); }
  };

  return (
    <div className="container py-3">
      <ToastContainer position="top-end" className="p-3">
        <Toast bg={toast.variant} show={toast.show} onClose={() => setToast({ ...toast, show: false })} delay={2000} autohide>
          <Toast.Body className="text-white">{toast.msg}</Toast.Body>
        </Toast>
      </ToastContainer>
      <h3>Categories & Buckets</h3>
      <p className="text-muted">Define your categories and map them to buckets (mandatory, discretionary, savings, income, transfers). Merchant mappings can reference these labels.</p>

      <Card>
        <Card.Body>
          <div className="d-flex gap-2 align-items-end mb-3">
            <div style={{ maxWidth: 280 }}>
              <Form.Label>New Category</Form.Label>
              <Form.Control size="sm" value={newLabel} onChange={(e)=>setNewLabel(e.target.value)} placeholder="e.g., Mortgage" />
            </div>
            <div style={{ maxWidth: 240 }}>
              <Form.Label>Bucket</Form.Label>
              <Form.Select size="sm" value={newBucket} onChange={(e)=>setNewBucket(e.target.value as CategoryBucket)}>
                {bucketOptions.map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </Form.Select>
            </div>
            <Button size="sm" variant="outline-secondary" onClick={add}>Add</Button>
            <div className="ms-auto">
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                {saving ? 'Saving…' : 'Save'}
              </Button>
              {savedMsg && <Badge bg="success" className="ms-2">{savedMsg}</Badge>}
            </div>
          </div>

          {loading ? <Alert variant="light">Loading categories…</Alert> : null}
          <Table size="sm" responsive hover>
            <thead>
              <tr>
                <th>Label</th>
                <th>Key</th>
                <th>Bucket</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.key}>
                  <td style={{ width: 260 }}>
                    <Form.Control
                      size="sm"
                      value={i.label}
                      disabled={i.isDefault}
                      onChange={(e)=>{
                        const v = e.target.value; const copy = [...items]; copy[idx] = { ...i, label: v }; setItems(copy);
                      }}
                    />
                    {i.isDefault ? <div className="small text-muted">Default</div> : null}
                  </td>
                  <td><code>{i.key}</code></td>
                  <td style={{ width: 200 }}>
                    <Form.Select
                      size="sm"
                      disabled={i.isDefault}
                      value={i.bucket}
                      onChange={(e)=>{
                        const v = e.target.value as CategoryBucket; const copy = [...items]; copy[idx] = { ...i, bucket: v }; setItems(copy);
                      }}
                    >
                      {bucketOptions.map(([key, label]) => (
                        <option key={key} value={key}>{label}</option>
                      ))}
                    </Form.Select>
                  </td>
                  <td className="text-end">
                    <Button size="sm" variant="outline-danger" disabled={i.isDefault} onClick={()=> setItems(items.filter(x => x.key !== i.key))}>Remove</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default CategoriesBuckets;
