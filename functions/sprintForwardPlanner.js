/**
 * sprintForwardPlanner — nightly sprint-wide calendar block generator.
 *
 * For each active sprint, sorts all stories + tasks by effective score
 * (aiCriticalityScore + critical-priority bonus + userPriorityRank boost),
 * then allocates each item's remaining points across future working days,
 * packing blocks into free slots derived from the waking window (05:00–21:00) minus GCal commitments.
 *
 * Produces calendar_blocks with source='sprint_forward_plan'.
 * The existing calendarSync step pushes these to Google Calendar.
 *
 * Step 6 of the nightly chain — runs after runCalendarPlanner so today's
 * schedule is already set; this handles tomorrow → sprint end.
 */

'use strict';

const admin = require('firebase-admin');
const { DateTime } = require('luxon');

if (!admin.apps.length) admin.initializeApp();

const MINS_PER_POINT    = 60;   // 1 story point = 1 hour of work
const WAKING_START_HOUR = 5;    // 05:00 — sleep ends
const WAKING_END_HOUR   = 21;   // 21:00 — sleep begins
const WAKING_MINS       = (WAKING_END_HOUR - WAKING_START_HOUR) * 60; // 960
const SOURCE_TAG        = 'sprint_forward_plan';
// Gaps shorter than this are treated as unusable dead space rather than a real slot —
// without this floor, every few-minute gap between GCal/habit blocks became its own
// tiny sprint-item chip on the calendar.
const MIN_SLOT_MINS     = 15;
const RECURRING_TYPES   = new Set(['chore', 'routine', 'habit']);
// Must match calendarSync.js's GCAL_FUTURE_DAYS. This is the furthest out that a
// real Google Calendar event or recurring instance is guaranteed to have been synced
// into calendar_blocks. Scheduling beyond this point means planning into a calendar
// window BOB genuinely cannot see yet — real events sync in later and can retroactively
// collide with whatever was placed there blind. Confirmed live in production
// 2026-07-16: 25 personal items landed directly on top of real recurring calendar
// events (swim, sauna, macro logging) that were beyond this horizon at planning time.
const CALENDAR_VISIBILITY_HORIZON_DAYS = 90;
const MS_IN_DAY = 86_400_000;

// ─── helpers ────────────────────────────────────────────────────────────────

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const p = Date.parse(String(v));
  return Number.isNaN(p) ? null : p;
}

function parsePriorityBonus(priority) {
  const p = String(priority || '').toUpperCase().trim().replace(/^P/, '');
  if (p === '1' || p === 'CRITICAL') return 500;
  if (p === '2' || p === 'HIGH')     return 400;
  if (p === '3' || p === 'MEDIUM')   return 200;
  if (p === '4' || p === 'LOW')      return 100;
  const n = Number(priority);
  if (Number.isFinite(n) && n >= 1 && n <= 4) return Math.max(0, (5 - n) * 100);
  return 0;
}

// Matches isPinnedStory() in alignStoriesToGoalSprints.js — a story/task counts as
// pinned via ANY of flag, a manual rank 1-5, or the AI Top-3-for-day flag. Kept in sync
// so "is this pinned" reads the same answer everywhere in the planner stack; before this,
// effectiveScore() only checked userPriorityFlag, so a rank-only item (flag left false)
// scored as unpinned here while sorting as pinned below — a real item hit this exact split.
function isPinnedItem(item) {
  if (item.userPriorityFlag === true) return true;
  const r = Number(item.userPriorityRank);
  if (Number.isFinite(r) && r >= 1 && r <= 5) return true;
  if (item.aiTop3ForDay === true) return true;
  return false;
}

function effectiveScore(item) {
  const base      = Number(item.aiCriticalityScore || 0);
  const priBonus  = parsePriorityBonus(item.priority);
  const r         = Number(item.userPriorityRank || 0);
  const rankBonus = r >= 1 && r <= 5 ? (6 - r) * 100 : 0;
  // User-pinned items get a large floor bonus so they always beat unranked items
  const pinBonus  = isPinnedItem(item) ? 1000 : 0;
  return base + priBonus + rankBonus + pinBonus;
}

