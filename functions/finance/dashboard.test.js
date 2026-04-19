const { aggregateTransactions, buildDashboardData } = require('./dashboard');

describe('aggregateTransactions', () => {
    test('should correctly aggregate spend by bucket, category, and theme', () => {
        const transactions = [
            { amount: -1000, userCategoryType: 'mandatory', userCategoryKey: 'groceries' }, // £10
            { amount: -2000, userCategoryType: 'discretionary', userCategoryKey: 'entertainment' }, // £20
            { amount: -500, userCategoryType: 'mandatory', userCategoryKey: 'rent' }, // £5
            { amount: 5000, userCategoryType: 'income', userCategoryKey: 'salary' } // Income (should be ignored for spend totals)
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
            { amount: -1000, linkedGoalId: 'goal-1', createdAt: new Date('2023-01-15') },
            { amount: -2000, linkedGoalId: 'goal-1', createdAt: new Date('2023-02-10') },
            { amount: -500, linkedGoalId: 'goal-2', createdAt: new Date('2023-01-20') }
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
        const transactions = [{ amount: -100, linkedGoalId: 'g1' }];
        const goals = [
            { id: 'g1', title: 'New Car', estimatedCost: 1000, linkedPotId: 'p1' },
            { id: 'g2', title: 'Holiday', estimatedCost: 500 } // No pot
        ];
        const pots = [
            { id: 'p1', name: 'Car Fund', balance: 50000 } // £500
        ];

        const result = buildDashboardData(transactions, goals, pots);

        expect(result.totalSpend).toBe(-100);
        expect(result.goalProgress).toHaveLength(2);

        const carGoal = result.goalProgress.find(g => g.id === 'g1');
        expect(carGoal.title).toBe('New Car');
        expect(carGoal.targetAmount).toBe(100000); // 1000 * 100
        expect(carGoal.currentAmount).toBe(50000);
        expect(carGoal.linkedPotName).toBe('Car Fund');

        const holidayGoal = result.goalProgress.find(g => g.id === 'g2');
        expect(holidayGoal.currentAmount).toBe(0);
        expect(holidayGoal.linkedPotName).toBeNull();
    });
});
