/**
 * sprintForwardPlanner — "extra safety" fallback calendar block generator.
 *
 * Pinned/Top3 items are NOT handled here — that's runCalendarPlannerJob's job
 * (functions/services/schedulingService.js, step 6, runs before this one): it books each
 * item's full remaining duration as one consolidated block and can displace movable GCal
 * entries (a casual Walk/Meditate) to make room, while Work (Main Gig) and any event with
 * real attendees stay untouchable. This function used to also schedule pinned/Top3 items,
 * which left fragmented leftover blocks that runCalendarPlannerJob's own "already
 * scheduled?" check then read as "handled" on every subsequent night — starving it of the
 * chance to ever place those items properly (fixed 2026-07-22, see git history for detail).
 *
 * What remains: TASKS ONLY (no stories), due on the specific day being planned, sorted by
 * AI score, pointsRemaining >= 1pt — filling whatever free capacity is genuinely left over
 * once the real placement job has done its work. Nothing here is spread across days; a
 * task that doesn't fully fit its own due day just gets whatever fits and no more.
 *
 * Produces calendar_blocks with source='sprint_forward_plan'.
 * The existing calendarSync step pushes these to Google Calendar.
 *
 * Step 8 of the nightly chain — runs after runCalendarPlanner so today's
 * schedule is already set; this handles tomorrow → sprint end.
 */

'use strict';

const admin = require('firebase-admin');
const { DateTime } = require('luxon');
const { isOrchestrationLocked, isManuallyPlacedBlock } = require('./utils/manualPlacement');
const { PLANNING_HORIZON_DAYS } = require('./lib/planningHorizon');

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

// Bonus by CANONICAL rank, where 4 is Critical and 1 is Low.
const PRIORITY_BONUS_BY_RANK = { 4: 500, 3: 400, 2: 200, 1: 100 };

/**
 * Priority's contribution to effectiveScore.
 *
 * ## The inversion this replaces
 *
 * The old body stripped a leading "P" and then read the bare number on the P-scale:
 *
 *     .replace(/^P/, '')
 *     if (p === '1' || p === 'CRITICAL') return 500;
 *     ...
 *     if (p === '4' || p === 'LOW')      return 100;
 *
 * That is right for "P1".."P4" and right for the word forms, but wrong for a bare number
 * — and a bare number is what nearly all the data is. On a live snapshot, 669 stories
 * carry priority as an integer and only ~47 as a string. So a stored `4` (Critical) was
 * scored 100 and a stored `1` (Low) was scored 500: **the planner gave its largest boost
 * to the least important work, every night.**
 *
 * The numeric scale runs 4 = Critical down to 1 = Low. That is not a guess — it is what
 * the importer writes (`importNormalise.normalisePriority` maps "P1" to 4 and comments
 * that the P-scale and the numeric scale are NOT interchangeable), what
 * `priorityUtils.isCriticalPriority` reads (`>= 4`), what the iOS labels and dot colours
 * render, what `nightlyOrchestration.js` already assumed twelve hundred lines away
 * (`Number(priority) >= 4 ? 500 : 0`), and what the data shows — Jim's pinned stories
 * carry 4, 4, 3 and 2.
 *
 * P1 is the highest on the P-scale and 1 is the lowest on the numeric one, so the two must
 * never be collapsed by stripping the prefix. They are converted separately below.
 *
 * Higher priority therefore scores higher and is scheduled first; lower priority scores
 * lower and falls to later days as capacity fills.
 */
