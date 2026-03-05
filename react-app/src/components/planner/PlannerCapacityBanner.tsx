import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button } from 'react-bootstrap';
import { ArrowRightLeft, CalendarClock, ChevronDown, ChevronRight, KanbanSquare, Settings2 } from 'lucide-react';
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import EditTaskModal from '../EditTaskModal';
import EditStoryModal from '../EditStoryModal';
import { Goal, Story, Task } from '../../types';

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

const isTaskDone = (value: unknown): boolean => {
  if (typeof value === 'number') return value === 2;
  const raw = String(value || '').toLowerCase();
  return ['done', 'complete', 'completed', 'closed', 'finished'].includes(raw);
};

const isStoryDone = (value: unknown): boolean => {
  if (typeof value === 'number') return value >= 4;
  const raw = String(value || '').toLowerCase();
  return ['done', 'complete', 'completed', 'closed', 'finished'].includes(raw);
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

const formatPriorityLabel = (value: unknown): string => {
  const normalized = normalizePriority(value, 2);
  if (normalized >= 4) return 'Critical';
  if (normalized === 3) return 'High';
  if (normalized === 2) return 'Medium';
  return 'Low';
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
  entity: any;
};

const PlannerCapacityBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const navigate = useNavigate();
  const [plannerStats, setPlannerStats] = useState<any | null>(null);
  const [recommendations, setRecommendations] = useState<MoveRecommendation[]>([]);
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
    });
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
    });
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
    );
    const tasksUnsub = onSnapshot(
      query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
      ),
      () => setEntitiesVersion((prev) => prev + 1),
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
      if (!windowStartMs || !windowEndMs) return 'next planning window';
      const start = new Date(windowStartMs);
      const end = new Date(windowEndMs);
      return `${start.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} to ${end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    })();

    const updatedLabel = lastRunAtMs
      ? new Date(lastRunAtMs).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : null;

    return {
      unscheduledStories,
      unscheduledTasks,
      shortfallMinutes,
      rangeLabel,
      updatedLabel,
    };
  }, [plannerStats]);

  const loadRecommendations = useCallback(async () => {
    if (!currentUser?.uid || !currentPersona || !summary) {
      setRecommendations([]);
      return;
    }
    if (!currentSprint) {
      setRecommendations([]);
      setRecommendationStatus('No active/planning sprint is available yet to score move recommendations.');
      return;
    }

    setLoadingRecommendations(true);
    setRecommendationStatus(null);

    try {
      const [storiesSnap, tasksSnap] = await Promise.all([
        getDocs(query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', currentPersona),
        )),
        getDocs(query(
          collection(db, 'tasks'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', currentPersona),
        )),
      ]);

      const storyCandidates: MoveRecommendation[] = storiesSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((story) => String((story as any)?.sprintId || '') === String(currentSprint.id))
        .filter((story) => !isStoryDone((story as any)?.status))
        .map((story) => {
          const points = normalizeStoryPoints(story);
          return {
            kind: 'story' as const,
            id: story.id,
            ref: String((story as any).ref || `STORY-${story.id.slice(0, 6).toUpperCase()}`),
            title: String(story.title || 'Untitled story'),
            priority: normalizePriority((story as any).priority, 2),
            points,
            hours: points,
            entity: story,
          };
        });

      const taskCandidates: MoveRecommendation[] = tasksSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((task) => String((task as any)?.sprintId || '') === String(currentSprint.id))
        .filter((task) => !isTaskDone((task as any)?.status))
        .filter((task) => isMovableTaskType((task as any)?.type))
        .map((task) => {
          const points = normalizeTaskPoints(task);
          return {
            kind: 'task' as const,
            id: task.id,
            ref: String((task as any).ref || `TASK-${task.id.slice(0, 6).toUpperCase()}`),
            title: String(task.title || 'Untitled task'),
            priority: normalizePriority((task as any).priority, 2),
            points,
            hours: points,
            entity: task,
          };
        });

      const ranked = [...storyCandidates, ...taskCandidates].sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority; // low priority first
        if (a.hours !== b.hours) return b.hours - a.hours; // bigger first
        return a.title.localeCompare(b.title);
      });

      const shortfallHours = Math.max(1, Number(summary.shortfallMinutes || 0) / 60);
      const next: MoveRecommendation[] = [];
      let covered = 0;
      for (const item of ranked) {
        if (next.length >= 6) break;
        if (next.length >= 3 && covered >= shortfallHours) break;
        next.push(item);
        covered += item.hours;
      }
      setRecommendations(next);
      if (!next.length) {
        setRecommendationStatus('No movable in-sprint stories/tasks were found for the current sprint.');
      } else {
        const covered = next.reduce((sum, item) => sum + item.hours, 0);
        if (nextSprint) {
          setRecommendationStatus(`Suggested to move into ${nextSprint.name}: ${next.length} items (about ${Math.round(covered * 10) / 10}h) based on lower priority and larger size.`);
        } else {
          setRecommendationStatus(`Found ${next.length} move candidates (about ${Math.round(covered * 10) / 10}h), but there is no next sprint yet to move them into.`);
        }
      }
    } catch (error: any) {
      console.error('PlannerCapacityBanner: failed to load move recommendations', error);
      setRecommendations([]);
      setRecommendationStatus(error?.message || 'Failed to load move recommendations.');
    } finally {
      setLoadingRecommendations(false);
    }
  }, [currentPersona, currentSprint, currentUser?.uid, nextSprint, summary, entitiesVersion]);

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
      const filteredGoals = rawGoals.filter((goal) => (
        !currentPersona
        || !goal.persona
        || goal.persona === currentPersona
      ));
      setStoryGoals(filteredGoals);
    } catch (error) {
      console.error('PlannerCapacityBanner: failed to load goals for story editor', error);
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

  const moveItemToNextSprint = useCallback(async (item: MoveRecommendation) => {
    if (!nextSprint) return;
    const actionKey = `${item.kind}:${item.id}`;
    setMovingIds((prev) => ({ ...prev, [actionKey]: true }));
    setRecommendationStatus(null);
    try {
      if (item.kind === 'story') {
        await updateDoc(doc(db, 'stories', item.id), {
          sprintId: nextSprint.id,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, 'tasks', item.id), {
          sprintId: nextSprint.id,
          dueDate: Number(nextSprint.startDate || Date.now()),
          dueDateLocked: true,
          dueDateReason: 'move_to_next_sprint',
          updatedAt: serverTimestamp(),
          serverUpdatedAt: Date.now(),
        });
      }
      setRecommendations((prev) => prev.filter((r) => !(r.kind === item.kind && r.id === item.id)));
      setRecommendationStatus(`${item.ref} moved to ${nextSprint.name}.`);
    } catch (error: any) {
      console.error('PlannerCapacityBanner: failed to move item', { item, error });
      setRecommendationStatus(error?.message || `Failed to move ${item.ref}.`);
    } finally {
      setMovingIds((prev) => {
        const next = { ...prev };
        delete next[actionKey];
        return next;
      });
    }
  }, [nextSprint]);

  const moveAllRecommendations = useCallback(async () => {
    if (!recommendations.length || !nextSprint) return;
    setRecommendationStatus(null);
    for (const item of recommendations) {
      await moveItemToNextSprint(item);
    }
    await loadRecommendations();
  }, [loadRecommendations, moveItemToNextSprint, nextSprint, recommendations]);

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

  return (
    <>
    <Alert
      variant="warning"
      className="border-0 shadow-sm mb-3"
      dismissible
      onClose={() => {
        void dismissForToday();
      }}
    >
      <div className="d-flex flex-wrap align-items-center justify-content-between gap-3">
        <div className="d-flex align-items-center gap-2">
          <CalendarClock size={20} />
          <div>
            <div className="fw-semibold">Planner capacity is short</div>
            <div className="text-muted small">
              {detailParts.join(' · ')} across {summary.rangeLabel}. Existing Google Calendar events and fixed blocks are already being treated as busy time.
            </div>
            {summary.updatedLabel && (
              <div className="text-muted" style={{ fontSize: 12 }}>
                Last planner run {summary.updatedLabel}
              </div>
            )}
          </div>
        </div>
        <div className="d-flex align-items-center gap-2">
          <Button size="sm" variant="dark" onClick={() => navigate('/sprints/planning')}>
            <ArrowRightLeft size={14} className="me-1" />
            Priority matrix
          </Button>
          <Button size="sm" variant="outline-dark" onClick={() => navigate('/calendar/planner')}>
            <Settings2 size={14} className="me-1" />
            Weekly planner
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
              aria-label={showRecommendations ? 'Hide recommended moves' : 'Show recommended moves'}
              title={showRecommendations ? 'Hide recommended moves' : 'Show recommended moves'}
            >
              {showRecommendations ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </Button>
            <div className="fw-semibold" style={{ fontSize: 13 }}>
              Recommended moves to {nextSprint?.name || 'next sprint'}
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
            <Button
              size="sm"
              variant="dark"
              onClick={moveAllRecommendations}
              disabled={!recommendations.length || !nextSprint}
            >
              Move all suggested
            </Button>
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
                    <strong>{item.ref}</strong> · {item.title} · {item.kind === 'story' ? 'Story' : 'Task'} · {formatPriorityLabel(item.priority)} · {Math.round(item.points * 10) / 10} pts
                    {item.kind === 'task' && nextSprint?.startDate ? (
                      <span className="text-muted"> · due {new Date(nextSprint.startDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</span>
                    ) : null}
                  </div>
                  <div className="d-flex align-items-center gap-2 ms-auto flex-nowrap">
                    <Button
                      size="sm"
                      variant="outline-secondary"
                      style={{ minWidth: 72 }}
                      onClick={() => { void openEditModal(item); }}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline-dark"
                      style={{ minWidth: 170 }}
                      disabled={moving || !nextSprint}
                      onClick={() => moveItemToNextSprint(item)}
                    >
                      {moving ? 'Moving…' : `Move to ${nextSprint?.name || 'next sprint'}`}
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
