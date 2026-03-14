#!/usr/bin/env node

const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: 'bob20250810',
  });
}

const db = admin.firestore();
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run') || !args.has('--apply');
const sprintCountArg = [...args].find((value) => value.startsWith('--sprints='));
const sprintCount = Math.max(1, Number((sprintCountArg || '--sprints=4').split('=')[1]) || 4);
const MS_IN_DAY = 24 * 60 * 60 * 1000;

function isDone(status) {
  if (typeof status === 'number') return status >= 2;
  return ['done', 'complete', 'completed', 'archived'].includes(String(status || '').trim().toLowerCase());
}

function isChoreLike(task) {
  return ['chore', 'routine', 'habit', 'habitual'].includes(String(task?.type || task?.task_type || '').trim().toLowerCase());
}

async function main() {
  const now = Date.now();
  const [tasksSnap, sprintsSnap] = await Promise.all([
    db.collection('tasks').get(),
    db.collection('sprints').get(),
  ]);

  const upcomingSprints = sprintsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((sprint) => Number(sprint.endDate || 0) >= now - (14 * MS_IN_DAY))
    .sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0))
    .slice(0, sprintCount);

  const upcomingSprintIds = new Set(upcomingSprints.map((sprint) => sprint.id));
  const candidates = tasksSnap.docs
    .map((doc) => ({ id: doc.id, refObj: doc.ref, ...(doc.data() || {}) }))
    .filter((task) => !isDone(task.status))
    .filter((task) => !task.storyId)
    .filter((task) => !isChoreLike(task))
    .filter((task) => Number(task.dueDate || 0) > 0)
    .filter((task) => task.sprintId && upcomingSprintIds.has(String(task.sprintId)));

  console.log(JSON.stringify({
    dryRun,
    sprintCount,
    upcomingSprintIds: [...upcomingSprintIds],
    candidateCount: candidates.length,
    sample: candidates.slice(0, 20).map((task) => ({
      id: task.id,
      ref: task.ref || null,
      title: task.title || null,
      sprintId: task.sprintId || null,
      dueDate: task.dueDate || null,
      dueDateReason: task.dueDateReason || null,
      aiBacklogDeferredReason: task.aiBacklogDeferredReason || null,
    })),
  }, null, 2));

  if (dryRun || candidates.length === 0) return;

  let batch = db.batch();
  let ops = 0;
  for (const task of candidates) {
    batch.set(task.refObj, {
      dueDate: admin.firestore.FieldValue.delete(),
      targetDate: admin.firestore.FieldValue.delete(),
      dueTime: admin.firestore.FieldValue.delete(),
      dueDateReason: admin.firestore.FieldValue.delete(),
      aiBacklogDeferredAt: admin.firestore.FieldValue.delete(),
      aiBacklogDeferredReason: admin.firestore.FieldValue.delete(),
      dueDateLocked: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
    }, { merge: true });
    ops += 1;
    if (ops === 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});