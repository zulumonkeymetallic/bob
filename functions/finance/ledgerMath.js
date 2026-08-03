// Pure money/month maths for the position ledger. No firebase-admin, no I/O.
//
// Mirrored by react-app/src/utils/financeLedger.ts so the sheet can compute cell
// values without a round trip; react-app/src/utils/financeLedger.parity.test.ts
// fails if the two drift.
//
// Every money value is an integer number of pence. Rates are percent numbers
// (22.9 means 22.9%).

const MONTH_KEY_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

const DEBT_KINDS = ['credit_card', 'loan', 'mortgage'];

const ACCOUNT_KINDS = [
  'current',
  'savings',
  'credit_card',
  'loan',
  'mortgage',
  'isa',
  'gia',
  'pension_workplace',
  'pension_personal',
  'property',
  'other',
];

const INVESTMENT_KINDS = ['isa', 'gia', 'pension_workplace', 'pension_personal'];

/** Assets counted as liquid for the FIRE calculation. */
const LIQUID_KINDS = ['current', 'savings', 'isa', 'gia'];

const PENSION_KINDS = ['pension_workplace', 'pension_personal'];

const POSITION_SOURCES = ['manual', 'monzo_account', 'monzo_pot', 'csv_import', 'rollforward'];

const isMonthKey = (value) => MONTH_KEY_RE.test(String(value === null || value === undefined ? '' : value));

function monthIndexOf(monthKey) {
  const match = MONTH_KEY_RE.exec(String(monthKey === null || monthKey === undefined ? '' : monthKey));
  if (!match) throw new Error(`Invalid month key: ${monthKey}`);
  return Number(match[1]) * 12 + (Number(match[2]) - 1);
}

function monthKeyFromIndex(index) {
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function monthKeyFromDate(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthKeyFromMs(ms) {
  return monthKeyFromDate(new Date(ms));
}

/** Last instant of the month, UTC — what a position is "as at". */
function monthEndISO(monthKey) {
  const index = monthIndexOf(monthKey);
  return new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0, 23, 59, 59, 999)).toISOString();
}

/** Inclusive month range, ascending. Empty when reversed. */
function monthKeysBetween(fromMonth, toMonth) {
  const start = monthIndexOf(fromMonth);
  const end = monthIndexOf(toMonth);
  if (end < start) return [];
  const keys = [];
  for (let i = start; i <= end; i += 1) keys.push(monthKeyFromIndex(i));
  return keys;
}

function lastNMonths(toMonth, count) {
  if (count <= 0) return [];
  const end = monthIndexOf(toMonth);
  return monthKeysBetween(monthKeyFromIndex(end - (count - 1)), toMonth);
}

const sideForKind = (kind) => (DEBT_KINDS.includes(kind) ? 'debt' : 'asset');

const tracksReturn = (kind) => INVESTMENT_KINDS.includes(kind);

function normaliseKind(raw) {
  const kind = String(raw || '').trim().toLowerCase();
  return ACCOUNT_KINDS.includes(kind) ? kind : 'other';
}

/** Coerce anything numeric-ish to integer pence. Returns null when unusable. */
function toPence(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric);
}

