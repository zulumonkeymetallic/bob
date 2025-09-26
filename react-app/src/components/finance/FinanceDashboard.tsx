import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { Card, Container, Row, Col, Table, Badge } from 'react-bootstrap';

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
      const cat = t.category || 'uncategorised';
      byCat[cat] = (byCat[cat] || 0) + spend;
    }
    const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const delta = last30 - prev30;
    return { last30, prev30, delta, topCats };
  }, [txs]);

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
            </Card.Body>
          </Card>
        </Col>
        <Col md={8}>
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

