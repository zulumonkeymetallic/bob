const httpsV2 = require('firebase-functions/v2/https');
const schedulerV2 = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

const SNAPSHOT_COLLECTION = 'global_hierarchy_snapshots';
const SNAPSHOT_VERSION = 'v1';
const SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000;

if (!admin.apps.length) {
  admin.initializeApp();
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value?.toMillis === 'function') {
    try {
      return value.toMillis();
    } catch (_) {
      return null;
    }
  }
  if (value?._seconds != null) {
    return Number(value._seconds) * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isLikelyGoalRef(ref) {
  if (!ref) return false;
  return /^GR-[A-Z0-9-]+$/i.test(String(ref).trim());
}

function normalizeGoal(goalDoc) {
  const data = goalDoc.data() || {};
  return {
    id: goalDoc.id,
    ref: data.ref || null,
    referenceNumber: data.referenceNumber || null,
    title: data.title || null,
    status: data.status ?? null,
    priority: data.priority ?? null,
    points: data.points ?? null,
    dueDate: toMillis(data.dueDate || data.targetDate || data.endDate),
    targetDate: toMillis(data.targetDate || data.endDate),
    theme: data.theme ?? null,
    persona: data.persona || null,
    ownerUid: data.ownerUid || null,
    estimatedCost: data.estimatedCost ?? null,
    linkedPotId: data.linkedPotId || data.potId || null,
    kpis: Array.isArray(data.kpis) ? data.kpis : [],
    gcalLinks: [],
    stories: [],
    metadata: {
      hasGrRef: isLikelyGoalRef(data.ref || data.referenceNumber),
      updatedAt: toMillis(data.updatedAt),
      createdAt: toMillis(data.createdAt),
    },
  };
}

function normalizeStory(storyDoc) {
  const data = storyDoc.data() || {};
  return {
    id: storyDoc.id,
    ref: data.ref || data.referenceNumber || null,
    title: data.title || null,
    goalId: data.goalId || null,
    status: data.status ?? null,
    priority: data.priority ?? null,
    points: data.points ?? null,
    dueDate: toMillis(data.dueDate || data.targetDate),
    sprintId: data.sprintId || null,
    persona: data.persona || null,
    ownerUid: data.ownerUid || null,
    linkedPotId: data.linkedPotId || null,
    tasks: [],
    gcalLinks: [],
    metadata: {
      updatedAt: toMillis(data.updatedAt),
      createdAt: toMillis(data.createdAt),
      acceptanceCriteriaCount: Array.isArray(data.acceptanceCriteria) ? data.acceptanceCriteria.length : 0,
    },
  };
}

function normalizeTask(taskDoc) {
  const data = taskDoc.data() || {};
  const linkedStoryId = data.storyId || (data.parentType === 'story' ? data.parentId : null) || null;
  return {
    id: taskDoc.id,
    ref: data.ref || data.reference || null,
    title: data.title || null,
    goalId: data.goalId || null,
    storyId: linkedStoryId,
    parentId: data.parentId || null,
    parentType: data.parentType || null,
    status: data.status ?? null,
    priority: data.priority ?? null,
    points: data.points ?? null,
    estimateMin: data.estimateMin ?? null,
    estimatedHours: data.estimatedHours ?? null,
    dueDate: toMillis(data.dueDate || data.targetDate || data.dueDateMs),
    persona: data.persona || null,
    ownerUid: data.ownerUid || null,
    linkedPotId: data.linkedPotId || null,
    gcalLinks: [],
    metadata: {
      source: data.source || null,
      autoConverted: data.autoConverted === true,
      convertedToStoryId: data.convertedToStoryId || null,
      updatedAt: toMillis(data.updatedAt),
      createdAt: toMillis(data.createdAt),
    },
  };
}

function normalizeCalendarBlock(blockDoc) {
  const data = blockDoc.data() || {};
  return {
    id: blockDoc.id,
    googleEventId: data.googleEventId || null,
    goalId: data.goalId || null,
    storyId: data.storyId || null,
    taskId: data.taskId || null,
    start: toMillis(data.start),
    end: toMillis(data.end),
    title: data.title || null,
    status: data.status || null,
  };
}

function dedupePush(list, value) {
  if (!value) return;
  if (!list.includes(value)) list.push(value);
}

async function buildUserHierarchySnapshot({ db, userId }) {
  const [goalsSnap, storiesSnap, tasksSnap, blocksSnap] = await Promise.all([
    db.collection('goals').where('ownerUid', '==', userId).get(),
    db.collection('stories').where('ownerUid', '==', userId).get(),
    db.collection('tasks').where('ownerUid', '==', userId).get(),
    db.collection('calendar_blocks').where('ownerUid', '==', userId).get(),
  ]);

  const goals = goalsSnap.docs.map(normalizeGoal);
  const stories = storiesSnap.docs.map(normalizeStory);
  const tasks = tasksSnap.docs.map(normalizeTask);
  const blocks = blocksSnap.docs.map(normalizeCalendarBlock);

  const goalsById = new Map(goals.map((g) => [g.id, g]));
  const storiesById = new Map(stories.map((s) => [s.id, s]));

  for (const story of stories) {
    if (story.goalId && goalsById.has(story.goalId)) {
      goalsById.get(story.goalId).stories.push(story);
    }
  }

  for (const task of tasks) {
    if (task.storyId && storiesById.has(task.storyId)) {
      storiesById.get(task.storyId).tasks.push(task);
    }
  }

  for (const block of blocks) {
    if (block.goalId && goalsById.has(block.goalId)) {
      dedupePush(goalsById.get(block.goalId).gcalLinks, block.googleEventId);
    }
    if (block.storyId && storiesById.has(block.storyId)) {
      dedupePush(storiesById.get(block.storyId).gcalLinks, block.googleEventId);
    }
  }

  let orphanStories = 0;
  let orphanTasks = 0;
  let inferredGoalLinks = 0;

  for (const story of stories) {
    if (story.goalId && !goalsById.has(story.goalId)) orphanStories += 1;
  }
  for (const task of tasks) {
    if (task.goalId && !goalsById.has(task.goalId)) orphanTasks += 1;
    if ((task.metadata?.source || '').toLowerCase().includes('ai') && task.goalId) inferredGoalLinks += 1;
  }

  const generatedAt = Date.now();
  const hierarchy = {
    snapshotVersion: SNAPSHOT_VERSION,
    generatedAt,
    ownerUid: userId,
    hierarchy: {
      goals,
    },
    flat: {
      stories,
      tasks,
      calendarBlocks: blocks,
    },
    stats: {
      goalCount: goals.length,
      storyCount: stories.length,
      taskCount: tasks.length,
      calendarBlockCount: blocks.length,
      orphanStories,
      orphanTasks,
      inferredGoalLinks,
    },
  };

  return hierarchy;
}

async function writeSnapshotForUser({ db, userId }) {
  const snapshot = await buildUserHierarchySnapshot({ db, userId });
  const now = admin.firestore.FieldValue.serverTimestamp();
  await Promise.all([
    db.collection(SNAPSHOT_COLLECTION).doc(userId).set(
      {
        ...snapshot,
        updatedAt: now,
        staleAfterMs: SNAPSHOT_STALE_MS,
      },
      { merge: true }
    ),
    // Write freshness timestamp to profiles so the UI can display "last updated X ago"
    db.collection('profiles').doc(userId).set(
      { lastSnapshotGeneratedAt: now, lastSnapshotGoalCount: snapshot.stats?.goalCount ?? 0 },
      { merge: true }
    ),
  ]);
  return snapshot;
}

const generateGlobalHierarchySnapshots = schedulerV2.onSchedule(
  {
    schedule: 'every 6 hours',
    timeZone: 'UTC',
    region: 'europe-west2',
    memory: '512MiB',
  },
  async () => {
    const db = admin.firestore();
    const usersSnap = await db.collection('profiles').get();
    const startedAt = Date.now();
    let processedUsers = 0;
    let failedUsers = 0;

    for (const userDoc of usersSnap.docs) {
      const userId = userDoc.id;
      try {
        await writeSnapshotForUser({ db, userId });
        processedUsers += 1;
      } catch (error) {
        failedUsers += 1;
        console.error('[global_snapshot] failed user generation', { userId, error: error?.message || error });
      }
    }

    await db.collection('automation_runs').add({
      automation: 'global_hierarchy_snapshot',
      status: failedUsers ? 'completed_with_errors' : 'completed',
      processedUsers,
      failedUsers,
      durationMs: Date.now() - startedAt,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { processedUsers, failedUsers };
  }
);

const exportGlobalHierarchySnapshot = httpsV2.onCall({ region: 'europe-west2', memory: '512MiB' }, async (req) => {
  if (!req.auth?.uid) {
    throw new httpsV2.HttpsError('unauthenticated', 'Authentication required');
  }

  const db = admin.firestore();
  const userId = req.auth.uid;
  const forceRefresh = req.data?.forceRefresh === true;

  const docRef = db.collection(SNAPSHOT_COLLECTION).doc(userId);
  const current = await docRef.get();
  const payload = current.exists ? current.data() || {} : null;
  const generatedAt = Number(payload?.generatedAt || 0);
  const stale = !generatedAt || Date.now() - generatedAt > SNAPSHOT_STALE_MS;

  if (!payload || forceRefresh || stale) {
    const rebuilt = await writeSnapshotForUser({ db, userId });
    return {
      ok: true,
      regenerated: true,
      stale,
      snapshot: rebuilt,
    };
  }

  return {
    ok: true,
    regenerated: false,
    stale: false,
    snapshot: payload,
  };
});

module.exports = {
  generateGlobalHierarchySnapshots,
  exportGlobalHierarchySnapshot,
  buildUserHierarchySnapshot,
};
