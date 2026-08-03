// Monthly position ledger — the account register, the per-month positions, the
// persisted net-worth series and the FIRE assumptions.
//
// Why this exists: BOB modelled money FLOWS (monzo_transactions) well and money
// POSITIONS barely at all. finance_manual_accounts held one current balance per
// account with no history, no APR and no contributed-vs-value split; net worth was
// computed in memory in enhancements.js and thrown away; APR lived only inside
// finance_budgets_v2.debts[] where no backend code read it; and the FIRE projection
// was unsaved React state driven by a hardcoded 70%-of-income spend guess.
//
// Structured after ./enhancements.js: httpsV2.onCall, europe-west2, batch commits
// at 400 ops. Deterministic doc ids throughout, so every write is an idempotent
// upsert and re-seeds/retries cannot double-count.

const httpsV2 = require('firebase-functions/v2/https');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
const crypto = require('crypto');

const {
  POSITION_SOURCES,
  isMonthKey,
  monthIndexOf,
  monthKeyFromDate,
  monthKeyFromIndex,
  monthEndISO,
  monthKeysBetween,
  lastNMonths,
  sideForKind,
  normaliseKind,
  toPence,
  deriveGain,
  netWorthFromPositions,
  computeFire,
} = require('./ledgerMath');
const { resolveTransactionCategory, buildCategoryIndex } = require('./bucketResolver');
const { mergeFinanceCategories } = require('./categories');

const FUNCTION_REGION = 'europe-west2';
const MAX_BATCH = 400;
const MAX_POSITION_ROWS = 500;

const ACCOUNTS = 'finance_ledger_accounts';
const POSITIONS = 'finance_positions';
const NET_WORTH = 'finance_net_worth_history';
const ASSUMPTIONS = 'finance_plan_assumptions';

const DEFAULT_ASSUMPTIONS = {
  currentAge: 42,
  targetRetirementAge: 55,
  safeWithdrawalRatePct: 4,
  nominalGrowthRatePct: 5,
  inflationRatePct: 2.5,
  useRealReturns: true,
  spendBasis: 'trailing12',
  manualAnnualSpendPence: null,
  monthlyContributionOverridePence: null,
  includePensionInFire: true,
  includePropertyInFire: false,
};

/** finance_manual_accounts.type -> ledger kind. All refinable by the user afterwards. */
const MANUAL_TYPE_TO_KIND = {
  asset: 'other',
  investment: 'gia',
  cash: 'current',
  savings: 'savings',
  debt: 'credit_card',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const requireAuth = (req) => {
  if (!req || !req.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  return req.auth.uid;
};

const accountDocId = (uid, accountId) => `${uid}_${accountId}`;
const positionDocId = (uid, accountId, monthKey) => `${uid}_${accountId}_${monthKey}`;
const netWorthDocId = (uid, monthKey) => `${uid}_${monthKey}`;

const newAccountId = () => `acc_${crypto.randomBytes(3).toString('hex')}`;

/** Deterministic id for a migrated record, so re-running cannot double-count. */
const migratedAccountId = (sourceId) => {
  const hash = crypto.createHash('sha1').update(String(sourceId)).digest('hex');
  return `mig_${hash.slice(0, 12)}`;
};

const text = (value) => {
  const t = String(value === null || value === undefined ? '' : value).trim();
  return t || null;
};

const clampDay = (value) => {
  const day = Number(value);
  if (!Number.isFinite(day)) return null;
  // 28 so a statement day is valid in February too.
  return Math.min(28, Math.max(1, Math.round(day)));
};

const percent = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric * 100) / 100;
};

/** BOB's ref convention is {PREFIX}-{5 digits} — see react-app/src/utils/referenceGenerator.ts. */
const generateAccountRef = () => {
  const numeric = (Date.now() % 100000 + Math.floor(Math.random() * 100)) % 100000;
  return `AC-${String(numeric).padStart(5, '0')}`;
};

