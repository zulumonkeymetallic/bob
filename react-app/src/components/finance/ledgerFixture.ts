// Fixture used by two things: FinanceLedgerSheet.test.tsx, and `?demo=1` on
// /finance/ledger.
//
// The demo mode exists because local dev login renders the app shell but never
// authenticates to Firebase, so authed finance data cannot be browsed at all. This
// is how the sheet's layout gets verified in a real browser without a session.

import type { FinanceLedgerPayload, LedgerAccount, LedgerPosition } from '../../types/finance';
import { deriveGain, monthEndISO, monthIndexOf, monthKeysBetween } from '../../utils/financeLedger';

const account = (
    accountId: string,
    name: string,
    kind: LedgerAccount['kind'],
    over: Partial<LedgerAccount> = {},
): LedgerAccount => ({
    ownerUid: 'demo',
    accountId,
    name,
    kind,
    side: kind === 'credit_card' || kind === 'loan' || kind === 'mortgage' ? 'debt' : 'asset',
    currency: 'GBP',
    includeInNetWorth: true,
    includeInFire: kind !== 'property',
    autoSeedFromMonzo: false,
    sortOrder: 0,
    ...over,
});

const position = (
    accountId: string,
    monthKey: string,
    valuePence: number,
    contributedPence = 0,
    over: Partial<LedgerPosition> = {},
): LedgerPosition => {
    const { gainPence, returnPct } = deriveGain(valuePence, contributedPence);
    return {
        ownerUid: 'demo',
        accountId,
        monthKey,
        monthIndex: monthIndexOf(monthKey),
        monthEndISO: monthEndISO(monthKey),
        valuePence,
        contributedPence,
        gainPence,
        returnPct,
        source: 'manual',
        confidence: 'actual',
        isEstimate: false,
        enteredBy: 'user',
        ...over,
    };
};

export const DEMO_MONTHS = monthKeysBetween('2026-03', '2026-08');

export const DEMO_ACCOUNTS: LedgerAccount[] = [
    account('acc_current', 'Monzo Current', 'current', { provider: 'Monzo', autoSeedFromMonzo: true, sortOrder: 0 }),
    account('acc_isa', 'Plum ISA', 'isa', { provider: 'Plum', sortOrder: 1 }),
    account('acc_gia', 'Hargreaves Lansdown', 'gia', { provider: 'Hargreaves Lansdown', sortOrder: 2 }),
    account('acc_pension', 'Workplace Pension', 'pension_workplace', { provider: 'Aviva', sortOrder: 3 }),
    account('acc_card', 'Barclaycard', 'credit_card', {
        provider: 'Barclaycard', apr: 22.9, creditLimitPence: 800000, minPaymentPence: 5000, sortOrder: 4,
    }),
];

export const DEMO_POSITIONS: LedgerPosition[] = [
    ...DEMO_MONTHS.map((month, i) => position('acc_current', month, 240000 + i * 12000)),

    ...DEMO_MONTHS.map((month, i) => position('acc_isa', month, 1150000 + i * 62000, 1000000 + i * 50000)),

    ...DEMO_MONTHS.map((month, i) => position('acc_gia', month, 2380000 + i * 41000, 2200000 + i * 30000)),

    // Pension left un-entered for the last two months, to show the estimate marker.
    ...DEMO_MONTHS.slice(0, 4).map((month, i) => position('acc_pension', month, 6100000 + i * 95000, 5400000 + i * 80000)),
    ...DEMO_MONTHS.slice(4).map((month) => position('acc_pension', month, 6385000, 5640000, {
        source: 'rollforward', confidence: 'estimated', isEstimate: true, enteredBy: 'system',
    })),

    ...DEMO_MONTHS.map((month, i) => position('acc_card', month, 412000 - i * 38000, 0, { aprSnapshot: 22.9 })),
];

export const DEMO_LEDGER: FinanceLedgerPayload = {
    accounts: DEMO_ACCOUNTS,
    positions: DEMO_POSITIONS,
    netWorthHistory: [],
    assumptions: null,
    months: DEMO_MONTHS,
    legacyManualAccountCount: 0,
    legacyDebtCount: 0,
};
