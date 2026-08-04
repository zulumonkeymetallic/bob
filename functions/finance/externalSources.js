// External statement sources — presets, row classification and sign handling.
//
// Why this exists: the import/match/debt-service pipeline in ./enhancements.js hardcoded
// three sources ('barclays' | 'paypal' | 'other') and a hardcoded repayment regex per
// source, so Halifax had nowhere to live and every new provider needed a code change.
// Everything provider-specific now resolves from the user's own account register
// (finance_ledger_accounts, edited on /finance/ledger), falling back to these presets.
//
// Pure functions only — no Firestore, no admin SDK — so the classification and sign rules
// are testable without emulators. Firestore lookups stay in ./enhancements.js.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Known providers. `monzoPaymentTerms` identify the OUTBOUND payment as Monzo describes it
 * ("BARCLAYCARD", "HALIFAX"); `statementPaymentTerms` identify the same event as the
 * STATEMENT describes it ("PAYMENT RECEIVED - THANK YOU"). They are different vocabularies
 * for the same transaction and conflating them was the original bug.
 */
const EXTERNAL_SOURCE_PRESETS = {
  barclays: {
    label: 'Barclays / Barclaycard',
    monzoPaymentTerms: ['barclaycard', 'barclays'],
    // Barclaycard posts on the transaction date; no settlement lag to correct for.
    dateShiftDays: 0,
    collapseReversals: false,
    treatsPositiveAsCredit: true,
  },
  halifax: {
    label: 'Halifax',
    monzoPaymentTerms: ['halifax'],
    dateShiftDays: 0,
    collapseReversals: false,
    treatsPositiveAsCredit: true,
  },
  paypal: {
    label: 'PayPal',
    monzoPaymentTerms: ['paypal'],
    // PayPal records the ORDER date; Monzo sees settlement 1-2 days later. Shifting the
    // external date forward centres the match window on the actual Monzo post date.
    dateShiftDays: 1,
    collapseReversals: true,
    treatsPositiveAsCredit: true,
  },
  other: {
    label: 'Other',
    monzoPaymentTerms: [],
    dateShiftDays: 0,
    collapseReversals: false,
    treatsPositiveAsCredit: true,
  },
};

/** Statement vocabulary for "you paid this card". Provider-independent in practice. */
const DEFAULT_STATEMENT_PAYMENT_TERMS = [
  'payment received',
  'payment - thank you',
  'payment thank you',
  'thank you for your payment',
  'direct debit',
  'dd payment',
  'bp payment',
  'balance transfer',
];

/** Interest and fees are debt SERVICING, not consumption — they must not land in spend. */
const DEFAULT_INTEREST_TERMS = [
  'interest',
  'finance charge',
  'service charge',
  'late fee',
  'fee charge',
  'handling fee',
  'cash advance fee',
  'overlimit',
  'over limit',
];

/**
 * Refund vocabulary. Deliberately excludes the bare word "credit": on a CREDIT card
 * statement that matches constantly (card name, "credit adjustment", merchant names) and
 * silently removed real spend from the totals.
 */
const DEFAULT_REFUND_TERMS = [
  'refund',
  'chargeback',
  'reversal',
  'dispute',
  'returned goods',
  'credit adjustment',
  'goodwill',
];

/** Slug for a source: lower-case, alphanumeric plus underscore. */
function slugifySource(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/**
 * Normalise a source identifier. Unlike the old three-value enum this accepts ANY slug so
 * a user-registered provider round-trips, while keeping the historical aliases working.
 */
function normalizeExternalSource(raw) {
  const slug = slugifySource(raw);
  if (!slug) return 'other';
  if (slug === 'barclaycard' || slug === 'barclay') return 'barclays';
  if (slug === 'pay_pal') return 'paypal';
  if (slug === 'halifax_credit_card' || slug === 'halifax_card') return 'halifax';
  return slug;
}

function presetForSource(source) {
  return EXTERNAL_SOURCE_PRESETS[normalizeExternalSource(source)] || EXTERNAL_SOURCE_PRESETS.other;
}

function cleanTerms(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\n]/);
  return list
    .map((term) => String(term || '').trim().toLowerCase())
    .filter((term) => term.length >= 2)
    .slice(0, 25);
}

