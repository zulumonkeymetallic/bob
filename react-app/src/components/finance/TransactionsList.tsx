import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner, Dropdown, Toast, ToastContainer } from 'react-bootstrap';
import { FixedSizeList as List } from 'react-window';
import useMeasure from 'react-use-measure';
import { collection, DocumentSnapshot, getDocs, limit, orderBy, query, startAfter, where, onSnapshot, Timestamp, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_CATEGORIES, BUCKET_LABELS, getCategoryByKey, FinanceCategory, mergeFinanceCategories } from '../../utils/financeCategories';
import './TransactionsList.css';

type TxRow = {
  id: string;
  transactionId: string;
  createdISO?: string | null;
  amount: number;
  description?: string | null;
  merchant?: string | null;
  merchantLogo?: string | null;
  merchantKey?: string | null;
  userCategoryKey?: string | null;
  userCategoryLabel?: string | null;
  userCategoryType?: string | null;
  defaultCategoryLabel?: string | null;
  defaultCategoryType?: string | null;
  aiCategoryKey?: string | null;
  aiCategoryLabel?: string | null;
  aiBucket?: string | null;
  aiReduceSuggestion?: string | null;
  aiAnomalyFlag?: boolean;
  aiAnomalyReason?: string | null;
  aiAnomalyScore?: number | null;
  metadata?: Record<string, any> | null;
  potId?: string | null;
  potName?: string | null;
  displayDescription?: string | null;
  displayCategoryLabel?: string | null;
  displayBucket?: string | null;
  isPotTransfer?: boolean;
};

type DisplayRow =
  | { kind: 'group'; merchant: string; count: number; total: number }
  | { kind: 'row'; row: TxRow };

const PAGE_SIZE = 150;
const COLUMN_STORAGE_KEY = 'finance_tx_columns_v2';
const COLUMN_OPTIONS = [
  { key: 'date', label: 'Date', width: '1.1fr' },
  { key: 'merchant', label: 'Merchant', width: '1.3fr' },
  { key: 'description', label: 'Description / Pot', width: '1.8fr' },
  { key: 'bucket', label: 'Bucket', width: '1.05fr' },
  { key: 'category', label: 'Category', width: '1.7fr' },
  { key: 'aiCategory', label: 'AI Category', width: '1.3fr' },
  { key: 'aiSuggestion', label: 'AI Suggestion', width: '1.25fr' },
  { key: 'anomaly', label: 'Anomaly', width: '1.1fr' },
  { key: 'amount', label: 'Amount', width: '0.95fr' },
  { key: 'actions', label: 'Actions', width: '1.25fr' },
];
const DEFAULT_VISIBLE_COLUMNS = ['date', 'merchant', 'description', 'category', 'amount', 'actions'];
const COMPACT_COLUMN_PRIORITY = ['date', 'merchant', 'description', 'category', 'amount', 'actions'];
const NARROW_COLUMN_PRIORITY = ['date', 'merchant', 'category', 'amount', 'actions'];
const ULTRA_COMPACT_COLUMN_PRIORITY = ['date', 'merchant', 'amount', 'actions'];
type SortableColumn = 'date' | 'merchant' | 'description' | 'bucket' | 'category' | 'aiCategory' | 'aiSuggestion' | 'anomaly' | 'amount';
type SortDirection = 'asc' | 'desc';

const SORTABLE_COLUMNS: SortableColumn[] = ['date', 'merchant', 'description', 'bucket', 'category', 'aiCategory', 'aiSuggestion', 'anomaly', 'amount'];
const SORT_COLUMN_LABELS: Record<SortableColumn, string> = {
  date: 'Date',
  merchant: 'Merchant',
  description: 'Description / Pot',
  bucket: 'Bucket',
  category: 'Category',
  aiCategory: 'AI Category',
  aiSuggestion: 'AI Suggestion',
  anomaly: 'Anomaly',
  amount: 'Amount',
};
const DEFAULT_SORT_DIRECTION: Record<SortableColumn, SortDirection> = {
  date: 'desc',
  merchant: 'asc',
  description: 'asc',
  bucket: 'asc',
  category: 'asc',
  aiCategory: 'asc',
  aiSuggestion: 'asc',
  anomaly: 'desc',
  amount: 'desc',
};

const toText = (value: any, fallback = ''): string => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const candidates = [
      value.name,
      value.label,
      value.title,
      value.displayName,
      value.merchantName,
      value.categoryLabel,
      value.categoryKey,
      value.id,
      value.key,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string') {
        const trimmed = candidate.trim();
        if (trimmed) return trimmed;
      } else if (typeof candidate === 'number' || typeof candidate === 'boolean') {
        return String(candidate);
      }
    }
  }
  return fallback;
};

