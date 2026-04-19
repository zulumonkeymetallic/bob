#!/usr/bin/env node
/**
 * Backfill startDate and targetYear for Travel & Adventure goals.
 *
 * - Targets goals where theme === 7 (Travel & Adventure).
 * - If endDate exists and startDate is missing/null, sets startDate = endDate - 14 days.
 * - If targetYear is missing/null/0, sets targetYear = year(endDate).
 *
 * Usage:
 *   node scripts/backfill-travel-goals.js --serviceAccount /path/to/sa.json --project bob20250810 [--dryRun]
 *
 * If --serviceAccount is omitted, Application Default Credentials are used.
 */

const admin = require('firebase-admin');
const path = require('path');

const DAY_MS = 1000 * 60 * 60 * 24;
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
  const { serviceAccount, project } = opts;
  const config = {};
  if (project) config.projectId = project;
  if (serviceAccount) {
    try {
      const resolved = path.resolve(serviceAccount);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sa = require(resolved);
      config.credential = admin.credential.cert(sa);
    } catch (e) {
      console.error('Failed to load service account:', e.message);
      process.exit(1);
    }
  } else {
    config.credential = admin.credential.applicationDefault();
  }
  admin.initializeApp(config);
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
    if (typeof val.seconds === 'number') return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1e6);
  }
  return null;
}

async function backfillGoals(db, dryRun) {
  const snap = await db.collection('goals').where('theme', '==', THEME_TRAVEL).get();
  let updated = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const endMs = normalizeMillis(data.endDate || data.targetDate);
    const currentStart = normalizeMillis(data.startDate);
    const currentYear = data.targetYear ?? null;

    if (!endMs) {
      skipped += 1;
      continue;
    }

    const payload = {};
    if (!currentStart) {
      payload.startDate = endMs - 14 * DAY_MS;
    }
    if (!currentYear || Number(currentYear) === 0) {
      payload.targetYear = new Date(endMs).getFullYear();
    }

    if (Object.keys(payload).length === 0) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log('[DRY RUN]', doc.id, payload);
    } else {
      await doc.ref.set(payload, { merge: true });
    }
    updated += 1;
  }

  return { scanned: snap.size, updated, skipped };
}

async function main() {
  const args = parseArgs();
  initAdmin(args);
  const db = admin.firestore();
  const project = admin.app().options.projectId || 'unknown';
  console.log(`🔧 Travel goal backfill start (project: ${project}, dryRun=${args.dryRun ? 'yes' : 'no'})`);

  const res = await backfillGoals(db, args.dryRun);
  console.log(`✅ Done. scanned=${res.scanned}, updated=${res.updated}, skipped=${res.skipped}`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
