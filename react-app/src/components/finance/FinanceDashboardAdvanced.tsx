import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Row, Col, Spinner, Alert, Form, Button, Badge, ButtonGroup } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc } from 'firebase/firestore';
import { useSearchParams } from 'react-router-dom';
import { db, functions } from '../../firebase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { PremiumCard } from '../common/PremiumCard';
import ReactECharts from 'echarts-for-react';
import {
    TrendingUp,
    PieChart as PieIcon,
    Calendar,
    RefreshCw,
    DollarSign,
    ArrowUpRight,
    CreditCard,
    Layers,
    Activity,
    Upload,
    Link2,
    Sparkles,
    CheckCircle2,
    Wallet,
    Landmark,
    AlertTriangle,
    Target,
    Trash2,
} from 'lucide-react';
import './FinanceDashboardAdvanced.css';

type DateFilter = 'month' | 'quarter' | 'year' | 'all' | 'custom';
type ViewMode = 'category' | 'bucket';
type FinanceView = 'overview' | 'spend' | 'discretionary' | 'actions' | 'sources' | 'assets';
type ExternalSource = 'barclays' | 'paypal' | 'other' | 'monzo_csv';
type AnalysisDimension = 'bucket' | 'category' | 'merchant';
type AnalysisChartType = 'trend' | 'pie' | 'breakdown';
type ManualAccountType = 'asset' | 'debt' | 'investment' | 'cash' | 'savings';

const THEME_COLORS = ['#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF', '#9B59B6', '#00C2A8', '#F39C12'];
const EMPTY_LIST: any[] = [];

const toPounds = (pence: number) => (Number.isFinite(pence) ? pence / 100 : 0);
const txAmountMinor = (tx: any) => {
    if (Number.isFinite(Number(tx?.amountMinor))) return Math.round(Number(tx.amountMinor));
    const rawAmount = Number(tx?.amount || 0);
    if (!Number.isFinite(rawAmount)) return 0;
    return Math.round(rawAmount * 100);
};

const parseTxDate = (tx: any): Date | null => {
    const createdAt = tx?.createdAt;
    if (createdAt?.toDate) return createdAt.toDate();
    if (createdAt?._seconds) return new Date(createdAt._seconds * 1_000);
    if (typeof createdAt === 'number') return new Date(createdAt);
    if (typeof createdAt === 'string' && createdAt) return new Date(createdAt);
    if (tx?.createdISO) return new Date(tx.createdISO);
    return null;
};

const monthLabel = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    if (!year || !month) return monthKey;
    return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-GB', {
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
    });
};

const normalizeManualType = (type: string): ManualAccountType => {
    const normalized = String(type || 'asset').toLowerCase();
    if (['asset', 'debt', 'investment', 'cash', 'savings'].includes(normalized)) {
        return normalized as ManualAccountType;
    }
    return 'asset';
};

