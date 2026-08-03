import {
    monthIndexOf,
    monthKeyFromIndex,
    monthKeysBetween,
    lastNMonths,
    monthEndISO,
    parsePenceInput,
    deriveGain,
    signedValuePence,
    monthlyInterestPence,
    netWorthFromPositions,
    rollForward,
    indexPositions,
    isMonthKey,
} from './financeLedger';
import type { LedgerAccount, LedgerPosition, AccountKind } from '../types/finance';

const account = (over: Partial<LedgerAccount> & { accountId: string; kind: AccountKind }): LedgerAccount => ({
    ownerUid: 'u1',
    name: over.accountId,
    side: 'asset',
    currency: 'GBP',
    includeInNetWorth: true,
    includeInFire: true,
    autoSeedFromMonzo: false,
    ...over,
});

const position = (over: Partial<LedgerPosition> & { accountId: string; monthKey: string }): LedgerPosition => ({
    ownerUid: 'u1',
    monthIndex: monthIndexOf(over.monthKey),
    monthEndISO: monthEndISO(over.monthKey),
    valuePence: 0,
    contributedPence: 0,
    gainPence: 0,
    returnPct: null,
    source: 'manual',
    confidence: 'actual',
    isEstimate: false,
    enteredBy: 'user',
    ...over,
});

