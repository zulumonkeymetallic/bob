// functions/finance/dashboard.js
// Helper functions to aggregate Monzo transaction data for the advanced budget dashboard.
// This module is deliberately lightweight – it expects an array of transaction objects
// with the fields used throughout the codebase:
//   - amount (POUNDS, signed; positive for income, negative for spend) — the header
//     used to say pence, but toAmountMinor multiplies it by 100, and the sync writer
//     stores amount = amountMinor / 100. Pass amountMinor when you mean pence.
//   - userCategoryKey (string) – the category key assigned by the user or LLM
//   - userCategoryType (bucket) – one of 'mandatory', 'optional', 'savings', 'income'
//   - linkedGoalId (optional) – ID of a goal this transaction contributes to
//   - createdAt (timestamp) – Firestore timestamp or Date
//   - needsClassification (boolean) – ignored here (already classified)

const { resolveTransactionCategory, buildCategoryIndex, buildPotIndex } = require('./bucketResolver');
const { DEFAULT_FINANCE_CATEGORIES } = require('./categories');

// Callers that have the user's own catalogue should pass an index built from it;
// the default keeps every existing call site working unchanged.
const DEFAULT_CATEGORY_INDEX = buildCategoryIndex(DEFAULT_FINANCE_CATEGORIES);

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