const toNullableText = (value: any): string | null => {
  const text = toText(value, '');
  return text || null;
};

const TransactionsList: React.FC = () => {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [pots, setPots] = useState<Record<string, { name: string; balance: number; currency: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [merchantFilter, setMerchantFilter] = useState('');
  const [descFilter, setDescFilter] = useState('');
  const [potFilter, setPotFilter] = useState('all');
  const [bucketFilter, setBucketFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [amountMin, setAmountMin] = useState<string>('');
  const [amountMax, setAmountMax] = useState<string>('');
  const [missingOnly, setMissingOnly] = useState<boolean>(false);
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'flagged' | 'normal'>('all');
  const [categorySelection, setCategorySelection] = useState<Record<string, string>>({});
  const pageAnchorsRef = React.useRef<Array<DocumentSnapshot | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortableColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [groupByMerchant, setGroupByMerchant] = useState(false);
  const [tableRef] = useMeasure();
  const [tableShellRef, shellBounds] = useMeasure();
  const [customCategories, setCustomCategories] = useState<FinanceCategory[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [dataScope, setDataScope] = useState<'page' | 'all'>('page');
  const [datasetRowCount, setDatasetRowCount] = useState(0);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [showAnomalyToast, setShowAnomalyToast] = useState(true);
  const fullDatasetMode = missingOnly || anomalyFilter !== 'all';

  const mapDocToRow = useCallback((d: any): TxRow => {
    const data = d.data() as any;
    const metadata = (data.metadata || {}) as Record<string, any>;
    const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null;
    return {
      id: d.id,
      transactionId: toText(data.transactionId, d.id),
      createdISO: createdAt ? createdAt.toISOString() : data.createdISO || null,
      amount: typeof data.amount === 'number' ? data.amount : (data.amountMinor || 0) / 100,
      description: toText(data.description || data.defaultCategoryLabel, 'Transaction'),
      merchant: toNullableText(data.merchant?.name || data.merchant || data.counterparty?.name),
      merchantLogo: toNullableText(data.merchant?.logo),
      merchantKey: toNullableText(data.merchantKey),
      userCategoryKey: toNullableText(data.userCategoryKey),
      userCategoryLabel: toNullableText(data.userCategoryLabel),
      userCategoryType: toNullableText(data.userCategoryType || data.defaultCategoryType),
      defaultCategoryLabel: toNullableText(data.defaultCategoryLabel),
      defaultCategoryType: toNullableText(data.defaultCategoryType),
      aiCategoryKey: toNullableText(data.aiCategoryKey),
      aiCategoryLabel: toNullableText(data.aiCategoryLabel),
      aiBucket: toNullableText(data.aiBucket),
      aiReduceSuggestion: toNullableText(data.aiReduceSuggestion),
      aiAnomalyFlag: !!data.aiAnomalyFlag,
      aiAnomalyReason: data.aiAnomalyReason || null,
      aiAnomalyScore: data.aiAnomalyScore || null,
      metadata,
      potId,
      potName: null,
    };
  }, []);

  const loadPage = useCallback(async (targetIndex: number) => {
    if (!currentUser) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const anchors = pageAnchorsRef.current;
      let qBase: any = query(
        collection(db, 'monzo_transactions'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('createdAt', 'desc'),
        limit(PAGE_SIZE + 1)
      );
      const anchor = anchors[targetIndex];
      if (anchor) {
        qBase = query(
          collection(db, 'monzo_transactions'),
          where('ownerUid', '==', currentUser.uid),
          orderBy('createdAt', 'desc'),
          startAfter(anchor),
          limit(PAGE_SIZE + 1)
        );
      }
      const snap = await getDocs(qBase);
      const docs = snap.docs.slice(0, PAGE_SIZE);
      setRows(docs.map(mapDocToRow));
      setDataScope('page');
      setDatasetRowCount(docs.length);
      setHasPrevPage(targetIndex > 0);
      setHasNextPage(snap.docs.length > PAGE_SIZE);
      const newAnchors = [...anchors];
      if (docs.length) {
        newAnchors[targetIndex + 1] = docs[docs.length - 1];
      }
      pageAnchorsRef.current = newAnchors.slice(0, targetIndex + 2);
      setPageIndex(targetIndex);
      setLastLoadedAt(new Date());
    } catch (err) {
      console.error('Failed to load transactions page', err);
      setErrorMsg((err as any)?.message || 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, mapDocToRow]);

  const loadAllRows = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const fullQuery = query(
        collection(db, 'monzo_transactions'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(fullQuery);
      setRows(snap.docs.map(mapDocToRow));
      pageAnchorsRef.current = [null];
      setHasPrevPage(false);
      setHasNextPage(false);
      setPageIndex(0);
      setDataScope('all');
      setDatasetRowCount(snap.size);
      setLastLoadedAt(new Date());
    } catch (err) {
      console.error('Failed to load full transactions dataset', err);
      setErrorMsg((err as any)?.message || 'Failed to load full transactions dataset.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, mapDocToRow]);

  useEffect(() => {
    if (!currentUser) return;
    if (fullDatasetMode) {
      loadAllRows();
      return;
    }
    loadPage(0);
  }, [currentUser, fullDatasetMode, loadAllRows, loadPage]);

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
        setErrorMsg((err as any)?.message || 'Missing permission to load finance categories.');
      }
    );
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const potsQuery = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      potsQuery,
      (snap) => {
        const map: Record<string, { name: string; balance: number; currency: string }> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const id = data.potId || d.id;
          if (!id) return;
          map[String(id)] = {
            name: data.name || id,
            balance: data.balance || 0,
            currency: data.currency || 'GBP',
          };
        });
        setPots(map);
      },
      (err) => {
        console.error('Failed to load Monzo pots snapshot', err);
        setErrorMsg((err as any)?.message || 'Missing permission to load Monzo pots.');
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

  const formatMoney = (v: number) => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });

  const filtered = useMemo(() => {
    const enriched = rows.map((r) => {
      const pot = r.potId ? pots[r.potId] : undefined;
      const potName = pot ? pot.name : undefined;
      const meta = r.metadata || {};
      const isPotTransfer = Boolean(r.potId);
      const isTransferToPot = Boolean(meta.destination_pot_id) || (!meta.source_pot_id && r.amount < 0);
      const transferLabel = potName ? `Transfer ${isTransferToPot ? 'to' : 'from'} ${potName}` : null;
      const displayDescription =
        transferLabel && toText(r.description, '').startsWith('pot_') ? transferLabel : toText(r.description, 'Transaction');
      const displayCategoryLabel = transferLabel || toNullableText(r.aiCategoryLabel || r.userCategoryLabel || r.defaultCategoryLabel);
      const displayBucket = isPotTransfer ? 'bank_transfer' : toNullableText(r.aiBucket || r.userCategoryType || r.defaultCategoryType);
      return {
        ...r,
        potName,
        displayDescription,
        displayCategoryLabel,
        displayBucket,
        isPotTransfer,
      };
    });

    const subset = enriched.filter((r) => {
      if (bucketFilter !== 'all') {
        const bucket = r.displayBucket || r.aiBucket || r.userCategoryType || (r.userCategoryKey ? r.defaultCategoryType : 'discretionary');
        if (bucket !== bucketFilter) return false;
      }
      if (categoryFilter !== 'all') {
        if ((r.userCategoryKey || '').toLowerCase() !== categoryFilter.toLowerCase()) return false;
      }
      if (potFilter !== 'all' && (r.potId || '') !== potFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${toText(r.description, '')} ${toText(r.merchant, '')} ${toText(r.userCategoryLabel, '')} ${toText(r.aiCategoryLabel, '')} ${toText(r.displayCategoryLabel, '')} ${toText(r.aiReduceSuggestion, '')} ${toText(r.potName, '')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (merchantFilter.trim() && !toText(r.merchant, '').toLowerCase().includes(merchantFilter.toLowerCase())) return false;
      if (descFilter.trim() && !toText(r.displayDescription || r.description, '').toLowerCase().includes(descFilter.toLowerCase())) return false;
      if (missingOnly && toText(r.userCategoryKey, '')) return false;
      if (anomalyFilter === 'flagged' && !r.aiAnomalyFlag) return false;
      if (anomalyFilter === 'normal' && r.aiAnomalyFlag) return false;
      const amt = Math.abs(r.amount);
      if (amountMin && amt < Number(amountMin)) return false;
      if (amountMax && amt > Number(amountMax)) return false;
      return true;
    });

    const sortableValue = (row: TxRow, key: SortableColumn): number | string => {
      const selectedCategoryKey = categorySelection[row.id] ?? row.userCategoryKey ?? (row.isPotTransfer ? 'pot_transfer' : '');
      const selectedCategoryLabel = selectedCategoryKey
        ? getCategoryByKey(selectedCategoryKey, allCategories)?.label || selectedCategoryKey
        : '';
      const bucketKey = row.displayBucket || row.aiBucket || row.userCategoryType || row.defaultCategoryType || 'unknown';
      const bucketLabel = BUCKET_LABELS[bucketKey as keyof typeof BUCKET_LABELS] || bucketKey || 'unknown';

      if (key === 'date') return row.createdISO ? new Date(row.createdISO).getTime() : 0;
      if (key === 'merchant') return toText(row.merchant, '').toLowerCase();
      if (key === 'description') return toText(row.displayDescription || row.description, '').toLowerCase();
      if (key === 'bucket') return bucketLabel.toLowerCase();
      if (key === 'category') return selectedCategoryLabel.toLowerCase();
      if (key === 'aiCategory') return toText(row.displayCategoryLabel || row.aiCategoryLabel || row.aiCategoryKey, '').toLowerCase();
      if (key === 'aiSuggestion') return toText(row.aiReduceSuggestion, '').toLowerCase();
      if (key === 'anomaly') return row.aiAnomalyFlag ? (row.aiAnomalyScore || 1) : 0;
      return Math.abs(row.amount || 0);
    };

    const sorted = [...subset].sort((a, b) => {
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
  }, [
    rows,
    bucketFilter,
    search,
    pots,
    categoryFilter,
    potFilter,
    merchantFilter,
    descFilter,
    missingOnly,
    anomalyFilter,
    amountMin,
    amountMax,
    allCategories,
    categorySelection,
    sortColumn,
    sortDirection,
  ]);

  const visibleColumnOptions = useMemo(() => {
    const map = new Map<string, { key: string; label: string; width: string }>();
    COLUMN_OPTIONS.forEach((c) => map.set(c.key, c));
    return map;
  }, []);

  const availableTableWidth = Math.floor(shellBounds.width || 0);
  const compactLevel: 'full' | 'narrow' | 'ultra' = useMemo(() => {
    if (availableTableWidth > 0 && availableTableWidth < 1060) return 'ultra';
    if (availableTableWidth > 0 && availableTableWidth < 1360) return 'narrow';
    return 'full';
  }, [availableTableWidth]);
  const effectiveVisibleColumns = useMemo(() => {
    const base = visibleColumns.length ? visibleColumns : DEFAULT_VISIBLE_COLUMNS;
    if (compactLevel === 'full') return base;
    const priority = compactLevel === 'ultra' ? ULTRA_COMPACT_COLUMN_PRIORITY : NARROW_COLUMN_PRIORITY;
    const compact = priority.filter((key) => base.includes(key));
    if (compact.length) return compact;
    return compactLevel === 'ultra' ? ULTRA_COMPACT_COLUMN_PRIORITY : COMPACT_COLUMN_PRIORITY;
  }, [compactLevel, visibleColumns]);

  const gridTemplateColumns = useMemo(() => {
    const widths = effectiveVisibleColumns
      .map((key) => visibleColumnOptions.get(key)?.width)
      .filter(Boolean) as string[];
    const sized = widths.length ? widths : COLUMN_OPTIONS.map((c) => c.width);
    return sized.map((width) => `minmax(0, ${width})`).join(' ');
  }, [effectiveVisibleColumns, visibleColumnOptions]);

  useEffect(() => {
    try {
      localStorage.setItem(COLUMN_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch { }
  }, [visibleColumns]);

  useEffect(() => {
    if (!currentUser) return;
    const dismissedKey = `${COLUMN_STORAGE_KEY}_anomaly_toast_${currentUser.uid}`;
    const dismissed = localStorage.getItem(dismissedKey);
    if (dismissed) setShowAnomalyToast(false);
  }, [currentUser]);

  const dismissAnomalyToast = () => {
    if (currentUser) {
      localStorage.setItem(`${COLUMN_STORAGE_KEY}_anomaly_toast_${currentUser.uid}`, String(Date.now()));
    }
    setShowAnomalyToast(false);
  };

  const mapBucketToType = (bucket: string) => {
    if (bucket === 'mandatory' || bucket === 'debt_repayment' || bucket === 'bank_transfer') return 'mandatory';
    if (bucket === 'discretionary') return 'discretionary';
    if (bucket?.includes('saving') || bucket === 'investment') return 'savings';
    if (bucket === 'net_salary' || bucket === 'irregular_income') return 'income';
    return 'discretionary';
  };

  const bucketLabelFromCategory = (categoryKey?: string | null, fallbackType?: string | null) => {
    if (categoryKey) {
      const cat = getCategoryByKey(categoryKey, allCategories);
      if (cat) return BUCKET_LABELS[cat.bucket];
    }
    if (fallbackType && BUCKET_LABELS[fallbackType as keyof typeof BUCKET_LABELS]) {
      return BUCKET_LABELS[fallbackType as keyof typeof BUCKET_LABELS];
    }
    return 'Unknown';
  };

  const displayRows: DisplayRow[] = useMemo(() => {
    if (!groupByMerchant) {
      return filtered.map((r) => ({ kind: 'row', row: r }));
    }
    const groups = filtered.reduce<Record<string, { merchant: string; count: number; total: number; rows: TxRow[] }>>(
      (acc, r) => {
        const key = r.merchant || 'Unknown';
        if (!acc[key]) acc[key] = { merchant: key, count: 0, total: 0, rows: [] };
        acc[key].count += 1;
        acc[key].total += r.amount;
        acc[key].rows.push(r);
        return acc;
      },
      {}
    );
    const ordered: DisplayRow[] = [];
    Object.values(groups)
      .sort((a, b) => a.merchant.localeCompare(b.merchant))
      .forEach((g) => {
        ordered.push({ kind: 'group', merchant: g.merchant, count: g.count, total: g.total });
        g.rows.forEach((r) => ordered.push({ kind: 'row', row: r }));
      });
    return ordered;
  }, [filtered, groupByMerchant]);

  const updateTransactionCategory = async (tx: TxRow, categoryKey: string, applyToExisting: boolean) => {
    if (!currentUser) return;
    if (!categoryKey) {
      setErrorMsg('Select a category before saving.');
      return;
    }
    const cat = allCategories.find((c) => c.key === categoryKey);
    const bucket = cat?.bucket || 'discretionary';
    setSavingId(tx.id);
    setErrorMsg('');
    try {
      const override = httpsCallable(functions, 'setTransactionCategoryOverride');
      await override({
        transactionId: tx.transactionId,
        docId: tx.id,
        categoryKey,
        categoryLabel: cat?.label || categoryKey,
        categoryType: mapBucketToType(bucket),
      });

      if (tx.merchantKey || tx.merchant) {
        const mapFn = httpsCallable(functions, 'setMerchantMapping');
        await mapFn({
          merchantKey: tx.merchantKey,
          merchantName: tx.merchant,
          categoryKey,
          categoryLabel: cat?.label || categoryKey,
          categoryType: mapBucketToType(bucket),
          applyToExisting,
        });
      }
      if (fullDatasetMode) await loadAllRows();
      else await loadPage(pageIndex);
    } catch (err) {
      console.error('Failed to update category', err);
      setErrorMsg((err as any)?.message || 'Failed to update category');
    } finally {
      setSavingId(null);
    }
  };

  if (!currentUser) {
    return <Alert variant="warning" className="m-3">Sign in to view transactions.</Alert>;
  }

  const toggleHeaderSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortColumn(column);
    setSortDirection(DEFAULT_SORT_DIRECTION[column]);
  };

  const sortIndicator = (column: SortableColumn) => {
    if (sortColumn !== column) return '↕';
    return sortDirection === 'asc' ? '↑' : '↓';
  };

  const renderSortHeader = (column: SortableColumn, endAligned = false) => (
    <button
      type="button"
      className={`finance-sort-header${endAligned ? ' finance-sort-header--end' : ''}${sortColumn === column ? ' is-active' : ''}`}
      onClick={() => toggleHeaderSort(column)}
    >
      <span>{SORT_COLUMN_LABELS[column]}</span>
      <span className="finance-sort-indicator">{sortIndicator(column)}</span>
    </button>
  );

  const tableWidth = Math.max(availableTableWidth - 2, 320);

  const renderCategoryControl = (tx: TxRow, currentKey: string) => {
    return (
      <div className="finance-category-control">
        <Form.Select
          size="sm"
          className="finance-input"
          value={currentKey}
          onChange={(e) => setCategorySelection((prev) => ({ ...prev, [tx.id]: e.target.value }))}
        >
          <option value="">Select category</option>
          {Object.entries(categoriesByBucket).map(([bucket, cats]) => (
            <optgroup key={bucket} label={BUCKET_LABELS[bucket as keyof typeof BUCKET_LABELS]}>
              {cats.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </optgroup>
          ))}
        </Form.Select>
      </div>
    );
  };

  const refreshSnapshot = () => {
    if (fullDatasetMode) {
      loadAllRows();
      return;
    }
    loadPage(pageIndex);
  };

  const renderColumnsMenu = () => (
    <Dropdown align="end">
      <Dropdown.Toggle size="sm" variant="outline-secondary">View columns</Dropdown.Toggle>
      <Dropdown.Menu style={{ minWidth: 220 }}>
        {COLUMN_OPTIONS.map((col) => (
          <Dropdown.Item key={col.key} as="div" className="px-3">
            <Form.Check
              type="switch"
              id={`col-${col.key}`}
              label={col.label}
              checked={visibleColumns.includes(col.key)}
              onChange={() =>
                setVisibleColumns((prev) => {
                  if (prev.includes(col.key) && prev.length === 1) return prev;
                  return prev.includes(col.key)
                    ? prev.filter((k) => k !== col.key)
                    : [...prev, col.key];
                })
              }
            />
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );

  return (
    <div className="finance-table-page">
      <div className="container-fluid finance-table-container" ref={tableRef}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="small text-muted">Signed in as: <code>{currentUser.uid}</code></span>
        </div>
        <div className="d-flex flex-wrap justify-content-between align-items-center mb-3">
          <div>
            <h3 className="mb-1">Monzo Transactions</h3>
            <div className="text-muted">
              Modern virtualized table with grouping, filters, and 150/page pagination. `Missing category` and anomaly
              filters automatically switch to all-record mode so they scan your full transaction history.
            </div>
          </div>
          <div className="d-flex flex-wrap gap-2 align-items-center text-muted small">
            <span className="finance-chip subtle">Virtualized</span>
            <span className="finance-chip subtle">{loading ? 'Refreshing snapshot…' : 'Snapshot ready'}</span>
            {lastLoadedAt ? (
              <span className="small text-muted">
                Loaded {lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <Button size="sm" variant="outline-secondary" disabled={loading} onClick={refreshSnapshot}>
              Refresh snapshot
            </Button>
          </div>
        </div>

        <Card className="finance-filter-card mb-3 shadow-sm border-0">
          <Card.Body className="p-3">
            <Row className="g-3 mb-2">
              <Col md={4}>
                <Form.Label className="text-muted small">Bucket</Form.Label>
                <Form.Select size="sm" className="finance-input" value={bucketFilter} onChange={(e) => setBucketFilter(e.target.value)}>
                  <option value="all">All buckets</option>
                  <option value="mandatory">Mandatory</option>
                  <option value="discretionary">Discretionary</option>
                  <option value="savings">Savings</option>
                  <option value="income">Income</option>
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label className="text-muted small">Category</Form.Label>
                <Form.Select size="sm" className="finance-input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="all">All categories</option>
                  {allCategories.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label className="text-muted small">Pot</Form.Label>
                <Form.Select size="sm" className="finance-input" value={potFilter} onChange={(e) => setPotFilter(e.target.value)}>
                  <option value="all">All pots</option>
                  {Object.entries(pots).map(([id, pot]) => (
                    <option key={id} value={id}>{pot.name}</option>
                  ))}
                </Form.Select>
              </Col>
            </Row>

            <Row className="g-3 align-items-end">
              <Col md={4}>
                <Form.Label className="text-muted small">Search</Form.Label>
                <InputGroup size="sm">
                  <InputGroup.Text>🔍</InputGroup.Text>
                  <Form.Control
                    className="finance-input"
                    placeholder="Description / merchant / category"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </InputGroup>
              </Col>
              <Col md={3}>
                <Form.Label className="text-muted small">Merchant</Form.Label>
                <Form.Control
                  size="sm"
                  className="finance-input"
                  placeholder="Filter merchant"
                  value={merchantFilter}
                  onChange={(e) => setMerchantFilter(e.target.value)}
                />
              </Col>
              <Col md={3}>
                <Form.Label className="text-muted small">Description</Form.Label>
                <Form.Control
                  size="sm"
                  className="finance-input"
                  placeholder="Filter description"
                  value={descFilter}
                  onChange={(e) => setDescFilter(e.target.value)}
                />
              </Col>
              <Col md={2} className="d-flex align-items-center gap-2">
                <div className="w-100">
                  <Form.Label className="text-muted small">Anomaly</Form.Label>
                  <Form.Select
                    size="sm"
                    className="finance-input"
                    value={anomalyFilter}
                    onChange={(e) => setAnomalyFilter(e.target.value as 'all' | 'flagged' | 'normal')}
                  >
                    <option value="all">All transactions</option>
                    <option value="flagged">Flagged only</option>
                    <option value="normal">Non-flagged only</option>
                  </Form.Select>
                  <Form.Check
                    className="mt-2"
                    type="switch"
                    id="missing-only"
                    label="Missing category"
                    checked={missingOnly}
                    onChange={(e) => setMissingOnly(e.target.checked)}
                  />
                </div>
              </Col>
            </Row>

            <Row className="g-3 align-items-end mt-1">
              <Col md={3}>
                <Form.Label className="text-muted small">Min amount</Form.Label>
                <Form.Control
                  size="sm"
                  className="finance-input"
                  placeholder="e.g. 5"
                  value={amountMin}
                  onChange={(e) => setAmountMin(e.target.value)}
                />
              </Col>
              <Col md={3}>
                <Form.Label className="text-muted small">Max amount</Form.Label>
                <Form.Control
                  size="sm"
                  className="finance-input"
                  placeholder="e.g. 500"
                  value={amountMax}
                  onChange={(e) => setAmountMax(e.target.value)}
                />
              </Col>
              <Col md={3}>
                <Form.Label className="text-muted small">Sort</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Select
                    size="sm"
                    className="finance-input"
                    value={sortColumn}
                    onChange={(e) => setSortColumn(e.target.value as SortableColumn)}
                  >
                    {SORTABLE_COLUMNS.map((column) => (
                      <option key={column} value={column}>{SORT_COLUMN_LABELS[column]}</option>
                    ))}
                  </Form.Select>
                  <Form.Select
                    size="sm"
                    className="finance-input"
                    value={sortDirection}
                    onChange={(e) => setSortDirection(e.target.value as SortDirection)}
                  >
                    <option value="asc">Asc</option>
                    <option value="desc">Desc</option>
                  </Form.Select>
                </div>
              </Col>
              <Col md={3} className="d-flex align-items-center gap-3 justify-content-end">
                <Form.Check
                  type="switch"
                  id="group-merchant"
                  label="Group by merchant"
                  checked={groupByMerchant}
                  onChange={(e) => setGroupByMerchant(e.target.checked)}
                />
                {!fullDatasetMode ? (
                  <div className="d-flex align-items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      disabled={!hasPrevPage || loading}
                      onClick={() => loadPage(Math.max(0, pageIndex - 1))}
                    >
                      ◀ Prev
                    </Button>
                    <span className="small text-muted">Page {pageIndex + 1}</span>
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      disabled={!hasNextPage || loading}
                      onClick={() => loadPage(pageIndex + 1)}
                    >
                      Next ▶
                    </Button>
                  </div>
                ) : (
                  <span className="small text-muted">All-record mode (pagination off)</span>
                )}
              </Col>
            </Row>
        </Card.Body>
      </Card>

        <Card className="finance-table-card shadow-sm border-0">
          <div className="finance-table-meta d-flex justify-content-between align-items-center">
            <div className="small text-muted">
              {dataScope === 'all'
                ? `Full dataset loaded: ${datasetRowCount.toLocaleString()} transactions`
                : `Showing up to ${PAGE_SIZE} rows per page`}
            </div>
          <div className="d-flex align-items-center gap-3">
            {errorMsg && <span className="text-danger small">{errorMsg}</span>}
            {!loading && lastLoadedAt ? (
              <span className="small text-muted">
                Snapshot loaded {lastLoadedAt.toLocaleDateString()} {lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            {loading && <div className="small text-muted">Loading snapshot… (you can still edit rows)</div>}
          </div>
        </div>
        <div className="finance-table-shell" ref={tableShellRef}>
          <div className="finance-grid-toolbar">
            <div className="small text-muted">
              {compactLevel !== 'full'
                ? `Compact column mode (${compactLevel}) enabled for laptop widths. Expand window to show more columns.`
                : `${effectiveVisibleColumns.length} columns visible`}
            </div>
            {renderColumnsMenu()}
          </div>
          <div className="finance-grid-header" style={{ gridTemplateColumns }}>
            {effectiveVisibleColumns.includes('date') && renderSortHeader('date')}
            {effectiveVisibleColumns.includes('merchant') && renderSortHeader('merchant')}
            {effectiveVisibleColumns.includes('description') && renderSortHeader('description')}
            {effectiveVisibleColumns.includes('bucket') && renderSortHeader('bucket')}
            {effectiveVisibleColumns.includes('category') && renderSortHeader('category')}
            {effectiveVisibleColumns.includes('aiCategory') && renderSortHeader('aiCategory')}
            {effectiveVisibleColumns.includes('aiSuggestion') && renderSortHeader('aiSuggestion')}
            {effectiveVisibleColumns.includes('anomaly') && renderSortHeader('anomaly')}
            {effectiveVisibleColumns.includes('amount') && renderSortHeader('amount', true)}
            {effectiveVisibleColumns.includes('actions') && <span className="text-end">Actions</span>}
          </div>
          {!loading && displayRows.length === 0 ? (
            <div className="finance-empty">No transactions match your filters.</div>
          ) : null}
          {displayRows.length > 0 && (
            <div className="finance-list-wrapper">
              <List
                  height={580}
                  width={tableWidth}
                  itemCount={displayRows.length}
                  itemSize={92}
                  itemKey={(index) => {
                    const item = displayRows[index];
                    return item.kind === 'group' ? `group-${item.merchant}` : item.row.id;
                  }}
                >
                  {({ index, style }) => {
                    const item = displayRows[index];
                    if (item.kind === 'group') {
                      return (
                        <div style={{ ...style, gridTemplateColumns: '1fr' }} className="finance-row finance-row-group">
                          <div>
                            <div className="finance-label">{item.merchant}</div>
                            <div className="finance-subtext">{item.count} tx • {formatMoney(item.total)}</div>
                          </div>
                        </div>
                      );
                    }
                    const tx = item.row;
                    const selectedKey = categorySelection[tx.id] ?? tx.userCategoryKey ?? (tx.isPotTransfer ? 'pot_transfer' : '');
                    const effectiveCategory = categorySelection[tx.id] || tx.userCategoryKey || (tx.isPotTransfer ? 'pot_transfer' : '');
                    const hasCategory = Boolean(effectiveCategory);
                    const created = tx.createdISO ? new Date(tx.createdISO) : null;
                    const dateLabel = created ? created.toLocaleDateString() : '—';
                    const timeLabel = created ? created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const amountClass = tx.amount < 0 ? 'finance-amount negative' : 'finance-amount positive';
                    const anomalyLabel = tx.aiAnomalyFlag ? 'Anomaly' : '—';
                    return (
                      <div style={{ ...style, gridTemplateColumns }} className={`finance-row${tx.aiAnomalyFlag ? ' finance-row--anomaly' : ''}`}>
                        {effectiveVisibleColumns.includes('date') && (
                          <div className="finance-cell">
                          <div className="finance-label">{dateLabel}</div>
                          <div className="finance-subtext">{timeLabel}</div>
                        </div>
                        )}
                        {effectiveVisibleColumns.includes('merchant') && (
                          <div className="finance-cell">
                          <div className="d-flex align-items-center gap-2">
                            {tx.merchantLogo ? (
                              <img src={tx.merchantLogo} alt="" width={28} height={28} className="rounded-circle" />
                            ) : (
                              <div className="finance-avatar-placeholder" />
                            )}
                            <div>
                              <div className="finance-label">{toText(tx.merchant, '—')}</div>
                              <div className="finance-subtext">{toText(tx.merchantKey, '—')}</div>
                            </div>
                          </div>
                        </div>
                        )}
                        {effectiveVisibleColumns.includes('description') && (
                          <div className="finance-cell">
                          <div className="finance-label text-truncate" title={toText(tx.displayDescription || tx.description, 'Transaction')}>
                            {toText(tx.displayDescription || tx.description, 'Transaction')}
                          </div>
                          <div className="finance-subtext">{toText(tx.potName, 'No pot')}</div>
                        </div>
                        )}
                        {effectiveVisibleColumns.includes('bucket') && (
                          <div className="finance-cell">
                            <div className="finance-chip subtle">
                              {bucketLabelFromCategory(
                                selectedKey || tx.aiCategoryKey || tx.userCategoryKey,
                                tx.displayBucket || tx.aiBucket || tx.userCategoryType || tx.defaultCategoryType
                              )}
                            </div>
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('category') && (
                          <div className="finance-cell">
                            {renderCategoryControl(tx, selectedKey)}
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('aiCategory') && (
                          <div className="finance-cell">
                            <div className="finance-label">{toText(tx.displayCategoryLabel || tx.aiCategoryLabel || tx.aiCategoryKey, '—')}</div>
                            <div className="finance-subtext">{toText(tx.displayBucket || tx.aiBucket, 'Unassigned')}</div>
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('aiSuggestion') && (
                          <div className="finance-cell">
                            <div className="finance-subtext">{tx.aiReduceSuggestion || '—'}</div>
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('anomaly') && (
                          <div className="finance-cell">
                            <Badge bg={tx.aiAnomalyFlag ? 'danger' : 'secondary'}>{anomalyLabel}</Badge>
                            {tx.aiAnomalyReason && (
                              <div className="finance-subtext">{tx.aiAnomalyReason}</div>
                            )}
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('amount') && (
                          <div className="finance-cell text-end">
                          <div className={amountClass}>{formatMoney(tx.amount)}</div>
                        </div>
                        )}
                        {effectiveVisibleColumns.includes('actions') && (
                          <div className="finance-cell">
                          <div className="finance-actions">
                            <Button
                              size="sm"
                              className="finance-btn-save"
                              disabled={savingId === tx.id || !hasCategory}
                              onClick={() =>
                                updateTransactionCategory(
                                  tx,
                                  effectiveCategory,
                                  false
                                )
                              }
                            >
                              {savingId === tx.id ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              className="finance-btn-apply"
                              disabled={savingId === tx.id || !hasCategory}
                              onClick={() =>
                                updateTransactionCategory(
                                  tx,
                                  effectiveCategory,
                                  true
                                )
                              }
                            >
                              Apply
                            </Button>
                          </div>
                        </div>
                        )}
                      </div>
                    );
                  }}
                </List>
              </div>
            )}
          </div>
        </Card>
      </div>
      <ToastContainer position="top-end" className="p-3">
        <Toast show={showAnomalyToast && filtered.some((r) => r.aiAnomalyFlag)} onClose={dismissAnomalyToast} delay={12000} autohide>
          <Toast.Header closeButton>
            <strong className="me-auto">Spend Anomalies</strong>
            <small>Last 90 days</small>
          </Toast.Header>
          <Toast.Body>
            {filtered.filter((r) => r.aiAnomalyFlag).length} anomalous transactions flagged. Review the table for details.
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </div>
  );
};

export default TransactionsList;
