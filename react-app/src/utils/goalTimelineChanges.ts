import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import type { GoalTimelineAffectedStory } from '../components/visualization/goalTimelineImpact';

interface ApplyGoalTimelineChangesArgs {
  goalId: string;
  startDateMs: number;
  endDateMs: number;
  targetYear?: number | null;
  ownerUid: string;
  persona: 'personal' | 'work';
  affectedStories?: GoalTimelineAffectedStory[];
}

export async function applyGoalTimelineChanges({
  goalId,
  startDateMs,
  endDateMs,
  targetYear,
  ownerUid,
  persona,
  affectedStories = [],
}: ApplyGoalTimelineChangesArgs) {
  const batch = writeBatch(db);
  const goalRef = doc(db, 'goals', goalId);
  const goalPatch: Record<string, any> = {
    startDate: startDateMs,
    endDate: endDateMs,
    updatedAt: serverTimestamp(),
  };

  if (targetYear !== undefined) {
    goalPatch.targetYear = targetYear ?? null;
  }

  batch.update(goalRef, goalPatch);

  let movedStoryCount = 0;
  let reviewStoryCount = 0;

  affectedStories.forEach((story) => {
    if (!story?.id) return;
    if (!story.recommendedSprintId || story.recommendedSprintId === story.plannedSprintId) {
      reviewStoryCount += 1;
      return;
    }
    batch.update(doc(db, 'stories', story.id), {
      sprintId: story.recommendedSprintId,
      ownerUid,
      persona,
      updatedAt: serverTimestamp(),
    });
    movedStoryCount += 1;
  });

  await batch.commit();

  return {
    movedStoryCount,
    reviewStoryCount,
  };
}