async function commitInChunks(db, operations) {
  let batch = db.batch();
  let ops = 0;
  let committed = 0;
  for (const apply of operations) {
    apply(batch);
    ops += 1;
    committed += 1;
    if (ops >= MAX_BATCH) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
  return committed;
}

const loadAccounts = async (db, uid) => {
  const snap = await db.collection(ACCOUNTS).where('ownerUid', '==', uid).get();
  return snap.docs.map((d) => d.data()).filter((a) => a && a.deleted !== true);
};

/**
 * All positions for a user. Bounded by ownerUid only — a single-field index, which
 * is automatic. Deliberately no composite query: orchestrate-build.sh does not
 * deploy firestore.indexes.json, so a composite would fail at runtime in prod.
 */
const loadPositions = async (db, uid) => {
  const snap = await db.collection(POSITIONS).where('ownerUid', '==', uid).get();
  return snap.docs.map((d) => d.data()).filter(Boolean);
};

async function loadAssumptions(db, uid) {
  const snap = await db.collection(ASSUMPTIONS).doc(uid).get();
  const stored = snap.exists ? (snap.data() || {}) : {};
  return { ownerUid: uid, version: 1, ...DEFAULT_ASSUMPTIONS, ...stored };
}

function buildPositionPayload(uid, account, monthKey, input, existing) {
  const previous = existing || {};

  const valuePence = input.valuePence !== undefined
    ? Math.abs(toPence(input.valuePence) || 0)
    : Math.abs(Number(previous.valuePence) || 0);

  const contributedPence = input.contributedPence !== undefined
    ? Math.abs(toPence(input.contributedPence) || 0)
    : Math.abs(Number(previous.contributedPence) || 0);

  const { gainPence, returnPct } = deriveGain(valuePence, contributedPence);

  const payload = {
    ownerUid: uid,
    accountId: account.accountId,
    monthKey,
    monthIndex: monthIndexOf(monthKey),
    monthEndISO: monthEndISO(monthKey),
    valuePence,
    contributedPence,
    gainPence,
    returnPct,
    // Snapshot the account terms in force this month, so history survives an
    // APR or credit-limit change.
    aprSnapshot: account.apr === undefined ? null : account.apr,
    creditLimitPence: account.creditLimitPence === undefined ? null : account.creditLimitPence,
    minPaymentPence: account.minPaymentPence === undefined ? null : account.minPaymentPence,
    source: POSITION_SOURCES.includes(input.source) ? input.source : 'manual',
    confidence: input.confidence === 'estimated' ? 'estimated' : 'actual',
    isEstimate: input.isEstimate === true,
    enteredBy: input.enteredBy === 'system' ? 'system' : 'user',
    notes: text(input.notes),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  };

  if (!existing) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  return payload;
}

// ---------------------------------------------------------------------------
// Account register
// ---------------------------------------------------------------------------

const upsertFinanceLedgerAccount = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  const uid = requireAuth(req);
  const name = text(req.data?.name);
  if (!name) throw new httpsV2.HttpsError('invalid-argument', 'name is required');

  const kind = normaliseKind(req.data?.kind);
  const accountId = text(req.data?.accountId) || newAccountId();

  const db = admin.firestore();
  const ref = db.collection(ACCOUNTS).doc(accountDocId(uid, accountId));
  const existing = await ref.get();
  if (existing.exists && (existing.data() || {}).ownerUid !== uid) {
    throw new httpsV2.HttpsError('permission-denied', 'Not your account');
  }
  const prior = existing.exists ? (existing.data() || {}) : {};

  const payload = {
    ownerUid: uid,
    accountId,
    ref: prior.ref || generateAccountRef(),
    persona: text(req.data?.persona) || prior.persona || 'personal',
    name,
    provider: text(req.data?.provider),
    kind,
    // Stored rather than derived at read time so net-worth aggregation needs no lookup.
    side: sideForKind(kind),
    currency: (text(req.data?.currency) || prior.currency || 'GBP').toUpperCase(),

    apr: percent(req.data?.apr),
    aprType: ['purchase', 'variable', 'fixed'].includes(req.data?.aprType) ? req.data.aprType : null,
    creditLimitPence: toPence(req.data?.creditLimitPence),
    minPaymentPence: toPence(req.data?.minPaymentPence),
    minPaymentPercent: percent(req.data?.minPaymentPercent),
    statementDay: clampDay(req.data?.statementDay),
    paymentDueDay: clampDay(req.data?.paymentDueDay),
    termMonths: Number.isFinite(Number(req.data?.termMonths)) ? Math.round(Number(req.data.termMonths)) : null,
    monthlyContributionPence: toPence(req.data?.monthlyContributionPence),
    employerContributionPence: toPence(req.data?.employerContributionPence),

    monzoAccountId: text(req.data?.monzoAccountId),
    monzoPotId: text(req.data?.monzoPotId),
    externalSource: ['barclays', 'paypal', 'other'].includes(req.data?.externalSource) ? req.data.externalSource : null,
    linkedGoalId: text(req.data?.linkedGoalId),

    includeInNetWorth: req.data?.includeInNetWorth !== false,
    // Property defaults out of FIRE: you cannot draw 4% a year from a house you live in.
    includeInFire: req.data?.includeInFire !== undefined
      ? req.data.includeInFire !== false
      : !['property', 'other'].includes(kind),
    autoSeedFromMonzo: req.data?.autoSeedFromMonzo === true,

    archived: req.data?.archived === true,
    deleted: req.data?.deleted === true,
    notes: text(req.data?.notes),
    sortOrder: Number.isFinite(Number(req.data?.sortOrder))
      ? Number(req.data.sortOrder)
      : (Number(prior.sortOrder) || 0),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  };
  if (!existing.exists) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();

  await ref.set(payload, { merge: true });
  return { ok: true, accountId, account: { ...payload, updatedAt: null, createdAt: null } };
});

