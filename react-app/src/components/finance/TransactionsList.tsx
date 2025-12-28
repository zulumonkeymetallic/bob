import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Row, Spinner } from 'react-bootstrap';
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
  defaultCategoryType?: string | null;
  metadata?: Record<string, any> | null;
  potId?: string | null;
  potName?: string | null;
  displayDescription?: string | null;
};

type DisplayRow =
  | { kind: 'group'; merchant: string; count: number; total: number }
  | { kind: 'row'; row: TxRow };

const PAGE_SIZE = 150;

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
  const [categorySelection, setCategorySelection] = useState<Record<string, string>>({});
  const pageAnchorsRef = React.useRef<Array<DocumentSnapshot | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPrevPage, setHasPrevPage] = useState(false);
  const [sortKey, setSortKey] = useState<'date_desc' | 'amount_desc' | 'amount_asc'>('date_desc');
  const [groupByMerchant, setGroupByMerchant] = useState(false);
  const [tableRef, bounds] = useMeasure();
  const [customCategories, setCustomCategories] = useState<FinanceCategory[]>([]);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);

  const mapDocToRow = useCallback((d: any): TxRow => {
    const data = d.data() as any;
    const metadata = (data.metadata || {}) as Record<string, any>;
    const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null;
    return {
      id: d.id,
      transactionId: data.transactionId || d.id,
      createdISO: createdAt ? createdAt.toISOString() : data.createdISO || null,
      amount: typeof data.amount === 'number' ? data.amount : (data.amountMinor || 0) / 100,
      description: data.description || data.defaultCategoryLabel || 'Transaction',
      merchant: data.merchant?.name || data.counterparty?.name || null,
      merchantLogo: data.merchant?.logo || null,
      merchantKey: data.merchantKey || null,
      userCategoryKey: data.userCategoryKey || null,
      userCategoryLabel: data.userCategoryLabel || data.defaultCategoryLabel || null,
      userCategoryType: data.userCategoryType || data.defaultCategoryType || null,
      defaultCategoryType: data.defaultCategoryType || null,
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

  useEffect(() => {
    if (!currentUser) return;
    loadPage(0);
  }, [currentUser, loadPage]);

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

  useEffect(() => {
    if (!currentUser) return;
    const potsQuery = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(potsQuery, (snap) => {
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
    });
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
      const displayDescription =
        potName && (r.description || '').startsWith('pot_') ? `Transfer to ${potName}` : r.description;
      return pot ? { ...r, potName, displayDescription } : { ...r, displayDescription };
    });

    const subset = enriched.filter((r) => {
      if (bucketFilter !== 'all') {
        const bucket = r.userCategoryType || (r.userCategoryKey ? r.defaultCategoryType : 'optional');
        if (bucket !== bucketFilter) return false;
      }
      if (categoryFilter !== 'all') {
        if ((r.userCategoryKey || '').toLowerCase() !== categoryFilter.toLowerCase()) return false;
      }
      if (potFilter !== 'all' && (r.potId || '') !== potFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${r.description || ''} ${r.merchant || ''} ${r.userCategoryLabel || ''} ${r.potName || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (merchantFilter.trim() && !(r.merchant || '').toLowerCase().includes(merchantFilter.toLowerCase())) return false;
      if (descFilter.trim() && !(r.displayDescription || r.description || '').toLowerCase().includes(descFilter.toLowerCase())) return false;
      if (missingOnly && (r.userCategoryKey || r.userCategoryLabel)) return false;
      const amt = Math.abs(r.amount);
      if (amountMin && amt < Number(amountMin)) return false;
      if (amountMax && amt > Number(amountMax)) return false;
      return true;
    });

    const sorted = [...subset].sort((a, b) => {
      if (sortKey === 'amount_desc') return Math.abs(b.amount) - Math.abs(a.amount);
      if (sortKey === 'amount_asc') return Math.abs(a.amount) - Math.abs(b.amount);
      const at = a.createdISO ? new Date(a.createdISO).getTime() : 0;
      const bt = b.createdISO ? new Date(b.createdISO).getTime() : 0;
      return bt - at;
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
    amountMin,
    amountMax,
    sortKey,
  ]);

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

  const updateTransactionCategory = async (tx: TxRow, categoryKey: string, applyToExisting: boolean) => {
    if (!currentUser) return;
    if (!categoryKey) {
      setErrorMsg('Select a category before saving.');
      return;
    }
    const cat = allCategories.find((c) => c.key === categoryKey);
    const bucket = cat?.bucket || 'optional';
    setSavingId(tx.id);
    setErrorMsg('');
    try {
      const override = httpsCallable(functions, 'setTransactionCategoryOverride');
      await override({
        transactionId: tx.transactionId,
        docId: tx.id,
        categoryKey,
        categoryLabel: cat?.label || categoryKey,
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
      await loadPage(pageIndex);
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
        <div className="finance-chip subtle">
          {bucketLabelFromCategory(currentKey || tx.userCategoryKey, tx.userCategoryType || tx.defaultCategoryType)}
        </div>
      </div>
    );
  };

  return (
    <div className="finance-table-page">
      <div className="container" ref={tableRef}>
        <div className="d-flex justify-content-between align-items-center mb-2">
          <span className="small text-muted">Signed in as: <code>{currentUser.uid}</code></span>
        </div>
        <div className="d-flex flex-wrap justify-content-between align-items-center mb-3">
          <div>
            <h3 className="mb-1">Monzo Transactions</h3>
            <div className="text-muted">
              Excel-like view with grouping, filters, pagination (150/page). Uses the last synced Firestore snapshot — refresh does not trigger a Monzo resync. You can save categories even while a refresh runs.
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
            <Button size="sm" variant="outline-secondary" disabled={loading} onClick={() => loadPage(pageIndex)}>
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
                  <option value="optional">Optional</option>
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
                <Form.Check
                  type="switch"
                  id="missing-only"
                  label="Missing category"
                  checked={missingOnly}
                  onChange={(e) => setMissingOnly(e.target.checked)}
                />
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
                <Form.Select size="sm" className="finance-input" value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
                  <option value="date_desc">Newest first</option>
                  <option value="amount_desc">Amount (high → low)</option>
                  <option value="amount_asc">Amount (low → high)</option>
                </Form.Select>
              </Col>
              <Col md={3} className="d-flex align-items-center gap-3 justify-content-end">
                <Form.Check
                  type="switch"
                  id="group-merchant"
                  label="Group by merchant"
                  checked={groupByMerchant}
                  onChange={(e) => setGroupByMerchant(e.target.checked)}
                />
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
              </Col>
            </Row>
        </Card.Body>
      </Card>

        <Card className="finance-table-card shadow-sm border-0">
          <div className="finance-table-meta d-flex justify-content-between align-items-center">
            <div className="small text-muted">Showing up to {PAGE_SIZE} rows per page</div>
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
        <div className="finance-table-shell">
          <div className="finance-grid-header">
            <span>Date</span>
            <span>Merchant</span>
            <span>Description / Pot</span>
            <span>Bucket</span>
            <span>Category</span>
            <span className="text-end">Amount</span>
            <span className="text-end">Actions</span>
          </div>
          {!loading && displayRows.length === 0 ? (
            <div className="finance-empty">No transactions match your filters.</div>
          ) : null}
          {displayRows.length > 0 && (
            <div className="finance-list-wrapper">
              <List
                  height={580}
                  width={bounds.width || 1200}
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
                        <div style={style} className="finance-row finance-row-group">
                          <div>
                            <div className="finance-label">{item.merchant}</div>
                            <div className="finance-subtext">{item.count} tx • {formatMoney(item.total)}</div>
                          </div>
                        </div>
                      );
                    }
                    const tx = item.row;
                    const selectedKey = categorySelection[tx.id] ?? tx.userCategoryKey ?? '';
                    const effectiveCategory = categorySelection[tx.id] || tx.userCategoryKey || '';
                    const hasCategory = Boolean(effectiveCategory);
                    const created = tx.createdISO ? new Date(tx.createdISO) : null;
                    const dateLabel = created ? created.toLocaleDateString() : '—';
                    const timeLabel = created ? created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                    const amountClass = tx.amount < 0 ? 'finance-amount negative' : 'finance-amount positive';
                    return (
                      <div style={style} className="finance-row">
                        <div className="finance-cell">
                          <div className="finance-label">{dateLabel}</div>
                          <div className="finance-subtext">{timeLabel}</div>
                        </div>
                        <div className="finance-cell">
                          <div className="d-flex align-items-center gap-2">
                            {tx.merchantLogo ? (
                              <img src={tx.merchantLogo} alt="" width={28} height={28} className="rounded-circle" />
                            ) : (
                              <div className="finance-avatar-placeholder" />
                            )}
                            <div>
                              <div className="finance-label">{tx.merchant || '—'}</div>
                              <div className="finance-subtext">{tx.merchantKey || '—'}</div>
                            </div>
                          </div>
                        </div>
                        <div className="finance-cell">
                          <div className="finance-label text-truncate" title={tx.displayDescription || tx.description}>
                            {tx.displayDescription || tx.description}
                          </div>
                          <div className="finance-subtext">{tx.potName || 'No pot'}</div>
                        </div>
                        <div className="finance-cell">
                          {renderCategoryControl(tx, selectedKey)}
                          <div className="finance-subtext mt-1">
                            {bucketLabelFromCategory(selectedKey || tx.userCategoryKey, tx.userCategoryType || tx.defaultCategoryType)}
                          </div>
                        </div>
                        <div className="finance-cell text-end">
                          <div className={amountClass}>{formatMoney(tx.amount)}</div>
                        </div>
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
                      </div>
                    );
                  }}
                </List>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default TransactionsList;
