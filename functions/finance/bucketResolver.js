// Single source of truth for "which bucket does this transaction belong to?".
//
// Before this module there were five independent implementations (analytics.js,
// dashboard.js, enhancements.js, TransactionsList.tsx, FinanceDashboardModern.tsx)
// and they disagreed on two things that mattered:
//
//   1. Precedence. analytics.js ranked `aiBucket` ABOVE `userCategoryType`, so a
//      transaction Jim recategorised by hand still reported under the AI's bucket
//      in monzo_budget_summary — the doc that feeds budget progress, the Monday
//      email, the coach page and the mobile finance tab.
//   2. Vocabulary. Two bucket enums exist (see below) and the fold between them
//      was written three times, incompletely and in both directions.
//
// Pure module: no firebase-admin, no I/O. Mirrored in
// react-app/src/utils/financeBuckets.ts, kept honest by
// react-app/src/utils/financeBuckets.parity.test.ts.

// V10 — canonical. Matches the `bucket` field on all 72 catalogue entries in
// ./categories.js and the CategoryBucket union in the react app.
const V10_BUCKETS = [
  'mandatory',
  'discretionary',
  'net_salary',
  'irregular_income',
  'short_saving',
  'long_saving',
  'investment',
  'bank_transfer',
  'debt_repayment',
  'unknown',
];

// V4 — what `userCategoryType` / `defaultCategoryType` / `merchant_mappings.categoryType`
// actually store on disk, and what monzo_budget_summary.totals is keyed by.
// Kept as a projection of V10, never as an input vocabulary.
const V4_BUCKETS = ['mandatory', 'optional', 'savings', 'income'];

// V4 -> V10. Lossy in two places: V4 has one `savings` where V10 has three, and
// one `income` where V10 has two. Callers that care get `bucketPrecision: 'coarse'`.
const WIDEN_V4_TO_V10 = {
  mandatory: 'mandatory',
  optional: 'discretionary',
  savings: 'short_saving',
  income: 'net_salary',
};

// V10 -> V4. This is what analytics.js:mapAiBucket and enhancements.js:normalizeBucket
// were each doing by hand, minus their gaps.
const NARROW_V10_TO_V4 = {
  mandatory: 'mandatory',
  debt_repayment: 'mandatory',
  discretionary: 'optional',
  short_saving: 'savings',
  long_saving: 'savings',
  investment: 'savings',
  net_salary: 'income',
  irregular_income: 'income',
  // bank_transfer and unknown deliberately have no V4 home — callers exclude them.
};

const COARSE_WIDENINGS = new Set(['savings', 'income']);

function normaliseBucketName(value) {
  return String(value || '').trim().toLowerCase();
}

/** V4 (or a V10 value passed through) -> V10. Returns null for unrecognised input. */
function widenToV10(value) {
  const raw = normaliseBucketName(value);
  if (!raw) return null;
  if (V10_BUCKETS.includes(raw)) return raw;
  return WIDEN_V4_TO_V10[raw] || null;
}

/** V10 (or a V4 value passed through) -> V4. Returns null for bank_transfer/unknown. */
function narrowToV4(value) {
  const raw = normaliseBucketName(value);
  if (!raw) return null;
  if (V4_BUCKETS.includes(raw)) return raw;
  return NARROW_V10_TO_V4[raw] || null;
}

/** True when widenToV10 had to guess which of several V10 buckets was meant. */
function isCoarseWidening(value) {
  return COARSE_WIDENINGS.has(normaliseBucketName(value));
}

/** Build a key -> {key,label,bucket} index from a merged category catalogue. */
function buildCategoryIndex(categories) {
  const index = new Map();
  (categories || []).forEach((category) => {
    if (!category || !category.key) return;
    index.set(String(category.key).toLowerCase(), category);
  });
  return index;
}

function lookupCategory(categoryIndex, key) {
  if (!categoryIndex || !key) return null;
  return categoryIndex.get(String(key).trim().toLowerCase()) || null;
}

/**
 * Detect a Monzo pot transfer. Pot movements are not spend and must never land
 * in a spend bucket — every caller excludes bank_transfer from its aggregates.
 * potIndex is an optional Map of lowercased potId -> pot doc, used only to name
 * the transfer.
 */
function resolvePotTransfer(tx, potIndex) {
  const metadata = (tx && tx.metadata) || {};
  const potId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;
  if (!potId) return null;
  const pot = potIndex ? potIndex.get(String(potId).toLowerCase()) : null;
  const potName = (pot && (pot.name || pot.title)) || potId;
  const amount = amountOf(tx);
  const isToPot = !!metadata.destination_pot_id || (!metadata.source_pot_id && amount < 0);
  return { potId, potName, direction: isToPot ? 'to' : 'from' };
}

