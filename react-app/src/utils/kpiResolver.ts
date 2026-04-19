import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { format, startOfWeek } from 'date-fns';
import { db } from '../firebase';
import type { Goal, Story, Task } from '../types';
import type { Kpi, KpiDataSource, MetricBinding } from '../types/KpiTypes';
import { getLatestMetricValue, toPeriodKey } from './metricValues';
import { isFreshTimestamp, toMillis } from './kpiFreshness';

type ResolvedGoalKpiRow = Record<string, any>;
const WEEK_FORMAT = "yyyy-'W'II";

const toNumber = (value: any): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPct = (value: number | null): number | null => {
  if (value == null) return null;
  return Math.max(0, Math.min(200, Math.round(value * 10) / 10));
};

const computeProgressPct = (current: number | null, target: number | null, lowerIsBetter = false): number | null => {
  if (current == null || target == null || !Number.isFinite(target) || target === 0) return null;
  if (lowerIsBetter) return clampPct((target / Math.max(current, 0.0001)) * 100);
  return clampPct((current / target) * 100);
};

const getWeeklySnapshotKey = (date = new Date()): string => (
  format(startOfWeek(date, { weekStartsOn: 1 }), WEEK_FORMAT)
);

const getDefaultBinding = (kpi: Kpi): MetricBinding | null => {
  const source = Array.isArray(kpi.sourcePriority) && kpi.sourcePriority.length > 0
    ? kpi.sourcePriority[0]
    : ((kpi.sourceId as KpiDataSource | undefined) || null);
  if (!source) return null;
  const existing = kpi.sourceBindings?.[source];
  if (existing) return existing;
  return {
    source,
    metricKey: String(kpi.metricKey || kpi.metricId || kpi.id || ''),
    collection: kpi.sourceCollection || null,
    fieldPath: kpi.sourceFieldPath || null,
    aggregation: kpi.aggregation,
    timeframe: kpi.timeframe,
    dataType: kpi.sourceDataType,
    unit: kpi.unit,
    label: kpi.sourceMetricLabel || kpi.name,
  };
};

const getCandidateSources = (kpi: Kpi): KpiDataSource[] => {
  const fromPriority = Array.isArray(kpi.sourcePriority) ? kpi.sourcePriority : [];
  if (fromPriority.length > 0) return fromPriority;
  if (kpi.sourceId) return [kpi.sourceId as KpiDataSource];
  return [];
};

async function resolveObservationSource(ownerUid: string, source: KpiDataSource, binding: MetricBinding, timeframe: string) {
  const metricValue = await getLatestMetricValue({
    ownerUid,
    metricKey: binding.metricKey,
    source,
    periodKey: toPeriodKey(timeframe),
  });
  if (!metricValue) return null;
  return {
    source,
    currentValue: toNumber(metricValue.value),
    unit: binding.unit || metricValue.unit || '',
    observedAt: metricValue.observedAt,
    isFresh: source === 'user_input' || source === 'manual_task'
      ? true
      : isFreshTimestamp(metricValue.syncedAt || metricValue.observedAt, 24),
  };
}

async function resolveProfileSource(ownerUid: string, source: KpiDataSource, binding: MetricBinding, freshnessWindowHours = 24) {
  const profileSnap = await getDoc(doc(db, 'profiles', ownerUid));
  if (!profileSnap.exists()) return null;
  const profile = profileSnap.data() as any;
  const fieldPath = String(binding.fieldPath || '').trim();
  const value = fieldPath.split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), profile);
  const currentValue = toNumber(value);
  if (currentValue == null) return null;
  const manualObservedAt = profile.updatedAt || null;
  const automatedTimestamp = source === 'strava' ? profile.stravaLastSyncAt : (profile.healthkitLastSyncAt || profile.updatedAt || null);
  return {
    source,
    currentValue,
    unit: binding.unit || '',
    observedAt: toMillis(manualObservedAt),
    isFresh: source === 'healthkit' || source === 'strava'
      ? isFreshTimestamp(automatedTimestamp, freshnessWindowHours)
      : true,
    automatedTimestamp,
    manualObservedAt,
  };
}

