// functions/finance/dashboard.js
// Helper functions to aggregate Monzo transaction data for the advanced budget dashboard.
// This module is deliberately lightweight – it expects an array of transaction objects
// with the fields used throughout the codebase:
//   - amount (pence, signed; positive for income, negative for spend)
//   - userCategoryKey (string) – the category key assigned by the user or LLM
//   - userCategoryType (bucket) – one of 'mandatory', 'discretionary', 'savings', 'income'
//   - linkedGoalId (optional) – ID of a goal this transaction contributes to
//   - createdAt (timestamp) – Firestore timestamp or Date
//   - needsClassification (boolean) – ignored here (already classified)

/**
 * Simple static mapping of category keys to theme names.
 * In a real implementation this could be stored in Firestore or a config file.
 * For now we provide a placeholder that can be extended.
 */
const CATEGORY_THEME_MAP = {
    // Example entries – extend as needed
    groceries: 'Living',
    rent: 'Housing',
    utilities: 'Housing',
    salary: 'Income',
    investment: 'Wealth',
    entertainment: 'Leisure',
    travel: 'Leisure',
};

/**
 * Aggregate an array of transactions into the structures required by the dashboard.
 * Returns an object with:
 *   - totalSpend: number (pence)
 *   - spendByBucket: { [bucket]: number }
 *   - spendByCategory: { [categoryKey]: number }
 *   - spendByTheme: { [theme]: number }
 *   - spendByGoal: { [goalId]: number }
 *   - timeSeriesByGoal: { [goalId]: Array<{ month: string, amount: number }> }
 */
/**
 * Aggregate an array of transactions into the structures required by the dashboard.
 * Supports optional date filtering (startDate, endDate).
 */
function aggregateTransactions(transactions, startDate, endDate) {
    const result = {
        totalSpend: 0,
        spendByBucket: {},
        spendByCategory: {},
        spendByTheme: {},
        spendByGoal: {},
        timeSeriesByGoal: {},
        dailySpend: {}, // For burn-down chart
    };

    // Normalize dates
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    transactions.forEach((tx) => {
        const txDate = tx.createdAt?.toDate ? tx.createdAt.toDate() : new Date(tx.createdAt);

        // Apply date filter
        if (start && txDate < start) return;
        if (end && txDate > end) return;

        const amount = typeof tx.amount === 'number' ? tx.amount : 0;

        // Only consider spend (negative amounts) for most aggregates
        if (amount < 0) {
            result.totalSpend += amount;

            // Track daily spend for burn-down
            const dayKey = txDate.toISOString().split('T')[0];
            result.dailySpend[dayKey] = (result.dailySpend[dayKey] || 0) + Math.abs(amount);
        }

        // Bucket aggregation
        const bucket = tx.userCategoryType || 'unspecified';
        result.spendByBucket[bucket] = (result.spendByBucket[bucket] || 0) + amount;

        // Category aggregation
        const catKey = tx.userCategoryKey || 'uncategorized';
        result.spendByCategory[catKey] = (result.spendByCategory[catKey] || 0) + amount;

        // Theme aggregation
        const theme = CATEGORY_THEME_MAP[catKey] || 'Other';
        result.spendByTheme[theme] = (result.spendByTheme[theme] || 0) + amount;

        // Goal aggregation
        if (tx.linkedGoalId) {
            const goalId = tx.linkedGoalId;
            result.spendByGoal[goalId] = (result.spendByGoal[goalId] || 0) + amount;

            const month = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
            if (!result.timeSeriesByGoal[goalId]) result.timeSeriesByGoal[goalId] = {};
            result.timeSeriesByGoal[goalId][month] = (result.timeSeriesByGoal[goalId][month] || 0) + amount;
        }
    });

    // Format time series
    const formattedTimeSeries = {};
    Object.entries(result.timeSeriesByGoal).forEach(([goalId, monthsObj]) => {
        const arr = Object.entries(monthsObj)
            .map(([month, amt]) => ({ month, amount: amt }))
            .sort((a, b) => a.month.localeCompare(b.month));
        formattedTimeSeries[goalId] = arr;
    });
    result.timeSeriesByGoal = formattedTimeSeries;

    return result;
}

/**
 * Combine transactions, goals, pots, and budget settings to build the full dashboard payload.
 */
function buildDashboardData(transactions, goals, pots, budgetSettings, filter) {
    const { startDate, endDate } = filter || {};
    const aggregation = aggregateTransactions(transactions, startDate, endDate);

    // Map pots by ID
    const potsMap = {};
    pots.forEach(p => {
        potsMap[p.id] = p;
        if (p.potId) potsMap[p.potId] = p;
    });

    // Enrich goals
    const goalProgress = goals.map(g => {
        const linkedPotId = g.linkedPotId || g.potId;
        const pot = linkedPotId ? potsMap[linkedPotId] : null;
        return {
            id: g.id,
            title: g.title,
            targetAmount: g.estimatedCost ? Math.round(g.estimatedCost * 100) : 0,
            currentAmount: pot ? pot.balance : 0,
            linkedPotName: pot ? pot.name : null,
            status: g.status
        };
    });

    // Calculate Burn Down if budget settings exist
    let burnDown = null;
    if (budgetSettings && budgetSettings.monthlyIncome) {
        const totalBudgetPence = budgetSettings.monthlyIncome * 100;
        const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
        const today = new Date().getDate();

        // Simple linear burn down for current month
        const burnDownData = [];
        let remaining = totalBudgetPence;

        for (let i = 1; i <= daysInMonth; i++) {
            const dateStr = new Date(new Date().getFullYear(), new Date().getMonth(), i).toISOString().split('T')[0];
            // Subtract daily spend if date is in past/today
            if (i <= today) {
                const spent = aggregation.dailySpend[dateStr] || 0;
                remaining -= spent;
            }

            burnDownData.push({
                day: i,
                ideal: totalBudgetPence - ((totalBudgetPence / daysInMonth) * i),
                actual: i <= today ? remaining : null
            });
        }
        burnDown = burnDownData;
    }

    return {
        ...aggregation,
        goalProgress,
        burnDown
    };
}

module.exports = { aggregateTransactions, buildDashboardData, CATEGORY_THEME_MAP };
