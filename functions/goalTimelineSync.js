/**
 * goalTimelineSync.js — server-side port of the client utils
 * `goalTimelineImpact.ts` and `goalTimelineChanges.ts`.
 *
 * Used by the unified nightly orchestrator to sweep stories whose
 * sprintId no longer aligns with their parent goal's [startDate, endDate]
 * window and reassign them to the nearest open/upcoming sprint.
 *
 * Logic mirrors the client implementation; any divergence should be
 * resolved by porting back to a shared module.
 */

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

function toMillis(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function pickRecommendedSprint(sprints, targetStartMs) {
  const eligible = sprints
    .map((sprint) => ({
      sprint,
      startMs: toMillis(sprint.startDate),
      endMs: toMillis(sprint.endDate),
      status: Number(sprint?.status ?? 0),
    }))
    .filter((item) => item.startMs != null && item.endMs != null && item.status !== 2 && item.status !== 3);

  if (!eligible.length) return null;

  const sorted = [...eligible].sort((a, b) => {
    const aFutureBias = a.startMs >= targetStartMs ? 0 : 1;
    const bFutureBias = b.startMs >= targetStartMs ? 0 : 1;
    if (aFutureBias !== bFutureBias) return aFutureBias - bFutureBias;
    const aDistance = Math.abs(a.startMs - targetStartMs);
    const bDistance = Math.abs(b.startMs - targetStartMs);
    return aDistance - bDistance;
  });

  return sorted[0]?.sprint ?? null;
}

function buildGoalTimelineImpactPlan({ goalId, newStartDate, stories, sprints }) {
  const affectedStories = [];
  const goalStories = stories.filter((story) => story.goalId === goalId);
  for (const story of goalStories) {
    const sprint = sprints.find((candidate) => candidate.id === story.sprintId);
    const recommendedSprint = pickRecommendedSprint(sprints, newStartDate.getTime());
    const recommendationKind = !recommendedSprint
      ? 'no_sprint_available'
      : (recommendedSprint.id === sprint?.id ? 'already_closest' : 'move');
    affectedStories.push({
      id: story.id,
      ref: String(story.ref || story.id),
      title: story.title,
      plannedSprintId: sprint?.id,
      recommendedSprintId: recommendedSprint?.id,
      recommendationKind,
    });
  }
  return { affectedStories };
}

async function applyGoalTimelineChanges(db, { goalId, ownerUid, persona, affectedStories }) {
  if (!Array.isArray(affectedStories) || affectedStories.length === 0) {
    return { movedStoryCount: 0 };
  }
  const batch = db.batch();
  let movedStoryCount = 0;
  for (const story of affectedStories) {
    if (!story?.id) continue;
    if (!story.recommendedSprintId) continue;
    if (story.recommendedSprintId === story.plannedSprintId) continue;
    batch.update(db.collection('stories').doc(story.id), {
      sprintId: story.recommendedSprintId,
      ownerUid,
      persona,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    movedStoryCount += 1;
  }
  if (movedStoryCount === 0) return { movedStoryCount: 0 };
  await batch.commit();
  return { movedStoryCount };
}

/**
 * Iterates every goal with both startDate and endDate set, builds the
 * impact plan against the owner's sprints, and rehomes any stories that
 * drifted out of the goal's window.
 *
 * Per-owner caches sprint and story queries to keep Firestore reads bounded.
 */
async function runNightlyGoalDateSync() {
  const db = admin.firestore();
  const goalsSnap = await db.collection('goals').get();
  console.log(`[nightlyGoalDateSync] Scanning ${goalsSnap.size} goal(s)`);

  // Cache sprints + stories per owner to avoid re-querying for each goal.
  const sprintsByOwner = new Map();
  const storiesByOwner = new Map();

  async function ownerSprints(uid) {
    if (sprintsByOwner.has(uid)) return sprintsByOwner.get(uid);
    const snap = await db.collection('sprints').where('ownerUid', '==', uid).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    sprintsByOwner.set(uid, list);
    return list;
  }
  async function ownerStories(uid) {
    if (storiesByOwner.has(uid)) return storiesByOwner.get(uid);
    const snap = await db.collection('stories').where('ownerUid', '==', uid).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() || {}) }));
    storiesByOwner.set(uid, list);
    return list;
  }

  let goalsProcessed = 0;
  let goalsSkipped = 0;
  let totalStoriesMoved = 0;
  let goalsWithMoves = 0;

  for (const goalDoc of goalsSnap.docs) {
    const goal = goalDoc.data() || {};
    const ownerUid = goal.ownerUid;
    if (!ownerUid) { goalsSkipped += 1; continue; }
    const startMs = toMillis(goal.startDate);
    const endMs = toMillis(goal.endDate);
    if (startMs == null || endMs == null) { goalsSkipped += 1; continue; }

    try {
      const [sprints, stories] = await Promise.all([
        ownerSprints(ownerUid),
        ownerStories(ownerUid),
      ]);
      const linkedStories = stories.filter((s) => s.goalId === goalDoc.id);
      if (linkedStories.length === 0 || sprints.length === 0) {
        goalsProcessed += 1;
        continue;
      }
      const impactPlan = buildGoalTimelineImpactPlan({
        goalId: goalDoc.id,
        newStartDate: new Date(startMs),
        stories: linkedStories,
        sprints,
      });
      const movable = impactPlan.affectedStories.filter((s) => s.recommendationKind === 'move');
      if (movable.length > 0) {
        const persona = (goal.persona === 'work') ? 'work' : 'personal';
        const { movedStoryCount } = await applyGoalTimelineChanges(db, {
          goalId: goalDoc.id,
          ownerUid,
          persona,
          affectedStories: movable,
        });
        if (movedStoryCount > 0) {
          totalStoriesMoved += movedStoryCount;
          goalsWithMoves += 1;
          console.log(`[nightlyGoalDateSync] goal=${goalDoc.id} owner=${ownerUid} moved=${movedStoryCount}`);
        }
      }
      goalsProcessed += 1;
    } catch (err) {
      console.warn(`[nightlyGoalDateSync] goal=${goalDoc.id} failed:`, err?.message || err);
    }
  }

  console.log(`[nightlyGoalDateSync] Done — scanned=${goalsSnap.size} processed=${goalsProcessed} skipped=${goalsSkipped} goalsWithMoves=${goalsWithMoves} totalStoriesMoved=${totalStoriesMoved}`);
  return { goalsProcessed, goalsSkipped, goalsWithMoves, totalStoriesMoved };
}

module.exports = {
  runNightlyGoalDateSync,
  buildGoalTimelineImpactPlan,
  applyGoalTimelineChanges,
  toMillis,
  pickRecommendedSprint,
};
