import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FixedSizeList as List } from 'react-window';
import useMeasure from 'react-use-measure';
import { useAuth } from '../../contexts/AuthContext';
import { db, functions } from '../../firebase';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { DEFAULT_CATEGORIES, FinanceCategory, BUCKET_LABELS, getCategoryByKey, mergeFinanceCategories } from '../../utils/financeCategories';
import './MerchantMappings.css';

type MerchantRow = {
  merchantKey: string;
  merchantName: string;
  totalSpend: number;
  transactions: number;
  primaryCategoryType: string;
  primaryCategoryKey?: string;
  lastTransactionISO?: string | null;
  months?: number;
  isRecurring?: boolean;
  isSubscription?: boolean;
};

const formatMoney = (v: number) => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

const MerchantMappings: React.FC = () => {
  const { currentUser } = useAuth();
  const [customCategories, setCustomCategories] = useState<FinanceCategory[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [edits, setEdits] = useState<Record<string, { categoryKey: string; label: string; isSubscription?: boolean }>>({});
  const [status, setStatus] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [subKey, setSubKey] = useState('');
  const [subDecision, setSubDecision] = useState<'keep' | 'reduce' | 'cancel'>('keep');
  const [subNote, setSubNote] = useState('');
  const [search, setSearch] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [sortMode, setSortMode] = useState<'merchant' | 'spend_desc' | 'transactions_desc'>('transactions_desc');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [tableRef, bounds] = useMeasure();
  const [pots, setPots] = useState<Record<string, { name: string }>>({});
  const [txSample, setTxSample] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'monzo_budget_summary', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => setSummary(snap.exists() ? snap.data() : null));
    const potQ = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsubPots = onSnapshot(potQ, (snap) => {
      const map: Record<string, { name: string }> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        const id = data.potId || d.id;
        if (!id) return;
        map[id] = { name: data.name || id };
      });
      setPots(map);
    });
    // Lightweight fallback sample of transactions so UI isn't empty if summary hasn't been built yet
    const txQ = query(collection(db, 'monzo_transactions'), where('ownerUid', '==', currentUser.uid));
    const unsubTx = onSnapshot(txQ, (snap) => {
      const rows: any[] = [];
      snap.docs.slice(0, 500).forEach((d) => {
        const data = d.data() as any;
        rows.push({
          merchantKey: data.merchantKey || data.merchantId || data.merchant || data.merchant_normalized || data.description,
          merchantName: data.merchant || data.merchantName || data.description,
          amount: typeof data.amount === 'number' ? data.amount : Number(data.amount || 0),
        });
      });
      setTxSample(rows);
    });
    return () => { unsub(); unsubPots(); unsubTx(); };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setCustomCategories([]);
      return;
    }
    const ref = doc(db, 'finance_categories', currentUser.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.data() as any;
        const arr = Array.isArray(data?.categories) ? data.categories : [];
        setCustomCategories(arr.filter((c) => c?.key) as FinanceCategory[]);
      },
      (err) => console.error('Failed to load finance categories', err)
    );
    return () => unsub();
  }, [currentUser]);

  const allCategories = useMemo(() => mergeFinanceCategories(customCategories), [customCategories]);
  const categoriesByBucket = useMemo(() => {
    return allCategories.reduce<Record<string, FinanceCategory[]>>((acc, cat) => {
      const bucket = cat.bucket || 'unknown';
      if (!acc[bucket]) acc[bucket] = [];
      acc[bucket].push(cat);
      return acc;
    }, {});
  }, [allCategories]);

  const rows: MerchantRow[] = useMemo(() => {
    const list = (summary?.merchantSummary || []) as MerchantRow[];
    if (Array.isArray((summary as any)?.allMerchants)) {
      return (summary as any).allMerchants as MerchantRow[];
    }
    if (list && list.length) return list;
    if (txSample.length) {
      const agg = new Map<string, { spend: number; count: number; name: string }>();
      txSample.forEach((t) => {
        const key = (t.merchantKey || t.merchantName || 'unknown').toString();
        if (!agg.has(key)) agg.set(key, { spend: 0, count: 0, name: t.merchantName || key });
        const entry = agg.get(key)!;
        entry.count += 1;
        entry.spend += Math.abs(t.amount || 0);
      });
      return Array.from(agg.entries()).map(([merchantKey, val]) => ({
        merchantKey,
        merchantName: val.name,
        totalSpend: val.spend,
        transactions: val.count,
        primaryCategoryType: '',
        primaryCategoryKey: '',
      }));
    }
    return [];
  }, [summary, txSample]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => (r.merchantName || r.merchantKey || '').toLowerCase().includes(q));
    }
    if (missingOnly) {
      list = list.filter((r) => !r.primaryCategoryKey && !r.primaryCategoryType);
    }
    const decorated = list.map((r) => {
      const months = r.months || 0;
      const tx = r.transactions || 0;
      const txRate = months > 0 ? tx / months : tx;
      const tx12 = Math.round(txRate * 12);
      const tx6 = Math.round(txRate * 6);
      return { ...r, transactions12: tx12 || tx, transactions6: tx6 || tx };
    });

    const sorted = [...decorated];
    if (sortMode === 'merchant') {
      sorted.sort((a, b) => {
        const cmp = (a.merchantName || '').localeCompare(b.merchantName || '');
        return sortDir === 'asc' ? cmp : -cmp;
      });
    } else if (sortMode === 'spend_desc') {
      sorted.sort((a, b) => (b.totalSpend || 0) - (a.totalSpend || 0));
    } else if (sortMode === 'transactions_desc') {
      sorted.sort((a, b) => {
        const txA = a.transactions12 || a.transactions || 0;
        const txB = b.transactions12 || b.transactions || 0;
        return txB - txA;
      });
    }
    return sorted;
  }, [rows, search, missingOnly, sortMode, sortDir]);

  // Prevent an empty grid when filters hide everything
  useEffect(() => {
    if (rows.length > 0 && filteredRows.length === 0 && missingOnly) {
      setMissingOnly(false);
    }
  }, [rows.length, filteredRows.length, missingOnly]);

  const setEdit = (merchantKey: string, patch: Partial<{ categoryKey: string; label: string; isSubscription: boolean }>) => {
    setEdits((prev) => ({
      ...prev,
      [merchantKey]: {
        categoryKey: patch.categoryKey ?? prev[merchantKey]?.categoryKey ?? 'dining_out',
        label: patch.label ?? prev[merchantKey]?.label ?? (rows.find(r => r.merchantKey === merchantKey)?.merchantName || merchantKey),
        isSubscription: patch.isSubscription ?? prev[merchantKey]?.isSubscription ?? (rows.find(r => r.merchantKey === merchantKey)?.isSubscription || false),
      },
    }));
  };

  const saveOne = async (merchantKey: string, apply: boolean) => {
    if (!currentUser) return;
    const edit = edits[merchantKey];
    if (!edit) return;
    setBusy(true); setStatus('');
    try {
      const category = getCategoryByKey(edit.categoryKey);
      const fn = httpsCallable(functions, 'setMerchantMapping');
      const res: any = await fn({
        merchantKey,
        categoryKey: edit.categoryKey,
        categoryType: mapBucketToType(getCategoryByKey(edit.categoryKey, allCategories)?.bucket || category?.bucket || 'discretionary'),
        categoryLabel: getCategoryByKey(edit.categoryKey, allCategories)?.label || category?.label || edit.label,
        label: edit.label,
        isSubscription: edit.isSubscription,
        applyToExisting: apply
      });
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
    <div className="container py-3" ref={tableRef}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="small text-muted">Signed in as: <code>{currentUser?.uid || '—'}</code></span>
      </div>
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
              <Form.Control size="sm" value={subKey} onChange={(e) => setSubKey(e.target.value)} placeholder="normalized key (e.g., netflix)" />
            </div>
            <div className="col-sm-3">
              <Form.Label className="mb-1">Decision</Form.Label>
              <Form.Select size="sm" value={subDecision} onChange={(e) => setSubDecision(e.target.value as any)}>
                <option value="keep">keep</option>
                <option value="reduce">reduce</option>
                <option value="cancel">cancel</option>
              </Form.Select>
            </div>
            <div className="col-sm-5">
              <Form.Label className="mb-1">Note</Form.Label>
              <Form.Control size="sm" value={subNote} onChange={(e) => setSubNote(e.target.value)} placeholder="optional note" />
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

      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex flex-wrap gap-3 align-items-center">
            <div>
              <div className="small text-muted mb-1">Search</div>
              <Form.Control
                size="sm"
                placeholder="Search merchant"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ maxWidth: 240 }}
              />
            </div>
            <Form.Check
              type="switch"
              id="missing-only"
              label="Only show uncategorised"
              checked={missingOnly}
              onChange={(e) => setMissingOnly(e.target.checked)}
            />
            <div className="small text-muted">Default view: all merchants, toggle to narrow to uncategorised.</div>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <div>
            <strong>All Merchants</strong>
            <div className="text-muted small">Excel-style grid: spend, transaction cadence, category, bucket, subscription.</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Form.Select
              size="sm"
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as 'merchant' | 'spend_desc' | 'transactions_desc')}
            >
              <option value="merchant">Sort by merchant A→Z</option>
              <option value="transactions_desc">Sort by tx count (high → low)</option>
              <option value="spend_desc">Sort by total spend (high → low)</option>
            </Form.Select>
            {sortMode === 'merchant' && (
              <Form.Select
                size="sm"
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as 'asc' | 'desc')}
              >
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </Form.Select>
            )}
          </div>
        </Card.Header>
        <Card.Body className="p-0">
          {rows.length === 0 ? (
            <Alert variant="light" className="mb-0">Sync Monzo to populate merchant list.</Alert>
          ) : filteredRows.length === 0 ? (
            <Alert variant="warning" className="mb-0 d-flex justify-content-between align-items-center">
              <span>No merchants match your filters. Showing everything instead.</span>
              <div className="d-flex gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => { setSearch(''); setMissingOnly(false); }}>
                  Clear filters
                </Button>
              </div>
            </Alert>
          ) : (
            <div className="merchant-table" style={{ height: 540 }}>
              <div className="merchant-header">
                <span>Merchant</span>
                <OverlayTrigger placement="top" overlay={<Tooltip>Total spend (ex VAT)</Tooltip>}><span>Spend</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>Total transactions</Tooltip>}><span>Tx (Total)</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>12mo = projected from months/transactions or YTD if present</Tooltip>}><span>Tx (12mo)</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>6mo = projected from months/transactions</Tooltip>}><span>Tx (6mo)</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>Category label to apply</Tooltip>}><span>Category</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>Bucket derived from category</Tooltip>}><span>Bucket</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>Mark as subscription for override</Tooltip>}><span>Subscription</span></OverlayTrigger>
                <OverlayTrigger placement="top" overlay={<Tooltip>Flags and save/apply actions</Tooltip>}><span className="text-end">Actions</span></OverlayTrigger>
              </div>
              <List
                height={480}
                width={bounds.width || 1200}
                itemCount={filteredRows.length}
                itemSize={98}
                itemKey={(idx) => filteredRows[idx].merchantKey}
              >
                {({ index, style }) => {
                  const m = filteredRows[index];
                  const bucketLabel = m.primaryCategoryKey
                    ? BUCKET_LABELS[(getCategoryByKey(m.primaryCategoryKey, allCategories)?.bucket || 'optional') as keyof typeof BUCKET_LABELS]
                    : (m.primaryCategoryType || 'optional');
                  const tx12 = m.transactions12 || 0;
                  const tx6 = m.transactions6 || 0;
                  const totalTx = m.transactions || 0;
                  return (
                    <div style={style} className="merchant-row">
                      <div className="merchant-cell">
                        <div className="merchant-label text-truncate">{m.merchantName}</div>
                        <div className="merchant-sub">{m.merchantKey}</div>
                        <div className="merchant-sub">Last: {m.lastTransactionISO ? new Date(m.lastTransactionISO).toLocaleDateString() : '—'}</div>
                      </div>
                      <div className="merchant-cell">
                        <div className="merchant-money">{formatMoney(m.totalSpend)}</div>
                      </div>
                      <div className="merchant-cell">
                        <div className="merchant-label">{totalTx} tx</div>
                        <div className="merchant-sub">lifetime</div>
                      </div>
                      <div className="merchant-cell">
                        <div className="merchant-label">{tx12}</div>
                        <div className="merchant-sub">12mo proj</div>
                      </div>
                      <div className="merchant-cell">
                        <div className="merchant-label">{tx6}</div>
                        <div className="merchant-sub">6mo proj</div>
                      </div>
                      <div className="merchant-cell">
                        <Form.Select
                          size="sm"
                          value={edits[m.merchantKey]?.categoryKey || m.primaryCategoryKey || 'dining_out'}
                          onChange={(e) => setEdit(m.merchantKey, { categoryKey: e.target.value })}
                          className="merchant-input"
                        >
                          {Object.entries(categoriesByBucket).map(([bucket, cats]) => (
                            <optgroup key={bucket} label={BUCKET_LABELS[bucket as keyof typeof BUCKET_LABELS]}>
                              {cats.map(cat => <option key={cat.key} value={cat.key}>{cat.label}</option>)}
                            </optgroup>
                          ))}
                        </Form.Select>
                        <Form.Control
                          size="sm"
                          className="merchant-input mt-1"
                          value={edits[m.merchantKey]?.label || m.merchantName}
                          onChange={(e) => setEdit(m.merchantKey, { label: e.target.value })}
                        />
                      </div>
                      <div className="merchant-cell">
                        <div className="merchant-chip">{bucketLabel}</div>
                      </div>
                      <div className="merchant-cell text-center">
                        <Form.Check
                          type="checkbox"
                          checked={edits[m.merchantKey]?.isSubscription ?? m.isSubscription ?? false}
                          onChange={(e) => setEdit(m.merchantKey, { isSubscription: e.target.checked })}
                        />
                      </div>
                      <div className="merchant-cell">
                        <div className="d-flex gap-2 justify-content-end">
                          <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => saveOne(m.merchantKey, false)}>
                            Save
                          </Button>
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => saveOne(m.merchantKey, true)}>
                            {busy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                            Save & Apply
                          </Button>
                        </div>
                        <div className="mt-1 d-flex gap-1 flex-wrap">
                          {m.isRecurring ? <Badge bg="info">Recurring</Badge> : null}
                          {m.months && m.months >= 3 ? <Badge bg="secondary">{m.months} mo</Badge> : null}
                        </div>
                      </div>
                    </div>
                  );
                }}
              </List>
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default MerchantMappings;

// Map the finance bucket to the limited categoryType set the backend expects
const mapBucketToType = (bucket: string) => {
  if (bucket === 'mandatory' || bucket === 'debt_repayment' || bucket === 'bank_transfer') return 'mandatory';
  if (bucket === 'discretionary') return 'optional';
  if (bucket?.includes('saving') || bucket === 'investment') return 'savings';
  if (bucket === 'net_salary' || bucket === 'irregular_income') return 'income';
  return 'optional';
};
