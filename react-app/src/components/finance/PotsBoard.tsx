import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Card, Col, ProgressBar, Row, Spinner } from 'react-bootstrap';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';

type Pot = {
  id: string;
  name: string;
  balance: number;
  currency: string;
  deleted?: boolean;
  closed?: boolean;
};

type Goal = {
  id: string;
  title: string;
  estimatedCost?: number;
  potId?: string | null;
  linkedPotId?: string | null;
  status?: number | string;
};

const formatMoney = (v: number, currency = 'GBP') =>
  v.toLocaleString('en-GB', { style: 'currency', currency });

const PotsBoard: React.FC = () => {
  const { currentUser } = useAuth();
  const [pots, setPots] = useState<Pot[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    const potsQuery = query(
      collection(db, 'monzo_pots'),
      where('ownerUid', '==', currentUser.uid)
    );
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubPots = onSnapshot(potsQuery, (snap) => {
      const list: Pot[] = snap.docs.map((d) => {
        const data = d.data() as any;
        return {
          id: d.id,
          name: data.name || 'Pot',
          balance: data.balance || 0,
          currency: data.currency || 'GBP',
          deleted: !!data.deleted,
          closed: !!data.closed,
        };
      });
      setPots(list.filter((p) => !p.deleted && !p.closed));
      setLoading(false);
    });

    const unsubGoals = onSnapshot(goalsQuery, (snap) => {
      const list: Goal[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      setGoals(list);
    });

    return () => {
      unsubPots();
      unsubGoals();
    };
  }, [currentUser]);

  const enriched = useMemo(() => {
    const map = pots.map((p) => {
      const linkedGoals = goals.filter(
        (g) => (g.potId === p.id || g.linkedPotId === p.id || g.potId === p.id.replace(`${currentUser?.uid}_`, '') || g.linkedPotId === p.id.replace(`${currentUser?.uid}_`, '')) &&
          g.status !== 2 &&
          g.status !== 'done'
      );
      const target = linkedGoals.reduce((sum, g) => sum + (g.estimatedCost || 0), 0);
      const progress = target > 0 ? Math.min((p.balance / 100) / target * 100, 100) : 0;
      return {
        ...p,
        linkedGoals,
        target,
        progress,
      };
    });
    return map;
  }, [pots, goals, currentUser]);

  if (!currentUser) return <Alert variant="warning" className="m-3">Sign in to view pots.</Alert>;
  if (loading) return <div className="d-flex justify-content-center py-5"><Spinner animation="border" /></div>;

  return (
    <div className="container py-3">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h3 className="mb-1">Pots</h3>
          <div className="text-muted small">Balances with linked goals and progress</div>
        </div>
        <Badge bg="light" text="dark">Total: {pots.length}</Badge>
      </div>

      {enriched.length === 0 && <Alert variant="light">No pots found. Connect Monzo and sync.</Alert>}

      <Row className="g-3">
        {enriched.map((p) => (
          <Col key={p.id} md={4} sm={6} xs={12}>
            <Card className="h-100 shadow-sm">
              <Card.Body className="d-flex flex-column gap-2">
                <div className="d-flex justify-content-between align-items-start">
                  <div>
                    <h5 className="mb-0">{p.name}</h5>
                  </div>
                  <Badge bg="primary" className="fs-6">{formatMoney(p.balance / 100, p.currency)}</Badge>
                </div>
                <div className="text-muted small">
                  Linked goals: {p.linkedGoals.length} • Target: {p.target ? formatMoney(p.target) : '—'}
                </div>
                <ProgressBar now={p.progress} variant={p.progress >= 100 ? 'success' : 'info'} style={{ height: 8 }} />
                <div className="small text-muted">Progress: {p.progress.toFixed(1)}%</div>
                <div className="small text-muted" style={{ wordBreak: 'break-all' }}>{p.id}</div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
};

export default PotsBoard;
