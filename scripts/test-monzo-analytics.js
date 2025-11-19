#!/usr/bin/env node
/**
 * Firestore emulator smoke test for Monzo analytics.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/test-monzo-analytics.js --uid demo_user
 *
 * Seeds a handful of synthetic Monzo transactions, runs computeMonzoAnalytics,
 * and asserts that budgetProgress + theme summaries are populated so the
 * daily summary email/widgets have data to render.
 */

const admin = require('firebase-admin');
const { computeMonzoAnalytics } = require('../functions/monzo/analytics');

function initAdmin() {
  if (admin.apps.length) return;
  const projectId = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'bob-local';
  admin.initializeApp({ projectId });
}

function getArg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return String(process.argv[index + 1] || '').trim() || fallback;
}

async function clearExistingData(db, uid) {
  const collectionsToQuery = ['monzo_transactions', 'monzo_accounts', 'monzo_pots'];
  for (const col of collectionsToQuery) {
    const snap = await db.collection(col).where('ownerUid', '==', uid).get();
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    if (!snap.empty) {
      await batch.commit();
    }
  }
  await db.collection('monzo_budget_summary').doc(uid).delete().catch(() => {});
  await db.collection('monzo_goal_alignment').doc(uid).delete().catch(() => {});
}

function buildTransaction(uid, seed) {
  const createdISO = new Date(Date.now() - seed.offsetDays * 24 * 60 * 60 * 1000).toISOString();
  return {
    ownerUid: uid,
    transactionId: `${seed.id}_${seed.offsetDays}`,
    createdISO,
    createdAt: admin.firestore.Timestamp.fromDate(new Date(createdISO)),
    amount: seed.amountMinor,
    currency: 'GBP',
    description: seed.description,
    defaultCategoryType: seed.categoryType,
    userCategoryType: seed.categoryType,
    merchantKey: seed.merchantKey,
    merchant: { name: seed.description },
  };
}

async function seedTransactions(db, uid) {
  const seeds = [
    { id: 'groceries', description: 'Tesco', categoryType: 'mandatory', amountMinor: -4500, merchantKey: 'tesco', offsetDays: 2 },
    { id: 'rent', description: 'Monthly Rent', categoryType: 'mandatory', amountMinor: -95000, merchantKey: 'rent', offsetDays: 10 },
    { id: 'salary', description: 'Salary', categoryType: 'income', amountMinor: 250000, merchantKey: 'employer', offsetDays: 12 },
    { id: 'savings', description: 'Savings Transfer', categoryType: 'savings', amountMinor: -30000, merchantKey: 'savings', offsetDays: 5 },
    { id: 'coffee', description: 'Coffee Shop', categoryType: 'optional', amountMinor: -700, merchantKey: 'coffee', offsetDays: 1 },
  ];
  const batch = db.batch();
  seeds.forEach((seed) => {
    const docId = `${uid}_${seed.id}_${seed.offsetDays}`;
    batch.set(db.collection('monzo_transactions').doc(docId), buildTransaction(uid, seed));
  });
  await batch.commit();
}

async function run() {
  initAdmin();
  const db = admin.firestore();
  const uid = getArg('--uid', `monzo_emulator_${Date.now()}`);

  console.log(`→ Seeding emulator data for uid=${uid}`);
  await clearExistingData(db, uid);
  await seedTransactions(db, uid);

  console.log('→ Running computeMonzoAnalytics');
  const analytics = await computeMonzoAnalytics(uid);
  if (!analytics) {
    throw new Error('computeMonzoAnalytics returned empty payload');
  }

  const summarySnap = await db.collection('monzo_budget_summary').doc(uid).get();
  if (!summarySnap.exists) {
    throw new Error('monzo_budget_summary document missing');
  }
  const summary = summarySnap.data() || {};
  if (!Array.isArray(summary.budgetProgress) || summary.budgetProgress.length === 0) {
    throw new Error('budgetProgress missing from monzo_budget_summary');
  }

  const alignmentSnap = await db.collection('monzo_goal_alignment').doc(uid).get();
  if (!alignmentSnap.exists) {
    throw new Error('monzo_goal_alignment document missing');
  }
  const alignment = alignmentSnap.data() || {};
  if (!Array.isArray(alignment.themes) || alignment.themes.length === 0) {
    throw new Error('theme alignment missing from monzo_goal_alignment');
  }

  console.log('✓ Monzo analytics emulator test passed');
  console.log(`   Budget progress entries: ${summary.budgetProgress.length}`);
  console.log(`   Theme alignment entries: ${alignment.themes.length}`);
}

run().catch((error) => {
  console.error('✗ Monzo analytics emulator test failed:', error?.message || error);
  process.exit(1);
});