/** Signed amount in pounds. Tolerates the three shapes on monzo_transactions. */
function amountOf(tx) {
  if (!tx) return 0;
  if (typeof tx.amount === 'number' && Number.isFinite(tx.amount)) return tx.amount;
  if (typeof tx.amountMinor === 'number' && Number.isFinite(tx.amountMinor)) return tx.amountMinor / 100;
  const raw = Number(tx.raw && tx.raw.amount);
  return Number.isFinite(raw) ? raw / 100 : 0;
}

/**
 * The one precedence order.
 *
 *   1. pot transfer       -> bank_transfer
 *   2. userCategoryKey    -> catalogue lookup
 *   3. userCategoryType   -> widenToV10
 *   4. aiBucket
 *   5. aiCategoryKey      -> catalogue lookup
 *   6. defaultCategoryType-> widenToV10
 *   7.                    -> unknown
 *
 * (2) outranks (3) deliberately. `userCategoryKey` is a per-transaction choice
 * made in TransactionsList; `userCategoryType` is rewritten from merchant_mappings
 * on every sync (functions/index.js, "Apply merchant mapping if available") and is
 * therefore a *rule*. A per-transaction choice must beat a rule.
 *
 * Returns { bucket, bucketV4, categoryKey, categoryLabel, bucketSource,
 *           bucketPrecision, isPotTransfer, potTransfer }.
 * `bucketSource` is what lets the UI explain why a transaction sits where it does.
 */
function resolveTransactionCategory(tx, options = {}) {
  const { categoryIndex = null, potIndex = null } = options;
  const data = tx || {};

  const potTransfer = resolvePotTransfer(data, potIndex);
  if (potTransfer) {
    return {
      bucket: 'bank_transfer',
      bucketV4: null,
      categoryKey: 'pot_transfer',
      categoryLabel: `Transfer ${potTransfer.direction} ${potTransfer.potName}`,
      bucketSource: 'pot',
      bucketPrecision: 'exact',
      isPotTransfer: true,
      potTransfer,
    };
  }

  const candidates = [
    {
      source: 'user_key',
      bucket: bucketFromKey(categoryIndex, data.userCategoryKey),
      label: data.userCategoryLabel,
    },
    {
      source: 'user_type',
      bucket: widenToV10(data.userCategoryType),
      label: data.userCategoryLabel,
      coarse: isCoarseWidening(data.userCategoryType),
    },
    {
      source: 'ai_bucket',
      bucket: widenToV10(data.aiBucket),
      label: data.aiCategoryLabel,
    },
    {
      source: 'ai_key',
      bucket: bucketFromKey(categoryIndex, data.aiCategoryKey),
      label: data.aiCategoryLabel,
    },
    {
      source: 'default',
      bucket: widenToV10(data.defaultCategoryType),
      label: data.defaultCategoryLabel,
      coarse: isCoarseWidening(data.defaultCategoryType),
    },
  ];

  const hit = candidates.find((candidate) => !!candidate.bucket);

  const bucket = hit ? hit.bucket : 'unknown';
  const bucketSource = hit ? hit.source : 'none';

  // Label and key resolve independently of the bucket: a transaction can carry a
  // usable category key while its bucket came from somewhere coarser.
  const categoryKey = firstNonEmpty(
    data.userCategoryKey,
    data.aiCategoryKey,
    data.categoryKey,
    data.category,
  ) || 'uncategorized';

  const catalogue = lookupCategory(categoryIndex, categoryKey);
  const categoryLabel = firstNonEmpty(
    data.userCategoryLabel,
    catalogue && catalogue.label,
    data.aiCategoryLabel,
    data.defaultCategoryLabel,
    hit && hit.label,
  ) || 'Uncategorised';

  return {
    bucket,
    bucketV4: narrowToV4(bucket),
    categoryKey: String(categoryKey).trim() || 'uncategorized',
    categoryLabel,
    bucketSource,
    bucketPrecision: hit && hit.coarse ? 'coarse' : 'exact',
    isPotTransfer: false,
    potTransfer: null,
  };
}

function bucketFromKey(categoryIndex, key) {
  const category = lookupCategory(categoryIndex, key);
  if (!category) return null;
  const bucket = normaliseBucketName(category.bucket);
  return V10_BUCKETS.includes(bucket) ? bucket : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

module.exports = {
  V10_BUCKETS,
  V4_BUCKETS,
  WIDEN_V4_TO_V10,
  NARROW_V10_TO_V4,
  widenToV10,
  narrowToV4,
  isCoarseWidening,
  buildCategoryIndex,
  resolvePotTransfer,
  resolveTransactionCategory,
  amountOf,
};
