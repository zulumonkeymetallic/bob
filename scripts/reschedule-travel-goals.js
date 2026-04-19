#!/usr/bin/env node
/**
 * Reschedule all Travel & Adventure goals (theme 7) to:
 *  - Start no earlier than Sep 2026.
 *  - Spread over 8 years (2026–2033) with at least 2 trips per year.
 *  - Prefer 1 European + 1 long-haul per year when possible.
 *  - Set startDate/endDate to 14-day windows and targetYear to the scheduled year.
 *
 * Usage:
 *   node scripts/reschedule-travel-goals.js --serviceAccount /path/to/sa.json --project bob20250810 [--dryRun]
 */

const admin = require('firebase-admin');
const path = require('path');

const THEME_TRAVEL = 7;
const START_YEAR = 2026;
const YEARS = Array.from({ length: 8 }, (_, i) => START_YEAR + i);
const DAY_MS = 1000 * 60 * 60 * 24;

const EUROPE_KEYWORDS = [
  'austria', 'germany', 'france', 'italy', 'switzerland', 'spain', 'uk', 'united kingdom', 'england', 'scotland',
  'ireland', 'norway', 'denmark', 'sweden', 'finland', 'estonia', 'latvia', 'lithuania', 'croatia', 'slovenia',
  'turkey', 'cappadocia', 'iceland', 'faroe', 'europe', 'cornwall', 'bavaria', 'berlin', 'vienna', 'salzburg',
  'ljubljana', 'zagreb', 'bilbao', 'madrid', 'barcelona', 'granada'
];

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

function isEuropean(title = '') {
  const t = title.toLowerCase();
  return EUROPE_KEYWORDS.some((k) => t.includes(k));
}

function scheduledDate(year, slotIndex) {
  // Month schedule across a year; for 2026 force into autumn onward.
  const baseMonths = [2, 5, 8, 10]; // Mar, Jun, Sep, Nov (0-based)
  const month = (() => {
    const idx = slotIndex % baseMonths.length;
    let m = baseMonths[idx];
    if (year === 2026 && m < 8) {
      // Push spring/summer picks to autumn/winter for 2026
      m = 8 + idx;
      if (m > 11) m = 11;
    }
    return m;
  })();
  return new Date(Date.UTC(year, month, 10, 12, 0, 0, 0)).getTime();
}

async function fetchTravelGoals(db) {
  const snap = await db.collection('goals').where('theme', '==', THEME_TRAVEL).get();
  return snap.docs.map((d) => ({
    id: d.id,
    ref: d.ref,
    title: (d.data().title || '').trim(),
  }));
}

function assignYears(goals) {
  const european = goals.filter((g) => isEuropean(g.title));
  const longhaul = goals.filter((g) => !isEuropean(g.title));

  const perYear = YEARS.map(() => []);

  // Seed each year with one European and one long-haul if available
  YEARS.forEach((_, idx) => {
    if (european.length) perYear[idx].push({ ...european.shift(), slotType: 'eu' });
    if (longhaul.length) perYear[idx].push({ ...longhaul.shift(), slotType: 'long' });
  });

  // Pool remaining trips and distribute to the year with the lowest count (round robin)
  const remaining = [...european, ...longhaul];
  let pointer = 0;
  while (remaining.length) {
    const goal = remaining.shift();
    // find year with smallest size; break ties by pointer
    const sizes = perYear.map((list, i) => ({ i, size: list.length }));
    sizes.sort((a, b) => a.size === b.size ? a.i - b.i : a.size - b.size);
    const targetIndex = sizes[0].i;
    perYear[targetIndex].push(goal);
    pointer = (pointer + 1) % YEARS.length;
  }

  return perYear;
}

async function applySchedule(db, perYear, dryRun) {
  let updated = 0;
  for (let yIdx = 0; yIdx < YEARS.length; yIdx++) {
    const year = YEARS[yIdx];
    const slots = perYear[yIdx];
    for (let idx = 0; idx < slots.length; idx++) {
      const g = slots[idx];
      const startDate = scheduledDate(year, idx);
      const endDate = startDate + 14 * DAY_MS;
      const payload = { startDate, endDate, targetYear: year };
      if (dryRun) {
        console.log(`[DRY RUN] ${g.id} (${g.title}) ->`, payload);
      } else {
        await db.doc(`goals/${g.id}`).set(payload, { merge: true });
        updated += 1;
      }
    }
  }
  return updated;
}

async function main() {
  const args = parseArgs();
  initAdmin(args);
  const db = admin.firestore();
  const project = admin.app().options.projectId || 'unknown';
  console.log(`🔧 Rescheduling travel goals (project: ${project}, dryRun=${args.dryRun ? 'yes' : 'no'})`);

  const goals = await fetchTravelGoals(db);
  console.log(`Found ${goals.length} travel goals`);

  const perYear = assignYears(goals);
  const updated = await applySchedule(db, perYear, args.dryRun);

  console.log(`✅ Scheduling complete. Updated ${args.dryRun ? '0 (dry run)' : updated} goals across years ${YEARS[0]}–${YEARS[YEARS.length - 1]}.`);
}

main().catch((e) => {
  console.error('Reschedule failed:', e);
  process.exit(1);
});
