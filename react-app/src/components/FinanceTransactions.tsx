import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { db, functions } from '../firebase';
import { useLocation } from 'react-router-dom';

type CategoryType = 'mandatory' | 'optional' | 'savings' | 'income';

interface TxRow {
  id: string;
  transactionId: string;
  description: string;
  amount: number; // can be negative
  createdISO: string | null;
  defaultCategoryType?: string | null;
  defaultCategoryLabel?: string | null;
  userCategoryType?: string | null;
  userCategoryLabel?: string | null;
  merchantName?: string | null;
}

const TYPES: CategoryType[] = ['mandatory','optional','savings','income'];

const formatCurrency = (value: number | undefined | null) => {
  const amount = Number.isFinite(Number(value)) ? Number(value) : 0;
  return amount.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
};

const FinanceTransactions: React.FC = () => {
  const { currentUser } = useAuth();
  const location = useLocation();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all'|CategoryType>('all');
  const [savingTx, setSavingTx] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { type: CategoryType; label: string }>>({});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
    );
    const unsub = onSnapshot(q, (snap) => {
      const list: TxRow[] = snap.docs.map((d) => {
        const data: any = d.data() || {};
        return {
          id: d.id,
          transactionId: data.transactionId,
          description: data.description || data.merchant?.name || '—',
          amount: Number(data.amount != null ? data.amount : (data.amountMinor || 0) / 100),
          createdISO: data.createdISO || null,
          defaultCategoryType: data.defaultCategoryType || null,
          defaultCategoryLabel: data.defaultCategoryLabel || null,
          userCategoryType: data.userCategoryType || null,
          userCategoryLabel: data.userCategoryLabel || null,
          merchantName: data.merchant?.name || null,
        };
      });
      setRows(list);
      setEdits((prev) => {
        const next = { ...prev };
        list.forEach((r) => {
          if (!next[r.transactionId]) {
            const typeGuess = (r.userCategoryType || r.defaultCategoryType || 'optional') as CategoryType;
            next[r.transactionId] = { type: TYPES.includes(typeGuess) ? typeGuess : 'optional', label: r.userCategoryLabel || r.defaultCategoryLabel || r.description };
          }
        });
        return next;
      });
    });
    return unsub;
  }, [currentUser]);

  // Initialize filter from query string (?q=...)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const q = params.get('q');
    if (q) setFilter(q);
  }, [location.search]);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter !== 'all') {
        const t = (r.userCategoryType || r.defaultCategoryType || '').toLowerCase();
        if (t !== typeFilter) return false;
      }
      if (!f) return true;
      return (
        r.description?.toLowerCase().includes(f) ||
        r.merchantName?.toLowerCase().includes(f) ||
        r.userCategoryLabel?.toLowerCase().includes(f) ||
        r.defaultCategoryLabel?.toLowerCase().includes(f)
      );
    });
  }, [rows, filter, typeFilter]);

  const saveRow = async (tx: TxRow) => {
    if (!currentUser) return;
    const edit = edits[tx.transactionId];
    if (!edit) return;
    try {
      setSavingTx(tx.transactionId);
      const fn = httpsCallable(functions, 'updateMonzoTransactionCategory');
      await fn({ transactionId: tx.transactionId, categoryType: edit.type, label: edit.label });
      setMessage('Saved and analytics refreshing…');
    } catch (e: any) {
      setMessage('Save failed: ' + (e?.message || 'unknown'));
    } finally {
      setSavingTx(null);
    }
  };

  const recompute = async () => {
    try {
      const fn = httpsCallable(functions, 'recomputeMonzoAnalytics');
      await fn({});
      setMessage('Analytics recompute started.');
    } catch (e: any) {
      setMessage('Recompute failed: ' + (e?.message || 'unknown'));
    }
  };

  return (
    <div className="container-fluid py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Transactions</h2>
        <div className="d-flex gap-2">
          <Form.Select size="sm" value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value as any)} style={{ width: 180 }}>
            <option value="all">All Types</option>
            {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </Form.Select>
          <Form.Control size="sm" placeholder="Search…" value={filter} onChange={(e)=>setFilter(e.target.value)} style={{ width: 240 }} />
          <Button size="sm" variant="outline-secondary" onClick={recompute}>Recompute Analytics</Button>
        </div>
      </div>
      {message && <Alert variant="info">{message}</Alert>}
      <Card>
        <Card.Body>
          {filtered.length === 0 ? (
            <Alert variant="light" className="mb-0">No transactions match the filter.</Alert>
          ) : (
            <Table size="sm" responsive hover>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Type</th>
                  <th>Category</th>
                  <th className="text-end">Amount</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((tx) => (
                  <tr key={tx.id}>
                    <td>{tx.createdISO ? new Date(tx.createdISO).toLocaleDateString() : '—'}</td>
                    <td>
                      <div className="fw-semibold">{tx.description}</div>
                      {tx.merchantName && <div className="small text-muted">{tx.merchantName}</div>}
                    </td>
                    <td style={{ width: 180 }}>
                      <Form.Select size="sm" value={edits[tx.transactionId]?.type || 'optional'} onChange={(e)=>setEdits(prev => ({ ...prev, [tx.transactionId]: { ...(prev[tx.transactionId]||{ type: 'optional', label: tx.description }), type: e.target.value as CategoryType } }))}>
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </Form.Select>
                    </td>
                    <td style={{ width: 260 }}>
                      <Form.Control size="sm" value={edits[tx.transactionId]?.label || ''} onChange={(e)=>setEdits(prev => ({ ...prev, [tx.transactionId]: { ...(prev[tx.transactionId]||{ type: 'optional', label: '' }), label: e.target.value } }))} />
                    </td>
                    <td className="text-end">
                      <Badge bg={tx.amount < 0 ? 'danger' : 'success'}>{formatCurrency(Math.abs(tx.amount))}</Badge>
                    </td>
                    <td className="text-end" style={{ width: 120 }}>
                      <Button size="sm" variant="primary" onClick={()=>saveRow(tx)} disabled={savingTx === tx.transactionId}>
                        {savingTx === tx.transactionId ? (<><Spinner size="sm" animation="border" className="me-2" />Saving…</>) : 'Save'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default FinanceTransactions;
