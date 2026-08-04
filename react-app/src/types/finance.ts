// Shared finance types.
//
// Before this file the finance module carried five independent transaction shapes
// (TransactionsList.TxRow, useDashboardData's hand-mapped any[], FinanceSummaryWidget.TxRow,
// the dashboard.js payload, and untyped `any` across FinanceDashboardAdvanced), plus
// locally-declared Pot types that disagreed with each other.
//
// Money is ALWAYS an integer number of pence, and the field name says so. The one
// place that convention is not enforced is the legacy finance_budgets_v2.monthlyIncome,
// which is in pounds — do not copy that.

import type { CategoryBucket } from '../utils/financeCategories';
import type { BucketSource, BucketV4 } from '../utils/financeBuckets';

export type { CategoryBucket } from '../utils/financeCategories';
export type { BucketSource, BucketV4 } from '../utils/financeBuckets';

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

/** The raw monzo_transactions document, as written by the sync writer. */
export interface MonzoTxDoc {
    id: string;
    ownerUid: string;
    accountId?: string;
    transactionId?: string;
    amountMinor?: number;
    /** Pounds — amountMinor / 100. Kept because most existing readers use it. */
    amount?: number;
    currency?: string;
    description?: string | null;
    /** Monzo's own category, not BOB's. */
    category?: string | null;
    notes?: string | null;
    merchant?: { id?: string; name?: string; emoji?: string; logo?: string; category?: string } | null;
    merchantKey?: string | null;
    counterparty?: Record<string, any> | null;
    metadata?: Record<string, any> | null;
    monthKey?: string | null;
    createdISO?: string | null;
    settledISO?: string | null;
    createdAt?: any;

    // Category signals, in resolver precedence order.
    userCategoryKey?: string | null;
    userCategoryType?: string | null;
    userCategoryLabel?: string | null;
    /** True when the category was set on THIS transaction rather than by a merchant rule. */
    manualCategory?: boolean;
    aiBucket?: string | null;
    aiCategoryKey?: string | null;
    aiCategoryLabel?: string | null;
    aiReduceSuggestion?: string | null;
    defaultCategoryType?: string | null;
    defaultCategoryLabel?: string | null;
    needsAiCategorization?: boolean;

    isSubscription?: boolean;
    aiAnomalyFlag?: boolean;
    aiAnomalyScore?: number | null;
    aiAnomalyReason?: string | null;
}

/**
 * A transaction after category resolution — the shape rendering code should read.
 * `bucketSource` is deliberately carried through so the UI can explain why a
 * transaction sits in a bucket, which is the difference between a working
 * correction loop and guesswork.
 */
export interface ResolvedTx {
    id: string;
    amountMinor: number;
    amount: number;
    createdISO: string | null;
    merchantName: string;
    merchantKey: string | null;
    categoryKey: string;
    categoryLabel: string;
    bucket: CategoryBucket;
    bucketV4: BucketV4 | null;
    bucketSource: BucketSource;
    isPotTransfer: boolean;
    isSubscription: boolean;
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export type AccountKind =
    | 'current'
    | 'savings'
    | 'credit_card'
    | 'loan'
    | 'mortgage'
    | 'isa'
    | 'gia'
    | 'pension_workplace'
    | 'pension_personal'
    | 'property'
    | 'other';

export type AccountSide = 'asset' | 'debt';

/** Which kinds count as a liability. `side` is stored on the doc but derived from this. */
export const DEBT_KINDS: AccountKind[] = ['credit_card', 'loan', 'mortgage'];

export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
    current: 'Current Account',
    savings: 'Savings',
    credit_card: 'Credit Card',
    loan: 'Loan',
    mortgage: 'Mortgage',
    isa: 'ISA',
    gia: 'General Investment Account',
    pension_workplace: 'Workplace Pension',
    pension_personal: 'Personal Pension',
    property: 'Property',
    other: 'Other',
};

/** Kinds whose value is an investment: contributed vs value is meaningful, so show return. */
export const INVESTMENT_KINDS: AccountKind[] = ['isa', 'gia', 'pension_workplace', 'pension_personal'];

export const sideForKind = (kind: AccountKind): AccountSide =>
    DEBT_KINDS.includes(kind) ? 'debt' : 'asset';

export const tracksReturn = (kind: AccountKind): boolean => INVESTMENT_KINDS.includes(kind);

/** finance_ledger_accounts/{uid}_{accountId} */
export interface LedgerAccount {
    ownerUid: string;
    accountId: string;
    ref?: string;
    persona?: string;
    name: string;
    provider?: string | null;
    kind: AccountKind;
    side: AccountSide;
    currency: string;

    /** Annual percentage rate as a percent number: 22.9 means 22.9%. */
    apr?: number | null;
    aprType?: 'purchase' | 'variable' | 'fixed' | null;
    creditLimitPence?: number | null;
    minPaymentPence?: number | null;
    minPaymentPercent?: number | null;
    statementDay?: number | null;
    paymentDueDay?: number | null;
    termMonths?: number | null;
    monthlyContributionPence?: number | null;
    employerContributionPence?: number | null;

