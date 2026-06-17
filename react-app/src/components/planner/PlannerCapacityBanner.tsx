import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { Activity, ArrowRightLeft, CalendarClock, Check, ChevronDown, ChevronRight, KanbanSquare, Pencil, Settings2, Trash2 } from 'lucide-react';
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import { getActiveFocusLeafGoalIds } from '../../utils/goalHierarchy';
import EditTaskModal from '../EditTaskModal';
import EditStoryModal from '../EditStoryModal';
import { Goal, Sprint, Story, Task } from '../../types';
import { applyPlannerMoveToSprint } from '../../utils/plannerDeferral';
import { computeItemDeferral } from '../../utils/deferralHeuristics';

const toMillis = (value: any): number | null => {
  if (!value) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const formatHours = (minutes: number): string => {
  const hours = Math.max(0, Number(minutes || 0)) / 60;
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded.toFixed(Number.isInteger(rounded) ? 0 : 1)}h`;
};

const formatHoursRaw = (h: number): string => {
  const rounded = Math.round(h * 10) / 10;
  return `${rounded.toFixed(Number.isInteger(rounded) ? 0 : 1)}h`;
};

const normalizePriority = (value: unknown, fallback = 2): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(4, parsed));
};

const normalizeTaskPoints = (task: any): number => {
  const direct = Number(task?.points);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const hours = Number(task?.estimatedHours);
  if (Number.isFinite(hours) && hours > 0) return hours;
  const mins = Number(task?.estimateMin);
  if (Number.isFinite(mins) && mins > 0) return Math.max(1, mins / 60);
  return 1;
};

const normalizeStoryPoints = (story: any): number => {
  const direct = Number(story?.points);
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 1;
};

const isClosedSprintStatus = (value: unknown): boolean => {
  if (typeof value === 'number') return value >= 2;
  const raw = String(value || '').toLowerCase().trim();
  return ['closed', 'complete', 'completed', 'done', 'cancelled', 'canceled', 'archived'].includes(raw);
};

const isActiveSprintStatus = (value: unknown): boolean => {
  if (typeof value === 'number') return value === 1;
  const raw = String(value || '').toLowerCase().trim();
  return ['active', 'current', 'in-progress', 'in progress'].includes(raw);
};

const isMovableTaskType = (value: unknown): boolean => {
  const raw = String(value || 'task').toLowerCase().trim();
  return !['chore', 'routine', 'habit'].includes(raw);
};

const getEndOfTodayMs = (): number => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return end.getTime();
};

type MoveRecommendation = {
  kind: 'story' | 'task';
  id: string;
  ref: string;
  title: string;
  priority: number;
  points: number;
  hours: number;
  reasonCodes: string[];
  reasonSummary: string;
  isFocusAligned: boolean;
  targetSprint: Sprint | null;
  goalTitle: string | null;
  goalStartDateMs: number | null;
  entity: any;
};

type CapacityBreakdown = {
  totalItems: number;
  totalHours: number;
  focusCount: number;
  focusHours: number;
  nonFocusCount: number;
  nonFocusHours: number;
};

const PlannerCapacityBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  const navigate = useNavigate();
  const { showSidebar } = useSidebar();
  const [plannerStats, setPlannerStats] = useState<any | null>(null);
  const [recommendations, setRecommendations] = useState<MoveRecommendation[]>([]);
  const [capacityBreakdown, setCapacityBreakdown] = useState<CapacityBreakdown | null>(null);
  const [recommendationStatus, setRecommendationStatus] = useState<string | null>(null);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);
  const [movingIds, setMovingIds] = useState<Record<string, boolean>>({});
  const [entitiesVersion, setEntitiesVersion] = useState(0);
  const [showRecommendations, setShowRecommendations] = useState(true);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [storyGoals, setStoryGoals] = useState<Goal[]>([]);
  const [storyGoalsLoaded, setStoryGoalsLoaded] = useState(false);
  const [dismissedUntilMs, setDismissedUntilMs] = useState<number | null>(null);

  const isDismissedForToday = useMemo(() => {
    if (!dismissedUntilMs) return false;
    return Date.now() <= dismissedUntilMs;
  }, [dismissedUntilMs]);

  const sortedUpcomingSprints = useMemo(() => {
    return [...sprints]
      .filter((s) => !isClosedSprintStatus((s as any)?.status))
      .sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0));
  }, [sprints]);

  const currentSprint = useMemo(() => {
    if (!sortedUpcomingSprints.length) return null;
    const now = Date.now();
    const active = sortedUpcomingSprints.find((s) => isActiveSprintStatus((s as any)?.status));
    if (active) return active;
    const inWindow = sortedUpcomingSprints.find((s) => {
      const start = Number((s as any)?.startDate || 0);
      const end = Number((s as any)?.endDate || 0);
      return start > 0 && end > 0 && now >= start && now <= end;
    });
    if (inWindow) return inWindow;
    return sortedUpcomingSprints[0];
  }, [sortedUpcomingSprints]);

  const nextSprint = useMemo(() => {
    if (!currentSprint) return null;
    return sortedUpcomingSprints.find((s) => Number(s.startDate || 0) > Number(currentSprint.startDate || 0)) || null;
  }, [currentSprint, sortedUpcomingSprints]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setPlannerStats(null);
      return;
    }
    const ref = doc(db, 'planner_stats', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => {
      setPlannerStats(snap.exists() ? snap.data() : null);
    }, () => { setPlannerStats(null); });
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setDismissedUntilMs(null);
      return;
    }
    const ref = doc(db, 'user_settings', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => {
      const raw = Number(snap.data()?.plannerCapacityBannerDismissedUntilMs);
      if (Number.isFinite(raw) && raw > 0) {
        setDismissedUntilMs(raw);
      } else {
        setDismissedUntilMs(null);
      }
    }, () => { setDismissedUntilMs(null); });
    return () => unsub();
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      return;
    }
    const storiesUnsub = onSnapshot(
      query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
      ),
      () => setEntitiesVersion((prev) => prev + 1),
      () => {},
    );
    const tasksUnsub = onSnapshot(
      query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
      ),
      () => setEntitiesVersion((prev) => prev + 1),
      () => {},
    );
    return () => {
      storiesUnsub();
      tasksUnsub();
    };
  }, [currentPersona, currentUser?.uid]);

  useEffect(() => {
    setStoryGoals([]);
    setStoryGoalsLoaded(false);
  }, [currentPersona, currentUser?.uid]);

  const summary = useMemo(() => {
    if (!plannerStats) return null;
    const unscheduledStories = Number(plannerStats.unscheduledStories || 0);
    const unscheduledTasks = Number(plannerStats.unscheduledTasks || 0);
    const shortfallMinutes = Number(plannerStats.shortfallMinutes || 0);
    const lastRunAtMs = toMillis(plannerStats.lastRunAt);
    const windowStartMs = toMillis(plannerStats.windowStart);
    const windowEndMs = toMillis(plannerStats.windowEnd);

    if (unscheduledStories <= 0 && unscheduledTasks <= 0 && shortfallMinutes <= 0) {
      return null;
    }

    const rangeLabel = (() => {
      const now = Date.now();
      // If stored window is stale (ended before today) or missing, show a rolling
      // "next 30 days from today" label so the banner reflects the current planning horizon.
      const stale = !windowStartMs || !windowEndMs || windowEndMs < now;
      const start = stale ? new Date(now) : new Date(windowStartMs!);
      const end = stale ? new Date(now + 30 * 24 * 60 * 60 * 1000) : new Date(windowEndMs!);
      return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    })();

    const updatedLabel = lastRunAtMs
      ? new Date(lastRunAtMs).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : null;

    return { unscheduledStories, unscheduledTasks, shortfallMinutes, rangeLabel, updatedLabel };
  }, [plannerStats]);

  const loadRecommendations = useCallback(async () => {
    if (!currentUser?.uid || !currentSprint) {
      setRecommendations([]);
      setCapacityBreakdown(null);
      return;
    }
    setLoadingRecommendations(true);
    setRecommendationStatus(null);
    try {
      const focusLeafIds = new Set(Array.from(getActiveFocusLeafGoalIds(activeFocusGoals)));
      const sprintId = currentSprint.id;

      const [storiesSnap, tasksSnap, goalsSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid),
          where('sprintId', '==', sprintId),
        )),
        getDocs(query(
          collection(db, 'tasks'),
          where('ownerUid', '==', currentUser.uid),
          where('sprintId', '==', sprintId),
        )),
        getDocs(query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid),
        )),
      ]);

      const goalStartDateMap = new Map<string, number>();
      const goalTitleMap = new Map<string, string>();
      for (const snap of goalsSnap.docs) {
        const g = snap.data();
        const startMs = toMillis(g.startDate);
        if (startMs) goalStartDateMap.set(snap.id, startMs);
        if (g?.title) goalTitleMap.set(snap.id, String(g.title));
      }

      const candidates: MoveRecommendation[] = [];
      let focusCount = 0, focusHours = 0, nonFocusCount = 0, nonFocusHours = 0;

      for (const snap of storiesSnap.docs) {
        const s = { id: snap.id, ...(snap.data() as any) };
        const goalStartDateMs = s.goalId ? (goalStartDateMap.get(String(s.goalId)) ?? null) : null;
        const score = computeItemDeferral({
          item: s,
          itemType: 'story',
          currentSprint,
          nextSprint,
          focusLeafIds,
          allSprints: sortedUpcomingSprints as Sprint[],
          goalStartDateMs,
        });
        const hrs = normalizeStoryPoints(s);
        if (score.isFocusAligned) { focusCount++; focusHours += hrs; }
        else { nonFocusCount++; nonFocusHours += hrs; }
        if (!score.shouldDefer) continue;
        candidates.push({
          kind: 'story',
          id: s.id,
          ref: `STORY-${s.id.slice(0, 6).toUpperCase()}`,
          title: s.title || 'Untitled story',
          priority: normalizePriority(s.priority, 2),
          points: hrs,
          hours: hrs,
          reasonCodes: score.reasonCodes,
          reasonSummary: score.reasonSummary,
          isFocusAligned: score.isFocusAligned,
          targetSprint: score.targetSprint,
          goalTitle: s.goalId ? (goalTitleMap.get(String(s.goalId)) ?? null) : null,
          goalStartDateMs,
          entity: s,
        });
      }

      for (const snap of tasksSnap.docs) {
        const t = { id: snap.id, ...(snap.data() as any) };
        if (!isMovableTaskType(t.type || t.task_type)) continue;
        const goalStartDateMs = t.goalId ? (goalStartDateMap.get(String(t.goalId)) ?? null) : null;
        const score = computeItemDeferral({
          item: t,
          itemType: 'task',
          currentSprint,
          nextSprint,
          focusLeafIds,
          allSprints: sortedUpcomingSprints as Sprint[],
          goalStartDateMs,
        });
        const hrs = normalizeTaskPoints(t);
        if (score.isFocusAligned) { focusCount++; focusHours += hrs; }
        else { nonFocusCount++; nonFocusHours += hrs; }
        if (!score.shouldDefer) continue;
        candidates.push({
          kind: 'task',
          id: t.id,
          ref: `TASK-${t.id.slice(0, 6).toUpperCase()}`,
          title: t.title || 'Untitled task',
          priority: normalizePriority(t.priority, 2),
          points: hrs,
          hours: hrs,
          reasonCodes: score.reasonCodes,
          reasonSummary: score.reasonSummary,
          isFocusAligned: score.isFocusAligned,
          targetSprint: score.targetSprint,
          goalTitle: t.goalId ? (goalTitleMap.get(String(t.goalId)) ?? null) : null,
          goalStartDateMs,
          entity: t,
        });
      }

      setCapacityBreakdown({
        totalItems: focusCount + nonFocusCount,
        totalHours: focusHours + nonFocusHours,
        focusCount,
        focusHours,
        nonFocusCount,
        nonFocusHours,
      });

      // Sort deferral candidates by aiCriticalityScore ASC (lowest-scoring items
      // get bumped to a later sprint first; highest-scoring items stay).
      // Tiebreakers: priority (lower number = higher priority, so keep them), then hours desc.
      const getScore = (m: MoveRecommendation): number => {
        const raw = Number((m.entity as any)?.aiCriticalityScore);
        return Number.isFinite(raw) ? raw : 0;
      };
      candidates.sort((a, b) => {
        const sa = getScore(a);
        const sb = getScore(b);
        if (sa !== sb) return sa - sb;
        if (a.priority !== b.priority) return a.priority - b.priority;
        return b.hours - a.hours;
      });

      const top = candidates.slice(0, 10);
      setRecommendations(top);

      if (!top.length) {
        setRecommendationStatus('No deferral candidates found for the current sprint.');
      } else {
        const totalCandidateHours = top.reduce((s, c) => s + c.hours, 0);
        setRecommendationStatus(
          nextSprint
            ? `${top.length} candidate${top.length !== 1 ? 's' : ''} (${Math.round(totalCandidateHours * 10) / 10}h) — not focus-aligned or top-priority.`
            : `${top.length} candidate${top.length !== 1 ? 's' : ''} (${Math.round(totalCandidateHours * 10) / 10}h). Create a next sprint to enable moves.`,
        );
      }
    } catch (error: any) {
      console.error('PlannerCapacityBanner: failed to load recommendations', error);
      setRecommendations([]);
      setCapacityBreakdown(null);
      setRecommendationStatus('Failed to compute recommendations.');
    } finally {
      setLoadingRecommendations(false);
    }
  }, [activeFocusGoals, currentSprint, currentUser?.uid, nextSprint, sortedUpcomingSprints, entitiesVersion]);

  useEffect(() => {
    loadRecommendations();
  }, [loadRecommendations]);

  const ensureStoryGoalsLoaded = useCallback(async () => {
    if (!currentUser?.uid || storyGoalsLoaded) return;
    try {
      const goalsSnap = await getDocs(query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
      ));
      const rawGoals = goalsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[];
      setStoryGoals(rawGoals.filter((g) => !currentPersona || !g.persona || g.persona === currentPersona));
    } catch (error) {
      console.error('PlannerCapacityBanner: failed to load goals', error);
      setStoryGoals([]);
    } finally {
      setStoryGoalsLoaded(true);
    }
  }, [currentPersona, currentUser?.uid, storyGoalsLoaded]);

  const openEditModal = useCallback(async (item: MoveRecommendation) => {
    if (item.kind === 'task') {
      setEditingTask(item.entity as Task);
      return;
    }
    await ensureStoryGoalsLoaded();
    setEditingStory(item.entity as Story);
  }, [ensureStoryGoalsLoaded]);

  const moveItem = useCallback(async (item: MoveRecommendation) => {
    const sprint = item.targetSprint || nextSprint;
    if (!sprint) return;
    const actionKey = `${item.kind}:${item.id}`;
    setMovingIds((prev) => ({ ...prev, [actionKey]: true }));
    setRecommendationStatus(null);
    try {
      await applyPlannerMoveToSprint({
        itemType: item.kind,
        item: item.entity,
        sprintId: sprint.id,
        sprintStartMs: Number(sprint.startDate || Date.now()),
        rationale: `Move to ${sprint.name}: ${item.reasonSummary}`,
        source: 'planner_capacity_banner',
        durationMinutes: Math.max(15, Math.round(item.hours * 60)),
      });
      setRecommendations((prev) => prev.filter((r) => !(r.kind === item.kind && r.id === item.id)));
      setRecommendationStatus(`${item.ref} moved to ${sprint.name}.`);
    } catch (error: any) {
      setRecommendationStatus(error?.message || `Failed to move ${item.ref}.`);
    } finally {
      setMovingIds((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
    }
  }, [nextSprint]);

  const setItemStatus = useCallback(async (item: MoveRecommendation, newStatus: number, label: string) => {
    const actionKey = `${item.kind}:${item.id}:${newStatus}`;
    setMovingIds((prev) => ({ ...prev, [actionKey]: true }));
    setRecommendationStatus(null);
    try {
      const col = item.kind === 'story' ? 'stories' : 'tasks';
      await updateDoc(doc(db, col, item.id), { status: newStatus, updatedAt: serverTimestamp() });
      setRecommendations((prev) => prev.filter((r) => !(r.kind === item.kind && r.id === item.id)));
      setRecommendationStatus(`${item.ref} ${label}.`);
    } catch (error: any) {
      setRecommendationStatus(error?.message || `Failed to ${label} ${item.ref}.`);
    } finally {
      setMovingIds((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
    }
  }, []);

  const moveAllRecommendations = useCallback(async () => {
    if (!recommendations.length) return;
    setRecommendationStatus(null);
    for (const item of recommendations) {
      await moveItem(item);
    }
    await loadRecommendations();
  }, [loadRecommendations, moveItem, recommendations]);

  const dismissForToday = useCallback(async () => {
    if (!currentUser?.uid) return;
    const untilMs = getEndOfTodayMs();
    setDismissedUntilMs(untilMs);
    try {
      await setDoc(doc(db, 'user_settings', currentUser.uid), {
        plannerCapacityBannerDismissedUntilMs: untilMs,
        plannerCapacityBannerDismissedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } catch (error) {
      console.error('PlannerCapacityBanner: failed to persist dismissal', error);
      setDismissedUntilMs(null);
    }
  }, [currentUser?.uid]);

  if (!summary || isDismissedForToday) return null;

  const detailParts = [
    summary.unscheduledStories > 0 ? `${summary.unscheduledStories} ${summary.unscheduledStories === 1 ? 'story' : 'stories'} without a block` : null,
    summary.unscheduledTasks > 0 ? `${summary.unscheduledTasks} ${summary.unscheduledTasks === 1 ? 'task' : 'tasks'} without a block` : null,
    summary.shortfallMinutes > 0 ? `${formatHours(summary.shortfallMinutes)} still uncovered` : null,
  ].filter(Boolean);

  const iconBtnStyle: React.CSSProperties = {
    color: 'var(--bs-secondary)',
    padding: '4px 6px',
    borderRadius: 4,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    lineHeight: 1,
  };

  return (
    <>
    <Alert
      variant="info"
      className="border-0 shadow-sm mb-3"
      dismissible
      onClose={() => { void dismissForToday(); }}
    >
      {capacityBreakdown && (
        <div
          className="d-flex flex-wrap gap-3 mb-3 pb-2 border-bottom"
          style={{ fontSize: 12 }}
        >
          <span>
            <span className="text-muted">Sprint items: </span>
            <strong>{capacityBreakdown.totalItems}</strong>
            <span className="text-muted ms-1">({formatHoursRaw(capacityBreakdown.totalHours)} total)</span>
          </span>
          <span>
            <span className="text-muted">Focus: </span>
            <strong className="text-success">{capacityBreakdown.focusCount}</strong>
            <span className="text-muted ms-1">({formatHoursRaw(capacityBreakdown.focusHours)})</span>
          </span>
          <span>
            <span className="text-muted">Non-focus: </span>
            <strong className="text-warning-emphasis">{capacityBreakdown.nonFocusCount}</strong>
            <span className="text-muted ms-1">({formatHoursRaw(capacityBreakdown.nonFocusHours)})</span>
          </span>
          {summary.shortfallMinutes > 0 && (
            <span>
              <span className="text-muted">Shortfall: </span>
              <strong className="text-danger">{formatHours(summary.shortfallMinutes)}</strong>
            </span>
          )}
        </div>
      )}

      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div className="d-flex align-items-center gap-2">
          <CalendarClock size={20} />
          <div>
            <div className="fw-semibold">Planner capacity is short</div>
            <div className="text-muted small">
              {detailParts.join(' · ')} across {summary.rangeLabel}. Existing Google Calendar events and fixed blocks are treated as busy.
            </div>
            {summary.updatedLabel && (
              <div className="text-muted" style={{ fontSize: 12 }}>
                Last planner run {summary.updatedLabel}
              </div>
            )}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button size="sm" variant="dark" onClick={() => navigate('/planner?level=sprint')}>
            <ArrowRightLeft size={14} className="me-1" />
            Priority matrix
          </Button>
          <Button size="sm" variant="outline-dark" onClick={() => navigate('/sprints/capacity')}>
            <Settings2 size={14} className="me-1" />
            Sprint capacity
          </Button>
          <Button size="sm" variant="outline-dark" onClick={() => navigate('/calendar')}>
            <CalendarClock size={14} className="me-1" />
            Calendar
          </Button>
          <Button size="sm" variant="outline-dark" onClick={() => navigate('/sprints/kanban')}>
            <KanbanSquare size={14} className="me-1" />
            Sprint board
          </Button>
        </div>
      </div>

      <div className="mt-3 pt-2 border-top">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
          <div className="d-flex align-items-center gap-2">
            <Button
              size="sm"
              variant="link"
              className="p-0 text-dark d-inline-flex align-items-center"
              onClick={() => setShowRecommendations((prev) => !prev)}
            >
              {showRecommendations ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </Button>
            <div className="fw-semibold" style={{ fontSize: 13 }}>
              Suggested moves
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Button
              size="sm"
              variant="outline-dark"
              onClick={loadRecommendations}
              disabled={loadingRecommendations}
            >
              {loadingRecommendations ? 'Refreshing…' : 'Refresh'}
            </Button>
            {!nextSprint ? (
              <Button size="sm" variant="outline-secondary" onClick={() => navigate('/sprints')}>
                Create next sprint to enable moves
              </Button>
            ) : (
              <Button
                size="sm"
                variant="dark"
                onClick={moveAllRecommendations}
                disabled={!recommendations.length || loadingRecommendations}
              >
                Move all suggested
              </Button>
            )}
          </div>
        </div>

        {showRecommendations && recommendationStatus && (
          <div className="text-muted small mb-2">{recommendationStatus}</div>
        )}
        {showRecommendations && !recommendations.length && !loadingRecommendations && (
          <div className="text-muted small">No move candidates right now.</div>
        )}

        {showRecommendations && recommendations.length > 0 && (
          <div className="d-flex flex-column gap-2">
            {recommendations.map((item) => {
              const actionKey = `${item.kind}:${item.id}`;
              const moving = Boolean(movingIds[actionKey]);
              const targetSprint = item.targetSprint || nextSprint;
              const targetLabel = targetSprint ? `Move to ${targetSprint.name}` : 'No sprint available';
              const isGoalSprint = targetSprint && targetSprint.id !== nextSprint?.id;
              return (
                <div
                  key={actionKey}
                  className="d-flex flex-wrap align-items-center justify-content-between gap-2"
                  style={{
                    background: 'rgba(255,255,255,0.65)',
                    border: '1px solid rgba(148,163,184,0.35)',
                    borderRadius: 8,
                    padding: '8px 10px',
                  }}
                >
                  <div className="small flex-grow-1 me-2">
                    <div>
                      <span className="text-muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                        {item.kind === 'story' ? 'Story' : 'Task'}
                      </span>
                      {' · '}
                      <strong>{item.title}</strong>
                      <span className="text-muted ms-1">· {formatHoursRaw(item.hours)}</span>
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                      {item.goalTitle && <>Goal: <strong>{item.goalTitle}</strong>{' '}</>}
                      {item.goalStartDateMs && <>(starts {new Date(item.goalStartDateMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}) </>}
                      {targetSprint && (
                        <>→ <strong>{targetSprint.name}</strong>{' '}</>
                      )}
                      · {item.reasonSummary}
                      {isGoalSprint && <span> (aligned to goal start)</span>}
                    </div>
                  </div>
                  <div className="d-flex align-items-center gap-1 ms-auto flex-nowrap">
                    <button
                      onClick={() => showSidebar(item.entity, item.kind)}
                      style={iconBtnStyle}
                      title="Activity stream"
                    >
                      <Activity size={13} />
                    </button>
                    <button
                      onClick={() => { void openEditModal(item); }}
                      style={iconBtnStyle}
                      title="Quick edit"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => { void setItemStatus(item, 2, 'marked for review'); }}
                      style={{ ...iconBtnStyle, color: 'var(--bs-success)' }}
                      title="Mark complete (status → Review)"
                      disabled={moving}
                    >
                      <Check size={13} />
                    </button>
                    <button
                      onClick={() => { void setItemStatus(item, 4, 'moved to bin'); }}
                      style={{ ...iconBtnStyle, color: 'var(--bs-danger)' }}
                      title="Delete (status → Bin)"
                      disabled={moving}
                    >
                      <Trash2 size={13} />
                    </button>
                    <Button
                      size="sm"
                      variant="outline-dark"
                      style={{ minWidth: 170 }}
                      disabled={moving || !targetSprint}
                      onClick={() => moveItem(item)}
                    >
                      {moving ? 'Moving…' : targetLabel}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Alert>
    <EditTaskModal
      show={!!editingTask}
      task={editingTask}
      onHide={() => setEditingTask(null)}
      onUpdated={() => {
        setEditingTask(null);
        void loadRecommendations();
      }}
    />
    <EditStoryModal
      show={!!editingStory}
      story={editingStory}
      goals={storyGoals}
      onHide={() => setEditingStory(null)}
      onStoryUpdated={() => {
        setEditingStory(null);
        void loadRecommendations();
      }}
    />
    </>
  );
};

export default PlannerCapacityBanner;
