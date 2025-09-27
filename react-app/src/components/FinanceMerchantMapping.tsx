import React, { useEffect, useMemo, useState } from 'react';
import { Container, Card, Table, Alert, Button, Form, Badge } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db, functions } from '../firebase';
import { collection, doc, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import Papa from 'papaparse';

type CategoryType = 'mandatory' | 'optional' | 'savings' | 'income';
const TYPES: CategoryType[] = ['mandatory','optional','savings','income'];

const FinanceMerchantMapping: React.FC = () => {
  const { currentUser } = useAuth();
  const [merchantRules, setMerchantRules] = useState<Record<string, { type: CategoryType; label: string }>>({});
  const [unknown, setUnknown] = useState<Record<string, { appearances: number; sampleLabel: string }>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Load existing mapping
  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'finance_mapping', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const d: any = snap.exists() ? (snap.data()||{}) : {};
      setMerchantRules(d.merchantToCategory || {});
    });
    return unsub;
  }, [currentUser]);

  // Detect unknown merchants from recent transactions
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'monzo_transactions'),
      where('ownerUid','==', currentUser.uid),
      orderBy('createdAt','desc'),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, { appearances: number; sampleLabel: string }> = {};
      snap.forEach(d => {
        const tx: any = d.data() || {};
        const merchant = String(tx.merchant?.name || tx.description || '').trim().toLowerCase();
        if (!merchant) return;
        const hasUser = !!tx.userCategoryType;
        const mapped = merchantRules[merchant];
        if (!hasUser && !mapped) {
          if (!map[merchant]) map[merchant] = { appearances: 0, sampleLabel: String(tx.defaultCategoryLabel || tx.description || '') };
          map[merchant].appearances += 1;
        }
      });
      setUnknown(map);
    });
    return unsub;
  }, [currentUser, merchantRules]);

  const save = async () => {
    if (!currentUser) return;
    try {
      await import('firebase/firestore').then(async (m) => {
        await m.setDoc(m.doc(db, 'finance_mapping', currentUser.uid), { merchantToCategory: merchantRules }, { merge: true });
      });
      setMessage('Mapping saved. Analytics will refresh on next recompute.');
    } catch (e: any) {
      setMessage('Save failed: ' + (e?.message || 'unknown'));
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

  const loadSample = async () => {
    try {
      setImporting(true);
      const res = await fetch('/data/merchant_mapping.csv');
      if (!res.ok) throw new Error('Sample not found');
      const text = await res.text();
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          const rows = Array.isArray(results.data) ? (results.data as any[]) : [];
          const next = { ...merchantRules };
          rows.forEach((r: any) => {
            const merchant = String(r.Merchant || r.merchant || r.Vendor || '').trim().toLowerCase();
            const label = String(r.Category || r.label || '').trim() || 'Uncategorised';
            const typeRaw = String(r.Type || r.CategoryType || '').trim().toLowerCase();
            const type: CategoryType = TYPES.includes(typeRaw as CategoryType) ? (typeRaw as CategoryType) : 'optional';
            if (merchant) next[merchant] = { type, label };
          });
          setMerchantRules(next);
          setMessage(`Loaded ${rows.length} rows from sample`);
          setImporting(false);
        }
      });
    } catch (e: any) {
      setMessage('Sample import failed: ' + (e?.message || 'unknown'));
      setImporting(false);
    }
  };

  const unknownList = useMemo(() => Object.entries(unknown).sort((a,b)=> b[1].appearances - a[1].appearances), [unknown]);

  return (
    <Container fluid className="py-4">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 className="mb-0">Merchant → Category Mapping</h2>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={loadSample} disabled={importing}>Load Sample Mapping</Button>
          <Button variant="outline-secondary" onClick={recompute}>Recompute Analytics</Button>
          <Button variant="primary" onClick={save}>Save Mapping</Button>
        </div>
      </div>
      {message && <Alert variant="info">{message}</Alert>}

      <Card className="mb-4">
        <Card.Body>
          <Card.Title>Unknown Merchants (recent)</Card.Title>
          {unknownList.length === 0 ? (
            <Alert variant="light" className="mb-0">No unknown merchants detected in the latest data.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Occurrences</th>
                  <th>Type</th>
                  <th>Category Label</th>
                </tr>
              </thead>
              <tbody>
                {unknownList.map(([merchant, info]) => (
                  <tr key={merchant}>
                    <td>{merchant}</td>
                    <td><Badge bg="light" text="dark">{info.appearances}</Badge></td>
                    <td>
                      <Form.Select size="sm" value={merchantRules[merchant]?.type || 'optional'} onChange={(e)=> setMerchantRules(prev => ({ ...prev, [merchant]: { type: e.target.value as CategoryType, label: prev[merchant]?.label || info.sampleLabel || 'Uncategorised' } }))}>
                        {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </Form.Select>
                    </td>
                    <td>
                      <Form.Control size="sm" value={merchantRules[merchant]?.label || info.sampleLabel || ''} onChange={(e)=> setMerchantRules(prev => ({ ...prev, [merchant]: { type: prev[merchant]?.type || 'optional', label: e.target.value } }))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Card.Title>Current Mapping</Card.Title>
          {Object.keys(merchantRules).length === 0 ? (
            <Alert variant="light" className="mb-0">No merchant rules saved yet.</Alert>
          ) : (
            <Table size="sm" responsive>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Type</th>
                  <th>Category Label</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(merchantRules).sort().map(([m, cfg]) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td>{cfg.type}</td>
                    <td>{cfg.label}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default FinanceMerchantMapping;

