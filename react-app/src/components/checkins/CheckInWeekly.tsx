import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, OverlayTrigger, ProgressBar, Row, Spinner, Tooltip } from 'react-bootstrap';
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, where } from 'firebase/firestore';
import { addDays, endOfWeek, format, startOfWeek } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { BarChart2, ChevronLeft, ChevronRight, RefreshCw, Save } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { FocusGoal, Goal } from '../../types';
import { getGoalDisplayPath, getProtectedFocusGoalIds, isGoalInHierarchySet } from '../../utils/goalHierarchy';
import { getKpiHealthRollupLabel, getKpiStateBadge } from '../../utils/kpiDisplay';
import WeeklyPlannerSurface from '../planner/WeeklyPlannerSurface';

interface GoalMetricDoc {
  goalId: string;
  resolvedKpis?: Array<Record<string, any>>;
  updatedAt?: any;
}

interface WeeklyFocusLeafSummary {
  goalId: string;
  title: string;
  displayPath: string;
  plannedItems: number;
  completedItems: number;
  completionPct: number;
  totalMinutes: number;
  storyItems: number;
  taskItems: number;
  routineItems: number;
  totalKpis: number;
  healthyKpis: number;
  staleKpis: number;
  topKpis: Array<{
    id: string;
    name: string;
    currentDisplay: string;
    progressPct: number | null;
    healthy: boolean;
  }>;
}

interface WeeklyFocusRootSummary {
  goalId: string;
  title: string;
  displayPath: string;
  leafCount: number;
  avgCompletionPct: number;
  healthyKpis: number;
  staleKpis: number;
  totalKpis: number;
  completedLeafGoals: number;
}

interface WeeklyFocusSummary {
  relevantFocusGoalIds: string[];
  rootGoals: WeeklyFocusRootSummary[];
  leafGoals: WeeklyFocusLeafSummary[];
  focusLinkedItems: number;
}

interface WeeklyCheckInDoc {
  id: string;
  ownerUid: string;
  weekKey: string;
  weekStartMs: number;
  weekEndMs: number;
  metrics: {
    themes: Array<{ label: string; planned: number; completed: number }>;
    routines: Array<{ label: string; planned: number; completed: number }>;
    stories: Array<{ label: string; planned: number; completed: number; minutes: number }>;
    tasks: Array<{ label: string; planned: number; completed: number; minutes: number }>;
    spendLast3DaysPence?: number | null;
    spendLast7DaysPence?: number | null;
    focusSummary?: WeeklyFocusSummary | null;
  };
  reflection: {
    wentWell: string;
    toImprove: string;
    blockers: string;
    nextFocus: string;
  };
  createdAt?: any;
  updatedAt?: any;
}

const WEEK_FORMAT = "yyyy-'W'II";

const formatMoney = (val: number, currency = 'GBP') =>
  (val / 100).toLocaleString('en-GB', { style: 'currency', currency });

