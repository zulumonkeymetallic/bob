const { summariseTransactions } = require('./analytics');
const { buildCategoryIndex } = require('../finance/bucketResolver');
const { DEFAULT_FINANCE_CATEGORIES } = require('../finance/categories');

const categoryIndex = buildCategoryIndex(DEFAULT_FINANCE_CATEGORIES);
const potIndex = new Map([['pot_holiday', { name: 'Holiday Fund' }]]);

/** summariseTransactions consumes Firestore QueryDocumentSnapshots. */
const doc = (data) => ({ data: () => data });

describe('summariseTransactions', () => {
    it('honours a manual override over the AI bucket', () => {
        // Regression: this function used to resolve `aiBucket || userCategoryType`,
        // so a transaction Jim recategorised by hand still reported under the AI's
        // bucket in monzo_budget_summary — the doc feeding budget progress, the
        // Monday email, the coach page and the mobile finance tab.
        const result = summariseTransactions([
            doc({
                amount: -80,
                userCategoryType: 'mandatory',
                userCategoryLabel: 'Groceries',
                aiBucket: 'discretionary',
                aiCategoryLabel: 'Eating Out',
                createdISO: '2026-07-04T12:00:00.000Z',
                monthKey: '2026-07',
            }),
        ], potIndex, categoryIndex);

        expect(result.totals.mandatory).toBe(80);
        expect(result.totals.optional).toBe(0);
    });

    it('excludes pot transfers from spend totals', () => {
        // Regression: the guard was `if (categoryType === 'bank_transfer') continue;`
        // placed after coerceCategoryType, which only ever returns one of
        // ['mandatory','optional','savings','income'] — so it never fired and every
        // transfer into a savings pot was counted as discretionary spend.
        const result = summariseTransactions([
            doc({
                amount: -500,
                metadata: { destination_pot_id: 'pot_holiday' },
                createdISO: '2026-07-05T12:00:00.000Z',
                monthKey: '2026-07',
            }),
            doc({
                amount: -20,
                userCategoryType: 'optional',
                userCategoryLabel: 'Coffee',
                createdISO: '2026-07-06T12:00:00.000Z',
                monthKey: '2026-07',
            }),
        ], potIndex, categoryIndex);

        expect(result.totals.optional).toBe(20);
        expect(result.totals.mandatory).toBe(0);
        expect(result.totals.savings).toBe(0);
        expect(result.totals.income).toBe(0);
        expect(result.monthly['2026-07'].optional).toBe(20);
    });

    it('still tracks pot transfers separately as transfers', () => {
        // The exclusion above must not lose transfer visibility: allMerchantTotals
        // deliberately carries them with isTransfer: true.
        const result = summariseTransactions([
            doc({
                amount: -500,
                metadata: { destination_pot_id: 'pot_holiday' },
                createdISO: '2026-07-05T12:00:00.000Z',
            }),
        ], potIndex, categoryIndex);

        const transfers = (result.allMerchants || []).filter((m) => m.isTransfer);
        expect(transfers).toHaveLength(1);
        expect(transfers[0].merchantName).toBe('Holiday Fund');
        expect(result.merchants || []).toHaveLength(0);
    });

    it('resolves a userCategoryKey ahead of a stale userCategoryType', () => {
        // userCategoryType is rewritten from merchant_mappings on every sync, so it
        // is a rule; userCategoryKey is a per-transaction choice and must win.
        const result = summariseTransactions([
            doc({
                amount: -30,
                userCategoryKey: 'investment_traditional',
                userCategoryType: 'optional',
                createdISO: '2026-07-07T12:00:00.000Z',
            }),
        ], potIndex, categoryIndex);

        expect(result.totals.savings).toBe(30);
        expect(result.totals.optional).toBe(0);
    });

    it('falls back on sign when nothing has classified the transaction', () => {
        const result = summariseTransactions([
            doc({ amount: 2500, createdISO: '2026-07-01T12:00:00.000Z' }),
        ], potIndex, categoryIndex);

        expect(result.totals.income).toBe(2500);
    });
});