const deleteFinanceLedgerAccount = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  const uid = requireAuth(req);
  const accountId = text(req.data?.accountId);
  if (!accountId) throw new httpsV2.HttpsError('invalid-argument', 'accountId is required');

  const db = admin.firestore();
  const ref = db.collection(ACCOUNTS).doc(accountDocId(uid, accountId));
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, deleted: false };
  if ((snap.data() || {}).ownerUid !== uid) {
    throw new httpsV2.HttpsError('permission-denied', 'Not your account');
  }

  const positionsSnap = await db.collection(POSITIONS)
    .where('ownerUid', '==', uid)
    .get();
  const positionCount = positionsSnap.docs.filter((d) => (d.data() || {}).accountId === accountId).length;

  // Soft delete by default: history is the point of this collection, and a hard
  // delete with positions still attached would orphan them.
  if (req.data?.hard === true && positionCount === 0) {
    await ref.delete();
    return { ok: true, deleted: true, hard: true, accountId };
  }

  await ref.set({
    archived: true,
    deleted: true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  }, { merge: true });

  return { ok: true, deleted: true, hard: false, accountId, positionCount };
});

// ---------------------------------------------------------------------------
// Positions — the sheet cells
// ---------------------------------------------------------------------------

const upsertFinancePositions = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  const uid = requireAuth(req);
  const rows = Array.isArray(req.data?.rows) ? req.data.rows : [];
  if (!rows.length) return { ok: true, written: 0 };
  if (rows.length > MAX_POSITION_ROWS) {
    throw new httpsV2.HttpsError('invalid-argument', `At most ${MAX_POSITION_ROWS} rows per call`);
  }

  const db = admin.firestore();
  const accounts = await loadAccounts(db, uid);
  const accountsById = new Map(accounts.map((a) => [a.accountId, a]));

  const valid = [];
  const skipped = [];
  rows.forEach((row) => {
    const accountId = text(row?.accountId);
    const monthKey = text(row?.monthKey);
    if (!accountId || !monthKey || !isMonthKey(monthKey)) {
      skipped.push({ accountId, monthKey, reason: 'invalid_key' });
      return;
    }
    if (!accountsById.has(accountId)) {
      skipped.push({ accountId, monthKey, reason: 'unknown_account' });
      return;
    }
    valid.push({ accountId, monthKey, row });
  });

  if (!valid.length) return { ok: true, written: 0, skipped };

  const refs = valid.map((v) => db.collection(POSITIONS).doc(positionDocId(uid, v.accountId, v.monthKey)));
  const existingDocs = await db.getAll(...refs);

  const operations = valid.map((v, i) => {
    const existingSnap = existingDocs[i];
    const existing = existingSnap.exists ? existingSnap.data() : null;
    const payload = buildPositionPayload(uid, accountsById.get(v.accountId), v.monthKey, v.row, existing);
    return (batch) => batch.set(refs[i], payload, { merge: true });
  });

  const written = await commitInChunks(db, operations);
  return { ok: true, written, skipped };
});

// ---------------------------------------------------------------------------
// Read aggregator
// ---------------------------------------------------------------------------

