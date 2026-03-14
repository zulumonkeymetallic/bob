const admin = require('firebase-admin');

const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!serviceAccountPath) {
  throw new Error('GOOGLE_APPLICATION_CREDENTIALS must point to a Firebase service account JSON file.');
}

// eslint-disable-next-line import/no-dynamic-require, global-require
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

function shortTaskRef(taskId) {
  return `TK-${String(taskId || '').slice(-6).toUpperCase()}`;
}

function shortStoryRef(story) {
  return story?.referenceNumber || story?.ref || `ST-${String(story?.id || '').slice(-6).toUpperCase()}`;
}

function shortGoalRef(goal) {
  return goal?.ref || `GL-${String(goal?.id || '').slice(-6).toUpperCase()}`;
}

function buildLabel(ref, title, fallback) {
  return [ref, title || fallback].filter(Boolean).join(' · ');
}

async function fetchDoc(collectionName, docId) {
  if (!docId) return null;
  const snap = await db.collection(collectionName).doc(String(docId)).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() };
}

async function resolveTarget(row, parentTask) {
  const metadata = row.metadata || {};

  let story = await fetchDoc('stories', parentTask?.storyId);
  if (!story && metadata.suggestedType === 'story' && metadata.suggestedId) {
    story = await fetchDoc('stories', metadata.suggestedId);
  }

  let goal = await fetchDoc('goals', parentTask?.goalId);
  if (!goal && story?.goalId) {
    goal = await fetchDoc('goals', story.goalId);
  }
  if (!goal && metadata.suggestedType === 'goal' && metadata.suggestedId) {
    goal = await fetchDoc('goals', metadata.suggestedId);
  }

  return { story, goal };
}

function buildTitle(row, sourceRef, story, goal) {
  const prefix = row.title?.startsWith('Review low-confidence')
    ? 'Review low-confidence task linkage for'
    : 'Validate task linkage for';
  const storyLabel = story ? buildLabel(shortStoryRef(story), story.title, 'Untitled story') : null;
  const goalLabel = goal ? buildLabel(shortGoalRef(goal), goal.title, 'Untitled goal') : null;
  const targetLabel = storyLabel || goalLabel;
  if (!targetLabel) return null;
  return `${prefix} ${sourceRef} -> ${targetLabel}`;
}

function buildDescription(sourceTitle, story, goal) {
  const parts = [`TASK: ${sourceTitle}.`];
  if (story) {
    parts.push(`Linked story: ${buildLabel(shortStoryRef(story), story.title, 'Untitled story')}.`);
  }
  if (goal) {
    parts.push(`Linked goal: ${buildLabel(shortGoalRef(goal), goal.title, 'Untitled goal')}.`);
  }
  return parts.join(' ');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const snapshot = await db.collection('tasks')
    .where('source', '==', 'system')
    .where('entry_method', '==', 'auto:fuzzy_link_validation')
    .get();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let batch = db.batch();
  let batchSize = 0;

  for (const docSnap of snapshot.docs) {
    const row = docSnap.data() || {};
    scanned += 1;

    const parentId = row.parentId || row.metadata?.sourceId || null;
    const parentTask = await fetchDoc('tasks', parentId);
    if (!parentTask) {
      skipped += 1;
      continue;
    }

    const { story, goal } = await resolveTarget(row, parentTask);
    const sourceRef = row.metadata?.sourceRef || shortTaskRef(parentTask.id);
    const nextTitle = buildTitle(row, sourceRef, story, goal);
    if (!nextTitle) {
      skipped += 1;
      continue;
    }

    const nextDescription = buildDescription(
      parentTask.title || row.metadata?.sourceTitle || sourceRef,
      story,
      goal,
    );

    const currentDescription = row.description || '';
    if (row.title === nextTitle && currentDescription === nextDescription) {
      skipped += 1;
      continue;
    }

    const update = {
      title: nextTitle,
      description: nextDescription,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        ...(row.metadata || {}),
        sourceRef,
        sourceTitle: parentTask.title || row.metadata?.sourceTitle || null,
        suggestedRef: story ? shortStoryRef(story) : goal ? shortGoalRef(goal) : null,
        suggestedTitle: story?.title || goal?.title || null,
        linkedGoalRef: goal ? shortGoalRef(goal) : null,
        linkedGoalTitle: goal?.title || null,
      },
    };

    if (dryRun) {
      updated += 1;
      continue;
    }

    batch.update(docSnap.ref, update);
    batchSize += 1;
    updated += 1;

    if (batchSize >= 400) {
      await batch.commit();
      batch = db.batch();
      batchSize = 0;
    }
  }

  if (!dryRun && batchSize > 0) {
    await batch.commit();
  }

  console.log(JSON.stringify({ scanned, updated, skipped, dryRun }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});