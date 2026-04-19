import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Form, Spinner, OverlayTrigger, Tooltip, Dropdown } from 'react-bootstrap';
import { FixedSizeList as List } from 'react-window';
import useMeasure from 'react-use-measure';
import { useAuth } from '../../contexts/AuthContext';
import { db, functions } from '../../firebase';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { FinanceCategory, BUCKET_LABELS, getCategoryByKey, mergeFinanceCategories } from '../../utils/financeCategories';
import {
  buildActionLookup,
  buildCadenceByMerchant,
  FinanceActionInsight,
  getActionForMerchant,
  isWithinLastYear,
  resolveMerchantKey,
} from './financeInsights';
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

type MerchantSortColumn = 'merchant' | 'spend' | 'transactionsTotal' | 'transactions12' | 'transactions6' | 'frequency' | 'category' | 'bucket' | 'subscription' | 'recommendedAction' | 'lastTransaction';
type MerchantSortDirection = 'asc' | 'desc';

const MERCHANT_COLUMN_STORAGE_KEY = 'finance_merchant_columns_v1';
const MERCHANT_COLUMN_OPTIONS = [
  { key: 'merchant', label: 'Merchant', width: '1.35fr' },
  { key: 'spend', label: 'Spend', width: '1fr' },
  { key: 'transactionsTotal', label: 'Tx (Total)', width: '0.85fr' },
  { key: 'transactions12', label: 'Tx (12mo)', width: '0.9fr' },
  { key: 'transactions6', label: 'Tx (6mo)', width: '0.9fr' },
  { key: 'frequency', label: 'Frequency', width: '0.95fr' },
  { key: 'category', label: 'Category', width: '1.25fr' },
  { key: 'bucket', label: 'Bucket', width: '0.9fr' },
  { key: 'subscription', label: 'Subscription', width: '0.85fr' },
  { key: 'recommendedAction', label: 'Recommended action', width: '1.25fr' },
  { key: 'actions', label: 'Actions', width: '1.2fr' },
] as const;
const MERCHANT_DEFAULT_VISIBLE_COLUMNS = ['merchant', 'spend', 'transactions12', 'frequency', 'category', 'bucket', 'subscription', 'recommendedAction', 'actions'];