const toNumber = (value: any): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const CheckInWeekly: React.FC = () => {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'reflect' | 'plan'>('reflect');
  const [weekStart, setWeekStart] = useState<Date>(() =>
    startOfWeek(addDays(new Date(), -7), { weekStartsOn: 1 }),
  );
  const [metrics, setMetrics] = useState<WeeklyCheckInDoc['metrics'] | null>(null);
  const [reflection, setReflection] = useState<WeeklyCheckInDoc['reflection']>({
    wentWell: '',
    toImprove: '',
    blockers: '',
    nextFocus: '',
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capacityReviewed, setCapacityReviewed] = useState(false);
  const [focusSummary, setFocusSummary] = useState<WeeklyFocusSummary | null>(null);

  const isIndexError = (err: any): boolean => {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('index') || msg.includes('failed_precondition');
  };
  const isPermissionDenied = (err: any): boolean => {
    const code = String(err?.code || '').toLowerCase();
    const msg = String(err?.message || err || '').toLowerCase();
    return code === 'permission-denied' || msg.includes('permission-denied') || msg.includes('insufficient permissions');
  };

  const resolveTimestampMs = (value: any): number | null => {
    if (!value) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return value.getTime();
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (typeof value?.toDate === 'function') {
      const dateValue = value.toDate();
      return dateValue instanceof Date ? dateValue.getTime() : null;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (value.seconds != null) {
      return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
    }
    return null;
  };

  const weekEnd = useMemo(() => endOfWeek(weekStart, { weekStartsOn: 1 }), [weekStart]);
  const weekKey = useMemo(() => format(weekStart, WEEK_FORMAT), [weekStart]);
  const planningWeekStart = useMemo(() => startOfWeek(addDays(weekStart, 7), { weekStartsOn: 1 }), [weekStart]);
  const showPlanningPrompt = useMemo(() => {
    const day = new Date().getDay();
    return day === 0 || day === 1;
  }, []);

  const loadWeeklyData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const ownerUid = currentUser.uid;
      const startKey = format(weekStart, 'yyyyMMdd');
      const endKey = format(weekEnd, 'yyyyMMdd');
      const checkinsSnap = await getDocs(
        query(
          collection(db, 'daily_checkins'),
          where('ownerUid', '==', ownerUid),
          where('dateKey', '>=', startKey),
          where('dateKey', '<=', endKey),
        ),
      ).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInWeekly: daily_checkins permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(
          query(collection(db, 'daily_checkins'), where('ownerUid', '==', ownerUid)),
        );
        const filtered = fallbackSnap.docs.filter((docSnap) => {
          const data = docSnap.data() as any;
          const key = String(data?.dateKey || '');
          return key >= startKey && key <= endKey;
        });
        return { docs: filtered } as typeof fallbackSnap;
      });
      const checkins = checkinsSnap.docs.map((docSnap) => docSnap.data() as any);

      const [goalsSnap, focusGoalsSnap, snapshotSnap, metricsSnap] = await Promise.all([
        getDocs(query(collection(db, 'goals'), where('ownerUid', '==', ownerUid))).catch((err) => {
          if (isPermissionDenied(err)) {
            console.warn('CheckInWeekly: goals permission denied, skipping');
            return { docs: [] } as any;
          }
          throw err;
        }),
        getDocs(query(collection(db, 'focusGoals'), where('ownerUid', '==', ownerUid))).catch((err) => {
          if (isPermissionDenied(err)) {
            console.warn('CheckInWeekly: focusGoals permission denied, skipping');
            return { docs: [] } as any;
          }
          throw err;
        }),
        getDocs(
          query(
            collection(db, 'weekly_goal_kpi_snapshots'),
            where('ownerUid', '==', ownerUid),
            where('weekKey', '==', weekKey),
          ),
        ).catch(async (err) => {
          if (isPermissionDenied(err)) {
            console.warn('CheckInWeekly: weekly_goal_kpi_snapshots permission denied, skipping');
            return { docs: [] } as any;
          }
          if (!isIndexError(err)) throw err;
          const fallbackSnap = await getDocs(
            query(collection(db, 'weekly_goal_kpi_snapshots'), where('ownerUid', '==', ownerUid)),
          );
          const filtered = fallbackSnap.docs.filter((docSnap) => String((docSnap.data() as any)?.weekKey || '') === weekKey);
          return { docs: filtered } as typeof fallbackSnap;
        }),
        getDocs(query(collection(db, 'goal_kpi_metrics'), where('ownerUid', '==', ownerUid))).catch((err) => {
          if (isPermissionDenied(err)) {
            console.warn('CheckInWeekly: goal_kpi_metrics permission denied, skipping');
            return { docs: [] } as any;
          }
          throw err;
        }),
      ]);

      const goals = goalsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Goal[];
      const focusGoals = focusGoalsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as FocusGoal[];
      const snapshotDocs = snapshotSnap.docs.map((docSnap) => ({ goalId: String((docSnap.data() as any)?.goalId || ''), ...(docSnap.data() as any) })) as GoalMetricDoc[];
      const metricDocs = metricsSnap.docs.map((docSnap) => ({ goalId: String((docSnap.data() as any)?.goalId || ''), ...(docSnap.data() as any) })) as GoalMetricDoc[];

      const themeMap = new Map<string, { planned: number; completed: number }>();
      const routineMap = new Map<string, { planned: number; completed: number }>();
      const storyMap = new Map<string, { planned: number; completed: number; minutes: number }>();
      const taskMap = new Map<string, { planned: number; completed: number; minutes: number }>();

      checkins.forEach((checkin) => {
        (checkin.items || []).forEach((item: any) => {
          const label = item.theme || 'General';
          const duration = Number(item.durationMin || 0);
          if (item.type === 'block') {
            const themeRow = themeMap.get(label) || { planned: 0, completed: 0 };
            themeRow.planned += 1;
            if (item.completed) themeRow.completed += 1;
            themeMap.set(label, themeRow);
          }
          const taskKind = String(item.taskType || item.type || '').toLowerCase();
          const isRoutineLike = ['instance', 'habit', 'chore', 'routine'].includes(String(item.type || '').toLowerCase())
            || (item.type === 'task' && ['habit', 'chore', 'routine', 'habitual'].includes(taskKind));
          if (isRoutineLike) {
            const routineLabel = item.title || (item.type === 'habit' ? 'Habit' : 'Routine');
            const routineRow = routineMap.get(routineLabel) || { planned: 0, completed: 0 };
            routineRow.planned += 1;
            if (item.completed) routineRow.completed += 1;
            routineMap.set(routineLabel, routineRow);
          }
          if (item.storyRef || item.storyId) {
            const storyLabel = item.storyRef || item.storyId || 'Story';
            const storyRow = storyMap.get(storyLabel) || { planned: 0, completed: 0, minutes: 0 };
            storyRow.planned += 1;
            storyRow.minutes += duration;
            if (item.completed) storyRow.completed += 1;
            storyMap.set(storyLabel, storyRow);
          }
          if (item.taskRef || item.taskId) {
            const taskLabel = item.taskRef || item.taskId || 'Task';
            const taskRow = taskMap.get(taskLabel) || { planned: 0, completed: 0, minutes: 0 };
            taskRow.planned += 1;
            taskRow.minutes += duration;
            if (item.completed) taskRow.completed += 1;
            taskMap.set(taskLabel, taskRow);
          }
        });
      });

      const weekStartMs = weekStart.getTime();
      const weekEndMs = weekEnd.getTime();
      const relevantFocusGoals = focusGoals.filter((focusGoal) => {
        const startMs = resolveTimestampMs((focusGoal as any).startDate) || 0;
        const endMs = resolveTimestampMs((focusGoal as any).endDate) || 0;
        const overlapsWeek = startMs <= weekEndMs && endMs >= weekStartMs;
        return focusGoal.isActive || overlapsWeek;
      });

      const relevantRootGoalIds = new Set<string>();
      const relevantLeafGoalIds = new Set<string>();
      relevantFocusGoals.forEach((focusGoal) => {
        const protectedGoalIds = getProtectedFocusGoalIds(focusGoal);
        protectedGoalIds.forEach((goalId) => relevantRootGoalIds.add(goalId));
        const explicitLeafs = Array.isArray(focusGoal.focusLeafGoalIds) && focusGoal.focusLeafGoalIds.length > 0
          ? focusGoal.focusLeafGoalIds
          : Array.isArray(focusGoal.goalIds)
            ? focusGoal.goalIds
            : [];
        explicitLeafs.forEach((goalId) => relevantLeafGoalIds.add(String(goalId || '').trim()));
      });

      const allItems = checkins.flatMap((checkin) => Array.isArray(checkin.items) ? checkin.items : []);
      const leafGoalSummaries: WeeklyFocusLeafSummary[] = goals
        .filter((goal) => relevantLeafGoalIds.has(goal.id))
        .map((goal) => {
          const goalItems = allItems.filter((item: any) => String(item.goalId || '').trim() === goal.id);
          const plannedItems = goalItems.length;
          const completedItems = goalItems.filter((item: any) => item.completed === true).length;
          const totalMinutes = goalItems.reduce((sum: number, item: any) => sum + (Number(item.durationMin || 0) || 0), 0);
          const storyItems = goalItems.filter((item: any) => item.storyId || item.storyRef).length;
          const taskItems = goalItems.filter((item: any) => item.taskId || item.taskRef).length;
          const routineItems = goalItems.filter((item: any) => ['habit', 'routine', 'chore', 'instance'].includes(String(item.type || '').toLowerCase())).length;
          const completionPct = plannedItems > 0 ? Math.round((completedItems / plannedItems) * 100) : 0;
          const snapshotDoc = snapshotDocs.find((doc) => doc.goalId === goal.id);
          const metricDoc = metricDocs.find((doc) => doc.goalId === goal.id);
          const resolvedKpis = Array.isArray(snapshotDoc?.resolvedKpis)
            ? snapshotDoc?.resolvedKpis || []
            : (Array.isArray(metricDoc?.resolvedKpis) ? metricDoc?.resolvedKpis || [] : []);
          const totalKpis = resolvedKpis.length;
          const healthyKpis = resolvedKpis.filter((kpi: any) => kpi?.healthy === true).length;
          const staleKpis = resolvedKpis.filter((kpi: any) => kpi?.stale === true || kpi?.healthy === false).length;
          const topKpis = resolvedKpis.slice(0, 3).map((kpi: any) => ({
            id: String(kpi?.id || kpi?.metricKey || kpi?.name || goal.id),
            name: String(kpi?.name || 'KPI'),
            currentDisplay: String(kpi?.currentDisplay || '—'),
            progressPct: toNumber(kpi?.progressPct),
            healthy: kpi?.healthy === true,
          }));

          return {
            goalId: goal.id,
            title: goal.title || goal.id,
            displayPath: getGoalDisplayPath(goal.id, goals),
            plannedItems,
            completedItems,
            completionPct,
            totalMinutes,
            storyItems,
            taskItems,
            routineItems,
            totalKpis,
            healthyKpis,
            staleKpis,
            topKpis,
          };
        })
        .sort((a, b) => {
          if (a.completionPct !== b.completionPct) return a.completionPct - b.completionPct;
          return a.displayPath.localeCompare(b.displayPath);
        });

      const rootGoalSummaries: WeeklyFocusRootSummary[] = goals
        .filter((goal) => relevantRootGoalIds.has(goal.id))
        .map((goal) => {
          const leafGoals = leafGoalSummaries.filter((leafGoal) => isGoalInHierarchySet(leafGoal.goalId, goals, [goal.id]));
          const leafCount = leafGoals.length || 1;
          const totalCompletion = leafGoals.reduce((sum, leafGoal) => sum + leafGoal.completionPct, 0);
          const totalKpis = leafGoals.reduce((sum, leafGoal) => sum + leafGoal.totalKpis, 0);
          const healthyKpis = leafGoals.reduce((sum, leafGoal) => sum + leafGoal.healthyKpis, 0);
          const staleKpis = leafGoals.reduce((sum, leafGoal) => sum + leafGoal.staleKpis, 0);
          const completedLeafGoals = leafGoals.filter((leafGoal) => leafGoal.completionPct >= 100).length;
          return {
            goalId: goal.id,
            title: goal.title || goal.id,
            displayPath: getGoalDisplayPath(goal.id, goals),
            leafCount,
            avgCompletionPct: leafGoals.length > 0 ? Math.round(totalCompletion / leafGoals.length) : 0,
            healthyKpis,
            staleKpis,
            totalKpis,
            completedLeafGoals,
          };
        })
        .sort((a, b) => a.displayPath.localeCompare(b.displayPath));

      const nextFocusSummary: WeeklyFocusSummary | null = relevantFocusGoals.length > 0
        ? {
            relevantFocusGoalIds: relevantFocusGoals.map((focusGoal) => focusGoal.id),
            rootGoals: rootGoalSummaries,
            leafGoals: leafGoalSummaries,
            focusLinkedItems: leafGoalSummaries.reduce((sum, leafGoal) => sum + leafGoal.plannedItems, 0),
          }
        : null;

      setFocusSummary(nextFocusSummary);

      const spendLast3Days = await getDocs(
        query(
          collection(db, 'monzo_transactions'),
          where('ownerUid', '==', ownerUid),
          where('createdAt', '>=', new Date(weekEnd.getTime() - 2 * 24 * 60 * 60 * 1000)),
          orderBy('createdAt', 'desc'),
        ),
      ).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInWeekly: monzo_transactions (3 days) permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(
          query(collection(db, 'monzo_transactions'), where('ownerUid', '==', ownerUid)),
        );
        const cutoff = weekEnd.getTime() - 2 * 24 * 60 * 60 * 1000;
        const filtered = fallbackSnap.docs.filter((docSnap) => {
          const data = docSnap.data() as any;
          const createdAt = resolveTimestampMs(data?.createdAt);
          return createdAt != null && createdAt >= cutoff;
        });
        return { docs: filtered } as typeof fallbackSnap;
      });
      let spendLast3DaysPence = 0;
      spendLast3Days.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const amount = Number(data.amountMinor ?? data.amount ?? 0);
        if (amount < 0) spendLast3DaysPence += Math.abs(amount);
      });

      const spendLast7Days = await getDocs(
        query(
          collection(db, 'monzo_transactions'),
          where('ownerUid', '==', ownerUid),
          where('createdAt', '>=', weekStart),
          orderBy('createdAt', 'desc'),
        ),
      ).catch(async (err) => {
        if (isPermissionDenied(err)) {
          console.warn('CheckInWeekly: monzo_transactions (7 days) permission denied, skipping');
          return { docs: [] } as any;
        }
        if (!isIndexError(err)) throw err;
        const fallbackSnap = await getDocs(
          query(collection(db, 'monzo_transactions'), where('ownerUid', '==', ownerUid)),
        );
        const cutoff = weekStart.getTime();
        const filtered = fallbackSnap.docs.filter((docSnap) => {
          const data = docSnap.data() as any;
          const createdAt = resolveTimestampMs(data?.createdAt);
          return createdAt != null && createdAt >= cutoff;
        });
        return { docs: filtered } as typeof fallbackSnap;
      });
      let spendLast7DaysPence = 0;
      spendLast7Days.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const amount = Number(data.amountMinor ?? data.amount ?? 0);
        if (amount < 0) spendLast7DaysPence += Math.abs(amount);
      });

      setMetrics({
        themes: Array.from(themeMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        routines: Array.from(routineMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        stories: Array.from(storyMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        tasks: Array.from(taskMap.entries()).map(([label, stats]) => ({ label, ...stats })),
        spendLast3DaysPence,
        spendLast7DaysPence,
        focusSummary: nextFocusSummary,
      });

      const existing = await getDoc(doc(db, 'weekly_checkins', `${ownerUid}_${weekKey}`));
      if (existing.exists()) {
        const data = existing.data() as WeeklyCheckInDoc & { capacityReviewedAt?: any };
        setReflection(data.reflection || reflection);
        setCapacityReviewed(!!data.capacityReviewedAt);
      } else {
        setCapacityReviewed(false);
      }
    } catch (err) {
      console.error('Failed to load weekly check-in', err);
      setError('Unable to load weekly check-in data.');
      setFocusSummary(null);
    } finally {
      setLoading(false);
    }
  }, [currentUser, weekEnd, weekKey, weekStart, reflection]);

  useEffect(() => {
    loadWeeklyData();
  }, [loadWeeklyData]);

  const handleSave = useCallback(async () => {
    if (!currentUser || !metrics) return;
    setSaving(true);
    try {
      const payload: WeeklyCheckInDoc = {
        id: `${currentUser.uid}_${weekKey}`,
        ownerUid: currentUser.uid,
        weekKey,
        weekStartMs: weekStart.getTime(),
        weekEndMs: weekEnd.getTime(),
        metrics,
        reflection,
      };
      await setDoc(doc(db, 'weekly_checkins', payload.id), {
        ...payload,
        updatedAt: new Date(),
        createdAt: new Date(),
      }, { merge: true });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save weekly check-in', err);
      setError('Failed to save weekly check-in.');
    } finally {
      setSaving(false);
    }
  }, [currentUser, metrics, reflection, weekEnd, weekKey, weekStart]);

  return (
    <div className="p-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h3 className="mb-0">Weekly Check-in</h3>
        {/* Compact icon toolbar */}
        <div className="d-flex gap-1 align-items-center">
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Previous week</Tooltip>}>
            <Button size="sm" variant="outline-secondary" onClick={() => setWeekStart((prev) => startOfWeek(addDays(prev, -7), { weekStartsOn: 1 }))}>
              <ChevronLeft size={14} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Next week</Tooltip>}>
            <Button size="sm" variant="outline-secondary" onClick={() => setWeekStart((prev) => startOfWeek(addDays(prev, 7), { weekStartsOn: 1 }))}>
              <ChevronRight size={14} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Reload week data</Tooltip>}>
            <Button size="sm" variant="outline-secondary" onClick={loadWeeklyData} disabled={loading}>
              <RefreshCw size={14} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip>Review capacity plan for this week</Tooltip>}>
            <Button size="sm" variant="outline-secondary" onClick={() => navigate('/capacity')}>
              <BarChart2 size={14} />
            </Button>
          </OverlayTrigger>
          <OverlayTrigger placement="bottom" overlay={<Tooltip>{saving ? 'Saving…' : saved ? 'Saved!' : 'Save weekly check-in'}</Tooltip>}>
            <Button
              size="sm"
              variant={saved ? 'success' : 'primary'}
              onClick={handleSave}
              disabled={saving || loading || !metrics}
            >
              <Save size={14} />
            </Button>
          </OverlayTrigger>
        </div>
      </div>

      {/* Week date range */}
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <Form.Control
          type="date"
          value={format(weekStart, 'yyyy-MM-dd')}
          onChange={(e) => setWeekStart(startOfWeek(new Date(e.target.value), { weekStartsOn: 1 }))}
          style={{ maxWidth: 180 }}
          title="Jump to week containing this date"
        />
        <Badge bg="secondary" className="py-2 px-3">
          {format(weekStart, 'dd MMM')} – {format(weekEnd, 'dd MMM yyyy')}
        </Badge>
        <div className="ms-auto d-flex gap-2">
          <Button size="sm" variant={mode === 'reflect' ? 'primary' : 'outline-primary'} onClick={() => setMode('reflect')}>
            Reflect
          </Button>
          <Button size="sm" variant={mode === 'plan' ? 'primary' : 'outline-primary'} onClick={() => setMode('plan')}>
            Plan next week
          </Button>
        </div>
      </div>

      {showPlanningPrompt && mode === 'reflect' && (
        <Alert variant="warning" className="py-2 mb-3 d-flex align-items-center justify-content-between gap-2 flex-wrap">
          <div className="small">
            Finish your reflection, then switch to <strong>Plan next week</strong> to move items across the next 7 days and accept defer proposals.
          </div>
          <Button size="sm" variant="outline-dark" onClick={() => setMode('plan')}>
            Open planner
          </Button>
        </Alert>
      )}

      {/* Capacity plan review reminder */}
      {!capacityReviewed && !loading && mode === 'reflect' && (
        <Alert variant="warning" className="d-flex justify-content-between align-items-center py-2 mb-3">
          <span className="small">
            <BarChart2 size={13} className="me-1" />
            Weekly capacity plan has not been reviewed — check it before closing out your week.
          </span>
          <div className="d-flex gap-2 ms-3 flex-shrink-0">
            <OverlayTrigger overlay={<Tooltip>Open capacity planner</Tooltip>}>
              <Button size="sm" variant="outline-warning" onClick={() => navigate('/capacity')}>
                Review
              </Button>
            </OverlayTrigger>
            <OverlayTrigger overlay={<Tooltip>Mark as reviewed for this week</Tooltip>}>
              <Button size="sm" variant="outline-secondary" onClick={() => setCapacityReviewed(true)}>
                Dismiss
              </Button>
            </OverlayTrigger>
          </div>
        </Alert>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
      {mode === 'plan' ? (
        <>
          <Card className="shadow-sm border-0 mb-3">
            <Card.Body className="d-flex flex-wrap align-items-center justify-content-between gap-2">
              <div>
                <div className="fw-semibold">Weekly Review Tools</div>
                <div className="text-muted small">
                  Use Weekly Capacity and the 7-day prioritisation matrix together before locking next week.
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => navigate('/calendar/planner')}>
                  Weekly Capacity
                </Button>
                <Button size="sm" variant="outline-primary" onClick={() => navigate('/planner/weekly')}>
                  7-Day Prioritisation
                </Button>
                <Button size="sm" variant="outline-secondary" onClick={() => navigate('/sprints/planning')}>
                  Sprint Planning
                </Button>
              </div>
            </Card.Body>
          </Card>
          <WeeklyPlannerSurface
            weekStart={planningWeekStart}
            embedded
            title={`7-Day Prioritisation Matrix · Week of ${format(planningWeekStart, 'dd MMM yyyy')}`}
            storageScope="weekly_checkin"
          />
        </>
      ) : loading || !metrics ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" animation="border" /> Loading weekly metrics…
        </div>
      ) : (
        <>
          {focusSummary && focusSummary.rootGoals.length > 0 && (
            <div className="mb-3">
              <Row className="g-3 mb-3">
                <Col md={4}>
                  <Card className="shadow-sm border-0">
                    <Card.Body>
                      <div className="text-muted small">Focus goals in scope</div>
                      <div className="fs-4 fw-bold">{focusSummary.rootGoals.length}</div>
                      <div className="small text-muted">{focusSummary.leafGoals.length} leaf goals</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={4}>
                  <Card className="shadow-sm border-0">
                    <Card.Body>
                      <div className="text-muted small">Focus-linked weekly items</div>
                      <div className="fs-4 fw-bold">{focusSummary.focusLinkedItems}</div>
                      <div className="small text-muted">Daily check-in rows linked to focused leaves</div>
                    </Card.Body>
                  </Card>
                </Col>
                <Col md={4}>
                  <Card className="shadow-sm border-0">
                    <Card.Body>
                      <div className="text-muted small">Healthy KPIs</div>
                      <div className="fs-4 fw-bold">
                        {focusSummary.leafGoals.reduce((sum, leafGoal) => sum + leafGoal.healthyKpis, 0)}
                      </div>
                      <div className="small text-muted">
                        {focusSummary.leafGoals.reduce((sum, leafGoal) => sum + leafGoal.totalKpis, 0)} total KPI readings
                      </div>
                    </Card.Body>
                  </Card>
                </Col>
              </Row>

              <Row className="g-3 mb-3">
                <Col lg={5}>
                  <Card className="shadow-sm border-0 h-100">
                    <Card.Header className="fw-semibold">Focus goal rollup</Card.Header>
                    <Card.Body>
                      {focusSummary.rootGoals.map((rootGoal) => (
                        <div key={rootGoal.goalId} className="border rounded p-2 mb-2">
                          <div className="fw-semibold">{rootGoal.displayPath}</div>
                          <div className="small text-muted mb-2">
                            {rootGoal.completedLeafGoals}/{rootGoal.leafCount} leaf goals complete
                            {' · '}
                            {getKpiHealthRollupLabel(rootGoal.healthyKpis, rootGoal.totalKpis, rootGoal.staleKpis)}
                          </div>
                          <ProgressBar now={Math.max(0, Math.min(100, rootGoal.avgCompletionPct))} style={{ height: 8 }} />
                          <div className="small text-muted mt-2">
                            Weekly completion {rootGoal.avgCompletionPct}%{rootGoal.staleKpis > 0 ? ` · ${rootGoal.staleKpis} stale KPI${rootGoal.staleKpis !== 1 ? 's' : ''}` : ''}
                          </div>
                        </div>
                      ))}
                    </Card.Body>
                  </Card>
                </Col>
                <Col lg={7}>
                  <Card className="shadow-sm border-0 h-100">
                    <Card.Header className="fw-semibold">Leaf goal progress</Card.Header>
                    <Card.Body>
                      {focusSummary.leafGoals.length === 0 ? (
                        <div className="text-muted">No leaf-goal activity linked this week.</div>
                      ) : (
                        focusSummary.leafGoals.map((leafGoal) => (
                          <div key={leafGoal.goalId} className="border rounded p-2 mb-2">
                            <div className="d-flex justify-content-between align-items-start gap-2">
                              <div>
                                <div className="fw-semibold">{leafGoal.displayPath}</div>
                                <div className="small text-muted">
                                  {leafGoal.completedItems}/{leafGoal.plannedItems || 0} items complete
                                  {' · '}
                                  {leafGoal.totalMinutes} min
                                  {' · '}
                                  {getKpiHealthRollupLabel(leafGoal.healthyKpis, leafGoal.totalKpis, leafGoal.staleKpis)}
                                </div>
                              </div>
                              <Badge bg={leafGoal.completionPct >= 100 ? 'success' : leafGoal.completionPct >= 60 ? 'warning' : 'secondary'}>
                                {leafGoal.completionPct}%
                              </Badge>
                            </div>
                            <ProgressBar now={Math.max(0, Math.min(100, leafGoal.completionPct))} style={{ height: 6, marginTop: 8 }} />
                            <div className="d-flex flex-wrap gap-2 mt-2">
                              <Badge bg="light" text="dark">Stories {leafGoal.storyItems}</Badge>
                              <Badge bg="light" text="dark">Tasks {leafGoal.taskItems}</Badge>
                              <Badge bg="light" text="dark">Habits {leafGoal.routineItems}</Badge>
                            </div>
                            {leafGoal.topKpis.length > 0 && (
                              <div className="mt-2">
                                {leafGoal.topKpis.map((kpi) => {
                                  const stateBadge = getKpiStateBadge(kpi.healthy, !kpi.healthy);
                                  return (
                                    <div key={kpi.id} className="d-flex justify-content-between align-items-center small py-1 gap-2">
                                      <span className="text-truncate pe-2 d-inline-flex align-items-center gap-1">
                                        <span>{kpi.name}</span>
                                        <Badge bg={stateBadge.bg}>{stateBadge.label}</Badge>
                                      </span>
                                      <span className={kpi.healthy ? 'text-success' : 'text-muted'}>
                                        {kpi.currentDisplay}{kpi.progressPct != null ? ` · ${Math.round(kpi.progressPct)}%` : ''}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            </div>
          )}

          <div className="d-md-none">
            <div className="mb-3 p-2 border rounded">
              <div className="fw-semibold mb-1">Themes</div>
              {metrics.themes.length === 0 ? (
                <div className="text-muted small">No themed blocks this week.</div>
              ) : (
                metrics.themes.map((row) => (
                  <div key={row.label} className="d-flex justify-content-between align-items-center mb-1">
                    <span className="small">{row.label}</span>
                    <Badge bg={row.completed === row.planned ? 'success' : 'secondary'}>
                      {row.completed}/{row.planned}
                    </Badge>
                  </div>
                ))
              )}
            </div>
            <div className="mb-3 p-2 border rounded">
              <div className="fw-semibold mb-1">Habits</div>
              {metrics.routines.length === 0 ? (
                <div className="text-muted small">No habits logged.</div>
              ) : (
                metrics.routines.map((row) => (
                  <div key={row.label} className="d-flex justify-content-between align-items-center mb-1">
                    <span className="small">{row.label}</span>
                    <Badge bg={row.completed === row.planned ? 'success' : 'secondary'}>
                      {row.completed}/{row.planned}
                    </Badge>
                  </div>
                ))
              )}
            </div>
            <div className="mb-3 p-2 border rounded">
              <div className="fw-semibold mb-1">Stories & Tasks</div>
              {metrics.stories.map((row) => (
                <div key={`story-${row.label}`} className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small">Story {row.label}</span>
                  <span className="text-muted small">{row.completed}/{row.planned}</span>
                </div>
              ))}
              {metrics.tasks.map((row) => (
                <div key={`task-${row.label}`} className="d-flex justify-content-between align-items-center mb-1">
                  <span className="small">Task {row.label}</span>
                  <span className="text-muted small">{row.completed}/{row.planned}</span>
                </div>
              ))}
            </div>
            <div className="mb-3 p-2 border rounded">
              <div className="fw-semibold mb-1">Reflection</div>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="What went well?"
                value={reflection.wentWell}
                onChange={(e) => setReflection((prev) => ({ ...prev, wentWell: e.target.value }))}
                className="mb-2"
              />
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="What could be improved?"
                value={reflection.toImprove}
                onChange={(e) => setReflection((prev) => ({ ...prev, toImprove: e.target.value }))}
                className="mb-2"
              />
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Blockers or friction?"
                value={reflection.blockers}
                onChange={(e) => setReflection((prev) => ({ ...prev, blockers: e.target.value }))}
                className="mb-2"
              />
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Next week focus"
                value={reflection.nextFocus}
                onChange={(e) => setReflection((prev) => ({ ...prev, nextFocus: e.target.value }))}
              />
            </div>
          </div>

          <div className="d-none d-md-block">
            <Row className="g-3 mb-3">
              <Col lg={6}>
                <Card className="shadow-sm border-0">
                  <Card.Header className="fw-semibold">Planned vs completed (Themes)</Card.Header>
                  <Card.Body>
                    {metrics.themes.length === 0 ? (
                      <div className="text-muted">No themed blocks this week.</div>
                    ) : (
                      metrics.themes.map((row) => (
                        <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                          <span>{row.label}</span>
                          <Badge bg={row.completed === row.planned ? 'success' : 'secondary'}>
                            {row.completed}/{row.planned}
                          </Badge>
                        </div>
                      ))
                    )}
                  </Card.Body>
                </Card>
              </Col>
              <Col lg={6}>
                <Card className="shadow-sm border-0">
                  <Card.Header className="fw-semibold">Habits</Card.Header>
                  <Card.Body>
                    {metrics.routines.length === 0 ? (
                      <div className="text-muted">No habits logged.</div>
                    ) : (
                      metrics.routines.map((row) => (
                        <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                          <span>{row.label}</span>
                          <Badge bg={row.completed === row.planned ? 'success' : 'secondary'}>
                            {row.completed}/{row.planned}
                          </Badge>
                        </div>
                      ))
                    )}
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Row className="g-3 mb-3">
              <Col lg={6}>
                <Card className="shadow-sm border-0">
                  <Card.Header className="fw-semibold">Stories worked on</Card.Header>
                  <Card.Body>
                    {metrics.stories.length === 0 ? (
                      <div className="text-muted">No story blocks logged.</div>
                    ) : (
                      metrics.stories.map((row) => (
                        <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                          <span>{row.label}</span>
                          <span className="text-muted small">
                            {row.completed}/{row.planned} · {row.minutes} min
                          </span>
                        </div>
                      ))
                    )}
                  </Card.Body>
                </Card>
              </Col>
              <Col lg={6}>
                <Card className="shadow-sm border-0">
                  <Card.Header className="fw-semibold">Tasks worked on</Card.Header>
                  <Card.Body>
                    {metrics.tasks.length === 0 ? (
                      <div className="text-muted">No task blocks logged.</div>
                    ) : (
                      metrics.tasks.map((row) => (
                        <div key={row.label} className="d-flex justify-content-between align-items-center mb-2">
                          <span>{row.label}</span>
                          <span className="text-muted small">
                            {row.completed}/{row.planned} · {row.minutes} min
                          </span>
                        </div>
                      ))
                    )}
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Row className="g-3 mb-3">
              <Col lg={6}>
                <Card className="shadow-sm border-0">
                  <Card.Header className="fw-semibold">Spend (Monzo)</Card.Header>
                  <Card.Body>
                    <div className="d-flex justify-content-between">
                      <span>Last 3 days</span>
                      <span className="fw-semibold">
                        {metrics.spendLast3DaysPence != null ? formatMoney(metrics.spendLast3DaysPence) : '—'}
                      </span>
                    </div>
                    <div className="d-flex justify-content-between">
                      <span>Last 7 days</span>
                      <span className="fw-semibold">
                        {metrics.spendLast7DaysPence != null ? formatMoney(metrics.spendLast7DaysPence) : '—'}
                      </span>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col lg={6}>
                <Card className="shadow-sm border-0">
                  <Card.Header className="fw-semibold">Reflection</Card.Header>
                  <Card.Body className="d-flex flex-column gap-2">
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder="What went well?"
                      value={reflection.wentWell}
                      onChange={(e) => setReflection((prev) => ({ ...prev, wentWell: e.target.value }))}
                    />
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder="What could be improved?"
                      value={reflection.toImprove}
                      onChange={(e) => setReflection((prev) => ({ ...prev, toImprove: e.target.value }))}
                    />
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder="Blockers or friction?"
                      value={reflection.blockers}
                      onChange={(e) => setReflection((prev) => ({ ...prev, blockers: e.target.value }))}
                    />
                    <Form.Control
                      as="textarea"
                      rows={2}
                      placeholder="Next week focus"
                      value={reflection.nextFocus}
                      onChange={(e) => setReflection((prev) => ({ ...prev, nextFocus: e.target.value }))}
                    />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </div>
        </>
      )}
    </div>
  );
};

export default CheckInWeekly;
