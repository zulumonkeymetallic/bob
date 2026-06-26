/**
 * sprintForwardPlanner — nightly sprint-wide calendar block generator.
 *
 * For each active sprint, sorts all stories + tasks by effective score
 * (aiCriticalityScore + critical-priority bonus + userPriorityRank boost),
 * then allocates each item's remaining points across future working days,
 * packing blocks back-to-back from WORK_START_HOUR.
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

const MINS_PER_POINT   = 60;   // 1 story point = 1 hour of work
const DEFAULT_DAILY_MINS = 360; // 6 working hours available per day (8h minus meetings/admin)
const WORK_START_HOUR  = 9;    // 09:00 local time
const SOURCE_TAG       = 'sprint_forward_plan';
const RECURRING_TYPES  = new Set(['chore', 'routine', 'habit']);

// ─── helpers ────────────────────────────────────────────────────────────────

function toMs(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const p = Date.parse(String(v));
  return Number.isNaN(p) ? null : p;
}

function effectiveScore(item) {
  const base         = Number(item.aiCriticalityScore || 0);
  const priorityBonus = Number(item.priority || 0) >= 4 ? 500 : 0;
  const r             = Number(item.userPriorityRank || 0);
  const rankBonus     = r >= 1 && r <= 5 ? (6 - r) * 100 : 0;
  return base + priorityBonus + rankBonus;
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
      const sm = toMs(d.data().startTime ?? d.data().startMs);
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
  const items = [
    ...stories.map(s => ({ ...s, _type: 'story', _score: effectiveScore(s), _mins: Math.round(pointsRemaining(s) * MINS_PER_POINT) })),
    ...tasks.map(t => ({ ...t, _type: 'task',  _score: effectiveScore(t), _mins: Math.round(pointsRemaining(t) * MINS_PER_POINT) })),
  ].sort((a, b) => {
    // user-ordered first (rank 1-5 by rank asc), then score desc
    const ar = Number(a.userPriorityRank || 0);
    const br = Number(b.userPriorityRank || 0);
    if (ar > 0 && br === 0) return -1;
    if (ar === 0 && br > 0) return  1;
    if (ar > 0 && br > 0 && ar !== br) return ar - br;
    return b._score - a._score;
  });

  // ── 5. Build working-day capacity map: tomorrow → latest sprint end ────────
  const latestEndMs = Math.max(...activeSprints.map(s => toMs(s.endDate || s.targetDate) || 0));
  const endDt       = DateTime.fromMillis(latestEndMs).setZone(zone);

  const dayCapacity = new Map(); // isoDate → { remainingMins, dt }
  let cursor = tomorrowStart;
  while (cursor <= endDt) {
    if (cursor.weekday >= 1 && cursor.weekday <= 5) { // Mon–Fri
      dayCapacity.set(cursor.toISODate(), { remainingMins: DEFAULT_DAILY_MINS, dt: cursor });
    }
    cursor = cursor.plus({ days: 1 });
  }

  const workDays = Array.from(dayCapacity.keys()).sort();
  if (workDays.length === 0) {
    return { user: uid, blocks: 0, items: 0, reason: 'no working days left in sprint' };
  }

  // ── 6. Allocate items to days ──────────────────────────────────────────────
  const blocksToCreate = [];

  for (const item of items) {
    let minsLeft = item._mins;
    if (minsLeft <= 0) continue;

    for (const iso of workDays) {
      const dayData = dayCapacity.get(iso);
      if (!dayData || dayData.remainingMins <= 0) continue;

      const usedMins   = DEFAULT_DAILY_MINS - dayData.remainingMins;
      const allocated  = Math.min(minsLeft, dayData.remainingMins);
      const startMs    = dayData.dt.set({ hour: WORK_START_HOUR, minute: 0, second: 0, millisecond: 0 }).toMillis()
                         + usedMins * 60 * 1000;
      const endMs      = startMs + allocated * 60 * 1000;

      dayData.remainingMins -= allocated;
      minsLeft -= allocated;

      const ptsAllocated = Math.round((allocated / MINS_PER_POINT) * 10) / 10;
      blocksToCreate.push({
        id: '',   // filled below
        ownerUid: uid,
        // calendarSync resolves entity via storyId/taskId — not entityId/entityType
        ...(item._type === 'story' ? { storyId: item.id } : { taskId: item.id }),
        entityType: item._type,
        title: `${item.title || 'Untitled'} (${ptsAllocated}pt)`,
        // calendarSync reads block.start / block.end for time
        start: startMs,
        end:   endMs,
        startTime: startMs,
        endTime:   endMs,
        startMs,
        endMs,
        date: iso,
        source: SOURCE_TAG,
        persona: String(item.persona || 'personal'),
        sprintId: item.sprintId || null,
        score:    item._score,
        userPriorityRank: item.userPriorityRank || null,
        minsAllocated: allocated,
        googleEventId: null, // explicit null so pushPendingBlocks query catches it
        synced: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      if (minsLeft <= 0) break;
    }
    // items that don't fit within the sprint are simply not given a block
  }

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