/** Same, but from a pounds figure. */
function poundsToPence(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

/**
 * Return on an investment position. returnPct is null — never Infinity — when
 * nothing has been contributed, because an infinite return propagates into every
 * average downstream.
 */
function deriveGain(valuePence, contributedPence) {
  const value = Math.round(Number(valuePence) || 0);
  const contributed = Math.round(Number(contributedPence) || 0);
  const gainPence = value - contributed;
  return {
    gainPence,
    returnPct: contributed > 0 ? (gainPence / contributed) * 100 : null,
  };
}

/** Signed contribution to net worth: assets add, debts subtract, sign-agnostic. */
function signedValuePence(kind, valuePence) {
  const magnitude = Math.abs(Math.round(Number(valuePence) || 0));
  return sideForKind(kind) === 'debt' ? -magnitude : magnitude;
}

/** One month of interest at an annual percentage rate. */
function monthlyInterestPence(balancePence, apr) {
  const balance = Math.abs(Math.round(Number(balancePence) || 0));
  const rate = Number(apr);
  if (!balance || !Number.isFinite(rate) || rate <= 0) return 0;
  return Math.round((balance * (rate / 100)) / 12);
}

/**
 * Net worth for one month from the register plus that month's positions.
 * `positions` may be an array or a Map keyed by accountId.
 */
function netWorthFromPositions(accounts, positions) {
  const byAccount = positions instanceof Map
    ? positions
    : new Map((positions || []).map((p) => [p.accountId, p]));

  const totals = {
    totalAssetPence: 0,
    totalDebtPence: 0,
    netWorthPence: 0,
    byKindPence: {},
    liquidAssetPence: 0,
    fireEligiblePence: 0,
    pensionPence: 0,
    propertyPence: 0,
    totalContributedPence: 0,
    totalGainPence: 0,
    accountCount: 0,
    coveredAccountCount: 0,
    estimatedAccountIds: [],
  };

  (accounts || []).forEach((account) => {
    if (account.deleted === true || account.archived === true) return;
    if (account.includeInNetWorth === false) return;

    totals.accountCount += 1;
    const position = byAccount.get(account.accountId);
    if (!position) return;

    totals.coveredAccountCount += 1;
    if (position.isEstimate) totals.estimatedAccountIds.push(account.accountId);

    const magnitude = Math.abs(Math.round(Number(position.valuePence) || 0));
    const signed = signedValuePence(account.kind, magnitude);

    if (sideForKind(account.kind) === 'debt') {
      totals.totalDebtPence += magnitude;
    } else {
      totals.totalAssetPence += magnitude;
      if (LIQUID_KINDS.includes(account.kind)) totals.liquidAssetPence += magnitude;
      if (PENSION_KINDS.includes(account.kind)) totals.pensionPence += magnitude;
      if (account.kind === 'property') totals.propertyPence += magnitude;
    }

    totals.byKindPence[account.kind] = (totals.byKindPence[account.kind] || 0) + signed;

    if (tracksReturn(account.kind)) {
      totals.totalContributedPence += Math.abs(Math.round(Number(position.contributedPence) || 0));
      totals.totalGainPence += Math.round(Number(position.gainPence) || 0);
    }

    // FIRE eligibility is a per-account flag, applied to both sides: a debt you
    // will still be servicing in retirement reduces the pot that has to fund you.
    if (account.includeInFire !== false) {
      totals.fireEligiblePence += signed;
    }
  });

  totals.netWorthPence = totals.totalAssetPence - totals.totalDebtPence;
  return totals;
}

/**
 * Years until the FIRE number is reached, solving the future value of an annuity.
 *
 *   n = ln((F·r/12 + P) / (C·r/12 + P)) / ln(1 + r/12) / 12
 *
 * where F is the target, C the current pot, P the monthly contribution and r the
 * annual rate. Returns null when it is unreachable, 0 when already there.
 */
function yearsToTarget(currentPence, targetPence, monthlyContributionPence, annualRatePct) {
  const current = Number(currentPence) || 0;
  const target = Number(targetPence) || 0;
  const monthly = Number(monthlyContributionPence) || 0;
  if (target <= 0) return null;
  if (current >= target) return 0;

  const r = (Number(annualRatePct) || 0) / 100;
  const monthlyRate = r / 12;

  if (monthlyRate <= 0) {
    if (monthly <= 0) return null;
    return (target - current) / monthly / 12;
  }

  const numerator = target * monthlyRate + monthly;
  const denominator = current * monthlyRate + monthly;
  if (denominator <= 0 || numerator <= 0) return null;

  const months = Math.log(numerator / denominator) / Math.log(1 + monthlyRate);
  if (!Number.isFinite(months) || months < 0) return null;
  return months / 12;
}

/**
 * The FIRE picture for one month.
 * Spend is real trailing spend, not a percentage-of-income guess.
 */
function computeFire(assumptions, { fireEligiblePence, trailing12SpendPence, monthlySurplusPence }) {
  const a = assumptions || {};
  const swr = Number(a.safeWithdrawalRatePct) || 4;

  const annualSpendPence = a.spendBasis === 'manual' && Number.isFinite(Number(a.manualAnnualSpendPence))
    ? Math.round(Number(a.manualAnnualSpendPence))
    : Math.round(Number(trailing12SpendPence) || 0);

  if (!annualSpendPence || swr <= 0) {
    return {
      fireNumberPence: null,
      fireProgressPct: null,
      yearsToFire: null,
      fireDateISO: null,
      annualSpendPence,
    };
  }

  const fireNumberPence = Math.round((annualSpendPence / swr) * 100);
  const current = Math.round(Number(fireEligiblePence) || 0);

  const contribution = Number.isFinite(Number(a.monthlyContributionOverridePence))
    && a.monthlyContributionOverridePence !== null
    ? Math.round(Number(a.monthlyContributionOverridePence))
    : Math.max(0, Math.round(Number(monthlySurplusPence) || 0));

  const nominal = Number(a.nominalGrowthRatePct);
  const inflation = Number(a.inflationRatePct);
  const rate = a.useRealReturns === false
    ? (Number.isFinite(nominal) ? nominal : 5)
    : (Number.isFinite(nominal) ? nominal : 5) - (Number.isFinite(inflation) ? inflation : 2.5);

  const years = yearsToTarget(current, fireNumberPence, contribution, rate);

  let fireDateISO = null;
  if (years !== null && years >= 0 && years < 100) {
    const date = new Date();
    date.setUTCMonth(date.getUTCMonth() + Math.ceil(years * 12));
    fireDateISO = date.toISOString();
  }

  return {
    fireNumberPence,
    fireProgressPct: fireNumberPence > 0
      ? Math.max(0, Math.min(100, (current / fireNumberPence) * 100))
      : null,
    yearsToFire: years,
    fireDateISO,
    annualSpendPence,
  };
}

module.exports = {
  MONTH_KEY_RE,
  ACCOUNT_KINDS,
  DEBT_KINDS,
  INVESTMENT_KINDS,
  LIQUID_KINDS,
  PENSION_KINDS,
  POSITION_SOURCES,
  isMonthKey,
  monthIndexOf,
  monthKeyFromIndex,
  monthKeyFromDate,
  monthKeyFromMs,
  monthEndISO,
  monthKeysBetween,
  lastNMonths,
  sideForKind,
  tracksReturn,
  normaliseKind,
  toPence,
  poundsToPence,
  deriveGain,
  signedValuePence,
  monthlyInterestPence,
  netWorthFromPositions,
  yearsToTarget,
  computeFire,
};