    monzoAccountId?: string | null;
    monzoPotId?: string | null;
    externalSource?: 'barclays' | 'paypal' | 'other' | null;
    linkedGoalId?: string | null;

    includeInNetWorth: boolean;
    includeInFire: boolean;
    autoSeedFromMonzo: boolean;

    archived?: boolean;
    deleted?: boolean;
    migratedFromManualAccountId?: string | null;
    notes?: string | null;
    sortOrder?: number;
    createdAt?: any;
    updatedAt?: any;
    updatedAtMs?: number;
}

export type PositionSource = 'manual' | 'monzo_account' | 'monzo_pot' | 'csv_import' | 'rollforward';

/**
 * finance_positions/{uid}_{accountId}_{YYYY-MM}
 *
 * The two data points per account per month are `valuePence` and `contributedPence`.
 * Everything else on here is derived or a snapshot.
 */
export interface LedgerPosition {
    ownerUid: string;
    accountId: string;
    monthKey: string;
    /** YYYY*12 + (MM-1). Numeric ordering without a string range index. */
    monthIndex: number;
    monthEndISO: string;

    /** Current value or statement balance. ALWAYS a magnitude — `side` supplies the sign. */
    valuePence: number;
    /** Cumulative net contributed since inception (deposits − withdrawals). */
    contributedPence: number;
    /** Stored, not recomputed: valuePence − contributedPence. */
    gainPence: number;
    /** null when contributedPence is 0 — never Infinity. */
    returnPct: number | null;

    aprSnapshot?: number | null;
    creditLimitPence?: number | null;
    minPaymentPence?: number | null;
    accruedInterestPence?: number | null;
    principalPaidPence?: number | null;
    paymentsPence?: number | null;

    source: PositionSource;
    confidence: 'actual' | 'estimated';
    isEstimate: boolean;
    enteredBy: 'user' | 'system';
    notes?: string | null;
    createdAt?: any;
    updatedAt?: any;
    updatedAtMs?: number;
}

/** finance_net_worth_history/{uid}_{YYYY-MM} */
export interface NetWorthSnapshot {
    ownerUid: string;
    monthKey: string;
    monthIndex: number;
    monthEndISO: string;

    totalAssetPence: number;
    totalDebtPence: number;
    netWorthPence: number;
    deltaPence: number;
    byKindPence: Partial<Record<AccountKind, number>>;

    liquidAssetPence: number;
    fireEligiblePence: number;
    pensionPence: number;
    propertyPence: number;
    totalContributedPence: number;
    totalGainPence: number;

    accountCount: number;
    coveredAccountCount: number;
    estimatedAccountIds: string[];

    incomePence: number;
    spendPence: number;
    mandatoryPence: number;
    optionalPence: number;
    savingsRatePct: number | null;
    trailing12SpendPence: number;

    fireNumberPence: number | null;
    fireProgressPct: number | null;
    yearsToFire: number | null;
    fireDateISO: string | null;
    assumptionsVersion: number | null;

    computedAt?: any;
    updatedAt?: any;
}

/** finance_plan_assumptions/{uid} — a per-user singleton, like finance_debt_service. */
export interface PlanAssumptions {
    ownerUid: string;
    currentAge: number;
    targetRetirementAge: number;
    safeWithdrawalRatePct: number;
    nominalGrowthRatePct: number;
    inflationRatePct: number;
    useRealReturns: boolean;
    spendBasis: 'trailing12' | 'trailing6' | 'manual';
    manualAnnualSpendPence: number | null;
    monthlyContributionOverridePence: number | null;
    includePensionInFire: boolean;
    includePropertyInFire: boolean;
    version: number;
    updatedAt?: any;
    updatedAtMs?: number;
}

export const DEFAULT_PLAN_ASSUMPTIONS: Omit<PlanAssumptions, 'ownerUid'> = {
    currentAge: 42,
    targetRetirementAge: 55,
    // See functions/finance/ledger.js — 3.5% for a 40+ year horizon, not the
    // conventional 4%, which was validated over 30 years.
    safeWithdrawalRatePct: 3.5,
    nominalGrowthRatePct: 5,
    inflationRatePct: 2.5,
    useRealReturns: true,
    spendBasis: 'trailing12',
    manualAnnualSpendPence: null,
    monthlyContributionOverridePence: null,
    includePensionInFire: true,
    includePropertyInFire: false,
    version: 1,
};

/** The payload returned by the fetchFinanceLedger callable. */
export interface FinanceLedgerPayload {
    accounts: LedgerAccount[];
    positions: LedgerPosition[];
    netWorthHistory: NetWorthSnapshot[];
    assumptions: PlanAssumptions | null;
    months: string[];
    legacyManualAccountCount: number;
    legacyDebtCount: number;
}
