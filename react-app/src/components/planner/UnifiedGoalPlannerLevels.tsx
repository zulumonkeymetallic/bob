import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Container, Form, Row } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, Edit3, Activity, Wand2, CalendarPlus, PanelsTopLeft } from 'lucide-react';
import { draggable, dropTargetForElements, monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  addMonths,
  addQuarters,
  addWeeks,
  addYears,
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
  startOfYear,
} from 'date-fns';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { useSprint } from '../../contexts/SprintContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import type { Goal, Sprint, Story, Task } from '../../types';
import { getStatusName, getThemeName, isStatus } from '../../utils/statusHelpers';
import { getActiveFocusLeafGoalIds, getGoalDisplayPath, isGoalInHierarchySet } from '../../utils/goalHierarchy';
import { goalNeedsLinkedPot } from '../../utils/goalCost';
import { buildGoalTimelineImpactPlan, type GoalTimelineAffectedStory } from '../visualization/goalTimelineImpact';
import { applyGoalTimelineChanges } from '../../utils/goalTimelineChanges';
import EditGoalModal from '../EditGoalModal';
import GoalPlanningWorkspaceModal from '../GoalPlanningWorkspaceModal';
import ConfirmSprintChangesModal from '../visualization/ConfirmSprintChangesModal';
import GoalMultiSelect from '../shared/GoalMultiSelect';
import ThemeMultiSelect from '../shared/ThemeMultiSelect';
import PlanActionBar from './PlanActionBar';
import { getEntityAiScore, isTop3Story, isTop3Task } from '../../utils/top3';

export type GoalPlannerLevel = 'year' | 'quarter' | 'month' | 'sprint';

interface UnifiedGoalPlannerLevelsProps {
  level: GoalPlannerLevel;
  anchorDate?: Date;
  embedded?: boolean;
}

interface PlannerPeriod {
  key: string;
  label: string;
  subLabel: string;
  start: Date;
  end: Date;
  startMs: number;
  endMs: number;
  targetYear: number;
}

interface PendingGoalTimelineChange {
  goalId: string;
  startDate: number;
  endDate: number;
  targetYear: number | null;
  affectedStories: GoalTimelineAffectedStory[];
}

interface GoalMetrics {
  storyCount: number;
  taskCount: number;
  top3Count: number;
  aiScoredCount: number;
  maxAiScore: number | null;
  earliestDueMs: number | null;
  isFocusAligned: boolean;
}

const DEFAULT_DURATION_MS = 30 * 86400000;

const toMillis = (value: any): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const goalAnchorMs = (goal: Goal): number | null => (
  toMillis((goal as any).endDate)
  ?? toMillis((goal as any).targetDate)
  ?? toMillis((goal as any).startDate)
  ?? null
);

const getLevelTitle = (level: GoalPlannerLevel) => {
  switch (level) {
    case 'year':
      return 'Year Planner';
    case 'quarter':
      return 'Quarter Planner';
    case 'month':
      return 'Month Planner';
    case 'sprint':
    default:
      return 'Sprint Planner';
  }
};

const normalizeAnchor = (level: GoalPlannerLevel, anchorDate?: Date) => {
  const source = anchorDate || new Date();
  if (level === 'year') return startOfYear(source);
  if (level === 'quarter') return startOfQuarter(source);
  if (level === 'month') return startOfMonth(source);
  return startOfWeek(source, { weekStartsOn: 1 });
};

const shiftAnchor = (level: GoalPlannerLevel, anchor: Date, delta: number) => {
  if (level === 'year') return addYears(anchor, delta);
  if (level === 'quarter') return addQuarters(anchor, delta);
  if (level === 'month') return addMonths(anchor, delta);
  return addWeeks(anchor, delta);
};