const fetchFinanceLedger = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  const uid = requireAuth(req);
  const db = admin.firestore();

  const nowMonth = monthKeyFromDate(new Date());
  const toMonth = isMonthKey(req.data?.toMonth) ? req.data.toMonth : nowMonth;
  const defaultFrom = monthKeyFromIndex(monthIndexOf(toMonth) - 23);
  const fromMonth = isMonthKey(req.data?.fromMonth) ? req.data.fromMonth : defaultFrom;
  const months = monthKeysBetween(fromMonth, toMonth);
  const fromIndex = monthIndexOf(fromMonth);
  const toIndex = monthIndexOf(toMonth);

  const [accounts, allPositions, netWorthSnap, assumptions, legacyAccountsSnap, legacyBudgetSnap] = await Promise.all([
    loadAccounts(db, uid),
    loadPositions(db, uid),
    db.collection(NET_WORTH).where('ownerUid', '==', uid).get(),
    loadAssumptions(db, uid),
    db.collection('finance_manual_accounts').where('ownerUid', '==', uid).get(),
    db.collection('finance_budgets_v2').doc(uid).get(),
  ]);

  const inWindow = (row) => {
    const index = Number(row.monthIndex);
    return Number.isFinite(index) && index >= fromIndex && index <= toIndex;
  };

  const legacyDebts = legacyBudgetSnap.exists && Array.isArray((legacyBudgetSnap.data() || {}).debts)
    ? legacyBudgetSnap.data().debts
    : [];

  return {
    ok: true,
    fromMonth,
    toMonth,
    months,
    accounts: accounts.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)
      || String(a.name).localeCompare(String(b.name))),
    positions: allPositions.filter(inWindow),
    netWorthHistory: netWorthSnap.docs
      .map((d) => d.data())
      .filter((row) => row && inWindow(row))
      .sort((a, b) => a.monthIndex - b.monthIndex),
    assumptions,
    // Surfaced so the UI can offer the migration without a second round trip.
    legacyManualAccountCount: legacyAccountsSnap.size,
    legacyDebtCount: legacyDebts.length,
  };
});

// ---------------------------------------------------------------------------
// Assumptions
// ---------------------------------------------------------------------------

const upsertFinancePlanAssumptions = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  const uid = requireAuth(req);
  const db = admin.firestore();
  const current = await loadAssumptions(db, uid);

  const number = (value, fallback) => (Number.isFinite(Number(value)) ? Number(value) : fallback);

  const payload = {
    ownerUid: uid,
    currentAge: Math.round(number(req.data?.currentAge, current.currentAge)),
    targetRetirementAge: Math.round(number(req.data?.targetRetirementAge, current.targetRetirementAge)),
    safeWithdrawalRatePct: number(req.data?.safeWithdrawalRatePct, current.safeWithdrawalRatePct),
    nominalGrowthRatePct: number(req.data?.nominalGrowthRatePct, current.nominalGrowthRatePct),
    inflationRatePct: number(req.data?.inflationRatePct, current.inflationRatePct),
    useRealReturns: req.data?.useRealReturns !== undefined ? req.data.useRealReturns !== false : current.useRealReturns,
    spendBasis: ['trailing12', 'trailing6', 'manual'].includes(req.data?.spendBasis)
      ? req.data.spendBasis
      : current.spendBasis,
    manualAnnualSpendPence: req.data?.manualAnnualSpendPence !== undefined
      ? toPence(req.data.manualAnnualSpendPence)
      : current.manualAnnualSpendPence,
    monthlyContributionOverridePence: req.data?.monthlyContributionOverridePence !== undefined
      ? toPence(req.data.monthlyContributionOverridePence)
      : current.monthlyContributionOverridePence,
    includePensionInFire: req.data?.includePensionInFire !== undefined
      ? req.data.includePensionInFire !== false
      : current.includePensionInFire,
    includePropertyInFire: req.data?.includePropertyInFire !== undefined
      ? req.data.includePropertyInFire !== false
      : current.includePropertyInFire,
    // Bumped on every write so a net-worth row records which assumptions produced it.
    version: (Number(current.version) || 1) + 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  };

  await db.collection(ASSUMPTIONS).doc(uid).set(payload, { merge: true });
  return { ok: true, assumptions: { ...payload, updatedAt: null } };
});

// ---------------------------------------------------------------------------
// Net-worth rollup
// ---------------------------------------------------------------------------