async function resolveExecutionSource(ownerUid: string, goalId: string, source: KpiDataSource, binding: MetricBinding, kpi: Kpi) {
  if (source === 'story_progress') {
    const storiesSnap = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', ownerUid), where('goalId', '==', goalId)));
    const stories = storiesSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[];
    const totalPoints = stories.reduce((sum, story) => sum + (Number(story.points || 0) || 0), 0);
    const completedPoints = stories.filter((story) => Number(story.status || 0) >= 4).reduce((sum, story) => sum + (Number(story.points || 0) || 0), 0);
    const currentValue = kpi.type === 'story_points' ? completedPoints : stories.filter((story) => Number(story.status || 0) >= 4).length;
    return {
      source,
      currentValue,
      unit: binding.unit || kpi.unit,
      observedAt: Date.now(),
      isFresh: true,
      totalPoints,
      completedPoints,
    };
  }
  if (source === 'task_progress' || source === 'manual_task') {
    const tasksSnap = await getDocs(query(collection(db, 'tasks'), where('ownerUid', '==', ownerUid), where('goalId', '==', goalId)));
    const tasks = tasksSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
    const completedTasks = tasks.filter((task) => {
      const status = Number(task.status || 0);
      return status === 2 || status >= 4;
    }).length;
    return {
      source,
      currentValue: completedTasks,
      unit: binding.unit || kpi.unit,
      observedAt: Date.now(),
      isFresh: true,
      totalTasks: tasks.length,
      completedTasks,
    };
  }
  return null;
}

async function resolveHabitSource(ownerUid: string, goalId: string, binding: MetricBinding) {
  const instancesSnap = await getDocs(query(collection(db, 'scheduled_instances'), where('ownerUid', '==', ownerUid), orderBy('occurrenceDate', 'desc'), limit(200)));
  const matching = instancesSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
    .filter((instance: any) => String(instance.goalId || '').trim() === String(goalId || '').trim());
  if (matching.length === 0) return null;
  const completed = matching.filter((instance: any) => ['completed', 'done'].includes(String(instance.status || '').toLowerCase())).length;
  const adherence = Math.round((completed / Math.max(matching.length, 1)) * 100);
  return {
    source: 'habit_occurrence' as const,
    currentValue: adherence,
    unit: binding.unit || '%',
    observedAt: Date.now(),
    isFresh: true,
    completedOccurrences: completed,
    totalScheduledOccurrences: matching.length,
  };
}

async function resolveFinanceSource(ownerUid: string, goal: Goal, binding: MetricBinding) {
  const linkedPotId = goal.linkedPotId || goal.potId || goal.monzoPotId || null;
  if (binding.fieldPath === 'totals.optional' || binding.fieldPath === 'totals.mandatory') {
    const summarySnap = await getDoc(doc(db, 'monzo_budget_summary', ownerUid));
    if (!summarySnap.exists()) return null;
    const summary = summarySnap.data() as any;
    const value = String(binding.fieldPath || '').split('.').reduce<any>((acc, key) => (acc == null ? undefined : acc[key]), summary);
    const currentValue = toNumber(value);
    if (currentValue == null) return null;
    return {
      source: 'finance' as const,
      currentValue,
      unit: binding.unit || 'GBP',
      observedAt: toMillis(summary.updatedAt) || Date.now(),
      isFresh: true,
    };
  }
  if (linkedPotId) {
    const txSnap = await getDocs(query(collection(db, 'monzo_transactions'), where('ownerUid', '==', ownerUid), where('potId', '==', linkedPotId), orderBy('createdAt', 'desc'), limit(100)));
    const currentValue = txSnap.docs.reduce((sum, docSnap) => sum + Math.abs(Number((docSnap.data() as any)?.amount || 0)), 0);
    return {
      source: 'finance' as const,
      currentValue,
      unit: binding.unit || 'GBP',
      observedAt: Date.now(),
      isFresh: true,
    };
  }
  return null;
}

