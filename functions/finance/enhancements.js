const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { normaliseMerchantName, inferDefaultCategoryType, inferDefaultCategoryLabel } = require('../monzo/shared');
const { mergeFinanceCategories } = require('./categories');
const { resolveTransactionCategory, buildCategoryIndex, narrowToV4 } = require('./bucketResolver');
const { callLLM } = require('../utils/llmHelper');
const { suggestOwnAccountTransfers } = require('./transferSuggestions');
const { buildPotIndex, buildTransferAccountIndex } = require('./bucketResolver');
const {
  normalizeExternalSource,
  resolveSourceConfig,
  buildTermMatcher,
  classifyStatementRow,
  fileIsUnsigned,
} = require('./externalSources');

const OPENROUTER_API_KEY_SECRET = defineSecret('OPENROUTER_API_KEY');
const FUNCTION_REGION = 'europe-west2';
const MANUAL_ACCOUNT_TYPES = new Set(['asset', 'debt', 'investment', 'cash', 'savings']);
const DAY_MS = 24 * 60 * 60 * 1000;
const LEDGER_ACCOUNTS = 'finance_ledger_accounts';

/**
 * Resolve the import/match configuration from the user's own account register so provider
 * behaviour is data, not code. Accepts either an accountId (preferred — the account the
 * user registered on /finance/ledger) or a bare source slug for the legacy call shape.
 */
async function loadSourceConfig(db, uid, { accountId, source } = {}) {
  let account = null;
  if (accountId) {
    const snap = await db.collection(LEDGER_ACCOUNTS).doc(`${uid}_${accountId}`).get();
    if (snap.exists) {
      const data = snap.data() || {};
      if (data.ownerUid !== uid) {
        throw new httpsV2.HttpsError('permission-denied', 'Not your account');
      }
      account = data;
    }
  }
  if (!account && source) {
    // No explicit account: adopt one registered against this source, if there is exactly
    // one, so an import against 'halifax' still picks up that card's APR and match terms.
    const bySource = await db.collection(LEDGER_ACCOUNTS)
      .where('ownerUid', '==', uid)
      .where('externalSource', '==', normalizeExternalSource(source))
      .get();
    const live = bySource.docs.map((d) => d.data() || {}).filter((d) => !d.deleted && !d.archived);
    if (live.length === 1) [account] = live;
  }
  return resolveSourceConfig({ source, account });
}

function normalizeManualAccountType(rawType) {
  const type = String(rawType || 'asset').trim().toLowerCase();
  if (MANUAL_ACCOUNT_TYPES.has(type)) return type;
  return 'asset';
}

function csvSplitLine(line, delimiter) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvRows(csvText) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const sample = lines[0] || '';
  const commaCount = (sample.match(/,/g) || []).length;
  const semicolonCount = (sample.match(/;/g) || []).length;
  const tabCount = (sample.match(/\t/g) || []).length;
  const delimiter = tabCount >= commaCount && tabCount >= semicolonCount
    ? '\t'
    : semicolonCount > commaCount
      ? ';'
      : ',';
  return lines.map((line) => csvSplitLine(line, delimiter));
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseDateMs(rawValue) {
  if (rawValue === undefined || rawValue === null) return null;
  if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
    if (rawValue > 20000 && rawValue < 60000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      return excelEpoch + Math.round(rawValue * DAY_MS);
    }
    if (rawValue > 1_000_000_000_000) return rawValue;
  }
  const value = String(rawValue).trim();
  if (!value) return null;
  const direct = Date.parse(value);
  if (!Number.isNaN(direct)) return direct;
  const slash = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slash) {
    const d = Number(slash[1]);
    const m = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return Number.isNaN(dt.getTime()) ? null : dt.getTime();
  }
  return null;
}

function parseMoneyMinor(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  let text = String(value).trim();
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  text = text.replace(/[£$€,\s]/g, '');
  if (text.includes('.') && text.includes(',')) {
    text = text.replace(/,/g, '');
  } else if (text.includes(',') && !text.includes('.')) {
    text = text.replace(/,/g, '.');
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  let minor = Math.round(parsed * 100);
  if (negative) minor = -Math.abs(minor);
  return minor;
}

// Strip common PayPal sender prefixes ("PAYPAL *", "PP*", "Payment to") so the
// real merchant name is what survives into tokenization and merchantKey.
function extractPayPalMerchant(description) {
  let text = String(description || '').trim();
  text = text
    .replace(/^paypal\s*\*+\s*/i, '')
    .replace(/^pp\s*\*+\s*/i, '')
    .replace(/^paypal[.\s]+/i, '')
    .replace(/^payment\s+to\s+/i, '');
  const segment = text.split(/[-*|,]/)[0].trim();
  return segment || text || '';
}

// Detect same-merchant reversal pairs (auth+void, charge+refund) within 7 days
// and tag both rows as 'reversed_pair' so they are excluded from Monzo matching.
function collapsePayPalReversals(rows) {
  const WINDOW_MS = 7 * DAY_MS;
  const tagged = new Set();
  for (let i = 0; i < rows.length; i++) {
    if (tagged.has(i) || rows[i].lifecycleStatus) continue;
    const a = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      if (tagged.has(j)) continue;
      const b = rows[j];
      if (b.postedDateMs - a.postedDateMs > WINDOW_MS) break;
      const sameAmount = Math.abs(Math.abs(a.amountMinor) - Math.abs(b.amountMinor)) <= 5;
      const oppositeSign = (a.amountMinor > 0) !== (b.amountMinor > 0);
      const sameMerchant = a.merchantKey && b.merchantKey && (
        a.merchantKey === b.merchantKey ||
        a.merchantKey.includes(b.merchantKey) ||
        b.merchantKey.includes(a.merchantKey)
      );
      if (sameAmount && oppositeSign && sameMerchant) {
        rows[i].lifecycleStatus = 'reversed_pair';
        rows[j].lifecycleStatus = 'reversed_pair';
        tagged.add(i);
        tagged.add(j);
        break;
      }
    }
  }
  return rows;
}

function buildExternalRowsFromCsv(csvText, source) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) return [];
  const first = rows[0];
  const firstHeader = first.map(normalizeHeader);
  const headerLike = firstHeader.some((h) => h.includes('date') || h.includes('amount') || h.includes('description') || h.includes('merchant'));
  const header = headerLike ? firstHeader : [];
  const dataRows = headerLike ? rows.slice(1) : rows;
  const idx = (needles, fallback = -1) => {
    if (!header.length) return fallback;
    for (let i = 0; i < header.length; i += 1) {
      if (needles.some((n) => header[i].includes(n))) return i;
    }
    return fallback;
  };
  const dateIdx = idx(['date', 'posted', 'booking', 'transaction']);
  const descIdx = idx(['description', 'details', 'merchant', 'name', 'memo'], 1);
  const debitIdx = idx(['debit', 'withdrawal', 'out']);
  const creditIdx = idx(['credit', 'deposit', 'in']);
  const amountIdx = idx(['amount', 'value'], 2);
  const idIdx = idx(['id', 'reference', 'txn', 'transaction id', 'unique']);
  // PayPal CSVs include a Status column: only import Completed rows; tag Reversed rows explicitly
  const statusIdx = source === 'paypal' ? idx(['status', 'state']) : -1;

  const result = [];
  dataRows.forEach((row, index) => {
    if (!row || !row.length) return;
    const dateRaw = dateIdx >= 0 ? row[dateIdx] : row[0];
    const dateMs = parseDateMs(dateRaw);
    if (!dateMs) return;
    if (source === 'paypal' && statusIdx >= 0) {
      const rowStatus = String(row[statusIdx] || '').toLowerCase().trim();
      // Skip rows that haven't cleared yet — they won't have a Monzo counterpart
      if (rowStatus === 'pending' || rowStatus === 'held' || rowStatus === 'on hold') return;
    }

    let amountMinor = null;
    // A debit/credit column PAIR states the direction explicitly; a single amount column
    // may or may not carry signs, which is decided for the file as a whole further down.
    let signIsExplicit = false;
    const debitMinor = debitIdx >= 0 ? parseMoneyMinor(row[debitIdx]) : null;
    const creditMinor = creditIdx >= 0 ? parseMoneyMinor(row[creditIdx]) : null;
    const amountMinorRaw = amountIdx >= 0 ? parseMoneyMinor(row[amountIdx]) : null;
    if (Number.isFinite(debitMinor) && debitMinor !== 0) {
      amountMinor = -Math.abs(debitMinor);
      signIsExplicit = true;
    } else if (Number.isFinite(creditMinor) && creditMinor !== 0) {
      amountMinor = Math.abs(creditMinor);
      signIsExplicit = true;
    } else if (Number.isFinite(amountMinorRaw)) {
      amountMinor = amountMinorRaw;
    }
    if (!Number.isFinite(amountMinor) || amountMinor === 0) return;

    const description = String(descIdx >= 0 ? row[descIdx] : row[1] || row[0] || '').trim();

    const merchantName = source === 'paypal'
      ? (extractPayPalMerchant(description) || description.split(/[-*|]/)[0].trim() || `${source}-${index + 1}`)
      : (description.split(/[-*|]/)[0].trim() || description || `${source}-${index + 1}`);
    const merchantKey = normaliseMerchantName(merchantName);
    const externalRef = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
    // Tag rows that the PayPal CSV itself marks as reversed so the collapse pass can also catch them
    const lifecycleStatus = source === 'paypal' && statusIdx >= 0
      && String(row[statusIdx] || '').toLowerCase().trim() === 'reversed' ? 'reversed' : null;
    result.push({
      source,
      externalRef: externalRef || null,
      postedDateISO: new Date(dateMs).toISOString(),
      postedDateMs: dateMs,
      amountMinor,
      signIsExplicit,
      currency: 'GBP',
      description: description || merchantName,
      merchantName,
      merchantKey,
      lifecycleStatus,
      rawIndex: index,
      rawRow: row,
    });
  });

  // Sign is a property of the FILE, not of a row. Statements come in two shapes: signed
  // (Barclaycard: purchases negative) and unsigned (every figure positive, direction implied
  // by the description). Flipping per-row against a keyword list, as this did before,
  // destroyed the sign on already-signed files — payments and refunds silently became spend.
  const applyUnsignedFallback = !result.some((row) => row.signIsExplicit)
    && fileIsUnsigned(result.map((row) => row.amountMinor));
  const finalised = result.map((row) => {
    let { amountMinor } = row;
    if (applyUnsignedFallback && amountMinor > 0) {
      const keepPositive = /refund|reversal|cashback|payment received|payment - thank you|deposit|received|credit adjustment/
        .test(row.description.toLowerCase());
      if (!keepPositive) amountMinor = -Math.abs(amountMinor);
    }
    const fingerprint = `${source}|${row.externalRef || `${row.postedDateMs}|${amountMinor}|${row.description}|${row.rawIndex}`}`;
    const { signIsExplicit: _sign, rawIndex: _idx, ...rest } = row;
    return {
      ...rest,
      externalId: crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 24),
      amountMinor,
      amount: amountMinor / 100,
    };
  });

  // For PayPal, run a reversal-collapse pass before returning so paired rows are excluded from matching
  if (source === 'paypal') return collapsePayPalReversals(finalised);
  return finalised;
}

function normalizeMonzoCategoryKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function buildMonzoRowsFromCsv(csvText) {
  const rows = parseCsvRows(csvText);
  if (!rows.length) return [];
  const header = rows[0].map(normalizeHeader);
  const idx = (needles, fallback = -1) => {
    for (let i = 0; i < header.length; i += 1) {
      if (needles.some((needle) => header[i].includes(needle))) return i;
    }
    return fallback;
  };

  const transactionIdIdx = idx(['transaction id', 'transactionid']);
  const dateIdx = idx(['date']);
  const timeIdx = idx(['time']);
  const typeIdx = idx(['type']);
  const nameIdx = idx(['name', 'merchant'], 4);
  const emojiIdx = idx(['emoji']);
  const categoryIdx = idx(['category']);
  const amountIdx = idx(['amount']);
  const currencyIdx = idx(['currency']);
  const localAmountIdx = idx(['local amount']);
  const localCurrencyIdx = idx(['local currency']);
  const notesIdx = idx(['notes and tags', 'notes']);
  const addressIdx = idx(['address']);
  const receiptIdx = idx(['receipt']);
  const descriptionIdx = idx(['description']);
  const categorySplitIdx = idx(['category split']);

  if (dateIdx < 0 || amountIdx < 0) {
    return [];
  }

  const dataRows = rows.slice(1);
  const parsedRows = [];
  dataRows.forEach((row, index) => {
    if (!row || !row.length) return;
    const dateText = String(dateIdx >= 0 ? row[dateIdx] || '' : '').trim();
    const timeText = String(timeIdx >= 0 ? row[timeIdx] || '' : '').trim();
    const dateMs = parseDateMs(`${dateText} ${timeText}`.trim()) || parseDateMs(dateText);
    if (!dateMs) return;

    const amountMinorRaw = parseMoneyMinor(amountIdx >= 0 ? row[amountIdx] : null);
    const localAmountMinorRaw = parseMoneyMinor(localAmountIdx >= 0 ? row[localAmountIdx] : null);
    const amountMinor = Number.isFinite(amountMinorRaw) ? amountMinorRaw : localAmountMinorRaw;
    if (!Number.isFinite(amountMinor) || amountMinor === 0) return;

    const transactionIdRaw = String(transactionIdIdx >= 0 ? row[transactionIdIdx] || '' : '').trim();
    const merchantName = String(nameIdx >= 0 ? row[nameIdx] || '' : '').trim();
    const description = String(descriptionIdx >= 0 ? row[descriptionIdx] || '' : '').trim();
    const categoryLabel = String(categoryIdx >= 0 ? row[categoryIdx] || '' : '').trim();
    const categoryKey = normalizeMonzoCategoryKey(categoryLabel);
    const currency = String(currencyIdx >= 0 ? row[currencyIdx] || '' : '').trim() || 'GBP';
    const localCurrency = String(localCurrencyIdx >= 0 ? row[localCurrencyIdx] || '' : '').trim() || currency;
    const fallbackFingerprint = `${dateMs}|${amountMinor}|${merchantName}|${description}|${index}`;
    const transactionId = transactionIdRaw || `csv_${crypto.createHash('sha1').update(fallbackFingerprint).digest('hex').slice(0, 20)}`;
    const merchant = merchantName || description || categoryLabel || 'Transaction';
    const inferredLabel = categoryLabel || inferDefaultCategoryLabel({
      merchant: { name: merchant },
      description,
      category: categoryKey,
      amount: amountMinor / 100,
    });

    parsedRows.push({
      transactionId,
      createdISO: new Date(dateMs).toISOString(),
      createdMs: dateMs,
      amountMinor,
      amount: amountMinor / 100,
      currency,
      localAmountMinor: Number.isFinite(localAmountMinorRaw) ? localAmountMinorRaw : amountMinor,
      localCurrency,
      type: String(typeIdx >= 0 ? row[typeIdx] || '' : '').trim() || null,
      name: merchantName || null,
      emoji: String(emojiIdx >= 0 ? row[emojiIdx] || '' : '').trim() || null,
      categoryLabel: inferredLabel || null,
      categoryKey: categoryKey || null,
      notesAndTags: String(notesIdx >= 0 ? row[notesIdx] || '' : '').trim() || null,
      address: String(addressIdx >= 0 ? row[addressIdx] || '' : '').trim() || null,
      receipt: String(receiptIdx >= 0 ? row[receiptIdx] || '' : '').trim() || null,
      description: description || merchantName || inferredLabel || 'Transaction',
      categorySplit: String(categorySplitIdx >= 0 ? row[categorySplitIdx] || '' : '').trim() || null,
      merchantKey: normaliseMerchantName(merchant),
      defaultCategoryType: inferDefaultCategoryType({ category: categoryKey, amount: amountMinor / 100 }),
    });
  });
  return parsedRows;
}