/**
 * Spend/income totals per month from monzo_transactions, using the shared bucket
 * resolver so these figures agree with every other finance surface.
 */
function summariseFlows(transactionDocs, categoryIndex) {
  const byMonth = new Map();

  transactionDocs.forEach((doc) => {
    const data = doc.data ? doc.data() : doc;
    if (!data) return;

    const iso = data.createdISO || null;
    const monthKey = data.monthKey || (iso ? monthKeyFromDate(new Date(iso)) : null);
    if (!monthKey || !isMonthKey(monthKey)) return;

    const resolved = resolveTransactionCategory(data, { categoryIndex });
    if (resolved.bucket === 'bank_transfer') return;

    const amountMinor = Number.isFinite(Number(data.amountMinor))
      ? Math.round(Number(data.amountMinor))
      : Math.round((Number(data.amount) || 0) * 100);
    if (!amountMinor) return;

    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, {
        incomePence: 0, spendPence: 0, mandatoryPence: 0, optionalPence: 0,
      });
    }
    const bucketTotals = byMonth.get(monthKey);

    if (amountMinor > 0) {
      bucketTotals.incomePence += amountMinor;
      return;
    }

    const magnitude = Math.abs(amountMinor);
    bucketTotals.spendPence += magnitude;
    if (resolved.bucketV4 === 'mandatory') bucketTotals.mandatoryPence += magnitude;
    if (resolved.bucketV4 === 'optional') bucketTotals.optionalPence += magnitude;
  });

  return byMonth;
}

async function computeNetWorthForUser(db, uid, { months, dryRun }) {
  const [accounts, positions, assumptions, txSnap, categoriesSnap, existingSnap] = await Promise.all([
    loadAccounts(db, uid),
    loadPositions(db, uid),
    loadAssumptions(db, uid),
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
    db.collection('finance_categories').doc(uid).get(),
    db.collection(NET_WORTH).where('ownerUid', '==', uid).get(),
  ]);

  const categoryIndex = buildCategoryIndex(
    mergeFinanceCategories(categoriesSnap.exists ? (categoriesSnap.data() || {}).categories : [])
  );
  const flowsByMonth = summariseFlows(txSnap.docs, categoryIndex);

  const positionsByMonth = new Map();
  positions.forEach((position) => {
    if (!positionsByMonth.has(position.monthKey)) positionsByMonth.set(position.monthKey, new Map());
    positionsByMonth.get(position.monthKey).set(position.accountId, position);
  });

  const previousByMonth = new Map(
    existingSnap.docs.map((d) => [(d.data() || {}).monthKey, d.data()])
  );

  const snapshots = [];
  months.forEach((monthKey) => {
    const monthPositions = positionsByMonth.get(monthKey) || new Map();
    const totals = netWorthFromPositions(accounts, monthPositions);

    const flows = flowsByMonth.get(monthKey) || {
      incomePence: 0, spendPence: 0, mandatoryPence: 0, optionalPence: 0,
    };

    // Trailing 12 months of real spend — this is what replaces the hardcoded
    // "70% of income" guess the old FIRE panel used.
    const trailing12SpendPence = lastNMonths(monthKey, 12).reduce((sum, key) => {
      const monthFlows = flowsByMonth.get(key);
      return sum + (monthFlows ? monthFlows.spendPence : 0);
    }, 0);

    const monthsWithFlow = lastNMonths(monthKey, 12).filter((key) => flowsByMonth.has(key)).length;
    const monthlySurplusPence = flows.incomePence - flows.spendPence;

    const fire = computeFire(assumptions, {
      fireEligiblePence: totals.fireEligiblePence,
      // Annualise from however many months of history exist, so a new user is not
      // told their FIRE number is a twelfth of reality.
      trailing12SpendPence: monthsWithFlow > 0 && monthsWithFlow < 12
        ? Math.round((trailing12SpendPence / monthsWithFlow) * 12)
        : trailing12SpendPence,
      monthlySurplusPence,
    });

    const previousIndex = monthIndexOf(monthKey) - 1;
    const previous = previousByMonth.get(monthKeyFromIndex(previousIndex))
      || snapshots.find((s) => s.monthIndex === previousIndex)
      || null;

    snapshots.push({
      ownerUid: uid,
      monthKey,
      monthIndex: monthIndexOf(monthKey),
      monthEndISO: monthEndISO(monthKey),

      totalAssetPence: totals.totalAssetPence,
      totalDebtPence: totals.totalDebtPence,
      netWorthPence: totals.netWorthPence,
      deltaPence: previous ? totals.netWorthPence - (Number(previous.netWorthPence) || 0) : 0,
      byKindPence: totals.byKindPence,

      liquidAssetPence: totals.liquidAssetPence,
      fireEligiblePence: totals.fireEligiblePence,
      pensionPence: totals.pensionPence,
      propertyPence: totals.propertyPence,
      totalContributedPence: totals.totalContributedPence,
      totalGainPence: totals.totalGainPence,

      accountCount: totals.accountCount,
      coveredAccountCount: totals.coveredAccountCount,
      estimatedAccountIds: totals.estimatedAccountIds,

      incomePence: flows.incomePence,
      spendPence: flows.spendPence,
      mandatoryPence: flows.mandatoryPence,
      optionalPence: flows.optionalPence,
      savingsRatePct: flows.incomePence > 0
        ? ((flows.incomePence - flows.spendPence) / flows.incomePence) * 100
        : null,
      trailing12SpendPence,

      fireNumberPence: fire.fireNumberPence,
      fireProgressPct: fire.fireProgressPct,
      yearsToFire: fire.yearsToFire,
      fireDateISO: fire.fireDateISO,
      assumptionsVersion: Number(assumptions.version) || 1,
    });
  });

  if (dryRun) return { snapshots, written: 0 };

  const operations = snapshots.map((snapshot) => (batch) => batch.set(
    db.collection(NET_WORTH).doc(netWorthDocId(uid, snapshot.monthKey)),
    {
      ...snapshot,
      computedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true },
  ));

  const written = await commitInChunks(db, operations);
  return { snapshots, written };
}

