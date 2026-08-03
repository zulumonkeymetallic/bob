// The ledger money maths exists twice: functions/finance/ledgerMath.js (what the
// callables and the rollup use) and utils/financeLedger.ts (what the sheet uses so
// cells recompute without a round trip).
//
// This asserts BEHAVIOURAL parity — the same inputs through both implementations —
// rather than comparing source text. A regex test would pass while the two quietly
// rounded differently, which is exactly the class of bug that matters for money.

/* eslint-disable @typescript-eslint/no-var-requires */
import path from 'path';

import {
    monthIndexOf,
    monthKeyFromIndex,
    monthEndISO,
    monthKeysBetween,
    lastNMonths,
    deriveGain,
    signedValuePence,
    monthlyInterestPence,
    netWorthFromPositions,
    isMonthKey,
} from './financeLedger';
import type { AccountKind, LedgerAccount, LedgerPosition } from '../types/finance';

const backend = require(path.join(__dirname, '..', '..', '..', 'functions', 'finance', 'ledgerMath.js'));

const MONTHS = ['2026-01', '2026-02', '2026-08', '2026-12', '2027-01', '2028-02', '1999-06'];

describe('ledger math parity: months', () => {
    it('agrees on monthIndexOf', () => {
        MONTHS.forEach((key) => expect(monthIndexOf(key)).toBe(backend.monthIndexOf(key)));
    });

    it('agrees on monthKeyFromIndex', () => {
        for (let i = 24000; i < 24040; i += 1) {
            expect(monthKeyFromIndex(i)).toBe(backend.monthKeyFromIndex(i));
        }
    });

    it('agrees on monthEndISO, including leap years', () => {
        MONTHS.forEach((key) => expect(monthEndISO(key)).toBe(backend.monthEndISO(key)));
    });

    it('agrees on monthKeysBetween, including reversed ranges', () => {
        expect(monthKeysBetween('2026-11', '2027-02')).toEqual(backend.monthKeysBetween('2026-11', '2027-02'));
        expect(monthKeysBetween('2027-02', '2026-11')).toEqual(backend.monthKeysBetween('2027-02', '2026-11'));
        expect(monthKeysBetween('2026-08', '2026-08')).toEqual(backend.monthKeysBetween('2026-08', '2026-08'));
    });

    it('agrees on lastNMonths', () => {
        [0, 1, 3, 12, 24].forEach((n) => {
            expect(lastNMonths('2027-01', n)).toEqual(backend.lastNMonths('2027-01', n));
        });
    });

    it('agrees on month key validation', () => {
        ['2026-13', '2026-00', '2026-8', '', 'nonsense', '2026-01'].forEach((key) => {
            expect(isMonthKey(key)).toBe(backend.isMonthKey(key));
        });
    });
});

describe('ledger math parity: money', () => {
    const MONEY_CASES: Array<[number, number]> = [
        [120000, 100000],
        [90000, 100000],
        [5000, 0],
        [0, 0],
        [0, 50000],
        [1, 3],
        [-2500, 1000],
    ];

    it('agrees on deriveGain, including the divide-by-zero case', () => {
        MONEY_CASES.forEach(([value, contributed]) => {
            expect(deriveGain(value, contributed)).toEqual(backend.deriveGain(value, contributed));
        });
    });

    it('agrees on signedValuePence for every account kind', () => {
        (backend.ACCOUNT_KINDS as AccountKind[]).forEach((kind) => {
            [50000, -50000, 0].forEach((value) => {
                expect(signedValuePence(kind, value)).toBe(backend.signedValuePence(kind, value));
            });
        });
    });

    it('agrees on monthlyInterestPence, including rounding', () => {
        const cases: Array<[number, number | null]> = [
            [100000, 24],
            [100000, 22.9],
            [123456, 19.9],
            [-100000, 24],
            [100000, 0],
            [100000, null],
            [0, 22.9],
            [1, 0.1],
        ];
        cases.forEach(([balance, apr]) => {
            expect(monthlyInterestPence(balance, apr)).toBe(backend.monthlyInterestPence(balance, apr));
        });
    });
});

describe('ledger math parity: net worth', () => {
    const accounts: LedgerAccount[] = [
        { ownerUid: 'u', accountId: 'isa', name: 'ISA', kind: 'isa', side: 'asset', currency: 'GBP', includeInNetWorth: true, includeInFire: true, autoSeedFromMonzo: false },
        { ownerUid: 'u', accountId: 'card', name: 'Card', kind: 'credit_card', side: 'debt', currency: 'GBP', includeInNetWorth: true, includeInFire: true, autoSeedFromMonzo: false },
        { ownerUid: 'u', accountId: 'house', name: 'House', kind: 'property', side: 'asset', currency: 'GBP', includeInNetWorth: true, includeInFire: false, autoSeedFromMonzo: false },
        { ownerUid: 'u', accountId: 'gone', name: 'Old', kind: 'savings', side: 'asset', currency: 'GBP', includeInNetWorth: true, includeInFire: true, autoSeedFromMonzo: false, deleted: true },
        { ownerUid: 'u', accountId: 'hidden', name: 'Hidden', kind: 'savings', side: 'asset', currency: 'GBP', includeInNetWorth: false, includeInFire: true, autoSeedFromMonzo: false },
    ];

    const position = (accountId: string, valuePence: number, over: Partial<LedgerPosition> = {}): LedgerPosition => ({
        ownerUid: 'u',
        accountId,
        monthKey: '2026-07',
        monthIndex: monthIndexOf('2026-07'),
        monthEndISO: monthEndISO('2026-07'),
        valuePence,
        contributedPence: 0,
        gainPence: 0,
        returnPct: null,
        source: 'manual',
        confidence: 'actual',
        isEstimate: false,
        enteredBy: 'user',
        ...over,
    });

    const positions = [
        position('isa', 1000000, { contributedPence: 800000, gainPence: 200000 }),
        position('card', 250000),
        position('house', 30000000),
        position('gone', 999999),
        position('hidden', 111111),
    ];

    it('agrees on the totals the frontend also computes', () => {
        const ours = netWorthFromPositions(accounts, positions);
        const theirs = backend.netWorthFromPositions(accounts, positions);

        expect(ours.totalAssetPence).toBe(theirs.totalAssetPence);
        expect(ours.totalDebtPence).toBe(theirs.totalDebtPence);
        expect(ours.netWorthPence).toBe(theirs.netWorthPence);
        expect(ours.accountCount).toBe(theirs.accountCount);
        expect(ours.coveredAccountCount).toBe(theirs.coveredAccountCount);
        expect(ours.estimatedAccountIds).toEqual(theirs.estimatedAccountIds);
        expect(ours.byKindPence).toEqual(theirs.byKindPence);
    });

    it('agrees when a debt is entered with either sign', () => {
        [250000, -250000].forEach((value) => {
            const rows = [position('card', value)];
            expect(netWorthFromPositions(accounts, rows).netWorthPence)
                .toBe(backend.netWorthFromPositions(accounts, rows).netWorthPence);
        });
    });
});