const buildPeriods = (level: GoalPlannerLevel, anchor: Date): PlannerPeriod[] => {
  return Array.from({ length: 5 }, (_, index) => {
    const start = shiftAnchor(level, anchor, index);
    const end = level === 'year'
      ? endOfYear(start)
      : level === 'quarter'
        ? endOfQuarter(start)
        : level === 'month'
          ? endOfMonth(start)
          : endOfWeek(start, { weekStartsOn: 1 });
    const label = level === 'year'
      ? format(start, 'yyyy')
      : level === 'quarter'
        ? `Q${Math.floor(start.getMonth() / 3) + 1} ${format(start, 'yyyy')}`
        : level === 'month'
          ? format(start, 'MMM yyyy')
          : format(start, 'dd MMM');
    const subLabel = level === 'sprint'
      ? `${format(start, 'EEE')} - ${format(end, 'EEE d MMM')}`
      : `${format(start, 'd MMM')} - ${format(end, 'd MMM')}`;
    return {
      key: `${level}-${format(start, 'yyyy-MM-dd')}`,
      label,
      subLabel,
      start,
      end,
      startMs: start.getTime(),
      endMs: end.getTime(),
      targetYear: start.getFullYear(),
    };
  });
};

const durationMsForGoal = (goal: Goal, fallbackEndMs: number) => {
  const startMs = toMillis((goal as any).startDate);
  const endMs = toMillis((goal as any).endDate);
  if (startMs != null && endMs != null && endMs > startMs) return endMs - startMs;
  return Math.max(DEFAULT_DURATION_MS, fallbackEndMs - (startMs ?? fallbackEndMs));
};

const goalThemeColor = (goal: Goal, themes: Array<{ id: number | string; color?: string; name?: string; label?: string }>) => {
  const match = themes.find((theme) => String(theme.id) === String((goal as any).theme));
  return match?.color || '#2563eb';
};