const recomputeFinanceNetWorth = httpsV2.onCall({ region: FUNCTION_REGION, memory: '512MiB' }, async (req) => {
  const uid = requireAuth(req);
  const db = admin.firestore();

  const toMonth = isMonthKey(req.data?.toMonth) ? req.data.toMonth : monthKeyFromDate(new Date());
  const fromMonth = isMonthKey(req.data?.fromMonth)
    ? req.data.fromMonth
    : monthKeyFromIndex(monthIndexOf(toMonth) - 23);
  const months = monthKeysBetween(fromMonth, toMonth);
  if (!months.length) throw new httpsV2.HttpsError('invalid-argument', 'fromMonth must not be after toMonth');

  // dryRun returns the computed snapshot without writing — the safe way to check
  // the numbers against real production data before committing them.
  const dryRun = req.data?.dryRun === true;
  const result = await computeNetWorthForUser(db, uid, { months, dryRun });

  return {
    ok: true,
    dryRun,
    fromMonth,
    toMonth,
    written: result.written,
    snapshots: result.snapshots,
  };
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

const migrateManualAccountsToLedger = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  const uid = requireAuth(req);
  const db = admin.firestore();
  const monthKey = isMonthKey(req.data?.monthKey) ? req.data.monthKey : monthKeyFromDate(new Date());

  const [manualSnap, budgetSnap, existingAccounts] = await Promise.all([
    db.collection('finance_manual_accounts').where('ownerUid', '==', uid).get(),
    db.collection('finance_budgets_v2').doc(uid).get(),
    loadAccounts(db, uid),
  ]);

  const existingIds = new Set(existingAccounts.map((a) => a.accountId));
  const operations = [];
  const created = [];
  const skipped = [];

  const stage = (sourceId, account, valuePence) => {
    const accountId = migratedAccountId(sourceId);
    if (existingIds.has(accountId)) {
      skipped.push({ sourceId, accountId, reason: 'already_migrated' });
      return;
    }
    existingIds.add(accountId);

    const record = {
      ownerUid: uid,
      accountId,
      ref: generateAccountRef(),
      persona: 'personal',
      side: sideForKind(account.kind),
      currency: 'GBP',
      includeInNetWorth: true,
      includeInFire: !['property', 'other'].includes(account.kind),
      autoSeedFromMonzo: false,
      archived: false,
      deleted: false,
      sortOrder: created.length,
      migratedFromManualAccountId: String(sourceId),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
      ...account,
    };

    operations.push((batch) => batch.set(
      db.collection(ACCOUNTS).doc(accountDocId(uid, accountId)),
      record,
      { merge: true },
    ));

    const magnitude = Math.abs(Math.round(Number(valuePence) || 0));
    const { gainPence, returnPct } = deriveGain(magnitude, 0);
    operations.push((batch) => batch.set(
      db.collection(POSITIONS).doc(positionDocId(uid, accountId, monthKey)),
      {
        ownerUid: uid,
        accountId,
        monthKey,
        monthIndex: monthIndexOf(monthKey),
        monthEndISO: monthEndISO(monthKey),
        valuePence: magnitude,
        contributedPence: 0,
        gainPence,
        returnPct,
        aprSnapshot: record.apr === undefined ? null : record.apr,
        creditLimitPence: null,
        minPaymentPence: record.minPaymentPence === undefined ? null : record.minPaymentPence,
        source: 'manual',
        confidence: 'actual',
        isEstimate: false,
        enteredBy: 'system',
        notes: 'Migrated from the legacy assets register',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: Date.now(),
      },
      { merge: true },
    ));

    created.push({ sourceId, accountId, name: record.name, kind: record.kind });
  };

  manualSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const kind = MANUAL_TYPE_TO_KIND[String(data.type || '').toLowerCase()] || 'other';
    stage(`manual:${doc.id}`, {
      name: text(data.name) || 'Untitled account',
      provider: text(data.institution),
      kind,
      notes: text(data.notes),
    }, data.balancePence);
  });

  // finance_budgets_v2.debts[] carried APR and minimum payment but no backend code
  // ever read it. The register becomes authoritative; the array is left in place
  // as a rollback path and simply stops being written.
  const debts = budgetSnap.exists && Array.isArray((budgetSnap.data() || {}).debts)
    ? budgetSnap.data().debts
    : [];
  debts.forEach((debt, index) => {
    stage(`debt:${debt?.id || index}`, {
      name: text(debt?.name) || 'Debt',
      provider: null,
      kind: 'credit_card',
      apr: percent(debt?.apr),
      minPaymentPence: toPence(debt?.minPaymentPence),
      monzoPotId: text(debt?.potId),
      notes: 'Migrated from budget settings',
    }, debt?.balancePence);
  });

  const written = await commitInChunks(db, operations);
  return { ok: true, created, skipped, written, monthKey };
});

