import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner, Dropdown, Toast, ToastContainer } from 'react-bootstrap';
import { FixedSizeList as List } from 'react-window';
import useMeasure from 'react-use-measure';
import { collection, getDocs, orderBy, query, where, onSnapshot, Timestamp, doc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { BUCKET_LABELS, getCategoryByKey, FinanceCategory, mergeFinanceCategories } from '../../utils/financeCategories';
import {
  buildActionLookup,
  buildCadenceByMerchant,
  FinanceActionInsight,
  getActionForMerchant,
  isWithinLastYear,
  resolveMerchantKey,
} from './financeInsights';
import './TransactionsList.css';

type TxRow = {
  id: string;
  transactionId: string;
  createdISO?: string | null;
  createdAt?: any;
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
  isSubscription?: boolean;
};

type DisplayRow =
  | { kind: 'group'; merchant: string; count: number; total: number }
  | { kind: 'row'; row: any };

type ExternalTransactionsFilters = {
  dateStartISO?: string | null;
  dateEndISO?: string | null;
  bucket?: string | null;
  category?: string | null;
  merchant?: string | null;
  missingOnly?: boolean | null;
  anomaly?: 'all' | 'flagged' | 'normal' | null;
  subscriptionOnly?: boolean | null;
  action?: 'all' | 'with' | 'without' | null;
};

type ExternalMatchSummary = {
  sources: string[];
  label: string;
};

const DEFAULT_WINDOW_DAYS = 90;
const FILTERED_WINDOW_DAYS = 365;
const COLUMN_STORAGE_KEY = 'finance_tx_columns_v2';
const COLUMN_OPTIONS = [
  { key: 'date', label: 'Date', width: '1.1fr' },
  { key: 'merchant', label: 'Merchant', width: '1.3fr' },
  { key: 'description', label: 'Description / Pot', width: '1.8fr' },
  { key: 'bucket', label: 'Bucket', width: '1.05fr' },
  { key: 'category', label: 'Category', width: '1.7fr' },
  { key: 'aiCategory', label: 'AI Category', width: '1.3fr' },
  { key: 'frequency', label: 'Frequency', width: '1fr' },
  { key: 'nextPredicted', label: 'Next predicted', width: '1.15fr' },
  { key: 'subscription', label: 'Subscription', width: '0.95fr' },
  { key: 'linkedExternal', label: 'Card linked', width: '1.05fr' },
  { key: 'aiSuggestion', label: 'AI Suggestion', width: '1.25fr' },
  { key: 'recommendedAction', label: 'Recommended action', width: '1.55fr' },
  { key: 'anomaly', label: 'Anomaly', width: '1.1fr' },
  { key: 'amount', label: 'Amount', width: '0.95fr' },
  { key: 'actions', label: 'Actions', width: '1.25fr' },
];
const DEFAULT_VISIBLE_COLUMNS = ['date', 'merchant', 'description', 'category', 'frequency', 'nextPredicted', 'subscription', 'linkedExternal', 'recommendedAction', 'amount', 'actions'];
const COMPACT_COLUMN_PRIORITY = ['date', 'merchant', 'description', 'category', 'frequency', 'nextPredicted', 'subscription', 'linkedExternal', 'recommendedAction', 'amount', 'actions'];
const NARROW_COLUMN_PRIORITY = ['date', 'merchant', 'category', 'frequency', 'nextPredicted', 'subscription', 'linkedExternal', 'recommendedAction', 'amount', 'actions'];
const ULTRA_COMPACT_COLUMN_PRIORITY = ['date', 'merchant', 'amount', 'actions'];
type SortableColumn = 'date' | 'merchant' | 'description' | 'bucket' | 'category' | 'aiCategory' | 'frequency' | 'nextPredicted' | 'subscription' | 'linkedExternal' | 'aiSuggestion' | 'recommendedAction' | 'anomaly' | 'amount';
type SortDirection = 'asc' | 'desc';

const SORTABLE_COLUMNS: SortableColumn[] = ['date', 'merchant', 'description', 'bucket', 'category', 'aiCategory', 'frequency', 'nextPredicted', 'subscription', 'linkedExternal', 'aiSuggestion', 'recommendedAction', 'anomaly', 'amount'];
const SORT_COLUMN_LABELS: Record<SortableColumn, string> = {
  date: 'Date',
  merchant: 'Merchant',
  description: 'Description / Pot',
  bucket: 'Bucket',
  category: 'Category',
  aiCategory: 'AI Category',
  frequency: 'Frequency',
  nextPredicted: 'Next predicted',
  subscription: 'Subscription',
  linkedExternal: 'Card linked',
  aiSuggestion: 'AI Suggestion',
  recommendedAction: 'Recommended action',
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
  frequency: 'asc',
  nextPredicted: 'asc',
  subscription: 'desc',
  linkedExternal: 'desc',
  aiSuggestion: 'asc',
  recommendedAction: 'asc',
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

type TransactionsListProps = {
  embedded?: boolean;
  externalFilters?: ExternalTransactionsFilters;
  autoCollapseFilters?: boolean;
};

const normalizeBucketFilterValue = (value: string | null | undefined): string => {
  const normalized = toText(value, '').toLowerCase().replace(/\s+/g, '_');
  if (!normalized || normalized === 'all') return 'all';
  if (normalized === 'optional') return 'discretionary';
  if (normalized === 'debt_repayment' || normalized === 'bank_transfer') return 'mandatory';
  if (normalized.includes('saving') || normalized === 'investment') return 'savings';
  if (normalized === 'net_salary' || normalized === 'irregular_income') return 'income';
  return normalized;
};

const parseRowDateMs = (row: { createdISO?: string | null; createdAt?: any }): number | null => {
  if (row.createdISO) {
    const parsed = Date.parse(row.createdISO);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const createdAt = row.createdAt;
  if (createdAt?.toMillis) return createdAt.toMillis();
  if (createdAt?.toDate) {
    const dt = createdAt.toDate();
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) return dt.getTime();
  }
  if (createdAt?._seconds) return createdAt._seconds * 1000;
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) return createdAt;
  if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
};

const shouldExcludeFromAiAndSubscriptionAnalysis = (
  row: Partial<TxRow> & { displayBucket?: string | null; isPotTransfer?: boolean }
): boolean => {
  if (row.isPotTransfer) return true;
  const rawBucket = toText(
    row.displayBucket || row.aiBucket || row.userCategoryType || row.defaultCategoryType,
    ''
  ).toLowerCase();
  if (rawBucket === 'bank_transfer' || rawBucket === 'investment') return true;
  if (normalizeBucketFilterValue(rawBucket) === 'mandatory') return true;

  const categoryKey = toText(row.userCategoryKey || row.aiCategoryKey, '').toLowerCase();
  return categoryKey === 'investment' || categoryKey === 'bank_transfer' || categoryKey === 'pot_transfer';
};

const SUBSCRIPTION_KEYWORDS = /(subscription|membership|renewal|monthly|annual|prime|netflix|spotify|apple|icloud|adobe|notion|dropbox|patreon|youtube|chatgpt|openai|gym|xbox|playstation)/i;
const NON_SUBSCRIPTION_CATEGORY_HINTS = /(eating_out|eat|dining|restaurant|takeaway|coffee|grocer|transport|fuel|shopping)/i;

const buildSubscriptionSuggestion = (
  row: TxRow,
  cadence: any,
  excludedFromAnalysis: boolean
): { suggested: boolean; reason: string } => {
  if (excludedFromAnalysis) return { suggested: false, reason: '' };
  if (Number(row.amount || 0) >= 0) return { suggested: false, reason: '' };
  if (row.isSubscription) return { suggested: true, reason: 'Saved subscription flag' };

  const categoryText = `${toText(row.userCategoryKey, '')} ${toText(row.aiCategoryKey, '')} ${toText(row.userCategoryLabel, '')} ${toText(row.aiCategoryLabel, '')}`.toLowerCase();
  const text = `${toText(row.merchant, '')} ${toText(row.description, '')}`.toLowerCase();
  const keywordMatch = SUBSCRIPTION_KEYWORDS.test(text);
  const likelyFoodOrOneOffCategory = NON_SUBSCRIPTION_CATEGORY_HINTS.test(categoryText);
  const predictableCadence = Boolean(cadence && ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'].includes(String(cadence.frequencyKey || '')) && Number(cadence.txCount || 0) >= 2);
  const cadenceSuggestion = Boolean(cadence?.likelySubscription) && !likelyFoodOrOneOffCategory;

  if (keywordMatch && predictableCadence) {
    return { suggested: true, reason: 'Keyword + recurring cadence' };
  }
  if (cadenceSuggestion) {
    return { suggested: true, reason: 'Recurring cadence pattern' };
  }
  return { suggested: false, reason: '' };
};

const toSourceLabel = (source: string) => {
  const normalized = toText(source, '').toLowerCase();
  if (normalized === 'paypal') return 'PayPal';
  if (normalized === 'barclays') return 'Barclays';
  if (normalized) return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  return 'Card';
};

const TransactionsList: React.FC<TransactionsListProps> = ({ embedded = false, externalFilters, autoCollapseFilters = false }) => {
  const { currentUser } = useAuth();
  const [rows, setRows] = useState<TxRow[]>([]);
  const [lastYearRows, setLastYearRows] = useState<TxRow[]>([]);
  const [pots, setPots] = useState<Record<string, { name: string; balance: number; currency: string }>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [convertingActionId, setConvertingActionId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [merchantFilter, setMerchantFilter] = useState('');
  const [descFilter, setDescFilter] = useState('');
  const [potFilter, setPotFilter] = useState('all');
  const [bucketFilter, setBucketFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<'all' | 'with' | 'without'>('all');
  const [subscriptionFilter, setSubscriptionFilter] = useState<'all' | 'subscription' | 'non'>('all');
  const [amountMin, setAmountMin] = useState<string>('');
  const [amountMax, setAmountMax] = useState<string>('');
  const [missingOnly, setMissingOnly] = useState<boolean>(false);
  const [reviewAiSuggestedOnly, setReviewAiSuggestedOnly] = useState<boolean>(false);
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'flagged' | 'normal'>('all');
  const [showTransferRows, setShowTransferRows] = useState<boolean>(false);
  const [categorySelection, setCategorySelection] = useState<Record<string, string>>({});
  const [subscriptionSelection, setSubscriptionSelection] = useState<Record<string, boolean>>({});
  const [actionLookup, setActionLookup] = useState<Map<string, FinanceActionInsight>>(new Map());
  const [externalMatchesByMonzoDocId, setExternalMatchesByMonzoDocId] = useState<Map<string, ExternalMatchSummary>>(new Map());
  const [sortColumn, setSortColumn] = useState<SortableColumn>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [groupByMerchant, setGroupByMerchant] = useState(false);
  const [tableRef] = useMeasure();
  const [tableShellRef, shellBounds] = useMeasure();
  const [customCategories, setCustomCategories] = useState<FinanceCategory[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [dataScope, setDataScope] = useState<'default90' | 'filtered1y'>('default90');
  const [datasetRowCount, setDatasetRowCount] = useState(0);
  const [filtersExpanded, setFiltersExpanded] = useState<boolean>(false);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(COLUMN_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch { }
    return DEFAULT_VISIBLE_COLUMNS;
  });
  const [showAnomalyToast, setShowAnomalyToast] = useState(true);
  const hasExternalDateFilter = Boolean(externalFilters?.dateStartISO || externalFilters?.dateEndISO);
  const hasExternalScopedFilters = Boolean(
    hasExternalDateFilter ||
    (externalFilters?.bucket && normalizeBucketFilterValue(externalFilters.bucket) !== 'all') ||
    (externalFilters?.category && toText(externalFilters.category, '') !== '') ||
    (externalFilters?.merchant && toText(externalFilters.merchant, '') !== '') ||
    externalFilters?.missingOnly ||
    (externalFilters?.anomaly && externalFilters.anomaly !== 'all') ||
    externalFilters?.subscriptionOnly ||
    (externalFilters?.action && externalFilters.action !== 'all')
  );
  const hasLocalScopedFilters = Boolean(
    bucketFilter !== 'all' ||
    categoryFilter !== 'all' ||
    potFilter !== 'all' ||
    actionFilter !== 'all' ||
    subscriptionFilter !== 'all' ||
    anomalyFilter !== 'all' ||
    missingOnly ||
    reviewAiSuggestedOnly ||
    groupByMerchant ||
    showTransferRows ||
    search.trim() ||
    merchantFilter.trim() ||
    descFilter.trim() ||
    amountMin.trim() ||
    amountMax.trim()
  );
  const fullDatasetMode = hasLocalScopedFilters || hasExternalScopedFilters;

  const mapDocToRow = useCallback((d: any): TxRow => {
    const data = d.data() as any;
    const metadata = (data.metadata || {}) as Record<string, any>;
    const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null;
    return {
      id: d.id,
      transactionId: toText(data.transactionId, d.id),
      createdISO: createdAt ? createdAt.toISOString() : data.createdISO || null,
      createdAt: data.createdAt || null,
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
      isSubscription: !!data.isSubscription,
    };
  }, []);

  const loadPage = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - DEFAULT_WINDOW_DAYS);
      const scopedQuery = query(
        collection(db, 'monzo_transactions'),
        where('ownerUid', '==', currentUser.uid),
        where('createdAt', '>=', Timestamp.fromDate(cutoff)),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(scopedQuery);
      setRows(snap.docs.map(mapDocToRow));
      setDataScope('default90');
      setDatasetRowCount(snap.size);
      setLastLoadedAt(new Date());
    } catch (err) {
      console.error('Failed to load 90-day transactions dataset', err);
      setErrorMsg((err as any)?.message || 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, mapDocToRow]);

  const loadAllRows = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - FILTERED_WINDOW_DAYS);
      const fullQuery = query(
        collection(db, 'monzo_transactions'),
        where('ownerUid', '==', currentUser.uid),
        where('createdAt', '>=', Timestamp.fromDate(cutoff)),
        orderBy('createdAt', 'desc')
      );
      const snap = await getDocs(fullQuery);
      setRows(snap.docs.map(mapDocToRow));
      setDataScope('filtered1y');
      setDatasetRowCount(snap.size);
      setLastLoadedAt(new Date());
    } catch (err) {
      console.error('Failed to load 1-year transactions dataset', err);
      setErrorMsg((err as any)?.message || 'Failed to load 1-year transactions dataset.');
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
    loadPage();
  }, [currentUser, fullDatasetMode, loadAllRows, loadPage]);

  useEffect(() => {
    if (embedded || autoCollapseFilters) {
      setFiltersExpanded(false);
    }
  }, [embedded, autoCollapseFilters]);

  useEffect(() => {
    if (!externalFilters) return;
    if (externalFilters.bucket !== undefined) {
      setBucketFilter(normalizeBucketFilterValue(externalFilters.bucket));
    }
    if (externalFilters.category !== undefined) {
      const categoryValue = toText(externalFilters.category, '');
      setCategoryFilter(categoryValue || 'all');
    }
    if (externalFilters.merchant !== undefined) {
      setMerchantFilter(toText(externalFilters.merchant, ''));
    }
    if (externalFilters.missingOnly !== undefined) {
      setMissingOnly(Boolean(externalFilters.missingOnly));
    }
    if (externalFilters.anomaly !== undefined && externalFilters.anomaly !== null) {
      setAnomalyFilter(externalFilters.anomaly);
    }
    if (externalFilters.action !== undefined && externalFilters.action !== null) {
      setActionFilter(externalFilters.action);
    }
    if (externalFilters.subscriptionOnly === true) {
      setSubscriptionFilter('subscription');
    } else if (externalFilters.subscriptionOnly === false) {
      setSubscriptionFilter('all');
    }
  }, [externalFilters]);

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
        console.error('Failed to load finance actions', err);
      }
    );
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setExternalMatchesByMonzoDocId(new Map());
      return;
    }
    const matchesQuery = query(
      collection(db, 'finance_transaction_matches'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsub = onSnapshot(
      matchesQuery,
      (snap) => {
        const grouped = new Map<string, Set<string>>();
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          if (toText(data.status, '').toLowerCase() !== 'matched') return;
          const monzoDocId = toText(data.monzoDocId, '');
          if (!monzoDocId) return;
          const source = toText(data.source, 'other').toLowerCase();
          if (!grouped.has(monzoDocId)) grouped.set(monzoDocId, new Set());
          grouped.get(monzoDocId)!.add(source || 'other');
        });

        const mapped = new Map<string, ExternalMatchSummary>();
        grouped.forEach((sourcesSet, monzoDocId) => {
          const sources = Array.from(sourcesSet).sort((a, b) => a.localeCompare(b));
          mapped.set(monzoDocId, {
            sources,
            label: sources.map(toSourceLabel).join(' + '),
          });
        });
        setExternalMatchesByMonzoDocId(mapped);
      },
      (err) => {
        console.warn('Failed to load external transaction matches', err);
      }
    );
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setLastYearRows([]);
      return;
    }
    let cancelled = false;
    const loadLastYearRows = async () => {
      try {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 365);
        const snap = await getDocs(
          query(
            collection(db, 'monzo_transactions'),
            where('ownerUid', '==', currentUser.uid),
            where('createdAt', '>=', Timestamp.fromDate(cutoff)),
            orderBy('createdAt', 'desc')
          )
        );
        if (!cancelled) {
          setLastYearRows(snap.docs.map(mapDocToRow));
        }
      } catch (err) {
        console.warn('Failed to load last-year transactions for cadence analysis', err);
        if (!cancelled) setLastYearRows([]);
      }
    };
    loadLastYearRows();
    return () => {
      cancelled = true;
    };
  }, [currentUser, mapDocToRow]);

  const allCategories = useMemo(() => mergeFinanceCategories(customCategories), [customCategories]);
  const allCategoryKeys = useMemo(() => new Set(allCategories.map((category) => category.key)), [allCategories]);
  const categoryKeyByLabel = useMemo(() => {
    const map = new Map<string, string>();
    allCategories.forEach((category) => {
      const label = toText(category.label, '').toLowerCase();
      if (!label) return;
      map.set(label, category.key);
    });
    return map;
  }, [allCategories]);
  const resolveAutoCategoryKey = useCallback((row: Partial<TxRow> & { isPotTransfer?: boolean; displayCategoryLabel?: string | null }) => {
    const savedKey = toText(row.userCategoryKey, '');
    if (savedKey) return savedKey;

    const aiKey = toText(row.aiCategoryKey, '');
    if (aiKey && allCategoryKeys.has(aiKey)) return aiKey;

    const aiLabel = toText(row.aiCategoryLabel || row.displayCategoryLabel, '').toLowerCase();
    if (aiLabel && categoryKeyByLabel.has(aiLabel)) {
      return categoryKeyByLabel.get(aiLabel) || '';
    }

    if (row.isPotTransfer) return 'pot_transfer';
    return '';
  }, [allCategoryKeys, categoryKeyByLabel]);
  const cadenceByMerchant = useMemo(
    () => buildCadenceByMerchant((lastYearRows.length ? lastYearRows : rows).filter((row) => Number(row.amount) < 0)),
    [lastYearRows, rows]
  );
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
    const externalRangeStartMs = externalFilters?.dateStartISO ? Date.parse(String(externalFilters.dateStartISO)) : null;
    const externalRangeEndMs = externalFilters?.dateEndISO
      ? (Date.parse(String(externalFilters.dateEndISO)) + (24 * 60 * 60 * 1000) - 1)
      : null;
    const hasExternalRange = Number.isFinite(externalRangeStartMs) || Number.isFinite(externalRangeEndMs);
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
      const cadence = cadenceByMerchant.get(resolveMerchantKey(r));
      const inferredFrequency = cadence?.frequencyLabel || 'Irregular';
      const action = isWithinLastYear(r.createdISO) ? getActionForMerchant(actionLookup, r) : null;
      const externalMatch = externalMatchesByMonzoDocId.get(r.id) || null;
      const selectedSubscription = subscriptionSelection[r.id];
      const excludedFromAiAndSubscription = shouldExcludeFromAiAndSubscriptionAnalysis({
        ...r,
        displayBucket,
        isPotTransfer,
      });
      const subscriptionSuggestion = buildSubscriptionSuggestion(r, cadence, excludedFromAiAndSubscription);
      const subscription = selectedSubscription !== undefined
        ? selectedSubscription
        : Boolean(r.isSubscription || (!excludedFromAiAndSubscription && (cadence?.likelySubscription || subscriptionSuggestion.suggested)));

      return {
        ...r,
        potName,
        displayDescription,
        displayCategoryLabel,
        displayBucket,
        isPotTransfer,
        inferredFrequency,
        cadenceConfidence: cadence?.confidence || 0,
        nextPredictedDateISO: cadence?.nextPredictedDateISO || null,
        externalMatch,
        excludedFromAiAndSubscription,
        subscriptionSuggested: subscriptionSuggestion.suggested && !r.isSubscription,
        subscriptionSuggestionReason: subscriptionSuggestion.reason,
        recommendedAction: action,
        selectedSubscription: subscription,
      };
    });

    const subset = enriched.filter((r) => {
      if (hasExternalRange) {
        const createdMs = parseRowDateMs(r);
        if (!Number.isFinite(createdMs)) return false;
        if (Number.isFinite(externalRangeStartMs) && createdMs < Number(externalRangeStartMs)) return false;
        if (Number.isFinite(externalRangeEndMs) && createdMs > Number(externalRangeEndMs)) return false;
      }
      if (!showTransferRows) {
        const rawBucket = toText(r.displayBucket || r.aiBucket || r.userCategoryType || r.defaultCategoryType, '').toLowerCase();
        if (r.isPotTransfer || rawBucket === 'bank_transfer') return false;
      }
      if (bucketFilter !== 'all') {
        const bucket = normalizeBucketFilterValue(
          r.displayBucket || r.aiBucket || r.userCategoryType || (r.userCategoryKey ? r.defaultCategoryType : 'discretionary')
        );
        if (bucket !== normalizeBucketFilterValue(bucketFilter)) return false;
      }
      if (categoryFilter !== 'all') {
        const requested = categoryFilter.toLowerCase();
        const rowCategoryKey = toText(categorySelection[r.id] || resolveAutoCategoryKey(r), '').toLowerCase();
        const rowCategoryLabel = toText(r.displayCategoryLabel || r.userCategoryLabel || r.aiCategoryLabel, '').toLowerCase();
        if (rowCategoryKey !== requested && rowCategoryLabel !== requested) return false;
      }
      if (potFilter !== 'all' && (r.potId || '') !== potFilter) return false;
      if (actionFilter === 'with' && !r.recommendedAction) return false;
      if (actionFilter === 'without' && r.recommendedAction) return false;
      if (subscriptionFilter === 'subscription' && !r.selectedSubscription) return false;
      if (subscriptionFilter === 'non' && r.selectedSubscription) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = [
          toText(r.description, ''),
          toText(r.merchant, ''),
          toText(r.userCategoryLabel, ''),
          toText(r.aiCategoryLabel, ''),
          toText(r.displayCategoryLabel, ''),
          toText(r.aiReduceSuggestion, ''),
          toText(r.potName, ''),
          toText(r.inferredFrequency, ''),
          toText(r.recommendedAction?.title, ''),
          toText(r.recommendedAction?.reason, ''),
          toText(r.recommendedAction?.type, ''),
        ].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (merchantFilter.trim() && !toText(r.merchant, '').toLowerCase().includes(merchantFilter.toLowerCase())) return false;
      if (descFilter.trim() && !toText(r.displayDescription || r.description, '').toLowerCase().includes(descFilter.toLowerCase())) return false;
      if (missingOnly && toText(r.userCategoryKey, '')) return false;
      if (reviewAiSuggestedOnly) {
        if (r.excludedFromAiAndSubscription) return false;
        const hasSavedCategory = Boolean(toText(r.userCategoryKey, ''));
        const hasAiSuggestion = Boolean(toText(r.aiCategoryKey, '') || toText(r.aiCategoryLabel, ''));
        const suggestedCategoryKey = resolveAutoCategoryKey(r);
        if (hasSavedCategory || !hasAiSuggestion || !suggestedCategoryKey) return false;
      }
      if (anomalyFilter === 'flagged' && !r.aiAnomalyFlag) return false;
      if (anomalyFilter === 'normal' && r.aiAnomalyFlag) return false;
      const amt = Math.abs(r.amount);
      if (amountMin && amt < Number(amountMin)) return false;
      if (amountMax && amt > Number(amountMax)) return false;
      return true;
    });

    const sortableValue = (row: any, key: SortableColumn): number | string => {
      const selectedCategoryKey = categorySelection[row.id] ?? resolveAutoCategoryKey(row);
      const selectedCategoryLabel = selectedCategoryKey
        ? getCategoryByKey(selectedCategoryKey, allCategories)?.label || selectedCategoryKey
        : '';
      const bucketKey = row.displayBucket || row.aiBucket || row.userCategoryType || row.defaultCategoryType || 'unknown';
      const bucketLabel = BUCKET_LABELS[bucketKey as keyof typeof BUCKET_LABELS] || bucketKey || 'unknown';

      if (key === 'date') return parseRowDateMs(row) || 0;
      if (key === 'merchant') return toText(row.merchant, '').toLowerCase();
      if (key === 'description') return toText(row.displayDescription || row.description, '').toLowerCase();
      if (key === 'bucket') return bucketLabel.toLowerCase();
      if (key === 'category') return selectedCategoryLabel.toLowerCase();
      if (key === 'aiCategory') return toText(row.displayCategoryLabel || row.aiCategoryLabel || row.aiCategoryKey, '').toLowerCase();
      if (key === 'frequency') return toText(row.inferredFrequency, '').toLowerCase();
      if (key === 'nextPredicted') return row.nextPredictedDateISO ? Date.parse(String(row.nextPredictedDateISO)) : 0;
      if (key === 'subscription') return row.selectedSubscription ? 1 : 0;
      if (key === 'linkedExternal') return row.externalMatch ? 1 : 0;
      if (key === 'aiSuggestion') return toText(row.aiReduceSuggestion, '').toLowerCase();
      if (key === 'recommendedAction') return toText(row.recommendedAction?.title || row.recommendedAction?.reason, '').toLowerCase();
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
    actionFilter,
    merchantFilter,
    descFilter,
    missingOnly,
    reviewAiSuggestedOnly,
    anomalyFilter,
    amountMin,
    amountMax,
    showTransferRows,
    allCategories,
    categorySelection,
    subscriptionSelection,
    cadenceByMerchant,
    actionLookup,
    externalMatchesByMonzoDocId,
    externalFilters,
    sortColumn,
    sortDirection,
    subscriptionFilter,
    resolveAutoCategoryKey,
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
    if (bucket === 'discretionary') return 'optional';
    if (bucket?.includes('saving') || bucket === 'investment') return 'savings';
    if (bucket === 'net_salary' || bucket === 'irregular_income') return 'income';
    return 'optional';
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

  const updateTransactionCategory = async (tx: any, categoryKey: string, applyToExisting: boolean) => {
    if (!currentUser) return;
    if (!categoryKey) {
      setErrorMsg('Select a category before saving.');
      return;
    }
    const cat = allCategories.find((c) => c.key === categoryKey);
    const bucket = cat?.bucket || 'discretionary';
    setSavingId(tx.id);
    setErrorMsg('');
    setStatusMsg('');
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
          isSubscription: !!(subscriptionSelection[tx.id] ?? tx.selectedSubscription ?? tx.isSubscription),
          applyToExisting,
        });
      }
      if (fullDatasetMode) await loadAllRows();
      else await loadPage();
      setStatusMsg('Saved category/subscription update.');
    } catch (err) {
      console.error('Failed to update category', err);
      setErrorMsg((err as any)?.message || 'Failed to update category');
    } finally {
      setSavingId(null);
    }
  };

  const convertActionToStory = async (action: FinanceActionInsight | null) => {
    if (!action?.id) return;
    setConvertingActionId(action.id);
    setErrorMsg('');
    setStatusMsg('');
    try {
      const fn = httpsCallable(functions, 'convertFinanceActionToStory');
      const res: any = await fn({ actionId: action.id, persona: 'personal' });
      const storyId = res?.data?.storyId;
      setStatusMsg(storyId ? `Logged story ${storyId} from recommended action.` : 'Recommended action logged to story.');
    } catch (err) {
      console.error('Failed to convert recommended action to story', err);
      setErrorMsg((err as any)?.message || 'Failed to log story');
    } finally {
      setConvertingActionId(null);
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
  const listHeight = embedded ? 520 : (filtersExpanded ? 620 : 760);

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
    loadPage();
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
    <div className={`finance-table-page${embedded ? ' finance-table-page--embedded' : ''}`}>
      <div className={`container-fluid finance-table-container${embedded ? ' finance-table-container--embedded' : ''}`} ref={tableRef}>
        {!embedded && (
          <div className="d-flex justify-content-between align-items-center mb-2">
            <span className="small text-muted">Signed in as: <code>{currentUser.uid}</code></span>
          </div>
        )}
        <div className="finance-page-header d-flex flex-wrap justify-content-between align-items-center">
          <div className="finance-page-title-wrap">
            <h6 className="finance-page-title mb-0">{embedded ? 'Transactions' : 'Monzo Transactions'}</h6>
            <div className="finance-page-subtitle">
              Unified grid with category mapping, AI recommendations, subscription checks, cadence inference, and story logging.
            </div>
          </div>
          <div className="finance-page-status d-flex flex-wrap align-items-center text-muted">
            <span>Virtualized</span>
            <span>{loading ? 'Refreshing snapshot...' : 'Snapshot ready'}</span>
            {lastLoadedAt ? (
              <span>
                Loaded {lastLoadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            ) : null}
            <Button size="sm" variant="outline-secondary" disabled={loading} onClick={refreshSnapshot}>
              Refresh
            </Button>
          </div>
        </div>

        <Card className="finance-filter-card mb-3 shadow-sm border-0">
          <Card.Body className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="small text-muted">
                Filters {hasExternalScopedFilters ? 'sync with dashboard context' : 'for local transaction exploration'}
              </div>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={() => setFiltersExpanded((prev) => !prev)}
                aria-expanded={filtersExpanded}
              >
                {filtersExpanded ? '▾ Hide filters' : '▸ Show filters'}
              </Button>
            </div>
            {filtersExpanded && (
              <>
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
                    <Form.Label className="text-muted small">Recommended action</Form.Label>
                    <Form.Select
                      size="sm"
                      className="finance-input"
                      value={actionFilter}
                      onChange={(e) => setActionFilter(e.target.value as 'all' | 'with' | 'without')}
                    >
                      <option value="all">All transactions</option>
                      <option value="with">With recommendation</option>
                      <option value="without">Without recommendation</option>
                    </Form.Select>
                  </Col>
                  <Col md={3}>
                    <Form.Label className="text-muted small">Subscription</Form.Label>
                    <Form.Select
                      size="sm"
                      className="finance-input"
                      value={subscriptionFilter}
                      onChange={(e) => setSubscriptionFilter(e.target.value as 'all' | 'subscription' | 'non')}
                    >
                      <option value="all">All transactions</option>
                      <option value="subscription">Subscriptions only</option>
                      <option value="non">Non-subscriptions</option>
                    </Form.Select>
                  </Col>
                </Row>

                <Row className="g-3 align-items-end mt-1">
                  <Col md={6}>
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
                  <Col md={6} className="d-flex align-items-center gap-3 justify-content-end">
                    <Form.Check
                      type="switch"
                      id="group-merchant"
                      label="Group by merchant"
                      checked={groupByMerchant}
                      onChange={(e) => setGroupByMerchant(e.target.checked)}
                    />
                    <Form.Check
                      type="switch"
                      id="missing-only"
                      label="Missing category"
                      checked={missingOnly}
                      onChange={(e) => setMissingOnly(e.target.checked)}
                    />
                    <Form.Check
                      type="switch"
                      id="review-ai-categories"
                      label="Review AI suggested categories"
                      checked={reviewAiSuggestedOnly}
                      onChange={(e) => setReviewAiSuggestedOnly(e.target.checked)}
                    />
                    <Form.Check
                      type="switch"
                      id="show-transfer-rows"
                      label="Show pot/bank transfers"
                      checked={showTransferRows}
                      onChange={(e) => setShowTransferRows(e.target.checked)}
                    />
                  </Col>
                </Row>
              </>
            )}
        </Card.Body>
      </Card>

        <Card className="finance-table-card shadow-sm border-0">
          <div className="finance-table-meta d-flex justify-content-between align-items-center">
            <div className="small text-muted">
              {dataScope === 'filtered1y'
                ? `Filtered mode: last 12 months (${datasetRowCount.toLocaleString()} transactions loaded)`
                : `Default mode: last 90 days (${datasetRowCount.toLocaleString()} transactions loaded)`}
            </div>
          <div className="d-flex align-items-center gap-3">
            {errorMsg && <span className="text-danger small">{errorMsg}</span>}
            {statusMsg && <span className="text-success small">{statusMsg}</span>}
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
            {effectiveVisibleColumns.includes('frequency') && renderSortHeader('frequency')}
            {effectiveVisibleColumns.includes('nextPredicted') && renderSortHeader('nextPredicted')}
            {effectiveVisibleColumns.includes('subscription') && renderSortHeader('subscription')}
            {effectiveVisibleColumns.includes('linkedExternal') && renderSortHeader('linkedExternal')}
            {effectiveVisibleColumns.includes('aiSuggestion') && renderSortHeader('aiSuggestion')}
            {effectiveVisibleColumns.includes('recommendedAction') && renderSortHeader('recommendedAction')}
            {effectiveVisibleColumns.includes('anomaly') && renderSortHeader('anomaly')}
            {effectiveVisibleColumns.includes('amount') && renderSortHeader('amount', true)}
            {effectiveVisibleColumns.includes('actions') && <span className="text-end">Actions</span>}
          </div>
          {!loading && displayRows.length === 0 ? (
            <div className="finance-empty">No transactions match your filters.</div>
          ) : null}
          {displayRows.length > 0 && (
            <div className="finance-list-wrapper" style={{ height: listHeight + 40 }}>
              <List
                  height={listHeight}
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
                    const autoSuggestedCategoryKey = tx.excludedFromAiAndSubscription
                      ? toText(tx.userCategoryKey, '')
                      : resolveAutoCategoryKey(tx);
                    const selectedKey = categorySelection[tx.id] ?? autoSuggestedCategoryKey;
                    const effectiveCategory = categorySelection[tx.id] || autoSuggestedCategoryKey;
                    const hasCategory = Boolean(effectiveCategory);
                    const showsAiPreselection = Boolean(
                      !tx.excludedFromAiAndSubscription &&
                      !tx.userCategoryKey &&
                      !categorySelection[tx.id] &&
                      (tx.aiCategoryKey || tx.aiCategoryLabel) &&
                      selectedKey
                    );
                    const created = tx.createdISO ? new Date(tx.createdISO) : null;
                    const dateLabel = created ? created.toLocaleDateString() : '—';
                    const timeLabel = created ? created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const amountClass = tx.amount < 0 ? 'finance-amount negative' : 'finance-amount positive';
                    const anomalyLabel = tx.aiAnomalyFlag ? 'Anomaly' : '—';
                    const recommendedAction: FinanceActionInsight | null = tx.recommendedAction || null;
                    const selectedSubscription = subscriptionSelection[tx.id] !== undefined
                      ? subscriptionSelection[tx.id]
                      : !!tx.selectedSubscription;
                    const rowClassName = [
                      'finance-row',
                      tx.aiAnomalyFlag ? 'finance-row--anomaly' : '',
                      tx.externalMatch ? 'finance-row--linked-external' : '',
                    ].filter(Boolean).join(' ');
                    return (
                      <div style={{ ...style, gridTemplateColumns }} className={rowClassName}>
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
                            {showsAiPreselection && (
                              <div className="finance-subtext">AI suggestion pre-selected</div>
                            )}
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('aiCategory') && (
                          <div className="finance-cell">
                            <div className="finance-label">{toText(tx.displayCategoryLabel || tx.aiCategoryLabel || tx.aiCategoryKey, '—')}</div>
                            <div className="finance-subtext">{toText(tx.displayBucket || tx.aiBucket, 'Unassigned')}</div>
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('frequency') && (
                          <div className="finance-cell">
                            <div className="finance-label">{toText(tx.inferredFrequency, 'Irregular')}</div>
                            <div className="finance-subtext">AI cadence</div>
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('nextPredicted') && (
                          <div className="finance-cell">
                            {tx.nextPredictedDateISO ? (
                              <>
                                <div className="finance-label">{new Date(tx.nextPredictedDateISO).toLocaleDateString()}</div>
                                <div className="finance-subtext">Predicted next charge</div>
                              </>
                            ) : (
                              <>
                                <div className="finance-label">Ad-hoc</div>
                                <div className="finance-subtext">Insufficient cadence</div>
                              </>
                            )}
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('subscription') && (
                          <div className="finance-cell">
                            <Form.Check
                              type="checkbox"
                              checked={selectedSubscription}
                              onChange={(event) =>
                                setSubscriptionSelection((prev) => ({
                                  ...prev,
                                  [tx.id]: event.target.checked,
                                }))
                              }
                              label={selectedSubscription ? 'Subscription' : 'Not sub'}
                            />
                            {tx.subscriptionSuggested && (
                              <div className="finance-subtext">
                                Suggested: {toText(tx.subscriptionSuggestionReason, 'Recurring pattern')}
                              </div>
                            )}
                            {tx.excludedFromAiAndSubscription && !selectedSubscription && (
                              <div className="finance-subtext">Excluded from auto-analysis</div>
                            )}
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('linkedExternal') && (
                          <div className="finance-cell">
                            <Form.Check
                              type="checkbox"
                              checked={!!tx.externalMatch}
                              readOnly
                              label={tx.externalMatch ? tx.externalMatch.label : 'Not linked'}
                            />
                            {tx.externalMatch && (
                              <div className="finance-subtext">Matched to external card import</div>
                            )}
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('aiSuggestion') && (
                          <div className="finance-cell">
                            <div className="finance-subtext">{tx.aiReduceSuggestion || '—'}</div>
                          </div>
                        )}
                        {effectiveVisibleColumns.includes('recommendedAction') && (
                          <div className="finance-cell">
                            {recommendedAction ? (
                              <div className="d-flex flex-column gap-1">
                                <div className="finance-label text-truncate" title={toText(recommendedAction.title, 'Action')}>
                                  {toText(recommendedAction.title, 'Action')}
                                </div>
                                <div className="finance-subtext text-truncate" title={toText(recommendedAction.reason, '')}>
                                  {toText(recommendedAction.reason, '')}
                                </div>
                                {!recommendedAction.storyId ? (
                                  <Button
                                    size="sm"
                                    variant="outline-primary"
                                    className="finance-btn-story"
                                    disabled={convertingActionId === recommendedAction.id}
                                    onClick={() => convertActionToStory(recommendedAction)}
                                  >
                                    {convertingActionId === recommendedAction.id ? 'Logging…' : 'Log story'}
                                  </Button>
                                ) : (
                                  <a className="btn btn-sm btn-outline-secondary finance-btn-story" href={`/stories/${recommendedAction.storyId}`}>
                                    Open story
                                  </a>
                                )}
                              </div>
                            ) : (
                              <div className="finance-subtext">—</div>
                            )}
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
            <small>{fullDatasetMode ? 'Last 12 months' : 'Last 90 days'}</small>
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