const GoalPlannerCard: React.FC<{
  goal: Goal;
  metrics: GoalMetrics;
  allGoals: Goal[];
  themeColor: string;
  onEdit: (goal: Goal) => void;
  onWorkspace: (goal: Goal) => void;
  onActivity: (goal: Goal) => void;
  onGenerateStories: (goal: Goal) => void;
  onSchedule: (goal: Goal) => void;
}> = ({ goal, metrics, allGoals, themeColor, onEdit, onWorkspace, onActivity, onGenerateStories, onSchedule }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return draggable({
      element: el,
      getInitialData: () => ({ type: 'goal', item: goal, id: goal.id }),
    });
  }, [goal]);

  return (
    <Card
      ref={ref}
      className="shadow-sm border-0"
      style={{
        cursor: 'grab',
        borderLeft: `4px solid ${themeColor}`,
      }}
    >
      <Card.Body className="p-3">
        <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
          <div className="min-w-0">
            <div className="small fw-semibold text-uppercase" style={{ color: themeColor }}>
              {String((goal as any).ref || goal.id).slice(0, 16)}
            </div>
            <div className="fw-semibold" style={{ lineHeight: 1.3 }}>{goal.title}</div>
          </div>
          <div className="d-flex align-items-center gap-1 flex-wrap justify-content-end">
            <Button size="sm" variant="link" className="p-0 text-muted" onClick={() => onWorkspace(goal)} title="Open planning workspace">
              <PanelsTopLeft size={15} />
            </Button>
            <Button size="sm" variant="link" className="p-0 text-muted" onClick={() => onActivity(goal)} title="Open activity stream">
              <Activity size={15} />
            </Button>
            <Button size="sm" variant="link" className="p-0 text-muted" onClick={() => onEdit(goal)} title="Edit goal">
              <Edit3 size={15} />
            </Button>
          </div>
        </div>
        <div className="text-muted small mb-2">
          {getGoalDisplayPath(goal.id, allGoals)}
        </div>
        <div className="d-flex gap-1 flex-wrap mb-2">
          <Badge bg="light" text="dark">{getThemeName((goal as any).theme)}</Badge>
          <Badge bg="secondary">{getStatusName((goal as any).status)}</Badge>
          {metrics.isFocusAligned && <Badge bg="primary">Focus</Badge>}
          {metrics.top3Count > 0 && <Badge bg="danger">Top 3 {metrics.top3Count}</Badge>}
          {metrics.aiScoredCount > 0 && <Badge bg="info">AI {metrics.aiScoredCount}</Badge>}
          {goalNeedsLinkedPot(goal) && <Badge bg="warning" text="dark">No pot</Badge>}
        </div>
        <div className="small text-muted mb-3">
          {metrics.storyCount} stories · {metrics.taskCount} tasks
          {metrics.maxAiScore != null ? ` · max AI ${metrics.maxAiScore}` : ''}
          {metrics.earliestDueMs ? ` · next due ${new Date(metrics.earliestDueMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}
        </div>
        <div className="d-flex gap-2 flex-wrap">
          <Button size="sm" variant="outline-primary" onClick={() => onGenerateStories(goal)}>
            <Wand2 size={14} className="me-1" /> Stories
          </Button>
          <Button size="sm" variant="outline-secondary" onClick={() => onSchedule(goal)}>
            <CalendarPlus size={14} className="me-1" /> Schedule
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

const GoalPlannerPeriodColumn: React.FC<{
  period: PlannerPeriod;
  goals: Goal[];
  metricsByGoalId: Map<string, GoalMetrics>;
  allGoals: Goal[];
  themes: Array<{ id: number | string; color?: string; name?: string; label?: string }>;
  onEdit: (goal: Goal) => void;
  onWorkspace: (goal: Goal) => void;
  onActivity: (goal: Goal) => void;
  onGenerateStories: (goal: Goal) => void;
  onSchedule: (goal: Goal) => void;
}> = ({ period, goals, metricsByGoalId, allGoals, themes, onEdit, onWorkspace, onActivity, onGenerateStories, onSchedule }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return dropTargetForElements({
      element: el,
      getData: () => ({
        periodStartMs: period.startMs,
        periodEndMs: period.endMs,
        targetYear: period.targetYear,
      }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [period]);

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="bg-white border-0 pb-0">
        <div className="fw-semibold">{period.label}</div>
        <div className="text-muted small">{period.subLabel}</div>
        <div className="text-muted small mt-1">{goals.length} goals</div>
      </Card.Header>
      <Card.Body
        ref={ref}
        className="d-flex flex-column gap-2"
        style={{
          minHeight: 240,
          background: isOver ? 'rgba(37, 99, 235, 0.06)' : undefined,
          transition: 'background 120ms ease',
        }}
      >
        {goals.length === 0 ? (
          <div className="text-muted small">Drop a goal here</div>
        ) : goals.map((goal) => (
          <GoalPlannerCard
            key={goal.id}
            goal={goal}
            metrics={metricsByGoalId.get(goal.id) || {
              storyCount: 0,
              taskCount: 0,
              top3Count: 0,
              aiScoredCount: 0,
              maxAiScore: null,
              earliestDueMs: null,
              isFocusAligned: false,
            }}
            allGoals={allGoals}
            themeColor={goalThemeColor(goal, themes)}
            onEdit={onEdit}
            onWorkspace={onWorkspace}
            onActivity={onActivity}
            onGenerateStories={onGenerateStories}
            onSchedule={onSchedule}
          />
        ))}
      </Card.Body>
    </Card>
  );
};

const UnifiedGoalPlannerLevels: React.FC<UnifiedGoalPlannerLevelsProps> = ({
  level,
  anchorDate,
  embedded = false,
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const { themes } = useGlobalThemes();
  const { showSidebar } = useSidebar();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);
  const [selectedThemeIds, setSelectedThemeIds] = useState<number[]>([]);
  const [showCompletedItems, setShowCompletedItems] = useState(false);
  const [showTop3Only, setShowTop3Only] = useState(false);
  const [showAiScoredOnly, setShowAiScoredOnly] = useState(false);
  const [showFocusOnly, setShowFocusOnly] = useState(false);
  const [showNoPotOnly, setShowNoPotOnly] = useState(false);
  const [sortField, setSortField] = useState<'none' | 'top3' | 'aiScore' | 'dueDate'>('none');
  const [currentAnchor, setCurrentAnchor] = useState<Date>(() => normalizeAnchor(level, anchorDate));
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [workspaceGoal, setWorkspaceGoal] = useState<Goal | null>(null);
  const [pendingSprintChanges, setPendingSprintChanges] = useState<PendingGoalTimelineChange | null>(null);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);
  const periods = useMemo(() => buildPeriods(level, currentAnchor), [level, currentAnchor]);
  const themesPalette = useMemo(() => themes || [], [themes]);

  useEffect(() => {
    setCurrentAnchor(normalizeAnchor(level, anchorDate));
  }, [level, anchorDate]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) return;

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );

    const unsubGoals = onSnapshot(goalsQuery, (snap) => setGoals(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Goal[]));
    const unsubStories = onSnapshot(storiesQuery, (snap) => setStories(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Story[]));
    const unsubTasks = onSnapshot(tasksQuery, (snap) => setTasks(snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[]));

    return () => {
      unsubGoals();
      unsubStories();
      unsubTasks();
    };
  }, [currentUser?.uid, currentPersona]);

  const storyById = useMemo(() => new Map(stories.map((story) => [story.id, story])), [stories]);

  const metricsByGoalId = useMemo(() => {
    const next = new Map<string, GoalMetrics>();
    goals.forEach((goal) => {
      const descendantStories = stories.filter((story) => {
        if (isStatus((story as any).status, 'done')) return false;
        const goalId = String((story as any).goalId || '').trim();
        return goalId ? isGoalInHierarchySet(goalId, goals, new Set([goal.id])) : false;
      });
      const descendantTasks = tasks.filter((task) => {
        const status = Number((task as any).status);
        if (Number.isFinite(status) ? status >= 2 : isStatus((task as any).status, 'done')) return false;
        const goalId = String((task as any).goalId || '').trim();
        if (goalId && isGoalInHierarchySet(goalId, goals, new Set([goal.id]))) return true;
        const parentStoryId = String((task as any).storyId || (task.parentType === 'story' ? task.parentId || '' : '')).trim();
        const parentStory = parentStoryId ? storyById.get(parentStoryId) : null;
        const storyGoalId = String((parentStory as any)?.goalId || '').trim();
        return storyGoalId ? isGoalInHierarchySet(storyGoalId, goals, new Set([goal.id])) : false;
      });
      const aiScores = [
        ...descendantStories.map((story) => getEntityAiScore(story)).filter(Number.isFinite),
        ...descendantTasks.map((task) => getEntityAiScore(task)).filter(Number.isFinite),
      ] as number[];
      const top3TaskCount = descendantTasks.filter((task) => {
        const parentStoryId = String((task as any).storyId || (task.parentType === 'story' ? task.parentId || '' : '')).trim();
        const parentStory = parentStoryId ? storyById.get(parentStoryId) : null;
        return isTop3Task(task, () => {
          const directRank = Number((task as any)?.manualPriorityRank || 0);
          if (Number.isFinite(directRank) && directRank > 0) return directRank;
          const parentRank = Number((parentStory as any)?.manualPriorityRank || 0);
          return Number.isFinite(parentRank) && parentRank > 0 ? parentRank : null;
        });
      }).length;
      const dueValues = [
        ...descendantStories.map((story) => goalAnchorMs(story as any)).filter((value): value is number => value != null),
        ...descendantTasks.map((task) => toMillis((task as any).dueDate ?? (task as any).targetDate)).filter((value): value is number => value != null),
      ].sort((a, b) => a - b);
      next.set(goal.id, {
        storyCount: descendantStories.length,
        taskCount: descendantTasks.length,
        top3Count: descendantStories.filter((story) => isTop3Story(story)).length + top3TaskCount,
        aiScoredCount: aiScores.length,
        maxAiScore: aiScores.length ? Math.max(...aiScores) : null,
        earliestDueMs: dueValues[0] || null,
        isFocusAligned: activeFocusGoalIds.size > 0 && isGoalInHierarchySet(goal.id, goals, activeFocusGoalIds),
      });
    });
    return next;
  }, [goals, stories, tasks, storyById, activeFocusGoalIds]);

  const filteredGoals = useMemo(() => {
    const selectedGoalIdSet = new Set(selectedGoalIds);
    const selectedThemeIdSet = new Set(selectedThemeIds);
    return goals.filter((goal) => {
      if (!showCompletedItems && isStatus((goal as any).status, 'done')) return false;
      if (selectedGoalIdSet.size > 0 && !isGoalInHierarchySet(goal.id, goals, selectedGoalIdSet)) return false;
      if (selectedThemeIdSet.size > 0 && !selectedThemeIdSet.has(Number((goal as any).theme))) return false;
      const metrics = metricsByGoalId.get(goal.id);
      if (showTop3Only && !(metrics && metrics.top3Count > 0)) return false;
      if (showAiScoredOnly && !(metrics && metrics.aiScoredCount > 0)) return false;
      if (showFocusOnly && !(metrics && metrics.isFocusAligned)) return false;
      if (showNoPotOnly && !goalNeedsLinkedPot(goal)) return false;
      return true;
    });
  }, [goals, selectedGoalIds, selectedThemeIds, showCompletedItems, showTop3Only, showAiScoredOnly, showFocusOnly, showNoPotOnly, metricsByGoalId]);

  const sortedGoals = useMemo(() => {
    const next = [...filteredGoals];
    next.sort((a, b) => {
      const aMetrics = metricsByGoalId.get(a.id);
      const bMetrics = metricsByGoalId.get(b.id);
      if (sortField === 'top3') {
        return (bMetrics?.top3Count || 0) - (aMetrics?.top3Count || 0);
      }
      if (sortField === 'aiScore') {
        return (bMetrics?.maxAiScore || -Infinity) - (aMetrics?.maxAiScore || -Infinity);
      }
      if (sortField === 'dueDate') {
        return (aMetrics?.earliestDueMs || Number.MAX_SAFE_INTEGER) - (bMetrics?.earliestDueMs || Number.MAX_SAFE_INTEGER);
      }
      return Number((a as any).orderIndex || 0) - Number((b as any).orderIndex || 0);
    });
    return next;
  }, [filteredGoals, metricsByGoalId, sortField]);

  const periodGoals = useMemo(() => {
    const grouped = new Map<string, Goal[]>();
    periods.forEach((period) => grouped.set(period.key, []));
    sortedGoals.forEach((goal) => {
      const anchorMs = goalAnchorMs(goal);
      const period = periods.find((candidate) => anchorMs != null && anchorMs >= candidate.startMs && anchorMs <= candidate.endMs);
      if (period) {
        grouped.get(period.key)?.push(goal);
      }
    });
    return grouped;
  }, [periods, sortedGoals]);

  const unscheduledGoals = useMemo(
    () => sortedGoals.filter((goal) => !periods.some((period) => {
      const anchorMs = goalAnchorMs(goal);
      return anchorMs != null && anchorMs >= period.startMs && anchorMs <= period.endMs;
    })),
    [sortedGoals, periods],
  );

  const applyGoalMove = async (goal: Goal, periodStartMs: number, periodEndMs: number, targetYear: number | null) => {
    if (!currentUser?.uid) return;
    const durationMs = durationMsForGoal(goal, periodEndMs);
    const startDateMs = periodStartMs;
    const endDateMs = Math.min(periodEndMs, startDateMs + durationMs);
    const impact = buildGoalTimelineImpactPlan({
      goalId: goal.id,
      newStartDate: new Date(startDateMs),
      newEndDate: new Date(endDateMs),
      stories,
      tasks,
      sprints: sprints as Sprint[],
    });
    if (impact.affectedStories.length > 0) {
      setPendingSprintChanges({
        goalId: goal.id,
        startDate: startDateMs,
        endDate: endDateMs,
        targetYear,
        affectedStories: impact.affectedStories,
      });
      return;
    }
    await applyGoalTimelineChanges({
      goalId: goal.id,
      startDateMs,
      endDateMs,
      targetYear,
      ownerUid: currentUser.uid,
      persona: (currentPersona || 'personal') as 'personal' | 'work',
      affectedStories: [],
    });
    setFeedback({ variant: 'success', text: `${goal.title} moved to ${new Date(startDateMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}.` });
  };

  useEffect(() => {
    return monitorForElements({
      onDrop: async ({ source, location }) => {
        const destination = location.current.dropTargets[0];
        const goal = source.data.item as Goal | undefined;
        if (!destination || !goal) return;
        const targetStartMs = Number((destination.data as any)?.periodStartMs || 0);
        const targetEndMs = Number((destination.data as any)?.periodEndMs || 0);
        if (!targetStartMs || !targetEndMs) return;
        await applyGoalMove(goal, targetStartMs, targetEndMs, Number((destination.data as any)?.targetYear || 0) || null);
      },
    });
  }, [stories, tasks, sprints, currentUser?.uid, currentPersona]);

  const handleGenerateStories = async (goal: Goal) => {
    try {
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      const resp: any = await callable({ goalId: goal.id });
      const created = Number(resp?.data?.created || 0);
      setFeedback({ variant: 'success', text: created > 0 ? `Generated ${created} stories for ${goal.title}.` : `No new stories were generated for ${goal.title}.` });
    } catch (error: any) {
      setFeedback({ variant: 'danger', text: error?.message || `Failed to generate stories for ${goal.title}.` });
    }
  };

  const handleScheduleGoal = async (goal: Goal) => {
    try {
      const runPlanner = httpsCallable(functions, 'runPlanner');
      const result: any = await runPlanner({
        startDate: new Date().toISOString().slice(0, 10),
        days: 7,
        persona: currentPersona || 'personal',
        focusGoalId: goal.id,
        goalTimeRequest: Number((goal as any).timeToMasterHours || 0) > 0 ? Math.min(Number((goal as any).timeToMasterHours) * 60, 300) : 120,
      });
      const createdBlocks = Number(result?.data?.llm?.blocksCreated || 0)
        || (Array.isArray(result?.data?.llm?.blocks) ? result.data.llm.blocks.length : 0);
      setFeedback({ variant: createdBlocks > 0 ? 'success' : 'warning', text: createdBlocks > 0 ? `Scheduled ${createdBlocks} blocks for ${goal.title}.` : `No free slot found for ${goal.title}.` });
    } catch (error: any) {
      setFeedback({ variant: 'danger', text: error?.message || `Failed to schedule ${goal.title}.` });
    }
  };

  const handleConfirmSprintChanges = async () => {
    if (!pendingSprintChanges || !currentUser?.uid) return;
    try {
      await applyGoalTimelineChanges({
        goalId: pendingSprintChanges.goalId,
        startDateMs: pendingSprintChanges.startDate,
        endDateMs: pendingSprintChanges.endDate,
        targetYear: pendingSprintChanges.targetYear,
        ownerUid: currentUser.uid,
        persona: (currentPersona || 'personal') as 'personal' | 'work',
        affectedStories: pendingSprintChanges.affectedStories,
      });
      setFeedback({ variant: 'success', text: 'Goal timeline and linked stories updated.' });
    } catch (error: any) {
      setFeedback({ variant: 'danger', text: error?.message || 'Failed to apply timeline changes.' });
    } finally {
      setPendingSprintChanges(null);
    }
  };

  return (
    <Container fluid className={embedded ? 'p-2' : 'p-3'}>
      {!embedded && (
        <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
          <div>
            <h3 className="mb-1">{getLevelTitle(level)}</h3>
            <div className="text-muted small">Goal planning with the sprint-planning card format and goal timeline impact handling.</div>
          </div>
          <Badge bg="info">{periods.length} rolling columns</Badge>
        </div>
      )}

      {!embedded && (
        <Card className="shadow-sm border-0 mb-3">
          <Card.Body className="py-2">
            <PlanActionBar />
          </Card.Body>
        </Card>
      )}

      {feedback && (
        <Alert variant={feedback.variant} dismissible onClose={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      )}

      <Card className="shadow-sm border-0 mb-3">
        <Card.Body>
          <Row className="g-3 align-items-end">
            <Col md={3}>
              <Form.Label className="small fw-semibold">Goals</Form.Label>
              <GoalMultiSelect
                goals={goals}
                selectedIds={selectedGoalIds}
                onChange={setSelectedGoalIds}
                getLabel={(goal) => getGoalDisplayPath(goal.id, goals)}
              />
            </Col>
            <Col md={3}>
              <Form.Label className="small fw-semibold">Themes</Form.Label>
              <ThemeMultiSelect selectedIds={selectedThemeIds} onChange={setSelectedThemeIds} />
            </Col>
            <Col md={3}>
              <Form.Label className="small fw-semibold">Sort</Form.Label>
              <Form.Select size="sm" value={sortField} onChange={(event) => setSortField(event.target.value as 'none' | 'top3' | 'aiScore' | 'dueDate')}>
                <option value="none">Manual order</option>
                <option value="top3">Top 3 descendants</option>
                <option value="aiScore">Max AI score</option>
                <option value="dueDate">Next due</option>
              </Form.Select>
            </Col>
            <Col md={3}>
              <Form.Label className="small fw-semibold">Window</Form.Label>
              <div className="d-flex align-items-center gap-2">
                <Button size="sm" variant="outline-secondary" onClick={() => setCurrentAnchor((prev) => shiftAnchor(level, prev, -1))}>
                  <ChevronLeft size={14} />
                </Button>
                <div className="small text-muted flex-grow-1 text-center">
                  {periods[0]?.label} - {periods[periods.length - 1]?.label}
                </div>
                <Button size="sm" variant="outline-secondary" onClick={() => setCurrentAnchor((prev) => shiftAnchor(level, prev, 1))}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </Col>
            <Col md={3}>
              <Form.Check type="switch" label="Show completed goals" checked={showCompletedItems} onChange={(event) => setShowCompletedItems(event.target.checked)} />
            </Col>
            <Col md={3}>
              <Form.Check type="switch" label="Top 3 only" checked={showTop3Only} onChange={(event) => setShowTop3Only(event.target.checked)} />
            </Col>
            <Col md={3}>
              <Form.Check type="switch" label="AI-scored only" checked={showAiScoredOnly} onChange={(event) => setShowAiScoredOnly(event.target.checked)} />
            </Col>
            <Col md={3}>
              <Form.Check type="switch" label="Focus goals only" checked={showFocusOnly} onChange={(event) => setShowFocusOnly(event.target.checked)} />
            </Col>
            <Col md={3}>
              <Form.Check type="switch" label="No linked pot only" checked={showNoPotOnly} onChange={(event) => setShowNoPotOnly(event.target.checked)} />
            </Col>
          </Row>
        </Card.Body>
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, minmax(240px, 1fr))',
          gap: 16,
          alignItems: 'start',
          overflowX: 'auto',
        }}
      >
        {periods.map((period) => (
          <GoalPlannerPeriodColumn
            key={period.key}
            period={period}
            goals={periodGoals.get(period.key) || []}
            metricsByGoalId={metricsByGoalId}
            allGoals={goals}
            themes={themesPalette}
            onEdit={setEditingGoal}
            onWorkspace={setWorkspaceGoal}
            onActivity={(goal) => showSidebar(goal, 'goal')}
            onGenerateStories={handleGenerateStories}
            onSchedule={handleScheduleGoal}
          />
        ))}
      </div>

      {unscheduledGoals.length > 0 && (
        <Card className="shadow-sm border-0 mt-3">
          <Card.Body>
            <div className="fw-semibold mb-2">Unscheduled Goals</div>
            <div className="text-muted small mb-3">These goals do not yet fall inside the visible rolling window.</div>
            <div className="d-flex flex-column gap-2">
              {unscheduledGoals.slice(0, 10).map((goal) => (
                <GoalPlannerCard
                  key={goal.id}
                  goal={goal}
                  metrics={metricsByGoalId.get(goal.id)!}
                  allGoals={goals}
                  themeColor={goalThemeColor(goal, themesPalette)}
                  onEdit={setEditingGoal}
                  onWorkspace={setWorkspaceGoal}
                  onActivity={(candidate) => showSidebar(candidate, 'goal')}
                  onGenerateStories={handleGenerateStories}
                  onSchedule={handleScheduleGoal}
                />
              ))}
            </div>
          </Card.Body>
        </Card>
      )}

      <EditGoalModal
        show={Boolean(editingGoal)}
        goal={editingGoal}
        onClose={() => setEditingGoal(null)}
        currentUserId={currentUser?.uid || ''}
        allGoals={goals}
      />

      <GoalPlanningWorkspaceModal
        show={Boolean(workspaceGoal)}
        goal={workspaceGoal}
        allGoals={goals}
        onHide={() => setWorkspaceGoal(null)}
      />

      <ConfirmSprintChangesModal
        visible={Boolean(pendingSprintChanges)}
        pendingChanges={pendingSprintChanges ? {
          goalId: pendingSprintChanges.goalId,
          startDate: pendingSprintChanges.startDate,
          endDate: pendingSprintChanges.endDate,
          affectedStories: pendingSprintChanges.affectedStories,
        } : null}
        onConfirm={handleConfirmSprintChanges}
        onCancel={() => setPendingSprintChanges(null)}
      />
    </Container>
  );
};

export default UnifiedGoalPlannerLevels;