function escapeRegex(term) {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build a case-insensitive matcher from free-text terms. Never matches when empty. */
function buildTermMatcher(terms) {
  const cleaned = cleanTerms(terms);
  if (!cleaned.length) return () => false;
  const regex = new RegExp(cleaned.map(escapeRegex).join('|'), 'i');
  return (text) => regex.test(String(text || ''));
}

/**
 * Resolve the effective import configuration for a source, layering a registered account's
 * own settings over the provider preset. `account` is a finance_ledger_accounts document
 * (or null when importing against a bare source slug).
 */
function resolveSourceConfig({ source, account } = {}) {
  const resolvedSource = normalizeExternalSource(account?.externalSource || source);
  const preset = presetForSource(resolvedSource);

  // An account's own name/provider are strong repayment signals: a card registered as
  // "Halifax Clarity" should match "HALIFAX CLARITY" in Monzo without extra configuration.
  const identityTerms = [account?.name, account?.provider]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter((value) => value.length >= 3);

  const monzoPaymentTerms = cleanTerms([
    ...cleanTerms(account?.paymentMatchTerms),
    ...identityTerms,
    ...preset.monzoPaymentTerms,
  ]);

  return {
    source: resolvedSource,
    label: account?.name || preset.label,
    accountId: account?.accountId || null,
    monzoPaymentTerms,
    statementPaymentTerms: cleanTerms([
      ...cleanTerms(account?.statementPaymentTerms),
      ...DEFAULT_STATEMENT_PAYMENT_TERMS,
    ]),
    interestTerms: cleanTerms([
      ...cleanTerms(account?.interestTerms),
      ...DEFAULT_INTEREST_TERMS,
    ]),
    refundTerms: cleanTerms([
      ...cleanTerms(account?.refundTerms),
      ...DEFAULT_REFUND_TERMS,
    ]),
    dateShiftDays: Number.isFinite(Number(account?.matchDateShiftDays))
      ? Number(account.matchDateShiftDays)
      : preset.dateShiftDays,
    collapseReversals: account?.collapseReversals === undefined
      ? preset.collapseReversals
      : account.collapseReversals === true,
  };
}

/**
 * Decide whether a parsed CSV carries its own signs.
 *
 * The old parser flipped EVERY positive amount to negative unless the description matched a
 * keep-positive word list, which destroyed the sign on files that were already signed —
 * payments and refunds silently became spend. Sign information is a property of the FILE,
 * not of an individual row: only assume "all amounts are debits" when nothing in the file
 * is negative and no debit/credit column pair supplied the sign.
 */
function fileIsUnsigned(amounts) {
  const values = (amounts || []).map(Number).filter(Number.isFinite);
  if (!values.length) return false;
  return !values.some((value) => value < 0);
}

/**
 * Classify one statement row into exactly one bucket.
 *
 * Exclusive by construction. The previous implementation used three independent `if`s, so
 * an interest charge was added to BOTH the interest total and the spend total — inflating
 * statement spend and, through `monzoPayments - statementSpend`, understating interest.
 */
function classifyStatementRow({ amountMinor, description, config }) {
  const cfg = config || resolveSourceConfig({});
  const text = String(description || '');
  const amount = Number(amountMinor) || 0;

  const isStatementPayment = buildTermMatcher(cfg.statementPaymentTerms);
  const isInterest = buildTermMatcher(cfg.interestTerms);
  const isRefund = buildTermMatcher(cfg.refundTerms);

  if (isStatementPayment(text)) return 'payment';
  if (isInterest(text)) return 'interest';
  if (isRefund(text)) return 'refund';
  // A credit that names neither a payment nor a refund is still money back on the card.
  if (amount > 0) return 'refund';
  return 'spend';
}

module.exports = {
  DAY_MS,
  EXTERNAL_SOURCE_PRESETS,
  DEFAULT_STATEMENT_PAYMENT_TERMS,
  DEFAULT_INTEREST_TERMS,
  DEFAULT_REFUND_TERMS,
  slugifySource,
  normalizeExternalSource,
  presetForSource,
  cleanTerms,
  buildTermMatcher,
  resolveSourceConfig,
  fileIsUnsigned,
  classifyStatementRow,
};
