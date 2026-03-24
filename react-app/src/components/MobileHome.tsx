import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, Card, Button, Badge, ListGroup, Form, Modal, Spinner } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useLocation, useNavigate } from 'react-router-dom';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Story, Task } from '../types';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { ChoiceHelper } from '../config/choices';
import { getBadgeVariant, getPriorityBadge, getStatusName } from '../utils/statusHelpers';
import { taskStatusText } from '../utils/storyCardFormatting';
import { extractWeatherSummary, extractWeatherTemp, formatWeatherLine } from '../utils/weatherFormat';
import { isRecurringDueOnDate, resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';
import { Wand2, AlertCircle, RefreshCw, Sparkles, Clock3, Pencil } from 'lucide-react';
import EditTaskModal from './EditTaskModal';
import EditStoryModal from './EditStoryModal';
import DeferItemModal from './DeferItemModal';
import KanbanCardV2 from './KanbanCardV2';
import {
  callDeltaReplan,
  callFullReplan,
  formatDeltaReplanSummary,
  formatFullReplanSummary,
  normalizePlannerCallableError,
} from '../utils/plannerOrchestration';
import {
  findItemWithManualPriorityRank,
  getManualPriorityLabel,
  getManualPriorityRank,
  getNextManualPriorityRank,
} from '../utils/manualPriority';
import { useFocusGoals } from '../hooks/useFocusGoals';
import { getProtectedFocusGoalIds, isGoalInHierarchySet } from '../utils/goalHierarchy';
import { schedulePlannerItem as schedulePlannerItemMutation } from '../utils/plannerScheduling';
import {
  buildStoryProgressUpdate,
  formatStoryProgressLabel,
  MOBILE_STORY_PROGRESS_OPTIONS,
} from '../utils/storyProgress';

type TabKey = 'overview' | 'daily_plan' | 'tasks' | 'stories' | 'goals' | 'chores';
type TaskViewFilter = 'top3' | 'due_today' | 'overdue' | 'all';
type GoalsViewFilter = 'active_sprint' | 'year';
type MobileSharedFilters = {
  top3: boolean;
  chores: boolean;
  focusAligned: boolean;
};
const MOBILE_TAB_ORDER: TabKey[] = ['overview', 'daily_plan', 'tasks', 'stories', 'goals', 'chores'];
const MOBILE_TAB_LABELS: Record<TabKey, string> = {
  overview: 'Overview',
  daily_plan: 'Daily Plan',
  tasks: 'Tasks',
  stories: 'Stories',
  goals: 'Goals',
  chores: 'Chores',
};

const THEME_COLORS: Record<number, string> = {
  1: '#22c55e', // Health
  2: '#6366f1', // Growth
  3: '#facc15', // Wealth
  4: '#ec4899', // Tribe
  5: '#fb923c', // Home
};

const THEME_COLORS_BY_NAME: Record<string, string> = {
  'health & fitness': '#22c55e',
  'career & professional': '#6366f1',
  'finance & wealth': '#facc15',
  'learning & education': '#3b82f6',
  'family & relationships': '#ec4899',
  'hobbies & interests': '#f97316',
  'home & living': '#fb923c',
  'spiritual & personal growth': '#8b5cf6',
  chores: '#16a34a',
  routine: '#0ea5e9',
  'work (main gig)': '#1f2937',
  'side gig': '#14b8a6',
};

const formatShortDate = (value?: number) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const normalizeTabKey = (rawValue: string | null | undefined): TabKey => {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (normalized === 'daily-plan' || normalized === 'dailyplan') return 'daily_plan';
  if (MOBILE_TAB_ORDER.includes(normalized as TabKey)) return normalized as TabKey;
  return 'overview';
};

const MobileHome: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();
  const { currentPersona, setPersona } = usePersona();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);

  const [activeTab, setActiveTab] = useState<TabKey>(() =>
    normalizeTabKey(typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tab'))
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [prioritySource, setPrioritySource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plannerStats, setPlannerStats] = useState<any | null>(null);
  const [noteModal, setNoteModal] = useState<{ type: 'task'|'story'|'goal'; id: string; show: boolean } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [aiFocusOnly, setAiFocusOnly] = useState(true);
  const [aiThreshold, setAiThreshold] = useState(90);
  const [showCompleted, setShowCompleted] = useState(false);
  const [tasksViewFilter, setTasksViewFilter] = useState<TaskViewFilter>('top3');
  const [goalsViewFilter, setGoalsViewFilter] = useState<GoalsViewFilter>('active_sprint');
  const [tasksViewType, setTasksViewType] = useState<'list' | 'detail'>(() => {
    try { return (localStorage.getItem('mobile_tasks_view_type') as 'list' | 'detail') || 'list'; } catch { return 'list'; }
  });
  const [storiesViewType, setStoriesViewType] = useState<'list' | 'detail'>(() => {
    try { return (localStorage.getItem('mobile_stories_view_type') as 'list' | 'detail') || 'list'; } catch { return 'list'; }
  });
  const [dailyPlanViewType, setDailyPlanViewType] = useState<'list' | 'detail'>(() => {
    try { return (localStorage.getItem('mobile_daily_plan_view_type') as 'list' | 'detail') || 'list'; } catch { return 'list'; }
  });
  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  const [replanLoading, setReplanLoading] = useState(false);
  const [fullReplanLoading, setFullReplanLoading] = useState(false);
  const [replanFeedback, setReplanFeedback] = useState<string | null>(null);
  const [choresDueToday, setChoresDueToday] = useState<Task[]>([]);
  const [choresLoading, setChoresLoading] = useState(false);
  const [choreCompletionBusy, setChoreCompletionBusy] = useState<Record<string, boolean>>({});
  const [convertingTaskId, setConvertingTaskId] = useState<string | null>(null);
  const [flaggingStoryId, setFlaggingStoryId] = useState<string | null>(null);
  const [priorityReplanPromptStory, setPriorityReplanPromptStory] = useState<Story | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editingStory, setEditingStory] = useState<Story | null>(null);
  const [deferTarget, setDeferTarget] = useState<{ type: 'task' | 'story'; id: string; title: string; listView?: boolean } | null>(null);
  const [sharedFilters, setSharedFilters] = useState<MobileSharedFilters>({ top3: false, chores: false, focusAligned: false });
  const setActiveMobileTab = useCallback((nextTab: TabKey) => {
    setActiveTab(nextTab);
    const params = new URLSearchParams(location.search);
    if (nextTab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', nextTab);
    }
    const nextSearch = params.toString();
    navigate({ pathname: '/mobile', search: nextSearch ? `?${nextSearch}` : '' }, { replace: true });
  }, [location.search, navigate]);
  const todayIso = useMemo(() => new Date().toISOString().split('T')[0], []);
  const activePlanningSprints = useMemo(
    () => sprints.filter((s) => s.status === 0 || s.status === 1),
    [sprints]
  );
  const briefWeatherSummary = extractWeatherSummary(summary?.dailyBrief?.weather);
  const briefWeatherTemp = extractWeatherTemp(summary?.dailyBrief?.weather);
  const worldWeatherLine = formatWeatherLine(summary?.worldSummary?.weather);
  const formatPlannerLine = (ps: any) => {
    if (!ps) return 'Not yet run';
    const when = ps.lastRunAt
      ? new Date(ps.lastRunAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
      : 'Unknown time';
    return `${when} · +${ps.created || 0} created · ${ps.replaced || 0} replaced · ${ps.blocked || 0} blocked`;
  };

  const resolveThemeColor = useCallback((value: any): string | undefined => {
    if (value == null) return undefined;
    if (typeof value === 'number' && Number.isFinite(value)) return THEME_COLORS[value] || undefined;
    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) return THEME_COLORS[asNumber] || undefined;
    const normalized = String(value || '').trim().toLowerCase();
    return THEME_COLORS_BY_NAME[normalized];
  }, []);
  const renderBriefText = (value: any): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';
    return (
      value.title ||
      value.headline ||
      value.summary ||
      value.text ||
      ''
    );
  };
  const worldNewsItems = (() => {
    const candidates = [
      summary?.worldSummary?.news,
      summary?.worldSummary?.highlights,
      summary?.worldSummary?.headlines,
      summary?.worldSummary?.summary?.news,
      summary?.dailyBrief?.news,
    ];
    for (const bucket of candidates) {
      if (!Array.isArray(bucket) || bucket.length === 0) continue;
      const lines = bucket
        .map((item: any) => renderBriefText(item))
        .map((text: any) => String(text || '').trim())
        .filter(Boolean);
      if (lines.length) return lines.slice(0, 3);
    }
    return [] as string[];
  })();

  useEffect(() => {
    const tabFromLocation = normalizeTabKey(new URLSearchParams(location.search).get('tab'));
    setActiveTab((prev) => (prev === tabFromLocation ? prev : tabFromLocation));
  }, [location.search]);

  const getTaskDueMs = useCallback((task: Task): number | null => resolveTaskDueMs(task), []);

  const getTaskLastDoneMs = useCallback((task: Task): number | null => {
    const raw: any = (task as any).lastDoneAt ?? (task as any).completedAt;
    if (!raw) return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'string') {
      const parsed = new Date(raw).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    }
    if (raw instanceof Date) return raw.getTime();
    if (typeof raw.toDate === 'function') {
      const d = raw.toDate();
      return d instanceof Date ? d.getTime() : null;
    }
    if (typeof raw.toMillis === 'function') return raw.toMillis();
    if (raw.seconds != null) return (raw.seconds * 1000) + Math.floor((raw.nanoseconds || 0) / 1e6);
    return null;
  }, []);

  const getChoreKind = useCallback((task: Task): 'chore' | 'routine' | 'habit' | null => {
    const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
    const normalized = raw === 'habitual' ? 'habit' : raw;
    if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
    if (normalized) return null;
    const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
    const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
    if (tagKeys.includes('chore')) return 'chore';
    if (tagKeys.includes('routine')) return 'routine';
    if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
    return null;
  }, []);

  const formatDueLabel = useCallback((dueMs?: number | null) => {
    if (!dueMs) return 'today';
    const date = new Date(dueMs);
    const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
    if (hasTime) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, []);

  const todayStartMs = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setIsSmallScreen(window.innerWidth <= 768);
    handler();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Mobile override: if no explicit sprint is selected, prefer the active sprint
  useEffect(() => {
    if (!sprints || !sprints.length) return;
    if (selectedSprintId !== undefined && selectedSprintId !== null && selectedSprintId !== '') return;
    const hasSavedPreference = (() => {
      try {
        const saved = localStorage.getItem('bob_selected_sprint');
        return saved !== null && saved !== undefined;
      } catch {
        return false;
      }
    })();
    if (hasSavedPreference) return;
    const pool = activePlanningSprints.length ? activePlanningSprints : sprints;
    const active = pool.find(s => (s.status ?? 0) === 1) || pool.find(s => (s.status ?? 0) === 0) || pool[0];
    if (active?.id) setSelectedSprintId(active.id);
  }, [sprints, activePlanningSprints, selectedSprintId, setSelectedSprintId]);

  // Subscribe to Daily Summary (AI) - latest for user
  useEffect(() => {
    if (!currentUser?.uid) { setSummary(null); return; }
    const q = query(
      collection(db, 'daily_summaries'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('generatedAt', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0]?.data() as any;
      const sum = doc0?.summary || null;
      setSummary(sum);
      if (sum?.aiFocus) {
        const mode = sum.aiFocus.mode === 'fallback' ? 'Heuristic focus (AI unavailable)' : `Model: ${sum.aiFocus.model || 'AI'}`;
        setPrioritySource(mode);
      } else {
        setPrioritySource(null);
      }
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to planner stats (replan/nightly)
  useEffect(() => {
    if (!currentUser?.uid) { setPlannerStats(null); return; }
    const ref = doc(db, 'planner_stats', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => {
      setPlannerStats(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to Goals
  useEffect(() => {
    if (!currentUser?.uid) { setGoals([]); return; }
    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const unsub = onSnapshot(q, (snap) => setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[]));
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  // Subscribe to Stories (optionally filter by sprint)
  useEffect(() => {
    if (!currentUser?.uid) { setStories([]); return; }
    const base = [
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    ] as any[];
    if (selectedSprintId) base.push(where('sprintId', '==', selectedSprintId));
    const q = query.apply(null, base as any);
    const unsub = onSnapshot(q, (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Story[]));
    return () => unsub();
  }, [currentUser?.uid, selectedSprintId, currentPersona]);

  // Subscribe to Tasks (optionally filter by sprint)
  useEffect(() => {
    if (!currentUser?.uid) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    const base = [
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    ] as any[];
    if (selectedSprintId) base.push(where('sprintId', '==', selectedSprintId));
    const q = query.apply(null, base as any);
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Task[];
      setTasks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser?.uid, selectedSprintId, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setChoresDueToday([]);
      setChoresLoading(false);
      return;
    }
    setChoresLoading(true);
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const unsub = onSnapshot(q, (snap) => {
      const todayDate = new Date();
      todayDate.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Task)
        .filter((task) => !task.deleted)
        .filter((task) => {
          const due = getTaskDueMs(task);
          if (due) return due <= todayEnd.getTime();
          return !!getChoreKind(task) && isRecurringDueOnDate(task, todayDate, due);
        })
        .filter((task) => (task.status ?? 0) !== 2)
        .filter((task) => !!getChoreKind(task))
        .filter((task) => {
          const lastDone = getTaskLastDoneMs(task);
          if (!lastDone) return true;
          return lastDone < todayDate.getTime() || lastDone > todayEnd.getTime();
        });
      rows.sort((a, b) => {
        const aDue = resolveRecurringDueMs(a, new Date(), todayStartMs) ?? 0;
        const bDue = resolveRecurringDueMs(b, new Date(), todayStartMs) ?? 0;
        return aDue - bDue;
      });
      setChoresDueToday(rows);
      setChoresLoading(false);
    }, (err) => {
      console.warn('Mobile: failed to load chores due today', err);
      setChoresDueToday([]);
      setChoresLoading(false);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona, getTaskDueMs, getChoreKind, getTaskLastDoneMs, todayStartMs]);

  const storiesById = useMemo(() => new Map(stories.map(s => [s.id, s])), [stories]);
  const storiesByRef = useMemo(() => new Map(stories.map(s => [(s.ref || s.id || '').toUpperCase(), s])), [stories]);
  const tasksByRef = useMemo(() => new Map(tasks.map(t => [(t.ref || t.id || '').toUpperCase(), t])), [tasks]);
  const goalsById = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const protectedFocusGoalIds = useMemo(() => {
    const ids = new Set<string>();
    activeFocusGoals.forEach((focusGoal) => {
      getProtectedFocusGoalIds(focusGoal).forEach((goalId) => ids.add(goalId));
    });
    return ids;
  }, [activeFocusGoals]);
  const currentSprint = useMemo(() => {
    const source = activePlanningSprints.length ? activePlanningSprints : sprints;
    if (!source || !source.length) return undefined;
    if (selectedSprintId) return source.find((s) => s.id === selectedSprintId);
    return source.find((s) => (s.status ?? 0) === 1) || source[0];
  }, [sprints, activePlanningSprints, selectedSprintId]);
  const resolveTimestamp = (value: any) => {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const normalizeAiScore = useCallback((raw: any) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
  }, []);

  const getTaskAiScore = useCallback((task: Task) => {
    return normalizeAiScore((task as any).aiCriticalityScore ?? (task as any).metadata?.aiScore ?? (task as any).metadata?.aiCriticalityScore ?? null);
  }, [normalizeAiScore]);

  const getStoryAiScore = useCallback((story: Story) => {
    return normalizeAiScore((story.metadata?.aiScore ?? story.metadata?.aiCriticalityScore ?? (story as any).aiCriticalityScore ?? null));
  }, [normalizeAiScore]);

  const getTaskManualRank = useCallback((task: Task) => {
    const directRank = getManualPriorityRank(task);
    if (directRank) return directRank;
    const parentStoryId = String(task.storyId || (task.parentType === 'story' ? task.parentId || '' : '')).trim();
    if (!parentStoryId) return null;
    return getManualPriorityRank(storiesById.get(parentStoryId));
  }, [storiesById]);

  const isStoryFocusAligned = useCallback((story?: Story | null) => {
    const goalId = String(story?.goalId || '').trim();
    if (!goalId || protectedFocusGoalIds.size === 0) return false;
    return isGoalInHierarchySet(goalId, goals, protectedFocusGoalIds);
  }, [goals, protectedFocusGoalIds]);

  const isTaskFocusAligned = useCallback((task?: Task | null) => {
    const directGoalId = String((task as any)?.goalId || '').trim();
    if (directGoalId && protectedFocusGoalIds.size > 0) {
      return isGoalInHierarchySet(directGoalId, goals, protectedFocusGoalIds);
    }
    const parentStoryId = String(task?.storyId || (task?.parentType === 'story' ? task?.parentId || '' : '')).trim();
    if (!parentStoryId) return false;
    return isStoryFocusAligned(storiesById.get(parentStoryId));
  }, [goals, protectedFocusGoalIds, isStoryFocusAligned, storiesById]);

  const isTop3Task = useCallback((task: Task) => {
    if (getTaskManualRank(task)) return true;
    const flagged = (task as any).aiTop3ForDay === true;
    if (!flagged) return false;
    const aiDate = (task as any).aiTop3Date;
    if (!aiDate) return true;
    return String(aiDate).slice(0, 10) === todayIso;
  }, [getTaskManualRank, todayIso]);

  const isTop3Story = useCallback((story: Story) => {
    if (getManualPriorityRank(story)) return true;
    const flagged = (story as any).aiTop3ForDay === true;
    if (!flagged) return false;
    const aiDate = (story as any).aiTop3Date;
    if (!aiDate) return true;
    return String(aiDate).slice(0, 10) === todayIso;
  }, [todayIso]);

  const matchesTaskSharedFilters = useCallback((task: Task) => {
    if (sharedFilters.top3 && !isTop3Task(task)) return false;
    if (sharedFilters.chores && !getChoreKind(task)) return false;
    if (sharedFilters.focusAligned && !isTaskFocusAligned(task)) return false;
    return true;
  }, [sharedFilters, isTop3Task, getChoreKind, isTaskFocusAligned]);

  const matchesStorySharedFilters = useCallback((story: Story) => {
    if (sharedFilters.top3 && !isTop3Story(story)) return false;
    if (sharedFilters.chores) return false;
    if (sharedFilters.focusAligned && !isStoryFocusAligned(story)) return false;
    return true;
  }, [sharedFilters, isTop3Story, isStoryFocusAligned]);

  const matchesTimelineSharedFilters = useCallback((item: MobileTimelineItem) => {
    if (!sharedFilters.top3 && !sharedFilters.chores && !sharedFilters.focusAligned) return true;
    if (item.kind === 'event') return false;
    if (item.story) return matchesStorySharedFilters(item.story);
    if (item.task) return matchesTaskSharedFilters(item.task);
    return false;
  }, [sharedFilters, matchesStorySharedFilters, matchesTaskSharedFilters]);

  const sprintDaysLeft = useMemo(() => {
    if (!currentSprint) return null;
    const endDateMs = resolveTimestamp(currentSprint.endDate);
    if (endDateMs == null) return null;
    const remainingMs = endDateMs - Date.now();
    return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 86400000);
  }, [currentSprint]);
  const storiesByGoal = useMemo(() => {
    const map = new Map<string, Story[]>();
    stories.forEach((story) => {
      const list = map.get(story.goalId) || [];
      list.push(story);
      map.set(story.goalId, list);
    });
    return map;
  }, [stories]);

  const sprintStories = useMemo(() => {
    if (!selectedSprintId) return stories;
    return stories.filter((story) => story.sprintId === selectedSprintId);
  }, [stories, selectedSprintId]);

  const sprintTasks = useMemo(() => {
    if (!selectedSprintId) return tasks;
    return tasks.filter((task) => task.sprintId === selectedSprintId);
  }, [tasks, selectedSprintId]);

  const sprintMetricsSummary = useMemo(() => {
    const totalStories = sprintStories.length;
    const doneStories = sprintStories.filter((story) => (typeof story.status === 'number' ? story.status >= 4 : String(story.status).toLowerCase().includes('done'))).length;
    const progressPercent = totalStories ? Math.round((doneStories / totalStories) * 100) : 0;

    const sprintStartMs = resolveTimestamp(currentSprint?.startDate);
    const sprintEndMs = resolveTimestamp(currentSprint?.endDate);

    let expectedProgress = 0;
    if (sprintStartMs && sprintEndMs && sprintEndMs > sprintStartMs) {
      const now = Date.now();
      const elapsed = Math.max(0, Math.min(now - sprintStartMs, sprintEndMs - sprintStartMs));
      expectedProgress = Math.min(100, Math.round((elapsed / (sprintEndMs - sprintStartMs)) * 100));
    }

    const totalOpenPoints = sprintTasks
      .filter((task) => task.status !== 2)
      .reduce((sum, task) => sum + (Number.isFinite(Number(task.points)) ? Number(task.points) : 1), 0);

    const behind = progressPercent < expectedProgress;
    return {
      totalStories,
      progressPercent,
      expectedProgress,
      totalOpenPoints,
      behind,
    };
  }, [sprintStories, sprintTasks, currentSprint]);

  const openNoteModal = (type: 'task'|'story'|'goal', id: string) => {
    setNoteText('');
    setNoteModal({ type, id, show: true });
  };

  const saveNote = async () => {
    if (!currentUser || !noteModal || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await ActivityStreamService.addNote(
        noteModal.id,
        noteModal.type,
        noteText.trim(),
        currentUser.uid,
        currentUser.email || undefined,
        currentPersona || 'personal',
        undefined
      );
      setNoteModal(null);
    } catch (e) {
      alert('Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const handleReplan = useCallback(async () => {
    if (!currentUser) {
      setReplanFeedback('Please sign in to replan calendar.');
      return;
    }
    
    setReplanLoading(true);
    setReplanFeedback(null);
    try {
      const payload = await callDeltaReplan(functions, { days: 7 });
      const parts = formatDeltaReplanSummary(payload);
      setReplanFeedback(parts.length ? `Delta replan complete: ${parts.join(', ')}` : 'Delta replan complete. No entries needed moving.');
    } catch (err) {
      console.error('Calendar replan failed', err);
      setReplanFeedback(normalizePlannerCallableError(err, 'Delta replan failed. Please retry in a moment.'));
    } finally {
      setReplanLoading(false);
    }
  }, [currentUser]);

  const handleFullReplan = useCallback(async () => {
    if (!currentUser) {
      setReplanFeedback('Please sign in to run full replan.');
      return;
    }
    setFullReplanLoading(true);
    setReplanFeedback(null);
    try {
      const payload = await callFullReplan(functions, {});
      const { total, ok } = formatFullReplanSummary(payload);
      if (total > 0 && ok === total) {
        setReplanFeedback(`Full replan complete: ${ok}/${total} orchestration steps succeeded.`);
      } else if (total > 0 && ok > 0) {
        setReplanFeedback(`Full replan partial: ${ok}/${total} orchestration steps succeeded.`);
      } else {
        setReplanFeedback('Full replan finished with errors. Check logs.');
      }
    } catch (err) {
      console.error('Full replan failed', err);
      setReplanFeedback(normalizePlannerCallableError(err, 'Full replan failed. Please retry in a moment.'));
    } finally {
      setFullReplanLoading(false);
    }
  }, [currentUser]);

  const handleConvertTaskToStory = async (task: Task) => {
    if (!task || convertingTaskId) return;
    setConvertingTaskId(task.id);
    try {
      const suggestCallable = httpsCallable(functions, 'suggestTaskStoryConversions');
      const convertCallable = httpsCallable(functions, 'convertTasksToStories');
      const response: any = await suggestCallable({
        persona: task.persona || 'personal',
        taskIds: [task.id],
        limit: 1,
      });
      const suggestions: any[] = Array.isArray(response?.data?.suggestions) ? response.data.suggestions : [];
      const suggestion = suggestions.find((item: any) => item.taskId === task.id) || suggestions[0] || null;
      const storyTitle = (suggestion?.storyTitle || task.title || 'New Story').slice(0, 140);
      const storyDescription = (suggestion?.storyDescription || (task as any).description || '').slice(0, 1200);
      const goalId = suggestion?.goalId || (task as any).goalId || null;
      await convertCallable({
        conversions: [{ taskId: task.id, storyTitle, storyDescription, goalId }],
      });
    } catch (error) {
      console.error('Error converting task to story:', error);
    } finally {
      setConvertingTaskId(null);
    }
  };

  const handleFlagPriorityStory = async (story: Story) => {
    await applyPriorityFlag(story);
  };

  const handlePriorityPromptReplanNow = async () => {
    setPriorityReplanPromptStory(null);
    await handleReplan();
  };

  const applyDeferredDate = useCallback(async ({ dateMs, rationale, source }: { dateMs: number; rationale: string; source: string }) => {
    if (!deferTarget) return;
    const debugRequestId = `mobile-defer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const targetEntity = deferTarget.type === 'task'
      ? tasks.find((task) => task.id === deferTarget.id) || null
      : stories.find((story) => story.id === deferTarget.id) || null;
    console.info('[MobileHome] defer_confirmed', {
      debugRequestId,
      itemType: deferTarget.type,
      itemId: deferTarget.id,
      title: deferTarget.title,
      dateMs,
      source,
      rationale,
    });
    const targetBucketRaw = String((targetEntity as any)?.timeOfDay || '').trim().toLowerCase();
    const targetBucket = targetBucketRaw === 'morning' || targetBucketRaw === 'afternoon' || targetBucketRaw === 'evening' || targetBucketRaw === 'anytime'
      ? targetBucketRaw
      : null;
    if (source === 'recurring_quick_move' || deferTarget.listView) {
      const coll = deferTarget.type === 'task' ? 'tasks' : 'stories';
      await updateDoc(doc(db, coll, deferTarget.id), { dueDate: dateMs });
      setDeferTarget(null);
      return;
    }
    await schedulePlannerItemMutation({
      itemType: deferTarget.type,
      itemId: deferTarget.id,
      targetDateMs: dateMs,
      targetBucket,
      intent: 'defer',
      source: source || 'mobile_home',
      rationale,
      durationMinutes: deferTarget.type === 'task'
        ? Math.max(15, Number((targetEntity as any)?.estimateMin || 30))
        : Math.max(15, Number((targetEntity as any)?.estimateMin || 60)),
      debugRequestId,
    });
    setDeferTarget(null);
  }, [deferTarget, tasks, stories]);

  const applyPriorityFlag = async (story: Story) => {
    setFlaggingStoryId(story.id);
    try {
      const storyPersona = String((story as any).persona || 'personal');
      const currentRank = getManualPriorityRank(story);
      if (currentRank) {
        await updateDoc(doc(db, 'stories', story.id), {
          userPriorityFlag: false,
          userPriorityRank: null,
          userPriorityFlagAt: null,
          updatedAt: serverTimestamp(),
        });
      } else {
        const nextRank = getNextManualPriorityRank(
          stories.filter((entry) => entry.status !== 4),
          storyPersona,
          story.id,
        );
        const conflictingStory = findItemWithManualPriorityRank(stories, storyPersona, nextRank, story.id);
        if (conflictingStory?.id) {
          await updateDoc(doc(db, 'stories', conflictingStory.id), {
            userPriorityFlag: false,
            userPriorityRank: null,
            userPriorityFlagAt: null,
            updatedAt: serverTimestamp(),
          });
        }
        await updateDoc(doc(db, 'stories', story.id), {
          userPriorityFlag: true,
          userPriorityRank: nextRank,
          userPriorityFlagAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
        const rescore = httpsCallable(functions, 'deltaPriorityRescore');
        await rescore({ entityId: story.id, entityType: 'story' }).catch(() => {});
        setPriorityReplanPromptStory(story);
      }
    } catch (e) {
      console.error('Failed to flag priority story', e);
    } finally {
      setFlaggingStoryId(null);
    }
  };

  const updateTaskField = async (task: Task, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), { ...updates, updatedAt: serverTimestamp() });
      if (updates.status != null) {
        await ActivityStreamService.logStatusChange(
          task.id, 'task', currentUser!.uid, currentUser!.email || undefined,
          String(task.status), String(updates.status), currentPersona || 'personal', task.ref || task.id
        );
      }
    } catch (e) {
      alert('Failed to update task');
    }
  };

  const handleCompleteChoreTask = useCallback(async (task: Task) => {
    if (!currentUser) return;
    const taskId = task.id;
    if (!taskId || choreCompletionBusy[taskId]) return;
    setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: true }));
    try {
      const fn = httpsCallable(functions, 'completeChoreTask');
      await fn({ taskId });
    } catch (err) {
      console.warn('Mobile: failed to complete chore task', err);
      setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: false }));
      return;
    }
    setTimeout(() => {
      setChoreCompletionBusy((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }, 1500);
  }, [currentUser, choreCompletionBusy]);

  const updateStoryField = async (story: Story, updates: Partial<Story>) => {
    try {
      await updateDoc(doc(db, 'stories', story.id), { ...updates, updatedAt: serverTimestamp() });
      if (updates.status != null) {
        await ActivityStreamService.logStatusChange(
          story.id, 'story', currentUser!.uid, currentUser!.email || undefined,
          String(story.status), String(updates.status), currentPersona || 'personal', story.ref || story.id
        );
      }
    } catch (e) {
      alert('Failed to update story');
    }
  };

  const updateStoryProgress = useCallback(async (story: Story, progressPct: number) => {
    try {
      const progressUpdate = buildStoryProgressUpdate({
        points: (story as any).points || 0,
        progressPct,
      });
      await updateDoc(doc(db, 'stories', story.id), {
        ...progressUpdate,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('Failed to update story progress', e);
      alert('Failed to update story progress');
    }
  }, []);

  const updateGoalField = async (goal: Goal, updates: Partial<Goal>) => {
    try {
      await updateDoc(doc(db, 'goals', goal.id), { ...updates, updatedAt: serverTimestamp() });
      if (updates.status != null) {
        await ActivityStreamService.logStatusChange(
          goal.id, 'goal', currentUser!.uid, currentUser!.email || undefined,
          String(goal.status), String(updates.status), currentPersona || 'personal', (goal as any).ref || goal.id
        );
      }
    } catch (e) {
      alert('Failed to update goal');
    }
  };

  const resolveDateValue = (candidate: any): number | null => {
    if (!candidate) return null;
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'object' && typeof candidate.toDate === 'function') {
      return candidate.toDate().getTime();
    }
    const parsed = Date.parse(String(candidate));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const getTaskDueValue = useCallback((task: Task) => {
    const candidate = task.dueDate || task.dueDateMs || task.targetDate || null;
    return resolveDateValue(candidate) ?? Infinity;
  }, []);

  const pendingTasks = useMemo(() => {
    let base = showCompleted ? tasks : tasks.filter(t => t.status !== 2);
    if (aiFocusOnly) {
      base = base.filter((task) => {
        if (getTaskManualRank(task)) return true;
        const aiScore = getTaskAiScore(task);
        return aiScore != null && aiScore >= aiThreshold;
      });
    }
    return base;
  }, [tasks, showCompleted, aiFocusOnly, aiThreshold, getTaskAiScore, getTaskManualRank]);
  const sortedPendingTasks = useMemo(() => {
    return [...pendingTasks].sort((a, b) => {
      const manualA = getTaskManualRank(a) || 99;
      const manualB = getTaskManualRank(b) || 99;
      if (manualA !== manualB) return manualA - manualB;
      const aiA = getTaskAiScore(a) ?? 0;
      const aiB = getTaskAiScore(b) ?? 0;
      if (aiA !== aiB) return aiB - aiA;
      const dueA = getTaskDueValue(a);
      const dueB = getTaskDueValue(b);
      if (dueA !== dueB) return dueA - dueB;
      return (b.priority || 0) - (a.priority || 0);
    });
  }, [pendingTasks, getTaskAiScore, getTaskManualRank, getTaskDueValue]);

  const getStoryDueValue = useCallback((story: Story) => {
    const candidate = story.dueDate || story.targetDate || story.plannedStartDate || null;
    return resolveDateValue(candidate) ?? Infinity;
  }, []);

  const filteredStories = useMemo(() => {
    let base = showCompleted ? stories : stories.filter(s => s.status !== 4);
    if (aiFocusOnly) {
      base = base.filter((story) => {
        if (getManualPriorityRank(story)) return true;
        const aiScore = getStoryAiScore(story);
        return aiScore != null && aiScore >= aiThreshold;
      });
    }
    return base;
  }, [stories, showCompleted, aiFocusOnly, aiThreshold, getStoryAiScore]);

  const sortedStories = useMemo(() => {
    return [...filteredStories].sort((a, b) => {
      const manualA = getManualPriorityRank(a) || 99;
      const manualB = getManualPriorityRank(b) || 99;
      if (manualA !== manualB) return manualA - manualB;
      const aiA = getStoryAiScore(a) ?? 0;
      const aiB = getStoryAiScore(b) ?? 0;
      if (aiA !== aiB) return aiB - aiA;
      const dueA = getStoryDueValue(a);
      const dueB = getStoryDueValue(b);
      if (dueA !== dueB) return dueA - dueB;
      return (b.priority || 0) - (a.priority || 0);
    });
  }, [filteredStories, getStoryAiScore, getStoryDueValue]);

  const top3Tasks = useMemo(() => {
    return tasks
      .filter(t => !t.deleted)
      .filter(t => t.status !== 2)
      .filter(isTop3Task)
      .sort((a, b) => {
        const manualA = getTaskManualRank(a) || 99;
        const manualB = getTaskManualRank(b) || 99;
        if (manualA !== manualB) return manualA - manualB;
        const ar = Number((a as any).aiPriorityRank || 0) || 99;
        const br = Number((b as any).aiPriorityRank || 0) || 99;
        if (ar !== br) return ar - br;
        const as = getTaskAiScore(a) ?? 0;
        const bs = getTaskAiScore(b) ?? 0;
        if (as !== bs) return bs - as;
        return String(a.title || '').localeCompare(String(b.title || ''));
      })
      .slice(0, 3);
  }, [tasks, isTop3Task, getTaskAiScore, getTaskManualRank]);

  const top3Stories = useMemo(() => {
    return stories
      .filter(s => s.status !== 4)
      .filter(isTop3Story)
      .sort((a, b) => {
        const manualA = getManualPriorityRank(a) || 99;
        const manualB = getManualPriorityRank(b) || 99;
        if (manualA !== manualB) return manualA - manualB;
        const ar = Number((a as any).aiFocusStoryRank || 0) || 99;
        const br = Number((b as any).aiFocusStoryRank || 0) || 99;
        if (ar !== br) return ar - br;
        const as = getStoryAiScore(a) ?? 0;
        const bs = getStoryAiScore(b) ?? 0;
        if (as !== bs) return bs - as;
        return String(a.title || '').localeCompare(String(b.title || ''));
      })
      .slice(0, 3);
  }, [stories, isTop3Story, getStoryAiScore]);

  const tasksDueTodayForMobile = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    return sortedPendingTasks.filter((task) => {
      const due = resolveRecurringDueMs(task, today, start.getTime()) ?? getTaskDueMs(task);
      return !!due && due >= start.getTime() && due <= end.getTime();
    });
  }, [sortedPendingTasks, getTaskDueMs]);

  const tasksOverdueForMobile = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    return sortedPendingTasks.filter((task) => {
      const due = resolveRecurringDueMs(task, today, start.getTime()) ?? getTaskDueMs(task);
      return !!due && due < start.getTime();
    });
  }, [sortedPendingTasks, getTaskDueMs]);

  const visibleTaskRows = useMemo(() => {
    let rows: Task[];
    if (tasksViewFilter === 'top3') {
      rows = sortedPendingTasks.filter((task) => isTop3Task(task));
    } else if (tasksViewFilter === 'due_today') {
      rows = tasksDueTodayForMobile;
    } else if (tasksViewFilter === 'overdue') {
      rows = tasksOverdueForMobile;
    } else {
      rows = sortedPendingTasks;
    }
    return rows.filter(matchesTaskSharedFilters);
  }, [tasksViewFilter, sortedPendingTasks, isTop3Task, tasksDueTodayForMobile, tasksOverdueForMobile, matchesTaskSharedFilters]);

  const visibleStoryRows = useMemo(
    () => sortedStories.filter(matchesStorySharedFilters),
    [sortedStories, matchesStorySharedFilters],
  );

  const visibleChoreRows = useMemo(
    () => choresDueToday.filter(matchesTaskSharedFilters),
    [choresDueToday, matchesTaskSharedFilters],
  );

  const filteredGoalsForMobile = useMemo(() => {
    const currentYear = new Date().getFullYear();
    if (goalsViewFilter === 'year') {
      return goals.filter((goal) => Number(goal.targetYear) === currentYear);
    }
    const sprintId = selectedSprintId || currentSprint?.id || '';
    if (!sprintId) return [];
    return goals.filter((goal) => {
      const linked = storiesByGoal.get(goal.id) || [];
      return linked.some((story) => String(story.sprintId || '') === sprintId && story.status !== 4);
    });
  }, [goals, goalsViewFilter, storiesByGoal, selectedSprintId, currentSprint]);

  type MobileTimelineBucket = 'morning' | 'afternoon' | 'evening';
  type MobileTimelineItem = {
    id: string;
    kind: 'task' | 'story' | 'chore' | 'event';
    title: string;
    timeLabel: string;
    sortMs: number | null;
    bucket: MobileTimelineBucket;
    task?: Task;
    story?: Story;
  };

  const bucketFromTime = useCallback((ms: number | null | undefined, timeOfDay?: string | null): MobileTimelineBucket => {
    const tod = String(timeOfDay || '').toLowerCase().trim();
    if (tod === 'morning' || tod === 'afternoon' || tod === 'evening') return tod as MobileTimelineBucket;
    if (!ms || !Number.isFinite(ms)) return 'morning';
    const d = new Date(ms);
    const minute = d.getHours() * 60 + d.getMinutes();
    if (minute >= 300 && minute <= 779) return 'morning';
    if (minute >= 780 && minute <= 1139) return 'afternoon';
    return 'evening';
  }, []);

  const timelineTimeLabel = (startMs: number | null | undefined, endMs?: number | null): string => {
    if (!startMs || !Number.isFinite(startMs)) return 'Anytime';
    const start = new Date(startMs);
    const startLabel = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    if (endMs && Number.isFinite(endMs)) {
      const end = new Date(endMs);
      const endLabel = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
      return `${startLabel} - ${endLabel}`;
    }
    return startLabel;
  };

  const resolveMsFromAny = (value: any): number | null => {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') {
      try { return value.toDate().getTime(); } catch { return null; }
    }
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const overviewCalendarEvents = useMemo(() => {
    const candidates = [
      summary?.calendar?.events,
      summary?.eventsToday,
      summary?.upcomingEvents,
      summary?.calendarEvents,
      summary?.dailyBrief?.calendar,
    ];
    for (const candidate of candidates) {
      if (!Array.isArray(candidate) || candidate.length === 0) continue;
      const mapped = candidate
        .map((item: any, idx: number) => {
          const title = String(item?.title || item?.summary || item?.name || '').trim();
          if (!title) return null;
          const startMs = resolveMsFromAny(item?.start ?? item?.startAt ?? item?.startDate ?? item?.when);
          const endMs = resolveMsFromAny(item?.end ?? item?.endAt ?? item?.endDate);
          return {
            id: String(item?.id || item?.eventId || `${title}-${idx}`),
            title,
            startMs,
            endMs,
          };
        })
        .filter(Boolean) as Array<{ id: string; title: string; startMs: number | null; endMs: number | null }>;
      if (mapped.length > 0) return mapped;
    }
    return [] as Array<{ id: string; title: string; startMs: number | null; endMs: number | null }>;
  }, [summary]);

  const unifiedTimelineItems = useMemo(() => {
    const today = new Date();
    const start = new Date(today);
    start.setHours(0, 0, 0, 0);
    const end = new Date(today);
    end.setHours(23, 59, 59, 999);
    const startMs = start.getTime();
    const endMs = end.getTime();

    const rows: MobileTimelineItem[] = [];
    const seen = new Set<string>();
    const add = (row: MobileTimelineItem) => {
      const key = `${row.kind}:${row.title.toLowerCase()}:${row.timeLabel}`;
      if (seen.has(key)) return;
      seen.add(key);
      rows.push(row);
    };

    tasksDueTodayForMobile.forEach((task) => {
      const dueMs = resolveRecurringDueMs(task, today, startMs) ?? getTaskDueMs(task);
      add({
        id: `task-${task.id}`,
        kind: 'task',
        title: task.title,
        timeLabel: timelineTimeLabel(dueMs),
        sortMs: dueMs,
        bucket: bucketFromTime(dueMs, (task as any).timeOfDay),
        task,
      });
    });

    choresDueToday.forEach((task) => {
      const dueMs = resolveRecurringDueMs(task, today, startMs) ?? getTaskDueMs(task);
      add({
        id: `chore-${task.id}`,
        kind: 'chore',
        title: task.title,
        timeLabel: timelineTimeLabel(dueMs),
        sortMs: dueMs,
        bucket: bucketFromTime(dueMs, (task as any).timeOfDay),
        task,
      });
    });

    sortedStories
      .filter((story) => story.status !== 4)
      .forEach((story) => {
        const dueMs = resolveDateValue(story.targetDate || story.dueDate || (story as any).plannedStartDate);
        if (dueMs && (dueMs < startMs || dueMs > endMs)) return;
        add({
          id: `story-${story.id}`,
          kind: 'story',
          title: story.title,
          timeLabel: timelineTimeLabel(dueMs),
          sortMs: dueMs,
          bucket: bucketFromTime(dueMs, (story as any).timeOfDay),
          story,
        });
      });

    overviewCalendarEvents.forEach((event) => {
      if (event.startMs && (event.startMs < startMs || event.startMs > endMs)) return;
      add({
        id: `event-${event.id}`,
        kind: 'event',
        title: event.title,
        timeLabel: timelineTimeLabel(event.startMs, event.endMs),
        sortMs: event.startMs,
        bucket: bucketFromTime(event.startMs),
      });
    });

    return rows
      .filter(matchesTimelineSharedFilters)
      .sort((a, b) => {
      const aTime = a.sortMs ?? Number.MAX_SAFE_INTEGER;
      const bTime = b.sortMs ?? Number.MAX_SAFE_INTEGER;
      if (aTime !== bTime) return aTime - bTime;
      return a.title.localeCompare(b.title);
    });
  }, [tasksDueTodayForMobile, choresDueToday, sortedStories, overviewCalendarEvents, getTaskDueMs, matchesTimelineSharedFilters, bucketFromTime]);

  const dailyPlanBucketCounts = useMemo(() => ({
    morning: unifiedTimelineItems.filter((item) => item.bucket === 'morning').length,
    afternoon: unifiedTimelineItems.filter((item) => item.bucket === 'afternoon').length,
    evening: unifiedTimelineItems.filter((item) => item.bucket === 'evening').length,
  }), [unifiedTimelineItems]);

  const renderChoresHabitsWidget = () => {
    // Group by time-of-day bucket, respecting explicit timeOfDay field before falling back to schedule time.
    const toChoreMs = (task: Task): number | null => resolveRecurringDueMs(task, new Date(), todayStartMs) ?? null;
    const CHORE_BUCKETS = [
      { key: 'morning' as const, label: 'Morning' },
      { key: 'afternoon' as const, label: 'Afternoon' },
      { key: 'evening' as const, label: 'Evening' },
    ] as const;
    const grouped = { morning: [] as Task[], afternoon: [] as Task[], evening: [] as Task[] };
    visibleChoreRows.forEach((task) => {
      const bucket = bucketFromTime(toChoreMs(task), (task as any).timeOfDay);
      grouped[bucket].push(task);
    });
    const hasGroups = CHORE_BUCKETS.some((b) => grouped[b.key].length > 0);

    const renderChoreItem = (task: Task) => {
      const kind = getChoreKind(task) || 'chore';
      const badgeVariant = kind === 'routine' ? 'success' : kind === 'habit' ? 'secondary' : 'primary';
      const badgeLabel = kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore';
      const dueMs = toChoreMs(task);
      const dueLabel = formatDueLabel(dueMs);
      const isOverdue = !!dueMs && dueMs < todayStartMs;
      const busy = !!choreCompletionBusy[task.id];
      const aiScore = getTaskAiScore(task);
      const manualPriority = getManualPriorityLabel(task) || null;
      const top3 = isTop3Task(task);
      const focusAligned = isTaskFocusAligned(task);
      return (
        <ListGroup.Item key={task.id} className="d-flex align-items-center gap-2" style={{ fontSize: 14 }}>
          <Form.Check
            type="checkbox"
            checked={busy}
            disabled={busy}
            onChange={() => handleCompleteChoreTask(task)}
            aria-label={`Complete ${task.title}`}
            style={{ flexShrink: 0 }}
          />
          <div className="flex-grow-1" style={{ minWidth: 0 }}>
            <div className="fw-semibold text-truncate">{task.title}</div>
            <div className="text-muted small">{isOverdue ? `Overdue · ${dueLabel}` : `Due ${dueLabel}`}</div>
            <div className="d-flex flex-wrap gap-1 mt-1">
              {manualPriority && <Badge bg="danger">{manualPriority}</Badge>}
              {top3 && <Badge bg="warning" text="dark">Top 3</Badge>}
              {focusAligned && <Badge bg="success">Focus</Badge>}
              {aiScore != null && <Badge bg="secondary">AI {Math.round(aiScore)}/100</Badge>}
            </div>
          </div>
          <div className="d-flex align-items-center gap-1 flex-shrink-0">
            {isOverdue && <Badge bg="danger">Overdue</Badge>}
            <Badge bg={badgeVariant}>{badgeLabel}</Badge>
            <button
              type="button"
              style={{ background: 'none', border: 'none', padding: '4px 6px', color: 'var(--bs-secondary)', cursor: 'pointer' }}
              title="Defer"
              onClick={() => setDeferTarget({ type: 'task', id: task.id, title: task.title, listView: true })}
            >
              <Clock3 size={14} />
            </button>
          </div>
        </ListGroup.Item>
      );
    };

    return (
      <Card className="mb-3" style={{ background: '#f0fdf4' }}>
        <Card.Header className="py-2 d-flex align-items-center justify-content-between" style={{ background: 'transparent', border: 'none' }}>
          <div>
            <strong>Chores &amp; Habits</strong>
            <Badge bg="secondary" pill className="ms-2">{visibleChoreRows.length}</Badge>
          </div>
        </Card.Header>
        <Card.Body className="pt-0">
          {choresLoading ? (
            <div className="text-muted small">Loading chores…</div>
          ) : visibleChoreRows.length === 0 ? (
            <div className="text-muted small">No chores, habits, or routines due today.</div>
          ) : hasGroups ? (
            <>
              {CHORE_BUCKETS.map((b) => {
                const items = grouped[b.key];
                if (!items.length) return null;
                return (
                  <div key={b.key}>
                    <div className="text-muted small fw-semibold px-1 pt-2 pb-1" style={{ textTransform: 'uppercase', fontSize: '0.68rem', letterSpacing: '0.05em' }}>
                      {b.label}
                    </div>
                    <ListGroup variant="flush">
                      {items.map(renderChoreItem)}
                    </ListGroup>
                  </div>
                );
              })}
            </>
          ) : (
            <ListGroup variant="flush">
              {visibleChoreRows.map(renderChoreItem)}
            </ListGroup>
          )}
        </Card.Body>
      </Card>
    );
  };

  return (
    <Container fluid className="p-2" style={{ maxWidth: 480, width: '100%', overflowX: 'hidden' }}>
      {/* Header + Sprint/Actions */}
      <div className="d-flex justify-content-between align-items-start mb-2 gap-2">
        <div>
          <h5 className="mb-0">Home</h5>
          {currentSprint && (
            <div className="text-muted small">
              {currentSprint.name} · {sprintDaysLeft != null ? `${sprintDaysLeft}d left` : 'No sprint assigned'}
            </div>
          )}
        </div>
        <div
          className="d-flex align-items-center gap-2 flex-nowrap justify-content-end"
          style={{ minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
        >
          <Form.Select
            size="sm"
            value={currentPersona}
            onChange={(e) => setPersona(e.target.value as any)}
            style={{
              width: isSmallScreen ? 92 : 112,
              fontSize: 11,
              padding: '2px 5px',
              WebkitAppearance: 'none',
              appearance: 'none',
              backgroundImage: 'none' as any
            }}
            title="Persona"
          >
            <option value="personal">Personal</option>
            <option value="work">Work</option>
          </Form.Select>
          <Form.Select
            size="sm"
            value={selectedSprintId || ''}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            style={{
              width: isSmallScreen ? 120 : 160,
              fontSize: 11,
              padding: '2px 5px',
              WebkitAppearance: 'none',
              appearance: 'none',
              backgroundImage: 'none' as any
            }}
          >
            {(activePlanningSprints.length ? activePlanningSprints : sprints).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Form.Select>
        </div>
      </div>

      {/* Key metrics condensed into a single horizontal row */}
      <div
        className="d-flex gap-1 mb-2 flex-nowrap"
        style={{ paddingBottom: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        <div
          style={{
            backgroundColor: 'rgba(59,130,246,0.08)',
            color: '#0b152c',
            padding: '3px 6px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 74,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 9, textTransform: 'uppercase' }}>Sprint days</div>
          <div>{sprintDaysLeft != null ? `${sprintDaysLeft}d` : '—'}</div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(14,116,144,0.08)',
            color: '#0c4a5a',
            padding: '3px 6px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 74,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 9, textTransform: 'uppercase' }}>Progress</div>
          <div>{sprintMetricsSummary.progressPercent}%</div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(16,185,129,0.08)',
            color: '#065f46',
            padding: '3px 6px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 74,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 9, textTransform: 'uppercase' }}>Expected</div>
          <div>{sprintMetricsSummary.expectedProgress}%</div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(237,100,166,0.08)',
            color: '#831843',
            padding: '3px 6px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 74,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 9, textTransform: 'uppercase' }}>Open pts</div>
          <div>{Math.round(sprintMetricsSummary.totalOpenPoints)}</div>
        </div>
        <div
          style={{
            backgroundColor: sprintMetricsSummary.behind ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
            color: sprintMetricsSummary.behind ? '#991b1b' : '#065f46',
            padding: '3px 6px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 74,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 9, textTransform: 'uppercase' }}>Status</div>
          <div>{sprintMetricsSummary.behind ? 'Behind' : 'On track'}</div>
        </div>
      </div>

      <div
        className="d-flex gap-1 mb-2 flex-nowrap"
        style={{ paddingBottom: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}
      >
        <Card style={{ background: '#ecfeff', minWidth: 88, flex: '0 0 auto' }}>
          <Card.Body className="p-1">
            <div className="text-muted" style={{ fontSize: 11 }}>Tasks today</div>
            <div className="fw-semibold" style={{ fontSize: 13 }}>
              {tasks.filter(t => t.status !== 2 && t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString()).length}
            </div>
          </Card.Body>
        </Card>
        <Card style={{ background: '#fef3c7', minWidth: 88, flex: '0 0 auto' }}>
          <Card.Body className="p-1">
            <div className="text-muted" style={{ fontSize: 11 }}>Overdue</div>
            <div className="fw-semibold" style={{ fontSize: 13 }}>
              {tasks.filter(t => t.status !== 2 && t.dueDate && t.dueDate < Date.now() - 86400000).length}
            </div>
          </Card.Body>
        </Card>
        <Card style={{ background: '#dcfce7', minWidth: 88, flex: '0 0 auto' }}>
          <Card.Body className="p-1">
            <div className="text-muted" style={{ fontSize: 11 }}>Stories done</div>
            <div className="fw-semibold" style={{ fontSize: 13 }}>{stories.filter(s => s.status === 4).length}</div>
          </Card.Body>
        </Card>
        <Card style={{ background: '#fee2e2', minWidth: 100, flex: '0 0 auto' }}>
          <Card.Body className="p-1">
            <div className="text-muted" style={{ fontSize: 11 }}>Chores/Routines</div>
            <div style={{ fontSize: 13 }}>{(summary?.choresDue?.length || 0) + (summary?.routinesDue?.length || 0)} due</div>
          </Card.Body>
        </Card>
      </div>
      {/* AI Daily Summary + Focus */}
      {/* Tabs: Overview | Tasks | Stories | Goals | Chores */}
      <div className="mobile-filter-tabs mb-3">
        <div className="d-flex align-items-center gap-1 flex-nowrap" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div className="btn-group flex-nowrap w-100" role="group">
            {MOBILE_TAB_ORDER.map((key) => (
              <Button
                key={key}
                variant={activeTab === key ? 'primary' : 'outline-primary'}
                size="sm"
                onClick={() => setActiveMobileTab(key)}
                style={{ padding: '3px 6px', fontSize: 11, whiteSpace: 'nowrap' }}
              >
                {MOBILE_TAB_LABELS[key]}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {activeTab !== 'goals' && (
        <>
          <div className="d-flex flex-wrap gap-2 mb-2">
            <Button
              size="sm"
              variant={sharedFilters.top3 ? 'danger' : 'outline-danger'}
              className="rounded-pill"
              onClick={() => setSharedFilters((prev) => ({ ...prev, top3: !prev.top3 }))}
            >
              Top 3
            </Button>
            <Button
              size="sm"
              variant={sharedFilters.chores ? 'success' : 'outline-success'}
              className="rounded-pill"
              onClick={() => setSharedFilters((prev) => ({ ...prev, chores: !prev.chores }))}
            >
              Chores
            </Button>
            <Button
              size="sm"
              variant={sharedFilters.focusAligned ? 'primary' : 'outline-primary'}
              className="rounded-pill"
              onClick={() => setSharedFilters((prev) => ({ ...prev, focusAligned: !prev.focusAligned }))}
            >
              Focus aligned
            </Button>
          </div>
          <div className="text-muted small mb-3">
            Top 3 is AI-ranked by default. Manual <strong>#1</strong>, <strong>#2</strong>, and <strong>#3</strong> override AI ranking, and any unassigned Top 3 slots are filled by AI during replanning.
          </div>
        </>
      )}

      {(activeTab === 'tasks' || activeTab === 'stories' || activeTab === 'goals') && (
        <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
          <Form.Check
            type="switch"
            id="mobile-ai-focus"
            label={`AI score ≥ ${aiThreshold}`}
            checked={aiFocusOnly}
            onChange={(e) => setAiFocusOnly(e.target.checked)}
          />
          <Form.Group className="d-flex align-items-center gap-1 mb-0" style={{ minWidth: 120 }}>
            <Form.Label className="mb-0 small text-muted">AI threshold</Form.Label>
            <Form.Control
              type="number"
              min={0}
              max={100}
              value={aiThreshold}
              onChange={(e) => {
                const val = Number(e.target.value);
                if (Number.isNaN(val)) {
                  setAiThreshold(0);
                  return;
                }
                setAiThreshold(Math.min(100, Math.max(0, val)));
              }}
              size="sm"
              style={{ width: 72 }}
            />
          </Form.Group>
          <Form.Check
            type="switch"
            id="mobile-show-completed"
            label="Show completed"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
          />
        </div>
      )}

      {(activeTab === 'tasks' || activeTab === 'stories' || activeTab === 'daily_plan') && (
        <div className="d-flex align-items-center gap-1 mb-3 justify-content-end">
          {activeTab === 'tasks' && (
            <Form.Group className="d-flex align-items-center gap-1 mb-0 me-auto" style={{ minWidth: 170 }}>
              <Form.Label className="mb-0 small text-muted">Tasks view</Form.Label>
              <Form.Select size="sm" value={tasksViewFilter} onChange={(e) => setTasksViewFilter(e.target.value as TaskViewFilter)}>
                <option value="top3">Top 3</option>
                <option value="due_today">Due today</option>
                <option value="overdue">Overdue</option>
                <option value="all">All tasks</option>
              </Form.Select>
            </Form.Group>
          )}
          {(() => {
            const vt = activeTab === 'tasks' ? tasksViewType : activeTab === 'daily_plan' ? dailyPlanViewType : storiesViewType;
            const setVt = (v: 'list' | 'detail') => {
              if (activeTab === 'tasks') { setTasksViewType(v); try { localStorage.setItem('mobile_tasks_view_type', v); } catch {} }
              else if (activeTab === 'daily_plan') { setDailyPlanViewType(v); try { localStorage.setItem('mobile_daily_plan_view_type', v); } catch {} }
              else { setStoriesViewType(v); try { localStorage.setItem('mobile_stories_view_type', v); } catch {} }
            };
            return (
              <>
                <Button size="sm" variant={vt === 'list' ? 'secondary' : 'outline-secondary'} onClick={() => setVt('list')}>List</Button>
                <Button size="sm" variant={vt === 'detail' ? 'secondary' : 'outline-secondary'} onClick={() => setVt('detail')}>Detail</Button>
              </>
            );
          })()}
        </div>
      )}

      {/* Overview */}
      {activeTab === 'overview' && (
        <div>
          {summary && (
            <Card className="mb-3" style={{ background: '#f3f4ff' }}>
              <Card.Body>
                {summary.dailyBriefing?.headline && (
                  <div className="fw-semibold mb-1">{summary.dailyBriefing.headline}</div>
                )}
                {summary.dailyBriefing?.body && (
                  <div style={{ fontSize: 14 }} className="mb-1">{summary.dailyBriefing.body}</div>
                )}
                {summary.dailyBriefing?.checklist && (
                  <div className="text-muted" style={{ fontSize: 13 }}>{summary.dailyBriefing.checklist}</div>
                )}
                {!summary.dailyBriefing && summary.dailyBrief && (
                  <>
                    {Array.isArray(summary.dailyBrief.lines) && summary.dailyBrief.lines.length > 0 && (
                      <ul className="mb-2 small">
                        {summary.dailyBrief.lines.slice(0, 4).map((line: any, idx: number) => {
                          const text = renderBriefText(line);
                          if (!text) return null;
                          return <li key={idx}>{text}</li>;
                        })}
                      </ul>
                    )}
                    {briefWeatherSummary && (
                      <div className="text-muted small mb-1">
                        Weather: {briefWeatherSummary}
                        {briefWeatherTemp ? ` (${briefWeatherTemp})` : ''}
                      </div>
                    )}
                    {Array.isArray(summary.dailyBrief.news) && summary.dailyBrief.news.length > 0 && (
                      <div className="mt-2">
                        <div className="fw-semibold" style={{ fontSize: 14 }}>News</div>
                        <ul className="mb-0 small">
                          {summary.dailyBrief.news.slice(0, 3).map((item: any, idx: number) => {
                            const text = renderBriefText(item);
                            if (!text) return null;
                            return <li key={idx}>{text}</li>;
                          })}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                {Array.isArray(summary?.aiFocus?.items) && summary.aiFocus.items.length > 0 && (
                  <div className="mt-2">
                    <div className="fw-semibold" style={{ fontSize: 14 }}>AI focus</div>
                    {prioritySource && <div className="text-muted small mb-1">Source: {prioritySource}</div>}
                    <ul className="mb-0 small">
                      {summary.aiFocus.items.slice(0, 3).map((it: any, idx: number) => (
                        <li key={idx}>
                          {(() => {
                            const refKey = (it.ref || '').toUpperCase();
                            const matchedTask = refKey ? tasksByRef.get(refKey) : undefined;
                            const matchedStory = !matchedTask && refKey ? storiesByRef.get(refKey) : undefined;
                            const href = matchedTask
                              ? `/tasks/${matchedTask.id}`
                              : matchedStory
                                ? `/stories/${matchedStory.id}`
                                : undefined;
                            const label = [it.ref, it.title || it.summary].filter(Boolean).join(' — ') || 'Focus';
                            const rationale = it.rationale || it.nextStep ? ` — ${it.rationale || it.nextStep}` : '';
                            return href ? (
                              <>
                                <a href={href} className="text-decoration-none">{label}</a>{rationale}
                              </>
                            ) : (
                              <>
                                {label}{rationale}
                              </>
                            );
                          })()}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card.Body>
            </Card>
          )}

          {summary && (
            <Card className="mb-3" style={{ background: 'linear-gradient(90deg,#eef2ff,#fdf2f8)' }}>
              <Card.Body>
                {summary.dailyBriefing?.headline && (
                  <div className="fw-semibold mb-1" style={{ fontSize: 16 }}>{summary.dailyBriefing.headline}</div>
                )}
                {summary.dailyBriefing?.body && (
                  <div style={{ fontSize: 14 }} className="mb-2">{summary.dailyBriefing.body}</div>
                )}
                {summary.dailyBriefing?.checklist && (
                  <div className="text-muted" style={{ fontSize: 13 }}>{summary.dailyBriefing.checklist}</div>
                )}
              </Card.Body>
            </Card>
          )}

          <Card className="mb-3" style={{ background: '#f8fafc' }}>
            <Card.Header className="py-2" style={{ background: 'transparent', border: 'none' }}>
              <strong>Top 3 priorities</strong>
              <span className="text-muted ms-2" style={{ fontSize: 12 }}>{currentPersona === 'work' ? 'Work' : 'Personal'}</span>
            </Card.Header>
            <Card.Body className="pt-0">
              {top3Tasks.length === 0 && top3Stories.length === 0 ? (
                <div className="text-muted small">No Top 3 items flagged yet.</div>
              ) : (
                <>
                  <div className="mb-2">
                    <div className="text-uppercase text-muted small fw-semibold">Stories</div>
                    {top3Stories.length === 0 ? (
                      <div className="text-muted small">No stories flagged.</div>
                    ) : (
                      <ListGroup variant="flush">
                        {top3Stories.map((story, idx) => {
                          const label = story.ref ? `${story.ref} — ${story.title}` : story.title;
                          const score = getStoryAiScore(story);
                          return (
                            <ListGroup.Item key={story.id} className="d-flex justify-content-between align-items-center" style={{ fontSize: 14 }}>
                              <span>
                                <button
                                  type="button"
                                  className="btn btn-link p-0 text-decoration-none text-start align-baseline"
                                  onClick={() => setEditingStory(story)}
                                >
                                  {label}
                                </button>
                              </span>
                              <Badge bg={idx === 0 ? 'danger' : idx === 1 ? 'warning' : 'secondary'}>
                                {score != null ? Math.round(score) : '—'}
                              </Badge>
                            </ListGroup.Item>
                          );
                        })}
                      </ListGroup>
                    )}
                  </div>
                  <div>
                    <div className="text-uppercase text-muted small fw-semibold">Tasks</div>
                    {top3Tasks.length === 0 ? (
                      <div className="text-muted small">No tasks flagged.</div>
                    ) : (
                      <ListGroup variant="flush">
                        {top3Tasks.map((task, idx) => {
                          const label = task.ref ? `${task.ref} — ${task.title}` : task.title;
                          const score = getTaskAiScore(task);
                          return (
                            <ListGroup.Item key={task.id} className="d-flex justify-content-between align-items-center" style={{ fontSize: 14 }}>
                              <span>
                                <button
                                  type="button"
                                  className="btn btn-link p-0 text-decoration-none text-start align-baseline"
                                  onClick={() => setEditingTask(task)}
                                >
                                  {label}
                                </button>
                              </span>
                              <Badge bg={idx === 0 ? 'danger' : idx === 1 ? 'warning' : 'secondary'}>
                                {score != null ? Math.round(score) : '—'}
                              </Badge>
                            </ListGroup.Item>
                          );
                        })}
                      </ListGroup>
                    )}
                  </div>
                </>
              )}
            </Card.Body>
          </Card>

          {summary?.priorities?.items?.length > 0 && (
            <Card className="mb-3" style={{ background: '#f0f9ff' }}>
              <Card.Header className="py-2" style={{ background: 'transparent', border: 'none' }}>
                <strong>Today’s Priorities</strong>
              </Card.Header>
              <ListGroup variant="flush">
                {summary.priorities.items.slice(0, 5).map((it: any, idx: number) => (
                  <ListGroup.Item key={idx} className="d-flex justify-content-between align-items-center" style={{ fontSize: 14 }}>
                    <span>
                      {(() => {
                        const refKey = (it.ref || '').toUpperCase();
                        const matchedTask = refKey ? tasksByRef.get(refKey) : undefined;
                        const matchedStory = !matchedTask && refKey ? storiesByRef.get(refKey) : undefined;
                        const label = it.title || it.id || it.ref || 'Task';
                        if (matchedTask) {
                          return (
                            <span
                              style={{ cursor: 'pointer', color: 'var(--bs-primary)' }}
                              onClick={() => setEditingTask(matchedTask)}
                            >
                              {label}
                            </span>
                          );
                        }
                        if (matchedStory) {
                          return (
                            <span
                              style={{ cursor: 'pointer', color: 'var(--bs-primary)' }}
                              onClick={() => setEditingStory(matchedStory)}
                            >
                              {label}
                            </span>
                          );
                        }
                        return label;
                      })()}
                    </span>
                    <Badge bg={idx < 2 ? 'danger' : idx < 4 ? 'warning' : 'secondary'}>{Math.round(it.score || 0)}</Badge>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card>
          )}

          <Card className="mb-3" style={{ background: '#eef2ff' }}>
            <Card.Header className="py-2 d-flex align-items-center justify-content-between" style={{ background: 'transparent', border: 'none' }}>
              <div>
                <strong>Daily Plan</strong>
                <Badge bg="secondary" pill className="ms-2">{unifiedTimelineItems.length}</Badge>
              </div>
            </Card.Header>
            <Card.Body className="pt-0">
              <div className="text-muted small mb-2">
                {unifiedTimelineItems.length === 0
                  ? 'No tasks, stories, chores, or calendar events scheduled today.'
                  : 'Grouped into morning, afternoon, and evening for quick triage.'}
              </div>
              <div className="d-flex flex-wrap gap-1 mb-3">
                <Badge bg="light" text="dark">Morning {dailyPlanBucketCounts.morning}</Badge>
                <Badge bg="light" text="dark">Afternoon {dailyPlanBucketCounts.afternoon}</Badge>
                <Badge bg="light" text="dark">Evening {dailyPlanBucketCounts.evening}</Badge>
              </div>
              <Button size="sm" variant="primary" onClick={() => setActiveMobileTab('daily_plan')}>
                Open Daily Plan
              </Button>
            </Card.Body>
          </Card>

          {renderChoresHabitsWidget()}

          {(summary?.worldSummary || worldWeatherLine || worldNewsItems.length > 0) && (
            <Card className="mb-3" style={{ background: '#fff7ed' }}>
              <Card.Header className="py-2" style={{ background: 'transparent', border: 'none' }}>
                <strong>World & Weather</strong>
              </Card.Header>
              <Card.Body>
                {renderBriefText(summary?.worldSummary?.summary) && (
                  <div className="mb-2" style={{ fontSize: 14 }}>{renderBriefText(summary?.worldSummary?.summary)}</div>
                )}
                {worldWeatherLine && (
                  <div className="text-muted" style={{ fontSize: 13 }}>{worldWeatherLine}</div>
                )}
                {worldNewsItems.length > 0 && (
                  <div className="mt-2">
                    <div className="fw-semibold" style={{ fontSize: 14 }}>News</div>
                    <ul className="mb-0 small">
                      {worldNewsItems.map((headline: string, idx: number) => (
                        <li key={idx}>{headline}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card.Body>
            </Card>
          )}

          <Card className="mb-3" style={{ background: '#eef2ff' }}>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="small text-muted">AI Planning summary</div>
                  <div className="fw-semibold" style={{ fontSize: 14 }}>{formatPlannerLine(plannerStats)}</div>
                </div>
                <Badge bg="secondary" pill>
                  {plannerStats?.source || 'replan'}
                </Badge>
              </div>
              <div className="d-flex flex-wrap gap-2 mt-2">
                <Button
                  size="sm"
                  variant="outline-primary"
                  disabled={replanLoading || fullReplanLoading}
                  onClick={handleReplan}
                  title="Delta replan: quickly rebalance existing calendar blocks using current priorities."
                >
                  {replanLoading ? <Spinner animation="border" size="sm" className="me-1" role="status" /> : <RefreshCw size={12} className="me-1" />}
                  {replanLoading ? 'Delta…' : 'Delta replan'}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={fullReplanLoading || replanLoading}
                  onClick={handleFullReplan}
                  title="Full replan: runs full nightly orchestration (pointing, conversions, priority scoring, and calendar planning)."
                >
                  {fullReplanLoading ? <Spinner animation="border" size="sm" className="me-1" role="status" /> : <Sparkles size={12} className="me-1" />}
                  {fullReplanLoading ? 'Full…' : 'Full replan'}
                </Button>
              </div>
              {replanFeedback && (
                <div className="text-muted small mt-2">
                  {replanFeedback}
                </div>
              )}
              {replanLoading && (
                <div className="mt-2 small d-flex align-items-center text-primary" role="status" aria-live="polite">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Delta replan is in progress—calendar blocks are being rebalanced.
                </div>
              )}
              {fullReplanLoading && (
                <div className="mt-2 small d-flex align-items-center text-primary" role="status" aria-live="polite">
                  <Spinner animation="border" size="sm" className="me-2" />
                  Full replan is in progress—running the complete nightly orchestration chain.
                </div>
              )}
            </Card.Body>
          </Card>
        </div>
      )}

      {activeTab === 'daily_plan' && (
        <div>
          {unifiedTimelineItems.length === 0 ? (
            <div className="text-muted small p-2">No tasks, stories, chores, or calendar events scheduled today.</div>
          ) : (
            (['morning', 'afternoon', 'evening'] as MobileTimelineBucket[]).map((bucket) => {
              const items = unifiedTimelineItems.filter((row) => row.bucket === bucket);
              if (items.length === 0) return null;
              const label = bucket === 'morning' ? 'Morning' : bucket === 'afternoon' ? 'Afternoon' : 'Evening';
              return (
                <div key={bucket} className="mb-3">
                  <div className="text-uppercase text-muted small fw-semibold px-1 mb-1" style={{ letterSpacing: '0.05em' }}>{label}</div>

                  {dailyPlanViewType === 'list' ? (
                    /* LIST MODE: simple rows with checkbox + title + clock */
                    <ListGroup variant="flush">
                      {items.map((item) => {
                        const isTask = item.kind === 'task' || item.kind === 'chore';
                        const isDone = !!item.task && Number(item.task.status ?? 0) === 2;
                        const iconBtnStyle: React.CSSProperties = {
                          background: 'none', border: 'none', padding: '4px 6px',
                          color: 'var(--bs-secondary)', cursor: 'pointer', flexShrink: 0,
                        };
                        return (
                          <ListGroup.Item key={item.id} className="d-flex align-items-center gap-2 py-2" style={{ fontSize: 14 }}>
                            {isTask && item.task ? (
                              <Form.Check
                                type="checkbox"
                                checked={isDone || !!choreCompletionBusy[item.task.id]}
                                disabled={isDone || !!choreCompletionBusy[item.task.id]}
                                onChange={() => {
                                  if (item.kind === 'chore') void handleCompleteChoreTask(item.task!);
                                  else void updateTaskField(item.task!, { status: 2 });
                                }}
                                aria-label={`Complete ${item.title}`}
                                style={{ flexShrink: 0 }}
                              />
                            ) : (
                              <span style={{ width: 18, flexShrink: 0 }} />
                            )}
                            <div className="flex-grow-1" style={{ minWidth: 0 }}>
                              <div className="fw-semibold text-truncate" style={{ lineHeight: 1.2 }}>{item.title}</div>
                              {item.timeLabel && <div className="text-muted" style={{ fontSize: 11 }}>{item.timeLabel}</div>}
                            </div>
                            {(item.task || item.story) && (
                              <button
                                type="button"
                                style={iconBtnStyle}
                                title="Defer"
                                onClick={() => setDeferTarget({
                                  type: item.story ? 'story' : 'task',
                                  id: item.story ? item.story.id : item.task!.id,
                                  title: item.title,
                                  listView: true,
                                })}
                              >
                                <Clock3 size={14} />
                              </button>
                            )}
                          </ListGroup.Item>
                        );
                      })}
                    </ListGroup>
                  ) : (
                    /* DETAIL MODE: KanbanCardV2 for tasks/stories/chores, simple row for events */
                    <div>
                      {items.map((item) => {
                        if (item.kind === 'event') {
                          return (
                            <div key={item.id} className="d-flex align-items-center gap-2 py-2 px-1 border-bottom text-muted" style={{ fontSize: 13 }}>
                              <span style={{ width: 18, flexShrink: 0 }} />
                              <span className="flex-grow-1 text-truncate">{item.title}</span>
                              {item.timeLabel && <span style={{ fontSize: 11, flexShrink: 0 }}>{item.timeLabel}</span>}
                              <Badge bg="secondary" style={{ flexShrink: 0 }}>Event</Badge>
                            </div>
                          );
                        }
                        const rawItem = item.story ?? item.task;
                        if (!rawItem) return null;
                        const cardType: 'story' | 'task' = item.story ? 'story' : 'task';
                        const itemGoal = item.story
                          ? goalsById.get((item.story as any).goalId)
                          : item.task?.parentType === 'story'
                            ? (() => { const s = storiesById.get(item.task!.parentId); return s ? goalsById.get(s.goalId) : undefined; })()
                            : undefined;
                        const parentStory = cardType === 'task' && item.task?.parentType === 'story'
                          ? storiesById.get(item.task.parentId)
                          : undefined;
                        return (
                          <div key={item.id} style={{ marginBottom: 8 }}>
                            <KanbanCardV2
                              item={rawItem}
                              type={cardType}
                              goal={itemGoal}
                              story={parentStory}
                              showDescription={false}
                              onEdit={() => { if (item.task) setEditingTask(item.task); else if (item.story) setEditingStory(item.story!); }}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Content */}
      {activeTab === 'tasks' && (
        <div>
          {loading ? (
            <div className="text-center p-4"><Spinner animation="border" size="sm" /></div>
          ) : visibleTaskRows.length === 0 ? (
            <Card className="text-center p-4">
              <Card.Body>
                <div className="text-muted">
                  {tasksViewFilter === 'top3'
                    ? 'No Top 3 tasks flagged right now.'
                    : tasksViewFilter === 'due_today'
                      ? 'No tasks due today.'
                      : tasksViewFilter === 'overdue'
                        ? 'No overdue tasks.'
                        : 'No tasks pending.'}
                </div>
              </Card.Body>
            </Card>
          ) : tasksViewType === 'list' ? (
            (() => {
              const tMorning: Task[] = [], tAfternoon: Task[] = [], tEvening: Task[] = [], tOther: Task[] = [];
              visibleTaskRows.forEach((task) => {
                const b = bucketFromTime(task.dueDate as any, (task as any).timeOfDay);
                if (b === 'morning') tMorning.push(task);
                else if (b === 'afternoon') tAfternoon.push(task);
                else if (b === 'evening') tEvening.push(task);
                else tOther.push(task);
              });
              const iconBtnStyle: React.CSSProperties = {
                color: 'var(--bs-secondary-color)', padding: 4, borderRadius: 4,
                border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 0, flexShrink: 0,
              };
              const renderTaskListRow = (task: Task) => {
                const story = task.parentType === 'story' ? storiesById.get(task.parentId) : undefined;
                const goal = story?.goalId ? goalsById.get(story.goalId) : undefined;
                const themeColor = resolveThemeColor(goal?.theme ?? story?.theme ?? (task as any).theme);
                const dueLabel = task.dueDate ? new Date(task.dueDate as any).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'No date';
                const meta = [story?.ref, goal?.title || 'Unlinked'].filter(Boolean).join(' · ');
                return (
                  <ListGroup.Item
                    key={task.id}
                    className="d-flex align-items-center gap-2 py-2"
                    style={themeColor ? { borderLeft: `4px solid ${themeColor}` } : undefined}
                  >
                    <Form.Check
                      type="checkbox"
                      checked={task.status === 2}
                      onChange={(e) => updateTaskField(task, { status: e.target.checked ? 2 : 0 })}
                    />
                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                      <div className="fw-semibold text-truncate" style={{ lineHeight: 1.2 }}>{task.title}</div>
                      <div className="text-muted small">{meta} · Due {dueLabel}</div>
                    </div>
                    <div className="d-flex gap-1 flex-shrink-0">
                      <button type="button" style={iconBtnStyle} title="Move due date"
                        onClick={() => setDeferTarget({ type: 'task', id: task.id, title: task.title, listView: true })}>
                        <Clock3 size={14} />
                      </button>
                      <button type="button" style={iconBtnStyle} title="Edit task"
                        onClick={() => setEditingTask(task)}>
                        <Pencil size={14} />
                      </button>
                    </div>
                  </ListGroup.Item>
                );
              };
              const sectionHeader = (label: string) => (
                <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold mt-1"><small>{label}</small></h6>
              );
              return (
                <ListGroup variant="flush">
                  {tMorning.length > 0 && <div className="mb-2">{sectionHeader('Morning')}{tMorning.map(renderTaskListRow)}</div>}
                  {tAfternoon.length > 0 && <div className="mb-2">{sectionHeader('Afternoon')}{tAfternoon.map(renderTaskListRow)}</div>}
                  {tEvening.length > 0 && <div className="mb-2">{sectionHeader('Evening')}{tEvening.map(renderTaskListRow)}</div>}
                  {tOther.length > 0 && (
                    <div className="mb-0">
                      {(tMorning.length > 0 || tAfternoon.length > 0 || tEvening.length > 0) && sectionHeader('Anytime')}
                      {tOther.map(renderTaskListRow)}
                    </div>
                  )}
                </ListGroup>
              );
            })()
          ) : (
            <div className="pt-1">
              {visibleTaskRows.map(task => {
                const story = task.parentType === 'story' ? storiesById.get(task.parentId) : undefined;
                const goal = story?.goalId ? goalsById.get(story.goalId) : undefined;
                return (
                  <div key={task.id} style={{ marginBottom: 8 }}>
                    <KanbanCardV2
                      item={task}
                      type="task"
                      goal={goal}
                      story={story}
                      showDescription={false}
                      onEdit={() => setEditingTask(task)}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'stories' && (
        visibleStoryRows.length === 0 ? (
          <Card className="text-center p-4">
            <Card.Body>
              <div className="text-muted">No stories match the current mobile filters.</div>
            </Card.Body>
          </Card>
        ) : storiesViewType === 'list' ? (
          <ListGroup variant="flush">
            {visibleStoryRows.map(story => {
              const goal = goalsById.get(story.goalId);
              const themeColor = resolveThemeColor(goal?.theme ?? story.theme);
              const dueLabel = (story as any).dueDate
                ? new Date((story as any).dueDate as any).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                : 'No date';
              const meta = [story.ref, goal?.title || 'No goal', `Due ${dueLabel}`].filter(Boolean).join(' · ');
              const iconBtnStyle: React.CSSProperties = {
                color: 'var(--bs-secondary-color)', padding: 4, borderRadius: 4,
                border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 0, flexShrink: 0,
              };
              return (
                <ListGroup.Item
                  key={story.id}
                  className="d-flex align-items-center gap-2 py-2"
                  style={themeColor ? { borderLeft: `4px solid ${themeColor}` } : undefined}
                >
                  <div className="flex-grow-1" style={{ minWidth: 0 }}>
                    <div className="fw-semibold text-truncate" style={{ lineHeight: 1.2 }}>{story.title}</div>
                    <div className="text-muted small">{meta}</div>
                  </div>
                  <div className="d-flex gap-1 flex-shrink-0">
                    <button type="button" style={iconBtnStyle} title="Move due date"
                      onClick={() => setDeferTarget({ type: 'story', id: story.id, title: story.title, listView: true })}>
                      <Clock3 size={14} />
                    </button>
                    <button type="button" style={iconBtnStyle} title="Edit story"
                      onClick={() => setEditingStory(story)}>
                      <Pencil size={14} />
                    </button>
                  </div>
                </ListGroup.Item>
              );
            })}
          </ListGroup>
        ) : (
          <div className="pt-1">
            {visibleStoryRows.map(story => {
              const goal = goalsById.get(story.goalId);
              return (
                <div key={story.id} style={{ marginBottom: 8 }}>
                  <KanbanCardV2
                    item={story}
                    type="story"
                    goal={goal}
                    showDescription={false}
                    onEdit={() => setEditingStory(story)}
                  />
                </div>
              );
            })}
          </div>
        )
      )}

      {activeTab === 'goals' && (
        <div>
          <div className="d-flex gap-2 mb-2">
            <Button
              size="sm"
              variant={goalsViewFilter === 'active_sprint' ? 'primary' : 'outline-primary'}
              onClick={() => setGoalsViewFilter('active_sprint')}
            >
              Active sprint goals
            </Button>
            <Button
              size="sm"
              variant={goalsViewFilter === 'year' ? 'primary' : 'outline-primary'}
              onClick={() => setGoalsViewFilter('year')}
            >
              Goals this year
            </Button>
          </div>
          {filteredGoalsForMobile.length === 0 ? (
            <Card className="text-center p-4">
              <Card.Body>
                <div className="text-muted">
                  {goalsViewFilter === 'year'
                    ? 'No goals targeting this year.'
                    : 'No goals with active stories in the selected sprint.'}
                </div>
              </Card.Body>
            </Card>
          ) : (
            <ListGroup>
              {filteredGoalsForMobile.map(goal => {
                const themeColor = resolveThemeColor(goal.theme);
                const relatedStories = storiesByGoal.get(goal.id) || [];
                const doneStories = relatedStories.filter((s) => s.status === 4).length;
                const progressPercent = relatedStories.length ? Math.round((doneStories / relatedStories.length) * 100) : 0;
                return (
                  <ListGroup.Item
                    key={goal.id}
                    className="mobile-task-item d-flex align-items-start"
                    style={themeColor ? { borderLeft: `4px solid ${themeColor}` } : undefined}
                  >
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <div className="fw-semibold">{goal.title}</div>
                          <div className="text-muted small">{goal.description || 'No description yet'}</div>
                          <div className="text-muted small">
                            Theme {goal.theme} · Target Year {goal.targetYear || 'N/A'}
                          </div>
                        </div>
                        <Badge bg={getBadgeVariant(goal.status)}>{getStatusName(goal.status)}</Badge>
                      </div>
                      <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                        <Form.Select
                          size="sm"
                          value={Number(goal.status)}
                          onChange={(e) => updateGoalField(goal, { status: Number(e.target.value) as any })}
                          style={{ minWidth: 180 }}
                        >
                          {ChoiceHelper.getOptions('goal','status').map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </Form.Select>
                        <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('goal', goal.id)}>Add Note</Button>
                        <a
                          href={`https://bob.jc1.tech/goals/${goal.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="small text-decoration-none text-muted"
                        >
                          Open goal
                        </a>
                      </div>
                      <div className="d-flex flex-wrap gap-2 mt-2">
                        <Badge pill bg="dark">{progressPercent}% stories done</Badge>
                        <Badge pill bg="secondary">{relatedStories.length} stories</Badge>
                        {sprintDaysLeft != null && (
                          <Badge
                            pill
                            style={{
                              backgroundColor: themeColor || '#1f2937',
                              color: '#fff',
                              fontWeight: 500,
                            }}
                          >
                            {sprintDaysLeft}d sprint
                          </Badge>
                        )}
                      </div>
                    </div>
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          )}
        </div>
      )}

      {activeTab === 'chores' && (
        renderChoresHabitsWidget()
      )}

      <Modal show={!!noteModal?.show} onHide={() => setNoteModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Add Note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control as="textarea" rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a quick update..." />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setNoteModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveNote} disabled={savingNote || !noteText.trim()}>
            {savingNote ? <Spinner animation="border" size="sm" /> : 'Save Note'}
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={!!priorityReplanPromptStory} onHide={() => setPriorityReplanPromptStory(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title style={{ fontSize: 16 }}>Run Delta Replan?</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-2">
            <strong>{priorityReplanPromptStory?.title || 'This story'}</strong> is now flagged as {getManualPriorityLabel(priorityReplanPromptStory) || 'a manual priority'}.
          </p>
          <p className="mb-0 text-muted small">
            Run delta replan now to create or rebalance calendar blocks around the new priority.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" size="sm" onClick={() => setPriorityReplanPromptStory(null)}>
            Not now
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={replanLoading || fullReplanLoading}
            onClick={handlePriorityPromptReplanNow}
          >
            {replanLoading ? <Spinner animation="border" size="sm" className="me-1" /> : <RefreshCw size={12} className="me-1" />}
            Run delta replan
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit modals */}
      <EditTaskModal
        show={!!editingTask}
        task={editingTask}
        onHide={() => setEditingTask(null)}
      />
      <EditStoryModal
        show={!!editingStory}
        story={editingStory}
        goals={goals}
        onHide={() => setEditingStory(null)}
      />
      <DeferItemModal
        show={!!deferTarget}
        onHide={() => setDeferTarget(null)}
        itemType={deferTarget?.type || 'task'}
        itemId={deferTarget?.id || ''}
        itemTitle={deferTarget?.title || ''}
        onApply={applyDeferredDate}
      />
    </Container>
  );
};

export default MobileHome;