const toText = (value: any, fallback = ''): string => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed || fallback;
    }
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
        const first = value.find((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean');
        return first !== undefined ? toText(first, fallback) : fallback;
    }
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

const toKeyText = (value: any, fallback = 'unknown') => {
    const text = toText(value, fallback);
    return text || fallback;
};

const parseFinanceView = (tab: string | null): FinanceView | null => {
    if (!tab) return null;
    if (tab === 'cashflow') return 'spend';
    if (tab === 'overview') return 'overview';
    if (tab === 'spend') return 'spend';
    if (tab === 'discretionary') return 'discretionary';
    if (tab === 'actions') return 'actions';
    if (tab === 'sources') return 'sources';
    if (tab === 'assets') return 'assets';
    return null;
};

const FinanceDashboardAdvanced: React.FC = () => {
    const { currentUser } = useAuth();
    const { theme } = useTheme();
    const isDark = theme === 'dark';
    const [searchParams, setSearchParams] = useSearchParams();

    const [data, setData] = useState<any>(null);
    const [enhancementData, setEnhancementData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [syncing, setSyncing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [manualBusy, setManualBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [opsMessage, setOpsMessage] = useState<string | null>(null);
    const [lastSync, setLastSync] = useState<Date | null>(null);
    const [filter, setFilter] = useState<DateFilter>('month');
    const [startDate, setStartDate] = useState<string>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    });
    const [endDate, setEndDate] = useState<string>(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    });
    const [viewMode, setViewMode] = useState<ViewMode>('category');
    const [activeView, setActiveView] = useState<FinanceView>(() => parseFinanceView(searchParams.get('tab')) || 'overview');

    const [externalSource, setExternalSource] = useState<ExternalSource>('barclays');
    const [csvText, setCsvText] = useState('');
    const [csvFileName, setCsvFileName] = useState('');
    const [windowDays, setWindowDays] = useState(5);
    const [amountTolerancePence, setAmountTolerancePence] = useState(150);
    const [convertingActionId, setConvertingActionId] = useState<string | null>(null);

    const [analysisDimension, setAnalysisDimension] = useState<AnalysisDimension>('bucket');
    const [analysisChartType, setAnalysisChartType] = useState<AnalysisChartType>('trend');
    const [analysisBucketFilter, setAnalysisBucketFilter] = useState('all');
    const [analysisCategoryFilter, setAnalysisCategoryFilter] = useState('all');
    const [analysisMerchantFilter, setAnalysisMerchantFilter] = useState('all');

    // Chart drill-down filter state
    const [chartFilter, setChartFilter] = useState<{ type: 'category' | 'bucket' | null; value: string | null }>({ type: null, value: null });

    const [editingManualAccountId, setEditingManualAccountId] = useState<string | null>(null);
    const [manualForm, setManualForm] = useState<{
        name: string;
        institution: string;
        type: ManualAccountType;
        balance: string;
        currency: string;
    }>({
        name: '',
        institution: '',
        type: 'asset',
        balance: '',
        currency: 'GBP',
    });

    const colors = {
        text: isDark ? '#ffffff' : '#2c3e50',
        textMuted: isDark ? '#9a9a9a' : '#6c757d',
        grid: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)',
        success: '#00f2c3',
        danger: '#fd5d93',
        warning: '#ff8d72',
        info: '#1d8cf8',
    };

    const formatCurrency = (val: number) =>
        new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val || 0);

    const fetchData = useCallback(async () => {
        if (!currentUser) return;
        setLoading(true);
        setError(null);
        try {
            const profileSnap = await getDoc(doc(db, 'profiles', currentUser.uid));
            if (profileSnap.exists()) {
                const p = profileSnap.data();
                if (p.monzoLastSyncAt) {
                    setLastSync(p.monzoLastSyncAt.toDate ? p.monzoLastSyncAt.toDate() : new Date(p.monzoLastSyncAt));
                }
            }

            const now = new Date();
            let rangeStart = new Date(startDate);
            let rangeEnd = new Date(endDate);

            if (filter === 'month') {
                rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
                rangeEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            } else if (filter === 'quarter') {
                const q = Math.floor(now.getMonth() / 3);
                rangeStart = new Date(now.getFullYear(), q * 3, 1);
                rangeEnd = new Date(now.getFullYear(), (q + 1) * 3, 0);
            } else if (filter === 'year') {
                rangeStart = new Date(now.getFullYear(), 0, 1);
                rangeEnd = new Date(now.getFullYear(), 11, 31);
            } else if (filter === 'all') {
                rangeStart = new Date('2018-01-01T00:00:00.000Z');
                rangeEnd = new Date();
            }

            const fetchDashboardData = httpsCallable(functions, 'fetchDashboardData');
            const fetchEnhancementData = httpsCallable(functions, 'fetchFinanceEnhancementData');

            const [dashboardRes, enhancementRes] = await Promise.allSettled([
                fetchDashboardData({
                    startDate: rangeStart.toISOString(),
                    endDate: rangeEnd.toISOString(),
                }),
                fetchEnhancementData({
                    startDate: rangeStart.toISOString(),
                    endDate: rangeEnd.toISOString(),
                }),
            ]);

            if (dashboardRes.status !== 'fulfilled') {
                throw dashboardRes.reason;
            }

            setData(((dashboardRes.value.data as any)?.data || dashboardRes.value.data) as any);
            if (enhancementRes.status === 'fulfilled') {
                setEnhancementData((enhancementRes.value.data as any) || null);
            } else {
                console.warn('fetchFinanceEnhancementData failed', enhancementRes.reason);
                setEnhancementData(null);
            }
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Failed to load finance dashboard data');
        } finally {
            setLoading(false);
        }
    }, [currentUser, filter, startDate, endDate]);

    useEffect(() => {
        fetchData();
        (window as any).refreshMonzoData = async () => {
            const fn = httpsCallable(functions, 'syncMonzoNow');
            await fn({});
            await fetchData();
        };
    }, [fetchData]);

    useEffect(() => {
        const tabFromUrl = parseFinanceView(searchParams.get('tab'));
        if (tabFromUrl && tabFromUrl !== activeView) {
            setActiveView(tabFromUrl);
        }
    }, [searchParams, activeView]);

    const handleViewChange = useCallback((nextView: FinanceView) => {
        setActiveView(nextView);
        const nextParams = new URLSearchParams(searchParams);
        if (nextView === 'overview') nextParams.delete('tab');
        else nextParams.set('tab', nextView);
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const handleSync = async () => {
        setSyncing(true);
        setOpsMessage(null);
        try {
            const fn = httpsCallable(functions, 'syncMonzoNow');
            await fn({});
            await fetchData();
            setOpsMessage('Monzo sync completed and dashboard refreshed.');
        } catch (e: any) {
            const message = String(e?.message || 'Sync failed');
            if (/monzo connection expired|missing monzo refresh token/i.test(message)) {
                setError('Monzo connection expired. Reconnect Monzo in Integrations, then run sync again.');
            } else {
                setError(message);
            }
        } finally {
            setSyncing(false);
        }
    };

    const handleCsvFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const text = await file.text();
        setCsvText(text);
        setCsvFileName(file.name);
        setOpsMessage(`Loaded ${file.name}. Ready to import.`);
    };

    const handleImportAndRebuild = async () => {
        if (!csvText.trim()) {
            setError('Select a CSV file before importing.');
            return;
        }

        setBusy(true);
        setError(null);
        setOpsMessage(null);
        try {
            if (externalSource === 'monzo_csv') {
                const importMonzoFn = httpsCallable(functions, 'importMonzoTransactionsCsv');
                const recomputeFn = httpsCallable(functions, 'recomputeMonzoAnalytics');
                const importRes = (await importMonzoFn({ csv: csvText })).data as any;
                await recomputeFn({});
                await fetchData();
                const inserted = Number(importRes?.inserted || 0);
                const skipped = Number(importRes?.skippedExisting || 0);
                const start = importRes?.coverageStartISO ? new Date(importRes.coverageStartISO).toLocaleDateString('en-GB') : '—';
                const end = importRes?.coverageEndISO ? new Date(importRes.coverageEndISO).toLocaleDateString('en-GB') : '—';
                setOpsMessage(`Monzo import inserted ${inserted} row(s), skipped ${skipped} existing rows, coverage ${start} → ${end}.`);
                return;
            }

            const importFn = httpsCallable(functions, 'importExternalFinanceTransactions');
            const matchFn = httpsCallable(functions, 'matchExternalToMonzoTransactions');
            const debtFn = httpsCallable(functions, 'recomputeDebtServiceBreakdown');
            const actionsFn = httpsCallable(functions, 'generateFinanceActionInsights');

            const importRes = (await importFn({ source: externalSource, csv: csvText })).data as any;
            const matchRes = (await matchFn({
                source: externalSource,
                windowDays,
                amountTolerancePence,
            })).data as any;
            await debtFn({ source: externalSource });
            await actionsFn({ source: externalSource, maxActions: 12 });

            await fetchData();

            setOpsMessage(
                `Imported ${importRes?.upserted || 0} rows, matched ${matchRes?.matched || 0}, and rebuilt debt/action insights.`
            );
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Import pipeline failed');
        } finally {
            setBusy(false);
        }
    };

    const handleRematch = async () => {
        if (externalSource === 'monzo_csv') {
            setOpsMessage('Rematching is only used for external card imports (Barclays/PayPal/Other).');
            return;
        }
        setBusy(true);
        setError(null);
        setOpsMessage(null);
        try {
            const matchFn = httpsCallable(functions, 'matchExternalToMonzoTransactions');
            const matchRes = (await matchFn({
                source: externalSource,
                windowDays,
                amountTolerancePence,
            })).data as any;
            await fetchData();
            setOpsMessage(`Matching complete: ${matchRes?.matched || 0} matched, ${matchRes?.unmatched || 0} unmatched.`);
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Matching failed');
        } finally {
            setBusy(false);
        }
    };

    const handleRegenerateActions = async () => {
        if (externalSource === 'monzo_csv') {
            setOpsMessage('Action generation is based on external card debt sources, not Monzo CSV backfill.');
            return;
        }
        setBusy(true);
        setError(null);
        setOpsMessage(null);
        try {
            const debtFn = httpsCallable(functions, 'recomputeDebtServiceBreakdown');
            const actionsFn = httpsCallable(functions, 'generateFinanceActionInsights');
            await debtFn({ source: externalSource });
            const actionRes = (await actionsFn({ source: externalSource, maxActions: 12 })).data as any;
            await fetchData();
            setOpsMessage(`Generated ${Array.isArray(actionRes?.actions) ? actionRes.actions.length : 0} finance actions.`);
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Action generation failed');
        } finally {
            setBusy(false);
        }
    };

    const handleConvertActionToStory = async (actionId: string) => {
        if (!actionId) return;
        setConvertingActionId(actionId);
        setError(null);
        setOpsMessage(null);
        try {
            const fn = httpsCallable(functions, 'convertFinanceActionToStory');
            const result = (await fn({ actionId })).data as any;
            await fetchData();
            setOpsMessage(`Action converted to story ${result?.storyId || ''}.`);
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Failed to convert action to story');
        } finally {
            setConvertingActionId(null);
        }
    };

    const resetManualForm = () => {
        setEditingManualAccountId(null);
        setManualForm({
            name: '',
            institution: '',
            type: 'asset',
            balance: '',
            currency: 'GBP',
        });
    };

    const handleSaveManualAccount = async () => {
        if (!manualForm.name.trim()) {
            setError('Account name is required.');
            return;
        }
        const balanceNum = Number(manualForm.balance || 0);
        if (!Number.isFinite(balanceNum)) {
            setError('Balance must be a valid number.');
            return;
        }

        setManualBusy(true);
        setError(null);
        setOpsMessage(null);
        try {
            const upsertFn = httpsCallable(functions, 'upsertManualFinanceAccount');
            await upsertFn({
                accountId: editingManualAccountId || undefined,
                name: manualForm.name,
                institution: manualForm.institution,
                type: manualForm.type,
                currency: manualForm.currency,
                balancePence: Math.round(balanceNum * 100),
            });
            await fetchData();
            setOpsMessage(editingManualAccountId ? 'Account updated.' : 'Account added.');
            resetManualForm();
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Failed to save account');
        } finally {
            setManualBusy(false);
        }
    };

    const handleDeleteManualAccount = async (accountId: string) => {
        if (!accountId) return;
        setManualBusy(true);
        setError(null);
        setOpsMessage(null);
        try {
            const deleteFn = httpsCallable(functions, 'deleteManualFinanceAccount');
            await deleteFn({ accountId });
            await fetchData();
            setOpsMessage('Account deleted.');
            if (editingManualAccountId === accountId) resetManualForm();
        } catch (err: any) {
            console.error(err);
            setError(err?.message || 'Failed to delete account');
        } finally {
            setManualBusy(false);
        }
    };

    const startEditManualAccount = (account: any) => {
        setEditingManualAccountId(account.accountId || null);
        setManualForm({
            name: account.name || '',
            institution: account.institution || '',
            type: normalizeManualType(account.type || 'asset'),
            balance: (Number(account.balancePence || 0) / 100).toFixed(2),
            currency: account.currency || 'GBP',
        });
    };

    const userBadge = (
        <div className="d-flex justify-content-end mb-2">
            <span className="small text-muted">Signed in as: <code>{currentUser?.uid || '—'}</code></span>
        </div>
    );

    const bucketEntries = Object.entries(data?.spendByBucket || {}).filter(([key]) => key !== 'bank_transfer' && key !== 'unknown');
    const bucketData = bucketEntries
        .map(([key, value]: [string, any]) => ({ name: key.charAt(0).toUpperCase() + key.slice(1), value: Math.abs(value) / 100 }))
        .filter((entry) => entry.value > 0);

    const categoryData = Object.entries(data?.spendByCategory || {})
        .filter(([key]) => key !== 'bank_transfer' && key !== 'unknown')
        .map(([key, value]: [string, any]) => ({ name: key, value: Math.abs(value) / 100 }))
        .sort((a, b) => b.value - a.value);
    const topCategoryData = categoryData.slice(0, 10);

    const timeSeriesSourceRaw = viewMode === 'bucket' ? data?.timeSeriesByBucket : data?.timeSeriesByCategory;
    const timeSeriesSource = Object.fromEntries(Object.entries(timeSeriesSourceRaw || {}).filter(([key]) => key !== 'bank_transfer'));

    const allMonths = new Set<string>();
    Object.values(timeSeriesSource || {}).forEach((arr: any) => arr.forEach((entry: any) => allMonths.add(entry.month)));
    const sortedMonths = Array.from(allMonths).sort();

    const trendData = sortedMonths.map((month) => {
        const row: any = { month };
        Object.entries(timeSeriesSource || {}).forEach(([key, arr]: [string, any]) => {
            const entry = arr.find((item: any) => item.month === month);
            if (entry) row[key] = Math.abs(entry.amount) / 100;
        });
        return row;
    });

    const activeKeys = Object.keys(timeSeriesSource || {}).slice(0, 5);
    const bankTransferAmount = data?.spendByBucket?.bank_transfer ?? 0;
    const filteredTotalSpend = Math.abs((data?.totalSpend || 0) - bankTransferAmount) / 100;

    const trendOption = {
        tooltip: { trigger: 'axis' },
        legend: { data: activeKeys },
        grid: { left: 50, right: 10, top: 30, bottom: 50 },
        xAxis: { type: 'category', data: trendData.map((r: any) => r.month) },
        yAxis: { type: 'value', axisLabel: { formatter: (v: number) => `£${v}` } },
        series: activeKeys.map((key, idx) => ({
            name: key,
            type: 'bar',
            stack: 'spend',
            data: trendData.map((row: any) => Math.abs(row[key] || 0)),
            color: THEME_COLORS[idx % THEME_COLORS.length],
            emphasis: { focus: 'series' },
        })),
    };

    const localDistribution = ((data?.recentTransactions || []) as any[])
        .filter((tx) => {
            const cat = (tx.userCategoryKey || tx.aiCategoryKey || tx.categoryKey || tx.categoryType || '').toLowerCase();
            return cat && cat !== 'bank_transfer' && cat !== 'unknown';
        })
        .reduce((acc: Record<string, number>, tx: any) => {
            const label = toText(
                tx.userCategoryLabel || tx.aiCategoryLabel || tx.categoryLabel || tx.categoryKey || tx.categoryType,
                'Uncategorised'
            );
            const amt = Math.abs(txAmountMinor(tx)) / 100;
            acc[label] = (acc[label] || 0) + amt;
            return acc;
        }, {} as Record<string, number>);

    const distributionSource = (() => {
        const local = Object.entries(localDistribution)
            .map(([name, value]) => ({ name, value: Number(value || 0) }))
            .sort((a, b) => Number(b.value) - Number(a.value))
            .slice(0, 10);
        const aggregate = viewMode === 'bucket' ? bucketData : topCategoryData;
        if (aggregate.length) return aggregate;
        return local;
    })();

    const distributionOption = {
        tooltip: { trigger: 'item', valueFormatter: (v: number) => `£${v}` },
        legend: { orient: 'horizontal', bottom: 0 },
        series: [
            {
                type: 'pie',
                radius: ['50%', '70%'],
                avoidLabelOverlap: false,
                itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
                label: { show: false },
                data: distributionSource.map((entry: any, idx: number) => ({
                    value: entry.value,
                    name: entry.name,
                    itemStyle: { color: THEME_COLORS[idx % THEME_COLORS.length] },
                })),
            },
        ],
    };

    // Chart click handlers
    const handleTrendClick = (params: any) => {
        if (params.componentType === 'series') {
            const categoryName = params.seriesName;
            setChartFilter({ type: 'category', value: categoryName });
        }
    };

    const handlePieClick = (params: any) => {
        if (params.componentType === 'series') {
            const selectedName = params.name;
            const filterType = viewMode === 'bucket' ? 'bucket' : 'category';
            setChartFilter({ type: filterType, value: selectedName });
        }
    };

    const clearChartFilter = () => {
        setChartFilter({ type: null, value: null });
    };

    const filteredRecentTransactions = (data?.recentTransactions || [])
        .filter((tx: any) => {
            const bucket = (tx.userCategoryType || tx.aiBucket || tx.categoryType || '').toLowerCase();
            if (bucket === 'bank_transfer' || bucket === 'unknown') return false;

            // Apply chart filter
            if (chartFilter.type && chartFilter.value) {
                if (chartFilter.type === 'category') {
                    const categoryLabel = toText(
                        tx.userCategoryLabel || tx.aiCategoryLabel || tx.categoryLabel || tx.categoryKey || tx.categoryType,
                        'Uncategorised'
                    );
                    if (categoryLabel !== chartFilter.value) return false;
                } else if (chartFilter.type === 'bucket') {
                    const bucketLabel = toText(tx.userCategoryType || tx.aiBucket || tx.categoryType, '');
                    // Normalize bucket names for comparison
                    const normalizedBucket = bucketLabel.toLowerCase();
                    const normalizedFilter = chartFilter.value.toLowerCase();
                    if (normalizedBucket !== normalizedFilter &&
                        !(normalizedBucket === 'discretionary' && normalizedFilter === 'discretionary') &&
                        !(normalizedBucket === 'mandatory' && normalizedFilter === 'mandatory')) {
                        return false;
                    }
                }
            }

            return true;
        })
        .map((tx: any) => ({
            ...tx,
            __merchantLabel: toText(tx.merchantName || tx.merchant?.name || tx.merchant, 'Unknown merchant'),
            __potLabel: toText(tx.potName, '—'),
            __categoryLabel: toText(
                tx.userCategoryLabel || tx.aiCategoryLabel || tx.categoryLabel || tx.categoryKey || tx.categoryType,
                'Uncategorised'
            ),
            __bucketLabel: toText(tx.userCategoryType || tx.aiBucket || tx.categoryType, 'Unknown'),
        }));

    const spendTrackingSeries = enhancementData?.spendTrackingSeries ?? EMPTY_LIST;
    const cashflowSeries = enhancementData?.cashflowSeries ?? EMPTY_LIST;
    const optionalSpendCards = (enhancementData?.optionalSpendCards ?? EMPTY_LIST).map((item: any, index: number) => ({
        ...item,
        __merchantKey: toKeyText(item.merchantKey || item.merchantName, `merchant-${index}`),
        __merchantName: toText(item.merchantName || item.merchantKey, 'Unknown merchant'),
    }));
    const actions = (enhancementData?.actions ?? EMPTY_LIST).map((action: any) => ({
        ...action,
        __title: toText(action.title || action.merchantName || action.merchantKey, 'Finance action'),
        __reason: toText(action.reason, 'No detail provided.'),
        __merchantName: toText(action.merchantName || action.merchantKey, 'Unknown merchant'),
        __merchantKey: toKeyText(action.merchantKey || action.merchantName, 'unknown'),
    }));
    const externalSummary = enhancementData?.externalSummary ?? EMPTY_LIST;
    const matchSummary = enhancementData?.matchSummary ?? EMPTY_LIST;
    const debtService = enhancementData?.debtService?.totals || null;
    const analysisRows = enhancementData?.analysisRows ?? EMPTY_LIST;
    const budgetHealth = enhancementData?.budgetHealth || null;
    const goalForecasts = enhancementData?.goalForecasts ?? EMPTY_LIST;
    const manualAccounts = enhancementData?.manualAccounts ?? EMPTY_LIST;
    const manualAccountSummary = enhancementData?.manualAccountSummary || {
        totalAssetPence: 0,
        totalDebtPence: 0,
        netWorthPence: 0,
        staleCount: 0,
    };

    const matchBySource = useMemo(() => {
        const map = new Map<string, any>();
        matchSummary.forEach((item: any) => map.set(item.source, item));
        return map;
    }, [matchSummary]);

    const spendTrackingOption = {
        tooltip: { trigger: 'axis' },
        legend: { data: ['Mandatory', 'Discretionary', 'Savings', 'Income'] },
        grid: { left: 50, right: 15, top: 30, bottom: 30 },
        xAxis: {
            type: 'category',
            data: spendTrackingSeries.map((item: any) => monthLabel(item.month)),
        },
        yAxis: {
            type: 'value',
            axisLabel: { formatter: (v: number) => `£${v}` },
        },
        series: [
            {
                name: 'Mandatory',
                type: 'bar',
                stack: 'spend',
                itemStyle: { color: '#ff8d72' },
                data: spendTrackingSeries.map((item: any) => toPounds(item.mandatoryPence || 0)),
            },
            {
                name: 'Discretionary',
                type: 'bar',
                stack: 'spend',
                itemStyle: { color: '#fd5d93' },
                data: spendTrackingSeries.map((item: any) => toPounds(item.optionalPence || 0)),
            },
            {
                name: 'Savings',
                type: 'bar',
                stack: 'spend',
                itemStyle: { color: '#36A2EB' },
                data: spendTrackingSeries.map((item: any) => toPounds(item.savingsPence || 0)),
            },
            {
                name: 'Income',
                type: 'line',
                smooth: true,
                symbolSize: 7,
                itemStyle: { color: '#00f2c3' },
                data: spendTrackingSeries.map((item: any) => toPounds(item.incomePence || 0)),
            },
        ],
    };

    const cashflowOption = {
        tooltip: { trigger: 'axis' },
        legend: { data: ['Inflow', 'Outflow', 'Net'] },
        grid: { left: 50, right: 15, top: 30, bottom: 30 },
        xAxis: {
            type: 'category',
            data: cashflowSeries.map((item: any) => monthLabel(item.month)),
        },
        yAxis: {
            type: 'value',
            axisLabel: { formatter: (v: number) => `£${v}` },
        },
        series: [
            {
                name: 'Inflow',
                type: 'line',
                smooth: true,
                areaStyle: { opacity: 0.2 },
                itemStyle: { color: '#00f2c3' },
                data: cashflowSeries.map((item: any) => toPounds(item.inflowPence || 0)),
            },
            {
                name: 'Outflow',
                type: 'line',
                smooth: true,
                areaStyle: { opacity: 0.15 },
                itemStyle: { color: '#fd5d93' },
                data: cashflowSeries.map((item: any) => toPounds(item.outflowPence || 0)),
            },
            {
                name: 'Net',
                type: 'line',
                smooth: true,
                lineStyle: { width: 3 },
                itemStyle: { color: '#36A2EB' },
                data: cashflowSeries.map((item: any) => toPounds(item.netPence || 0)),
            },
        ],
    };

    const analysisBucketOptions = useMemo(() => {
        const set = new Set<string>();
        analysisRows.forEach((row: any) => set.add(toText(row.bucket, 'unknown')));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [analysisRows]);

    const analysisCategoryOptions = useMemo(() => {
        const set = new Set<string>();
        analysisRows.forEach((row: any) => set.add(toText(row.categoryKey || row.categoryLabel, 'uncategorized')));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [analysisRows]);

    const analysisMerchantOptions = useMemo(() => {
        const set = new Set<string>();
        analysisRows.forEach((row: any) => set.add(toText(row.merchantName || row.merchant, 'Unknown')));
        return Array.from(set).sort((a, b) => a.localeCompare(b));
    }, [analysisRows]);

    const filteredAnalysisRows = useMemo(() => {
        return analysisRows.filter((row: any) => {
            const bucketLabel = toText(row.bucket, 'unknown');
            if (analysisBucketFilter !== 'all' && bucketLabel !== analysisBucketFilter) return false;
            const categoryKey = toText(row.categoryKey || row.categoryLabel, 'uncategorized');
            if (analysisCategoryFilter !== 'all' && categoryKey !== analysisCategoryFilter) return false;
            const merchantName = toText(row.merchantName || row.merchant, 'Unknown');
            if (analysisMerchantFilter !== 'all' && merchantName !== analysisMerchantFilter) return false;
            return true;
        });
    }, [analysisRows, analysisBucketFilter, analysisCategoryFilter, analysisMerchantFilter]);

    const analysisStats = useMemo(() => {
        const totalPence = filteredAnalysisRows.reduce((sum: number, row: any) => sum + Number(row.amountPence || 0), 0);
        const count = filteredAnalysisRows.length;
        const avgPence = count > 0 ? Math.round(totalPence / count) : 0;
        return {
            totalPence,
            count,
            avgPence,
        };
    }, [filteredAnalysisRows]);

    const analysisGrouped = useMemo(() => {
        const groupedTotals: Record<string, number> = {};
        const groupedByMonth: Record<string, Record<string, number>> = {};
        const monthsSet = new Set<string>();

        filteredAnalysisRows.forEach((row: any) => {
            const month = toText(row.month, 'unknown');
            const key = analysisDimension === 'bucket'
                ? toText(row.bucket, 'unknown')
                : analysisDimension === 'category'
                    ? toText(row.categoryLabel || row.categoryKey, 'uncategorized')
                    : toText(row.merchantName || row.merchant, 'Unknown');

            const amount = Number(row.amountPence || 0);
            groupedTotals[key] = (groupedTotals[key] || 0) + amount;
            monthsSet.add(month);
            if (!groupedByMonth[month]) groupedByMonth[month] = {};
            groupedByMonth[month][key] = (groupedByMonth[month][key] || 0) + amount;
        });

        const groups = Object.entries(groupedTotals)
            .map(([name, amountPence]) => ({ name, amountPence }))
            .sort((a, b) => b.amountPence - a.amountPence);

        const months = Array.from(monthsSet).sort();
        return { groups, groupedByMonth, months };
    }, [filteredAnalysisRows, analysisDimension]);

    const analysisTrendOption = useMemo(() => {
        const topGroups = analysisGrouped.groups.slice(0, 8);
        return {
            tooltip: { trigger: 'axis' },
            legend: { data: topGroups.map((group) => group.name) },
            grid: { left: 50, right: 15, top: 35, bottom: 35 },
            xAxis: {
                type: 'category',
                data: analysisGrouped.months.map((month) => monthLabel(month)),
            },
            yAxis: {
                type: 'value',
                axisLabel: { formatter: (v: number) => `£${v}` },
            },
            series: topGroups.map((group, index) => ({
                name: group.name,
                type: 'line',
                smooth: true,
                symbolSize: 6,
                itemStyle: { color: THEME_COLORS[index % THEME_COLORS.length] },
                data: analysisGrouped.months.map((month) => toPounds(Number(analysisGrouped.groupedByMonth?.[month]?.[group.name] || 0))),
            })),
        };
    }, [analysisGrouped]);

    const analysisPieOption = useMemo(() => {
        const groups = analysisGrouped.groups.slice(0, 10);
        return {
            tooltip: { trigger: 'item', valueFormatter: (v: number) => `£${v}` },
            legend: { orient: 'horizontal', bottom: 0 },
            series: [
                {
                    type: 'pie',
                    radius: ['45%', '72%'],
                    label: { show: false },
                    data: groups.map((group, index) => ({
                        name: group.name,
                        value: toPounds(group.amountPence),
                        itemStyle: { color: THEME_COLORS[index % THEME_COLORS.length] },
                    })),
                },
            ],
        };
    }, [analysisGrouped]);

    const analysisBreakdownOption = useMemo(() => {
        const groups = analysisGrouped.groups.slice(0, 20);
        return {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            grid: { left: 180, right: 20, top: 20, bottom: 20 },
            xAxis: {
                type: 'value',
                axisLabel: { formatter: (v: number) => `£${v}` },
            },
            yAxis: {
                type: 'category',
                data: groups.map((group) => group.name),
            },
            series: [
                {
                    type: 'bar',
                    data: groups.map((group, index) => ({
                        value: toPounds(group.amountPence),
                        itemStyle: { color: THEME_COLORS[index % THEME_COLORS.length] },
                    })),
                },
            ],
        };
    }, [analysisGrouped]);

    const budgetBucketOption = useMemo(() => {
        const rows = budgetHealth?.byBucket || [];
        return {
            tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            legend: { data: ['Budget', 'Actual'] },
            grid: { left: 50, right: 15, top: 30, bottom: 30 },
            xAxis: {
                type: 'category',
                data: rows.map((row: any) => row.bucket),
            },
            yAxis: {
                type: 'value',
                axisLabel: { formatter: (v: number) => `£${v}` },
            },
            series: [
                {
                    name: 'Budget',
                    type: 'bar',
                    itemStyle: { color: '#36A2EB' },
                    data: rows.map((row: any) => toPounds(row.budgetPence || 0)),
                },
                {
                    name: 'Actual',
                    type: 'bar',
                    itemStyle: { color: '#fd5d93' },
                    data: rows.map((row: any) => toPounds(row.actualPence || 0)),
                },
            ],
        };
    }, [budgetHealth]);

    const totalActionSavings = actions.reduce((sum: number, action: any) => sum + Number(action.estimatedMonthlySavings || 0), 0);

    const renderOverview = () => (
        <>
            <Row className="g-4 mb-4">
                <Col md={3}>
                    <PremiumCard icon={DollarSign} title="Total Spend">
                        <h2 className="fw-bold mb-0" style={{ color: colors.danger }}>
                            {formatCurrency(filteredTotalSpend)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">View excludes bank transfers</p>
                    </PremiumCard>
                </Col>
                <Col md={3}>
                    <PremiumCard icon={CreditCard} title="Discretionary">
                        <h2 className="fw-bold mb-0" style={{ color: colors.info }}>
                            {formatCurrency(Math.abs(data?.totalDiscretionarySpend || 0) / 100)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">Optional day-to-day spend</p>
                    </PremiumCard>
                </Col>
                <Col md={3}>
                    <PremiumCard icon={Layers} title="Subscriptions">
                        <h2 className="fw-bold mb-0" style={{ color: colors.warning }}>
                            {formatCurrency(Math.abs(data?.totalSubscriptionSpend || 0) / 100)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">Recurring costs</p>
                    </PremiumCard>
                </Col>
                <Col md={3}>
                    <PremiumCard icon={Sparkles} title="Actions Potential">
                        <h2 className="fw-bold mb-0" style={{ color: colors.success }}>
                            {formatCurrency(totalActionSavings)}
                        </h2>
                        <p className="text-muted mb-0 mt-2">Estimated monthly savings ({actions.length} actions)</p>
                    </PremiumCard>
                </Col>
            </Row>

            {budgetHealth && (
                <Row className="g-4 mb-4">
                    <Col md={3}>
                        <PremiumCard icon={Wallet} title="Budget Set">
                            <h3 className="fw-bold mb-0">{formatCurrency(toPounds(budgetHealth.totalBudgetPence || 0))}</h3>
                            <p className="text-muted mb-0 mt-2">Configured category budget</p>
                        </PremiumCard>
                    </Col>
                    <Col md={3}>
                        <PremiumCard icon={Activity} title="Actual Spend">
                            <h3 className="fw-bold mb-0" style={{ color: colors.danger }}>{formatCurrency(toPounds(budgetHealth.totalActualPence || 0))}</h3>
                            <p className="text-muted mb-0 mt-2">In selected date range</p>
                        </PremiumCard>
                    </Col>
                    <Col md={3}>
                        <PremiumCard icon={TrendingUp} title="Variance">
                            <h3 className="fw-bold mb-0" style={{ color: (budgetHealth.variancePence || 0) >= 0 ? colors.success : colors.warning }}>
                                {formatCurrency(toPounds(budgetHealth.variancePence || 0))}
                            </h3>
                            <p className="text-muted mb-0 mt-2">Budget minus actual</p>
                        </PremiumCard>
                    </Col>
                    <Col md={3}>
                        <PremiumCard icon={Target} title="Budget Used">
                            <h3 className="fw-bold mb-0">{Number(budgetHealth.utilizationPct || 0).toFixed(1)}%</h3>
                            <p className="text-muted mb-0 mt-2">Utilization against set budget</p>
                        </PremiumCard>
                    </Col>
                </Row>
            )}

            <Row className="g-4 mb-4">
                <Col lg={8}>
                    <PremiumCard title="Spend Trend (Click bars to filter)" icon={TrendingUp} height={350}>
                        <ReactECharts
                            option={trendOption}
                            style={{ height: '100%' }}
                            onEvents={{ click: handleTrendClick }}
                        />
                    </PremiumCard>
                </Col>
                <Col lg={4}>
                    <PremiumCard
                        title="Top 10 Distribution (Click to filter)"
                        icon={PieIcon}
                        height={350}
                        action={
                            <ButtonGroup size="sm">
                                <Button variant={viewMode === 'category' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('category')}>Cat</Button>
                                <Button variant={viewMode === 'bucket' ? 'primary' : 'outline-secondary'} onClick={() => setViewMode('bucket')}>Bkt</Button>
                            </ButtonGroup>
                        }
                    >
                        <ReactECharts
                            option={distributionOption}
                            style={{ height: '100%' }}
                            onEvents={{ click: handlePieClick }}
                        />
                    </PremiumCard>
                </Col>
            </Row>

            {/* Transaction Table with Active Filter Badge */}
            <Row className="mb-4">
                <Col>
                    <PremiumCard
                        title={`Recent Transactions (${filteredRecentTransactions.length})`}
                        icon={CreditCard}
                        action={
                            chartFilter.type && chartFilter.value ? (
                                <div className="d-flex align-items-center gap-2">
                                    <Badge bg="primary">
                                        {chartFilter.type}: {chartFilter.value}
                                    </Badge>
                                    <Button size="sm" variant="outline-secondary" onClick={clearChartFilter}>
                                        Clear Filter
                                    </Button>
                                </div>
                            ) : undefined
                        }
                    >
                        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                            <table className="table table-sm table-hover">
                                <thead className="sticky-top bg-white" style={{ top: 0, zIndex: 1 }}>
                                    <tr>
                                        <th>Date</th>
                                        <th>Merchant</th>
                                        <th>Category</th>
                                        <th>Bucket</th>
                                        <th>Pot</th>
                                        <th className="text-end">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRecentTransactions.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="text-center text-muted py-4">
                                                No transactions match the current filter
                                            </td>
                                        </tr>
                                    )}
                                    {filteredRecentTransactions.slice(0, 100).map((tx: any) => {
                                        const createdDate = parseTxDate(tx);
                                        const dateStr = createdDate ? createdDate.toLocaleDateString('en-GB', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric'
                                        }) : '—';
                                        const amount = txAmountMinor(tx) / 100;
                                        const isNegative = amount < 0;

                                        return (
                                            <tr key={tx.id || Math.random()}>
                                                <td style={{ whiteSpace: 'nowrap' }}>{dateStr}</td>
                                                <td>{tx.__merchantLabel}</td>
                                                <td>
                                                    <small className="text-muted">{tx.__categoryLabel}</small>
                                                </td>
                                                <td>
                                                    <Badge
                                                        bg={
                                                            tx.__bucketLabel.toLowerCase().includes('mandatory') ? 'danger' :
                                                            tx.__bucketLabel.toLowerCase().includes('discretionary') ? 'warning' :
                                                            tx.__bucketLabel.toLowerCase().includes('saving') ? 'info' :
                                                            'secondary'
                                                        }
                                                        className="text-uppercase"
                                                        style={{ fontSize: '0.65rem' }}
                                                    >
                                                        {tx.__bucketLabel}
                                                    </Badge>
                                                </td>
                                                <td><small className="text-muted">{tx.__potLabel}</small></td>
                                                <td className="text-end" style={{
                                                    fontWeight: 600,
                                                    color: isNegative ? '#dc3545' : '#28a745'
                                                }}>
                                                    {isNegative ? '-' : '+'}£{Math.abs(amount).toFixed(2)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            {filteredRecentTransactions.length > 100 && (
                                <div className="text-center text-muted py-2">
                                    <small>Showing first 100 of {filteredRecentTransactions.length} transactions</small>
                                </div>
                            )}
                        </div>
                    </PremiumCard>
                </Col>
            </Row>

            <Row className="g-4">
                <Col lg={8}>
                    <PremiumCard title="Recent Transactions" icon={CreditCard}>
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0" style={{ color: colors.text }}>
                                <thead>
                                    <tr style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.grid}` }}>
                                        <th>Date</th>
                                        <th>Merchant</th>
                                        <th>Pot</th>
                                        <th>Category</th>
                                        <th className="text-end">Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredRecentTransactions.map((tx: any) => {
                                        const date = parseTxDate(tx);
                                        const rowKey = toKeyText(tx.id || tx.transactionId, `${tx.__merchantLabel}-${tx.__categoryLabel}-${txAmountMinor(tx)}`);
                                        return (
                                            <tr key={rowKey} style={{ borderColor: colors.grid }}>
                                                <td>{date ? date.toLocaleDateString('en-GB') : '—'}</td>
                                                <td>
                                                    <div className="fw-bold">{tx.__merchantLabel}</div>
                                                    {tx.isSubscription && <Badge bg="warning" text="dark" className="mt-1">Sub</Badge>}
                                                </td>
                                                <td>{tx.__potLabel}</td>
                                                <td>
                                                    <Badge bg="light" text="dark" className="border">
                                                        {tx.__categoryLabel}
                                                    </Badge>
                                                </td>
                                                <td className="text-end fw-bold" style={{ color: Number(txAmountMinor(tx)) < 0 ? colors.text : colors.success }}>
                                                    {formatCurrency(Math.abs(txAmountMinor(tx)) / 100)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </PremiumCard>
                </Col>
                <Col lg={4}>
                    <PremiumCard title="Spend Anomalies" icon={Activity}>
                        {Array.isArray(data?.anomalyTransactions) && data.anomalyTransactions.length ? (
                            <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0" style={{ color: colors.text }}>
                                    <thead>
                                        <tr style={{ color: colors.textMuted, borderBottom: `1px solid ${colors.grid}` }}>
                                            <th>Merchant</th>
                                            <th>Reason</th>
                                            <th className="text-end">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {data.anomalyTransactions.map((tx: any) => (
                                            <tr key={toKeyText(tx.id, `anomaly-${toText(tx.merchantName || tx.merchant?.name, 'unknown')}-${txAmountMinor(tx)}`)} style={{ borderColor: colors.grid }}>
                                                <td>{toText(tx.merchantName || tx.merchant?.name || tx.merchant, 'Unknown')}</td>
                                                <td className="small text-muted">{tx.aiAnomalyReason || 'Anomaly'}</td>
                                                <td className="text-end fw-bold">{formatCurrency(Math.abs(txAmountMinor(tx)) / 100)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            <div className="text-muted small">No anomalies detected in the selected period.</div>
                        )}
                    </PremiumCard>
                </Col>
            </Row>
        </>
    );

    const renderSpendAnalysis = () => (
        <>
            <Row className="g-4 mb-4">
                <Col md={4}>
                    <PremiumCard icon={DollarSign} title="Filtered Spend">
                        <h3 className="fw-bold mb-0">{formatCurrency(toPounds(analysisStats.totalPence || 0))}</h3>
                        <p className="text-muted mb-0 mt-2">Based on active filters</p>
                    </PremiumCard>
                </Col>
                <Col md={4}>
                    <PremiumCard icon={Layers} title="Transactions">
                        <h3 className="fw-bold mb-0">{analysisStats.count}</h3>
                        <p className="text-muted mb-0 mt-2">Rows in analysis set</p>
                    </PremiumCard>
                </Col>
                <Col md={4}>
                    <PremiumCard icon={TrendingUp} title="Avg Transaction">
                        <h3 className="fw-bold mb-0">{formatCurrency(toPounds(analysisStats.avgPence || 0))}</h3>
                        <p className="text-muted mb-0 mt-2">Average spend per transaction</p>
                    </PremiumCard>
                </Col>
            </Row>

            <Row className="g-4 mb-4">
                <Col lg={12}>
                    <PremiumCard
                        title="Spend Analysis"
                        icon={PieIcon}
                        action={
                            <ButtonGroup size="sm">
                                <Button variant={analysisChartType === 'trend' ? 'primary' : 'outline-secondary'} onClick={() => setAnalysisChartType('trend')}>Trend</Button>
                                <Button variant={analysisChartType === 'pie' ? 'primary' : 'outline-secondary'} onClick={() => setAnalysisChartType('pie')}>Pie</Button>
                                <Button variant={analysisChartType === 'breakdown' ? 'primary' : 'outline-secondary'} onClick={() => setAnalysisChartType('breakdown')}>Breakdown</Button>
                            </ButtonGroup>
                        }
                    >
                        <Row className="g-3 mb-3">
                            <Col md={3}>
                                <Form.Label>Group by</Form.Label>
                                <Form.Select value={analysisDimension} onChange={(event) => setAnalysisDimension(event.target.value as AnalysisDimension)}>
                                    <option value="bucket">Bucket</option>
                                    <option value="category">Category</option>
                                    <option value="merchant">Merchant</option>
                                </Form.Select>
                            </Col>
                            <Col md={3}>
                                <Form.Label>Bucket filter</Form.Label>
                                <Form.Select value={analysisBucketFilter} onChange={(event) => setAnalysisBucketFilter(event.target.value)}>
                                    <option value="all">All buckets</option>
                                    {analysisBucketOptions.map((bucket) => (
                                        <option key={bucket} value={bucket}>{bucket}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                            <Col md={3}>
                                <Form.Label>Category filter</Form.Label>
                                <Form.Select value={analysisCategoryFilter} onChange={(event) => setAnalysisCategoryFilter(event.target.value)}>
                                    <option value="all">All categories</option>
                                    {analysisCategoryOptions.map((category) => (
                                        <option key={category} value={category}>{category}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                            <Col md={3}>
                                <Form.Label>Merchant filter</Form.Label>
                                <Form.Select value={analysisMerchantFilter} onChange={(event) => setAnalysisMerchantFilter(event.target.value)}>
                                    <option value="all">All merchants</option>
                                    {analysisMerchantOptions.map((merchant) => (
                                        <option key={merchant} value={merchant}>{merchant}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                        </Row>

                        {analysisChartType === 'trend' && <ReactECharts option={analysisTrendOption} style={{ height: 360 }} />}
                        {analysisChartType === 'pie' && <ReactECharts option={analysisPieOption} style={{ height: 360 }} />}
                        {analysisChartType === 'breakdown' && <ReactECharts option={analysisBreakdownOption} style={{ height: 360 }} />}
                    </PremiumCard>
                </Col>
            </Row>

            <Row className="g-4 mb-4">
                <Col lg={8}>
                    <PremiumCard title="Multi-Year Spend Tracking" icon={TrendingUp} height={360}>
                        <ReactECharts option={spendTrackingOption} style={{ height: '100%' }} />
                    </PremiumCard>
                </Col>
                <Col lg={4}>
                    <PremiumCard title="Coverage" icon={Calendar}>
                        <div className="small text-muted mb-2">Monzo coverage</div>
                        <div className="mb-2">
                            <strong>From:</strong> {enhancementData?.coverage?.monzoCoverageStartISO ? new Date(enhancementData.coverage.monzoCoverageStartISO).toLocaleDateString('en-GB') : '—'}
                        </div>
                        <div className="mb-2">
                            <strong>To:</strong> {enhancementData?.coverage?.monzoCoverageEndISO ? new Date(enhancementData.coverage.monzoCoverageEndISO).toLocaleDateString('en-GB') : '—'}
                        </div>
                        <div className="mb-2">
                            <strong>Rows (range):</strong> {enhancementData?.coverage?.monzoTransactionsInRange || 0}
                        </div>
                        <div>
                            <strong>Rows (total):</strong> {enhancementData?.coverage?.monzoTransactionsTotal || 0}
                        </div>
                    </PremiumCard>
                </Col>
            </Row>

            {budgetHealth && (
                <Row className="g-4 mb-4">
                    <Col lg={7}>
                        <PremiumCard title="Budget vs Actual" icon={Target} height={360}>
                            <ReactECharts option={budgetBucketOption} style={{ height: '100%' }} />
                        </PremiumCard>
                    </Col>
                    <Col lg={5}>
                        <PremiumCard title="Budget Variance by Category" icon={Wallet}>
                            <div className="table-responsive" style={{ maxHeight: 330, overflowY: 'auto' }}>
                                <table className="table table-sm align-middle mb-0">
                                    <thead>
                                        <tr>
                                            <th>Category</th>
                                            <th className="text-end">Budget</th>
                                            <th className="text-end">Actual</th>
                                            <th className="text-end">Used</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(budgetHealth.byCategory || []).slice(0, 12).map((item: any) => (
                                            <tr key={item.categoryKey}>
                                                <td>{toText(item.categoryLabel || item.categoryKey, 'Uncategorised')}</td>
                                                <td className="text-end">{formatCurrency(toPounds(item.budgetPence || 0))}</td>
                                                <td className="text-end">{formatCurrency(toPounds(item.actualPence || 0))}</td>
                                                <td className="text-end">{Number(item.utilizationPct || 0).toFixed(0)}%</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </PremiumCard>
                    </Col>
                </Row>
            )}

            {renderCashflow()}
        </>
    );

    const renderCashflow = () => {
        const totals = cashflowSeries.reduce((acc: any, item: any) => {
            acc.inflow += item.inflowPence || 0;
            acc.outflow += item.outflowPence || 0;
            acc.net += item.netPence || 0;
            return acc;
        }, { inflow: 0, outflow: 0, net: 0 });

        const months = Math.max(1, cashflowSeries.length);

        return (
            <>
                <Row className="g-4 mb-4">
                    <Col md={4}>
                        <PremiumCard icon={ArrowUpRight} title="Avg Monthly Inflow">
                            <h3 className="fw-bold mb-0" style={{ color: colors.success }}>
                                {formatCurrency(toPounds(Math.round(totals.inflow / months)))}
                            </h3>
                        </PremiumCard>
                    </Col>
                    <Col md={4}>
                        <PremiumCard icon={ArrowUpRight} title="Avg Monthly Outflow">
                            <h3 className="fw-bold mb-0" style={{ color: colors.danger }}>
                                {formatCurrency(toPounds(Math.round(totals.outflow / months)))}
                            </h3>
                        </PremiumCard>
                    </Col>
                    <Col md={4}>
                        <PremiumCard icon={DollarSign} title="Avg Monthly Net">
                            <h3 className="fw-bold mb-0" style={{ color: totals.net >= 0 ? colors.success : colors.warning }}>
                                {formatCurrency(toPounds(Math.round(totals.net / months)))}
                            </h3>
                        </PremiumCard>
                    </Col>
                </Row>

                <Row className="mb-4">
                    <Col>
                        <PremiumCard title="Spend Flow Trend" icon={TrendingUp} height={380}>
                            <ReactECharts option={cashflowOption} style={{ height: '100%' }} />
                        </PremiumCard>
                    </Col>
                </Row>

                <Row>
                    <Col>
                        <PremiumCard title="Goal Savings Forecast" icon={Target}>
                            <div className="small text-muted mb-3">
                                ETA is based on linked pot balance versus goal target and average net pot contributions over recent months.
                            </div>
                            <div className="table-responsive">
                                <table className="table table-hover align-middle mb-0">
                                    <thead>
                                        <tr>
                                            <th>Goal</th>
                                            <th>Linked pot</th>
                                            <th className="text-end">Target</th>
                                            <th className="text-end">Current</th>
                                            <th className="text-end">Remaining</th>
                                            <th className="text-end">Avg monthly in</th>
                                            <th className="text-end">ETA</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {goalForecasts.length === 0 && (
                                            <tr>
                                                <td colSpan={7} className="text-center text-muted py-4">No linked goals found. Link goals to pots in Goal Linking.</td>
                                            </tr>
                                        )}
                                        {goalForecasts.map((goal: any) => (
                                            <tr key={goal.goalId}>
                                                <td>{goal.goalTitle || goal.goalId}</td>
                                                <td>{goal.linkedPotName || 'No linked pot'}</td>
                                                <td className="text-end">{formatCurrency(toPounds(goal.targetAmountPence || 0))}</td>
                                                <td className="text-end">{formatCurrency(toPounds(goal.currentBalancePence || 0))}</td>
                                                <td className="text-end">{formatCurrency(toPounds(goal.remainingPence || 0))}</td>
                                                <td className="text-end">{formatCurrency(toPounds(goal.monthlyContributionPence || 0))}</td>
                                                <td className="text-end">
                                                    {goal.etaMonths ? (
                                                        <span>{goal.etaMonths} mo ({goal.etaDateISO ? new Date(goal.etaDateISO).toLocaleDateString('en-GB') : 'TBC'})</span>
                                                    ) : (
                                                        <span className="text-muted">Insufficient inflow</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </PremiumCard>
                    </Col>
                </Row>
            </>
        );
    };

    const renderOptionalSpend = () => (
        <>
            <Row className="g-4 mb-4">
                {optionalSpendCards.length === 0 && (
                    <Col>
                        <Alert variant="secondary" className="mb-0">No optional spend cards available for this range.</Alert>
                    </Col>
                )}
                {optionalSpendCards.map((item: any) => (
                    <Col key={item.__merchantKey} xl={3} lg={4} md={6}>
                        <PremiumCard title={item.__merchantName} icon={Layers} className="finance-optional-card">
                            <div className="d-flex justify-content-between small text-muted mb-2">
                                <span>Monthly avg</span>
                                <strong>{formatCurrency(toPounds(item.avgMonthlySpendPence || 0))}</strong>
                            </div>
                            <div className="d-flex justify-content-between small text-muted mb-2">
                                <span>Total spend</span>
                                <strong>{formatCurrency(toPounds(item.totalSpendPence || 0))}</strong>
                            </div>
                            <div className="d-flex justify-content-between small text-muted mb-3">
                                <span>Transactions</span>
                                <strong>{item.transactions || 0}</strong>
                            </div>
                            <div>
                                {item.recurring ? (
                                    <Badge bg="warning" text="dark">Recurring ({item.activeMonths} months)</Badge>
                                ) : (
                                    <Badge bg="secondary">Ad-hoc spend</Badge>
                                )}
                            </div>
                        </PremiumCard>
                    </Col>
                ))}
            </Row>
        </>
    );

    const renderActions = () => (
        <>
            <Row className="g-4 mb-4">
                <Col md={4}>
                    <PremiumCard title="Open Actions" icon={Sparkles}>
                        <h3 className="fw-bold mb-0">{actions.length}</h3>
                    </PremiumCard>
                </Col>
                <Col md={4}>
                    <PremiumCard title="Potential Monthly Savings" icon={DollarSign}>
                        <h3 className="fw-bold mb-0" style={{ color: colors.success }}>{formatCurrency(totalActionSavings)}</h3>
                    </PremiumCard>
                </Col>
                <Col md={4}>
                    <PremiumCard title="Debt Interest (Estimated)" icon={CreditCard}>
                        <h3 className="fw-bold mb-0" style={{ color: colors.warning }}>
                            {formatCurrency(toPounds(debtService?.estimatedInterestPence || 0))}
                        </h3>
                    </PremiumCard>
                </Col>
            </Row>

            <Row>
                <Col>
                    <PremiumCard
                        title="Action-Oriented Optimizations"
                        icon={CheckCircle2}
                        action={
                            <Button size="sm" variant="outline-primary" onClick={handleRegenerateActions} disabled={busy}>
                                {busy ? 'Working…' : 'Regenerate'}
                            </Button>
                        }
                    >
                        <div className="small text-muted mb-3">
                            Actions are generated from recurring spend + debt servicing signals, then optionally refined by AI.
                        </div>
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th>Action</th>
                                        <th>Type</th>
                                        <th className="text-end">Monthly saving</th>
                                        <th className="text-end">Confidence</th>
                                        <th>Status</th>
                                        <th className="text-end">Story</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {actions.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="text-center text-muted py-4">No actions yet. Run action generation from Data Sources.</td>
                                        </tr>
                                    )}
                                    {actions.map((action: any) => (
                                        <tr key={toKeyText(action.id, `${action.__merchantKey}-${action.type || 'review'}`)}>
                                            <td>
                                                <div className="fw-semibold">{action.__title}</div>
                                                <div className="small text-muted">{action.__reason}</div>
                                            </td>
                                            <td>
                                                <Badge bg="light" text="dark" className="border text-uppercase">{action.type || 'review'}</Badge>
                                            </td>
                                            <td className="text-end fw-semibold">{formatCurrency(Number(action.estimatedMonthlySavings || 0))}</td>
                                            <td className="text-end">{Math.round(Number(action.confidence || 0) * 100)}%</td>
                                            <td>
                                                {action.storyId ? (
                                                    <Badge bg="success">Converted</Badge>
                                                ) : (
                                                    <Badge bg="secondary">Open</Badge>
                                                )}
                                            </td>
                                            <td className="text-end">
                                                {action.storyId ? (
                                                    <a className="btn btn-sm btn-outline-secondary" href={`/stories/${action.storyId}`}>
                                                        Open story
                                                    </a>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="primary"
                                                        onClick={() => handleConvertActionToStory(action.id)}
                                                        disabled={convertingActionId === action.id}
                                                    >
                                                        {convertingActionId === action.id ? 'Converting…' : 'Convert to story'}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </PremiumCard>
                </Col>
            </Row>
        </>
    );

    const renderDataSources = () => (
        <>
            <Row className="g-4 mb-4">
                <Col lg={5}>
                    <PremiumCard title="External Source Import" icon={Upload}>
                        <Form.Group className="mb-3">
                            <Form.Label>Source</Form.Label>
                            <Form.Select value={externalSource} onChange={(event) => setExternalSource(event.target.value as ExternalSource)}>
                                <option value="monzo_csv">Monzo (historical CSV backfill)</option>
                                <option value="barclays">Barclays / Barclaycard</option>
                                <option value="paypal">PayPal</option>
                                <option value="other">Other</option>
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>CSV file</Form.Label>
                            <Form.Control type="file" accept=".csv,text/csv" onChange={handleCsvFileUpload} />
                            <div className="small text-muted mt-1">
                                {csvFileName
                                    ? `Loaded: ${csvFileName}`
                                    : externalSource === 'monzo_csv'
                                        ? 'Choose a Monzo export CSV (Transaction ID, Date, Time, Amount, Category, etc.).'
                                        : 'Choose a source export CSV to import.'}
                            </div>
                        </Form.Group>

                        {externalSource !== 'monzo_csv' && (
                            <Row className="g-2 mb-3">
                                <Col>
                                    <Form.Label>Date window (days)</Form.Label>
                                    <Form.Control
                                        type="number"
                                        min={1}
                                        max={30}
                                        value={windowDays}
                                        onChange={(event) => setWindowDays(Number(event.target.value || 5))}
                                    />
                                </Col>
                                <Col>
                                    <Form.Label>Amount tolerance (pence)</Form.Label>
                                    <Form.Control
                                        type="number"
                                        min={1}
                                        max={2_000}
                                        value={amountTolerancePence}
                                        onChange={(event) => setAmountTolerancePence(Number(event.target.value || 150))}
                                    />
                                </Col>
                            </Row>
                        )}

                        <div className="d-flex flex-wrap gap-2">
                            <Button variant="primary" onClick={handleImportAndRebuild} disabled={busy}>
                                {busy ? 'Running…' : externalSource === 'monzo_csv' ? 'Import + Rebuild analytics' : 'Import + Match + Rebuild'}
                            </Button>
                            <Button variant="outline-secondary" onClick={handleRematch} disabled={busy || externalSource === 'monzo_csv'}>
                                Match only
                            </Button>
                            <Button variant="outline-secondary" onClick={handleRegenerateActions} disabled={busy || externalSource === 'monzo_csv'}>
                                Rebuild actions
                            </Button>
                        </div>
                    </PremiumCard>
                </Col>

                <Col lg={7}>
                    <PremiumCard title="Source Coverage & Matching" icon={Link2}>
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th>Source</th>
                                        <th className="text-end">Rows</th>
                                        <th className="text-end">Spend</th>
                                        <th className="text-end">Matched</th>
                                        <th className="text-end">Unmatched</th>
                                        <th>Coverage</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {externalSummary.length === 0 && (
                                        <tr>
                                            <td colSpan={6} className="text-center text-muted py-4">No external data imported yet.</td>
                                        </tr>
                                    )}
                                    {externalSummary.map((sourceItem: any) => {
                                        const matchItem = matchBySource.get(sourceItem.source) || {};
                                        return (
                                            <tr key={sourceItem.source}>
                                                <td className="text-capitalize">{sourceItem.source}</td>
                                                <td className="text-end">{sourceItem.rows || 0}</td>
                                                <td className="text-end">{formatCurrency(toPounds(sourceItem.spendPence || 0))}</td>
                                                <td className="text-end">{matchItem.matched || 0}</td>
                                                <td className="text-end">{matchItem.unmatched || 0}</td>
                                                <td className="small text-muted">
                                                    {sourceItem.firstDateISO ? new Date(sourceItem.firstDateISO).toLocaleDateString('en-GB') : '—'}
                                                    {' → '}
                                                    {sourceItem.lastDateISO ? new Date(sourceItem.lastDateISO).toLocaleDateString('en-GB') : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </PremiumCard>
                </Col>
            </Row>

            <Row>
                <Col>
                    <PremiumCard title="Debt Servicing Breakdown" icon={CreditCard}>
                        {debtService ? (
                            <Row className="g-4">
                                <Col md={3}>
                                    <div className="small text-muted">Card spend</div>
                                    <div className="fw-semibold">{formatCurrency(toPounds(debtService.statementSpendPence || 0))}</div>
                                </Col>
                                <Col md={3}>
                                    <div className="small text-muted">Monzo payments</div>
                                    <div className="fw-semibold">{formatCurrency(toPounds(debtService.monzoPaymentsPence || 0))}</div>
                                </Col>
                                <Col md={3}>
                                    <div className="small text-muted">Estimated interest</div>
                                    <div className="fw-semibold">{formatCurrency(toPounds(debtService.estimatedInterestPence || 0))}</div>
                                </Col>
                                <Col md={3}>
                                    <div className="small text-muted">Estimated principal</div>
                                    <div className="fw-semibold">{formatCurrency(toPounds(debtService.principalRepaymentPence || 0))}</div>
                                </Col>
                            </Row>
                        ) : (
                            <div className="text-muted small">Debt service data will appear after import + matching.</div>
                        )}
                    </PremiumCard>
                </Col>
            </Row>
        </>
    );

    const renderAssets = () => (
        <>
            <Row className="g-4 mb-4">
                <Col md={3}>
                    <PremiumCard title="Tracked Assets" icon={Landmark}>
                        <h3 className="fw-bold mb-0" style={{ color: colors.success }}>
                            {formatCurrency(toPounds(manualAccountSummary.totalAssetPence || 0))}
                        </h3>
                    </PremiumCard>
                </Col>
                <Col md={3}>
                    <PremiumCard title="Tracked Debts" icon={CreditCard}>
                        <h3 className="fw-bold mb-0" style={{ color: colors.danger }}>
                            {formatCurrency(toPounds(manualAccountSummary.totalDebtPence || 0))}
                        </h3>
                    </PremiumCard>
                </Col>
                <Col md={3}>
                    <PremiumCard title="Net Worth" icon={Wallet}>
                        <h3 className="fw-bold mb-0" style={{ color: (manualAccountSummary.netWorthPence || 0) >= 0 ? colors.success : colors.warning }}>
                            {formatCurrency(toPounds(manualAccountSummary.netWorthPence || 0))}
                        </h3>
                    </PremiumCard>
                </Col>
                <Col md={3}>
                    <PremiumCard title="Stale Updates" icon={AlertTriangle}>
                        <h3 className="fw-bold mb-0" style={{ color: manualAccountSummary.staleCount ? colors.warning : colors.success }}>
                            {manualAccountSummary.staleCount || 0}
                        </h3>
                        <p className="text-muted mb-0 mt-2">Accounts older than 30 days</p>
                    </PremiumCard>
                </Col>
            </Row>

            <Row className="g-4 mb-4">
                <Col lg={5}>
                    <PremiumCard title={editingManualAccountId ? 'Update Account' : 'Add Account'} icon={Wallet}>
                        <Form.Group className="mb-2">
                            <Form.Label>Name</Form.Label>
                            <Form.Control
                                value={manualForm.name}
                                onChange={(event) => setManualForm((prev) => ({ ...prev, name: event.target.value }))}
                                placeholder="e.g. Hargreaves Lansdown ISA"
                            />
                        </Form.Group>
                        <Form.Group className="mb-2">
                            <Form.Label>Institution</Form.Label>
                            <Form.Control
                                value={manualForm.institution}
                                onChange={(event) => setManualForm((prev) => ({ ...prev, institution: event.target.value }))}
                                placeholder="e.g. Hargreaves Lansdown"
                            />
                        </Form.Group>
                        <Row className="g-2 mb-2">
                            <Col>
                                <Form.Label>Type</Form.Label>
                                <Form.Select
                                    value={manualForm.type}
                                    onChange={(event) => setManualForm((prev) => ({ ...prev, type: normalizeManualType(event.target.value) }))}
                                >
                                    <option value="asset">Asset</option>
                                    <option value="investment">Investment</option>
                                    <option value="cash">Cash / Savings</option>
                                    <option value="savings">Savings goal</option>
                                    <option value="debt">Debt / Liability</option>
                                </Form.Select>
                            </Col>
                            <Col>
                                <Form.Label>Currency</Form.Label>
                                <Form.Control
                                    value={manualForm.currency}
                                    maxLength={3}
                                    onChange={(event) => setManualForm((prev) => ({ ...prev, currency: event.target.value.toUpperCase() }))}
                                />
                            </Col>
                        </Row>
                        <Form.Group className="mb-3">
                            <Form.Label>Balance</Form.Label>
                            <Form.Control
                                type="number"
                                step="0.01"
                                value={manualForm.balance}
                                onChange={(event) => setManualForm((prev) => ({ ...prev, balance: event.target.value }))}
                                placeholder="0.00"
                            />
                        </Form.Group>
                        <div className="d-flex gap-2">
                            <Button onClick={handleSaveManualAccount} disabled={manualBusy}>
                                {manualBusy ? 'Saving…' : editingManualAccountId ? 'Update' : 'Add'}
                            </Button>
                            <Button variant="outline-secondary" onClick={resetManualForm} disabled={manualBusy}>
                                Clear
                            </Button>
                        </div>
                    </PremiumCard>
                </Col>

                <Col lg={7}>
                    <PremiumCard title="Assets / Debts Register" icon={Landmark}>
                        {manualAccountSummary.staleCount > 0 && (
                            <Alert variant="warning" className="py-2">
                                {manualAccountSummary.staleCount} account(s) have not been updated in over 30 days.
                            </Alert>
                        )}
                        <div className="table-responsive">
                            <table className="table table-hover align-middle mb-0">
                                <thead>
                                    <tr>
                                        <th>Account</th>
                                        <th>Type</th>
                                        <th className="text-end">Balance</th>
                                        <th>Last update</th>
                                        <th className="text-end">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {manualAccounts.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="text-center text-muted py-4">
                                                Add assets, debts, and investment accounts to track full financial health.
                                            </td>
                                        </tr>
                                    )}
                                    {manualAccounts.map((account: any) => (
                                        <tr key={account.accountId}>
                                            <td>
                                                <div className="fw-semibold">{account.name}</div>
                                                <div className="small text-muted">{account.institution || 'No institution'}</div>
                                            </td>
                                            <td>
                                                <Badge bg={account.type === 'debt' ? 'danger' : 'info'} className="text-uppercase">
                                                    {account.type}
                                                </Badge>
                                            </td>
                                            <td className="text-end fw-semibold">{formatCurrency(toPounds(account.balancePence || 0))}</td>
                                            <td>
                                                {account.updatedAtISO ? new Date(account.updatedAtISO).toLocaleDateString('en-GB') : '—'}
                                                {account.isStale && <Badge bg="warning" text="dark" className="ms-2">Stale</Badge>}
                                            </td>
                                            <td className="text-end">
                                                <Button size="sm" variant="outline-secondary" className="me-2" onClick={() => startEditManualAccount(account)}>
                                                    Edit
                                                </Button>
                                                <Button size="sm" variant="outline-danger" onClick={() => handleDeleteManualAccount(account.accountId)}>
                                                    <Trash2 size={14} />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </PremiumCard>
                </Col>
            </Row>
        </>
    );

    if (loading && !data) {
        return (
            <div className="p-5 text-center">
                <Spinner animation="border" variant="primary" />
            </div>
        );
    }

    if (!data) {
        return <Alert variant="danger">{error || 'Failed to load data.'}</Alert>;
    }

    const viewButtons: Array<{ key: FinanceView; label: string }> = [
        { key: 'overview', label: 'Overview' },
        { key: 'spend', label: 'Spend analysis + Forecast' },
        { key: 'discretionary', label: 'Discretionary spend' },
        { key: 'actions', label: 'Actions' },
        { key: 'sources', label: 'Data sources' },
        { key: 'assets', label: 'Assets & Debts' },
    ];

    return (
        <div className="container-fluid py-4" style={{ backgroundColor: isDark ? '#1e1e2f' : '#f4f5f7', minHeight: '100vh', color: colors.text }}>
            {userBadge}

            <div className="d-flex flex-column flex-xl-row justify-content-between align-items-xl-center mb-4 gap-3">
                <div>
                    <h2 className="fw-bold mb-1">Finance Intelligence Dashboard</h2>
                    <div className="d-flex align-items-center gap-2 text-muted">
                        <Calendar size={16} />
                        <span>
                            {filter === 'month' && 'This Month'}
                            {filter === 'quarter' && 'This Quarter'}
                            {filter === 'year' && 'This Year'}
                            {filter === 'all' && 'All History (since 2018)'}
                            {filter === 'custom' && 'Custom Range'}
                        </span>
                        {lastSync && (
                            <>
                                <span className="mx-1">•</span>
                                <RefreshCw size={14} className={syncing ? 'spin' : ''} />
                                <small>Synced {lastSync.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit' })}</small>
                            </>
                        )}
                    </div>
                </div>

                <div className="d-flex flex-wrap gap-2 align-items-center">
                    <ButtonGroup>
                        <Button variant={filter === 'month' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('month')}>Month</Button>
                        <Button variant={filter === 'quarter' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('quarter')}>Quarter</Button>
                        <Button variant={filter === 'year' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('year')}>Year</Button>
                        <Button variant={filter === 'all' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('all')}>All</Button>
                        <Button variant={filter === 'custom' ? 'primary' : 'outline-secondary'} onClick={() => setFilter('custom')}>Custom</Button>
                    </ButtonGroup>

                    <Form.Control
                        type="date"
                        size="sm"
                        value={startDate}
                        onChange={(event) => {
                            setFilter('custom');
                            setStartDate(event.target.value);
                        }}
                        style={{ maxWidth: 150 }}
                    />
                    <Form.Control
                        type="date"
                        size="sm"
                        value={endDate}
                        onChange={(event) => {
                            setFilter('custom');
                            setEndDate(event.target.value);
                        }}
                        style={{ maxWidth: 150 }}
                    />

                    <Button variant="outline-primary" onClick={handleSync} disabled={syncing}>
                        {syncing ? <Spinner size="sm" animation="border" /> : <RefreshCw size={18} />}
                    </Button>
                </div>
            </div>

            <div className="finance-dashboard-view-switch mb-4">
                <ButtonGroup>
                    {viewButtons.map((button) => (
                        <Button
                            key={button.key}
                            variant={activeView === button.key ? 'primary' : 'outline-secondary'}
                            onClick={() => handleViewChange(button.key)}
                        >
                            {button.label}
                        </Button>
                    ))}
                </ButtonGroup>
            </div>

            {error && (
                <Alert variant="danger" className="mb-3">
                    {error}
                </Alert>
            )}
            {opsMessage && (
                <Alert variant="success" className="mb-3">
                    {opsMessage}
                </Alert>
            )}
            {!enhancementData && (
                <Alert variant="warning" className="mb-3">
                    Advanced analytics data is unavailable. Run a Monzo sync and refresh.
                </Alert>
            )}

            {activeView === 'overview' && renderOverview()}
            {activeView === 'spend' && renderSpendAnalysis()}
            {activeView === 'discretionary' && renderOptionalSpend()}
            {activeView === 'actions' && renderActions()}
            {activeView === 'sources' && renderDataSources()}
            {activeView === 'assets' && renderAssets()}
        </div>
    );
};

export default FinanceDashboardAdvanced;
