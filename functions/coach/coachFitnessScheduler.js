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
const { resolveActivePhase: resolveActivePhaseShared } = require('./phaseResolver');
const { activityFromSport } = require('../utils/activityTaxonomy');

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
  // A browser User-Agent, because some providers reject the default outright.
  //
  // WodBoard returns 403 Forbidden to a request without one and 200 with it — verified
  // 2026-08-05 against Jim's live feed. node-ical sends no User-Agent of its own, so the
  // CrossFit programme had been failing at the transport layer, landing in the catch
  // below and logging a count of zero that was indistinguishable from an empty plan.
  //
  // `webcal://` is a display scheme, not a transport one; it has to be rewritten or the
  // fetch fails before it starts.
  const fetchUrl = String(url || '').replace(/^webcal:\/\//i, 'https://');
  return Promise.race([
    ical.async.fromURL(fetchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
          + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`iCal fetch timeout: ${fetchUrl}`)), 15000)
    ),
  ]);
}

// ─── The athlete's own weekly windows ────────────────────────────────────────

/**
 * Health & Fitness slots from `theme_allocations`, keyed by canonical activity.
 *
 * These are the hours Jim actually chose — Tuesday 06:30 is his swimming lesson, the
 * 05:30 slots are S&C before work. The scheduler used to ignore all of it and place every
 * session at one of three literals (06:00 CrossFit, 06:30 runner, 07:00 swim/bike), so a
 * run prescribed for Thursday landed at half six in the morning when the slot he set aside
 * for running is half six at night.
 *
 * `dayOfWeek` is stored 0=Sunday … 6=Saturday (see WeeklyThemePlanner.tsx and
 * nightlyOrchestration.js:115). Luxon counts 1=Monday … 7=Sunday, so the conversion is
 * `weekday % 7` — Sunday's 7 wrapping to 0.
 */
async function loadHealthSlots(firestore, uid) {
  const snap = await firestore.collection('theme_allocations').doc(uid).get().catch(() => null);
  const allocations = snap?.exists ? (snap.data()?.allocations || []) : [];
  const slots = [];
  for (const alloc of allocations) {
    if (!String(alloc?.theme || '').toLowerCase().includes('health')) continue;
    const subTheme = String(alloc?.subTheme || '').trim();
    if (!subTheme) continue;
    const day = Number(alloc.dayOfWeek);
    if (!Number.isFinite(day)) continue;
    const [sh, sm] = String(alloc.startTime || '').split(':');
    const [eh, em] = String(alloc.endTime || '').split(':');
    const startMinutes = Number(sh) * 60 + Number(sm || 0);
    const endMinutes = Number(eh) * 60 + Number(em || 0);
    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes) || endMinutes <= startMinutes) continue;
    slots.push({
      dayOfWeek: day,
      startMinutes,
      durationMin: endMinutes - startMinutes,
      subTheme,
      activity: activityFromSport(subTheme),
    });
  }
  return slots;
}

/** The slot for an activity on a given date, or null. */
function slotOnDay(slots, activity, dt) {
  const dayKey = dt.weekday % 7;
  return slots.find((s) => s.activity === activity && s.dayOfWeek === dayKey) || null;
}

/** Any slot for an activity, whatever day — used to borrow a sensible hour. */
function anySlotFor(slots, activity) {
  return slots.find((s) => s.activity === activity) || null;
}

/**
 * Start time for a session, preferring the athlete's own window.
 *
 * Order: his slot on that exact day, then his usual hour for that activity on any day,
 * then the caller's fallback. A programme decides *what* and *which day*; his allocations
 * decide the hour.
 */
function startForSession(slots, activity, dt, fallbackHHMM) {
  const slot = slotOnDay(slots, activity, dt) || anySlotFor(slots, activity);
  if (slot) {
    return {
      start: dt.startOf('day').plus({ minutes: slot.startMinutes }),
      durationMin: slot.durationMin,
      source: 'theme_allocation',
    };
  }
  const [h, m] = fallbackHHMM.split(':');
  return {
    start: dt.startOf('day').set({ hour: Number(h), minute: Number(m) }),
    durationMin: null,
    source: 'default',
  };
}

/**
 * Convert raw node-ical events to a normalised array of {date, title, description, durationMin}.
 * Expands recurring events within [windowStart, windowEnd].
 */
