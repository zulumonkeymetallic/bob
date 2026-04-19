#!/usr/bin/env node
/**
 * Normalize Travel & Adventure (theme 7) goals so targetYear matches endDate.
 * If endDate exists, set targetYear = year(endDate).
 *
 * Usage:
 *   node scripts/fix-travel-target-years.js --serviceAccount /path/to/sa.json --project bob20250810 [--dryRun]
 */

const admin = require('firebase-admin');
const path = require('path');

const THEME_TRAVEL = 7;

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { dryRun: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dryRun' || arg === '--dry-run') out.dryRun = true;
    if (arg === '--serviceAccount' || arg === '--sa') out.serviceAccount = args[i + 1];
    if (arg === '--project') out.project = args[i + 1];
  }
  return out;
}

function initAdmin(opts) {
  if (admin.apps.length) return;
  const cfg = {};
  if (opts.project) cfg.projectId = opts.project;
  if (opts.serviceAccount) {
    try {
      const resolved = path.resolve(opts.serviceAccount);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sa = require(resolved);
      cfg.credential = admin.credential.cert(sa);
    } catch (e) {
      console.error('Failed to load service account:', e.message);
      process.exit(1);
    }
  } else {
    cfg.credential = admin.credential.applicationDefault();
  }
  admin.initializeApp(cfg);
}

function normalizeMillis(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof val === 'object') {
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val.toDate === 'function') {
      const d = val.toDate();
      return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
    }
    if (typeof val.seconds === 'number') {
      return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6);
    }
  }
  return null;
}

async function main() {
  const args = parseArgs();
  initAdmin(args);
  const db = admin.firestore();
  const project = admin.app().options.projectId || 'unknown';
  console.log(`🔧 Fixing travel targetYear (project: ${project}, dryRun=${args.dryRun ? 'yes' : 'no'})`);

  const snap = await db.collection('goals').where('theme', '==', THEME_TRAVEL).get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const endMs = normalizeMillis(data.endDate || data.targetDate);
    if (!endMs) {
      skipped += 1;
      continue;
    }
    const derivedYear = new Date(endMs).getFullYear();
    if (data.targetYear === derivedYear) {
      skipped += 1;
      continue;
    }
    const payload = { targetYear: derivedYear };
    if (args.dryRun) {
      console.log('[DRY RUN]', doc.id, data.title, '->', payload);
    } else {
      await doc.ref.set(payload, { merge: true });
    }
    updated += 1;
  }

  console.log(`✅ Done. scanned=${snap.size}, updated=${updated}, skipped=${skipped}`);
}

main().catch((e) => {
  console.error('Fix failed:', e);
  process.exit(1);
});