function pointsRemaining(item) {
  const rem = Number(item.pointsRemaining);
  if (Number.isFinite(rem) && rem > 0) return rem;
  const pts = Number(item.points);
  if (Number.isFinite(pts) && pts > 0) {
    const pct = Math.min(100, Math.max(0, Number(item.progressPct || 0)));
    return Math.max(0.5, pts * (1 - pct / 100));
  }
  return 1; // default 1h if no points data
}

function isDoneStatus(status) {
  const s = String(status ?? '').toLowerCase().trim();
  return s === '4' || s === 'done' || s === 'complete' || s === 'completed';
}

// ─── capacity helpers ────────────────────────────────────────────────────────

/**
 * Fetch committed calendar blocks (gcal + theme_allocation) for a date range
 * and return a per-day map of free slots within the waking window.
 *
 * A "free slot" is a continuous interval not covered by any committed block.
 * Returns Map<isoDate, [{startMs, endMs}]> — slots are non-overlapping and sorted.
 */
async function buildFreeSlotMap(db, uid, fromMs, untilMs, zone) {
  const committedSnap = await db.collection('calendar_blocks')
    .where('ownerUid', '==', uid)
    .where('start', '>=', fromMs)
    .where('start', '<',  untilMs)
    .get();

  // Group committed blocks by iso date, clamped to waking window
  const busyByDay = new Map(); // isoDate → [{s, e}]

  for (const doc of committedSnap.docs) {
    const data = doc.data();
    const src  = String(data.source || '');
    // Only hard commitments reduce capacity; BOB's own plan output does not.
    // work_shift_allocation is a hard day-job commitment and must count as busy.
    if (src !== 'gcal' && src !== 'theme_allocation' && src !== 'work_shift_allocation') continue;
    if (data.status === 'superseded') continue;

    const blockStart = toMs(data.start);
    const blockEnd   = toMs(data.end ?? (data.start + 3_600_000));
    if (!blockStart || !blockEnd) continue;

    const isoDate = DateTime.fromMillis(blockStart).setZone(zone).toISODate();
    const dayDt   = DateTime.fromISO(isoDate, { zone });
    const wakingStart = dayDt.set({ hour: WAKING_START_HOUR, minute: 0, second: 0, millisecond: 0 }).toMillis();
    const wakingEnd   = dayDt.set({ hour: WAKING_END_HOUR,   minute: 0, second: 0, millisecond: 0 }).toMillis();

    const s = Math.max(blockStart, wakingStart);
    const e = Math.min(blockEnd,   wakingEnd);
    if (e <= s) continue;

    const existing = busyByDay.get(isoDate) || [];
    existing.push({ s, e });
    busyByDay.set(isoDate, existing);
  }

  // For each day in the range, subtract busy intervals from the waking window
  const freeSlotMap = new Map(); // isoDate → [{startMs, endMs}]
  let cursor = DateTime.fromMillis(fromMs).setZone(zone).startOf('day');
  const endDt = DateTime.fromMillis(untilMs).setZone(zone);

  while (cursor <= endDt) {
    const iso = cursor.toISODate();
    const wakingStart = cursor.set({ hour: WAKING_START_HOUR, minute: 0, second: 0, millisecond: 0 }).toMillis();
    const wakingEnd   = cursor.set({ hour: WAKING_END_HOUR,   minute: 0, second: 0, millisecond: 0 }).toMillis();

    const busy = (busyByDay.get(iso) || [])
      .sort((a, b) => a.s - b.s);

    // Subtract busy intervals from [wakingStart, wakingEnd]
    const free = [];
    let pos = wakingStart;
    for (const { s, e } of busy) {
      if (s > pos) free.push({ startMs: pos, endMs: Math.min(s, wakingEnd) });
      pos = Math.max(pos, e);
      if (pos >= wakingEnd) break;
    }
    if (pos < wakingEnd) free.push({ startMs: pos, endMs: wakingEnd });

    // Drop slivers below MIN_SLOT_MINS — an unfiltered gap list happily turns every
    // 2–10 minute gap between GCal/habit blocks into its own tiny sprint-item chip,
    // which is what reads as calendar clutter even though nothing technically overlaps.
    freeSlotMap.set(iso, free.filter(sl => (sl.endMs - sl.startMs) >= MIN_SLOT_MINS * 60_000));
    cursor = cursor.plus({ days: 1 });
  }

  return freeSlotMap;
}

