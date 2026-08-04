const { assessRecurringActivity } = require('./enhancements');

// NOW is fixed so the six-month window is deterministic.
const NOW = Date.parse('2026-08-04T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** n charges of `amount`, `gapDays` apart, the last one `endDaysAgo` before NOW. */
const series = (count, amount, gapDays, endDaysAgo = 3, jitter = () => 0) =>
    Array.from({ length: count }, (_, i) => {
        const fromEnd = count - 1 - i;
        return {
            createdISO: new Date(NOW - (endDaysAgo + fromEnd * gapDays) * DAY + jitter(i) * DAY).toISOString(),
            amountMinor: -Math.round((amount + (jitter(i) ? 0 : 0)) * 100),
        };
    });

const assess = (txs) => assessRecurringActivity(txs, { now: NOW });

describe('assessRecurringActivity', () => {
    it('accepts a steady monthly subscription', () => {
        const result = assess(series(7, 24.99, 30));
        expect(result.isLive).toBe(true);
        expect(result.monthsSeen).toBeGreaterThanOrEqual(5);
        expect(result.medianAmount).toBeCloseTo(24.99, 2);
        expect(result.medianGapDays).toBeCloseTo(30, 0);
    });

    it('rejects a membership cancelled months ago', () => {
        // The real case: a CrossFit membership charged monthly through to
        // December 2025 and cancelled. It kept being suggested for cancellation
        // because merchantSummary.isRecurring is an all-time flag.
        const cancelled = Array.from({ length: 6 }, (_, i) => ({
            createdISO: new Date(Date.parse('2025-12-15T00:00:00.000Z') - i * 30 * DAY).toISOString(),
            amountMinor: -6500,
        }));
        const result = assess(cancelled);
        expect(result.isLive).toBe(false);
        // Falls outside the 6-month window entirely.
        expect(['too_few_charges', 'no_recent_charge']).toContain(result.reason);
    });

    it('rejects a subscription that stopped one month ago', () => {
        // Last charge ~70 days back: present in the window, absent recently.
        const result = assess(series(6, 24.99, 30, 70));
        expect(result.isLive).toBe(false);
        expect(result.reason).toBe('no_recent_charge');
    });

    it('rejects amounts that vary by more than 10%', () => {
        const txs = series(7, 30, 30);
        txs[3].amountMinor = -6000; // £60 against a £30 median
        const result = assess(txs);
        expect(result.isLive).toBe(false);
        expect(result.reason).toBe('amount_varies');
    });

    it('accepts amounts drifting within 10%', () => {
        const txs = series(7, 30, 30);
        txs[2].amountMinor = -3250; // +8.3%
        txs[4].amountMinor = -2800; // -6.7%
        expect(assess(txs).isLive).toBe(true);
    });

    it('rejects cadence that varies by more than 5 days', () => {
        const txs = series(7, 24.99, 30);
        // Push one charge far out of step.
        txs[2].createdISO = new Date(Date.parse(txs[2].createdISO) - 20 * DAY).toISOString();
        const result = assess(txs);
        expect(result.isLive).toBe(false);
        expect(result.reason).toBe('cadence_varies');
    });

    it('accepts cadence drifting within 5 days', () => {
        const txs = series(7, 24.99, 30);
        txs[3].createdISO = new Date(Date.parse(txs[3].createdISO) + 4 * DAY).toISOString();
        expect(assess(txs).isLive).toBe(true);
    });

    it('rejects a one-off purchase', () => {
        const result = assess([{ createdISO: new Date(NOW - 5 * DAY).toISOString(), amountMinor: -12000 }]);
        expect(result.isLive).toBe(false);
        expect(result.reason).toBe('too_few_charges');
    });

    it('rejects irregular ad-hoc spend at the same merchant', () => {
        // Coffee shop: frequent, but neither consistent in amount nor cadence.
        const txs = [
            { createdISO: new Date(NOW - 2 * DAY).toISOString(), amountMinor: -320 },
            { createdISO: new Date(NOW - 9 * DAY).toISOString(), amountMinor: -1150 },
            { createdISO: new Date(NOW - 11 * DAY).toISOString(), amountMinor: -480 },
            { createdISO: new Date(NOW - 40 * DAY).toISOString(), amountMinor: -260 },
            { createdISO: new Date(NOW - 95 * DAY).toISOString(), amountMinor: -900 },
        ];
        expect(assess(txs).isLive).toBe(false);
    });

    it('tolerates a single skipped month for a boundary-straddling billing date', () => {
        // 6 charges at 30-day spacing span ~7 month-keys, so 5 of 6 months is fine.
        const result = assess(series(6, 15, 30));
        expect(result.isLive).toBe(true);
    });

    it('handles empty input without throwing', () => {
        expect(assess([]).isLive).toBe(false);
        expect(assessRecurringActivity(null, { now: NOW }).isLive).toBe(false);
    });
});