function parseTransactionDate(tx) {
  const createdAt = tx?.createdAt;
  if (createdAt instanceof Date) {
    if (!Number.isNaN(createdAt.getTime())) return createdAt;
  }
  if (createdAt?.toDate) {
    const dt = createdAt.toDate();
    if (dt instanceof Date && !Number.isNaN(dt.getTime())) return dt;
  }
  if (createdAt?._seconds) {
    const dt = new Date(createdAt._seconds * 1000);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
    const dt = new Date(createdAt);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (typeof createdAt === 'string' && createdAt) {
    const dt = new Date(createdAt);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  if (typeof tx?.createdISO === 'string' && tx.createdISO) {
    const dt = new Date(tx.createdISO);
    if (!Number.isNaN(dt.getTime())) return dt;
  }
  return null;
}

function toAmountMinor(tx) {
  if (Number.isFinite(tx?.amountMinor)) {
    return Math.round(Number(tx.amountMinor));
  }
  const amount = Number(tx?.amount || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

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
function aggregateTransactions(transactions, startDate, endDate, categoryIndex = DEFAULT_CATEGORY_INDEX, potIndex = null) {
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
  const endBoundary = end ? new Date(end.getTime() + 24 * 60 * 60 * 1000) : null; // inclusive of end date

  transactions.forEach((tx) => {
    const txDate = parseTransactionDate(tx);
    if (!txDate) return;

    // Apply date filter
    if (start && txDate < start) return;
    if (endBoundary && txDate >= endBoundary) return;

        const minor = Number.isFinite(tx.amountMinor) ? Math.round(Number(tx.amountMinor)) : null;
        const rawAmount = Number(tx.amount || 0);
        const amount = minor !== null
            ? minor
            : (Number.isFinite(rawAmount) ? Math.round(rawAmount * 100) : 0);
        // Shared resolver — see functions/finance/bucketResolver.js. This used to be
        // a hand-written precedence chain plus a partial fold that only handled
        // `optional`, so net_salary and income reported as two separate buckets and
        // debt_repayment never rolled into mandatory.
        const resolved = resolveTransactionCategory(tx, { categoryIndex, potIndex });
        const bucketNormalized = resolved.bucket;

        // Exclude bank transfers from all aggregates. Unclassified spend stays IN:
        // dropping it would understate total spend, and uncategorizedSummary below
        // is what surfaces it. (The old chain fell back to the literal string
        // 'unspecified', which this guard never matched, so this preserves the
        // effective behaviour rather than the written one.)
        if (bucketNormalized === 'bank_transfer') return;

        // Only consider spend (negative amounts) for most aggregates
        if (amount < 0 && !['income', 'net_salary', 'irregular_income'].includes(bucketNormalized)) {
            result.totalSpend += amount;

            // Track daily spend for burn-down
            const dayKey = txDate.toISOString().split('T')[0];
            result.dailySpend[dayKey] = (result.dailySpend[dayKey] || 0) + Math.abs(amount);
        }

        // Bucket aggregation
        result.spendByBucket[bucketNormalized] = (result.spendByBucket[bucketNormalized] || 0) + amount;

        const month = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`;
        if (!result.timeSeriesByBucket) result.timeSeriesByBucket = {};
        if (!result.timeSeriesByBucket[bucketNormalized]) result.timeSeriesByBucket[bucketNormalized] = {};
        result.timeSeriesByBucket[bucketNormalized][month] = (result.timeSeriesByBucket[bucketNormalized][month] || 0) + amount;

        // Category aggregation
        const catKey = resolved.categoryKey;
        result.spendByCategory[catKey] = (result.spendByCategory[catKey] || 0) + amount;

        if (!result.timeSeriesByCategory) result.timeSeriesByCategory = {};
        if (!result.timeSeriesByCategory[catKey]) result.timeSeriesByCategory[catKey] = {};
        result.timeSeriesByCategory[catKey][month] = (result.timeSeriesByCategory[catKey][month] || 0) + amount;

        // Theme aggregation
        const theme = CATEGORY_THEME_MAP[catKey] || 'Other';
        result.spendByTheme[theme] = (result.spendByTheme[theme] || 0) + amount;

        // Goal aggregation
        if (tx.linkedGoalId) {
            const goalId = tx.linkedGoalId;
            result.spendByGoal[goalId] = (result.spendByGoal[goalId] || 0) + amount;

            if (!result.timeSeriesByGoal[goalId]) result.timeSeriesByGoal[goalId] = {};
            result.timeSeriesByGoal[goalId][month] = (result.timeSeriesByGoal[goalId][month] || 0) + amount;
        }

        // Subscription & Discretionary tracking
        const isSubscription = tx.isSubscription === true
            || tx.userCategoryKey === 'online_subscription'
            || String(tx.category || '').toLowerCase() === 'subscriptions';
        if (amount < 0) {
            if (isSubscription) {
                result.totalSubscriptionSpend = (result.totalSubscriptionSpend || 0) + amount;
            }
            if (bucketNormalized === 'discretionary') {
                result.totalDiscretionarySpend = (result.totalDiscretionarySpend || 0) + amount;
            }
        }
    });

    // Format time series helper
    const formatTS = (source) => {
        const formatted = {};
        Object.entries(source || {}).forEach(([key, monthsObj]) => {
            const arr = Object.entries(monthsObj)
                .map(([month, amt]) => ({ month, amount: amt }))
                .sort((a, b) => a.month.localeCompare(b.month));
            formatted[key] = arr;
        });
        return formatted;
    };

    result.timeSeriesByGoal = formatTS(result.timeSeriesByGoal);
    result.timeSeriesByBucket = formatTS(result.timeSeriesByBucket);
    result.timeSeriesByCategory = formatTS(result.timeSeriesByCategory);

    return result;
}

/**
 * Per-pot flows for the selected range, joined to the pot's current balance.
 *
 * Pot movements are excluded from spend (they are transfers, not consumption) but they are
 * not nothing: they are the savings rate. Excluding them from spend without surfacing them
 * anywhere would just hide the money. Each row carries what went IN, what came back OUT,
 * the net for the range, and the balance sitting there now.
 *
 * All figures are integer pence and `inPence`/`outPence` are magnitudes; `netPence` is
 * signed, positive meaning the pot grew over the range.
 */
function buildPotFlows(transactionsInRange, pots, potIndex, categoryIndex) {
    const rows = new Map();
    const keyFor = (potId, potName) => String(potId || potName || 'unknown').toLowerCase();

    const ensure = (potId, potName) => {
        const key = keyFor(potId, potName);
        if (!rows.has(key)) {
            rows.set(key, {
                key,
                potId: potId || null,
                name: potName || 'Savings pot',
                inPence: 0,
                outPence: 0,
                netPence: 0,
                transactions: 0,
                balancePence: null,
                deleted: false,
            });
        }
        return rows.get(key);
    };

    (transactionsInRange || []).forEach((tx) => {
        const resolved = resolveTransactionCategory(tx, { categoryIndex, potIndex });
        if (!resolved.isPotTransfer || !resolved.potTransfer) return;
        const { potId, potName, direction } = resolved.potTransfer;
        const row = ensure(potId, potName);
        const amountMinor = toAmountMinor(tx);
        const magnitude = Math.abs(amountMinor);
        if (direction === 'to') {
            row.inPence += magnitude;
            row.netPence += magnitude;
        } else {
            row.outPence += magnitude;
            row.netPence -= magnitude;
        }
        row.transactions += 1;
    });

    // Join the live balance. monzo_pots.balance is minor units already — do not scale it.
    (pots || []).forEach((pot) => {
        if (!pot) return;
        const row = rows.get(keyFor(pot.potId || pot.id, pot.name || pot.title));
        const balance = Number(pot.balance);
        if (row) {
            row.balancePence = Number.isFinite(balance) ? Math.round(balance) : null;
            row.deleted = pot.deleted === true;
            if (pot.name || pot.title) row.name = pot.name || pot.title;
        } else if (Number.isFinite(balance) && balance > 0 && pot.deleted !== true) {
            // A pot with a balance but no movement in this range still belongs on the list —
            // otherwise a pot you stopped paying into silently disappears.
            const created = ensure(pot.potId || pot.id, pot.name || pot.title);
            created.balancePence = Math.round(balance);
        }
    });

    const list = Array.from(rows.values())
        .filter((row) => row.transactions > 0 || (row.balancePence || 0) > 0)
        .sort((a, b) => (b.balancePence || 0) - (a.balancePence || 0) || b.inPence - a.inPence);

    const totals = list.reduce((acc, row) => {
        acc.inPence += row.inPence;
        acc.outPence += row.outPence;
        acc.netPence += row.netPence;
        acc.balancePence += row.balancePence || 0;
        return acc;
    }, { inPence: 0, outPence: 0, netPence: 0, balancePence: 0 });

    return { pots: list, totals };
}

/**
 * Combine transactions, goals, pots, and budget settings to build the full dashboard payload.
 */
function buildDashboardData(transactions, goals, pots, budgetSettings, filter, categoryIndex = DEFAULT_CATEGORY_INDEX) {
    const { startDate, endDate } = filter || {};
    // Pots are already loaded by the caller; indexing them here is what lets a transfer be
    // named "Holiday" instead of "pot_00009qOFyM5FPX8Gam20ZO".
    const potIndex = buildPotIndex(pots);
    const aggregation = aggregateTransactions(transactions, startDate, endDate, categoryIndex, potIndex);
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    const endBoundary = end ? new Date(end.getTime() + 24 * 60 * 60 * 1000) : null;
    const transactionsInRange = transactions.filter((tx) => {
        const txDate = parseTransactionDate(tx);
        if (!txDate) return false;
        if (start && txDate < start) return false;
        if (endBoundary && txDate >= endBoundary) return false;
        return true;
    });
    const uncategorizedSummary = transactionsInRange.reduce((summary, tx) => {
        const amountMinor = toAmountMinor(tx);
        if (amountMinor >= 0) return summary;

        const resolved = resolveTransactionCategory(tx, { categoryIndex, potIndex });
        if (resolved.bucket === 'bank_transfer') return summary;
        if (['net_salary', 'irregular_income'].includes(resolved.bucket)) return summary;

        summary.classifiableTransactionCount += 1;
        const categoryKey = resolved.categoryKey.toLowerCase();
        if (!categoryKey || ['uncategorized', 'unknown', 'unassigned', 'none'].includes(categoryKey)) {
            summary.uncategorizedCount += 1;
        }
        return summary;
    }, {
        classifiableTransactionCount: 0,
        uncategorizedCount: 0,
    });
    const uncategorizedPct = uncategorizedSummary.classifiableTransactionCount > 0
        ? Number(((uncategorizedSummary.uncategorizedCount / uncategorizedSummary.classifiableTransactionCount) * 100).toFixed(1))
        : 0;

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
        potFlows: buildPotFlows(transactionsInRange, pots, potIndex, categoryIndex),
        classifiableTransactionCount: uncategorizedSummary.classifiableTransactionCount,
        uncategorizedCount: uncategorizedSummary.uncategorizedCount,
        uncategorizedPct,
        goalProgress: goalProgress.filter(g => g.linkedPotName), // Only show linked goals
        burnDown,
        anomalyTransactions: transactionsInRange
            .filter((t) => t.aiAnomalyFlag)
            .sort((a, b) => {
                const aAmt = Math.abs(Number(a.amountMinor ?? a.amount ?? 0));
                const bAmt = Math.abs(Number(b.amountMinor ?? b.amount ?? 0));
                return bAmt - aAmt;
            })
            .slice(0, 25)
            .map((t) => ({
                id: t.id || t.transactionId || null,
                merchantName: t.merchantName || t.description,
                amountMinor: Number.isFinite(t.amountMinor)
                    ? Math.round(Number(t.amountMinor))
                    : Math.round(Number(t.amount || 0) * 100),
                amount: Number.isFinite(t.amountMinor)
                    ? Number(t.amountMinor) / 100
                    : Number(t.amount || 0),
                createdAt: t.createdAt,
                aiAnomalyReason: t.aiAnomalyReason || null,
            })),
        recentTransactions: transactionsInRange
            .sort((a, b) => {
                const aMs = parseTransactionDate(a)?.getTime() || 0;
                const bMs = parseTransactionDate(b)?.getTime() || 0;
                return bMs - aMs;
            })
            .slice(0, 100)
            .map(t => {
                const metadata = t.metadata || {};
                const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
                const pot = potId ? potsMap[potId] : null;
                const isTransferToPot = !!metadata.destination_pot_id || (!metadata.source_pot_id && t.amount < 0);
                const potTransferLabel = pot ? `${isTransferToPot ? 'Transfer to' : 'Transfer from'} ${pot.name}` : null;
                const amountMinor = Number.isFinite(t.amountMinor)
                    ? Math.round(Number(t.amountMinor))
                    : Math.round(Number(t.amount || 0) * 100);
                const amount = amountMinor / 100;
                const resolved = resolveTransactionCategory(t, { categoryIndex });
                return {
                    id: t.id || t.transactionId || null,
                    merchantName: t.merchantName || t.description,
                    amount,
                    amountMinor,
                    // Resolved fields — the shape clients should read. The raw
                    // user*/ai* fields below stay for the editing surfaces, which
                    // need to know what is actually stored versus what was derived.
                    bucket: resolved.bucket,
                    bucketSource: resolved.bucketSource,
                    resolvedCategoryKey: resolved.categoryKey,
                    resolvedCategoryLabel: potTransferLabel || resolved.categoryLabel,
                    categoryKey: t.userCategoryKey,
                    categoryLabel: potTransferLabel || t.userCategoryLabel,
                    categoryType: potId ? 'bank_transfer' : (t.userCategoryType || t.defaultCategoryType || null),
                    aiCategoryKey: t.aiCategoryKey || null,
                    aiCategoryLabel: potTransferLabel || t.aiCategoryLabel || null,
                    aiBucket: potId ? 'bank_transfer' : (t.aiBucket || null),
                    aiReduceSuggestion: t.aiReduceSuggestion || null,
                    aiAnomalyFlag: !!t.aiAnomalyFlag,
                    aiAnomalyReason: t.aiAnomalyReason || null,
                    aiAnomalyScore: t.aiAnomalyScore || null,
                    createdAt: t.createdAt,
                    isSubscription: t.isSubscription === true
                        || t.userCategoryKey === 'online_subscription'
                        || String(t.category || '').toLowerCase() === 'subscriptions',
                    potId: potId || null,
                    potName: pot ? pot.name : null,
                };
            })
    };
}

module.exports = { aggregateTransactions, buildDashboardData, buildPotFlows, CATEGORY_THEME_MAP };
