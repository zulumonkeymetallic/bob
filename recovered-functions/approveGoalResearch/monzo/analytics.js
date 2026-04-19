const admin = require('firebase-admin');
const {
  inferDefaultCategoryType,
  inferDefaultCategoryLabel,
  toMonthKey,
  normaliseMerchantName,
  coerceCategoryType,
  SAFE_CATEGORY_TYPES,
} = require('./shared');
const {
  loadIncomeOverrides,
  saveIncomeSourcesSnapshot,
  loadSubscriptionOverrides,
  saveSubscriptionRecommendations,
} = require('./dataAccess');

const THEME_NAME_MAP = {
  1: 'Health',
  2: 'Growth',
  3: 'Finance & Wealth',
  4: 'Tribe',
  5: 'Home',
};

const INCOME_AMOUNT_THRESHOLD = 150; // GBP
const SUBSCRIPTION_MIN_MONTHS = 2;
const SUBSCRIPTION_VARIANCE_THRESHOLD = 0.25;
const SUBSCRIPTION_STRONG_THRESHOLD = 40; // GBP/month
const MS_PER_DAY = 86400000;

function median(values = []) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function inferCadence(daysBetween) {
  if (!Number.isFinite(daysBetween) || daysBetween <= 0) return null;
  if (daysBetween <= 10) return 'weekly';
  if (daysBetween <= 18) return 'fortnightly';
  if (daysBetween <= 45) return 'monthly';
  if (daysBetween <= 75) return 'bi-monthly';
  if (daysBetween <= 110) return 'quarterly';
  if (daysBetween <= 200) return 'semi-annual';
  if (daysBetween <= 400) return 'annual';
  return null;
}

function cadenceToMonthlyMultiplier(cadence) {
  switch (cadence) {
    case 'weekly':
      return 4.33;
    case 'fortnightly':
      return 2.17;
    case 'monthly':
      return 1;
    case 'bi-monthly':
      return 0.5;
    case 'quarterly':
      return 1 / 3;
    case 'semi-annual':
      return 1 / 6;
    case 'annual':
      return 1 / 12;
    default:
      return 1;
  }
}

function normaliseCategoryKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'uncategorised';
}

function getMonthMeta(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dayOfMonth = date.getUTCDate();
  const elapsedPercent = Math.min((dayOfMonth / daysInMonth) * 100, 100);
  return { year, month, daysInMonth, dayOfMonth, elapsedPercent };
}

function parseBudgetRaw(raw) {
  if (raw && typeof raw === 'object') {
    const modeValue = String(raw.type || raw.mode || '').toLowerCase();
    const numericValue = Number(raw.value ?? raw.amount ?? raw.percent ?? 0);
    if (modeValue === 'percent') {
      return {
        mode: 'percent',
        percentValue: Number.isFinite(numericValue) ? numericValue : 0,
        fixedMajor: 0,
      };
    }
    const major = Number.isFinite(numericValue) ? numericValue : 0;
    return {
      mode: 'fixed',
      fixedMajor: major,
      percentValue: null,
    };
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return { mode: 'fixed', fixedMajor: 0, percentValue: null };
  }

  return {
    mode: 'fixed',
    fixedMajor: numeric / 100,
    percentValue: null,
  };
}

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

