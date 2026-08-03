// Frontend mirror of functions/finance/bucketResolver.js.
//
// Two copies exist because CRA's ModuleScopePlugin blocks importing from
// ../../functions/, and a build step for one module is not worth it in a repo
// whose build is a bash script. financeBuckets.parity.test.ts fails loudly if
// the two drift.
//
// The behaviour this fixes: analytics.js used to rank `aiBucket` above
// `userCategoryType`, and TransactionsList still does at six call sites, so a
// transaction recategorised by hand kept reporting under the AI's bucket.

import type { CategoryBucket, FinanceCategory } from './financeCategories';

export type { CategoryBucket } from './financeCategories';

/** Where the resolved bucket came from. Surfaced in the UI so a wrong bucket is diagnosable. */
export type BucketSource =
    | 'pot'
    | 'user_key'
    | 'user_type'
    | 'ai_bucket'
    | 'ai_key'
    | 'default'
    | 'none';

/** V4 — what userCategoryType/defaultCategoryType actually store, and how monzo_budget_summary.totals is keyed. */
export type BucketV4 = 'mandatory' | 'optional' | 'savings' | 'income';

export const V10_BUCKETS: CategoryBucket[] = [
    'mandatory',
    'discretionary',
    'net_salary',
    'irregular_income',
    'short_saving',
    'long_saving',
    'investment',
    'bank_transfer',
    'debt_repayment',
    'unknown',
];

export const V4_BUCKETS: BucketV4[] = ['mandatory', 'optional', 'savings', 'income'];

/** V4 -> V10. Lossy for savings (3 V10 buckets) and income (2). */
export const WIDEN_V4_TO_V10: Record<BucketV4, CategoryBucket> = {
    mandatory: 'mandatory',
    optional: 'discretionary',
    savings: 'short_saving',
    income: 'net_salary',
};

/** V10 -> V4. bank_transfer and unknown have no V4 home — callers exclude them. */
export const NARROW_V10_TO_V4: Partial<Record<CategoryBucket, BucketV4>> = {
    mandatory: 'mandatory',
    debt_repayment: 'mandatory',
    discretionary: 'optional',
    short_saving: 'savings',
    long_saving: 'savings',
    investment: 'savings',
    net_salary: 'income',
    irregular_income: 'income',
};

const COARSE_WIDENINGS = new Set(['savings', 'income']);

const normaliseBucketName = (value: unknown): string => String(value ?? '').trim().toLowerCase();

/** V4 (or a V10 value passed through) -> V10. null for unrecognised input. */
export function widenToV10(value: unknown): CategoryBucket | null {
    const raw = normaliseBucketName(value);
    if (!raw) return null;
    if ((V10_BUCKETS as string[]).includes(raw)) return raw as CategoryBucket;
    return WIDEN_V4_TO_V10[raw as BucketV4] ?? null;
}

/** V10 (or a V4 value passed through) -> V4. null for bank_transfer/unknown. */
export function narrowToV4(value: unknown): BucketV4 | null {
    const raw = normaliseBucketName(value);
    if (!raw) return null;
    if ((V4_BUCKETS as string[]).includes(raw)) return raw as BucketV4;
    return NARROW_V10_TO_V4[raw as CategoryBucket] ?? null;
}

/** True when widenToV10 had to guess which of several V10 buckets was meant. */
export function isCoarseWidening(value: unknown): boolean {
    return COARSE_WIDENINGS.has(normaliseBucketName(value));
}

export type CategoryIndex = Map<string, Pick<FinanceCategory, 'key' | 'label' | 'bucket'>>;

export function buildCategoryIndex(categories: Array<Partial<FinanceCategory>> | null | undefined): CategoryIndex {
    const index: CategoryIndex = new Map();
    (categories || []).forEach((category) => {
        if (!category || !category.key) return;
        index.set(String(category.key).toLowerCase(), category as FinanceCategory);
    });
    return index;
}

function lookupCategory(categoryIndex: CategoryIndex | null, key: unknown) {
    if (!categoryIndex || !key) return null;
    return categoryIndex.get(String(key).trim().toLowerCase()) || null;
}

export interface PotTransfer {
    potId: string;
    potName: string;
    direction: 'to' | 'from';
}

/** Signed amount in pounds. Tolerates the three shapes on monzo_transactions. */
export function amountOf(tx: any): number {
    if (!tx) return 0;
    if (typeof tx.amount === 'number' && Number.isFinite(tx.amount)) return tx.amount;
    if (typeof tx.amountMinor === 'number' && Number.isFinite(tx.amountMinor)) return tx.amountMinor / 100;
    const raw = Number(tx?.raw?.amount);
    return Number.isFinite(raw) ? raw / 100 : 0;
}

