const httpsV2 = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { normaliseMerchantName, inferDefaultCategoryType, inferDefaultCategoryLabel } = require('../monzo/shared');
const { mergeFinanceCategories } = require('./categories');

const GOOGLE_AI_STUDIO_API_KEY = defineSecret('GOOGLEAISTUDIOAPIKEY');
const FUNCTION_REGION = 'europe-west2';
const EXTERNAL_SOURCES = new Set(['barclays', 'paypal', 'other']);
const MANUAL_ACCOUNT_TYPES = new Set(['asset', 'debt', 'investment', 'cash', 'savings']);
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeExternalSource(raw) {
  const source = String(raw || 'other').trim().toLowerCase();
  if (source === 'barclaycard' || source === 'barclay') return 'barclays';
  if (source === 'pay_pal') return 'paypal';
  if (EXTERNAL_SOURCES.has(source)) return source;
  return 'other';
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

  const result = [];
  dataRows.forEach((row, index) => {
    if (!row || !row.length) return;
    const dateRaw = dateIdx >= 0 ? row[dateIdx] : row[0];
    const dateMs = parseDateMs(dateRaw);
    if (!dateMs) return;

    let amountMinor = null;
    const debitMinor = debitIdx >= 0 ? parseMoneyMinor(row[debitIdx]) : null;
    const creditMinor = creditIdx >= 0 ? parseMoneyMinor(row[creditIdx]) : null;
    const amountMinorRaw = amountIdx >= 0 ? parseMoneyMinor(row[amountIdx]) : null;
    if (Number.isFinite(debitMinor) && debitMinor !== 0) amountMinor = -Math.abs(debitMinor);
    else if (Number.isFinite(creditMinor) && creditMinor !== 0) amountMinor = Math.abs(creditMinor);
    else if (Number.isFinite(amountMinorRaw)) amountMinor = amountMinorRaw;
    if (!Number.isFinite(amountMinor) || amountMinor === 0) return;

    const description = String(descIdx >= 0 ? row[descIdx] : row[1] || row[0] || '').trim();
    const descLower = description.toLowerCase();
    if ((source === 'barclays' || source === 'paypal') && amountMinor > 0) {
      const keepPositive = /refund|reversal|credit|cashback|payment received|deposit|received/.test(descLower);
      if (!keepPositive) amountMinor = -Math.abs(amountMinor);
    }

    const merchantName = description.split(/[-*|]/)[0].trim() || description || `${source}-${index + 1}`;
    const merchantKey = normaliseMerchantName(merchantName);
    const externalRef = idIdx >= 0 ? String(row[idIdx] || '').trim() : '';
    const fingerprint = `${source}|${externalRef || `${dateMs}|${amountMinor}|${description}|${index}`}`;
    const externalId = crypto.createHash('sha1').update(fingerprint).digest('hex').slice(0, 24);
    result.push({
      source,
      externalId,
      externalRef: externalRef || null,
      postedDateISO: new Date(dateMs).toISOString(),
      postedDateMs: dateMs,
      amountMinor,
      amount: amountMinor / 100,
      currency: 'GBP',
      description: description || merchantName,
      merchantName,
      merchantKey,
      rawRow: row,
    });
  });
  return result;
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
    .filter((v) => v && !['the', 'and', 'ltd', 'limited', 'plc', 'payment', 'card'].includes(v));
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

function normalizeBucket(bucketRaw) {
  const bucket = String(bucketRaw || '').toLowerCase();
  if (!bucket) return 'unknown';
  if (bucket === 'discretionary') return 'optional';
  if (bucket.includes('saving') || bucket === 'investment') return 'savings';
  if (bucket === 'net_salary' || bucket === 'irregular_income') return 'income';
  if (bucket === 'debt_repayment') return 'mandatory';
  return bucket;
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
  const apiKey = process.env.GOOGLEAISTUDIOAPIKEY || process.env.GOOGLE_AI_STUDIO_API_KEY || '';
  if (!apiKey || !actions.length) return null;
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });
  const prompt = [
    'You are a personal finance optimization assistant.',
    'Given these action candidates, return JSON only in the shape:',
    '{"actions":[{"merchantKey":"string","type":"cancel|reduce|review|debt_optimization","title":"string","reason":"string","estimatedMonthlySavings":number,"confidence":0-1}]}',
    'Keep at most 12 actions. Be conservative and practical.',
    `Candidates: ${JSON.stringify(actions.slice(0, 40))}`,
  ].join('\n');
  const result = await model.generateContent(prompt);
  const text = result?.response?.text?.() || '';
  const parsed = extractJson(text);
  const list = Array.isArray(parsed?.actions) ? parsed.actions : [];
  if (!list.length) return null;
  return list;
}

