import { db } from '../firebase';
import { collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc, doc, writeBatch } from 'firebase/firestore';
import { Goal } from '../types';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { generateRef } from '../utils/referenceGenerator';

export const FOCUS_WIZARD_PREFILL_KEY = 'bob_focus_wizard_prefill_v1';

export interface FocusWizardPrefill {
  visionText?: string;
  timeframe?: 'sprint' | 'quarter' | 'year';
  searchTerm?: string;
  autoRunMatch?: boolean;
  source?: string;
  createdAt?: number;
}

export function saveFocusWizardPrefill(prefill: FocusWizardPrefill) {
  try {
    const payload = { ...prefill, createdAt: Date.now() };
    localStorage.setItem(FOCUS_WIZARD_PREFILL_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage failures.
  }
}

export function consumeFocusWizardPrefill(maxAgeMs = 30 * 60 * 1000): FocusWizardPrefill | null {
  try {
    const raw = localStorage.getItem(FOCUS_WIZARD_PREFILL_KEY);
    if (!raw) return null;
    localStorage.removeItem(FOCUS_WIZARD_PREFILL_KEY);
    const parsed = JSON.parse(raw) as FocusWizardPrefill;
    const createdAt = Number(parsed?.createdAt || 0);
    if (!createdAt || Date.now() - createdAt > maxAgeMs) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Focus Goals Service
 * Helpers for creating stories, savings buckets, and managing focus goals
 */

/**
 * Create a story for a goal if it doesn't have one
 */
export async function createStoryForGoal(goal: Goal, userId: string): Promise<string> {
  try {
    const storiesRef = collection(db, 'stories');

    // Get all existing story refs for uniqueness check
    const storiesSnap = await getDocs(
      query(storiesRef, where('ownerUid', '==', userId))
    );
    const existingRefs = storiesSnap.docs
      .map(doc => (doc.data() as any).ref || (doc.data() as any).referenceNumber)
      .filter(Boolean) as string[];

    // Generate reference number using consistent format (ST-12345)
    const ref = generateRef('story', existingRefs);

    const storyDoc = await addDoc(storiesRef, {
      ref,
      referenceNumber: ref, // Store in both fields for backward compatibility
      persona: goal.persona || 'personal',
      title: `${goal.title} (Focus)`,
      description: `Story created automatically as part of focus goals for: ${goal.title}`,
      goalId: goal.id,
      theme: goal.theme,
      status: 1, // Planned
      blocked: false,
      priority: 3, // High
      points: 5, // Default points
      wipLimit: 3,
      tags: ['focus-goal', 'auto-created'],
      sprintId: null,
      orderIndex: Date.now(),
      ownerUid: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      syncState: 'synced'
    });

    return storyDoc.id;
  } catch (error) {
    console.error(`Failed to create story for goal ${goal.id}:`, error);
    throw error;
  }
}

/**
 * Auto-create stories for multiple goals
 */
export async function autoCreateStoriesForGoals(goalIds: string[], userId: string): Promise<string[]> {
  try {
    const safeGoalIds = (goalIds || [])
      .map(gId => String(gId || '').trim())
      .filter(Boolean);
    if (safeGoalIds.length === 0) {
      return [];
    }

    const goalsRef = collection(db, 'goals');
    const goals = (await Promise.all(
      safeGoalIds.map(async gId => {
        const snap = await getDocs(query(goalsRef, where('__name__', '==', gId)));
        const goalDoc = snap.docs[0];
        if (!goalDoc) return null;
        return {
          id: goalDoc.id,
          ...(goalDoc.data() as Goal),
        } as Goal;
      })
    )).filter((goal): goal is Goal => Boolean(goal));

    const createdStoryIds: string[] = [];

    for (const goal of goals) {
      if (!goal?.id) continue;

      // Check if goal already has stories
      const storiesSnap = await getDocs(
        query(
          collection(db, 'stories'),
          where('ownerUid', '==', userId),
          where('goalId', '==', goal.id)
        )
      );

      if (storiesSnap.size === 0) {
        const storyId = await createStoryForGoal(goal, userId);
        createdStoryIds.push(storyId);
      }
    }

    return createdStoryIds;
  } catch (error) {
    console.error('Failed to auto-create stories:', error);
    throw error;
  }
}

/**
 * Create a Monzo savings pot for a goal
 * Calls backend function to authenticate with Monzo API
 */
export async function createSavingsPotForGoal(goal: Goal, userId: string): Promise<string> {
  try {
    const createMonzoPot = httpsCallable(functions, 'createMonzoPotForGoal');
    const result = (await createMonzoPot({
      goalId: goal.id,
      goalTitle: goal.title,
      targetAmount: goal.estimatedCost,
      userId
    })) as any;

    if (result.data?.potId) {
      return result.data.potId;
    }
    throw new Error('No pot ID returned from backend');
  } catch (error) {
    console.error(`Failed to create savings pot for goal ${goal.id}:`, error);
    throw error;
  }
}

/**
 * Auto-create savings pots for cost-based goals
 */
export async function autoCreateSavinsPots(
  goals: Goal[],
  userId: string
): Promise<{ [goalId: string]: string }> {
  const potsCreated: { [goalId: string]: string } = {};

  for (const goal of goals || []) {
    if (!goal?.id) continue;
    if (!goal.estimatedCost || goal.estimatedCost === 0) continue;
    if (goal.costType === 'none') continue;

    try {
      const potId = await createSavingsPotForGoal(goal, userId);
      potsCreated[goal.id] = potId;

      // Update goal with linked pot
      const goalRef = collection(db, 'goals');
      const goalSnap = await getDocs(query(goalRef, where('__name__', '==', goal.id)));
      if (goalSnap.docs.length > 0) {
        await updateDoc(goalSnap.docs[0].ref, {
          linkedPotId: potId,
          updatedAt: serverTimestamp()
        });
      }
    } catch (e) {
      console.warn(`Could not create pot for goal ${goal.id}:`, e);
      // Continue with next goal
    }
  }

  return potsCreated;
}

/**
 * Create a focus goal document
 */
export async function createFocusGoal(
  goalIds: string[],
  timeframe: 'sprint' | 'quarter' | 'year',
  userId: string,
  storiesCreatedFor?: string[],
  potIdsCreatedFor?: { [goalId: string]: string }
) {
  try {
    const now = new Date();
    const daysInMs = {
      sprint: 14 * 24 * 60 * 60 * 1000,
      quarter: 91 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000
    };
    const endDate = new Date(now.getTime() + daysInMs[timeframe]);
    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    const focusRef = collection(db, 'focusGoals');
    const docRef = await addDoc(focusRef, {
      ownerUid: userId,
      persona: 'personal',
      goalIds,
      timeframe,
      startDate: serverTimestamp(),
      endDate,
      daysRemaining,
      isActive: true,
      storiesCreatedFor: storiesCreatedFor || [],
      potIdsCreatedFor: potIdsCreatedFor || {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    return docRef.id;
  } catch (error) {
    console.error('Failed to create focus goal:', error);
    throw error;
  }
}

/**
 * For quarter/year focus periods, auto-generate 2-week sprints aligned to the focus window.
 */
export async function autoCreateSprintsForFocusPeriod(options: {
  userId: string;
  persona?: 'personal' | 'work';
  timeframe: 'sprint' | 'quarter' | 'year';
  startDate: Date;
  endDate: Date;
  visionText?: string;
  intentProposals?: Array<{ title?: string; rationale?: string }>;
}): Promise<string[]> {
  const {
    userId,
    persona = 'personal',
    timeframe,
    startDate,
    endDate,
    visionText,
    intentProposals = [],
  } = options;

  if (!userId || timeframe === 'sprint') return [];

  const sprintsRef = collection(db, 'sprints');
  const existingSnap = await getDocs(
    query(sprintsRef, where('ownerUid', '==', userId), where('persona', '==', persona))
  );
  const existing = existingSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

  const existingRefs = existing
    .map((row) => row.ref)
    .filter((row): row is string => typeof row === 'string' && row.length > 0);

  const createdIds: string[] = [];
  const baseStart = new Date(startDate);
  const baseEnd = new Date(endDate);
  const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
  let cursor = baseStart.getTime();
  let segmentIdx = 1;
  const nowMs = Date.now();
  const intentTitle = String(intentProposals[0]?.title || '').trim();
  const objectiveSeed = intentTitle || String(visionText || '').trim();

  while (cursor < baseEnd.getTime()) {
    const segmentStart = cursor;
    const segmentEnd = Math.min(baseEnd.getTime(), cursor + twoWeeksMs - 1);

    const overlaps = existing.some((sp) => {
      const st = Number((sp as any).startDate || 0);
      const en = Number((sp as any).endDate || 0);
      return st <= segmentEnd && en >= segmentStart;
    });

    if (!overlaps) {
      const ref = generateRef('sprint', existingRefs);
      existingRefs.push(ref);
      const startDt = new Date(segmentStart);
      const endDt = new Date(segmentEnd);
      const name = `Focus ${timeframe} Sprint ${segmentIdx} (${startDt.toLocaleDateString()} - ${endDt.toLocaleDateString()})`;
      const objective = objectiveSeed
        ? `AI-aligned focus sprint: ${objectiveSeed.slice(0, 220)}`
        : `Focus sprint ${segmentIdx} generated for ${timeframe} plan`;
      const status = segmentStart <= nowMs && nowMs <= segmentEnd ? 1 : 0;

      const sprintDoc = await addDoc(sprintsRef, {
        ref,
        name,
        objective,
        notes: `Auto-created from focus period (${timeframe}).`,
        persona,
        status,
        startDate: segmentStart,
        endDate: segmentEnd,
        planningDate: Math.max(0, segmentStart - 24 * 60 * 60 * 1000),
        retroDate: segmentEnd + 24 * 60 * 60 * 1000,
        ownerUid: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      createdIds.push(sprintDoc.id);
    }

    cursor = segmentEnd + 1;
    segmentIdx += 1;
  }

  return createdIds;
}

/**
 * Defer non-selected goals for the active focus period window.
 */
export async function deferNonFocusGoalsForPeriod(options: {
  userId: string;
  persona?: 'personal' | 'work';
  selectedGoalIds: string[];
  deferUntilMs: number;
  reason?: string;
}): Promise<number> {
  const {
    userId,
    persona = 'personal',
    selectedGoalIds,
    deferUntilMs,
    reason = 'Deferred due to active focus period',
  } = options;

  if (!userId) return 0;
  const selected = new Set((selectedGoalIds || []).map((id) => String(id)));
  const goalsSnap = await getDocs(
    query(collection(db, 'goals'), where('ownerUid', '==', userId), where('persona', '==', persona))
  );

  const batch = writeBatch(db);
  let updates = 0;

  goalsSnap.docs.forEach((goalDoc) => {
    const goalId = goalDoc.id;
    const data = goalDoc.data() as any;
    const status = Number(data.status || 0);
    if (selected.has(goalId)) return;
    if (status === 2) return; // Completed goals should remain completed.
    if (status === 4 && Number(data.deferredUntil || 0) >= deferUntilMs) return;

    batch.update(goalDoc.ref, {
      deferredPreviousStatus: status,
      status: 4,
      deferredUntil: deferUntilMs,
      deferredReason: reason,
      deferredAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    updates += 1;
  });

  if (updates > 0) {
    await batch.commit();
  }
  return updates;
}

/**
 * Deactivate existing focus goals for a user
 * (only one active focus goal set per timeframe)
 */
export async function deactivateExistingFocusGoals(userId: string, timeframe: 'sprint' | 'quarter' | 'year') {
  try {
    const focusRef = collection(db, 'focusGoals');
    const snap = await getDocs(
      query(
        focusRef,
        where('ownerUid', '==', userId),
        where('timeframe', '==', timeframe),
        where('isActive', '==', true)
      )
    );

    for (const doc of snap.docs) {
      await updateDoc(doc.ref, {
        isActive: false,
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.warn('Error deactivating existing focus goals:', error);
  }
}

/**
 * Get active focus goal for timeframe
 */
export async function getActiveFocusGoal(userId: string, timeframe: 'sprint' | 'quarter' | 'year') {
  try {
    const focusRef = collection(db, 'focusGoals');
    const snap = await getDocs(
      query(
        focusRef,
        where('ownerUid', '==', userId),
        where('timeframe', '==', timeframe),
        where('isActive', '==', true)
      )
    );

    return snap.docs.length > 0
      ? { id: snap.docs[0].id, ...snap.docs[0].data() }
      : null;
  } catch (error) {
    console.error('Error fetching active focus goal:', error);
    return null;
  }
}

/**
 * Trigger a manual refresh for focus-goal countdown data.
 * Optionally forces a global hierarchy snapshot refresh used by AI context flows.
 */
export async function triggerFocusGoalDataRefresh(options?: { forceSnapshotRefresh?: boolean }) {
  const syncFocusGoals = httpsCallable(functions, 'syncFocusGoalsNightly');
  const exportSnapshot = httpsCallable(functions, 'exportGlobalHierarchySnapshot');

  const syncResult = await syncFocusGoals({});
  const synced = Number((syncResult as any)?.data?.synced || 0);

  let snapshotRefreshed = false;
  let snapshotError: string | null = null;

  if (options?.forceSnapshotRefresh) {
    try {
      await exportSnapshot({ forceRefresh: true });
      snapshotRefreshed = true;
    } catch (error: any) {
      snapshotError = error?.message || 'Snapshot refresh failed';
      console.warn('[triggerFocusGoalDataRefresh] snapshot refresh failed:', error);
    }
  }

  return {
    synced,
    snapshotRefreshed,
    snapshotError
  };
}