function parsePriorityBonus(priority) {
  const raw = String(priority ?? '').trim().toUpperCase();
  if (!raw) return 0;

  // Word forms are unambiguous whichever scale the writer had in mind.
  if (raw === 'CRITICAL' || raw === 'URGENT') return PRIORITY_BONUS_BY_RANK[4];
  if (raw === 'HIGH') return PRIORITY_BONUS_BY_RANK[3];
  if (raw === 'MEDIUM' || raw === 'MED' || raw === 'NORMAL') return PRIORITY_BONUS_BY_RANK[2];
  if (raw === 'LOW') return PRIORITY_BONUS_BY_RANK[1];

  // "P1".."P4" — the P-scale, where P1 is the HIGHEST. Mirrors the importer's `5 - n`.
  const pScale = raw.match(/^P([1-4])$/);
  if (pScale) return PRIORITY_BONUS_BY_RANK[5 - Number(pScale[1])];

  // A bare number is the stored scale, where 4 is Critical.
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 4) return PRIORITY_BONUS_BY_RANK[n];

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
  // status===1 only — not "anything not closed" (status<2). Backlog-status (0) sprints
  // are routinely used as long-running catch-all buckets (confirmed live 2026-07-22: one
  // held 828 never-triaged stories spanning two months) and must never be treated as
  // schedulable just because they haven't been explicitly closed. Per Jim: only the
  // genuinely active sprint is eligible, full stop — pinned/Top3 items rely on
  // alignStoriesToGoalSprints (runs earlier in the nightly chain) to already be living in
  // this sprint, not on this function reaching into other sprints to find them.
  const sprintsSnap = await db.collection('sprints').where('ownerUid', '==', uid).get();
  const activeSprints = sprintsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(s => {
      if (Number(s.status) !== 1) return false;
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
      const data = d.data();
      // Dragging a block on the calendar edits that block's start/end in place and leaves
      // source='sprint_forward_plan' on it, so this wholesale delete-and-recreate used to
      // wipe the user's move every night and re-place the task wherever the algorithm
      // preferred. A hand-moved block is no longer this job's to reclaim.
      if (isManuallyPlacedBlock(data)) continue;
      const sm = toMs(data.start ?? data.startTime ?? data.startMs);
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

  // ── 4. Tier B only, per Jim 2026-07-22 ─────────────────────────────────────
  // Pinned/Top3 items (former "Tier A") are deliberately NOT handled here anymore.
  // runCalendarPlannerJob (functions/services/schedulingService.js, step 6 — runs
  // BEFORE this one) already owns that job properly: it books each item's full
  // remaining duration as one consolidated block and can displace movable GCal
  // entries (a casual Walk/Meditate) to make room, while Work (Main Gig) and any
  // event with real attendees stay untouchable. The problem was never that this
  // function scheduled pinned items badly — it's that it ALSO scheduled them,
  // leaving fragmented leftover blocks that runCalendarPlannerJob's own
  // "is this already scheduled?" check (collectScheduledMinutesByEntity, which sums
  // ANY block regardless of source) then read as "already handled" on every
  // subsequent night — starving the better, displacement-aware system of the chance
  // to ever place these items properly. Confirmed live 2026-07-22: zero
  // planner_schedule_service blocks existed for any of Jim's 5 pinned stories despite
  // hundreds of sprint_forward_plan fragments. Removing pinned/Top3 from this
  // function's scope lets runCalendarPlannerJob actually do its job.
  //
  // What remains is the "extra safety" fallback only: TASKS ONLY (no stories), due on
  // the specific day being planned, aiCriticalityScore descending, pointsRemaining >= 1
  // (MIN_POINTS_TO_SCHEDULE — nothing under 1pt/1hr may ever claim calendar time), and
  // aiCriticalityScore >= MIN_SCORE_TO_SCHEDULE. That score floor is new: previously this
  // pool had no score gate at all — any due-today task with capacity remaining got a
  // calendar slot regardless of how low its score was, so long as free capacity existed.
  // Confirmed by Jim, 2026-07-24: low-value tasks (score ~51) were consuming calendar
  // slots. Floor set at his explicit instruction. Filters on the raw aiCriticalityScore
  // (what's shown in the UI), not effectiveScore (which can be inflated by priority/rank
  // bonuses) — the floor is meant to reflect genuine AI-assessed importance.
  // This only fills genuine leftover gaps runCalendarPlannerJob didn't use.
  const MIN_POINTS_TO_SCHEDULE = 1;
  const MIN_SCORE_TO_SCHEDULE = 75;

  const getDueMs = (item) => toMs(item.dueDate ?? item.targetDate ?? item.dueDateMs ?? item.dueAt ?? item.due);

  const tierBTaskPool = tasks
    .filter(t => !isPinnedItem(t))
    // Already placed by hand and still inside the window that placement covers — giving it
    // a second block here is what leaves the user's move sitting next to a duplicate.
    .filter(t => !isOrchestrationLocked(t))
    .filter(t => pointsRemaining(t) >= MIN_POINTS_TO_SCHEDULE)
    .filter(t => Number(t.aiCriticalityScore || 0) >= MIN_SCORE_TO_SCHEDULE)
    .map(t => ({ ...t, _type: 'task', _score: effectiveScore(t), _dueMs: getDueMs(t), _mins: Math.round(pointsRemaining(t) * MINS_PER_POINT) }))
    .filter(t => t._dueMs != null);

  // ── 5. Build GCal- and work-block-aware free-slot map: tomorrow → sprint end ─
  // Real work_shift_allocation blocks (materialised from the user's theme plan) are
  // treated as busy so personal items never land on top of an actual scheduled work
  // block. Where no work block exists, that time stays available — no hardcoded hours.
  // The scheduling horizon itself is capped at PLANNING_HORIZON_DAYS (see
  // lib/planningHorizon.js): a sprint can run far longer than BOB can see, and work past
  // the horizon is picked up by a later run once it comes inside the window rather than
  // being placed blind now.
  const sprintEndMs = Math.max(...activeSprints.map(s => toMs(s.endDate || s.targetDate) || 0));
  const planningHorizonMs = Date.now() + PLANNING_HORIZON_DAYS * MS_IN_DAY;
  const latestEndMs = Math.min(sprintEndMs, planningHorizonMs);
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

  // ── 6. Allocate Tier B items into leftover free slots ──────────────────────
  // MIN_BLOCK_MINS enforces "nothing under 1pt/1hr may appear on the calendar" at the
  // chunk level — a slot too small to hold a full floor-sized chunk is left alone rather
  // than sliced up, except for an item's genuine final chunk (finishing off less than a
  // full point of remaining work is fine; carving a sub-floor fragment out of a larger
  // remaining amount is what created the clutter this was built to fix).
  const MIN_BLOCK_MINS = MINS_PER_POINT; // 60
  const blocksToCreate = [];
  const minsLeftById = new Map();

  const allocateFromDay = (item, slots, iso, capMins) => {
    let minsLeft = minsLeftById.get(item.id) ?? item._mins;
    let capLeft  = capMins == null ? minsLeft : Math.min(minsLeft, capMins);
    const minChunk = Math.min(MIN_BLOCK_MINS, minsLeft); // allows a genuine final chunk < floor
    let i = 0;
    while (capLeft > 0 && minsLeft > 0 && i < slots.length) {
      const slot = slots[i];
      const slotMins = (slot.endMs - slot.startMs) / 60_000;
      if (slotMins <= 0) { slots.splice(i, 1); continue; }
      if (slotMins < minChunk) { i += 1; continue; } // too small for this chunk — leave for later

      const allocated  = Math.min(minsLeft, capLeft, slotMins);
      const blockStart = slot.startMs;
      const blockEnd   = blockStart + allocated * 60_000;

      slot.startMs += allocated * 60_000;
      if (slot.startMs >= slot.endMs) { slots.splice(i, 1); } else { i = 0; }

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

    // Tier B, "extra safety" fallback: only tasks due on this exact day, sorted by AI
    // score, fill whatever free capacity exists (runCalendarPlannerJob has already
    // placed pinned/Top3 items elsewhere in the chain). Each task is scheduled entirely
    // within its own due day — not spread across days — so one that doesn't fully fit
    // today simply gets whatever fits today and nothing more.
    const dayStart = DateTime.fromISO(iso, { zone }).startOf('day').toMillis();
    const dayEnd   = DateTime.fromISO(iso, { zone }).endOf('day').toMillis();
    const dueTodayTasks = tierBTaskPool
      .filter(t => t._dueMs >= dayStart && t._dueMs <= dayEnd)
      .sort((a, b) => b._score - a._score);
    for (const t of dueTodayTasks) {
      if (slots.length === 0) break;
      minsLeftById.set(t.id, t._mins);
      allocateFromDay(t, slots, iso, null);
    }
  }
  // Tasks that don't fit their due day are simply not given a block.

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

  console.log(`[sprint_forward_plan] uid=${uid} tierBCandidates=${tierBTaskPool.length} blocks=${dryRun ? blocksToCreate.length + '(dry)' : written}`);
  return { user: uid, items: tierBTaskPool.length, blocks: dryRun ? blocksToCreate.length : written, dryRun };
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

// parsePriorityBonus and effectiveScore are exported for the test suite only. They were
// unreachable from a test, which is how the numeric branch stayed inverted in production.
module.exports = { runForUser, runForAllUsers, parsePriorityBonus, effectiveScore };
