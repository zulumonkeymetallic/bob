import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, Table } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { db, functions } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

type MerchantRow = {
  merchantKey: string;
  merchantName: string;
  totalSpend: number;
  transactions: number;
  primaryCategoryType: string;
  lastTransactionISO?: string | null;
  months?: number;
  isRecurring?: boolean;
};

const CATEGORY_TYPES = ['mandatory', 'optional', 'savings', 'income'] as const;

const formatMoney = (v: number) => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

const MerchantMappings: React.FC = () => {
  const { currentUser } = useAuth();
  const [summary, setSummary] = useState<any | null>(null);
  const [edits, setEdits] = useState<Record<string, { type: string; label: string }>>({});
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [subKey, setSubKey] = useState('');
  const [subDecision, setSubDecision] = useState<'keep'|'reduce'|'cancel'>('keep');
  const [subNote, setSubNote] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'monzo_budget_summary', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => setSummary(snap.exists() ? snap.data() : null));
    return () => unsub();
  }, [currentUser]);

  const rows: MerchantRow[] = useMemo(() => {
    const list = (summary?.merchantSummary || []) as MerchantRow[];
    return list;
  }, [summary]);

  const pending = (summary?.pendingClassification || []) as Array<any>;
  const recurring = (summary?.recurringMerchants || []) as MerchantRow[];

  const setEdit = (merchantKey: string, patch: Partial<{ type: string; label: string }>) => {
    setEdits((prev) => ({
      ...prev,
      [merchantKey]: {
        type: patch.type ?? prev[merchantKey]?.type ?? 'optional',
        label: patch.label ?? prev[merchantKey]?.label ?? (rows.find(r => r.merchantKey === merchantKey)?.merchantName || merchantKey),
      },
    }));
  };

  const saveOne = async (merchantKey: string, apply: boolean) => {
    if (!currentUser) return;
    const edit = edits[merchantKey];
    if (!edit) return;
    setBusy(true); setStatus('');
    try {
      const fn = httpsCallable(functions, 'setMerchantMapping');
      const res: any = await fn({ merchantKey, categoryType: edit.type, label: edit.label, applyToExisting: apply });
      setStatus(`Saved mapping for ${merchantKey}${apply ? ` and updated ${res?.data?.updated || 0} transactions` : ''}.`);
    } catch (e: any) {
      setStatus(e?.message || 'Failed to save');
    } finally { setBusy(false); }
  };

  const bulkApplyAll = async () => {
    if (!currentUser) return;
    setBusy(true); setStatus('');
    try {
      const fn = httpsCallable(functions, 'applyMerchantMappings');
      const res: any = await fn({});
      setStatus(`Applied mappings to ${res?.data?.updated || 0} transactions.`);
    } catch (e: any) {
      setStatus(e?.message || 'Bulk apply failed');
    } finally { setBusy(false); }
  };

  const backfillMerchantKeys = async () => {
    if (!currentUser) return;
    setBusy(true); setStatus('');
    try {
      const fn = httpsCallable(functions, 'backfillMerchantKeys');
      const res: any = await fn({});
      setStatus(`Backfilled ${res?.data?.updated || 0} transactions with merchant keys.`);
    } catch (e: any) {
      setStatus(e?.message || 'Backfill failed');
    } finally { setBusy(false); }
  };

  const saveSubscriptionOverride = async () => {
    if (!currentUser || !subKey.trim()) return;
    setBusy(true); setStatus('');
    try {
      const fn = httpsCallable(functions, 'setMonzoSubscriptionOverride');
      const res: any = await fn({ merchantKey: subKey.trim(), decision: subDecision, note: subNote || undefined });
      setStatus(`Subscription override saved for ${subKey} → ${subDecision}.`);
      setSubKey(''); setSubNote(''); setSubDecision('keep');
    } catch (e: any) {
      setStatus(e?.message || 'Failed to set subscription override');
    } finally { setBusy(false); }
  };

  const handleCsvImport = async (file: File) => {
    if (!currentUser) return;
    setBusy(true); setStatus('');
    try {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      const rows: Array<{ merchant: string; label?: string; type: string }> = [];
      for (const line of lines) {
        const parts = line.split(',');
        if (parts.length < 2) continue;
        const merchant = parts[0].trim();
        const maybeType = parts[2] ? parts[2].trim().toLowerCase() : parts[1].trim().toLowerCase();
        const maybeLabel = parts[2] ? parts[1].trim() : parts[0].trim();
        if (!merchant) continue;
        rows.push({ merchant, label: maybeLabel, type: maybeType });
      }
      const fn = httpsCallable(functions, 'bulkUpsertMerchantMappings');
      const res: any = await fn({ rows, apply: false });
      setStatus(`Imported ${res?.data?.upserts || rows.length} mappings.`);
    } catch (e: any) {
      setStatus(e?.message || 'CSV import failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="container py-3">
      <h3>Merchant Mappings</h3>
      <p className="text-muted">Map merchants to your budget categories. New transactions will auto-categorise; you can bulk-apply to history.</p>

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap gap-2 align-items-center">
            <div>
              <Form.Label className="me-2">Bulk CSV</Form.Label>
              <Form.Control
                type="file"
                size="sm"
                accept=".csv"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) handleCsvImport(file);
                }}
              />
            </div>
            <Button size="sm" variant="outline-success" disabled={busy} onClick={bulkApplyAll}>
              {busy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
              Apply All Mappings
            </Button>
            <Button size="sm" variant="outline-secondary" disabled={busy} onClick={backfillMerchantKeys}>Backfill Merchant Keys</Button>
            {status && <span className="ms-2 small text-muted">{status}</span>}
          </div>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Header>
          <strong>Subscription Overrides</strong>
        </Card.Header>
        <Card.Body>
          <div className="row g-2 align-items-end">
            <div className="col-sm-4">
              <Form.Label className="mb-1">Merchant Key</Form.Label>
              <Form.Control size="sm" value={subKey} onChange={(e)=>setSubKey(e.target.value)} placeholder="normalized key (e.g., netflix)" />
            </div>
            <div className="col-sm-3">
              <Form.Label className="mb-1">Decision</Form.Label>
              <Form.Select size="sm" value={subDecision} onChange={(e)=>setSubDecision(e.target.value as any)}>
                <option value="keep">keep</option>
                <option value="reduce">reduce</option>
                <option value="cancel">cancel</option>
              </Form.Select>
            </div>
            <div className="col-sm-5">
              <Form.Label className="mb-1">Note</Form.Label>
              <Form.Control size="sm" value={subNote} onChange={(e)=>setSubNote(e.target.value)} placeholder="optional note" />
            </div>
          </div>
          <div className="mt-2">
            <Button size="sm" variant="warning" disabled={busy || !subKey.trim()} onClick={saveSubscriptionOverride}>
              {busy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
              Save Override
            </Button>
          </div>
        </Card.Body>
      </Card>

      {pending?.length > 0 && (
        <Card className="mb-3">
          <Card.Header>
            <strong>Uncategorised Suggestions</strong>
          </Card.Header>
          <Card.Body>
            <div className="small text-muted mb-2">Quickly create mappings for frequent uncategorised merchants.</div>
            <Table size="sm" responsive hover>
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="text-end">Amount</th>
                  <th>Type</th>
                  <th>Label</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pending.slice(0, 10).map((p) => {
                  const k = (p.merchantName || p.description || '').toLowerCase();
                  return (
                    <tr key={p.transactionId}>
                      <td>{p.merchantName || p.description}</td>
                      <td className="text-end">{formatMoney(p.amount || 0)}</td>
                      <td style={{ width: 160 }}>
                        <Form.Select size="sm" value={edits[k]?.type || p.defaultCategoryType || 'optional'} onChange={(e)=>setEdit(k,{ type: e.target.value })}>
                          {CATEGORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </Form.Select>
                      </td>
                      <td style={{ width: 220 }}>
                        <Form.Control size="sm" value={edits[k]?.label || p.defaultCategoryLabel || p.merchantName || ''} onChange={(e)=>setEdit(k,{ label: e.target.value })} />
                      </td>
                      <td className="text-end">
                        <Button size="sm" onClick={()=>saveOne(k, true)} disabled={busy}>Save & Apply</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card.Body>
        </Card>
      )}

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <strong>Top Merchants</strong>
          </div>
          <div className="small text-muted">Month-on-month: mark recurring providers (e.g., mortgage, utilities)</div>
        </Card.Header>
        <Card.Body>
          {rows.length === 0 ? (
            <Alert variant="light" className="mb-0">Sync Monzo to populate merchant list.</Alert>
          ) : (
            <Table size="sm" responsive hover>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th className="text-end">Spend</th>
                  <th>Type</th>
                  <th>Label</th>
                  <th>Flags</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.merchantKey}>
                    <td>{m.merchantName}</td>
                    <td className="text-end">{formatMoney(m.totalSpend)}</td>
                    <td style={{ width: 160 }}>
                      <Form.Select size="sm" value={edits[m.merchantKey]?.type || m.primaryCategoryType || 'optional'} onChange={(e)=>setEdit(m.merchantKey,{ type: e.target.value })}>
                        {CATEGORY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </Form.Select>
                    </td>
                    <td style={{ width: 220 }}>
                      <Form.Control size="sm" value={edits[m.merchantKey]?.label || m.merchantName} onChange={(e)=>setEdit(m.merchantKey,{ label: e.target.value })} />
                    </td>
                    <td>
                      {m.isRecurring ? <Badge bg="info">Recurring</Badge> : null}
                      {m.months && m.months >= 3 ? <Badge bg="secondary" className="ms-1">{m.months} mo</Badge> : null}
                    </td>
                    <td className="text-end">
                      <div className="d-flex gap-2 justify-content-end">
                        <Button size="sm" variant="outline-secondary" disabled={busy} onClick={()=>saveOne(m.merchantKey, false)}>
                          Save
                        </Button>
                        <Button size="sm" variant="primary" disabled={busy} onClick={()=>saveOne(m.merchantKey, true)}>
                          {busy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                          Save & Apply
                        </Button>
                      </div>
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

export default MerchantMappings;
