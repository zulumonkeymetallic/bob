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
  1: 'Health',
  2: 'Growth',
  3: 'Finance & Wealth',
  4: 'Tribe',
  5: 'Home',
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
    if (isSpend) {
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
      const topCategory = Object.entries(entry.byCategory)
        .sort((a, b) => b[1] - a[1])[0];
      return {
        merchantKey: entry.merchantKey,
        merchantName: entry.merchantName || 'Merchant',
        totalSpend: entry.totalSpend,
        transactions: entry.transactions,
        primaryCategoryType: topCategory ? topCategory[0] : 'optional',
        lastTransactionISO: entry.lastTransactionISO,
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

function buildGoalAlignment(pots, goals) {
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

  return { goalSummaries, themes: themeArray };
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
  const alignment = buildGoalAlignment(potSnap.docs, goalsSnap.docs);

  const summaryDoc = {
    ownerUid: uid,
    totals: aggregation.totals,
    categories: aggregation.categories,
    monthly: aggregation.monthly,
    spendTimeline: aggregation.spendTimeline,
    merchantSummary: aggregation.merchantSummary,
    pendingClassification: aggregation.pendingClassification,
    pendingCount: aggregation.pendingCount,
    budgetProgress: buildBudgetProgress(aggregation.totals, aggregation.categories, budgetByCategory, budgetLabelIndex),
    currency: budgetCurrency,
    netCashflow: aggregation.netCashflow,
    themeProgress: alignment.themes,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('monzo_budget_summary').doc(uid).set(summaryDoc, { merge: true });

  const alignmentDoc = {
    ownerUid: uid,
    goals: alignment.goalSummaries,
    themes: alignment.themes,
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