const formatMoney = (v: number) => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const toText = (value: any, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const candidate = value.name || value.label || value.title || value.displayName || value.merchantName || value.id || '';
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'number') return String(candidate);
  }
  return fallback;
};
const MERCHANT_SORT_COLUMNS: MerchantSortColumn[] = [
  'merchant',
  'spend',
  'transactionsTotal',
  'transactions12',
  'transactions6',
  'frequency',
  'category',
  'bucket',
  'subscription',
  'recommendedAction',
  'lastTransaction',
];
const MERCHANT_SORT_LABELS: Record<MerchantSortColumn, string> = {
  merchant: 'Merchant',
  spend: 'Spend',
  transactionsTotal: 'Tx (Total)',
  transactions12: 'Tx (12mo)',
  transactions6: 'Tx (6mo)',
  frequency: 'Frequency',
  category: 'Category',
  bucket: 'Bucket',
  subscription: 'Subscription',
  recommendedAction: 'Recommended action',
  lastTransaction: 'Last tx',
};
const MERCHANT_DEFAULT_SORT_DIRECTION: Record<MerchantSortColumn, MerchantSortDirection> = {
  merchant: 'asc',
  spend: 'desc',
  transactionsTotal: 'desc',
  transactions12: 'desc',
  transactions6: 'desc',
  frequency: 'asc',
  category: 'asc',
  bucket: 'asc',
  subscription: 'desc',
  recommendedAction: 'asc',
  lastTransaction: 'desc',
};

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
  const [sortColumn, setSortColumn] = useState<MerchantSortColumn>('transactions12');
  const [sortDirection, setSortDirection] = useState<MerchantSortDirection>('desc');
  const [tableRef, bounds] = useMeasure();
  const [pots, setPots] = useState<Record<string, { name: string }>>({});
  const [txSample, setTxSample] = useState<any[]>([]);
  const [actionLookup, setActionLookup] = useState<Map<string, FinanceActionInsight>>(new Map());
  const [convertingActionId, setConvertingActionId] = useState<string | null>(null);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(MERCHANT_COLUMN_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { }
    return MERCHANT_DEFAULT_VISIBLE_COLUMNS;
  });

  useEffect(() => {
    if (!currentUser) return;
    const ref = doc(db, 'monzo_budget_summary', currentUser.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => setSummary(snap.exists() ? snap.data() : null),
      (err) => {
        console.error('Failed to load Monzo budget summary', err);
        setStatus((err as any)?.message || 'Missing permission to load budget summary.');
      }
    );
    const potQ = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsubPots = onSnapshot(
      potQ,
      (snap) => {
        const map: Record<string, { name: string }> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const id = data.potId || d.id;
          if (!id) return;
          map[id] = { name: data.name || id };
        });
        setPots(map);
      },
      (err) => {
        console.error('Failed to load Monzo pots', err);
        setStatus((err as any)?.message || 'Missing permission to load Monzo pots.');
      }
    );
    // Fallback dataset used for cadence inference and merchant stats when summary is unavailable.
    const txQ = query(collection(db, 'monzo_transactions'), where('ownerUid', '==', currentUser.uid));
    const unsubTx = onSnapshot(
      txQ,
      (snap) => {
        const rows: any[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const merchantName = toText(data.merchantName || data.merchant || data.description, 'Unknown merchant');
          const merchantKey = toText(
            data.merchantKey || data.merchantId || data.merchant || data.merchant_normalized || merchantName,
            merchantName
          );
          const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() : null;
          rows.push({
            merchantKey,
            merchantName,
            amount: typeof data.amount === 'number' ? data.amount : Number(data.amount || 0),
            createdISO: createdAt ? createdAt.toISOString() : (data.createdISO || null),
            isSubscription: !!data.isSubscription,
          });
        });
        setTxSample(rows);
      },
      (err) => {
        console.error('Failed to load Monzo transaction sample', err);
        setStatus((err as any)?.message || 'Missing permission to load transaction sample.');
      }
    );
    return () => {
      unsub();
      unsubPots();
      unsubTx();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setActionLookup(new Map());
      return;
    }
    const ref = doc(db, 'finance_action_insights', currentUser.uid);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const actions = Array.isArray(snap.data()?.actions) ? snap.data()?.actions : [];
        setActionLookup(buildActionLookup(actions));
      },
      (err) => {
        console.error('Failed to load finance action insights', err);
      }
    );
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    try {
      localStorage.setItem(MERCHANT_COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch { }
  }, [visibleColumns]);

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
      (err) => {
        console.error('Failed to load finance categories', err);
        setStatus((err as any)?.message || 'Missing permission to load finance categories.');
      }
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
    const normalizeRows = (input: any[]): MerchantRow[] => input
      .map((row: any) => ({
        ...row,
        merchantKey: toText(row?.merchantKey || row?.merchantName, ''),
        merchantName: toText(row?.merchantName || row?.merchantKey, 'Unknown merchant'),
      }))
      .filter((row) => !!row.merchantKey);

    const list = (summary?.merchantSummary || []) as MerchantRow[];
    if (Array.isArray((summary as any)?.allMerchants)) {
      return normalizeRows((summary as any).allMerchants as MerchantRow[]);
    }
    if (list && list.length) return normalizeRows(list);
    if (txSample.length) {
      const agg = new Map<string, { spend: number; count: number; name: string; lastISO: string | null; months: Set<string>; isSubscription: boolean }>();
      txSample.forEach((t) => {
        const key = toText(t.merchantKey || t.merchantName, 'unknown');
        const name = toText(t.merchantName || t.merchantKey, key);
        if (!agg.has(key)) {
          agg.set(key, {
            spend: 0,
            count: 0,
            name: t.merchantName || key,
            lastISO: null,
            months: new Set<string>(),
            isSubscription: false,
          });
        }
        const entry = agg.get(key)!;
        entry.count += 1;
        entry.spend += Math.abs(t.amount || 0);
        entry.name = name;
        if (t.createdISO && (!entry.lastISO || t.createdISO > entry.lastISO)) entry.lastISO = t.createdISO;
        if (t.createdISO) entry.months.add(String(t.createdISO).slice(0, 7));
        entry.isSubscription = entry.isSubscription || !!t.isSubscription;
      });
      return Array.from(agg.entries()).map(([merchantKey, val]) => ({
        merchantKey,
        merchantName: val.name,
        totalSpend: val.spend,
        transactions: val.count,
        months: val.months.size,
        lastTransactionISO: val.lastISO,
        isSubscription: val.isSubscription,
        primaryCategoryType: '',
        primaryCategoryKey: '',
      }));
    }
    return [];
  }, [summary, txSample]);

  const cadenceByMerchant = useMemo(() => buildCadenceByMerchant(txSample), [txSample]);

  const filteredRows = useMemo(() => {
    let list = rows;
    if (missingOnly) {
      list = list.filter((r) => !r.primaryCategoryKey && !r.primaryCategoryType);
    }
    const decorated = list.map((r) => {
      const months = r.months || 0;
      const tx = r.transactions || 0;
      const txRate = months > 0 ? tx / months : tx;
      const tx12 = Math.round(txRate * 12);
      const tx6 = Math.round(txRate * 6);
      const cadence = cadenceByMerchant.get(resolveMerchantKey({ merchantKey: r.merchantKey, merchantName: r.merchantName }));
      const fallbackFrequency = (() => {
        if (cadence?.frequencyLabel) return cadence.frequencyLabel;
        if (tx <= 1) return 'One-off';
        if (months >= 10 && tx <= 2) return 'Yearly';
        if (txRate >= 0.7 && txRate <= 1.4) return 'Monthly';
        if (txRate >= 0.2 && txRate < 0.7) return 'Quarterly';
        return 'Irregular';
      })();
      const recommendedAction = (r.lastTransactionISO && !isWithinLastYear(r.lastTransactionISO))
        ? null
        : getActionForMerchant(actionLookup, { merchantKey: r.merchantKey, merchantName: r.merchantName });

      return {
        ...r,
        transactions12: tx12 || tx,
        transactions6: tx6 || tx,
        inferredFrequency: fallbackFrequency,
        recommendedAction,
      };
    });
    const searched = search.trim()
      ? decorated.filter((row) => {
        const q = search.toLowerCase();
        const hay = [
          toText(row.merchantName || row.merchantKey, ''),
          toText(row.primaryCategoryKey, ''),
          toText(row.primaryCategoryType, ''),
          toText(row.inferredFrequency, ''),
          toText(row.recommendedAction?.title, ''),
          toText(row.recommendedAction?.reason, ''),
        ].join(' ').toLowerCase();
        return hay.includes(q);
      })
      : decorated;

    const sortableValue = (
      row: MerchantRow & { transactions12?: number; transactions6?: number; inferredFrequency?: string; recommendedAction?: FinanceActionInsight | null },
      column: MerchantSortColumn
    ): number | string => {
      const selectedCategoryKey = edits[row.merchantKey]?.categoryKey || row.primaryCategoryKey || '';
      const selectedCategoryLabel = selectedCategoryKey
        ? getCategoryByKey(selectedCategoryKey, allCategories)?.label || selectedCategoryKey
        : '';
      const bucketValue = selectedCategoryKey
        ? BUCKET_LABELS[(getCategoryByKey(selectedCategoryKey, allCategories)?.bucket || 'optional') as keyof typeof BUCKET_LABELS]
        : (row.primaryCategoryType || 'optional');
      if (column === 'merchant') return (row.merchantName || row.merchantKey || '').toLowerCase();
      if (column === 'spend') return row.totalSpend || 0;
      if (column === 'transactionsTotal') return row.transactions || 0;
      if (column === 'transactions12') return row.transactions12 || row.transactions || 0;
      if (column === 'transactions6') return row.transactions6 || row.transactions || 0;
      if (column === 'frequency') return toText(row.inferredFrequency, '').toLowerCase();
      if (column === 'category') return selectedCategoryLabel.toLowerCase();
      if (column === 'bucket') return String(bucketValue || '').toLowerCase();
      if (column === 'subscription') return edits[row.merchantKey]?.isSubscription ?? row.isSubscription ? 1 : 0;
      if (column === 'recommendedAction') return toText(row.recommendedAction?.title || row.recommendedAction?.reason, '').toLowerCase();
      if (column === 'lastTransaction') return row.lastTransactionISO ? new Date(row.lastTransactionISO).getTime() : 0;
      return 0;
    };

    const sorted = [...searched];
    sorted.sort((a, b) => {
      const aVal = sortableValue(a, sortColumn);
      const bVal = sortableValue(b, sortColumn);
      let comparison = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        comparison = aVal - bVal;
      } else {
        comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true, sensitivity: 'base' });
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
    return sorted;
  }, [allCategories, edits, rows, search, missingOnly, sortColumn, sortDirection, cadenceByMerchant, actionLookup]);

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

  const toggleHeaderSort = (column: MerchantSortColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection(MERCHANT_DEFAULT_SORT_DIRECTION[column]);
  };

  const sortIndicator = (column: MerchantSortColumn) => {
    if (sortColumn !== column) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const renderSortableHeader = (
    column: MerchantSortColumn,
    label: string,
    tooltip: string,
    endAligned = false
  ) => (
    <OverlayTrigger placement="top" overlay={<Tooltip>{tooltip}</Tooltip>}>
      <button
        type="button"
        className={`merchant-sort-header${endAligned ? ' merchant-sort-header--end' : ''}${sortColumn === column ? ' is-active' : ''}`}
        onClick={() => toggleHeaderSort(column)}
      >
        <span>{label}</span>
        <span className="merchant-sort-indicator">{sortIndicator(column)}</span>
      </button>
    </OverlayTrigger>
  );

  const convertActionToStory = async (action: FinanceActionInsight | null) => {
    if (!action?.id) return;
    setConvertingActionId(action.id);
    setStatus('');
    try {
      const fn = httpsCallable(functions, 'convertFinanceActionToStory');
      const res: any = await fn({ actionId: action.id, persona: 'personal' });
      const storyId = res?.data?.storyId;
      setStatus(storyId ? `Logged story ${storyId} for ${action.merchantName || action.merchantKey || 'merchant'}.` : 'Story logged.');
    } catch (err: any) {
      setStatus(err?.message || 'Failed to log story');
    } finally {
      setConvertingActionId(null);
    }
  };

  const columnOptionsByKey = useMemo(() => {
    const map = new Map<string, { key: string; label: string; width: string }>();
    MERCHANT_COLUMN_OPTIONS.forEach((opt) => map.set(opt.key, opt));
    return map;
  }, []);

  const effectiveVisibleColumns = useMemo(() => {
    const safe = visibleColumns.filter((key) => columnOptionsByKey.has(key));
    return safe.length ? safe : MERCHANT_DEFAULT_VISIBLE_COLUMNS;
  }, [visibleColumns, columnOptionsByKey]);

  const gridTemplateColumns = useMemo(() => {
    const widths = effectiveVisibleColumns
      .map((key) => columnOptionsByKey.get(key)?.width)
      .filter(Boolean) as string[];
    return widths.map((width) => `minmax(0, ${width})`).join(' ');
  }, [effectiveVisibleColumns, columnOptionsByKey]);

  const tableWidth = Math.max(Math.floor(bounds.width || 0), 1080);

  const renderColumnsMenu = () => (
    <Dropdown align="end">
      <Dropdown.Toggle size="sm" variant="outline-secondary">View columns</Dropdown.Toggle>
      <Dropdown.Menu style={{ minWidth: 240 }}>
        {MERCHANT_COLUMN_OPTIONS.map((col) => (
          <Dropdown.Item key={col.key} as="div" className="px-3">
            <Form.Check
              type="switch"
              id={`merchant-col-${col.key}`}
              label={col.label}
              checked={effectiveVisibleColumns.includes(col.key)}
              onChange={() =>
                setVisibleColumns((prev) => {
                  const base = prev.length ? prev : MERCHANT_DEFAULT_VISIBLE_COLUMNS;
                  if (base.includes(col.key) && base.length === 1) return base;
                  return base.includes(col.key)
                    ? base.filter((k) => k !== col.key)
                    : [...base, col.key];
                })
              }
            />
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );

  return (
    <div className="container-fluid finance-merchant-container py-3" ref={tableRef}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="small text-muted">Signed in as: <code>{currentUser?.uid || '—'}</code></span>
      </div>
      <h3>Merchants</h3>
      <p className="text-muted">Unified merchant grid with spend, cadence frequency, subscription flags, category mapping, and AI recommended actions.</p>

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
            <div className="text-muted small">Consistent with transactions: selectable columns, frequency, subscription, and story logging from AI recommendations.</div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Form.Select
              size="sm"
              value={sortColumn}
              onChange={(e) => setSortColumn(e.target.value as MerchantSortColumn)}
            >
              {MERCHANT_SORT_COLUMNS.map((column) => (
                <option key={column} value={column}>{MERCHANT_SORT_LABELS[column]}</option>
              ))}
            </Form.Select>
            <Form.Select
              size="sm"
              value={sortDirection}
              onChange={(e) => setSortDirection(e.target.value as MerchantSortDirection)}
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </Form.Select>
            {renderColumnsMenu()}
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
              <div className="merchant-header" style={{ minWidth: tableWidth, gridTemplateColumns }}>
                {effectiveVisibleColumns.includes('merchant') && renderSortableHeader('merchant', 'Merchant', 'Merchant name')}
                {effectiveVisibleColumns.includes('spend') && renderSortableHeader('spend', 'Spend', 'Total spend')}
                {effectiveVisibleColumns.includes('transactionsTotal') && renderSortableHeader('transactionsTotal', 'Tx (Total)', 'Total transactions')}
                {effectiveVisibleColumns.includes('transactions12') && renderSortableHeader('transactions12', 'Tx (12mo)', '12mo projection from cadence')}
                {effectiveVisibleColumns.includes('transactions6') && renderSortableHeader('transactions6', 'Tx (6mo)', '6mo projection from cadence')}
                {effectiveVisibleColumns.includes('frequency') && renderSortableHeader('frequency', 'Frequency', 'AI-inferred cadence')}
                {effectiveVisibleColumns.includes('category') && renderSortableHeader('category', 'Category', 'Category label to apply')}
                {effectiveVisibleColumns.includes('bucket') && renderSortableHeader('bucket', 'Bucket', 'Bucket derived from category')}
                {effectiveVisibleColumns.includes('subscription') && renderSortableHeader('subscription', 'Subscription', 'Subscription flag')}
                {effectiveVisibleColumns.includes('recommendedAction') && renderSortableHeader('recommendedAction', 'Recommended action', 'AI recommendation and story logging')}
                {effectiveVisibleColumns.includes('actions') && <span className="text-end">Actions</span>}
              </div>
              <List
                height={480}
                width={tableWidth}
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
                  const recommendedAction: FinanceActionInsight | null = m.recommendedAction || null;
                  return (
                    <div style={{ ...style, gridTemplateColumns }} className="merchant-row">
                      {effectiveVisibleColumns.includes('merchant') && (
                        <div className="merchant-cell">
                          <div className="merchant-label text-truncate">{toText(m.merchantName, 'Unknown merchant')}</div>
                          <div className="merchant-sub">{toText(m.merchantKey, 'unknown')}</div>
                          <div className="merchant-sub">Last: {m.lastTransactionISO ? new Date(m.lastTransactionISO).toLocaleDateString() : '—'}</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('spend') && (
                        <div className="merchant-cell">
                          <div className="merchant-money">{formatMoney(m.totalSpend)}</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('transactionsTotal') && (
                        <div className="merchant-cell">
                          <div className="merchant-label">{totalTx} tx</div>
                          <div className="merchant-sub">lifetime</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('transactions12') && (
                        <div className="merchant-cell">
                          <div className="merchant-label">{tx12}</div>
                          <div className="merchant-sub">12mo proj</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('transactions6') && (
                        <div className="merchant-cell">
                          <div className="merchant-label">{tx6}</div>
                          <div className="merchant-sub">6mo proj</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('frequency') && (
                        <div className="merchant-cell">
                          <div className="merchant-label">{toText(m.inferredFrequency, 'Irregular')}</div>
                          <div className="merchant-sub">AI cadence</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('category') && (
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
                            value={edits[m.merchantKey]?.label || toText(m.merchantName, toText(m.merchantKey, ''))}
                            onChange={(e) => setEdit(m.merchantKey, { label: e.target.value })}
                          />
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('bucket') && (
                        <div className="merchant-cell">
                          <div className="merchant-chip">{bucketLabel}</div>
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('subscription') && (
                        <div className="merchant-cell text-center">
                          <Form.Check
                            type="checkbox"
                            checked={edits[m.merchantKey]?.isSubscription ?? m.isSubscription ?? false}
                            onChange={(e) => setEdit(m.merchantKey, { isSubscription: e.target.checked })}
                          />
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('recommendedAction') && (
                        <div className="merchant-cell">
                          {recommendedAction ? (
                            <div className="d-flex flex-column gap-1">
                              <div className="merchant-label text-truncate" title={toText(recommendedAction.title, 'Action')}>
                                {toText(recommendedAction.title, 'Action')}
                              </div>
                              <div className="merchant-sub text-truncate" title={toText(recommendedAction.reason, '')}>
                                {toText(recommendedAction.reason, '')}
                              </div>
                              {!recommendedAction.storyId ? (
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  disabled={convertingActionId === recommendedAction.id}
                                  onClick={() => convertActionToStory(recommendedAction)}
                                >
                                  {convertingActionId === recommendedAction.id ? 'Logging…' : 'Log story'}
                                </Button>
                              ) : (
                                <a className="btn btn-sm btn-outline-secondary" href={`/stories/${recommendedAction.storyId}`}>
                                  Open story
                                </a>
                              )}
                            </div>
                          ) : (
                            <div className="merchant-sub">—</div>
                          )}
                        </div>
                      )}
                      {effectiveVisibleColumns.includes('actions') && (
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
                      )}
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
