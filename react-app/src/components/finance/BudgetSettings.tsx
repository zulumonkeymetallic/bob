import React, { useEffect, useState } from 'react';
import { Card, Form, Button, Row, Col, Table, Badge } from 'react-bootstrap';
import { db } from '../../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';

type Budgets = {
  currency: string;
  byCategory: Record<string, number>; // minor units
  updatedAt?: number;
};

const DEFAULT_CATEGORIES = ['groceries','eating_out','transport','bills','entertainment','general'];

const BudgetSettings: React.FC = () => {
  const { currentUser } = useAuth();
  const [currency, setCurrency] = useState('GBP');
  const [byCategory, setByCategory] = useState<Record<string, number>>({});
  const [newCat, setNewCat] = useState('');
  const [saved, setSaved] = useState<string>('');

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      const ref = doc(db, 'finance_budgets', currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as Budgets;
        setCurrency(data.currency || 'GBP');
        setByCategory(data.byCategory || {});
      } else {
        // initialize defaults
        const init: Record<string, number> = {};
        DEFAULT_CATEGORIES.forEach(c => init[c] = 0);
        setByCategory(init);
      }
    };
    load();
  }, [currentUser]);

  const save = async () => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_budgets', currentUser.uid);
    await setDoc(ref, { currency, byCategory, updatedAt: Date.now() });
    setSaved('Saved');
    setTimeout(()=>setSaved(''), 1800);
  };

  const setBudget = (cat: string, majorStr: string) => {
    const major = Number(majorStr || '0');
    const minor = Math.round(major * 100);
    setByCategory(prev => ({ ...prev, [cat]: minor }));
  };

  const addCategory = () => {
    const key = newCat.trim().toLowerCase().replace(/\s+/g,'_');
    if (!key) return;
    setByCategory(prev => ({ ...prev, [key]: prev[key] || 0 }));
    setNewCat('');
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0">Budgets</h6>
          {saved && <Badge bg="success">{saved}</Badge>}
        </div>
        <Row className="g-2 align-items-center mb-2">
          <Col sm={3}>
            <Form.Label>Currency</Form.Label>
            <Form.Select value={currency} onChange={(e)=>setCurrency(e.target.value)}>
              <option value="GBP">GBP (£)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
            </Form.Select>
          </Col>
        </Row>
        <Table size="sm" hover responsive>
          <thead><tr><th>Category</th><th style={{width:180}}>Monthly Budget</th></tr></thead>
          <tbody>
            {Object.entries(byCategory).map(([cat, minor]) => (
              <tr key={cat}>
                <td>{cat}</td>
                <td>
                  <div className="input-group input-group-sm">
                    <span className="input-group-text">{currency}</span>
                    <input className="form-control" type="number" min={0} step="1" value={(minor||0)/100}
                      onChange={(e)=>setBudget(cat, e.target.value)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="d-flex gap-2 mb-2">
          <Form.Control size="sm" placeholder="Add category (e.g., childcare)" value={newCat} onChange={(e)=>setNewCat(e.target.value)} />
          <Button size="sm" variant="outline-secondary" onClick={addCategory}>Add</Button>
        </div>
        <Button variant="primary" size="sm" onClick={save}>Save Budgets</Button>
      </Card.Body>
    </Card>
  );
};

export default BudgetSettings;

