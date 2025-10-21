const SAFE_CATEGORY_TYPES = ['mandatory', 'optional', 'savings', 'income'];

const MONZO_CATEGORY_TYPE_MAP = {
  bills: 'mandatory',
  entertainment: 'optional',
  expenses: 'mandatory',
  family: 'mandatory',
  transport: 'mandatory',
  groceries: 'mandatory',
  eating_out: 'optional',
  holidays: 'optional',
  shopping: 'optional',
  personal_care: 'optional',
  cash: 'optional',
  general: 'optional',
  investments: 'savings',
  transfers: 'savings',
  savings: 'savings',
  charity: 'mandatory',
  business: 'mandatory',
};

function inferDefaultCategoryType(tx) {
  const cat = String(tx?.category || '').toLowerCase();
  if (MONZO_CATEGORY_TYPE_MAP[cat]) return MONZO_CATEGORY_TYPE_MAP[cat];
  if (Number(tx?.amount || 0) >= 0) return 'income';
  return 'optional';
}

function inferDefaultCategoryLabel(tx) {
  if (tx?.merchant && tx.merchant.name) return tx.merchant.name;
  if (tx?.description) return tx.description;
  if (tx?.category) return tx.category;
  return 'Uncategorised';
}

function toMonthKey(isoTs) {
  try {
    const date = new Date(isoTs);
    if (Number.isNaN(date.getTime())) return null;
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    return `${yyyy}-${mm}`;
  } catch (e) {
    return null;
  }
}

function normaliseMerchantName(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coerceCategoryType(value, fallback) {
  const candidate = String(value || '').toLowerCase();
  return SAFE_CATEGORY_TYPES.includes(candidate)
    ? candidate
    : SAFE_CATEGORY_TYPES.includes(fallback)
      ? fallback
      : 'optional';
}

module.exports = {
  MONZO_CATEGORY_TYPE_MAP,
  SAFE_CATEGORY_TYPES,
  inferDefaultCategoryType,
  inferDefaultCategoryLabel,
  toMonthKey,
  normaliseMerchantName,
  coerceCategoryType,
};
