import React, { useEffect, useState } from 'react';
import { Card, Table, Button, Form, Badge } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

type CategoryItem = {
  key: string;        // normalized key
  label: string;      // display label
  bucket: 'mandatory' | 'optional' | 'savings' | 'income';
};

const DEFAULTS: CategoryItem[] = [
  { key: 'groceries', label: 'Groceries', bucket: 'mandatory' },
  { key: 'eating_out', label: 'Eating Out', bucket: 'optional' },
  { key: 'transport', label: 'Transport', bucket: 'mandatory' },
  { key: 'bills', label: 'Bills & Utilities', bucket: 'mandatory' },
  { key: 'entertainment', label: 'Entertainment', bucket: 'optional' },
  { key: 'savings', label: 'Savings / Pots', bucket: 'savings' },
];

const CategoriesBuckets: React.FC = () => {
  const { currentUser } = useAuth();
  const [items, setItems] = useState<CategoryItem[]>(DEFAULTS);
  const [newLabel, setNewLabel] = useState('');
  const [newBucket, setNewBucket] = useState<'mandatory'|'optional'|'savings'|'income'>('optional');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_categories', currentUser.uid);
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        const data = snap.data() as any;
        const arr = Array.isArray(data.categories) ? data.categories : [];
        if (arr.length) setItems(arr);
      }
    }).catch(()=>{});
  }, [currentUser]);

  const add = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = label.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!key) return;
    if (items.some(i => i.key === key)) return;
    setItems([...items, { key, label, bucket: newBucket }]);
    setNewLabel('');
  };

  const save = async () => {
    if (!currentUser) return;
    setSaving(true); setSavedMsg('');
    try {
      await setDoc(doc(db, 'finance_categories', currentUser.uid), {
        ownerUid: currentUser.uid,
        categories: items,
        updatedAt: Date.now(),
      }, { merge: true });
      setSavedMsg('Saved');
      setTimeout(()=>setSavedMsg(''), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="container py-3">
      <h3>Categories & Buckets</h3>
      <p className="text-muted">Define your categories and map them to buckets (mandatory, optional, savings, income). Merchant mappings can reference these labels.</p>

      <Card>
        <Card.Body>
          <div className="d-flex gap-2 align-items-end mb-3">
            <div style={{ maxWidth: 280 }}>
              <Form.Label>New Category</Form.Label>
              <Form.Control size="sm" value={newLabel} onChange={(e)=>setNewLabel(e.target.value)} placeholder="e.g., Mortgage" />
            </div>
            <div style={{ maxWidth: 200 }}>
              <Form.Label>Bucket</Form.Label>
              <Form.Select size="sm" value={newBucket} onChange={(e)=>setNewBucket(e.target.value as any)}>
                <option value="mandatory">mandatory</option>
                <option value="optional">optional</option>
                <option value="savings">savings</option>
                <option value="income">income</option>
              </Form.Select>
            </div>
            <Button size="sm" variant="outline-secondary" onClick={add}>Add</Button>
            <div className="ms-auto">
              <Button size="sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
              {savedMsg && <Badge bg="success" className="ms-2">{savedMsg}</Badge>}
            </div>
          </div>

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
                    <Form.Control size="sm" value={i.label} onChange={(e)=>{
                      const v = e.target.value; const copy = [...items]; copy[idx] = { ...i, label: v }; setItems(copy);
                    }} />
                  </td>
                  <td><code>{i.key}</code></td>
                  <td style={{ width: 200 }}>
                    <Form.Select size="sm" value={i.bucket} onChange={(e)=>{
                      const v = e.target.value as any; const copy = [...items]; copy[idx] = { ...i, bucket: v }; setItems(copy);
                    }}>
                      <option value="mandatory">mandatory</option>
                      <option value="optional">optional</option>
                      <option value="savings">savings</option>
                      <option value="income">income</option>
                    </Form.Select>
                  </td>
                  <td className="text-end">
                    <Button size="sm" variant="outline-danger" onClick={()=> setItems(items.filter(x => x.key !== i.key))}>Remove</Button>
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

