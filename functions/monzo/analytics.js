const admin = require('firebase-admin');
const {
  inferDefaultCategoryType,
  inferDefaultCategoryLabel,
  toMonthKey,
  normaliseMerchantName,
  coerceCategoryType,
  SAFE_CATEGORY_TYPES,
} = require('./shared');

const THEME_NAME_MAP = {
  0: 'General',
  1: 'Health & Fitness',
  2: 'Career & Professional',
  3: 'Finance & Wealth',
  4: 'Learning & Education',
  5: 'Family & Relationships',
  6: 'Hobbies & Interests',
  7: 'Travel & Adventure',
  8: 'Home & Living',
  9: 'Spiritual & Personal Growth',
  10: 'Chores',
  11: 'Rest & Recovery',
  12: 'Work (Main Gig)',
  13: 'Sleep',
  14: 'Random',
};

function parseAmount(data) {
  if (typeof data.amount === 'number' && Number.isFinite(data.amount)) {
    return data.amount;
  }
  const minor = typeof data.amountMinor === 'number' ? data.amountMinor : null;
  if (Number.isFinite(minor)) {
    return minor / 100;
  }
  const raw = Number(data.raw?.amount);
  if (Number.isFinite(raw)) {
    return raw / 100;
  }
  return 0;
}

function summariseTransactions(transactions) {
  const totals = { mandatory: 0, optional: 0, savings: 0, income: 0 };
  const monthlyMap = new Map();
  const categoryTotals = new Map();
  const merchantTotals = new Map();
  const pendingClassification = [];
  let pendingCount = 0;

  for (const doc of transactions) {
    const data = doc.data() || {};
    const amount = parseAmount(data);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const raw = data.raw || {};
    const inferredType = inferDefaultCategoryType(raw);
    const fallbackType = amount >= 0 ? 'income' : 'optional';
    const categoryType = coerceCategoryType(
      data.userCategoryType || data.categoryType || data.defaultCategoryType || inferredType,
      fallbackType
    );

    const categoryLabel = String(
      data.userCategoryLabel
      || data.userCategory
      || data.defaultCategoryLabel
      || inferDefaultCategoryLabel(raw)
    );

    if (categoryType === 'bank_transfer') continue;

    const absoluteAmount = Math.abs(amount);
    totals[categoryType] = (totals[categoryType] || 0) + absoluteAmount;

    const monthKey = data.monthKey || (data.createdISO ? toMonthKey(data.createdISO) : null);
    if (monthKey) {
      if (!monthlyMap.has(monthKey)) {
        monthlyMap.set(monthKey, { mandatory: 0, optional: 0, savings: 0, income: 0 });
      }
      const monthTotals = monthlyMap.get(monthKey);
      monthTotals[categoryType] += absoluteAmount;
    }

    const categoryKey = `${categoryType}__${categoryLabel.toLowerCase()}`;
    if (!categoryTotals.has(categoryKey)) {
      categoryTotals.set(categoryKey, { label: categoryLabel, type: categoryType, amount: 0, count: 0 });
    }
    const categoryEntry = categoryTotals.get(categoryKey);
    categoryEntry.amount += absoluteAmount;
    categoryEntry.count += 1;

    const isSpend = amount < 0;
    if (isSpend && categoryType !== 'bank_transfer') {
      const merchantName = data.merchant?.name || data.counterparty?.name || data.description || categoryLabel;
      const merchantKey = normaliseMerchantName(merchantName || data.transactionId || data.id || 'merchant');
      if (!merchantTotals.has(merchantKey)) {
        merchantTotals.set(merchantKey, {
          merchantKey,
          merchantName,
          totalSpend: 0,
          transactions: 0,
          byCategory: {},
          lastTransactionISO: null,
          months: new Set(),
          amounts: [],
        });
      }
      const merchantEntry = merchantTotals.get(merchantKey);
      merchantEntry.totalSpend += absoluteAmount;
      merchantEntry.transactions += 1;
      merchantEntry.byCategory[categoryType] = (merchantEntry.byCategory[categoryType] || 0) + absoluteAmount;
      const createdISO = data.createdISO || null;
      if (createdISO && (!merchantEntry.lastTransactionISO || createdISO > merchantEntry.lastTransactionISO)) {
        merchantEntry.lastTransactionISO = createdISO;
      }
      const mKey = createdISO ? toMonthKey(createdISO) : null;
      if (mKey) merchantEntry.months.add(mKey);
      merchantEntry.amounts.push(absoluteAmount);
      if (!data.userCategoryType) {
        pendingCount += 1;
        if (pendingClassification.length < 25) {
          pendingClassification.push({
            transactionId: data.transactionId,
            description: data.description || merchantName || categoryLabel,
            amount: absoluteAmount,
            createdISO: createdISO || null,
            defaultCategoryType: inferredType || null,
            defaultCategoryLabel: data.defaultCategoryLabel || inferDefaultCategoryLabel(raw) || null,
            merchantName: merchantName || null,
          });
        }
      }
    }
  }

  const categories = Array.from(categoryTotals.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 50)
    .map((entry) => ({
      label: entry.label,
      amount: entry.amount,
      count: entry.count,
      type: entry.type,
    }));

  const monthly = {};
  const spendTimeline = [];
  Array.from(monthlyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .forEach(([month, values]) => {
      monthly[month] = values;
      spendTimeline.push({
        month,
        ...values,
        net: values.income - (values.mandatory + values.optional + values.savings),
      });
    });

  const merchantSummary = Array.from(merchantTotals.values())
    .map((entry) => {
      // Basic recurring detection: appears in ≥2 distinct months and amount variance small
      const monthCount = entry.months.size;
      const amounts = entry.amounts || [];
      const mean = amounts.length ? amounts.reduce((a, b) => a + b, 0) / amounts.length : 0;
      const variance = amounts.length ? amounts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / amounts.length : 0;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? std / mean : 0;
      const isRecurring = monthCount >= 2 && cv <= 0.25; // low variance across months
      const topCategory = Object.entries(entry.byCategory)
        .sort((a, b) => b[1] - a[1])[0];
      return {
        merchantKey: entry.merchantKey,
        merchantName: entry.merchantName || 'Merchant',
        totalSpend: entry.totalSpend,
        transactions: entry.transactions,
        primaryCategoryType: topCategory ? topCategory[0] : 'optional',
        lastTransactionISO: entry.lastTransactionISO,
        months: monthCount,
        isRecurring,
        avgAmount: mean,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 50);

  const netCashflow = totals.income - (totals.mandatory + totals.optional + totals.savings);

  return {
    totals,
    categories,
    monthly,
    spendTimeline,
    merchantSummary,
    pendingClassification,
    pendingCount,
    netCashflow,
  };
}

function buildBudgetProgress(totals, categories, budgetByCategory, budgetLabelIndex = {}) {
  const entries = [];
  for (const [normalizedKey, value] of Object.entries(budgetByCategory)) {
    if (!Number.isFinite(value)) continue;
    const canonicalKey = normalizedKey.trim();
    if (!canonicalKey) continue;
    const label = budgetLabelIndex[canonicalKey] || normalizedKey;
    let actual = 0;
    if (SAFE_CATEGORY_TYPES.includes(canonicalKey)) {
      actual = totals[canonicalKey] || 0;
    } else {
      actual = categories
        .filter((cat) => cat.label && cat.label.toLowerCase() === canonicalKey)
        .reduce((sum, cat) => sum + cat.amount, 0);
    }
    entries.push({
      key: label,
      budget: value,
      actual,
      variance: value - actual,
      utilisation: value > 0 ? Math.min((actual / value) * 100, 999) : null,
    });
  }
  return entries;
}

function buildGoalAlignment(pots, goals, avgMonthlySavings = 0) {
  const potIndex = new Map();
  pots.forEach((snap) => {
    const pot = snap.data ? snap.data() : snap;
    if (!pot) return;
    const idKey = String(pot.potId || pot.id || '').toLowerCase();
    if (idKey) potIndex.set(idKey, pot);
    if (pot.name) potIndex.set(pot.name.toLowerCase(), pot);
  });

  const goalSummaries = [];
  const themeTotals = {};
  let totalShortfall = 0;
  let totalMonthlyRequired = 0;
  let goalsWithTargets = 0;

  goals.forEach((snap) => {
    const goal = snap.data ? snap.data() : snap;
    if (!goal) return;
    const goalId = snap.id || goal.id;
    const estimatedCost = Number(goal.estimatedCost || goal.targetValue || goal.target || 0);
    const themeId = Number(goal.theme || 0);
    const title = goal.title || 'Goal';
    const normalizedTitle = title.toLowerCase();

    let matchedPot = null;
    const explicitPotId = String(goal.potId || goal.pot_id || '').toLowerCase();
    if (explicitPotId && potIndex.has(explicitPotId)) {
      matchedPot = potIndex.get(explicitPotId);
    }
    if (!matchedPot) {
      for (const pot of potIndex.values()) {
        const potName = String(pot.name || '').toLowerCase();
        if (!potName) continue;
        if (normalizedTitle.includes(potName) || potName.includes(normalizedTitle)) {
          matchedPot = pot;
          break;
        }
      }
    }

    const potBalanceMinor = matchedPot?.balance != null ? Number(matchedPot.balance) : 0;
    const potBalance = potBalanceMinor / 100;
    const fundedAmount = estimatedCost ? Math.min(potBalance, estimatedCost) : potBalance;
    const shortfall = estimatedCost ? Math.max(estimatedCost - potBalance, 0) : 0;
    const fundedPercent = estimatedCost ? Math.min((potBalance / estimatedCost) * 100, 100) : null;

    // Funding cadence based on goal target date if available
    const targetDateMs = Number(goal.endDate || goal.targetDate || goal.targetTime || 0) || null;
    const nowMs = Date.now();
    let monthsToTarget = null;
    if (targetDateMs && targetDateMs > nowMs) {
      const diffMs = targetDateMs - nowMs;
      monthsToTarget = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 30)));
      goalsWithTargets += 1;
    }

    let monthlyRequired = null;
    if (shortfall > 0) {
      if (monthsToTarget) {
        monthlyRequired = shortfall / monthsToTarget;
      } else if (avgMonthlySavings > 0) {
        // Fallback: assume a 6-month horizon or use savings cadence if available
        const assumedMonths = 6;
        monthlyRequired = shortfall / assumedMonths;
      }
    }

    totalShortfall += shortfall;
    if (monthlyRequired) {
      totalMonthlyRequired += monthlyRequired;
    }

    // Calculate time to save based on shortfall and average monthly savings
    let monthsToSave = null;
    if (shortfall > 0 && avgMonthlySavings > 0) {
      monthsToSave = Math.ceil(shortfall / avgMonthlySavings);
    }

    goalSummaries.push({
      goalId,
      title,
      themeId,
      themeName: THEME_NAME_MAP[themeId] || 'General',
      estimatedCost,
      potId: matchedPot?.potId || matchedPot?.id || null,
      potName: matchedPot?.name || null,
      potBalance,
      fundedAmount,
      fundedPercent,
      shortfall,
      monthsToSave,
      monthsToTarget,
      monthlyRequired,
    });

    if (!themeTotals[themeId]) {
      themeTotals[themeId] = {
        themeId,
        themeName: THEME_NAME_MAP[themeId] || 'General',
        goalCount: 0,
        totalEstimatedCost: 0,
        totalPotBalance: 0,
        totalShortfall: 0,
      };
    }
    const agg = themeTotals[themeId];
    agg.goalCount += 1;
    agg.totalEstimatedCost += estimatedCost;
    agg.totalPotBalance += potBalance;
    agg.totalShortfall += shortfall;
  });

  const themeArray = Object.values(themeTotals).map((theme) => ({
    ...theme,
    fundedPercent: theme.totalEstimatedCost
      ? Math.min((theme.totalPotBalance / theme.totalEstimatedCost) * 100, 100)
      : null,
  }));

  const goalFundingPlan = {
    goalsWithTargets,
    totalShortfall,
    monthlyRequired: totalMonthlyRequired,
    avgMonthlySavings,
  };

  return { goalSummaries, themes: themeArray, goalFundingPlan };
}

