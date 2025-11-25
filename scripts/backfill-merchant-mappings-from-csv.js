#!/usr/bin/env node
/**
 * Backfill merchant mappings from a CSV file.
 * CSV format: merchant,Category
 * Usage:
 *   node scripts/backfill-merchant-mappings-from-csv.js --csv /path/to/file.csv --uid <UID> --project bob20250810 --sa /path/to/serviceAccount.json
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

const csvPath = arg('--csv');
const uid = arg('--uid');
const projectId = arg('--project', process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'bob20250810');
const saPath = arg('--sa');

if (!csvPath || !uid) {
  console.error('Usage: node scripts/backfill-merchant-mappings-from-csv.js --csv <file> --uid <UID> [--project <id>] [--sa <serviceAccount.json>]');
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error(`CSV not found: ${csvPath}`);
  process.exit(1);
}

if (!admin.apps.length) {
  if (saPath) {
    admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(saPath))), projectId });
  } else {
    admin.initializeApp({ projectId });
  }
}

const db = admin.firestore();

const DEFAULT_CATEGORIES = [
  { key: 'groceries', bucket: 'mandatory', label: 'Groceries' },
  { key: 'eating_out', bucket: 'optional', label: 'Eating Out' },
  { key: 'transport', bucket: 'mandatory', label: 'Transport' },
  { key: 'bills', bucket: 'mandatory', label: 'Bills & Utilities' },
  { key: 'entertainment', bucket: 'optional', label: 'Entertainment' },
  { key: 'savings', bucket: 'savings', label: 'Savings / Pots' },
  { key: 'mandatory', bucket: 'mandatory', label: 'Mandatory' },
  { key: 'optional', bucket: 'optional', label: 'Optional' },
  { key: 'income', bucket: 'income', label: 'Income' },
];

const mapBucketToType = (bucket) => {
  if (bucket === 'mandatory' || bucket === 'debt_repayment' || bucket === 'bank_transfer') return 'mandatory';
  if (bucket === 'optional' || bucket === 'discretionary') return 'optional';
  if (bucket === 'savings' || bucket.includes('saving') || bucket === 'investment') return 'savings';
  if (bucket === 'net_salary' || bucket === 'irregular_income' || bucket === 'income') return 'income';
  return 'optional';
};

const normalizeKey = (str) => String(str || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

const csv = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
const rows = csv.map((line) => {
  const parts = line.split(',');
  return { merchant: parts[0]?.trim(), category: parts[1]?.trim() };
}).filter(r => r.merchant && r.category);

(async () => {
  console.log(`Loaded ${rows.length} rows from CSV; writing mappings for uid=${uid}`);
  let batch = db.batch();
  let count = 0;

  for (const row of rows) {
    const merchantKey = normalizeKey(row.merchant);
    if (!merchantKey) continue;
    const catLabel = row.category.trim();
    const catKeyNormalized = normalizeKey(catLabel);
    const matchCat = DEFAULT_CATEGORIES.find(c => c.key === catKeyNormalized || normalizeKey(c.label) === catKeyNormalized);
    const categoryKey = matchCat?.key || catKeyNormalized;
    const categoryType = mapBucketToType(matchCat?.bucket || 'optional');

    const docRef = db.collection('merchant_mappings').doc(`${uid}_${merchantKey}`);
    batch.set(docRef, {
      ownerUid: uid,
      merchantKey,
      label: row.merchant,
      categoryKey,
      categoryLabel: catLabel,
      categoryType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    count++;
    if (count % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }

  if (count % 400 !== 0) {
    await batch.commit();
  }

  console.log(`Backfill complete. Upserts: ${count}`);
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
