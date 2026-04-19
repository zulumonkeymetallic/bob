/**
 * Agentic Ironman Coach — Fitness Programme Scheduler
 *
 * Scheduled functions:
 *  - pollFitnessProgrammes     every 2h — fetch Runner + CrossFit iCal feeds → fitness_programme_cache
 *  - scheduleCoachFitnessBlocks 04:30  — create calendar_blocks from cache + phase plan
 *
 * Callable functions (for manual testing):
 *  - triggerPollFitnessProgrammes    — manual iCal poll
 *  - triggerScheduleCoachFitnessBlocks — manual block scheduling
 */

'use strict';

const admin = require('firebase-admin');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const httpsV2 = require('firebase-functions/v2/https');
const { DateTime } = require('luxon');
const ical = require('node-ical');
const { RRule } = require('rrule');

const TZ = 'Europe/London';
const REGION = 'europe-west2';
const WINDOW_DAYS = 21;
const SCHEDULE_DAYS = 7;

function db() {
  return admin.firestore();
}

function todayStr(tz = TZ) {
  return DateTime.now().setZone(tz).toISODate();
}

// ─── Logging ─────────────────────────────────────────────────────────────────

async function logCoachEvent(uid, event, metadata = {}) {
  try {
    await db().collection('integration_logs').add({
      integration: 'coach_scheduler',
      event,
      ownerUid: uid,
      metadata,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    console.warn(`[coachScheduler] logCoachEvent failed: ${e?.message}`);
  }
}

// ─── iCal Parsing ─────────────────────────────────────────────────────────────

/**
 * Fetch and parse an iCal feed URL.
 * Returns a plain object keyed by UID (node-ical format).
 * Throws on timeout or network error.
 */
async function fetchICal(url) {
  // node-ical.async.fromURL returns a promise
  return Promise.race([
    ical.async.fromURL(url),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`iCal fetch timeout: ${url}`)), 15000)
    ),
  ]);
}

/**
 * Convert raw node-ical events to a normalised array of {date, title, description, durationMin}.
 * Expands recurring events within [windowStart, windowEnd].
 */
function parseICalEvents(rawEvents, windowStart, windowEnd) {
  const results = [];

  for (const event of Object.values(rawEvents)) {
    if (event.type !== 'VEVENT') continue;

    const dtstart = event.dtstart instanceof Date ? event.dtstart : null;
    if (!dtstart) continue;

    const dtend = event.dtend instanceof Date ? event.dtend : null;
    const durationMin = dtend
      ? Math.round((dtend.getTime() - dtstart.getTime()) / 60000)
      : 60;

    const makeEntry = (dateObj) => ({
      date: DateTime.fromJSDate(dateObj).setZone(TZ).toISODate(),
      title: (event.summary || 'Untitled').trim(),
      description: (event.description || '').trim(),
      durationMin: Math.max(1, durationMin),
      rawSummary: event.summary || '',
    });

    if (event.rrule) {
      // Expand recurring events
      try {
        let rule;
        if (event.rrule instanceof RRule) {
          rule = event.rrule;
        } else if (typeof event.rrule === 'string') {
          rule = RRule.fromString(event.rrule);
        } else if (event.rrule?.options) {
          rule = new RRule(event.rrule.options);
        } else {
          rule = null;
        }

        if (rule) {
          const occurrences = rule.between(windowStart, windowEnd, true);
          for (const occ of occurrences) {
            results.push(makeEntry(occ));
          }
        } else {
          // Fallback: use original dtstart if in window
          if (dtstart >= windowStart && dtstart <= windowEnd) {
            results.push(makeEntry(dtstart));
          }
        }
      } catch (e) {
        console.warn('[coachScheduler] rrule expand failed:', e?.message);
        if (dtstart >= windowStart && dtstart <= windowEnd) {
          results.push(makeEntry(dtstart));
        }
      }
    } else {
      // Non-recurring: only include if within window
      if (dtstart >= windowStart && dtstart <= windowEnd) {
        results.push(makeEntry(dtstart));
      }
    }
  }

  // Sort by date ascending
  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}

// ─── pollFitnessProgrammes ────────────────────────────────────────────────────

