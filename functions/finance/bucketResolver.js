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

/** Strip the trailing "Pot" that Monzo's CSV export appends to the pot's own name. */
function normalisePotName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+pot$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Build the lookup `resolvePotTransfer` needs: pots keyed by id AND by normalised name,
 * because CSV-imported transfers carry no pot id and can only be matched on the name.
 *
 * Live pots win over deleted ones — the register holds several same-named pots ("Holiday"
 * exists four times, three of them closed), and naming a transfer after a dead pot loses
 * the link to the balance that is actually still there.
 */
function buildPotIndex(pots) {
  const index = new Map();
  const put = (key, pot) => {
    if (!key) return;
    const existing = index.get(key);
    if (existing && existing.deleted !== true && pot.deleted === true) return;
    index.set(key, pot);
  };
  (pots || []).forEach((raw) => {
    const pot = raw && typeof raw.data === 'function' ? raw.data() : raw;
    if (!pot) return;
    put(String(pot.potId || pot.id || '').toLowerCase(), pot);
    put(normalisePotName(pot.name || pot.title), pot);
  });
  return index;
}

/**
 * Detect a Monzo pot transfer. Pot movements are not spend and must never land
 * in a spend bucket — every caller excludes bank_transfer from its aggregates.
 *
 * Two populations exist and only one was handled. Transactions from the Monzo API carry
 * `metadata.pot_id`; transactions from a CSV backfill carry no id at all, only
 * `metadata.csvType === 'Pot transfer'` and a description like "Holiday Pot". On this
 * account that was 562 of 3,477 — so 2,915 pot transfers were classified as SPEND,
 * inflating it by £41,008 and making up the bulk of the "uncategorised" count.
 *
 * potIndex (see buildPotIndex) resolves the display name from either an id or a name.
 */
function resolvePotTransfer(tx, potIndex) {
  const metadata = (tx && tx.metadata) || {};
  const explicitPotId = metadata.pot_id || metadata.destination_pot_id || metadata.source_pot_id || null;

  const describedName = (tx && (tx.description || (tx.merchant && tx.merchant.name))) || '';
  // `uk_retail_pot` is Monzo's own scheme for a pot movement; csvType is the export's
  // label for the same event. Either is a positive identification, not a guess.
  const looksLikePotTransfer = String(metadata.csvType || '').toLowerCase() === 'pot transfer'
    || String(tx && tx.scheme || '').toLowerCase() === 'uk_retail_pot'
    || /\bpot$/i.test(String(describedName).trim());

  if (!explicitPotId && !looksLikePotTransfer) return null;

  const pot = potIndex
    ? (explicitPotId ? potIndex.get(String(explicitPotId).toLowerCase()) : null)
      || potIndex.get(normalisePotName(describedName))
      || null
    : null;

  // Prefer the pot's real name; fall back to the description, and only then to the raw id —
  // an id like "pot_00009qOFyM5FPX8Gam20ZO" is not a label anyone can read.
  const potName = (pot && (pot.name || pot.title))
    || (describedName ? String(describedName).trim().replace(/\s+pot$/i, '') : '')
    || explicitPotId
    || 'Savings pot';

  const potId = (pot && (pot.potId || pot.id)) || explicitPotId || null;

  const amount = amountOf(tx);
  // Money leaving the current account goes INTO the pot; money arriving comes back OUT.
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
  buildPotIndex,
  normalisePotName,
  resolvePotTransfer,
  resolveTransactionCategory,
  amountOf,
};