// ---------------------------------------------------------------------------
// Monthly rollup
// ---------------------------------------------------------------------------

/**
 * Fill in a month's positions from Monzo, then carry forward whatever is missing.
 *
 * Two rules that matter:
 *  - A row whose source is 'manual' is NEVER overwritten. Read before write.
 *  - An account with no row at all gets the last known row copied with
 *    isEstimate:true, so the net-worth series stays continuous instead of
 *    cliff-diving to zero in any month Jim did not fill in.
 */
async function seedAndRollForward(db, uid, monthKey) {
  const [accounts, positions, monzoAccountsSnap, potsSnap] = await Promise.all([
    loadAccounts(db, uid),
    loadPositions(db, uid),
    db.collection('monzo_accounts').where('ownerUid', '==', uid).get(),
    db.collection('monzo_pots').where('ownerUid', '==', uid).get(),
  ]);

  const balanceByMonzoAccount = new Map();
  monzoAccountsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.closed) return;
    // balanceMinor is written by syncMonzoDataForUser; absent on data synced
    // before /balance was wired in, in which case there is nothing to seed.
    if (!Number.isFinite(Number(data.balanceMinor))) return;
    balanceByMonzoAccount.set(String(data.accountId), Math.round(Number(data.balanceMinor)));
  });

  const balanceByPot = new Map();
  potsSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    if (data.deleted === true) return;
    balanceByPot.set(String(data.potId), Math.round(Number(data.balance) || 0));
  });

  const targetIndex = monthIndexOf(monthKey);
  const byAccount = new Map();
  positions.forEach((position) => {
    if (!byAccount.has(position.accountId)) byAccount.set(position.accountId, []);
    byAccount.get(position.accountId).push(position);
  });

  const operations = [];
  const seeded = [];
  const rolled = [];

  accounts.forEach((account) => {
    if (account.archived === true) return;

    const history = byAccount.get(account.accountId) || [];
    const existing = history.find((p) => p.monthIndex === targetIndex) || null;

    let valuePence = null;
    let source = null;

    if (account.autoSeedFromMonzo) {
      if (account.monzoPotId && balanceByPot.has(account.monzoPotId)) {
        valuePence = balanceByPot.get(account.monzoPotId);
        source = 'monzo_pot';
      } else if (account.monzoAccountId && balanceByMonzoAccount.has(account.monzoAccountId)) {
        valuePence = balanceByMonzoAccount.get(account.monzoAccountId);
        source = 'monzo_account';
      }
    }

    // A figure Jim typed outranks anything Monzo reports for the same month.
    if (existing && existing.source === 'manual') return;

    if (valuePence !== null) {
      const payload = buildPositionPayload(uid, account, monthKey, {
        valuePence,
        contributedPence: existing ? existing.contributedPence : 0,
        source,
        confidence: 'actual',
        isEstimate: false,
        enteredBy: 'system',
      }, existing);
      operations.push((batch) => batch.set(
        db.collection(POSITIONS).doc(positionDocId(uid, account.accountId, monthKey)),
        payload,
        { merge: true },
      ));
      seeded.push(account.accountId);
      return;
    }

    if (existing) return;

    const earlier = history
      .filter((p) => p.monthIndex < targetIndex)
      .sort((a, b) => b.monthIndex - a.monthIndex);
    const previous = earlier[0];
    if (!previous) return;

    const payload = buildPositionPayload(uid, account, monthKey, {
      valuePence: previous.valuePence,
      contributedPence: previous.contributedPence,
      source: 'rollforward',
      confidence: 'estimated',
      isEstimate: true,
      enteredBy: 'system',
    }, null);
    operations.push((batch) => batch.set(
      db.collection(POSITIONS).doc(positionDocId(uid, account.accountId, monthKey)),
      payload,
      { merge: true },
    ));
    rolled.push(account.accountId);
  });

  await commitInChunks(db, operations);
  return { seeded, rolled };
}