const importExternalFinanceTransactions = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const source = normalizeExternalSource(req.data?.source);
  const csvText = String(req.data?.csv || '').trim();
  if (!csvText) throw new httpsV2.HttpsError('invalid-argument', 'csv is required');

  const parsedRows = buildExternalRowsFromCsv(csvText, source);
  if (!parsedRows.length) {
    return { ok: true, source, parsed: 0, upserted: 0, skipped: 0, message: 'No valid rows detected in CSV.' };
  }

  const db = admin.firestore();
  let batch = db.batch();
  let ops = 0;
  let upserted = 0;
  const maxBatch = 400;

  for (const row of parsedRows) {
    const docRef = db.collection('finance_external_transactions').doc(`${uid}_${source}_${row.externalId}`);
    batch.set(docRef, {
      ownerUid: uid,
      source,
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
  const source = req.data?.source ? normalizeExternalSource(req.data?.source) : null;
  const windowDays = Math.max(1, Math.min(Number(req.data?.windowDays || 5), 30));
  const amountTolerancePence = Math.max(1, Math.min(Number(req.data?.amountTolerancePence || 150), 2_000));

  const db = admin.firestore();
  const [externalSnap, monzoSnap] = await Promise.all([
    db.collection('finance_external_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
  ]);

  const externalRows = externalSnap.docs
    .map((d) => ({ id: d.id, ref: d.ref, ...(d.data() || {}) }))
    .filter((row) => !source || row.source === source);
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

  for (const ext of externalRows) {
    const extDateMs = timestampToMs(ext.postedAt, ext.postedDateISO);
    const extAmountMinor = Math.abs(normalizeAmountMinor(ext));
    const extTokens = tokenize(`${ext.merchantName || ''} ${ext.description || ''}`);
    if (!extDateMs || !extAmountMinor) continue;

    let best = null;
    for (const monzo of monzoRows) {
      if (usedMonzo.has(monzo.docId)) continue;
      const amountDiff = Math.abs(monzo.amountMinor - extAmountMinor);
      if (amountDiff > amountTolerancePence) continue;
      const dateDiffDays = Math.abs(monzo.dateMs - extDateMs) / DAY_MS;
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

const recomputeDebtServiceBreakdown = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const source = normalizeExternalSource(req.data?.source || 'barclays');
  const db = admin.firestore();

  const [externalSnap, monzoSnap] = await Promise.all([
    db.collection('finance_external_transactions').where('ownerUid', '==', uid).get(),
    db.collection('monzo_transactions').where('ownerUid', '==', uid).get(),
  ]);

  const sourceRows = externalSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() || {}) }))
    .filter((row) => row.source === source);

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
    const desc = String(row.description || row.merchantName || '').toLowerCase();
    const isInterest = /interest|finance charge|service charge|late fee|fee charge/.test(desc);
    const isRefund = /refund|chargeback|reversal|dispute|credit/.test(desc);
    const isPayment = /payment|direct debit|dd payment|balance transfer|paid/.test(desc) || amountMinor > 0;

    if (isInterest) entry.explicitInterestPence += absAmount;
    if (isRefund) entry.refundsPence += absAmount;
    if (isPayment) entry.statementPaymentsPence += absAmount;
    if (amountMinor < 0 && !isPayment && !isRefund) entry.statementSpendPence += absAmount;
  }

  const paymentRegex = source === 'paypal'
    ? /paypal/i
    : /barclay|barclays|barclaycard/i;
  for (const doc of monzoSnap.docs) {
    const data = doc.data() || {};
    const amountMinor = normalizeAmountMinor(data);
    if (amountMinor >= 0) continue;
    const text = `${data.merchant?.name || ''} ${data.counterparty?.name || ''} ${data.description || ''}`.toLowerCase();
    if (!paymentRegex.test(text)) continue;
    const dateMs = timestampToMs(data.createdAt, data.createdISO);
    const month = monthKeyFromMs(dateMs);
    const entry = ensureMonth(month);
    if (!entry) continue;
    entry.monzoPaymentsPence += Math.abs(amountMinor);
  }

  const perMonth = Object.values(monthMap)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((entry) => {
      const interestFromPaymentDelta = Math.max(entry.monzoPaymentsPence - entry.statementSpendPence, 0);
      const estimatedInterestPence = Math.max(entry.explicitInterestPence, interestFromPaymentDelta);
      const principalRepaymentPence = Math.max(entry.monzoPaymentsPence - estimatedInterestPence, 0);
      return {
        ...entry,
        estimatedInterestPence,
        principalRepaymentPence,
      };
    });

  const totals = perMonth.reduce((acc, item) => {
    acc.statementSpendPence += item.statementSpendPence;
    acc.statementPaymentsPence += item.statementPaymentsPence;
    acc.explicitInterestPence += item.explicitInterestPence;
    acc.refundsPence += item.refundsPence;
    acc.monzoPaymentsPence += item.monzoPaymentsPence;
    acc.estimatedInterestPence += item.estimatedInterestPence;
    acc.principalRepaymentPence += item.principalRepaymentPence;
    return acc;
  }, {
    statementSpendPence: 0,
    statementPaymentsPence: 0,
    explicitInterestPence: 0,
    refundsPence: 0,
    monzoPaymentsPence: 0,
    estimatedInterestPence: 0,
    principalRepaymentPence: 0,
  });

  await db.collection('finance_debt_service').doc(uid).set({
    ownerUid: uid,
    source,
    perMonth,
    totals,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { ok: true, source, perMonth, totals };
});

const generateFinanceActionInsights = httpsV2.onCall({ region: FUNCTION_REGION, secrets: [GOOGLE_AI_STUDIO_API_KEY] }, async (req) => {
  if (!req?.auth) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required.');
  const uid = req.auth.uid;
  const source = normalizeExternalSource(req.data?.source || 'barclays');
  const maxActions = Math.max(5, Math.min(Number(req.data?.maxActions || 12), 25));

  const db = admin.firestore();
  const [summarySnap, debtSnap, existingSnap] = await Promise.all([
    db.collection('monzo_budget_summary').doc(uid).get(),
    db.collection('finance_debt_service').doc(uid).get(),
    db.collection('finance_action_insights').doc(uid).get(),
  ]);
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

    let type = 'review';
    if (category === 'optional' && merchant.isRecurring && monthlySpend >= 20) type = 'cancel';
    else if (category === 'optional') type = 'reduce';
    else if (category === 'mandatory' && merchant.isRecurring && monthlySpend >= 30) type = 'review';
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
      reason: `~£${monthlySpend.toFixed(2)}/month (${months} month pattern, ${category} spend).`,
      estimatedMonthlySavings: Number(estimatedMonthlySavings.toFixed(2)),
      confidence,
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

  const actions = Array.from(finalMap.values())
    .sort((a, b) => (b.estimatedMonthlySavings || 0) - (a.estimatedMonthlySavings || 0))
    .slice(0, maxActions)
    .map((action) => {
      const id = buildActionId(action);
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

  await db.collection('finance_action_insights').doc(uid).set({
    ownerUid: uid,
    source,
    actions,
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

const fetchFinanceEnhancementData = httpsV2.onCall({ region: FUNCTION_REGION }, async (req) => {
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

  const monthly = {};
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
    const bucket = normalizeBucket(data.userCategoryType || data.aiBucket || data.defaultCategoryType);
    const categoryKey = String(data.userCategoryKey || data.aiCategoryKey || data.category || 'uncategorized').trim() || 'uncategorized';
    const categoryLabel = String(data.userCategoryLabel || data.aiCategoryLabel || categoryKey).trim() || categoryKey;
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

  const categoriesMerged = mergeFinanceCategories(Array.isArray(categoriesSnap.data()?.categories) ? categoriesSnap.data().categories : []);
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

  const totalBudgetPence = categoryBudgetRows.reduce((sum, row) => sum + row.budgetPence, 0);
  const totalActualPence = categoryBudgetRows.reduce((sum, row) => sum + row.actualPence, 0);
  const budgetHealth = {
    mode,
    monthlyIncomePence,
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
  importExternalFinanceTransactions,
  importMonzoTransactionsCsv,
  matchExternalToMonzoTransactions,
  recomputeDebtServiceBreakdown,
  generateFinanceActionInsights,
  convertFinanceActionToStory,
  upsertManualFinanceAccount,
  deleteManualFinanceAccount,
  fetchFinanceEnhancementData,
};