describe('month keys', () => {
    it('round-trips index <-> key', () => {
        ['2026-01', '2026-08', '2026-12', '1999-06'].forEach((key) => {
            expect(monthKeyFromIndex(monthIndexOf(key))).toBe(key);
        });
    });

    it('orders across a year boundary', () => {
        expect(monthIndexOf('2027-01') - monthIndexOf('2026-12')).toBe(1);
    });

    it('enumerates an inclusive range across a year boundary', () => {
        expect(monthKeysBetween('2026-11', '2027-02'))
            .toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    });

    it('returns a single month when from === to', () => {
        expect(monthKeysBetween('2026-08', '2026-08')).toEqual(['2026-08']);
    });

    it('returns empty for a reversed range rather than looping forever', () => {
        expect(monthKeysBetween('2027-02', '2026-11')).toEqual([]);
    });

    it('takes the last N months inclusive of the end', () => {
        expect(lastNMonths('2027-01', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
        expect(lastNMonths('2027-01', 0)).toEqual([]);
    });

    it('gives the last instant of the month, including February', () => {
        expect(monthEndISO('2026-02')).toBe('2026-02-28T23:59:59.999Z');
        // 2028 is a leap year.
        expect(monthEndISO('2028-02')).toBe('2028-02-29T23:59:59.999Z');
        expect(monthEndISO('2026-12')).toBe('2026-12-31T23:59:59.999Z');
    });

    it('rejects malformed month keys', () => {
        expect(isMonthKey('2026-13')).toBe(false);
        expect(isMonthKey('2026-00')).toBe(false);
        expect(isMonthKey('2026-8')).toBe(false);
        expect(isMonthKey('')).toBe(false);
        expect(() => monthIndexOf('nonsense')).toThrow();
    });
});

describe('parsePenceInput', () => {
    it('parses what people actually type', () => {
        expect(parsePenceInput('£1,234.56')).toBe(123456);
        expect(parsePenceInput('1234.56')).toBe(123456);
        expect(parsePenceInput('1,234')).toBe(123400);
        expect(parsePenceInput(' 12.5 ')).toBe(1250);
        expect(parsePenceInput('0')).toBe(0);
        expect(parsePenceInput(0)).toBe(0);
    });

    it('handles accounting-style negatives', () => {
        expect(parsePenceInput('(500)')).toBe(-50000);
        expect(parsePenceInput('-500')).toBe(-50000);
        expect(parsePenceInput('(£1,000.00)')).toBe(-100000);
        // Both notations at once cancel out rather than double-negating oddly.
        expect(parsePenceInput('(-500)')).toBe(50000);
    });

    it('returns null rather than 0 for anything unparseable', () => {
        // Critical: 0 is a real balance, so it must never be a parse fallback.
        expect(parsePenceInput('abc')).toBeNull();
        expect(parsePenceInput('')).toBeNull();
        expect(parsePenceInput('   ')).toBeNull();
        expect(parsePenceInput('.')).toBeNull();
        expect(parsePenceInput('12.3.4')).toBeNull();
        expect(parsePenceInput(null)).toBeNull();
        expect(parsePenceInput(undefined)).toBeNull();
    });

    it('rounds to whole pence', () => {
        expect(parsePenceInput('10.005')).toBe(1001);
        expect(parsePenceInput('10.004')).toBe(1000);
    });
});

describe('deriveGain', () => {
    it('computes gain and percentage return', () => {
        expect(deriveGain(120000, 100000)).toEqual({ gainPence: 20000, returnPct: 20 });
    });

    it('handles a loss', () => {
        expect(deriveGain(90000, 100000)).toEqual({ gainPence: -10000, returnPct: -10 });
    });

    it('returns null — not Infinity — when nothing was contributed', () => {
        // Infinity would propagate into every downstream average.
        const result = deriveGain(5000, 0);
        expect(result.gainPence).toBe(5000);
        expect(result.returnPct).toBeNull();
    });

    it('treats missing inputs as zero', () => {
        expect(deriveGain(undefined as any, undefined as any)).toEqual({ gainPence: 0, returnPct: null });
    });
});

describe('signedValuePence', () => {
    it('subtracts debts and adds assets regardless of the sign typed', () => {
        expect(signedValuePence('credit_card', 50000)).toBe(-50000);
        expect(signedValuePence('credit_card', -50000)).toBe(-50000);
        expect(signedValuePence('isa', 50000)).toBe(50000);
        expect(signedValuePence('mortgage', 20000000)).toBe(-20000000);
        expect(signedValuePence('pension_workplace', 1000)).toBe(1000);
    });
});

describe('monthlyInterestPence', () => {
    it('divides the annual rate across twelve months', () => {
        // £1,000 at 24% APR = £20/month.
        expect(monthlyInterestPence(100000, 24)).toBe(2000);
    });

    it('is zero when there is no balance or no rate', () => {
        expect(monthlyInterestPence(0, 22.9)).toBe(0);
        expect(monthlyInterestPence(100000, 0)).toBe(0);
        expect(monthlyInterestPence(100000, null)).toBe(0);
        expect(monthlyInterestPence(100000, undefined)).toBe(0);
    });

    it('uses the magnitude, so a negatively-entered debt still accrues', () => {
        expect(monthlyInterestPence(-100000, 24)).toBe(2000);
    });
});

describe('netWorthFromPositions', () => {
    const accounts = [
        account({ accountId: 'a_isa', kind: 'isa' }),
        account({ accountId: 'a_card', kind: 'credit_card', side: 'debt' }),
        account({ accountId: 'a_house', kind: 'property', includeInNetWorth: false }),
        account({ accountId: 'a_old', kind: 'savings', deleted: true }),
    ];

    it('subtracts debts from assets', () => {
        const totals = netWorthFromPositions(accounts, [
            position({ accountId: 'a_isa', monthKey: '2026-07', valuePence: 1000000 }),
            position({ accountId: 'a_card', monthKey: '2026-07', valuePence: 250000 }),
        ]);

        expect(totals.totalAssetPence).toBe(1000000);
        expect(totals.totalDebtPence).toBe(250000);
        expect(totals.netWorthPence).toBe(750000);
    });

    it('respects includeInNetWorth and soft deletion', () => {
        const totals = netWorthFromPositions(accounts, [
            position({ accountId: 'a_isa', monthKey: '2026-07', valuePence: 1000000 }),
            position({ accountId: 'a_house', monthKey: '2026-07', valuePence: 30000000 }),
            position({ accountId: 'a_old', monthKey: '2026-07', valuePence: 500000 }),
        ]);

        expect(totals.netWorthPence).toBe(1000000);
        expect(totals.accountCount).toBe(2); // isa + card; house and deleted excluded
    });

    it('counts accounts with no position for the month as uncovered', () => {
        const totals = netWorthFromPositions(accounts, [
            position({ accountId: 'a_isa', monthKey: '2026-07', valuePence: 1000000 }),
        ]);

        expect(totals.accountCount).toBe(2);
        expect(totals.coveredAccountCount).toBe(1);
        expect(totals.netWorthPence).toBe(1000000);
    });

    it('reports which accounts were estimated', () => {
        const totals = netWorthFromPositions(accounts, [
            position({ accountId: 'a_isa', monthKey: '2026-07', valuePence: 1000000, isEstimate: true }),
            position({ accountId: 'a_card', monthKey: '2026-07', valuePence: 100000 }),
        ]);

        expect(totals.estimatedAccountIds).toEqual(['a_isa']);
    });

    it('treats a debt entered as negative the same as one entered positive', () => {
        const asPositive = netWorthFromPositions(accounts, [
            position({ accountId: 'a_card', monthKey: '2026-07', valuePence: 250000 }),
        ]);
        const asNegative = netWorthFromPositions(accounts, [
            position({ accountId: 'a_card', monthKey: '2026-07', valuePence: -250000 }),
        ]);

        expect(asPositive.netWorthPence).toBe(-250000);
        expect(asNegative.netWorthPence).toBe(-250000);
    });

    it('breaks down by account kind with debts signed negative', () => {
        const totals = netWorthFromPositions(accounts, [
            position({ accountId: 'a_isa', monthKey: '2026-07', valuePence: 1000000 }),
            position({ accountId: 'a_card', monthKey: '2026-07', valuePence: 250000 }),
        ]);

        expect(totals.byKindPence.isa).toBe(1000000);
        expect(totals.byKindPence.credit_card).toBe(-250000);
    });
});

describe('rollForward', () => {
    const history = [
        position({ accountId: 'a1', monthKey: '2026-05', valuePence: 100000, contributedPence: 90000 }),
        position({ accountId: 'a1', monthKey: '2026-06', valuePence: 110000, contributedPence: 95000 }),
        position({ accountId: 'a2', monthKey: '2026-06', valuePence: 5000 }),
    ];

    it('carries the most recent earlier month forward', () => {
        const rolled = rollForward('a1', '2026-08', history);
        expect(rolled).not.toBeNull();
        expect(rolled!.monthKey).toBe('2026-08');
        expect(rolled!.valuePence).toBe(110000);
        expect(rolled!.contributedPence).toBe(95000);
        expect(rolled!.gainPence).toBe(15000);
        expect(rolled!.isEstimate).toBe(true);
        expect(rolled!.source).toBe('rollforward');
        expect(rolled!.enteredBy).toBe('system');
    });

    it('does not overwrite a month that already has a row', () => {
        expect(rollForward('a1', '2026-06', history)).toBeNull();
    });

    it('returns null when there is nothing earlier to carry', () => {
        expect(rollForward('a1', '2026-04', history)).toBeNull();
        expect(rollForward('a_unknown', '2026-08', history)).toBeNull();
    });

    it('clears the per-month derived debt fields it cannot know', () => {
        const rolled = rollForward('a1', '2026-08', history);
        expect(rolled!.accruedInterestPence).toBeNull();
        expect(rolled!.principalPaidPence).toBeNull();
        expect(rolled!.paymentsPence).toBeNull();
    });
});

describe('indexPositions', () => {
    it('keys by account and month for O(1) cell lookup', () => {
        const index = indexPositions([
            position({ accountId: 'a1', monthKey: '2026-06', valuePence: 100 }),
            position({ accountId: 'a2', monthKey: '2026-06', valuePence: 200 }),
        ]);

        expect(index.get('a1|2026-06')?.valuePence).toBe(100);
        expect(index.get('a2|2026-06')?.valuePence).toBe(200);
        expect(index.get('a1|2026-07')).toBeUndefined();
    });
});
