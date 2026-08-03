const { aggregateTransactions, buildDashboardData } = require('./dashboard');

// aggregateTransactions drops any transaction it cannot date. Every fixture below
// therefore carries createdAt — without it the whole suite silently aggregates
// nothing and every assertion fails, which is how all three original tests were
// failing before anyone ran them.
const AT = new Date('2023-01-15T12:00:00.000Z');

describe('aggregateTransactions', () => {
    test('should correctly aggregate spend by bucket, category, and theme', () => {
        const transactions = [
            { amountMinor: -1000, createdAt: AT, userCategoryType: 'mandatory', userCategoryKey: 'groceries' }, // £10
            { amountMinor: -2000, createdAt: AT, userCategoryType: 'discretionary', userCategoryKey: 'entertainment' }, // £20
            { amountMinor: -500, createdAt: AT, userCategoryType: 'mandatory', userCategoryKey: 'rent' }, // £5
            { amountMinor: 5000, createdAt: AT, userCategoryType: 'income', userCategoryKey: 'salary' } // Income (should be ignored for spend totals)
        ];

        const result = aggregateTransactions(transactions);

        expect(result.totalSpend).toBe(-3500);
        expect(result.spendByBucket['mandatory']).toBe(-1500);
        expect(result.spendByBucket['discretionary']).toBe(-2000);
        expect(result.spendByCategory['groceries']).toBe(-1000);
        expect(result.spendByTheme['Living']).toBe(-1000); // groceries -> Living
        expect(result.spendByTheme['Housing']).toBe(-500); // rent -> Housing
    });

    test('should handle transactions linked to goals', () => {
        const transactions = [
            { amountMinor: -1000, linkedGoalId: 'goal-1', createdAt: new Date('2023-01-15') },
            { amountMinor: -2000, linkedGoalId: 'goal-1', createdAt: new Date('2023-02-10') },
            { amountMinor: -500, linkedGoalId: 'goal-2', createdAt: new Date('2023-01-20') }
        ];

        const result = aggregateTransactions(transactions);

        expect(result.spendByGoal['goal-1']).toBe(-3000);
        expect(result.spendByGoal['goal-2']).toBe(-500);

        // Check time series
        expect(result.timeSeriesByGoal['goal-1']).toHaveLength(2);
        expect(result.timeSeriesByGoal['goal-1'][0]).toEqual({ month: '2023-01', amount: -1000 });
        expect(result.timeSeriesByGoal['goal-1'][1]).toEqual({ month: '2023-02', amount: -2000 });
    });
});

describe('buildDashboardData', () => {
    test('should combine aggregation with goal progress', () => {
        const transactions = [{ amountMinor: -100, createdAt: AT, linkedGoalId: 'g1' }];
        const goals = [
            { id: 'g1', title: 'New Car', estimatedCost: 1000, linkedPotId: 'p1' },
            { id: 'g2', title: 'Holiday', estimatedCost: 500 } // No pot
        ];
        const pots = [
            { id: 'p1', name: 'Car Fund', balance: 50000 } // £500
        ];

        const result = buildDashboardData(transactions, goals, pots);

        expect(result.totalSpend).toBe(-100);

        // buildDashboardData filters goalProgress to goals that have a linked pot
        // (see the `Only show linked goals` filter in dashboard.js), so g2 is
        // absent by design. This assertion used to expect 2 and then dereference
        // the missing g2, which threw — the suite has never run in CI.
        expect(result.goalProgress).toHaveLength(1);

        const carGoal = result.goalProgress.find(g => g.id === 'g1');
        expect(carGoal.title).toBe('New Car');
        expect(carGoal.targetAmount).toBe(100000); // 1000 * 100
        expect(carGoal.currentAmount).toBe(50000);
        expect(carGoal.linkedPotName).toBe('Car Fund');

        expect(result.goalProgress.find(g => g.id === 'g2')).toBeUndefined();
    });
});

describe('aggregateTransactions category resolution', () => {
    test('a manual override outranks the AI bucket', () => {
        const result = aggregateTransactions([
            { amountMinor: -1000, createdAt: AT, userCategoryType: 'mandatory', aiBucket: 'discretionary' },
        ]);

        expect(result.spendByBucket['mandatory']).toBe(-1000);
        expect(result.spendByBucket['discretionary']).toBeUndefined();
    });

    test('a per-transaction key outranks a merchant-rule type', () => {
        // userCategoryType is rewritten from merchant_mappings on every sync, so
        // it is a rule; userCategoryKey is a choice and must win.
        const result = aggregateTransactions([
            { amountMinor: -1000, createdAt: AT, userCategoryKey: 'coffee', userCategoryType: 'mandatory' },
        ]);

        expect(result.spendByBucket['discretionary']).toBe(-1000);
        expect(result.spendByCategory['coffee']).toBe(-1000);
    });

    test('pot transfers are excluded from every aggregate', () => {
        const result = aggregateTransactions([
            { amountMinor: -50000, createdAt: AT, metadata: { destination_pot_id: 'pot_1' } },
            { amountMinor: -1000, createdAt: AT, userCategoryType: 'optional' },
        ]);

        expect(result.totalSpend).toBe(-1000);
        expect(result.spendByBucket['bank_transfer']).toBeUndefined();
    });

    test('debt repayment rolls into the mandatory projection', () => {
        // narrowToV4 gap: debt_repayment used to map to nothing.
        const { narrowToV4 } = require('./bucketResolver');
        expect(narrowToV4('debt_repayment')).toBe('mandatory');
    });
});
