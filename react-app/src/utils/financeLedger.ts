// Pure helpers for the monthly position ledger. No React, no Firestore.
//
// The backend mirror of the money maths lives in functions/finance/ledger.js;
// financeLedger.parity.test.ts keeps the two honest.

import type {
    AccountKind,
    LedgerAccount,
    LedgerPosition,
    PositionSource,
} from '../types/finance';
import { sideForKind } from '../types/finance';

// ---------------------------------------------------------------------------
// Months
// ---------------------------------------------------------------------------

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const isMonthKey = (value: unknown): boolean => MONTH_KEY_RE.test(String(value ?? ''));

/** 'YYYY-MM' -> YYYY*12 + (MM-1). Numeric ordering without a string range index. */
export function monthIndexOf(monthKey: string): number {
    const match = MONTH_KEY_RE.exec(String(monthKey ?? ''));
    if (!match) throw new Error(`Invalid month key: ${monthKey}`);
    return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

export function monthKeyFromIndex(index: number): string {
    const year = Math.floor(index / 12);
    const month = (index % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}`;
}

export function monthKeyFromDate(date: Date): string {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Last instant of the month, UTC — what a position is "as at". */
export function monthEndISO(monthKey: string): string {
    const index = monthIndexOf(monthKey);
    // Day 0 of the following month is the last day of this one.
    return new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0, 23, 59, 59, 999)).toISOString();
}

/** Inclusive month range, ascending. Returns [] when the range is reversed. */
export function monthKeysBetween(fromMonth: string, toMonth: string): string[] {
    const start = monthIndexOf(fromMonth);
    const end = monthIndexOf(toMonth);
    if (end < start) return [];
    const keys: string[] = [];
    for (let i = start; i <= end; i += 1) keys.push(monthKeyFromIndex(i));
    return keys;
}

/** The N months ending at (and including) `toMonth`. */
export function lastNMonths(toMonth: string, count: number): string[] {
    if (count <= 0) return [];
    const end = monthIndexOf(toMonth);
    return monthKeysBetween(monthKeyFromIndex(end - (count - 1)), toMonth);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Parse what a person actually types into a sheet cell.
 *
 * Handles "£1,234.56", "1234.56", "(500)" for negatives, bare "-", and blanks.
 * Returns null for anything unparseable so a typo clears rather than zeroes —
 * zero is a real balance and must not be a parse fallback.
 */
export function parsePenceInput(raw: unknown): number | null {
    if (raw === null || raw === undefined) return null;
    let text = String(raw).trim();
    if (!text) return null;

    // Accounting-style negatives: (500) means -500.
    let negative = false;
    if (/^\(.*\)$/.test(text)) {
        negative = true;
        text = text.slice(1, -1).trim();
    }

    text = text.replace(/[£$€\s,]/g, '');
    if (text.startsWith('-')) {
        negative = !negative;
        text = text.slice(1);
    }
    if (!text || !/^\d*\.?\d*$/.test(text) || text === '.') return null;

    const value = Number(text);
    if (!Number.isFinite(value)) return null;

    const pence = Math.round(value * 100);
    return negative ? -pence : pence;
}

export function formatPence(pence: number | null | undefined, currency = 'GBP'): string {
    if (pence === null || pence === undefined || !Number.isFinite(pence)) return '';
    return (pence / 100).toLocaleString('en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    });
}

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

export interface Gain {
    gainPence: number;
    returnPct: number | null;
}

/**
 * Return on an investment position. `returnPct` is null — never Infinity — when
 * nothing has been contributed, because "infinite return" would propagate into
 * every average downstream.
 */
export function deriveGain(valuePence: number, contributedPence: number): Gain {
    const value = Math.round(Number(valuePence) || 0);
    const contributed = Math.round(Number(contributedPence) || 0);
    const gainPence = value - contributed;
    return {
        gainPence,
        returnPct: contributed > 0 ? (gainPence / contributed) * 100 : null,
    };
}

/** Signed contribution to net worth: assets add, debts subtract. */
export function signedValuePence(kind: AccountKind, valuePence: number): number {
    const magnitude = Math.abs(Math.round(Number(valuePence) || 0));
    return sideForKind(kind) === 'debt' ? -magnitude : magnitude;
}

/** One month of accrued interest at an annual percentage rate. */
export function monthlyInterestPence(balancePence: number, apr: number | null | undefined): number {
    const balance = Math.abs(Math.round(Number(balancePence) || 0));
    const rate = Number(apr);
    if (!balance || !Number.isFinite(rate) || rate <= 0) return 0;
    return Math.round((balance * (rate / 100)) / 12);
}

export interface NetWorthTotals {
    totalAssetPence: number;
    totalDebtPence: number;
    netWorthPence: number;
    byKindPence: Partial<Record<AccountKind, number>>;
    accountCount: number;
    coveredAccountCount: number;
    estimatedAccountIds: string[];
}

/**
 * Net worth for one month from the account register plus that month's positions.
 * Accounts with includeInNetWorth false, archived or soft-deleted are excluded;
 * accounts with no position for the month are counted but contribute nothing.
 */
export function netWorthFromPositions(
    accounts: LedgerAccount[],
    positions: LedgerPosition[],
): NetWorthTotals {
    const byAccount = new Map<string, LedgerPosition>();
    positions.forEach((position) => byAccount.set(position.accountId, position));

    const totals: NetWorthTotals = {
        totalAssetPence: 0,
        totalDebtPence: 0,
        netWorthPence: 0,
        byKindPence: {},
        accountCount: 0,
        coveredAccountCount: 0,
        estimatedAccountIds: [],
    };

    accounts.forEach((account) => {
        if (account.deleted === true || account.archived === true) return;
        if (account.includeInNetWorth === false) return;

        totals.accountCount += 1;
        const position = byAccount.get(account.accountId);
        if (!position) return;

        totals.coveredAccountCount += 1;
        if (position.isEstimate) totals.estimatedAccountIds.push(account.accountId);

        const magnitude = Math.abs(Math.round(Number(position.valuePence) || 0));
        if (sideForKind(account.kind) === 'debt') {
            totals.totalDebtPence += magnitude;
        } else {
            totals.totalAssetPence += magnitude;
        }
        totals.byKindPence[account.kind] = (totals.byKindPence[account.kind] || 0)
            + signedValuePence(account.kind, magnitude);
    });

    totals.netWorthPence = totals.totalAssetPence - totals.totalDebtPence;
    return totals;
}

/**
 * Carry the most recent position forward into `monthKey`.
 *
 * This is what keeps the net-worth series continuous when a month's balances were
 * never entered, rather than showing a cliff to zero. Returns null when there is
 * nothing earlier to carry, or when the month already has a row.
 */
export function rollForward(
    accountId: string,
    monthKey: string,
    history: LedgerPosition[],
): LedgerPosition | null {
    const targetIndex = monthIndexOf(monthKey);
    const forAccount = history.filter((p) => p.accountId === accountId);
    if (forAccount.some((p) => p.monthIndex === targetIndex)) return null;

    const earlier = forAccount
        .filter((p) => p.monthIndex < targetIndex)
        .sort((a, b) => b.monthIndex - a.monthIndex);
    const previous = earlier[0];
    if (!previous) return null;

    const { gainPence, returnPct } = deriveGain(previous.valuePence, previous.contributedPence);

    return {
        ...previous,
        monthKey,
        monthIndex: targetIndex,
        monthEndISO: monthEndISO(monthKey),
        gainPence,
        returnPct,
        source: 'rollforward' as PositionSource,
        confidence: 'estimated',
        isEstimate: true,
        enteredBy: 'system',
        accruedInterestPence: null,
        principalPaidPence: null,
        paymentsPence: null,
    };
}

/** Build the deterministic position doc id. Idempotent upserts depend on this. */
export const positionDocId = (uid: string, accountId: string, monthKey: string): string =>
    `${uid}_${accountId}_${monthKey}`;

/** Index positions for O(1) cell lookup in the sheet. */
export function indexPositions(positions: LedgerPosition[]): Map<string, LedgerPosition> {
    const index = new Map<string, LedgerPosition>();
    positions.forEach((position) => index.set(`${position.accountId}|${position.monthKey}`, position));
    return index;
}
