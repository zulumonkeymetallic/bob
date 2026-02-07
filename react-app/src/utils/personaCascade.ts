import { collection, doc, getDoc, getDocs, query, serverTimestamp, where, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

type Persona = 'personal' | 'work';

const chunk = <T,>(items: T[], size: number): T[][] => {
  if (!items.length) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
};

const commitUpdates = async (updates: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }>) => {
  if (updates.length === 0) return;
  const batches = chunk(updates, 450);
  for (const group of batches) {
    const batch = writeBatch(db);
    group.forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
};

export const cascadeGoalPersona = async (ownerUid: string, goalId: string, persona: Persona) => {
  const updates: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [];
  const taskIds = new Set<string>();

  updates.push({
    ref: doc(db, 'goals', goalId),
    data: { persona, updatedAt: serverTimestamp() },
  });

  const storiesSnap = await getDocs(
    query(collection(db, 'stories'), where('ownerUid', '==', ownerUid), where('goalId', '==', goalId)),
  );
  const storyIds: string[] = [];
  storiesSnap.forEach((snap) => {
    storyIds.push(snap.id);
    updates.push({ ref: snap.ref, data: { persona, updatedAt: serverTimestamp() } });
  });

  const tasksByGoalSnap = await getDocs(
    query(collection(db, 'tasks'), where('ownerUid', '==', ownerUid), where('goalId', '==', goalId)),
  );
  tasksByGoalSnap.forEach((snap) => {
    taskIds.add(snap.id);
    updates.push({ ref: snap.ref, data: { persona, updatedAt: serverTimestamp() } });
  });

  if (storyIds.length) {
    const storyChunks = chunk(storyIds, 10);
    for (const ids of storyChunks) {
      const tasksByStory = await getDocs(
        query(collection(db, 'tasks'), where('ownerUid', '==', ownerUid), where('storyId', 'in', ids)),
      );
      tasksByStory.forEach((snap) => {
        if (taskIds.has(snap.id)) return;
        taskIds.add(snap.id);
        updates.push({ ref: snap.ref, data: { persona, updatedAt: serverTimestamp() } });
      });

      const tasksByParent = await getDocs(
        query(collection(db, 'tasks'), where('ownerUid', '==', ownerUid), where('parentId', 'in', ids)),
      );
      tasksByParent.forEach((snap) => {
        if (taskIds.has(snap.id)) return;
        taskIds.add(snap.id);
        updates.push({ ref: snap.ref, data: { persona, updatedAt: serverTimestamp() } });
      });
    }
  }

  await commitUpdates(updates);
  return { storyIds, taskIds: Array.from(taskIds) };
};

export const cascadeStoryPersona = async (ownerUid: string, storyId: string, persona: Persona) => {
  const storySnap = await getDoc(doc(db, 'stories', storyId));
  if (!storySnap.exists()) return;
  const storyData: any = storySnap.data() || {};
  if (storyData.goalId) {
    await cascadeGoalPersona(ownerUid, String(storyData.goalId), persona);
    return;
  }

  const updates: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = [
    { ref: storySnap.ref, data: { persona, updatedAt: serverTimestamp() } },
  ];
  const taskIds = new Set<string>();

  const tasksByStory = await getDocs(
    query(collection(db, 'tasks'), where('ownerUid', '==', ownerUid), where('storyId', '==', storyId)),
  );
  tasksByStory.forEach((snap) => {
    taskIds.add(snap.id);
    updates.push({ ref: snap.ref, data: { persona, updatedAt: serverTimestamp() } });
  });

  const tasksByParent = await getDocs(
    query(collection(db, 'tasks'), where('ownerUid', '==', ownerUid), where('parentId', '==', storyId)),
  );
  tasksByParent.forEach((snap) => {
    if (taskIds.has(snap.id)) return;
    updates.push({ ref: snap.ref, data: { persona, updatedAt: serverTimestamp() } });
  });

  await commitUpdates(updates);
};

export const cascadeTaskPersona = async (ownerUid: string, taskId: string, persona: Persona) => {
  const taskSnap = await getDoc(doc(db, 'tasks', taskId));
  if (!taskSnap.exists()) return;
  const taskData: any = taskSnap.data() || {};
  if (taskData.storyId || taskData.parentId) {
    await cascadeStoryPersona(ownerUid, String(taskData.storyId || taskData.parentId), persona);
    return;
  }
  if (taskData.goalId) {
    await cascadeGoalPersona(ownerUid, String(taskData.goalId), persona);
    return;
  }
  await commitUpdates([
    { ref: taskSnap.ref, data: { persona, updatedAt: serverTimestamp() } },
  ]);
};