async function computeMonzoAnalytics(uidOrDb, maybeUid) {
  const db = maybeUid ? uidOrDb : admin.firestore();
  const uid = maybeUid || uidOrDb;
  if (!uid) {
    throw new Error('computeMonzoAnalytics requires uid');
  }
  const [txSnap, potSnap, goalsSnap, budgetsSnap] = await Promise.all([
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_pots').where('ownerUid', '==', uid).get(),
    db.collection('goals').where('ownerUid', '==', uid).get(),
    db.collection('finance_budgets').doc(uid).get(),
  ]);

  const budgetByCategory = {};
  const budgetLabelIndex = {};
  let budgetCurrency = 'GBP';
  if (budgetsSnap.exists) {
    const data = budgetsSnap.data() || {};
    budgetCurrency = data.currency || 'GBP';
    const byCategory = data.byCategory || {};
    for (const [key, value] of Object.entries(byCategory)) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) continue;
      const normalized = String(key || '').trim().toLowerCase();
      if (!normalized) continue;
      budgetByCategory[normalized] = numeric;
      if (!budgetLabelIndex[normalized]) {
        budgetLabelIndex[normalized] = key;
      }
    }
  }

  const aggregation = summariseTransactions(txSnap.docs);

  // Calculate average monthly savings
  const months = Object.values(aggregation.monthly);
  const validMonths = months.filter(m => m.savings > 0);
  const avgMonthlySavings = validMonths.length > 0
    ? validMonths.reduce((sum, m) => sum + m.savings, 0) / validMonths.length
    : 0;

  const alignment = buildGoalAlignment(potSnap.docs, goalsSnap.docs, avgMonthlySavings);

  const summaryDoc = {
    ownerUid: uid,
    totals: aggregation.totals,
    categories: aggregation.categories,
    monthly: aggregation.monthly,
    spendTimeline: aggregation.spendTimeline,
    merchantSummary: aggregation.merchantSummary,
    recurringMerchants: aggregation.merchantSummary.filter((m) => m.isRecurring).slice(0, 50),
    pendingClassification: aggregation.pendingClassification,
    pendingCount: aggregation.pendingCount,
    budgetProgress: buildBudgetProgress(aggregation.totals, aggregation.categories, budgetByCategory, budgetLabelIndex),
    currency: budgetCurrency,
    netCashflow: aggregation.netCashflow,
    themeProgress: alignment.themes,
    budgetRecommendations: {
      savingsFromGoals: alignment.goalFundingPlan?.monthlyRequired || 0,
      shortfall: alignment.goalFundingPlan?.totalShortfall || 0,
      goalsWithTargets: alignment.goalFundingPlan?.goalsWithTargets || 0,
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('monzo_budget_summary').doc(uid).set(summaryDoc, { merge: true });

  const alignmentDoc = {
    ownerUid: uid,
    goals: alignment.goalSummaries,
    themes: alignment.themes,
    goalFundingPlan: alignment.goalFundingPlan,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('monzo_goal_alignment').doc(uid).set(alignmentDoc, { merge: true });

  return { summarySnapshot: summaryDoc, alignmentDoc };
}

module.exports = {
  computeMonzoAnalytics,
  buildGoalAlignment,
  summariseTransactions,
};
