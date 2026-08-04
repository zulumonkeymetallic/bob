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
    | 'account'
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

/** Strip the trailing "Pot" that Monzo's CSV export appends to the pot's own name. */
export function normalisePotName(value: unknown): string {
    return String(value || '')
        .trim()
        .replace(/\s+pot$/i, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

/**
 * Build the lookup `resolvePotTransfer` needs: pots keyed by id AND by normalised name,
 * because CSV-imported transfers carry no pot id and can only be matched on the name.
 * Live pots win over deleted ones — several same-named pots exist, most of them closed.
 */
export function buildPotIndex(pots: any[]): Map<string, any> {
    const index = new Map<string, any>();
    const put = (key: string, pot: any) => {
        if (!key) return;
        const existing = index.get(key);
        if (existing && existing.deleted !== true && pot.deleted === true) return;
        index.set(key, pot);
    };
    (pots || []).forEach((pot) => {
        if (!pot) return;
        put(String(pot.potId || pot.id || '').toLowerCase(), pot);
        put(normalisePotName(pot.name || pot.title), pot);
    });
    return index;
}

/**
 * Mirrors functions/finance/bucketResolver.js:resolvePotTransfer — see the rationale there.
 * Transfers from the Monzo API carry `metadata.pot_id`; CSV-backfilled ones carry only
 * `metadata.csvType === 'Pot transfer'` and a description like "Holiday Pot", and were
 * therefore counted as spend.
 */
export function resolvePotTransfer(tx: any, potIndex?: Map<string, any> | null): PotTransfer | null {
    const metadata = tx?.metadata || {};
    const explicitPotId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;

    const describedName = tx?.description || tx?.merchant?.name || '';
    const looksLikePotTransfer = String(metadata.csvType || '').toLowerCase() === 'pot transfer'
        || String(tx?.scheme || '').toLowerCase() === 'uk_retail_pot'
        || /\bpot$/i.test(String(describedName).trim());

    if (!explicitPotId && !looksLikePotTransfer) return null;

    const pot = potIndex
        ? (explicitPotId ? potIndex.get(String(explicitPotId).toLowerCase()) : null)
            || potIndex.get(normalisePotName(describedName))
            || null
        : null;

    const potName = pot?.name
        || pot?.title
        || (describedName ? String(describedName).trim().replace(/\s+pot$/i, '') : '')
        || explicitPotId
        || 'Savings pot';
    const potId = pot?.potId || pot?.id || explicitPotId || null;

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
    accountTransfer: AccountTransfer | null;
}

export interface ResolveOptions {
    categoryIndex?: CategoryIndex | null;
    potIndex?: Map<string, any> | null;
    transferAccountIndex?: Map<string, any> | null;
}

/**
 * Account kinds money can be MOVED to rather than spent at. Credit cards, loans and
 * mortgages are deliberately absent — paying those down is debt servicing, not a transfer.
 * Mirrors functions/finance/bucketResolver.js.
 */
export const TRANSFER_ACCOUNT_KINDS = [
    'current',
    'savings',
    'isa',
    'gia',
    'pension_workplace',
    'pension_personal',
];

export interface AccountTransfer {
    accountId: string | null;
    accountName: string;
    accountKind: string;
    direction: 'to' | 'from';
}

/** Index the user's own savings/investment accounts by the terms that name them in Monzo. */
export function buildTransferAccountIndex(accounts: any[]): Map<string, any> {
    const index = new Map<string, any>();
    (accounts || []).forEach((account) => {
        if (!account || account.deleted === true || account.archived === true) return;
        if (!TRANSFER_ACCOUNT_KINDS.includes(String(account.kind || '').toLowerCase())) return;
        const terms = [
            ...(Array.isArray(account.paymentMatchTerms) ? account.paymentMatchTerms : []),
            account.name,
            account.provider,
        ]
            .map((value: unknown) => String(value || '').trim().toLowerCase())
            .filter((value: string) => value.length >= 3);
        terms.forEach((term: string) => {
            if (!index.has(term)) index.set(term, account);
        });
    });
    return index;
}

/** Longest matching term wins, so a specific account beats a generic provider name. */
export function resolveAccountTransfer(tx: any, accountIndex?: Map<string, any> | null): AccountTransfer | null {
    if (!accountIndex || accountIndex.size === 0) return null;
    const haystack = [tx?.description, tx?.merchant?.name, tx?.counterparty?.name, tx?.merchantKey]
        .map((value) => String(value || '').toLowerCase())
        .join(' | ');
    if (!haystack.trim()) return null;

    let best: { term: string; account: any } | null = null;
    accountIndex.forEach((account, term) => {
        if (!haystack.includes(term)) return;
        if (!best || term.length > best.term.length) best = { term, account };
    });
    if (!best) return null;
    const match: { term: string; account: any } = best;

    return {
        accountId: match.account.accountId || match.account.id || null,
        accountName: match.account.name || 'Your account',
        accountKind: match.account.kind || 'other',
        direction: amountOf(tx) < 0 ? 'to' : 'from',
    };
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
    const { categoryIndex = null, potIndex = null, transferAccountIndex = null } = options;
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
            accountTransfer: null,
        };
    }

    // Moving money to your own ISA/GIA/pension/savings is not spend, for the same reason a
    // pot transfer is not: you still have it. Registered accounts only — never a guess.
    const accountTransfer = resolveAccountTransfer(data, transferAccountIndex);
    if (accountTransfer) {
        return {
            bucket: 'bank_transfer',
            bucketV4: null,
            categoryKey: 'account_transfer',
            categoryLabel: `Transfer ${accountTransfer.direction} ${accountTransfer.accountName}`,
            bucketSource: 'account',
            bucketPrecision: 'exact',
            isPotTransfer: false,
            potTransfer: null,
            accountTransfer,
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
        accountTransfer: null,
    };
}