export async function resolveKpiForGoal(options: {
  ownerUid: string;
  goal: Goal;
  kpi: Kpi;
}): Promise<ResolvedGoalKpiRow> {
  const { ownerUid, goal, kpi } = options;
  const sources = getCandidateSources(kpi);
  const freshnessWindowHours = Number(kpi.freshnessWindowHours || 24);
  const sourceFreshness: Record<string, any> = {};
  let resolved: any = null;

  for (const source of sources) {
    const binding = kpi.sourceBindings?.[source] || (source === sources[0] ? getDefaultBinding(kpi) : null);
    if (!binding) continue;
    let candidate: any = null;
    if (source === 'user_input') {
      candidate = await resolveObservationSource(ownerUid, source, binding, binding.timeframe || kpi.timeframe);
    } else if (source === 'healthkit' || source === 'strava') {
      candidate = await resolveObservationSource(ownerUid, source, binding, binding.timeframe || kpi.timeframe);
      if (!candidate) {
        candidate = await resolveProfileSource(ownerUid, source, binding, freshnessWindowHours);
      }
    } else if (source === 'story_progress' || source === 'task_progress' || source === 'manual_task') {
      candidate = await resolveExecutionSource(ownerUid, goal.id, source, binding, kpi);
    } else if (source === 'habit_occurrence') {
      candidate = await resolveHabitSource(ownerUid, goal.id, binding);
    } else if (source === 'finance') {
      candidate = await resolveFinanceSource(ownerUid, goal, binding);
    }
    if (candidate) {
      sourceFreshness[source] = {
        observedAt: candidate.observedAt || null,
        isFresh: candidate.isFresh === true,
      };
      if (candidate.isFresh || source === 'user_input' || source === 'manual_task') {
        resolved = candidate;
        break;
      }
      resolved = resolved || candidate;
    }
  }

  const currentValue = toNumber(resolved?.currentValue ?? kpi.current);
  const targetValue = toNumber(kpi.target);
  const progressPct = computeProgressPct(currentValue, targetValue, kpi.targetDirection === 'decrease');
  const healthy = (resolved?.isFresh === true) || (resolved?.source === 'user_input') || (resolved?.source === 'manual_task');

  return {
    id: kpi.id,
    name: kpi.name,
    metricKey: kpi.metricKey || kpi.metricId || kpi.id,
    source: resolved?.source || null,
    sourceLabel: kpi.sourceLabel || kpi.sourceId || null,
    unit: resolved?.unit || kpi.unit,
    currentValue,
    currentDisplay: currentValue == null ? '—' : `${Number(currentValue.toFixed ? currentValue.toFixed(1) : currentValue)}${kpi.unit ? ` ${kpi.unit}` : ''}`,
    target: targetValue,
    targetNormalized: targetValue,
    progressPct,
    healthy,
    stale: !healthy,
    observedAt: resolved?.observedAt || null,
    resolvedAt: new Date().toISOString(),
    sourceFreshness,
    ...resolved,
  };
}

export async function resolveGoalKpis(options: {
  ownerUid: string;
  goal: Goal;
}): Promise<ResolvedGoalKpiRow[]> {
  const { ownerUid, goal } = options;
  const kpis = (Array.isArray((goal as any).kpisV2) ? (goal as any).kpisV2 : []) as Kpi[];
  return Promise.all(kpis.map((kpi) => resolveKpiForGoal({ ownerUid, goal, kpi })));
}

export async function persistResolvedGoalKpis(options: {
  ownerUid: string;
  goal: Goal;
}) {
  const { ownerUid, goal } = options;
  const resolvedKpis = await resolveGoalKpis({ ownerUid, goal });
  const snapshotWeekKey = getWeeklySnapshotKey();
  const basePayload = {
    ownerUid,
    goalId: goal.id,
    goalTitle: goal.title || null,
    goalRef: goal.ref || null,
    resolvedKpis,
  };
  await setDoc(doc(db, 'goal_kpi_metrics', `${ownerUid}_${goal.id}`), {
    ...basePayload,
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await setDoc(doc(db, 'weekly_goal_kpi_snapshots', `${ownerUid}_${snapshotWeekKey}_${goal.id}`), {
    ...basePayload,
    weekKey: snapshotWeekKey,
    snapshotType: 'weekly',
    snapshotAt: new Date().toISOString(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  return resolvedKpis;
}

export async function persistResolvedGoalKpisForOwner(options: {
  ownerUid: string;
  goals: Goal[];
  goalIds?: string[];
}) {
  const { ownerUid, goals, goalIds } = options;
  const scoped = Array.isArray(goalIds) && goalIds.length > 0
    ? goals.filter((goal) => goalIds.includes(goal.id))
    : goals;
  for (const goal of scoped) {
    await persistResolvedGoalKpis({ ownerUid, goal });
  }
}
