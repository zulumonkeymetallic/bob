// Suggest counterparties that are probably the user's OWN accounts.
//
// Why this exists: transfers to your own savings/investment accounts are not spend, but
// recognising them requires knowing which counterparties are yours — and that cannot be
// hardcoded without embedding one user's providers in everyone's code. The register
// (finance_ledger_accounts) is the answer, but nobody will populate it from a blank form.
// This pass reads the transaction history and proposes the entries.
//
// It NEVER classifies anything by itself. It produces ranked candidates with the reasons
// behind each, for a human to confirm — a false positive here would silently delete real
// spend from the totals, which is exactly the class of bug this whole effort is fixing.
//
// Pure module: no firebase-admin, no I/O.

const { resolveTransactionCategory } = require('./bucketResolver');

/** Monzo schemes that mean "bank transfer", i.e. money moving between accounts. */
const BANK_TRANSFER_SCHEMES = new Set([
  'payport_faster_payments',
  'bacs',
  'monzo_paid',
  'p2p_payment',
]);

/** Schemes that prove a card purchase. A merchant, never an account of yours. */
const CARD_SCHEMES = new Set(['mastercard', '3dsecure', 'visa']);

const SUGGESTION_THRESHOLD = 0.5;

/**
 * Words that mark a counterparty as an institution rather than a person. Paying a friend by
 * faster payment in round amounts is indistinguishable from funding your own ISA on those
 * two signals alone, which is how a first cut of this proposed "steven mcmaster" and
 * "mr stephen carleton" as savings accounts.
 */
const INSTITUTION_MARKERS = [
  'ltd', 'limited', 'plc', 'llp', 'inc',
  'bank', 'building society', 'invest', 'capital', 'asset', 'wealth',
  'savings', 'saver', 'isa', 'sipp', 'pension', 'trading', 'securities',
  'client account', 'nominee', 'trustee', 'platform', 'fund',
];

/** Titles that mark a counterparty as a private individual. */
const PERSON_TITLES = ['mr', 'mrs', 'ms', 'miss', 'dr', 'sir'];

/**
 * Words that mean the payment is servicing a debt. Excluded outright: debt repayment is a
 * real obligation modelled by recomputeDebtServiceBreakdown, and reclassifying it as a
 * neutral transfer would erase it from the picture entirely.
 */
const DEBT_MARKERS = ['mortgage', 'loan', 'credit', 'finance', 'hp ', 'repayment'];

const containsAny = (haystack, needles) => needles.some((needle) => haystack.includes(needle));

/** Two or three name-shaped tokens with no corporate marker reads as a private individual. */
function looksLikePerson(name, tokens) {
  const lower = name.toLowerCase();
  if (containsAny(lower, INSTITUTION_MARKERS)) return false;
  const words = lower.split(/\s+/).filter(Boolean);
  if (words.length && PERSON_TITLES.includes(words[0])) return true;
  return tokens.length >= 2 && tokens.length <= 3 && /^[a-z\s]+$/.test(lower);
}

