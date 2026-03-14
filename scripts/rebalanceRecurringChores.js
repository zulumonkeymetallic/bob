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
const horizonDaysArg = [...args].find((value) => value.startsWith('--days='));
const horizonDays = Math.max(14, Number((horizonDaysArg || '--days=28').split('=')[1]) || 28);
const settleMsArg = [...args].find((value) => value.startsWith('--settle-ms='));
const settleMs = Math.max(0, Number((settleMsArg || '--settle-ms=1500').split('=')[1]) || 1500);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDone(status) {
  if (typeof status === 'number') return status >= 2;
  return ['done', 'complete', 'completed', 'archived'].includes(String(status || '').trim().toLowerCase());
}

function isRecurringChore(task) {
  const type = String(task?.type || task?.task_type || '').trim().toLowerCase();
  if (!['chore', 'routine', 'habit', 'habitual'].includes(type)) return false;
  return !!(
    task.repeatFrequency ||
    task.repeatInterval ||
    (Array.isArray(task.repeatDaysOfWeek) && task.repeatDaysOfWeek.length) ||
    (task.recurrence && (task.recurrence.frequency || task.recurrence.interval || task.recurrence.daysOfWeek))
  );
}

function isUserControlled(task) {
  return task?.dueDateLocked === true || String(task?.dueDateReason || '').trim().toLowerCase() === 'user';
}

async function main() {
  const [tasksSnap, blocksSnap] = await Promise.all([
    db.collection('tasks').get(),
    db.collection('calendar_blocks').get(),
  ]);

  const chores = tasksSnap.docs
    .map((doc) => ({ id: doc.id, refObj: doc.ref, ...(doc.data() || {}) }))
    .filter((task) => !isDone(task.status))
    .filter((task) => isRecurringChore(task))
    .filter((task) => !isUserControlled(task))
    .sort((left, right) => String(left.title || left.id).localeCompare(String(right.title || right.id)));

  const choreIds = new Set(chores.map((task) => task.id));

  const futureCutoff = Date.now() - (24 * 60 * 60 * 1000);
  const blocksToDelete = blocksSnap.docs.filter((doc) => {
    const data = doc.data() || {};
    const source = String(data.source || data.entityType || '').toLowerCase();
    const start = Number(data.start || 0);
    const taskId = String(data.taskId || '').trim();
    return start >= futureCutoff && choreIds.has(taskId) && (source === 'chore' || String(data.entityType || '').toLowerCase() === 'chore');
  });

  console.log(JSON.stringify({
    dryRun,
    horizonDays,
    settleMs,
    recurringChoreCount: chores.length,
    futureChoreBlockCount: blocksToDelete.length,
    sampleChores: chores.slice(0, 20).map((task) => ({
      id: task.id,
      ref: task.ref || null,
      title: task.title || null,
      dueDate: task.dueDate || null,
      repeatFrequency: task.repeatFrequency || null,
      repeatInterval: task.repeatInterval || null,
      repeatDaysOfWeek: task.repeatDaysOfWeek || task.daysOfWeek || null,
      dueDateReason: task.dueDateReason || null,
    })),
  }, null, 2));

  if (dryRun) return;

  let batch = db.batch();
  let ops = 0;
  for (const block of blocksToDelete) {
    batch.delete(block.ref);
    ops += 1;
    if (ops === 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  if (ops > 0) {
    await batch.commit();
  }

  for (const chore of chores) {
    await chore.refObj.set({
      dueDate: admin.firestore.FieldValue.delete(),
      targetDate: admin.firestore.FieldValue.delete(),
      dueTime: admin.firestore.FieldValue.delete(),
      dueDateReason: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      syncState: 'dirty',
      choreRebalancedAt: admin.firestore.FieldValue.serverTimestamp(),
      choreRebalanceHorizonDays: horizonDays,
      choreRebalanceMode: 'sequential',
    }, { merge: true });
    if (settleMs > 0) {
      await sleep(settleMs);
    }
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});