export function resolvePotTransfer(tx: any, potIndex?: Map<string, any> | null): PotTransfer | null {
    const metadata = tx?.metadata || {};
    const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
    if (!potId) return null;
    const pot = potIndex ? potIndex.get(String(potId).toLowerCase()) : null;
    const potName = pot?.name || pot?.title || potId;
    const isToPot = !!metadata.destination_pot_id || (!metadata.source_pot_id && amountOf(tx) < 0);
    return { potId, potName, direction: isToPot ? 'to' : 'from' };
}

export interface ResolvedCategory {
    bucket: CategoryBucket;
    bucketV4: BucketV4 | null;
    categoryKey: string;
    categoryLabel: string;
    bucketSource: BucketSource;
    bucketPrecision: 'exact' | 'coarse';
    isPotTransfer: boolean;
    potTransfer: PotTransfer | null;
}

export interface ResolveOptions {
    categoryIndex?: CategoryIndex | null;
    potIndex?: Map<string, any> | null;
}

function bucketFromKey(categoryIndex: CategoryIndex | null, key: unknown): CategoryBucket | null {
    const category = lookupCategory(categoryIndex, key);
    if (!category) return null;
    const bucket = normaliseBucketName(category.bucket);
    return (V10_BUCKETS as string[]).includes(bucket) ? (bucket as CategoryBucket) : null;
}

function firstNonEmpty(...values: unknown[]): string | null {
    for (const value of values) {
        if (value === null || value === undefined) continue;
        const text = String(value).trim();
        if (text) return text;
    }
    return null;
}

/**
 * The one precedence order:
 *   1. pot transfer  2. userCategoryKey  3. userCategoryType
 *   4. aiBucket      5. aiCategoryKey    6. defaultCategoryType  7. unknown
 *
 * (2) outranks (3) deliberately: the key is a per-transaction choice, the type is
 * rewritten from merchant_mappings on every sync and is therefore a rule.
 */
export function resolveTransactionCategory(tx: any, options: ResolveOptions = {}): ResolvedCategory {
    const { categoryIndex = null, potIndex = null } = options;
    const data = tx || {};

    const potTransfer = resolvePotTransfer(data, potIndex);
    if (potTransfer) {
        return {
            bucket: 'bank_transfer',
            bucketV4: null,
            categoryKey: 'pot_transfer',
            categoryLabel: `Transfer ${potTransfer.direction} ${potTransfer.potName}`,
            bucketSource: 'pot',
            bucketPrecision: 'exact',
            isPotTransfer: true,
            potTransfer,
        };
    }

    const candidates: Array<{ source: BucketSource; bucket: CategoryBucket | null; label?: unknown; coarse?: boolean }> = [
        { source: 'user_key', bucket: bucketFromKey(categoryIndex, data.userCategoryKey), label: data.userCategoryLabel },
        { source: 'user_type', bucket: widenToV10(data.userCategoryType), label: data.userCategoryLabel, coarse: isCoarseWidening(data.userCategoryType) },
        { source: 'ai_bucket', bucket: widenToV10(data.aiBucket), label: data.aiCategoryLabel },
        { source: 'ai_key', bucket: bucketFromKey(categoryIndex, data.aiCategoryKey), label: data.aiCategoryLabel },
        { source: 'default', bucket: widenToV10(data.defaultCategoryType), label: data.defaultCategoryLabel, coarse: isCoarseWidening(data.defaultCategoryType) },
    ];

    const hit = candidates.find((candidate) => !!candidate.bucket);

    const categoryKey = firstNonEmpty(
        data.userCategoryKey,
        data.aiCategoryKey,
        data.categoryKey,
        data.category,
    ) || 'uncategorized';

    const catalogue = lookupCategory(categoryIndex, categoryKey);
    const categoryLabel = firstNonEmpty(
        data.userCategoryLabel,
        catalogue?.label,
        data.aiCategoryLabel,
        data.defaultCategoryLabel,
        hit?.label,
    ) || 'Uncategorised';

    const bucket = hit?.bucket ?? 'unknown';

    return {
        bucket,
        bucketV4: narrowToV4(bucket),
        categoryKey: String(categoryKey).trim() || 'uncategorized',
        categoryLabel,
        bucketSource: hit?.source ?? 'none',
        bucketPrecision: hit?.coarse ? 'coarse' : 'exact',
        isPotTransfer: false,
        potTransfer: null,
    };
}
