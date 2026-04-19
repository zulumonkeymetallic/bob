#!/usr/bin/env node
/**
 * Backfill trip start dates to make each trip two weeks long.
 *
 * - Uses endDate (or inferred seasonal end date) and sets startDate = endDate - 14 days.
 * - Applies to both `trips` and `travel` collections.
 * - When endDate is missing, infers a best-fit end date based on the title/region:
 *     • Southern hemisphere (Australia, New Zealand, South Africa, Patagonia, etc): mid-January (good summer window)
 *     • Ski/Alps: early March shoulder season
 *     • Default: mid-July (northern summer)
 *
 * Usage:
 *   node scripts/backfill-trip-start-dates.js --serviceAccount /path/to/sa.json --project bob20250810 [--dryRun]
 *
 * If --serviceAccount is omitted, GOOGLE_APPLICATION_CREDENTIALS/Application Default Credentials are used.
 */

const admin = require('firebase-admin');
const path = require('path');

const DAY_MS = 1000 * 60 * 60 * 24;
const TARGET_DURATION_DAYS = 14;
const COLLECTIONS = ['trips', 'travel'];

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
  const init = {};

  if (project) init.projectId = project;
  if (serviceAccount) {
    try {
      // Support both absolute and relative paths
      const resolved = path.resolve(serviceAccount);
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const sa = require(resolved);
      init.credential = admin.credential.cert(sa);
    } catch (e) {
      console.error('Failed to load service account file:', e.message);
      process.exit(1);
    }
  } else {
    init.credential = admin.credential.applicationDefault();
  }

  admin.initializeApp(init);
}

function normalizeMillis(value) {
  if (!value && value !== 0) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (value && typeof value.seconds === 'number') {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return null;
}

function nextOccurrence(month, day) {
  const now = new Date();
  let year = now.getFullYear();
  const candidate = new Date(year, month, day, 12, 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    year += 1;
  }
  return new Date(year, month, day, 12, 0, 0, 0).getTime();
}

function inferEndDateFromTitle(title) {
  const t = (title || '').toLowerCase();
  if (!t) return null;

  const southern = [
    'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'tasmania',
    'new zealand', 'auckland', 'wellington', 'christchurch', 'queenstown',
    'south africa', 'cape town', 'johannesburg',
    'argentina', 'chile', 'patagonia', 'uruguay',
    'brazil', 'buenos aires',
  ];
  const ski = ['ski', 'alps', 'dolomites', 'chamonix', 'verbier', 'whistler'];

  if (southern.some(k => t.includes(k))) {
    // Southern hemisphere summer - aim for mid-January
    return nextOccurrence(0, 20); // January 20
  }
  if (ski.some(k => t.includes(k))) {
    // Late-season snow with better weather
    return nextOccurrence(2, 10); // March 10
  }

  // Default: northern hemisphere summer sweet spot
  return nextOccurrence(6, 20); // July 20
}

async function backfillCollection(db, name, dryRun) {
  const snap = await db.collection(name).get();
  let updated = 0;
  let skipped = 0;
  let inferred = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const title = data.title || data.locationName || data.country_code || doc.id;

    let endMs = normalizeMillis(data.endDate || data.plannedVisitAt || data.dueDate || data.targetDate);
    let endWasInferred = false;
    if (!endMs) {
      endMs = inferEndDateFromTitle(title);
      endWasInferred = !!endMs;
    }

    if (!endMs) {
      skipped += 1;
      continue;
    }

    const desiredStart = endMs - TARGET_DURATION_DAYS * DAY_MS;
    const currentStart = normalizeMillis(data.startDate);
    const startNeedsUpdate = currentStart !== desiredStart;
    const endNeedsUpdate = endWasInferred && !data.endDate;
    const plannedVisitNeedsUpdate = endWasInferred && !data.plannedVisitAt;

    if (!startNeedsUpdate && !endNeedsUpdate && !plannedVisitNeedsUpdate) {
      skipped += 1;
      continue;
    }

    const payload = {
      startDate: desiredStart,
    };
    if (endNeedsUpdate) payload.endDate = endMs;
    if (plannedVisitNeedsUpdate) payload.plannedVisitAt = endMs;

    if (dryRun) {
      console.log(`[DRY RUN] ${name}/${doc.id} ->`, payload, `(title: ${title})`);
    } else {
      await doc.ref.set(payload, { merge: true });
    }

    updated += 1;
    if (endWasInferred) inferred += 1;
  }

  return { collection: name, scanned: snap.size, updated, skipped, inferred };
}

async function main() {
  const args = parseArgs();
  initAdmin(args);
  const db = admin.firestore();
  const projectId = admin.app().options.projectId || 'unknown';

  console.log(`🔧 Trip start-date backfill starting (project: ${projectId}, dryRun=${args.dryRun ? 'yes' : 'no'})`);

  const results = [];
  for (const col of COLLECTIONS) {
    try {
      const res = await backfillCollection(db, col, args.dryRun);
      console.log(`  ${col}: scanned=${res.scanned}, updated=${res.updated}, inferredEndDates=${res.inferred}, skipped=${res.skipped}`);
      results.push(res);
    } catch (e) {
      console.error(`  ${col}: error`, e.message);
    }
  }

  const totalUpdated = results.reduce((a, r) => a + (r.updated || 0), 0);
  const totalInferred = results.reduce((a, r) => a + (r.inferred || 0), 0);
  console.log(`✅ Backfill complete. Updated ${totalUpdated} docs (${totalInferred} with inferred end dates).`);
}

main().catch((e) => {
  console.error('Backfill failed:', e);
  process.exit(1);
});