async function _pollForUser(uid, profile) {
  const { runnerProgrammeUrl, crossFitProgrammeUrl } = profile;
  const firestore = db();
  const now = new Date();
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let runnerEvents = [];
  let crossFitEvents = [];

  if (runnerProgrammeUrl) {
    try {
      console.log(`[coachScheduler] polling Runner iCal uid=${uid}`);
      const raw = await fetchICal(runnerProgrammeUrl);
      runnerEvents = parseICalEvents(raw, now, windowEnd);
      console.log(`[coachScheduler] uid=${uid} runner events: ${runnerEvents.length}`);
    } catch (e) {
      console.error(`[coachScheduler] Runner iCal fetch failed uid=${uid}:`, e?.message);
    }
  }

  if (crossFitProgrammeUrl) {
    try {
      console.log(`[coachScheduler] polling CrossFit iCal uid=${uid}`);
      const raw = await fetchICal(crossFitProgrammeUrl);
      crossFitEvents = parseICalEvents(raw, now, windowEnd);
      console.log(`[coachScheduler] uid=${uid} crossFit events: ${crossFitEvents.length}`);
    } catch (e) {
      console.error(`[coachScheduler] CrossFit iCal fetch failed uid=${uid}:`, e?.message);
    }
  }

  await firestore.collection('fitness_programme_cache').doc(uid).set(
    {
      runnerEvents,
      crossFitEvents,
      lastPolledAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await logCoachEvent(uid, 'ical_polled', {
    runnerCount: runnerEvents.length,
    crossFitCount: crossFitEvents.length,
  });
}

exports.pollFitnessProgrammes = schedulerV2.onSchedule(
  { schedule: '0 */2 * * *', timeZone: TZ, region: REGION, memory: '512MiB' },
  async () => {
    const firestore = db();
    console.log('[coachScheduler] pollFitnessProgrammes starting');

    // Collect UIDs with at least one iCal URL (two separate queries, Firestore OR workaround)
    const [runnerSnap, crossFitSnap] = await Promise.all([
      firestore.collection('profiles').where('runnerProgrammeUrl', '!=', null).get(),
      firestore.collection('profiles').where('crossFitProgrammeUrl', '!=', null).get(),
    ]);

    const uidMap = new Map();
    for (const doc of [...runnerSnap.docs, ...crossFitSnap.docs]) {
      if (!uidMap.has(doc.id)) uidMap.set(doc.id, doc.data());
    }

    console.log(`[coachScheduler] polling iCal for ${uidMap.size} users`);

    for (const [uid, profile] of uidMap) {
      try {
        await _pollForUser(uid, profile);
      } catch (e) {
        console.error(`[coachScheduler] poll failed uid=${uid}:`, e?.message);
      }
    }

    console.log('[coachScheduler] pollFitnessProgrammes complete');
  }
);

// ─── scheduleCoachFitnessBlocks ──────────────────────────────────────────────

/** Returns the phase index (0-3) based on phase goals or null */
async function resolveActivePhase(firestore, uid, umbrellaGoalId) {
  const phasesSnap = await firestore
    .collection('goals')
    .where('ownerUid', '==', uid)
    .where('parentGoalId', '==', umbrellaGoalId)
    .get();

  const nowMs = Date.now();
  const phases = phasesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.startDate && p.endDate)
    .sort((a, b) => a.startDate - b.startDate);

  const activePhase = phases.find(p => p.startDate <= nowMs && p.endDate >= nowMs);
  if (!activePhase) return null;

  const phaseIndex = phases.indexOf(activePhase);
  return { phaseIndex, phase: activePhase };
}

/** Phase → weekly swim/bike targets */
function phaseSessionTargets(phaseIndex) {
  const targets = [
    { swim: 1, bike: 1 }, // Phase 0 — Base
    { swim: 2, bike: 2 }, // Phase 1 — Build
    { swim: 2, bike: 3 }, // Phase 2 — Peak
    { swim: 1, bike: 1 }, // Phase 3 — Taper
  ];
  return targets[phaseIndex] ?? targets[0];
}

async function _scheduleBlocksForUser(uid, profile) {
  const firestore = db();
  const { ironmanUmbrellaGoalId } = profile;
  const nowDt = DateTime.now().setZone(TZ);
  const today = nowDt.toISODate();

  // Load cache
  const cacheSnap = await firestore.collection('fitness_programme_cache').doc(uid).get();
  if (!cacheSnap.exists) {
    console.log(`[coachScheduler] no cache uid=${uid}, skipping block scheduling`);
    return;
  }
  const cache = cacheSnap.data();

  // Load existing coach blocks for next 7 days
  const windowStart = nowDt.startOf('day').toMillis();
  const windowEnd = nowDt.plus({ days: SCHEDULE_DAYS }).endOf('day').toMillis();

  const existingSnap = await firestore
    .collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', windowStart)
    .where('start', '<=', windowEnd)
    .get();

  // Build covered dates per source type
  const coveredRunnerDates = new Set();
  const coveredTriathlonDates = new Set();
  const busyDates = new Set(); // any fitness block on this date (runner or crossfit)
  const existingSwimCount = { thisWeek: 0 };
  const existingBikeCount = { thisWeek: 0 };
  const weekStart = nowDt.startOf('week').toISODate();
  const weekEnd = nowDt.endOf('week').toISODate();

  for (const doc of existingSnap.docs) {
    const data = doc.data();
    const dateStr = DateTime.fromMillis(data.start).setZone(TZ).toISODate();
    const src = data.source || '';

    if (src === 'coach_runner') {
      coveredRunnerDates.add(dateStr);
      busyDates.add(dateStr);
    }
    if (src === 'coach_triathlon') {
      coveredTriathlonDates.add(dateStr);
      busyDates.add(dateStr);
      const titleLower = (data.title || '').toLowerCase();
      if (dateStr >= weekStart && dateStr <= weekEnd) {
        if (titleLower.includes('swim')) existingSwimCount.thisWeek++;
        if (titleLower.includes('bike') || titleLower.includes('ride') || titleLower.includes('cycling')) existingBikeCount.thisWeek++;
      }
    }
    // CrossFit from iCal also marks day as busy
    if (src === 'coach_crossfit') busyDates.add(dateStr);
  }

  // Resolve active phase
  const phaseResult = await resolveActivePhase(firestore, uid, ironmanUmbrellaGoalId);
  const phaseIndex = phaseResult?.phaseIndex ?? 0;
  const targets = phaseSessionTargets(phaseIndex);

  const batch = firestore.batch();
  let created = 0;
  let skipped = 0;

  // 1. Runner blocks from iCal cache
  const runnerEvents = (cache.runnerEvents || []).filter(e => e.date >= today);
  for (const event of runnerEvents.slice(0, SCHEDULE_DAYS)) {
    if (coveredRunnerDates.has(event.date)) {
      skipped++;
      continue;
    }
    const startDt = DateTime.fromISO(`${event.date}T06:30:00`, { zone: TZ });
    const endDt = startDt.plus({ minutes: event.durationMin });
    const ref = firestore.collection('calendar_blocks').doc();
    batch.set(ref, {
      ownerUid: uid,
      title: event.title,
      start: startDt.toMillis(),
      end: endDt.toMillis(),
      source: 'coach_runner',
      entityType: 'fitness',
      theme: 'health',
      aiGenerated: true,
      description: event.description || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    coveredRunnerDates.add(event.date);
    busyDates.add(event.date);
    created++;
  }

  // 2. CrossFit blocks from iCal cache (stored as coach_crossfit for reference)
  const crossFitEvents = (cache.crossFitEvents || []).filter(e => e.date >= today);
  for (const event of crossFitEvents.slice(0, SCHEDULE_DAYS)) {
    // Mark as busy but don't duplicate if already present
    if (!busyDates.has(event.date)) {
      const startDt = DateTime.fromISO(`${event.date}T06:00:00`, { zone: TZ });
      const endDt = startDt.plus({ minutes: event.durationMin || 60 });
      const ref = firestore.collection('calendar_blocks').doc();
      batch.set(ref, {
        ownerUid: uid,
        title: event.title,
        start: startDt.toMillis(),
        end: endDt.toMillis(),
        source: 'coach_crossfit',
        entityType: 'fitness',
        theme: 'health',
        aiGenerated: true,
        description: event.description || '',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      busyDates.add(event.date);
      created++;
    }
  }

  // 3. Swim/bike blocks based on phase targets
  const swimNeeded = Math.max(0, targets.swim - existingSwimCount.thisWeek);
  const bikeNeeded = Math.max(0, targets.bike - existingBikeCount.thisWeek);

  if (swimNeeded > 0 || bikeNeeded > 0) {
    // Find free days this week (Mon-Sun) that don't have a fitness block
    const freeDays = [];
    for (let i = 0; i < 7; i++) {
      const day = nowDt.startOf('week').plus({ days: i });
      const dayStr = day.toISODate();
      if (dayStr >= today && !busyDates.has(dayStr)) {
        freeDays.push({ dayStr, weekday: day.weekday }); // 1=Mon, 7=Sun
      }
    }

    // Prefer weekends for bike (Sat=6, Sun=7), weekdays for swim
    const bikeDays = freeDays.filter(d => d.weekday >= 6).concat(freeDays.filter(d => d.weekday < 6));
    const swimDays = freeDays.filter(d => d.weekday < 6).concat(freeDays.filter(d => d.weekday >= 6));

    let swimScheduled = 0;
    let bikeScheduled = 0;

    for (const { dayStr } of bikeDays) {
      if (bikeScheduled >= bikeNeeded) break;
      if (busyDates.has(dayStr)) continue;
      const startDt = DateTime.fromISO(`${dayStr}T07:00:00`, { zone: TZ });
      const endDt = startDt.plus({ minutes: 90 });
      const ref = firestore.collection('calendar_blocks').doc();
      batch.set(ref, {
        ownerUid: uid,
        title: `🚴 Bike — ${phaseResult?.phase?.title || `Phase ${phaseIndex}`}`,
        start: startDt.toMillis(),
        end: endDt.toMillis(),
        source: 'coach_triathlon',
        entityType: 'fitness',
        theme: 'health',
        aiGenerated: true,
        description: `Coach-scheduled bike session (${phaseResult?.phase?.title || `Phase ${phaseIndex}`})`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      busyDates.add(dayStr);
      bikeScheduled++;
      created++;
    }

    for (const { dayStr } of swimDays) {
      if (swimScheduled >= swimNeeded) break;
      if (busyDates.has(dayStr)) continue;
      const startDt = DateTime.fromISO(`${dayStr}T07:00:00`, { zone: TZ });
      const endDt = startDt.plus({ minutes: 60 });
      const ref = firestore.collection('calendar_blocks').doc();
      batch.set(ref, {
        ownerUid: uid,
        title: `🏊 Swim — ${phaseResult?.phase?.title || `Phase ${phaseIndex}`}`,
        start: startDt.toMillis(),
        end: endDt.toMillis(),
        source: 'coach_triathlon',
        entityType: 'fitness',
        theme: 'health',
        aiGenerated: true,
        description: `Coach-scheduled swim session (${phaseResult?.phase?.title || `Phase ${phaseIndex}`})`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      busyDates.add(dayStr);
      swimScheduled++;
      created++;
    }
  }

  if (created > 0) {
    await batch.commit();
  }

  await logCoachEvent(uid, 'fitness_blocks_scheduled', {
    created,
    skipped,
    phaseIndex,
    swimNeeded,
    bikeNeeded,
  });

  console.log(`[coachScheduler] uid=${uid} scheduled ${created} blocks, skipped ${skipped}`);
}

exports.scheduleCoachFitnessBlocks = schedulerV2.onSchedule(
  { schedule: '30 4 * * *', timeZone: TZ, region: REGION, memory: '512MiB' },
  async () => {
    const firestore = db();
    console.log('[coachScheduler] scheduleCoachFitnessBlocks starting');

    // Find users with ironman coach + at least one iCal URL
    const [runnerSnap, crossFitSnap] = await Promise.all([
      firestore.collection('profiles')
        .where('ironmanUmbrellaGoalId', '!=', null)
        .where('runnerProgrammeUrl', '!=', null)
        .get(),
      firestore.collection('profiles')
        .where('ironmanUmbrellaGoalId', '!=', null)
        .where('crossFitProgrammeUrl', '!=', null)
        .get(),
    ]);

    const uidMap = new Map();
    for (const doc of [...runnerSnap.docs, ...crossFitSnap.docs]) {
      if (!uidMap.has(doc.id)) uidMap.set(doc.id, doc.data());
    }

    console.log(`[coachScheduler] scheduling blocks for ${uidMap.size} users`);

    for (const [uid, profile] of uidMap) {
      try {
        await _scheduleBlocksForUser(uid, profile);
      } catch (e) {
        console.error(`[coachScheduler] schedule failed uid=${uid}:`, e?.message);
        await logCoachEvent(uid, 'fitness_blocks_error', { error: e?.message });
      }
    }

    console.log('[coachScheduler] scheduleCoachFitnessBlocks complete');
  }
);

// ─── Manual Trigger Callables (for testing) ──────────────────────────────────

exports.triggerPollFitnessProgrammes = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const profileSnap = await db().collection('profiles').doc(uid).get();
  if (!profileSnap.exists) throw new httpsV2.HttpsError('not-found', 'Profile not found');

  const profile = profileSnap.data();
  if (!profile.runnerProgrammeUrl && !profile.crossFitProgrammeUrl) {
    throw new httpsV2.HttpsError('failed-precondition', 'No iCal URLs configured in profile');
  }

  await _pollForUser(uid, profile);
  return { ok: true };
});

exports.triggerScheduleCoachFitnessBlocks = httpsV2.onCall({ region: REGION }, async (req) => {
  const uid = req?.auth?.uid;
  if (!uid) throw new httpsV2.HttpsError('unauthenticated', 'Sign in required');

  const profileSnap = await db().collection('profiles').doc(uid).get();
  if (!profileSnap.exists) throw new httpsV2.HttpsError('not-found', 'Profile not found');

  const profile = profileSnap.data();
  if (!profile.ironmanUmbrellaGoalId) {
    throw new httpsV2.HttpsError('failed-precondition', 'No Ironman umbrella goal configured');
  }

  await _scheduleBlocksForUser(uid, profile);
  return { ok: true };
});
