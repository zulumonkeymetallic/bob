/**
 * alignStoriesToGoalSprints — server-side story→sprint realignment.
 *
 * For each story whose parent goal has a startDate, reassign the story
 * to the sprint whose startDate is closest to the goal's startDate
 * (within ±6 months). If no sprint qualifies, move the story to the
 * backlog (sprintId = null).
 *
 * Extracted from functions/index.js so the unified nightly orchestrator
 * can call it directly without circular deps. The manual callable
 * (runAlignStoriesToGoalSprintsNow) and the unified nightly chain both
 * call runForUser.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

function toMillisAlign(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v;
  if (v instanceof Date) return v.getTime();
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? null : parsed;
}

async function runForUser(db, uid, options = {}) {
  const dryRun = !!options.dryRun;

  const goalsSnap = await db.collection('goals').where('ownerUid', '==', uid).get();
  const goalStartByGoalId = new Map();
  const goalTitleByGoalId = new Map();
  for (const g of goalsSnap.docs) {
    const data = g.data();
    const startMs = toMillisAlign(data.startDate);
    if (startMs != null) goalStartByGoalId.set(g.id, startMs);
    if (data.title) goalTitleByGoalId.set(g.id, String(data.title));
  }
  if (goalStartByGoalId.size === 0) {
    return { user: uid, dryRun, moved: 0, backlogged: 0, skipped: 0, wouldMove: [] };
  }

  const sprintsSnap = await db.collection('sprints').where('ownerUid', '==', uid).get();
  const sprints = sprintsSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((s) => Number(s.status) < 2)
    .map((s) => ({ id: s.id, name: s.name || s.id, startMs: toMillisAlign(s.startDate) }))
    .filter((s) => s.startMs != null)
    .sort((a, b) => a.startMs - b.startMs);
  const sprintNameById = new Map(sprints.map((s) => [s.id, s.name]));

  const targetSprintIdByGoalId = new Map();
  for (const [goalId, goalStart] of goalStartByGoalId.entries()) {
    let best = null;
    let bestDelta = Infinity;
    for (const s of sprints) {
      const d = Math.abs(s.startMs - goalStart);
      if (d < bestDelta) { best = s; bestDelta = d; }
    }
    targetSprintIdByGoalId.set(goalId, best && bestDelta <= SIX_MONTHS_MS ? best.id : null);
  }

  const storiesSnap = await db.collection('stories').where('ownerUid', '==', uid).get();
  let moved = 0, backlogged = 0, skipped = 0;
  const wouldMove = [];
  const batch = dryRun ? null : db.batch();
  let writes = 0;
  for (const doc of storiesSnap.docs) {
    const s = doc.data();
    const status = Number(s.status);
    if (Number.isFinite(status) && status >= 2) { skipped++; continue; }
    if (s.sprintAlignmentOverride === true) { skipped++; continue; }
    const currentSprintId = s.sprintId ? String(s.sprintId) : null;
    if (!currentSprintId) { skipped++; continue; }
    const goalId = s.goalId ? String(s.goalId) : null;
    if (!goalId || !targetSprintIdByGoalId.has(goalId)) { skipped++; continue; }
    const targetId = targetSprintIdByGoalId.get(goalId);
    if (targetId === currentSprintId) { skipped++; continue; }

    const moveRecord = {
      storyId: doc.id,
      storyTitle: s.title || 'Untitled',
      goalId,
      goalTitle: goalTitleByGoalId.get(goalId) || null,
      goalStartDateMs: goalStartByGoalId.get(goalId) || null,
      fromSprintId: currentSprintId,
      fromSprintName: sprintNameById.get(currentSprintId) || currentSprintId,
      toSprintId: targetId,
      toSprintName: targetId ? (sprintNameById.get(targetId) || targetId) : '(backlog)',
    };
    wouldMove.push(moveRecord);

    if (!dryRun) {
      batch.update(doc.ref, {
        sprintId: targetId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastAlignedToGoalSprintAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      writes++;

      const activityRef = db.collection('activity_stream').doc();
      batch.set(activityRef, {
        id: activityRef.id,
        ownerUid: uid,
        entityId: doc.id,
        entityType: 'story',
        activityType: 'updated',
        description: targetId
          ? `Auto-aligned story to sprint matching parent goal's start date`
          : `Auto-moved story to backlog (no sprint within 6 months of parent goal's start date)`,
        source: 'align_stories_nightly',
        payload: { fromSprintId: currentSprintId, toSprintId: targetId, goalId },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
      writes++;
    }

    if (targetId) moved++; else backlogged++;

    if (!dryRun && writes >= 400) {
      await batch.commit();
      console.warn('[align_stories_nightly] batch full at 400 writes for user', uid, '— remaining stories will align next run');
      return { user: uid, dryRun, moved, backlogged, skipped, wouldMove, truncated: true };
    }
  }
  if (!dryRun && writes > 0) await batch.commit();
  return { user: uid, dryRun, moved, backlogged, skipped, wouldMove };
}

async function runForAllUsers() {
  const db = admin.firestore();
  const profiles = await db.collection('profiles').get().catch(() => ({ docs: [] }));
  const results = [];
  for (const profile of profiles.docs) {
    const uid = profile.id;
    try {
      const r = await runForUser(db, uid);
      results.push(r);
    } catch (e) {
      console.error('[align_stories_nightly] user failed', uid, e?.message || e);
      results.push({ user: uid, error: String(e?.message || e) });
    }
  }
  console.log('[align_stories_nightly] complete', JSON.stringify(results));
  return { ok: true, results };
}

module.exports = {
  runForUser,
  runForAllUsers,
  toMillisAlign,
  SIX_MONTHS_MS,
};