function parseICalEvents(rawEvents, windowStart, windowEnd) {
  const results = [];

  for (const event of Object.values(rawEvents)) {
    if (event.type !== 'VEVENT') continue;

    // `event.start`, not `event.dtstart`.
    //
    // node-ical exposes the parsed dates as `start` and `end`. There is no `dtstart`
    // property on a VEVENT at all — `event.dtstart` is `undefined`, and
    // `undefined instanceof Date` is false, so the guard below skipped **every** event.
    //
    // Confirmed against the live Runna feed on 2026-08-05: 249 VEVENTs parsed, 0 with a
    // `dtstart`, 0 written to fitness_programme_cache. Every poll for months logged
    // `ical_polled {runnerCount: 0, crossFitCount: 0}` and looked like a healthy run
    // against an empty training plan.
    //
    // That silence was doubly expensive, because `materializePlannerThemeBlocks` stands
    // down from health theme blocks whenever `hasIronmanCoach` is true
    // (nightlyOrchestration.js) — deferring to a coach that could never see a session.
    // Fifteen configured Health & Fitness slots and a full Runna plan, and not one
    // training block reached the calendar.
    //
    // `dtstart`/`dtend` are kept as fallbacks in case a future node-ical restores them.
    const dtstart = (event.start instanceof Date) ? event.start
      : (event.dtstart instanceof Date ? event.dtstart : null);
    if (!dtstart) continue;

    const dtend = (event.end instanceof Date) ? event.end
      : (event.dtend instanceof Date ? event.dtend : null);

    // An all-day entry has no duration to take.
    //
    // Runna mixes the two: most sessions are timed ("12km Long Run", 70 minutes) but some
    // are date-only, and iCal represents those as DTEND on the following day — 1,440
    // minutes. Taken literally that produced a 24-hour training block: "Broken Miles •
    // 8km, 18:30 Friday to 18:30 Saturday".
    //
    // `datetype` is node-ical's own marker ('date' vs 'date-time'); the 24-hour check is
    // a belt-and-braces fallback for feeds that omit it. Null means "unknown", and the
    // caller substitutes the athlete's own slot length instead of inventing one here.
    const isAllDay = event.datetype === 'date'
      || (dtend && (dtend.getTime() - dtstart.getTime()) >= 24 * 60 * 60 * 1000);
    const rawDurationMin = dtend
      ? Math.round((dtend.getTime() - dtstart.getTime()) / 60000)
      : null;
    const durationMin = isAllDay ? null : rawDurationMin;

    const makeEntry = (dateObj) => ({
      date: DateTime.fromJSDate(dateObj).setZone(TZ).toISODate(),
      title: (event.summary || 'Untitled').trim(),
      description: (event.description || '').trim(),
      durationMin: durationMin === null ? null : Math.max(1, durationMin),
      allDay: isAllDay,
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
  { schedule: '0 */4 * * *', timeZone: TZ, region: REGION, memory: '512MiB' },  // Reduced from 2h to 4h (May 2026 Firebase optimisation)
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

/** Returns the phase index (0-3) based on phase goals or null. Thin wrapper
 * over the shared phaseResolver.js — preserves this file's original
 * "null when nothing brackets now" contract (no phases[0] fallback). */
async function resolveActivePhase(firestore, uid, umbrellaGoalId) {
  const resolved = await resolveActivePhaseShared(firestore, uid, umbrellaGoalId);
  if (!resolved || !resolved.phase) return null;
  return { phaseIndex: resolved.phaseIndex, phase: resolved.phase };
}

/**
 * Weekly session counts for the active phase.
 *
 * Read from `trainingPlan.weeklySessions` on the phase goal — data, editable in the app,
 * per phase. The hardcoded table this replaces covered swim and bike only, at one or two
 * sessions each, and knew nothing of run, strength, walk, climb or hike. It also bore no
 * relation to what Jim had configured: it asked for one swim a week where his own plan has
 * two, and one bike where he has three.
 *
 * The literals survive as a fallback for a phase with no trainingPlan yet, so a user who
 * has configured nothing still gets something.
 */
function phaseSessionTargets(phaseIndex, phase) {
  const configured = phase?.trainingPlan?.weeklySessions;
  if (configured && typeof configured === 'object') {
    return {
      swim: Number(configured.swim) || 0,
      // Both bike variants count toward the same weekly target — a ride is a ride
      // whether or not the wheels moved.
      bike: (Number(configured.bike_outdoor) || 0) + (Number(configured.bike_indoor) || 0),
      run: Number(configured.run) || 0,
      strength: Number(configured.strength) || 0,
      walk: Number(configured.walk) || 0,
      source: 'trainingPlan',
    };
  }
  const fallback = [
    { swim: 1, bike: 1 }, // Phase 0 — Base
    { swim: 2, bike: 2 }, // Phase 1 — Build
    { swim: 2, bike: 3 }, // Phase 2 — Peak
    { swim: 1, bike: 1 }, // Phase 3 — Taper
  ];
  return { ...(fallback[phaseIndex] ?? fallback[0]), source: 'default_table' };
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
  const targets = phaseSessionTargets(phaseIndex, phaseResult?.phase);

  // The athlete's own weekly windows. Sessions are placed inside these wherever one
  // exists for the activity; the hardcoded hours below are only a fallback now.
  const healthSlots = await loadHealthSlots(firestore, uid);

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
    // The programme decides what and which day; his own Run window decides the hour.
    const placement = startForSession(
      healthSlots, 'run', DateTime.fromISO(event.date, { zone: TZ }), '06:30',
    );
    const startDt = placement.start;
    // The programme's own duration wins — a 12km long run is not a 60-minute slot. The
    // slot only supplies a length when the programme did not state one.
    const endDt = startDt.plus({ minutes: event.durationMin || placement.durationMin || 60 });
    const ref = firestore.collection('calendar_blocks').doc();
    batch.set(ref, {
      ownerUid: uid,
      title: event.title,
      start: startDt.toMillis(),
      end: endDt.toMillis(),
      source: 'coach_runner',
      entityType: 'fitness',
      theme: 'health',
      activity: 'run',
      placementSource: placement.source,
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
      // Strength, in his own S&C window where he has one — the 05:30 slots before work.
      const placement = startForSession(
        healthSlots, 'strength', DateTime.fromISO(event.date, { zone: TZ }), '06:00',
      );
      const startDt = placement.start;
      const endDt = startDt.plus({ minutes: event.durationMin || placement.durationMin || 60 });
      const ref = firestore.collection('calendar_blocks').doc();
      batch.set(ref, {
        ownerUid: uid,
        title: event.title,
        start: startDt.toMillis(),
        end: endDt.toMillis(),
        source: 'coach_crossfit',
        entityType: 'fitness',
        theme: 'health',
        activity: 'strength',
        placementSource: placement.source,
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

  /**
   * Where a session of this activity could go over the next seven days.
   *
   * His own slots first, in date order — Tuesday 06:30 for a swim, Saturday 18:00 for a
   * bike. Only when he has configured none for that activity does this fall back to the
   * old behaviour: any free day at 07:00, weekends preferred for the bike.
   *
   * The fallback is deliberately kept rather than deleted. A user with no theme plan at
   * all still needs somewhere to put a session, and that is what it was written for; it
   * was only ever wrong as the *primary* path.
   */
  const candidatePlacements = (activity, defaultDurationMin, preferWeekend) => {
    const days = [];
    for (let i = 0; i < 7; i++) {
      const day = nowDt.plus({ days: i }).startOf('day');
      const dayStr = day.toISODate();
      if (dayStr < today) continue;
      days.push({ day, dayStr });
    }

    const own = [];
    for (const { day, dayStr } of days) {
      const slot = slotOnDay(healthSlots, activity, day);
      if (!slot) continue;
      own.push({
        dayStr,
        start: day.plus({ minutes: slot.startMinutes }),
        durationMin: slot.durationMin || defaultDurationMin,
        placementSource: 'theme_allocation',
      });
    }
    if (own.length > 0) return own;

    const ordered = preferWeekend
      ? days.filter(d => d.day.weekday >= 6).concat(days.filter(d => d.day.weekday < 6))
      : days.filter(d => d.day.weekday < 6).concat(days.filter(d => d.day.weekday >= 6));
    return ordered.map(({ day, dayStr }) => ({
      dayStr,
      start: day.set({ hour: 7, minute: 0 }),
      durationMin: defaultDurationMin,
      placementSource: 'default',
    }));
  };

  const fillSessions = (activity, needed, emoji, label, defaultDurationMin, preferWeekend) => {
    let scheduled = 0;
    for (const placement of candidatePlacements(activity, defaultDurationMin, preferWeekend)) {
      if (scheduled >= needed) break;
      if (busyDates.has(placement.dayStr)) continue;
      const endDt = placement.start.plus({ minutes: placement.durationMin });
      const ref = firestore.collection('calendar_blocks').doc();
      batch.set(ref, {
        ownerUid: uid,
        title: `${emoji} ${label} — ${phaseResult?.phase?.title || `Phase ${phaseIndex}`}`,
        start: placement.start.toMillis(),
        end: endDt.toMillis(),
        source: 'coach_triathlon',
        entityType: 'fitness',
        theme: 'health',
        activity,
        placementSource: placement.placementSource,
        aiGenerated: true,
        description: `Coach-scheduled ${label.toLowerCase()} session (${phaseResult?.phase?.title || `Phase ${phaseIndex}`})`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      busyDates.add(placement.dayStr);
      scheduled++;
      created++;
    }
    return scheduled;
  };

  if (bikeNeeded > 0) fillSessions('bike_outdoor', bikeNeeded, '🚴', 'Bike', 90, true);
  if (swimNeeded > 0) fillSessions('swim', swimNeeded, '🏊', 'Swim', 60, false);

  if (created > 0) {
    await batch.commit();
  }

  await logCoachEvent(uid, 'fitness_blocks_scheduled', {
    created,
    skipped,
    phaseIndex,
    swimNeeded,
    bikeNeeded,
    // Whether the counts came from the phase's trainingPlan or the fallback table —
    // otherwise a phase with no plan looks identical to one with a deliberate plan.
    targetSource: targets.source,
    healthSlots: healthSlots.length,
  });

  console.log(`[coachScheduler] uid=${uid} scheduled ${created} blocks, skipped ${skipped}`);
}

exports.scheduleCoachFitnessBlocks = schedulerV2.onSchedule(
  { schedule: '30 4 * * *', timeZone: TZ, region: REGION, memory: '512MiB' },
  async () => {
    const firestore = db();
    console.log('[coachScheduler] scheduleCoachFitnessBlocks starting');

    // Find users with an ironman coach + at least one iCal URL.
    //
    // ONE `!=` per query. Firestore rejects more outright — "Only a single 'NOT_EQUAL',
    // 'NOT_IN', 'IS_NOT_NAN', or 'IS_NOT_NULL' filter allowed per query" — and this used
    // to stack `ironmanUmbrellaGoalId != null` with `runnerProgrammeUrl != null` in both
    // branches. Every night both queries threw, the rejection propagated out of the
    // Promise.all with nothing to catch it, and the scheduled function died before
    // processing a single user. Silently: a scheduled function's throw goes to Cloud
    // Logging and nowhere a person looks.
    //
    // `pollFitnessProgrammes` above does it correctly — one inequality per query, merged
    // in memory — which is exactly why polling ran every four hours while scheduling
    // never ran at all. The two sat forty lines apart.
    //
    // Confirmed 2026-08-05: no `fitness_blocks_scheduled` event has ever been written.
    const [runnerSnap, crossFitSnap] = await Promise.all([
      firestore.collection('profiles').where('runnerProgrammeUrl', '!=', null).get(),
      firestore.collection('profiles').where('crossFitProgrammeUrl', '!=', null).get(),
    ]);

    const uidMap = new Map();
    for (const doc of [...runnerSnap.docs, ...crossFitSnap.docs]) {
      if (uidMap.has(doc.id)) continue;
      const data = doc.data();
      // The second condition, applied in memory rather than as a second inequality.
      if (!data?.ironmanUmbrellaGoalId) continue;
      uidMap.set(doc.id, data);
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

// 512MiB, matching the scheduled functions above.
//
// The callables inherited the 256MiB default and OOM'd at 259MiB once the scheduler began
// loading theme allocations alongside the calendar window and the phase resolver —
// surfacing as a bare HTTP 500. Same shape as enrichStravaHR and aggregateMetricValuesNow
// earlier the same day: a memory ceiling set for a smaller job, and a 500 that says
// nothing about why.
exports.triggerPollFitnessProgrammes = httpsV2.onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 300 }, async (req) => {
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

exports.triggerScheduleCoachFitnessBlocks = httpsV2.onCall({ region: REGION, memory: '512MiB', timeoutSeconds: 300 }, async (req) => {
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