/**
 * Total available minutes for a day from its free slots.
 */
function availableMinsForDay(freeSlots) {
  return freeSlots.reduce((sum, sl) => sum + (sl.endMs - sl.startMs) / 60_000, 0);
}

// ─── per-user run ────────────────────────────────────────────────────────────

async function runForUser(db, uid, options = {}) {
  const dryRun   = !!options.dryRun;
  const zone     = options.timezone || 'Europe/London';
  const nowLocal = DateTime.now().setZone(zone);
  const todayIso = nowLocal.toISODate();

  // Tomorrow's start — we don't overwrite today (existing planner owns today)
  const tomorrowStart = nowLocal.plus({ days: 1 }).startOf('day');

  // ── 1. Active sprints ──────────────────────────────────────────────────────
  const sprintsSnap = await db.collection('sprints').where('ownerUid', '==', uid).get();
  const activeSprints = sprintsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => {
      const status = Number(s.status ?? -1);
      if (status >= 2) return false; // closed / cancelled
      if (String(s.persona || '').toLowerCase() !== 'personal') return false; // work sprints excluded
      const endMs = toMs(s.endDate || s.targetDate);
      if (!endMs) return false;
      return endMs >= tomorrowStart.toMillis(); // has at least tomorrow left
    });

  if (activeSprints.length === 0) {
    return { user: uid, skipped: true, reason: 'no active sprints with remaining days' };
  }

  const activeSprintIds = new Set(activeSprints.map(s => s.id));

  // ── 2. Clean up old sprint_forward_plan blocks (future only) ──────────────
  if (!dryRun) {
    const oldSnap = await db.collection('calendar_blocks')
      .where('ownerUid', '==', uid)
      .where('source', '==', SOURCE_TAG)
      .get();
    const tomorrowMs = tomorrowStart.toMillis();
    const delBatch = db.batch();
    let delCount = 0;
    for (const d of oldSnap.docs) {
      const sm = toMs(d.data().start ?? d.data().startTime ?? d.data().startMs);
      if (sm == null || sm >= tomorrowMs) {
        delBatch.delete(d.ref);
        delCount++;
      }
    }
    if (delCount > 0) await delBatch.commit();
  }

  // ── 3. Load sprint items ───────────────────────────────────────────────────
  const [storiesSnap, tasksSnap] = await Promise.all([
    db.collection('stories').where('ownerUid', '==', uid).get(),
    db.collection('tasks').where('ownerUid', '==', uid).get(),
  ]);

  const stories = storiesSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => s.sprintId && activeSprintIds.has(s.sprintId))
    .filter(s => !isDoneStatus(s.status))
    .filter(s => String(s.persona || '').toLowerCase() === 'personal');

  const tasks = tasksSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.sprintId && activeSprintIds.has(t.sprintId))
    .filter(t => !isDoneStatus(t.status))
    .filter(t => !RECURRING_TYPES.has(String(t.type || '').toLowerCase()))
    .filter(t => String(t.persona || '').toLowerCase() === 'personal');

  if (stories.length === 0 && tasks.length === 0) {
    return { user: uid, blocks: 0, items: 0, reason: 'no incomplete items in active sprints' };
  }

  // ── 4. Score and sort ──────────────────────────────────────────────────────
  // Sprints here include anything status<2 — in practice that's not just tight 2-3 week
  // active sprints but also long-running "bucket" sprints holding hundreds of
  // never-triaged backlog items (confirmed live 2026-07-22: one such sprint held 828
  // stories, median AI score 16, 500+ scoring under 20). Without a floor, once the day's
  // pinned/Top3 items are satisfied the greedy allocator kept reaching further into that
  // pile to fill leftover capacity — which is why near-random low-value stories kept
  // landing on the calendar. Pinned/Top3 items always bypass this floor; anything else
  // below it stays in the backlog (still visible everywhere else in the app) until a
  // human actually prioritises it, instead of auto-claiming calendar time.
  const MIN_SCORE_TO_SCHEDULE = 20;
  const isCalendarEligible = (item) => isPinnedItem(item) || Number(item.aiCriticalityScore || 0) >= MIN_SCORE_TO_SCHEDULE;

  const items = [
    ...stories.filter(isCalendarEligible).map(s => ({ ...s, _type: 'story', _score: effectiveScore(s), _mins: Math.round(pointsRemaining(s) * MINS_PER_POINT) })),
    ...tasks.filter(isCalendarEligible).map(t => ({ ...t, _type: 'task',  _score: effectiveScore(t), _mins: Math.round(pointsRemaining(t) * MINS_PER_POINT) })),
  ].sort((a, b) => {
    // 1. Human-prioritised (manual rank 1-5, ascending) always first.
    const ar = Number(a.userPriorityRank || 0);
    const br = Number(b.userPriorityRank || 0);
    if (ar > 0 && br === 0) return -1;
    if (ar === 0 && br > 0) return  1;
    if (ar > 0 && br > 0 && ar !== br) return ar - br;
    // 2. AI-ranked Top 3 next (this tier was previously missing entirely — Top 3
    // items were falling through to plain score order, same as everything else).
    const at = a.aiTop3ForDay === true ? 1 : 0;
    const bt = b.aiTop3ForDay === true ? 1 : 0;
    if (at !== bt) return bt - at;
    // 3. Stories fill ahead of tasks.
    if (a._type !== b._type) return a._type === 'story' ? -1 : 1;
    // 4. AI score, descending.
    return b._score - a._score;
  });

  // ── 5. Build GCal- and work-block-aware free-slot map: tomorrow → sprint end ─
  // Real work_shift_allocation blocks (materialised from the user's theme plan) are
  // treated as busy so personal items never land on top of an actual scheduled work
  // block. Where no work block exists, that time stays available — no hardcoded hours.
  // The scheduling horizon itself is capped at CALENDAR_VISIBILITY_HORIZON_DAYS: beyond
  // that point real calendar data isn't guaranteed to exist yet, so nothing gets
  // scheduled there this run — it's picked up on a later run once that window is
  // visible, rather than being placed blind and risking a retroactive collision.
  const sprintEndMs = Math.max(...activeSprints.map(s => toMs(s.endDate || s.targetDate) || 0));
  const visibilityHorizonMs = Date.now() + CALENDAR_VISIBILITY_HORIZON_DAYS * MS_IN_DAY;
  const latestEndMs = Math.min(sprintEndMs, visibilityHorizonMs);
  const freeSlotMap = await buildFreeSlotMap(db, uid, tomorrowStart.toMillis(), latestEndMs + 86_400_000, zone);

  // day state: remaining free-slot queue per day (mutable pointers into the slot list)
  // We clone the slot arrays so we can consume them as items are allocated.
  const daySlots = new Map(); // isoDate → [{startMs, endMs}] (remaining free time)
  for (const [iso, slots] of freeSlotMap) {
    daySlots.set(iso, slots.map(sl => ({ ...sl }))); // shallow clone
  }

  const workDays = Array.from(daySlots.keys()).sort();
  if (workDays.length === 0) {
    return { user: uid, blocks: 0, items: 0, reason: 'no working days left in sprint' };
  }

  // ── 6. Allocate items into free slots ─────────────────────────────────────
  // Day-major, not item-major: draining one item fully across every day before
  // touching the next let whichever pinned/Top3 item sorted first (including exact
  // rank ties — two stories sharing userPriorityRank=1 hit this in production on
  // 2026-07-23) swallow 100% of a sparse day's free slots, leaving sibling Top3 items
  // with zero presence that day despite being equally pinned. Pinned/Top3 items now
  // round-robin through each day's capacity in bounded turns whenever more than one of
  // them is still competing for that day, so the day's gaps are shared instead of
  // claimed entirely by one item; the moment only one contender is left for a day it
  // reverts to filling at full speed (no artificial fragmentation for the common case).
  const ROUND_ROBIN_CHUNK_MINS = 45;
  const blocksToCreate = [];
  const minsLeftById = new Map(items.map(item => [item.id, item._mins]));
  const priorityItems = items.filter(isPinnedItem);
  const regularItems  = items.filter(item => !isPinnedItem(item));

  const allocateFromDay = (item, slots, iso, capMins) => {
    let minsLeft = minsLeftById.get(item.id) || 0;
    let capLeft  = capMins == null ? minsLeft : Math.min(minsLeft, capMins);
    while (capLeft > 0 && minsLeft > 0 && slots.length > 0) {
      const slot = slots[0];
      const slotMins = (slot.endMs - slot.startMs) / 60_000;
      if (slotMins <= 0) { slots.shift(); continue; }

      const allocated  = Math.min(minsLeft, capLeft, slotMins);
      const blockStart = slot.startMs;
      const blockEnd   = blockStart + allocated * 60_000;

      slot.startMs += allocated * 60_000;
      if (slot.startMs >= slot.endMs) slots.shift();

      minsLeft -= allocated;
      capLeft  -= allocated;

      const ptsAllocated = Math.round((allocated / MINS_PER_POINT) * 10) / 10;
      blocksToCreate.push({
        id: '',
        ownerUid: uid,
        ...(item._type === 'story' ? { storyId: item.id } : { taskId: item.id }),
        entityType: item._type,
        title: `${item.title || 'Untitled'} (${ptsAllocated}pt)`,
        start:     blockStart,
        end:       blockEnd,
        startTime: blockStart,
        endTime:   blockEnd,
        startMs:   blockStart,
        endMs:     blockEnd,
        date: iso,
        source: SOURCE_TAG,
        status: 'planned',
        aiGenerated: true,
        persona: String(item.persona || 'personal'),
        sprintId: item.sprintId || null,
        score:    item._score,
        userPriorityRank: item.userPriorityRank || null,
        minsAllocated: allocated,
        googleEventId: null,
        synced: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    minsLeftById.set(item.id, minsLeft);
  };

  for (const iso of workDays) {
    const slots = daySlots.get(iso);
    if (!slots || slots.length === 0) continue;

    // Priority pass: fair-share this day's capacity among competing pinned/Top3 items.
    while (slots.length > 0) {
      const active = priorityItems.filter(item => (minsLeftById.get(item.id) || 0) > 0);
      if (active.length === 0) break;
      if (active.length === 1) {
        allocateFromDay(active[0], slots, iso, null);
        break;
      }
      let progressed = false;
      for (const item of active) {
        if (slots.length === 0) break;
        const before = minsLeftById.get(item.id);
        allocateFromDay(item, slots, iso, ROUND_ROBIN_CHUNK_MINS);
        if (minsLeftById.get(item.id) !== before) progressed = true;
      }
      if (!progressed) break;
    }

    // Greedy pass: anything still unfilled today (leftover priority mins beyond their
    // fair share, plus all regular/non-pinned items) fills the remaining gaps in
    // existing score order.
    for (const item of [...priorityItems, ...regularItems]) {
      if (slots.length === 0) break;
      if ((minsLeftById.get(item.id) || 0) <= 0) continue;
      allocateFromDay(item, slots, iso, null);
    }
  }
  // items that don't fit within the sprint are simply not given a block

  // ── 7. Write blocks in batches ────────────────────────────────────────────
  let written = 0;
  if (!dryRun && blocksToCreate.length > 0) {
    const BATCH_LIMIT = 400;
    for (let i = 0; i < blocksToCreate.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      const chunk = blocksToCreate.slice(i, i + BATCH_LIMIT);
      for (const block of chunk) {
        const ref = db.collection('calendar_blocks').doc();
        batch.set(ref, { ...block, id: ref.id });
        written++;
      }
      await batch.commit();
    }
  }

  console.log(`[sprint_forward_plan] uid=${uid} items=${items.length} blocks=${dryRun ? blocksToCreate.length + '(dry)' : written}`);
  return { user: uid, items: items.length, blocks: dryRun ? blocksToCreate.length : written, dryRun };
}

// ─── all-users runner ─────────────────────────────────────────────────────────

async function runForAllUsers() {
  const db = admin.firestore();
  const profilesSnap = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  const results = [];
  for (const profile of profilesSnap.docs) {
    const uid = profile.id;
    try {
      const profileData = profile.data() || {};
      const timezone = String(profileData.timezone || 'Europe/London');
      const r = await runForUser(db, uid, { timezone });
      results.push(r);
    } catch (e) {
      console.error('[sprint_forward_plan] user failed', uid, e?.message || e);
      results.push({ user: uid, error: String(e?.message || e) });
    }
  }
  console.log('[sprint_forward_plan] complete', JSON.stringify(results));
  return { ok: true, results };
}

module.exports = { runForUser, runForAllUsers };