function tokenise(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function amountMinorOf(tx) {
  if (Number.isFinite(tx && tx.amountMinor)) return Math.round(Number(tx.amountMinor));
  const amount = Number((tx && tx.amount) || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/** A transfer is usually a round figure; a shop bill usually is not. */
function roundedShare(amounts) {
  if (!amounts.length) return 0;
  const round = amounts.filter((value) => Math.abs(value) % 1000 === 0).length;
  return round / amounts.length;
}

/**
 * Rank counterparties by how likely they are to be an account the user owns.
 *
 * `ownerNames` are the names the user banks under — a transfer to your own name is the
 * single clearest case, and it is also the one most likely to be a payment to a RELATIVE
 * with the same surname, so it is surfaced rather than assumed.
 */
function suggestOwnAccountTransfers(transactions, options = {}) {
  const {
    ownerNames = [],
    categoryIndex = null,
    potIndex = null,
    transferAccountIndex = null,
    minMovements = 3,
    limit = 25,
  } = options;

  const ownerTokens = new Set(ownerNames.flatMap(tokenise));
  const surnames = ownerNames.map((name) => tokenise(name).slice(-1)[0]).filter(Boolean);
  const ownerSurname = surnames.length ? surnames[0] : null;
  const groups = new Map();

  (transactions || []).forEach((tx) => {
    const amountMinor = amountMinorOf(tx);
    if (!amountMinor) return;

    // Anything the resolver already handles is not a suggestion — it is already solved.
    const resolved = resolveTransactionCategory(tx, { categoryIndex, potIndex, transferAccountIndex });
    if (resolved.bucket === 'bank_transfer') return;
    // A category the user chose by hand is a decision; do not second-guess it.
    if (tx.userCategoryKey) return;

    const name = String(tx.merchantKey || (tx.merchant && tx.merchant.name) || tx.description || '').trim();
    if (!name) return;
    const key = name.toLowerCase();

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        name,
        outCount: 0,
        inCount: 0,
        outPence: 0,
        inPence: 0,
        amounts: [],
        schemes: new Set(),
      });
    }
    const group = groups.get(key);
    if (amountMinor < 0) {
      group.outCount += 1;
      group.outPence += Math.abs(amountMinor);
    } else {
      group.inCount += 1;
      group.inPence += amountMinor;
    }
    group.amounts.push(Math.abs(amountMinor));
    if (tx.scheme) group.schemes.add(String(tx.scheme).toLowerCase());
  });

  const candidates = [];

  groups.forEach((group) => {
    const movements = group.outCount + group.inCount;
    if (movements < minMovements) return;
    // A card purchase is proof of a merchant. One is enough to disqualify the whole group.
    if ([...group.schemes].some((scheme) => CARD_SCHEMES.has(scheme))) return;

    const lowerName = group.name.toLowerCase();
    // Debt servicing is already modelled properly; never propose erasing it as a transfer.
    if (containsAny(lowerName, DEBT_MARKERS)) return;

    // Overwhelmingly one-way INTO the account is income arriving, not saving going out.
    // "donnelly j" is £70,575 in against £4,370 out — a salary, and registering it as a
    // savings account would reclassify a year of pay as an internal transfer.
    if (group.inPence > group.outPence * 5 && group.inCount > group.outCount) return;

    const reasons = [];
    let score = 0;

    const bankScheme = [...group.schemes].some((scheme) => BANK_TRANSFER_SCHEMES.has(scheme));
    if (bankScheme) {
      score += 0.35;
      reasons.push('Moves by bank transfer, not card');
    }

    // A single payment followed by a single credit is a REFUND, not a standing
    // arrangement — "travel booker ltd", £371 out and £391 back, is a cancelled booking.
    // Only repeated movement in both directions means an account you keep money in.
    if (group.outCount >= 2 && group.inCount >= 2) {
      score += 0.3;
      reasons.push(`Money goes out and comes back repeatedly (${group.outCount} out, ${group.inCount} in)`);
    }

    const nameTokens = tokenise(group.name);
    // Banks rarely render a name the way the profile does: "Jim Donnelly" pays
    // "JAMES DONNELLY" and is paid by "DONNELLY J". Match on the surname and require a
    // person-shaped name, then say plainly that a relative would look identical — this is
    // a prompt to check, not a conclusion.
    const sharesSurname = ownerSurname
      && nameTokens.includes(ownerSurname)
      && nameTokens.length <= 3;
    const matchesOwner = nameTokens.length > 0
      && (nameTokens.every((token) => ownerTokens.has(token)) || sharesSurname);
    if (matchesOwner) {
      score += 0.3;
      reasons.push('Shares your surname — check this is your account and not a relative');
    }

    if (containsAny(lowerName, INSTITUTION_MARKERS)) {
      score += 0.2;
      reasons.push('Named like an institution, not a person');
    }

    // Deliberately small: on its own, "round amounts by bank transfer" describes paying a
    // friend back just as well as funding an ISA, so it must not reach the threshold alone.
    const rounded = roundedShare(group.amounts);
    if (rounded >= 0.6) {
      score += 0.1;
      reasons.push(`${Math.round(rounded * 100)}% of amounts are round figures`);
    }

    if (movements >= 6) {
      score += 0.1;
      reasons.push(`${movements} movements, so it is a standing arrangement`);
    }

    if (!matchesOwner && looksLikePerson(group.name, nameTokens)) {
      score -= 0.3;
      reasons.push('Reads as a private individual — likely a payment to someone else');
    }

    if (score < SUGGESTION_THRESHOLD) return;

    candidates.push({
      key: group.key,
      name: group.name,
      suggestedTerms: [group.key],
      // Anything you also receive money from is more likely a current/savings account than
      // an investment platform, which is usually one-way until you sell.
      suggestedKind: group.inCount > 0 && group.outCount > 0 ? 'savings' : 'gia',
      outCount: group.outCount,
      inCount: group.inCount,
      outPence: group.outPence,
      inPence: group.inPence,
      netPence: group.outPence - group.inPence,
      confidence: Number(Math.min(1, score).toFixed(2)),
      reasons,
      // Named so no caller can mistake this for a decision already taken.
      requiresConfirmation: true,
    });
  });

  return candidates
    .sort((a, b) => b.confidence - a.confidence || b.outPence - a.outPence)
    .slice(0, limit);
}

module.exports = {
  suggestOwnAccountTransfers,
  BANK_TRANSFER_SCHEMES,
  CARD_SCHEMES,
  SUGGESTION_THRESHOLD,
};