function summariseTransactions(transactions, { incomeOverrides = {}, subscriptionOverrides = {} } = {}) {
  const totals = { mandatory: 0, optional: 0, savings: 0, income: 0 };
  const monthlyMap = new Map();
  const categoryTotals = new Map();
  const merchantTotals = new Map();
  const pendingClassification = [];
  let pendingCount = 0;
  const incomeMap = new Map();
  const categoryInsights = new Map();
  const now = new Date();
  const twelveMonthsAgo = new Date(now.getTime());
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const twelveMonthsAgoMs = twelveMonthsAgo.getTime();

  for (const doc of transactions) {
    const data = doc.data() || {};
    const amount = parseAmount(data);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const raw = data.raw || {};
    const inferredType = inferDefaultCategoryType(raw);
    const fallbackType = amount >= 0 ? 'income' : 'optional';
    let categoryType = coerceCategoryType(
      data.userCategoryType
      || data.aiCategoryType
      || data.categoryType
      || data.defaultCategoryType
      || inferredType,
      fallbackType
    );

    const merchantName = data.merchant?.name || data.counterparty?.name || data.description || inferDefaultCategoryLabel(raw);
    const merchantKey = merchantName ? normaliseMerchantName(merchantName) : (data.transactionId ? normaliseMerchantName(data.transactionId) : null);

    const absoluteAmount = Math.abs(amount);
    const monthKey = data.monthKey || (data.createdISO ? toMonthKey(data.createdISO) : null);
    const createdISO = data.createdISO || null;
    const createdMs = createdISO ? Date.parse(createdISO) : null;

    const overrideValue = merchantKey ? incomeOverrides[merchantKey] : undefined;
    const defaultIncomeCandidate = amount > 0
      && absoluteAmount >= INCOME_AMOUNT_THRESHOLD
      && (categoryType === 'income' || !data.userCategoryType);
    const isIncome = typeof overrideValue === 'boolean' ? overrideValue : defaultIncomeCandidate;
    if (isIncome) {
      categoryType = 'income';
      if (merchantKey) {
        if (!incomeMap.has(merchantKey)) {
          incomeMap.set(merchantKey, {
            merchantKey,
            merchantName: merchantName || merchantKey,
            total: 0,
            transactions: 0,
            months: new Set(),
            override: typeof overrideValue === 'boolean' ? overrideValue : null,
            source: typeof overrideValue === 'boolean' ? 'manual' : 'detected',
          });
        }
        const entry = incomeMap.get(merchantKey);
        entry.total += absoluteAmount;
        entry.transactions += 1;
        if (monthKey) entry.months.add(monthKey);
      }
    }

    const categoryLabel = String(
      data.userCategoryLabel
      || data.userCategory
      || data.aiCategoryLabel
      || data.defaultCategoryLabel
      || inferDefaultCategoryLabel(raw)
    );

    const normalizedLabel = categoryLabel.trim().toLowerCase();
    const slugLabel = normalizedLabel.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'uncategorised';
    const insightKey = `${categoryType}__${slugLabel}`;
    if (!categoryInsights.has(insightKey)) {
      categoryInsights.set(insightKey, {
        key: insightKey,
        categoryKey: slugLabel,
        label: categoryLabel,
        type: categoryType,
        total12: 0,
        monthlyTotals: new Map(),
        monthsSeen: new Set(),
      });
    }
    const insight = categoryInsights.get(insightKey);
    if (!insight.label && categoryLabel) {
      insight.label = categoryLabel;
    }
    if (insight.type !== categoryType && absoluteAmount > 0) {
      insight.type = categoryType;
    }

    if (Number.isFinite(createdMs) && createdMs >= twelveMonthsAgoMs) {
      insight.total12 += absoluteAmount;
      if (monthKey) {
        const prev = insight.monthlyTotals.get(monthKey) || 0;
        insight.monthlyTotals.set(monthKey, prev + absoluteAmount);
        insight.monthsSeen.add(monthKey);
      }
    }

    totals[categoryType] = (totals[categoryType] || 0) + absoluteAmount;

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

    const isSpend = amount < 0 && categoryType !== 'income';
    if (isSpend) {
      const spendKey = merchantKey || normaliseMerchantName(data.transactionId || data.id || 'merchant');
      if (!merchantTotals.has(spendKey)) {
        merchantTotals.set(spendKey, {
          merchantKey: spendKey,
          merchantName,
          totalSpend: 0,
          transactions: 0,
          byCategory: {},
          byCategoryKey: {},
          lastTransactionISO: null,
          months: new Set(),
          amounts: [],
          timestamps: [],
        });
      }
      const merchantEntry = merchantTotals.get(spendKey);
      merchantEntry.totalSpend += absoluteAmount;
      merchantEntry.transactions += 1;
      merchantEntry.byCategory[categoryType] = (merchantEntry.byCategory[categoryType] || 0) + absoluteAmount;
      const insightKey = `${categoryType}__${slugLabel}`;
      merchantEntry.byCategoryKey[insightKey] = (merchantEntry.byCategoryKey[insightKey] || 0) + absoluteAmount;
      if (createdISO && (!merchantEntry.lastTransactionISO || createdISO > merchantEntry.lastTransactionISO)) {
        merchantEntry.lastTransactionISO = createdISO;
      }
      const mKey = createdISO ? toMonthKey(createdISO) : null;
      if (mKey) merchantEntry.months.add(mKey);
      merchantEntry.amounts.push(absoluteAmount);
      if (Number.isFinite(createdMs)) {
        merchantEntry.timestamps.push(createdMs);
      }
      if (!data.userCategoryType && !data.aiCategoryType) {
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

  const recurringByCategory = new Map();

  const merchantSummary = Array.from(merchantTotals.values())
    .map((entry) => {
      // Basic recurring detection: appears in ≥2 distinct months and amount variance small
      const monthCount = entry.months.size;
      const amounts = entry.amounts || [];
      const mean = amounts.length ? amounts.reduce((a,b)=>a+b,0) / amounts.length : 0;
      const variance = amounts.length ? amounts.reduce((a,b)=>a + Math.pow(b-mean,2), 0) / amounts.length : 0;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? std / mean : 0;
      const sortedTimestamps = (entry.timestamps || []).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
      let cadence = null;
      if (sortedTimestamps.length >= 2) {
        const deltas = [];
        for (let i = 1; i < sortedTimestamps.length; i += 1) {
          const diffDays = (sortedTimestamps[i] - sortedTimestamps[i - 1]) / MS_PER_DAY;
          if (Number.isFinite(diffDays) && diffDays > 0) deltas.push(diffDays);
        }
        const medianDays = median(deltas);
        cadence = inferCadence(medianDays);
      }
      const monthlyFromMonths = monthCount > 0 ? entry.totalSpend / monthCount : mean;
      const monthlyEquivalent = cadence
        ? mean * cadenceToMonthlyMultiplier(cadence)
        : monthlyFromMonths;
      const hasCadenceEvidence = cadence && sortedTimestamps.length >= 2;
      const isRecurring = (monthCount >= SUBSCRIPTION_MIN_MONTHS || hasCadenceEvidence) && cv <= SUBSCRIPTION_VARIANCE_THRESHOLD;
      const topCategory = Object.entries(entry.byCategory)
        .sort((a, b) => b[1] - a[1])[0];
      if (isRecurring && monthlyEquivalent > 0 && entry.totalSpend > 0) {
        Object.entries(entry.byCategoryKey || {}).forEach(([categoryKeyFull, amount]) => {
          if (!Number.isFinite(amount) || amount <= 0) return;
          const share = amount / entry.totalSpend;
          if (!Number.isFinite(share) || share <= 0) return;
          const slug = categoryKeyFull.includes('__') ? categoryKeyFull.split('__')[1] : categoryKeyFull;
          if (!slug) return;
          const monthlyForCategory = monthlyEquivalent * share;
          if (!Number.isFinite(monthlyForCategory) || monthlyForCategory <= 0) return;
          const current = recurringByCategory.get(slug) || { amount: 0, merchants: [] };
          current.amount += monthlyForCategory;
          current.merchants.push({
            merchantKey: entry.merchantKey,
            merchantName: entry.merchantName || 'Merchant',
            monthlyAmount: Number(monthlyForCategory.toFixed(2)),
            cadence: cadence || (monthCount >= SUBSCRIPTION_MIN_MONTHS ? 'monthly' : null),
          });
          recurringByCategory.set(slug, current);
        });
      }
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
        monthlyAmount: Number(monthlyEquivalent.toFixed(2)),
        cadence: cadence || null,
        variability: cv,
      };
    })
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 50);

  const netCashflow = totals.income - (totals.mandatory + totals.optional + totals.savings);

  const budgetRecommendations = Array.from(categoryInsights.values())
    .map((entry) => {
      const monthBreakdown = Array.from(entry.monthlyTotals.entries())
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);
      const totalLast12 = entry.total12;
      const averagePerMonth = 12 > 0 ? totalLast12 / 12 : 0;
      const recurringMeta = recurringByCategory.get(entry.categoryKey) || { amount: 0, merchants: [] };
      const recurringMonthly = Number(recurringMeta.amount ? recurringMeta.amount.toFixed(2) : '0');
      const recurringMerchants = recurringMeta.merchants
        ? [...recurringMeta.merchants].sort((a, b) => (b.monthlyAmount || 0) - (a.monthlyAmount || 0)).slice(0, 6)
        : [];
      const nonRecurringPortion = Math.max(averagePerMonth - recurringMonthly, 0);
      let recommendedMonthly = averagePerMonth;
      if (entry.type === 'optional') {
        // Encourage a modest reduction on non-recurring discretionary spend while preserving recurring commitments
        recommendedMonthly = recurringMonthly + (nonRecurringPortion * 0.9);
      } else if (entry.type === 'savings') {
        recommendedMonthly = Math.max(recurringMonthly, averagePerMonth * 1.1);
      }
      const normalizedRecommended = Number((recommendedMonthly || 0).toFixed(2));
      const safeRecommended = Math.max(normalizedRecommended, recurringMonthly);
      return {
        key: entry.key,
        categoryKey: entry.categoryKey,
        label: entry.label,
        type: entry.type,
        totalLast12: Number(totalLast12.toFixed(2)),
        averagePerMonth: Number(averagePerMonth.toFixed(2)),
        recommendedMonthly: safeRecommended,
        recurringMonthly,
        recurringMerchants,
        monthsSampled: entry.monthsSeen.size,
        monthBreakdown,
      };
    })
    .filter((entry) => Number.isFinite(entry.totalLast12))
    .sort((a, b) => b.totalLast12 - a.totalLast12);

  const incomeSources = Array.from(incomeMap.values()).map((entry) => {
    const monthCount = entry.months.size || 1;
    return {
      merchantKey: entry.merchantKey,
      merchantName: entry.merchantName,
      total: Number(entry.total.toFixed(2)),
      avgMonthly: Number((entry.total / monthCount).toFixed(2)),
      months: entry.months.size,
      transactions: entry.transactions,
      override: entry.override,
      source: entry.source,
    };
  }).sort((a, b) => b.total - a.total);

  const subscriptionInsights = merchantSummary
    .filter((m) => m.isRecurring)
    .map((m) => {
      const override = subscriptionOverrides[m.merchantKey] || null;
      let recommendation = 'keep';
      let confidence = 0.55;
      const monthlyAmount = Number((m.monthlyAmount != null ? m.monthlyAmount : m.avgAmount).toFixed(2));
      const cadence = m.cadence || (m.months >= SUBSCRIPTION_MIN_MONTHS ? 'monthly' : null);
      let rationale = `Recurring spend detected (£${monthlyAmount.toFixed(2)} per ${cadence || 'period'} across ${m.months} months).`;
      if (m.primaryCategoryType === 'optional') {
        if (monthlyAmount >= SUBSCRIPTION_STRONG_THRESHOLD) {
          recommendation = 'cancel';
          confidence = 0.8;
          rationale += ' Amount is above discretionary threshold.';
        } else {
          recommendation = 'reduce';
          confidence = 0.7;
          rationale += ' Consider reducing discretionary spend.';
        }
      } else if (m.primaryCategoryType === 'savings') {
        recommendation = 'keep';
        confidence = 0.6;
        rationale += ' Categorised as savings transfer.';
      }
      let status = 'suggested';
      if (override?.decision) {
        recommendation = override.decision;
        confidence = 1;
        rationale = override.note || rationale;
        status = 'overridden';
      }
      return {
        merchantKey: m.merchantKey,
        merchantName: m.merchantName,
        avgAmount: monthlyAmount,
        monthlyAmount,
        months: m.months,
        primaryCategoryType: m.primaryCategoryType,
        cadence,
        recommendation,
        confidence,
        rationale,
        status,
        lastTransactionISO: m.lastTransactionISO,
      };
    });

  return {
    totals,
    categories,
    monthly,
    spendTimeline,
    merchantSummary,
    pendingClassification,
    pendingCount,
    netCashflow,
    incomeSources,
    subscriptionInsights,
    budgetRecommendations,
    recurringCategorySummary: Object.fromEntries(
      Array.from(recurringByCategory.entries()).map(([slug, details]) => {
        const amount = Number(details.amount.toFixed(2));
        const merchants = (details.merchants || [])
          .sort((a, b) => (b.monthlyAmount || 0) - (a.monthlyAmount || 0))
          .slice(0, 6)
          .map((item) => ({
            merchantKey: item.merchantKey,
            merchantName: item.merchantName,
            monthlyAmount: Number(item.monthlyAmount.toFixed(2)),
            cadence: item.cadence || null,
          }));
        return [slug, { amount, merchants }];
      })
    ),
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

  const [txSnap, potSnap, goalsSnap, budgetsSnap, incomeOverrides, subscriptionOverrides] = await Promise.all([
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_pots').where('ownerUid', '==', uid).get(),
    db.collection('goals').where('ownerUid', '==', uid).get(),
    db.collection('finance_budgets').doc(uid).get(),
    loadIncomeOverrides(db, uid),
    loadSubscriptionOverrides(db, uid),
  ]);

  let budgetCurrency = 'GBP';
  let rawBudgets = {};
  if (budgetsSnap.exists) {
    const data = budgetsSnap.data() || {};
    budgetCurrency = data.currency || 'GBP';
    rawBudgets = data.byCategory || {};
  }

  const aggregation = summariseTransactions(txSnap.docs, { incomeOverrides, subscriptionOverrides });
  const alignment = buildGoalAlignment(potSnap.docs, goalsSnap.docs);
  const recurringCategorySummary = aggregation.recurringCategorySummary || {};

  const currentMonthDate = new Date();
  const currentMonthKey = toMonthKey(currentMonthDate.toISOString());
  const monthMeta = getMonthMeta(currentMonthDate);
  const monthlyIncomeMajor = (aggregation.monthly?.[currentMonthKey]?.income) || 0;

  const recommendationMap = new Map();
  (aggregation.budgetRecommendations || []).forEach((rec) => {
    const recKey = rec?.categoryKey || normaliseCategoryKey(rec?.label || rec?.key || '');
    if (!recKey) return;
    recommendationMap.set(recKey, rec);
  });

  const budgetLabelIndex = {};
  const budgetByCategoryForProgress = {};
  const monthlyBudgetStatus = [];
  const burnRateAlerts = [];

  const budgetEntries = Object.entries(rawBudgets || {});
  for (const [displayKey, rawValue] of budgetEntries) {
    const normalizedKey = normaliseCategoryKey(displayKey);
    if (!normalizedKey) continue;

    const parsed = parseBudgetRaw(rawValue);
    const recommendation = recommendationMap.get(normalizedKey);
    const resolvedBudgetMajor = parsed.mode === 'percent'
      ? (monthlyIncomeMajor * (parsed.percentValue / 100))
      : parsed.fixedMajor;
    const normalizedBudget = Number.isFinite(resolvedBudgetMajor) ? Math.max(resolvedBudgetMajor, 0) : 0;
    if (normalizedBudget > 0) {
      budgetByCategoryForProgress[normalizedKey] = normalizedBudget;
    }
    budgetLabelIndex[normalizedKey] = displayKey;

    const monthBreakdown = recommendation?.monthBreakdown || [];
    const currentMonthEntry = monthBreakdown.find((item) => item.month === currentMonthKey);
    let actualThisMonth = currentMonthEntry ? currentMonthEntry.amount : 0;
    if (!actualThisMonth && SAFE_CATEGORY_TYPES.includes(normalizedKey)) {
      actualThisMonth = aggregation.monthly?.[currentMonthKey]?.[normalizedKey] || 0;
    }

    const budgetPercentOfIncome = monthlyIncomeMajor > 0 && normalizedBudget > 0
      ? (normalizedBudget / monthlyIncomeMajor) * 100
      : null;
    const spendPercent = normalizedBudget > 0
      ? (actualThisMonth / normalizedBudget) * 100
      : null;
    const burnRate = spendPercent != null
      ? spendPercent - monthMeta.elapsedPercent
      : null;

    let burnStatus = 'ok';
    if (burnRate != null) {
      if (burnRate >= 10) {
        burnStatus = 'critical';
      } else if (burnRate >= 5) {
        burnStatus = 'warning';
      } else if (burnRate <= -10) {
        burnStatus = 'ahead';
      }
    }

    const totalLast12 = recommendation?.totalLast12 ?? null;
    const averagePerMonth = recommendation?.averagePerMonth ?? null;
    const recommendedMonthly = recommendation?.recommendedMonthly ?? null;
    const monthsSampled = recommendation?.monthsSampled ?? 0;
    const type = recommendation?.type || (SAFE_CATEGORY_TYPES.includes(normalizedKey) ? normalizedKey : 'optional');
    const categorySlug = recommendation?.categoryKey || normaliseCategoryKey(recommendation?.label || displayKey);
    const recurringMeta = recurringCategorySummary[categorySlug] || null;
    const recurringMonthly = recurringMeta ? Number(recurringMeta.amount.toFixed(2)) : null;
    const recurringMerchants = recurringMeta ? recurringMeta.merchants : [];

    const budgetEntry = {
      key: normalizedKey,
      categoryKey: normalizedKey,
      label: recommendation?.label || displayKey,
      type,
      budgetMode: parsed.mode,
      budgetValue: parsed.mode === 'percent'
        ? Number(Number(parsed.percentValue || 0).toFixed(2))
        : Number(Number(parsed.fixedMajor || 0).toFixed(2)),
      budgetMonthly: Number(normalizedBudget.toFixed(2)),
      budgetPercentOfIncome: budgetPercentOfIncome != null ? Number(budgetPercentOfIncome.toFixed(2)) : null,
      actualMonthly: Number(actualThisMonth.toFixed(2)),
      variance: Number((normalizedBudget - actualThisMonth).toFixed(2)),
      utilisation: spendPercent != null ? Number(spendPercent.toFixed(2)) : null,
      elapsedPercent: Number(monthMeta.elapsedPercent.toFixed(2)),
      spendPercent: spendPercent != null ? Number(spendPercent.toFixed(2)) : null,
      burnRate: burnRate != null ? Number(burnRate.toFixed(2)) : null,
      burnStatus,
      totalLast12: totalLast12 != null ? Number(totalLast12.toFixed(2)) : null,
      averagePerMonth: averagePerMonth != null ? Number(averagePerMonth.toFixed(2)) : null,
      recommendedMonthly: recommendedMonthly != null ? Number(recommendedMonthly.toFixed(2)) : null,
      monthsSampled,
      recurringMonthly: recurringMonthly != null ? Number(recurringMonthly.toFixed(2)) : null,
      recurringMerchants,
    };

    monthlyBudgetStatus.push(budgetEntry);

    if (burnStatus === 'warning' || burnStatus === 'critical') {
      burnRateAlerts.push({
        key: normalizedKey,
        label: budgetEntry.label,
        status: burnStatus,
        spendPercent: budgetEntry.spendPercent,
        elapsedPercent: budgetEntry.elapsedPercent,
        variance: budgetEntry.variance,
        actualMonthly: budgetEntry.actualMonthly,
        budgetMonthly: budgetEntry.budgetMonthly,
      });
    }
  }

  const burnSeverityRank = { critical: 3, warning: 2, ahead: 1, ok: 0 };
  monthlyBudgetStatus.sort((a, b) => a.label.localeCompare(b.label));
  burnRateAlerts.sort((a, b) => burnSeverityRank[b.status] - burnSeverityRank[a.status]);

  const budgetProgress = buildBudgetProgress(
    aggregation.totals,
    aggregation.categories,
    budgetByCategoryForProgress,
    budgetLabelIndex
  );

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
    incomeSources: aggregation.incomeSources,
    subscriptionInsights: aggregation.subscriptionInsights,
    subscriptionPendingCount: aggregation.subscriptionInsights.filter((s) => s.status !== 'overridden').length,
    budgetRecommendations: aggregation.budgetRecommendations,
    budgetProgress,
    monthlyBudgetStatus,
    burnRateAlerts,
    recurringCategorySummary: aggregation.recurringCategorySummary,
    currentMonth: {
      key: currentMonthKey,
      income: Number(monthlyIncomeMajor.toFixed(2)),
      daysElapsed: monthMeta.dayOfMonth,
      daysInMonth: monthMeta.daysInMonth,
      elapsedPercent: Number(monthMeta.elapsedPercent.toFixed(2)),
    },
    currency: budgetCurrency,
    netCashflow: aggregation.netCashflow,
    themeProgress: alignment.themes,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('monzo_budget_summary').doc(uid).set(summaryDoc, { merge: true });
  await saveIncomeSourcesSnapshot(db, uid, aggregation.incomeSources || []);
  await saveSubscriptionRecommendations(db, uid, aggregation.subscriptionInsights || []);

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