function normalizeAmountMinor(data) {
  if (Number.isFinite(data?.amountMinor)) return Math.round(Number(data.amountMinor));
  const amount = Number(data?.amount || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function timestampToMs(ts, fallbackISO) {
  if (ts?.toMillis) return ts.toMillis();
  if (ts?.toDate) return ts.toDate().getTime();
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  if (fallbackISO) {
    const parsed = Date.parse(String(fallbackISO));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .map((v) => v.trim())
    .filter((v) => v && ![
      'the', 'and', 'ltd', 'limited', 'plc', 'payment', 'card',
      // PayPal-specific tokens that always appear on one side and never the other
      'paypal', 'pp', 'online', 'services', 'transfer', 'via',
    ].includes(v));
}

function jaccard(a, b) {
  const aSet = new Set(a);
  const bSet = new Set(b);
  if (!aSet.size && !bSet.size) return 0;
  let inter = 0;
  aSet.forEach((v) => { if (bSet.has(v)) inter += 1; });
  const union = new Set([...aSet, ...bSet]).size;
  return union ? inter / union : 0;
}

function monthKeyFromMs(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// V10 -> V4 projection. Delegates to the shared resolver so this file cannot
// drift from analytics.js and dashboard.js the way it had.
function normalizeBucket(bucketRaw) {
  return narrowToV4(bucketRaw) || 'unknown';
}

/**
 * Is this merchant a LIVE recurring charge, or just one that used to be?
 *
 * The action engine previously trusted `merchantSummary.isRecurring`, an all-time
 * aggregate with no recency test — so a CrossFit membership cancelled in December
 * 2025 still presented as a cancellable subscription, and its notional saving was
 * counted towards the headline "Actions Potential".
 *
 * A charge counts as live only if, across the last `windowMonths` months:
 *   - it appears in at least `windowMonths - 1` of them (one skip tolerated for a
 *     billing date that straddles a month boundary),
 *   - it appears in the most recent full month (the actual cancellation test),
 *   - amounts sit within ±`amountTolerancePct` of the median, and
 *   - the gaps between charges sit within ±`dayToleranceDays` of the median.
 *
 * Returns { isLive, reason, monthsSeen, medianAmount, medianGapDays }.
 */
function assessRecurringActivity(transactions, options = {}) {
  const {
    now = Date.now(),
    windowMonths = 6,
    amountTolerancePct = 10,
    dayToleranceDays = 5,
  } = options;

  const DAY = 24 * 60 * 60 * 1000;
  const windowStart = now - windowMonths * 30.44 * DAY;

  const dated = (transactions || [])
    .map((tx) => ({
      ms: timestampToMs(tx.createdAt, tx.createdISO),
      amount: Math.abs(normalizeAmountMinor(tx)) / 100,
    }))
    .filter((tx) => tx.ms && tx.ms >= windowStart && tx.amount > 0)
    .sort((a, b) => a.ms - b.ms);

  if (dated.length < 2) {
    return {
      isLive: false, reason: 'too_few_charges', monthsSeen: dated.length, medianAmount: null, medianGapDays: null,
    };
  }

  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const monthsSeen = new Set(dated.map((tx) => monthKeyFromMs(tx.ms)));

  // Cancelled charges fail here: nothing in the most recent complete month.
  const lastFullMonth = monthKeyFromMs(now - 30 * DAY);
  if (!monthsSeen.has(lastFullMonth) && !monthsSeen.has(monthKeyFromMs(now))) {
    return {
      isLive: false,
      reason: 'no_recent_charge',
      monthsSeen: monthsSeen.size,
      medianAmount: median(dated.map((t) => t.amount)),
      medianGapDays: null,
    };
  }

  if (monthsSeen.size < windowMonths - 1) {
    return {
      isLive: false,
      reason: 'not_every_month',
      monthsSeen: monthsSeen.size,
      medianAmount: median(dated.map((t) => t.amount)),
      medianGapDays: null,
    };
  }

  const amounts = dated.map((tx) => tx.amount);
  const medianAmount = median(amounts);
  const amountBand = medianAmount * (amountTolerancePct / 100);
  const amountsConsistent = amounts.every((a) => Math.abs(a - medianAmount) <= amountBand);

  const gaps = [];
  for (let i = 1; i < dated.length; i += 1) gaps.push((dated[i].ms - dated[i - 1].ms) / DAY);
  const medianGapDays = median(gaps);
  const cadenceConsistent = gaps.every((g) => Math.abs(g - medianGapDays) <= dayToleranceDays);

  if (!amountsConsistent) {
    return { isLive: false, reason: 'amount_varies', monthsSeen: monthsSeen.size, medianAmount, medianGapDays };
  }
  if (!cadenceConsistent) {
    return { isLive: false, reason: 'cadence_varies', monthsSeen: monthsSeen.size, medianAmount, medianGapDays };
  }

  return { isLive: true, reason: 'live', monthsSeen: monthsSeen.size, medianAmount, medianGapDays };
}

function buildActionId(action) {
  return crypto
    .createHash('sha1')
    .update(`${action.source || 'heuristic'}|${action.type}|${action.merchantKey || action.title}|${action.reference || ''}`)
    .digest('hex')
    .slice(0, 16);
}

function extractJson(text) {
  if (!text) return null;
  const trimmed = String(text).trim();
  try { return JSON.parse(trimmed); } catch { }
  const block = trimmed.match(/```json([\s\S]*?)```/i) || trimmed.match(/```([\s\S]*?)```/i);
  if (block && block[1]) {
    try { return JSON.parse(block[1].trim()); } catch { }
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    try { return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)); } catch { }
  }
  return null;
}

async function callGeminiActionRefinement({ uid, actions }) {
  if (!actions.length) return null;
  const system = [
    'You are a personal finance optimisation assistant.',
    'Return JSON only in the shape:',
    '{"actions":[{"merchantKey":"string","type":"cancel|reduce|review|debt_optimization","title":"string","reason":"string","estimatedMonthlySavings":number,"confidence":0-1}]}',
    'Keep at most 12 actions. Be conservative and practical. Output raw JSON with no markdown fences.',
  ].join('\n');
  const user = `Candidates: ${JSON.stringify(actions.slice(0, 40))}`;
  const text = await callLLM(system, user, undefined, { userId: uid, purpose: 'finance_commentary' });
  const parsed = extractJson(text);
  const list = Array.isArray(parsed?.actions) ? parsed.actions : [];
  if (!list.length) return null;
  return list;
}

const importExternalFinanceTransactions = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const csvText = String(req.data?.csv || '').trim();
  if (!csvText) throw new httpsV2.HttpsError('invalid-argument', 'csv is required');

  const db = admin.firestore();
  const accountId = String(req.data?.accountId || '').trim() || null;
  const config = await loadSourceConfig(db, uid, { accountId, source: req.data?.source });
  const { source } = config;

  const parsedRows = buildExternalRowsFromCsv(csvText, source);
  if (!parsedRows.length) {
    return { ok: true, source, parsed: 0, upserted: 0, skipped: 0, message: 'No valid rows detected in CSV.' };
  }

  let batch = db.batch();
  let ops = 0;
  let upserted = 0;
  const maxBatch = 400;

  for (const row of parsedRows) {
    const docRef = db.collection('finance_external_transactions').doc(`${uid}_${source}_${row.externalId}`);
    batch.set(docRef, {
      ownerUid: uid,
      source,
      accountId: config.accountId,
      externalId: row.externalId,
      externalRef: row.externalRef || null,
      postedDateISO: row.postedDateISO,
      postedAt: admin.firestore.Timestamp.fromDate(new Date(row.postedDateMs)),
      amountMinor: row.amountMinor,
      amount: row.amount,
      currency: row.currency || 'GBP',
      description: row.description,
      merchantName: row.merchantName,
      merchantKey: row.merchantKey || normaliseMerchantName(row.merchantName || row.description || row.externalId),
      lifecycleStatus: row.lifecycleStatus || null,
      rawRow: row.rawRow || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    upserted += 1;
    ops += 1;
    if (ops >= maxBatch) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();

  return {
    ok: true,
    source,
    accountId: config.accountId,
    accountLabel: config.label,
    parsed: parsedRows.length,
    upserted,
    skipped: Math.max(0, parseCsvRows(csvText).length - parsedRows.length),
    sample: parsedRows.slice(0, 5),
  };
});

const importMonzoTransactionsCsv = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const csvText = String(req.data?.csv || '').trim();
  if (!csvText) throw new httpsV2.HttpsError('invalid-argument', 'csv is required');

  const parsedRows = buildMonzoRowsFromCsv(csvText);
  if (!parsedRows.length) {
    return {
      ok: true,
      parsed: 0,
      inserted: 0,
      skippedExisting: 0,
      message: 'No valid Monzo CSV rows detected. Confirm headers include Date and Amount columns.',
    };
  }

  const db = admin.firestore();
  const existingSnap = await db.collection('monzo_transactions').where('ownerUid', '==', uid).get();
  const existingIds = new Set();
  existingSnap.docs.forEach((doc) => {
    const transactionId = String(doc.data()?.transactionId || '').trim();
    if (transactionId) existingIds.add(transactionId);
  });

  const seenIds = new Set();
  let inserted = 0;
  let skippedExisting = 0;
  let batch = db.batch();
  let ops = 0;
  const maxBatch = 350;

  let insertedStartMs = null;
  let insertedEndMs = null;

  for (const row of parsedRows) {
    if (!row?.transactionId) continue;
    if (seenIds.has(row.transactionId)) continue;
    seenIds.add(row.transactionId);
    if (existingIds.has(row.transactionId)) {
      skippedExisting += 1;
      continue;
    }

    const rowMs = Number(row.createdMs || Date.parse(row.createdISO));
    insertedStartMs = insertedStartMs === null ? rowMs : Math.min(insertedStartMs, rowMs);
    insertedEndMs = insertedEndMs === null ? rowMs : Math.max(insertedEndMs, rowMs);

    const docId = `${uid}_csv_${crypto.createHash('sha1').update(String(row.transactionId)).digest('hex').slice(0, 24)}`;
    const ref = db.collection('monzo_transactions').doc(docId);
    const merchantName = row.name || row.description || row.categoryLabel || 'Transaction';
    const createdDate = new Date(row.createdISO);

    batch.set(ref, {
      ownerUid: uid,
      transactionId: row.transactionId,
      amountMinor: row.amountMinor,
      amount: row.amount,
      currency: row.currency || 'GBP',
      createdISO: row.createdISO,
      createdAt: admin.firestore.Timestamp.fromDate(createdDate),
      description: row.description || merchantName,
      merchant: {
        name: merchantName,
        emoji: row.emoji || null,
      },
      merchantKey: row.merchantKey || normaliseMerchantName(merchantName),
      defaultCategoryLabel: row.categoryLabel || null,
      defaultCategoryType: row.defaultCategoryType || 'optional',
      metadata: {
        source: 'monzo_csv',
        csvType: row.type || null,
        csvLocalAmountMinor: row.localAmountMinor || row.amountMinor,
        csvLocalCurrency: row.localCurrency || row.currency || 'GBP',
        csvNotesAndTags: row.notesAndTags || null,
        csvAddress: row.address || null,
        csvReceipt: row.receipt || null,
        csvCategorySplit: row.categorySplit || null,
      },
      importedFromCsv: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      importedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    inserted += 1;
    ops += 1;
    if (ops >= maxBatch) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();

  return {
    ok: true,
    parsed: parsedRows.length,
    inserted,
    skippedExisting,
    skippedInvalid: Math.max(0, parseCsvRows(csvText).length - 1 - parsedRows.length),
    coverageStartISO: insertedStartMs ? new Date(insertedStartMs).toISOString() : null,
    coverageEndISO: insertedEndMs ? new Date(insertedEndMs).toISOString() : null,
    sample: parsedRows.slice(0, 5),
  };
});

const matchExternalToMonzoTransactions = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const windowDays = Math.max(1, Math.min(Number(req.data?.windowDays || 5), 30));
  const amountTolerancePence = Math.max(1, Math.min(Number(req.data?.amountTolerancePence || 150), 2_000));

  const db = admin.firestore();
  const accountId = String(req.data?.accountId || '').trim() || null;
  const config = req.data?.source || accountId
    ? await loadSourceConfig(db, uid, { accountId, source: req.data?.source })
    : null;
  const source = config?.source || null;

  const [externalSnap, monzoSnap] = await Promise.all([
    db.collection('finance_external_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
  ]);

  const externalRows = externalSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() || {}) }))
    // An accountId narrows to one registered card; a bare source still matches the whole
    // provider, including rows imported before accounts were linked.
    .filter((row) => (accountId ? row.accountId === accountId : (!source || row.source === source)))
    // Exclude lifecycle-excluded rows: pending (not settled) and reversed pairs (net zero)
    .filter((row) => row.lifecycleStatus !== 'reversed_pair' && row.lifecycleStatus !== 'pending');
  if (!externalRows.length) {
    return { ok: true, matched: 0, unmatched: 0, source, message: 'No external rows available for matching.' };
  }

  const monzoRows = monzoSnap.docs.map((d) => {
    const data = d.data() || {};
    const amountMinor = normalizeAmountMinor(data);
    const dateMs = timestampToMs(data.createdAt, data.createdISO);
    const merchantText = `${data.merchant?.name || ''} ${data.counterparty?.name || ''} ${data.description || ''}`.trim();
    return {
      docId: d.id,
      transactionId: data.transactionId || d.id,
      amountMinor: Math.abs(amountMinor),
      rawAmountMinor: amountMinor,
      dateMs,
      merchantTokens: tokenize(merchantText),
      merchantText: merchantText.toLowerCase(),
    };
  }).filter((row) => row.dateMs && row.amountMinor > 0);

  monzoRows.sort((a, b) => a.dateMs - b.dateMs);
  externalRows.sort((a, b) => {
    const aMs = timestampToMs(a.postedAt, a.postedDateISO) || 0;
    const bMs = timestampToMs(b.postedAt, b.postedDateISO) || 0;
    return aMs - bMs;
  });

  const usedMonzo = new Set();
  let matched = 0;
  let unmatched = 0;
  let ops = 0;
  let batch = db.batch();
  const maxBatch = 350;
  const bySource = {};

  // Rows can span providers when matching without a source filter, so resolve the shift per
  // row — from the account's own override where the row belongs to the resolved account,
  // otherwise from that provider's preset. Memoised: this runs once per external row.
  const shiftCache = new Map();
  const shiftDaysFor = (ext) => {
    if (config?.accountId && ext.accountId === config.accountId) return config.dateShiftDays;
    const key = ext.source || 'other';
    if (!shiftCache.has(key)) shiftCache.set(key, resolveSourceConfig({ source: key }).dateShiftDays);
    return shiftCache.get(key);
  };

  for (const ext of externalRows) {
    const extDateMs = timestampToMs(ext.postedAt, ext.postedDateISO);
    const extAmountMinor = Math.abs(normalizeAmountMinor(ext));
    const extTokens = tokenize(`${ext.merchantName || ''} ${ext.description || ''}`);
    if (!extDateMs || !extAmountMinor) continue;

    // Settlement lag differs per provider (PayPal records the ORDER date and Monzo sees
    // settlement 1–2 days later), so the shift comes from the resolved source config and is
    // overridable per account rather than hardcoded to one provider.
    const extDateMsForComp = extDateMs + (shiftDaysFor(ext) * DAY_MS);
    let best = null;
    for (const monzo of monzoRows) {
      if (usedMonzo.has(monzo.docId)) continue;
      const amountDiff = Math.abs(monzo.amountMinor - extAmountMinor);
      if (amountDiff > amountTolerancePence) continue;
      const dateDiffDays = Math.abs(monzo.dateMs - extDateMsForComp) / DAY_MS;
      if (dateDiffDays > windowDays) continue;
      const similarity = jaccard(extTokens, monzo.merchantTokens);
      const normalizedAmount = amountDiff / amountTolerancePence;
      const normalizedDate = dateDiffDays / windowDays;
      const score = (normalizedAmount * 0.55) + (normalizedDate * 0.35) + ((1 - similarity) * 0.10);
      if (!best || score < best.score) {
        best = { monzo, score, amountDiff, dateDiffDays, similarity };
      }
    }

    const matchId = `${uid}_${ext.source || 'other'}_${ext.externalId || ext.id}`;
    const matchRef = db.collection('finance_transaction_matches').doc(matchId);
    if (best) {
      usedMonzo.add(best.monzo.docId);
      const confidence = Math.max(0, Math.min(1, Number((1 - best.score).toFixed(3))));
      matched += 1;
      bySource[ext.source || 'other'] = bySource[ext.source || 'other'] || { matched: 0, unmatched: 0 };
      bySource[ext.source || 'other'].matched += 1;
      batch.set(matchRef, {
        ownerUid: uid,
        source: ext.source || 'other',
        accountId: ext.accountId || null,
        externalDocId: ext.id,
        externalId: ext.externalId || null,
        externalRef: ext.externalRef || null,
        externalDateISO: ext.postedDateISO || null,
        externalAmountMinor: normalizeAmountMinor(ext),
        externalMerchant: ext.merchantName || ext.description || null,
        monzoDocId: best.monzo.docId,
        monzoTransactionId: best.monzo.transactionId,
        monzoDateMs: best.monzo.dateMs,
        monzoAmountMinor: best.monzo.rawAmountMinor,
        amountDiffPence: best.amountDiff,
        dateDiffDays: Number(best.dateDiffDays.toFixed(3)),
        merchantSimilarity: Number(best.similarity.toFixed(3)),
        confidence,
        status: 'matched',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(ext.ref, {
        matchedMonzoDocId: best.monzo.docId,
        matchedMonzoTransactionId: best.monzo.transactionId,
        matchConfidence: confidence,
        matchedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } else {
      unmatched += 1;
      bySource[ext.source || 'other'] = bySource[ext.source || 'other'] || { matched: 0, unmatched: 0 };
      bySource[ext.source || 'other'].unmatched += 1;
      batch.set(matchRef, {
        ownerUid: uid,
        source: ext.source || 'other',
        accountId: ext.accountId || null,
        externalDocId: ext.id,
        externalId: ext.externalId || null,
        externalRef: ext.externalRef || null,
        externalDateISO: ext.postedDateISO || null,
        externalAmountMinor: normalizeAmountMinor(ext),
        externalMerchant: ext.merchantName || ext.description || null,
        monzoDocId: null,
        monzoTransactionId: null,
        confidence: 0,
        status: 'unmatched',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      batch.set(ext.ref, {
        matchedMonzoDocId: null,
        matchedMonzoTransactionId: null,
        matchConfidence: 0,
        matchedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    ops += 2;
    if (ops >= maxBatch) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) await batch.commit();
  return { ok: true, source, windowDays, amountTolerancePence, matched, unmatched, bySource };
});

/**
 * Apply merchant categories that ALREADY EXIST to transactions that never received them.
 *
 * The single biggest cause of the uncategorised rate, and it needs no LLM at all. Two
 * collections hold merchant categories — `merchant_mappings` (the user's own rules) and
 * `monzo_ai_merchant_categories` (previous LLM results) — but both are applied only when a
 * transaction is written or when the AI sweep picks it up. The sweep works from a queue
 * that nothing refills, so historical rows never got either. On this account that was
 * 1,729 of 3,057 uncategorised transactions: 1,006 with a user rule on file and 723 with a
 * stored AI result.
 *
 * Writes `mappedCategoryKey` (a rule) rather than `userCategoryKey` (a per-transaction
 * choice), so a category chosen by hand still outranks it. Rows carrying `manualCategory`
 * are skipped entirely, for the same reason.
 */
const applyKnownMerchantCategories = httpsV2.onCall({
  region: FUNCTION_REGION,
  memory: '1GiB',
  timeoutSeconds: 540,
}, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const dryRun = req.data?.dryRun === true;
  const db = admin.firestore();

  const [txSnap, merchantSnap, aiSnap] = await Promise.all([
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
    db.collection('merchant_mappings').where('ownerUid', '==', uid).get(),
    db.collection('monzo_ai_merchant_categories').where('ownerUid', '==', uid).get(),
  ]);

  const rules = new Map();
  merchantSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const key = String(data.merchantKey || '').trim().toLowerCase();
    if (!key || !data.categoryKey) return;
    rules.set(key, {
      categoryKey: data.categoryKey,
      categoryLabel: data.categoryLabel || data.label || null,
      source: 'merchant_rule',
    });
  });
  // A stored AI result is weaker than the user's own rule, so it only fills the gaps.
  aiSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const key = String(data.merchantKey || '').trim().toLowerCase();
    if (!key || !data.aiCategoryKey || rules.has(key)) return;
    rules.set(key, {
      categoryKey: data.aiCategoryKey,
      categoryLabel: data.aiCategoryLabel || null,
      source: 'llm_stored',
    });
  });

  let updated = 0;
  let skippedManual = 0;
  let noRule = 0;
  const bySource = { merchant_rule: 0, llm_stored: 0 };
  let batch = db.batch();
  let ops = 0;

  for (const doc of txSnap.docs) {
    const data = doc.data() || {};
    // Anything already carrying a usable key is done; do not churn it.
    if (data.userCategoryKey || data.mappedCategoryKey || data.aiCategoryKey) continue;
    if (data.manualCategory === true) { skippedManual += 1; continue; }

    const key = String(data.merchantKey || '').trim().toLowerCase();
    const rule = key ? rules.get(key) : null;
    if (!rule) { noRule += 1; continue; }

    updated += 1;
    bySource[rule.source] = (bySource[rule.source] || 0) + 1;
    if (dryRun) continue;

    batch.set(doc.ref, {
      mappedCategoryKey: rule.categoryKey,
      mappedCategoryLabel: rule.categoryLabel,
      mappedCategorySource: rule.source,
      mappedCategoryAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    ops += 1;
    if (ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (!dryRun && ops > 0) await batch.commit();

  return jsonSafe({
    ok: true, dryRun, updated, bySource, skippedManual, withoutAnyRule: noRule, rulesAvailable: rules.size,
  });
});

/**
 * Propose register entries for counterparties that look like the user's own accounts.
 *
 * Read-only and advisory: it writes nothing and classifies nothing. The user confirms each
 * one by saving an account, which is what actually changes any number — a false positive
 * applied silently would delete real spend from the totals.
 */
const suggestFinanceTransferAccounts = httpsV2.onCall({
  region: FUNCTION_REGION,
  memory: '1GiB',
}, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();

  const [txSnap, potsSnap, accountsSnap, profileSnap, dismissSnap, categoriesSnap] = await Promise.all([
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_pots').where('ownerUid', '==', uid).get(),
    db.collection(LEDGER_ACCOUNTS).where('ownerUid', '==', uid).get(),
    db.collection('profiles').doc(uid).get(),
    db.collection('finance_suggestion_dismissals').doc(uid).get(),
    db.collection('finance_categories').doc(uid).get(),
  ]);

  const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
  const ownerNames = [profile.displayName, profile.name, profile.fullName]
    .filter((value) => typeof value === 'string' && value.trim().length > 2);

  const dismissed = new Set(((dismissSnap.exists ? dismissSnap.data() : {})?.transferAccounts) || []);

  const categories = mergeFinanceCategories(categoriesSnap.exists ? categoriesSnap.data() : null);
  const suggestions = suggestOwnAccountTransfers(txSnap.docs.map((d) => d.data()), {
    ownerNames,
    categoryIndex: buildCategoryIndex(categories),
    potIndex: buildPotIndex(potsSnap.docs.map((d) => d.data())),
    transferAccountIndex: buildTransferAccountIndex(accountsSnap.docs.map((d) => d.data())),
  });

  return {
    ok: true,
    ownerNames,
    suggestions: jsonSafe(suggestions.filter((item) => !dismissed.has(item.key))),
    dismissedCount: dismissed.size,
  };
});

/** Tombstone a suggestion so it stops coming back. Mirrors dismissFinanceAction. */
const dismissFinanceTransferSuggestion = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const key = String(req.data?.key || '').trim().toLowerCase();
  if (!key) throw new httpsV2.HttpsError('invalid-argument', 'key is required');

  await admin.firestore().collection('finance_suggestion_dismissals').doc(uid).set({
    ownerUid: uid,
    transferAccounts: admin.firestore.FieldValue.arrayUnion(key),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, key };
});

const recomputeDebtServiceBreakdown = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const db = admin.firestore();
  const accountId = String(req.data?.accountId || '').trim() || null;
  const config = await loadSourceConfig(db, uid, {
    accountId,
    source: accountId ? null : (req.data?.source || 'barclays'),
  });
  const { source } = config;

  const [externalSnap, monzoSnap] = await Promise.all([
    db.collection('finance_external_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
  ]);

  const sourceRows = externalSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((row) => (accountId ? row.accountId === accountId : row.source === source));

  const monthMap = {};
  const ensureMonth = (month) => {
    if (!month) return null;
    if (!monthMap[month]) {
      monthMap[month] = {
        month,
        statementSpendPence: 0,
        statementPaymentsPence: 0,
        explicitInterestPence: 0,
        refundsPence: 0,
        monzoPaymentsPence: 0,
      };
    }
    return monthMap[month];
  };

  for (const row of sourceRows) {
    const dateMs = timestampToMs(row.postedAt, row.postedDateISO);
    const month = monthKeyFromMs(dateMs);
    const entry = ensureMonth(month);
    if (!entry) continue;
    const amountMinor = normalizeAmountMinor(row);
    const absAmount = Math.abs(amountMinor);
    const description = String(row.description || row.merchantName || '');

    // Exactly one bucket per row. These used to be three independent `if`s, so an interest
    // charge landed in explicitInterest AND in statementSpend — inflating statement spend
    // and, via (monzoPayments - statementSpend), understating the interest estimate.
    switch (classifyStatementRow({ amountMinor, description, config })) {
      case 'payment': entry.statementPaymentsPence += absAmount; break;
      case 'interest': entry.explicitInterestPence += absAmount; break;
      case 'refund': entry.refundsPence += absAmount; break;
      default: entry.statementSpendPence += absAmount; break;
    }
  }

  // The provider's repayment vocabulary comes from the registered account (its name,
  // provider and any match terms the user added) and falls back to the preset, so a card
  // the user registers themselves needs no code change to be recognised.
  const isProviderPayment = buildTermMatcher(config.monzoPaymentTerms);
  for (const doc of monzoSnap.docs) {
    const data = doc.data() || {};
    const amountMinor = normalizeAmountMinor(data);
    if (amountMinor >= 0) continue;
    const text = `${data.merchant?.name || ''} ${data.counterparty?.name || ''} ${data.description || ''}`;
    if (!isProviderPayment(text)) continue;
    const dateMs = timestampToMs(data.createdAt, data.createdISO);
    const month = monthKeyFromMs(dateMs);
    const entry = ensureMonth(month);
    if (!entry) continue;
    entry.monzoPaymentsPence += Math.abs(amountMinor);
  }

  const perMonth = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => {
      // Refunds are money back on the card: they reduce what was actually consumed. They
      // were previously tallied and then never used in any derived figure.
      const netStatementSpendPence = Math.max(entry.statementSpendPence - entry.refundsPence, 0);
      const interestFromPaymentDelta = Math.max(entry.monzoPaymentsPence - netStatementSpendPence, 0);
      const estimatedInterestPence = Math.max(entry.explicitInterestPence, interestFromPaymentDelta);
      const principalRepaymentPence = Math.max(entry.monzoPaymentsPence - estimatedInterestPence, 0);
      return {
        ...entry,
        netStatementSpendPence,
        estimatedInterestPence,
        principalRepaymentPence,
      };
    });

  const totals = perMonth.reduce((acc, item) => {
    acc.statementSpendPence += item.statementSpendPence;
    acc.statementPaymentsPence += item.statementPaymentsPence;
    acc.explicitInterestPence += item.explicitInterestPence;
    acc.refundsPence += item.refundsPence;
    acc.netStatementSpendPence += item.netStatementSpendPence;
    acc.monzoPaymentsPence += item.monzoPaymentsPence;
    acc.estimatedInterestPence += item.estimatedInterestPence;
    acc.principalRepaymentPence += item.principalRepaymentPence;
    return acc;
  }, {
    statementSpendPence: 0,
    statementPaymentsPence: 0,
    explicitInterestPence: 0,
    refundsPence: 0,
    netStatementSpendPence: 0,
    monzoPaymentsPence: 0,
    estimatedInterestPence: 0,
    principalRepaymentPence: 0,
  });

  // One doc per card. The uid-keyed doc used to be the only one, so importing Halifax
  // after Barclaycard silently replaced the Barclaycard breakdown.
  const scopeKey = config.accountId || source;
  await db.collection('finance_debt_service').doc(`${uid}_${scopeKey}`).set({
    ownerUid: uid,
    source,
    accountId: config.accountId,
    accountLabel: config.label,
    perMonth,
    totals,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  // The uid-keyed doc stays as the all-cards aggregate: generateFinanceActionInsights and
  // the dashboard both read it, and debt service is a household figure, not a per-card one.
  const scopedSnap = await db.collection('finance_debt_service').where('ownerUid', '==', uid).get();
  const scopedDocs = scopedSnap.docs.filter((d) => d.id !== uid);
  const aggregateMonths = {};
  const aggregateTotals = { ...totals };
  Object.keys(aggregateTotals).forEach((key) => { aggregateTotals[key] = 0; });
  scopedDocs.forEach((d) => {
    const data = d.data() || {};
    (data.perMonth || []).forEach((item) => {
      const month = item.month;
      if (!month) return;
      if (!aggregateMonths[month]) aggregateMonths[month] = { month, ...Object.fromEntries(Object.keys(aggregateTotals).map((k) => [k, 0])) };
      Object.keys(aggregateTotals).forEach((key) => {
        aggregateMonths[month][key] += Number(item[key]) || 0;
      });
    });
    Object.keys(aggregateTotals).forEach((key) => {
      aggregateTotals[key] += Number(data.totals?.[key]) || 0;
    });
  });

  await db.collection('finance_debt_service').doc(uid).set({
    ownerUid: uid,
    source: 'all',
    sources: scopedDocs.map((d) => ({ source: d.data()?.source || null, accountId: d.data()?.accountId || null, label: d.data()?.accountLabel || null })),
    perMonth: Object.values(aggregateMonths).sort((a, b) => a.month.localeCompare(b.month)),
    totals: aggregateTotals,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, source, accountId: config.accountId, perMonth, totals };
});

const generateFinanceActionInsights = httpsV2.onCall({
  region: FUNCTION_REGION,
  secrets: [OPENROUTER_API_KEY_SECRET],
}, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const source = normalizeExternalSource(req.data?.source || 'barclays');
  const maxActions = Math.max(5, Math.min(Number(req.data?.maxActions || 12), 25));

  const db = admin.firestore();
  const RECURRENCE_WINDOW_DAYS = 200;
  const recurrenceStartISO = new Date(Date.now() - RECURRENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const [summarySnap, debtSnap, existingSnap, recentTxSnap] = await Promise.all([
    db.collection('monzo_budget_summary').doc(uid).get(),
    db.collection('finance_debt_service').doc(uid).get(),
    db.collection('finance_action_insights').doc(uid).get(),
    // Bounded read — only what the six-month recurrence test needs. Uses the
    // (ownerUid, createdISO ASC) composite index.
    db.collection('monzo_transactions')
      .where('ownerUid', '==', uid)
      .where('createdISO', '>=', recurrenceStartISO)
      .get(),
  ]);

  // Group the recent window by merchant so each candidate can be tested for
  // whether it is still actually being charged.
  const recentByMerchant = new Map();
  recentTxSnap.docs.forEach((doc) => {
    const tx = doc.data() || {};
    if (normalizeAmountMinor(tx) >= 0) return;
    const key = tx.merchantKey
      || normaliseMerchantName(tx.merchant?.name || tx.counterparty?.name || tx.description || '');
    if (!key) return;
    if (!recentByMerchant.has(key)) recentByMerchant.set(key, []);
    recentByMerchant.get(key).push(tx);
  });
  const summary = summarySnap.exists ? (summarySnap.data() || {}) : {};
  const debt = debtSnap.exists ? (debtSnap.data() || {}) : {};
  const existingActions = Array.isArray(existingSnap.data()?.actions) ? existingSnap.data().actions : [];
  const statusById = new Map(existingActions.map((action) => [action.id, action]));

  const recurring = Array.isArray(summary.recurringMerchants) ? summary.recurringMerchants : [];
  const fallbackMerchants = Array.isArray(summary.merchantSummary) ? summary.merchantSummary : [];
  const merchantCandidates = (recurring.length ? recurring : fallbackMerchants)
    .filter((m) => Number(m.totalSpend || 0) > 0)
    .slice(0, 120);

  const heuristicActions = [];
  for (const merchant of merchantCandidates) {
    const merchantKey = merchant.merchantKey || normaliseMerchantName(merchant.merchantName || 'merchant');
    const merchantName = merchant.merchantName || merchantKey;
    const months = Math.max(1, Number(merchant.months || 1));
    const totalSpend = Number(merchant.totalSpend || 0);
    const monthlySpend = totalSpend / months;
    const category = normalizeBucket(merchant.primaryCategoryType || 'optional');
    if (!Number.isFinite(monthlySpend) || monthlySpend < 8) continue;

    // Never suggest cancelling something that is no longer being charged.
    // merchant.isRecurring is an all-time flag; this is the live test.
    const activity = assessRecurringActivity(recentByMerchant.get(merchantKey) || []);
    if (!activity.isLive) continue;
    const isLiveRecurring = true;

    let type = 'review';
    if (category === 'optional' && isLiveRecurring && monthlySpend >= 20) type = 'cancel';
    else if (category === 'optional') type = 'reduce';
    else if (category === 'mandatory' && isLiveRecurring && monthlySpend >= 30) type = 'review';
    if (type === 'review' && category === 'income') continue;

    const estimatedMonthlySavings = type === 'cancel'
      ? monthlySpend
      : type === 'reduce'
        ? monthlySpend * 0.25
        : monthlySpend * 0.1;
    const confidence = type === 'cancel' ? 0.78 : type === 'reduce' ? 0.68 : 0.55;
    heuristicActions.push({
      merchantKey,
      merchantName,
      source: 'heuristic',
      type,
      title: type === 'cancel'
        ? `Cancel or pause ${merchantName}`
        : type === 'reduce'
          ? `Reduce spend with ${merchantName}`
          : `Review ${merchantName} charges`,
      reason: `~£${activity.medianAmount.toFixed(2)} every ~${Math.round(activity.medianGapDays)} days, `
        + `charged in ${activity.monthsSeen} of the last 6 months (${category} spend).`,
      estimatedMonthlySavings: Number(estimatedMonthlySavings.toFixed(2)),
      confidence,
      // Provenance for the live-recurrence test, so a wrong suggestion is diagnosable.
      recurrence: {
        monthsSeen: activity.monthsSeen,
        medianAmount: Number(activity.medianAmount.toFixed(2)),
        medianGapDays: Math.round(activity.medianGapDays),
      },
    });
  }

  const debtEstimatedInterest = Number(debt?.totals?.estimatedInterestPence || 0) / 100;
  if (debtEstimatedInterest > 0) {
    heuristicActions.push({
      merchantKey: `${source}_debt_interest`,
      merchantName: source === 'barclays' ? 'Barclays Card' : source,
      source: 'heuristic',
      type: 'debt_optimization',
      title: 'Reduce card debt servicing interest',
      reason: `Estimated interest servicing is £${debtEstimatedInterest.toFixed(2)} across tracked months.`,
      estimatedMonthlySavings: Number((debtEstimatedInterest / Math.max(1, Number(debt?.perMonth?.length || 1))).toFixed(2)),
      confidence: 0.73,
      reference: source,
    });
  }

  let llmActions = null;
  try {
    llmActions = await callGeminiActionRefinement({
      uid,
      actions: heuristicActions.map((a) => ({
        merchantKey: a.merchantKey,
        merchantName: a.merchantName,
        type: a.type,
        title: a.title,
        reason: a.reason,
        estimatedMonthlySavings: a.estimatedMonthlySavings,
        confidence: a.confidence,
      })),
    });
  } catch (err) {
    console.warn('[finance-actions] LLM refinement failed', err?.message || err);
  }

  const finalMap = new Map();
  heuristicActions.forEach((action) => {
    finalMap.set(`${action.merchantKey}|${action.type}`, action);
  });
  if (Array.isArray(llmActions)) {
    llmActions.forEach((candidate) => {
      const merchantKey = String(candidate.merchantKey || '').trim();
      const type = String(candidate.type || '').trim().toLowerCase();
      if (!merchantKey || !type) return;
      const mapKey = `${merchantKey}|${type}`;
      const fallback = finalMap.get(mapKey) || {
        merchantKey,
        merchantName: candidate.merchantName || merchantKey,
        type,
        title: candidate.title || `Review ${merchantKey}`,
        reason: candidate.reason || '',
        estimatedMonthlySavings: Number(candidate.estimatedMonthlySavings || 0) || 0,
        confidence: Number(candidate.confidence || 0.5) || 0.5,
        source: 'llm',
      };
      finalMap.set(mapKey, {
        ...fallback,
        merchantName: candidate.merchantName || fallback.merchantName,
        title: candidate.title || fallback.title,
        reason: candidate.reason || fallback.reason,
        estimatedMonthlySavings: Number(candidate.estimatedMonthlySavings || fallback.estimatedMonthlySavings || 0) || 0,
        confidence: Number(candidate.confidence || fallback.confidence || 0.5) || 0.5,
        source: 'llm',
      });
    });
  }

  // A dismissal is permanent. buildActionId hashes source|type|merchantKey||title,
  // so the same suggestion regenerates with the same id every run — previously it
  // reappeared on the next generation because only 'converted' was respected.
  const dismissedIds = new Set(
    existingActions.filter((a) => a && a.status === 'dismissed').map((a) => a.id),
  );

  const actions = Array.from(finalMap.values())
    .map((action) => ({ action, id: buildActionId(action) }))
    .filter(({ id }) => !dismissedIds.has(id))
    .sort((a, b) => (b.action.estimatedMonthlySavings || 0) - (a.action.estimatedMonthlySavings || 0))
    .slice(0, maxActions)
    .map(({ action, id }) => {
      const existing = statusById.get(id) || {};
      return {
        id,
        ...action,
        status: existing.status || 'open',
        storyId: existing.storyId || null,
        convertedAt: existing.convertedAt || null,
        generatedAt: new Date().toISOString(),
      };
    });

  // Carry dismissed entries forward in the document (not the active list) so the
  // set survives the next regeneration. Without this the tombstones are lost the
  // first time actions are regenerated and every dismissal comes back.
  const dismissedTombstones = existingActions.filter((a) => a && a.status === 'dismissed');

  await db.collection('finance_action_insights').doc(uid).set({
    ownerUid: uid,
    source,
    actions: [...actions, ...dismissedTombstones],
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    metadata: {
      candidateCount: heuristicActions.length,
      usedLlm: Array.isArray(llmActions) && llmActions.length > 0,
      maxActions,
    },
  }, { merge: true });

  return { ok: true, source, actions };
});

const convertFinanceActionToStory = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const actionId = String(req.data?.actionId || '').trim();
  if (!actionId) throw new httpsV2.HttpsError('invalid-argument', 'actionId is required');

  const db = admin.firestore();
  const insightsRef = db.collection('finance_action_insights').doc(uid);
  const insightsSnap = await insightsRef.get();
  if (!insightsSnap.exists) throw new httpsV2.HttpsError('not-found', 'Finance actions not found');
  const data = insightsSnap.data() || {};
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const idx = actions.findIndex((a) => a.id === actionId);
  if (idx < 0) throw new httpsV2.HttpsError('not-found', 'Action not found');
  const action = actions[idx];

  if (action.storyId) {
    return { ok: true, storyId: action.storyId, storyPath: `/stories/${action.storyId}`, action };
  }

  const persona = String(req.data?.persona || 'personal').trim() || 'personal';
  const goalId = req.data?.goalId ? String(req.data.goalId).trim() : null;
  const title = req.data?.title
    ? String(req.data.title).trim()
    : action.title || `Finance action: ${action.merchantName || action.merchantKey || action.id}`;
  const description = req.data?.description
    ? String(req.data.description).trim()
    : [
      action.reason || 'Finance optimization action.',
      action.estimatedMonthlySavings
        ? `Estimated monthly savings: £${Number(action.estimatedMonthlySavings).toFixed(2)}.`
        : null,
      action.merchantName ? `Merchant: ${action.merchantName}.` : null,
      action.type ? `Type: ${action.type}.` : null,
    ].filter(Boolean).join(' ');

  const storyRef = await db.collection('stories').add({
    ref: `FIN-${Date.now()}`,
    ownerUid: uid,
    persona,
    title,
    description,
    goalId: goalId || null,
    sprintId: null,
    status: 0,
    priority: 2,
    points: 2,
    theme: 3,
    orderIndex: Date.now(),
    tags: ['finance', 'action'],
    acceptanceCriteria: [],
    source: 'finance_action_insight',
    financeActionId: actionId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const updatedActions = [...actions];
  updatedActions[idx] = {
    ...action,
    status: 'converted',
    storyId: storyRef.id,
    convertedAt: new Date().toISOString(),
  };
  await insightsRef.set({
    ownerUid: uid,
    actions: updatedActions,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    storyId: storyRef.id,
    storyPath: `/stories/${storyRef.id}`,
    action: updatedActions[idx],
  };
});

/**
 * Dismiss a finance action for good.
 *
 * Writes status 'dismissed' rather than removing the entry, because
 * generateFinanceActionInsights reads those entries back as tombstones and skips
 * regenerating them. Deleting the row would make the suggestion return on the
 * next run.
 */
const dismissFinanceAction = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const actionId = String(req.data?.actionId || '').trim();
  if (!actionId) throw new httpsV2.HttpsError('invalid-argument', 'actionId is required');
  const undo = req.data?.undo === true;

  const db = admin.firestore();
  const ref = db.collection('finance_action_insights').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new httpsV2.HttpsError('not-found', 'No finance actions for this user');

  const data = snap.data() || {};
  if (data.ownerUid && data.ownerUid !== uid) {
    throw new httpsV2.HttpsError('permission-denied', 'Not your finance actions');
  }

  const current = Array.isArray(data.actions) ? data.actions : [];
  let found = false;
  const next = current.map((action) => {
    if (!action || action.id !== actionId) return action;
    found = true;
    return {
      ...action,
      status: undo ? 'open' : 'dismissed',
      dismissedAt: undo ? null : new Date().toISOString(),
    };
  });
  if (!found) throw new httpsV2.HttpsError('not-found', 'Action not found');

  await ref.set({
    actions: next,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, actionId, status: undo ? 'open' : 'dismissed' };
});

const upsertManualFinanceAccount = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const name = String(req.data?.name || '').trim();
  if (!name) throw new httpsV2.HttpsError('invalid-argument', 'name is required');

  const type = normalizeManualAccountType(req.data?.type);
  const institution = String(req.data?.institution || '').trim() || null;
  const notes = String(req.data?.notes || '').trim() || null;
  const currency = String(req.data?.currency || 'GBP').trim().toUpperCase() || 'GBP';
  const accountIdRaw = String(req.data?.accountId || '').trim();
  const balancePenceRaw = req.data?.balancePence;
  const balanceRaw = req.data?.balance;
  let balancePence = 0;
  if (Number.isFinite(Number(balancePenceRaw))) balancePence = Math.round(Number(balancePenceRaw));
  else if (Number.isFinite(Number(balanceRaw))) balancePence = Math.round(Number(balanceRaw) * 100);

  const db = admin.firestore();
  const accountId = accountIdRaw || `${uid}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const ref = db.collection('finance_manual_accounts').doc(accountId);
  const existing = await ref.get();
  if (existing.exists && existing.data()?.ownerUid !== uid) {
    throw new httpsV2.HttpsError('permission-denied', 'Not your account record');
  }

  const payload = {
    ownerUid: uid,
    accountId,
    name,
    type,
    institution,
    notes,
    currency,
    balancePence,
    balance: balancePence / 100,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
  };
  if (!existing.exists) payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
  await ref.set(payload, { merge: true });

  return {
    ok: true,
    account: {
      accountId,
      name,
      type,
      institution,
      notes,
      currency,
      balancePence,
      balance: balancePence / 100,
      updatedAtMs: payload.updatedAtMs,
    },
  };
});

const deleteManualFinanceAccount = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const accountId = String(req.data?.accountId || '').trim();
  if (!accountId) throw new httpsV2.HttpsError('invalid-argument', 'accountId is required');

  const db = admin.firestore();
  const ref = db.collection('finance_manual_accounts').doc(accountId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: true, deleted: false };
  if (snap.data()?.ownerUid !== uid) throw new httpsV2.HttpsError('permission-denied', 'Not your account record');
  await ref.delete();
  return { ok: true, deleted: true, accountId };
});

// memory: reads every monzo_transactions doc (deliberately — the coverage stats
// and trailing comparisons span all history). At 8,471 documents that blew the
// 256MiB default, which is what surfaced as a bare "internal" on the finance
// dashboard. Confirmed in the logs as 'Memory limit of 256 MiB exceeded'.
const fetchFinanceEnhancementData = httpsV2.onCall({ region: FUNCTION_REGION, memory: '1GiB' }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const startMs = Date.parse(String(req.data?.startDate || '2018-01-01T00:00:00.000Z'));
  const endMs = Date.parse(String(req.data?.endDate || new Date().toISOString()));
  const rangeStartMs = Number.isFinite(startMs) ? startMs : Date.parse('2018-01-01T00:00:00.000Z');
  const rangeEndMs = Number.isFinite(endMs) ? endMs : Date.now();
  const nowMs = Date.now();

  const db = admin.firestore();
  const [
    monzoSnap,
    summarySnap,
    externalSnap,
    matchesSnap,
    debtSnap,
    actionsSnap,
    budgetV2Snap,
    budgetLegacySnap,
    categoriesSnap,
    goalsSnap,
    potsSnap,
    manualAccountsSnap,
  ] = await Promise.all([
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_budget_summary').doc(uid).get(),
    db.collection('finance_external_transactions').where('ownerUid', '==', uid).get(),
    db.collection('finance_transaction_matches').where('ownerUid', '==', uid).get(),
    db.collection('finance_debt_service').doc(uid).get(),
    db.collection('finance_action_insights').doc(uid).get(),
    db.collection('finance_budgets_v2').doc(uid).get(),
    db.collection('finance_budgets').doc(uid).get(),
    db.collection('finance_categories').doc(uid).get(),
    db.collection('goals').where('ownerUid', '==', uid).get(),
    db.collection('monzo_pots').where('ownerUid', '==', uid).get(),
    db.collection('finance_manual_accounts').where('ownerUid', '==', uid).get(),
  ]);

  // Merged before the transaction loop because the bucket resolver needs it to
  // turn a userCategoryKey/aiCategoryKey into a bucket.
  const categoriesMerged = mergeFinanceCategories(
    Array.isArray(categoriesSnap.data()?.categories) ? categoriesSnap.data().categories : []
  );
  const categoryIndex = buildCategoryIndex(categoriesMerged);

  const monthly = {};
  // Income / outflow / pot accumulators for the flow Sankey (see the loop below).
  const flowIncome = {};
  const flowOutflow = {};
  const flowPots = {};
  const flowTotals = { incomePence: 0, outflowPence: 0, potTransferPence: 0 };
  const potIndex = new Map(
    potsSnap.docs.map((d) => [String((d.data() || {}).potId), (d.data() || {}).name || 'Pot'])
  );
  const optionalMerchants = new Map();
  const categorySpendInRange = {};
  const analysisRows = [];
  const potContributionMap = new Map();
  let coverageStartMs = null;
  let coverageEndMs = null;
  let inRangeCount = 0;

  const ensureMonth = (month) => {
    if (!month) return null;
    if (!monthly[month]) {
      monthly[month] = {
        month,
        inflowPence: 0,
        outflowPence: 0,
        netPence: 0,
        mandatoryPence: 0,
        optionalPence: 0,
        savingsPence: 0,
        incomePence: 0,
        totalSpendPence: 0,
      };
    }
    return monthly[month];
  };

  monzoSnap.docs.forEach((doc) => {
    const data = doc.data() || {};
    const dateMs = timestampToMs(data.createdAt, data.createdISO);
    if (!dateMs) return;
    coverageStartMs = coverageStartMs === null ? dateMs : Math.min(coverageStartMs, dateMs);
    coverageEndMs = coverageEndMs === null ? dateMs : Math.max(coverageEndMs, dateMs);

    const amountMinor = normalizeAmountMinor(data);
    const resolved = resolveTransactionCategory(data, { categoryIndex });
    const bucket = normalizeBucket(resolved.bucket);
    const categoryKey = resolved.categoryKey;
    const categoryLabel = resolved.categoryLabel;
    const merchantName = data.merchant?.name || data.counterparty?.name || data.description || 'Unknown';
    const merchantKey = data.merchantKey || normaliseMerchantName(merchantName);
    const month = monthKeyFromMs(dateMs);
    const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata : {};
    const destinationPotId = metadata.destination_pot_id || metadata.pot_id || null;
    const sourcePotId = metadata.source_pot_id || null;

    const applyPotContribution = (potId, deltaPence) => {
      if (!potId || !Number.isFinite(deltaPence) || deltaPence === 0) return;
      if (!potContributionMap.has(potId)) {
        potContributionMap.set(potId, {
          potId,
          totalInPence: 0,
          totalOutPence: 0,
          netContributionPence: 0,
          monthNet: {},
        });
      }
      const entry = potContributionMap.get(potId);
      if (deltaPence > 0) entry.totalInPence += deltaPence;
      else entry.totalOutPence += Math.abs(deltaPence);
      entry.netContributionPence += deltaPence;
      if (month) {
        entry.monthNet[month] = (entry.monthNet[month] || 0) + deltaPence;
      }
    };

    // Pot transfer metadata is used for goal contribution forecasting.
    if (destinationPotId) {
      const inPence = amountMinor < 0 ? Math.abs(amountMinor) : Math.abs(amountMinor);
      applyPotContribution(destinationPotId, inPence);
    }
    if (sourcePotId) {
      const outPence = amountMinor > 0 ? Math.abs(amountMinor) : Math.abs(amountMinor);
      applyPotContribution(sourcePotId, -outPence);
    }

    if (dateMs < rangeStartMs || dateMs > rangeEndMs) return;
    inRangeCount += 1;

    // Full-flow model for the income Sankey.
    //
    // analysisRows below deliberately drops income (`bucket !== 'income'`) and the
    // guard after this drops transfers, so neither is available to chart. Money
    // moved into a pot is not spend, but it is absolutely part of "where did it all
    // go" — leaving it out is why the old diagram could only show the spend half.
    const flowAmount = Math.abs(amountMinor);
    if (flowAmount > 0) {
      if (destinationPotId || sourcePotId) {
        const potId = destinationPotId || sourcePotId;
        const potName = potIndex.get(String(potId)) || 'Savings pot';
        // Only money moving INTO a pot is a destination; withdrawals are a return
        // of funds and would double-count against income.
        if (destinationPotId && amountMinor < 0) {
          flowPots[potName] = (flowPots[potName] || 0) + flowAmount;
          flowTotals.potTransferPence += flowAmount;
        }
      } else if (amountMinor > 0) {
        const key = resolved.categoryKey || 'other_income';
        if (!flowIncome[key]) flowIncome[key] = { key, label: categoryLabel || key, pence: 0 };
        flowIncome[key].pence += flowAmount;
        flowTotals.incomePence += flowAmount;
      } else if (bucket !== 'unknown') {
        const k = `${bucket}||${categoryKey}`;
        if (!flowOutflow[k]) {
          flowOutflow[k] = { bucket, categoryKey, categoryLabel: categoryLabel || categoryKey, pence: 0 };
        }
        flowOutflow[k].pence += flowAmount;
        flowTotals.outflowPence += flowAmount;
      }
    }

    if (bucket === 'bank_transfer' || bucket === 'unknown') return;

    const entry = ensureMonth(month);
    if (!entry) return;
    if (amountMinor >= 0) {
      entry.inflowPence += amountMinor;
      entry.incomePence += amountMinor;
    } else {
      const spend = Math.abs(amountMinor);
      entry.outflowPence += spend;
      entry.totalSpendPence += spend;
      categorySpendInRange[categoryKey] = (categorySpendInRange[categoryKey] || 0) + spend;
      if (bucket === 'mandatory') entry.mandatoryPence += spend;
      else if (bucket === 'optional') entry.optionalPence += spend;
      else if (bucket === 'savings') entry.savingsPence += spend;

      if (bucket === 'optional') {
        if (!optionalMerchants.has(merchantKey)) {
          optionalMerchants.set(merchantKey, {
            merchantKey,
            merchantName,
            totalSpendPence: 0,
            transactions: 0,
            months: new Set(),
          });
        }
        const item = optionalMerchants.get(merchantKey);
        item.totalSpendPence += spend;
        item.transactions += 1;
        if (month) item.months.add(month);
      }

      if (bucket !== 'income') {
        analysisRows.push({
          id: data.transactionId || doc.id,
          dateISO: new Date(dateMs).toISOString(),
          month: month || 'unknown',
          bucket,
          categoryKey,
          categoryLabel,
          merchantName,
          merchantKey,
          amountPence: spend,
          isSubscription: !!data.isSubscription,
        });
      }
    }
    entry.netPence = entry.inflowPence - entry.outflowPence;
  });

  const spendTrackingSeries = Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
  const cashflowSeries = spendTrackingSeries.map((m) => ({
    month: m.month,
    inflowPence: m.inflowPence,
    outflowPence: m.outflowPence,
    netPence: m.netPence,
  }));

  const optionalSpendCards = Array.from(optionalMerchants.values())
    .map((item) => {
      const monthCount = Math.max(1, item.months.size);
      return {
        merchantKey: item.merchantKey,
        merchantName: item.merchantName,
        totalSpendPence: item.totalSpendPence,
        avgMonthlySpendPence: Math.round(item.totalSpendPence / monthCount),
        transactions: item.transactions,
        activeMonths: item.months.size,
        recurring: item.months.size >= 2,
      };
    })
    .sort((a, b) => b.avgMonthlySpendPence - a.avgMonthlySpendPence)
    .slice(0, 24);

  // categoriesMerged is built above, before the transaction loop that needs it.
  const categoryMeta = new Map();
  categoriesMerged.forEach((category) => {
    if (!category?.key) return;
    categoryMeta.set(category.key, {
      key: category.key,
      label: category.label || category.key,
      bucket: normalizeBucket(category.bucket || 'unknown'),
    });
  });

  const budgetV2 = budgetV2Snap.exists ? (budgetV2Snap.data() || {}) : {};
  const budgetLegacy = budgetLegacySnap.exists ? (budgetLegacySnap.data() || {}) : {};
  const mode = String(budgetV2.mode || 'percentage');
  const monthlyIncomePence = Math.max(0, Math.round(Number(budgetV2.monthlyIncome || budgetLegacy.monthlyIncome || 0) * 100));
  const categoryBudgets = budgetV2.categoryBudgets && typeof budgetV2.categoryBudgets === 'object'
    ? budgetV2.categoryBudgets
    : {};
  const legacyByCategory = budgetLegacy.byCategory && typeof budgetLegacy.byCategory === 'object'
    ? budgetLegacy.byCategory
    : {};

  const categoryBudgetRows = [];
  const pushCategoryBudget = (categoryKey, amountPence, sourceLabel) => {
    if (!categoryKey || !Number.isFinite(amountPence) || amountPence <= 0) return;
    const meta = categoryMeta.get(categoryKey) || {
      key: categoryKey,
      label: categoryKey,
      bucket: normalizeBucket('unknown'),
    };
    const actualPence = Number(categorySpendInRange[categoryKey] || 0);
    const utilizationPct = amountPence > 0 ? Number(((actualPence / amountPence) * 100).toFixed(2)) : 0;
    categoryBudgetRows.push({
      categoryKey,
      categoryLabel: meta.label,
      bucket: meta.bucket,
      budgetPence: Math.round(amountPence),
      actualPence,
      variancePence: Math.round(amountPence - actualPence),
      utilizationPct,
      source: sourceLabel,
    });
  };

  Object.entries(categoryBudgets).forEach(([categoryKey, value]) => {
    const amountRaw = Number(value?.amount);
    const percentRaw = Number(value?.percent);
    let amountPence = Number.isFinite(amountRaw) ? Math.round(amountRaw) : 0;
    if (!amountPence && Number.isFinite(percentRaw) && percentRaw > 0 && monthlyIncomePence > 0) {
      amountPence = Math.round((percentRaw / 100) * monthlyIncomePence);
    }
    pushCategoryBudget(categoryKey, amountPence, 'v2');
  });

  if (!categoryBudgetRows.length) {
    Object.entries(legacyByCategory).forEach(([categoryKey, value]) => {
      const amountPounds = Number(value || 0);
      if (!Number.isFinite(amountPounds) || amountPounds <= 0) return;
      pushCategoryBudget(categoryKey, Math.round(amountPounds * 100), 'legacy');
    });
  }

  const budgetByBucketMap = {};
  categoryBudgetRows.forEach((row) => {
    const bucket = row.bucket || 'unknown';
    if (!budgetByBucketMap[bucket]) {
      budgetByBucketMap[bucket] = {
        bucket,
        budgetPence: 0,
        actualPence: 0,
        variancePence: 0,
        utilizationPct: 0,
      };
    }
    budgetByBucketMap[bucket].budgetPence += row.budgetPence;
    budgetByBucketMap[bucket].actualPence += row.actualPence;
  });
  Object.values(budgetByBucketMap).forEach((row) => {
    row.variancePence = row.budgetPence - row.actualPence;
    row.utilizationPct = row.budgetPence > 0 ? Number(((row.actualPence / row.budgetPence) * 100).toFixed(2)) : 0;
  });

  const monthlyBudgetPence = categoryBudgetRows.reduce((sum, row) => sum + row.budgetPence, 0);
  const totalActualPence = categoryBudgetRows.reduce((sum, row) => sum + row.actualPence, 0);

  /**
   * Budgets are set PER MONTH; actuals are summed over the selected range. Comparing them
   * directly reported 217% on a 90-day view and 1,425% on all history — a utilisation
   * figure that said nothing about overspending, only about how long the window was.
   * Scale the budget to the window instead, and expose the factor so the UI can say so.
   */
  const rangeMonths = Math.max(1, (rangeEndMs - rangeStartMs) / (365.25 / 12 * 24 * 60 * 60 * 1000));
  const totalBudgetPence = Math.round(monthlyBudgetPence * rangeMonths);
  const budgetHealth = {
    mode,
    monthlyIncomePence,
    monthlyBudgetPence,
    rangeMonths: Number(rangeMonths.toFixed(2)),
    totalBudgetPence,
    totalActualPence,
    variancePence: totalBudgetPence - totalActualPence,
    utilizationPct: totalBudgetPence > 0 ? Number(((totalActualPence / totalBudgetPence) * 100).toFixed(2)) : 0,
    byCategory: categoryBudgetRows.sort((a, b) => b.actualPence - a.actualPence),
    byBucket: Object.values(budgetByBucketMap).sort((a, b) => b.actualPence - a.actualPence),
  };

  const externalSummaryBySource = {};
  externalSnap.docs.forEach((doc) => {
    const row = doc.data() || {};
    const source = normalizeExternalSource(row.source || 'other');
    if (!externalSummaryBySource[source]) {
      externalSummaryBySource[source] = {
        source,
        rows: 0,
        spendPence: 0,
        inflowPence: 0,
        firstDateISO: null,
        lastDateISO: null,
      };
    }
    const entry = externalSummaryBySource[source];
    entry.rows += 1;
    const amountMinor = normalizeAmountMinor(row);
    if (amountMinor < 0) entry.spendPence += Math.abs(amountMinor);
    if (amountMinor > 0) entry.inflowPence += amountMinor;
    const dateMs = timestampToMs(row.postedAt, row.postedDateISO);
    if (dateMs) {
      const iso = new Date(dateMs).toISOString();
      if (!entry.firstDateISO || iso < entry.firstDateISO) entry.firstDateISO = iso;
      if (!entry.lastDateISO || iso > entry.lastDateISO) entry.lastDateISO = iso;
    }
  });

  const matchSummaryBySource = {};
  matchesSnap.docs.forEach((doc) => {
    const row = doc.data() || {};
    const source = normalizeExternalSource(row.source || 'other');
    if (!matchSummaryBySource[source]) {
      matchSummaryBySource[source] = { source, matched: 0, unmatched: 0 };
    }
    if (row.status === 'matched') matchSummaryBySource[source].matched += 1;
    else matchSummaryBySource[source].unmatched += 1;
  });

  const actions = Array.isArray(actionsSnap.data()?.actions) ? actionsSnap.data().actions : [];
  const openActions = actions.filter((a) => (a.status || 'open') !== 'converted');
  const summaryDoc = summarySnap.exists ? (summarySnap.data() || {}) : {};
  const debtDoc = debtSnap.exists ? (debtSnap.data() || {}) : null;

  const potById = new Map();
  potsSnap.docs.forEach((doc) => {
    const row = doc.data() || {};
    const potId = row.potId || doc.id;
    if (!potId) return;
    potById.set(potId, {
      potId,
      name: row.name || potId,
      balancePence: Number(row.balance || 0),
      currency: row.currency || 'GBP',
      updatedAtMs: timestampToMs(row.updatedAt, row.updatedAtISO),
    });
  });

  const goalForecasts = goalsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((goal) => Number(goal.status || 0) !== 2)
    .map((goal) => {
      const linkedPotId = String(goal.linkedPotId || goal.potId || '').trim();
      const linkedPot = linkedPotId ? potById.get(linkedPotId) : null;
      const targetAmountRaw = Number(goal.estimatedCost || 0);
      const targetAmountPence = Number.isFinite(targetAmountRaw) && targetAmountRaw > 0 ? Math.round(targetAmountRaw * 100) : 0;
      const currentBalancePence = Number(linkedPot?.balancePence || 0);
      const remainingPence = Math.max(targetAmountPence - currentBalancePence, 0);
      const contribution = linkedPotId ? (potContributionMap.get(linkedPotId) || null) : null;
      const contributionMonths = contribution ? Object.keys(contribution.monthNet || {}).sort() : [];
      const rollingMonths = contributionMonths.slice(-6);
      const rollingValues = rollingMonths.map((monthKey) => Number(contribution.monthNet[monthKey] || 0));
      const monthlyContributionPence = rollingValues.length
        ? Math.round(rollingValues.reduce((sum, value) => sum + value, 0) / rollingValues.length)
        : 0;
      const etaMonths = remainingPence > 0 && monthlyContributionPence > 0
        ? Math.ceil(remainingPence / monthlyContributionPence)
        : null;
      const etaDateISO = etaMonths ? new Date(nowMs + (etaMonths * 30 * DAY_MS)).toISOString() : null;
      const progressPct = targetAmountPence > 0
        ? Number((Math.min(currentBalancePence / targetAmountPence, 1) * 100).toFixed(2))
        : null;

      return {
        goalId: goal.id,
        goalTitle: goal.title || goal.name || goal.id,
        linkedPotId: linkedPotId || null,
        linkedPotName: linkedPot?.name || null,
        targetAmountPence,
        currentBalancePence,
        remainingPence,
        progressPct,
        monthlyContributionPence,
        etaMonths,
        etaDateISO,
        contributionMonths: rollingMonths,
        contributionSampleSize: rollingValues.length,
      };
    })
    .sort((a, b) => (b.remainingPence || 0) - (a.remainingPence || 0));

  const manualAccounts = manualAccountsSnap.docs
    .map((doc) => {
      const row = doc.data() || {};
      const balancePence = Number.isFinite(Number(row.balancePence))
        ? Math.round(Number(row.balancePence))
        : Math.round(Number(row.balance || 0) * 100);
      const updatedAtMs = timestampToMs(row.updatedAt, row.updatedAtISO) || Number(row.updatedAtMs || 0) || null;
      const staleDays = updatedAtMs ? Math.floor((nowMs - updatedAtMs) / DAY_MS) : null;
      const type = normalizeManualAccountType(row.type);
      return {
        accountId: row.accountId || doc.id,
        name: row.name || 'Account',
        institution: row.institution || null,
        type,
        currency: row.currency || 'GBP',
        balancePence,
        balance: balancePence / 100,
        notes: row.notes || null,
        updatedAtMs,
        updatedAtISO: updatedAtMs ? new Date(updatedAtMs).toISOString() : null,
        staleDays,
        isStale: staleDays === null || staleDays > 30,
      };
    })
    .sort((a, b) => (a.type === 'debt' ? 1 : 0) - (b.type === 'debt' ? 1 : 0));

  const manualAccountSummary = manualAccounts.reduce((acc, account) => {
    const absBalance = Math.abs(Number(account.balancePence || 0));
    if (account.type === 'debt') acc.totalDebtPence += absBalance;
    else acc.totalAssetPence += absBalance;
    if (account.isStale) acc.staleCount += 1;
    return acc;
  }, { totalAssetPence: 0, totalDebtPence: 0, staleCount: 0, netWorthPence: 0 });
  manualAccountSummary.netWorthPence = manualAccountSummary.totalAssetPence - manualAccountSummary.totalDebtPence;

  return {
    ok: true,
    range: {
      startDateISO: new Date(rangeStartMs).toISOString(),
      endDateISO: new Date(rangeEndMs).toISOString(),
    },
    // Whole-picture flow: income sources in, everything they fund out, including
    // money moved into pots. Aggregated server-side rather than shipping every
    // row, since the client only ever draws totals.
    financeFlow: {
      income: Object.values(flowIncome).sort((a, b) => b.pence - a.pence),
      outflow: Object.values(flowOutflow).sort((a, b) => b.pence - a.pence),
      pots: Object.entries(flowPots)
        .map(([name, pence]) => ({ name, pence }))
        .sort((a, b) => b.pence - a.pence),
      totals: {
        ...flowTotals,
        // What is left after outflows and pot transfers — negative means the
        // period was funded from savings or an earlier balance.
        unallocatedPence: flowTotals.incomePence - flowTotals.outflowPence - flowTotals.potTransferPence,
      },
    },
    coverage: {
      monzoCoverageStartISO: coverageStartMs ? new Date(coverageStartMs).toISOString() : null,
      monzoCoverageEndISO: coverageEndMs ? new Date(coverageEndMs).toISOString() : null,
      monzoTransactionsInRange: inRangeCount,
      monzoTransactionsTotal: monzoSnap.size,
    },
    spendTrackingSeries,
    cashflowSeries,
    analysisRows: analysisRows
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
      .slice(-25_000),
    optionalSpendCards,
    budgetHealth,
    goalForecasts,
    externalSummary: Object.values(externalSummaryBySource).sort((a, b) => a.source.localeCompare(b.source)),
    matchSummary: Object.values(matchSummaryBySource).sort((a, b) => a.source.localeCompare(b.source)),
    debtService: debtDoc,
    actions: openActions,
    allActions: actions,
    manualAccounts,
    manualAccountSummary,
    recurringMerchants: Array.isArray(summaryDoc.recurringMerchants) ? summaryDoc.recurringMerchants : [],
    topMerchants: Array.isArray(summaryDoc.allMerchants) ? summaryDoc.allMerchants.slice(0, 50) : [],
    updatedAtISO: new Date().toISOString(),
  };
});

module.exports = {
  assessRecurringActivity,
  applyKnownMerchantCategories,
  suggestFinanceTransferAccounts,
  dismissFinanceTransferSuggestion,
  importExternalFinanceTransactions,
  importMonzoTransactionsCsv,
  matchExternalToMonzoTransactions,
  recomputeDebtServiceBreakdown,
  generateFinanceActionInsights,
  convertFinanceActionToStory,
  dismissFinanceAction,
  upsertManualFinanceAccount,
  deleteManualFinanceAccount,
  fetchFinanceEnhancementData,
};