/**
 * Runs on the 1st-3rd at 03:00 targeting the PREVIOUS month. The three-day window
 * buys idempotent retries for free, because every doc id is deterministic.
 *
 * Iterates ownerUid from finance_ledger_accounts rather than from `tokens` (which
 * is what nightlyMonzoAnalytics does) — a ledger is useful without Monzo connected,
 * and right now Monzo is exactly the thing that can be disconnected.
 */
const financeMonthlyRollup = schedulerV2.onSchedule({
  schedule: '0 3 1-3 * *',
  timeZone: 'Europe/London',
  region: FUNCTION_REGION,
  memory: '512MiB',
}, async () => {
  const db = admin.firestore();

  const now = new Date();
  const targetMonth = monthKeyFromIndex(monthIndexOf(monthKeyFromDate(now)) - 1);

  const accountsSnap = await db.collection(ACCOUNTS).get();
  const uids = Array.from(new Set(
    accountsSnap.docs
      .map((doc) => (doc.data() || {}).ownerUid)
      .filter(Boolean),
  ));

  let succeeded = 0;
  for (const uid of uids) {
    try {
      const { seeded, rolled } = await seedAndRollForward(db, uid, targetMonth);
      // Recompute a 13-month window so the delta against the prior month is right
      // even when an earlier month was backfilled since the last run.
      const months = monthKeysBetween(
        monthKeyFromIndex(monthIndexOf(targetMonth) - 12),
        targetMonth,
      );
      const { written } = await computeNetWorthForUser(db, uid, { months, dryRun: false });
      succeeded += 1;
      console.log('[financeMonthlyRollup]', uid, {
        targetMonth, seeded: seeded.length, rolled: rolled.length, written,
      });
    } catch (error) {
      // One user's bad data must not stop the rest.
      console.error('[financeMonthlyRollup] failed for user', uid, error?.message || error);
    }
  }

  console.log('[financeMonthlyRollup] done', { targetMonth, users: uids.length, succeeded });
});

module.exports = {
  financeMonthlyRollup,
  upsertFinanceLedgerAccount,
  deleteFinanceLedgerAccount,
  upsertFinancePositions,
  fetchFinanceLedger,
  upsertFinancePlanAssumptions,
  recomputeFinanceNetWorth,
  migrateManualAccountsToLedger,
  // Exported for tests.
  computeNetWorthForUser,
  seedAndRollForward,
  summariseFlows,
  MANUAL_TYPE_TO_KIND,
};
