import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Row, Col, Badge, Button, Alert, Collapse, OverlayTrigger, Tooltip, Form, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { Target, BookOpen, TrendingUp, Wallet, Clock, ListChecks } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit, getDocs, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task, Sprint, Goal } from '../types';
import { isStatus, getPriorityBadge } from '../utils/statusHelpers';
import { useSprint } from '../contexts/SprintContext';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import ThemeBreakdown from './ThemeBreakdown';
import { addDays, addMinutes, endOfDay, endOfMonth, format, getDay, isSameDay, parse, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { Calendar as RBC, Views, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import type { ScheduledInstanceModel } from '../domain/scheduler/repository';
import { nextDueAt } from '../utils/recurrence';
import StatCard from './common/StatCard';
import { colors } from '../utils/colors';
import SprintMetricsPanel from './SprintMetricsPanel';
import { GLOBAL_THEMES, LEGACY_THEME_MAP } from '../constants/globalThemes';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { useUnifiedPlannerData, type PlannerRange } from '../hooks/useUnifiedPlannerData';
import '../styles/Dashboard.css';
import { isRecurringDueOnDate, resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';

const locales = { 'en-GB': enGB } as const;
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales,
});

const DragAndDropCalendar = withDragAndDrop(RBC as any);

interface DashboardCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'block' | 'instance' | 'external';
  color?: string;
  textColor?: string;
  block?: any;
  instance?: ScheduledInstanceModel;
  external?: any;
}

interface DashboardStats {
  activeGoals: number;
  goalsDueSoon: number;
  activeStories: number;
  storyCompletion: number;
  totalGoals: number;
  doneGoals: number;
  goalCompletion: number;
  totalStoryPoints: number;
  doneStoryPoints: number;
  storyPointsCompletion: number;
  pendingTasks: number;
  completedToday: number;
  upcomingDeadlines: number;
  tasksUnlinked: number;
  sprintTasksTotal: number;
  sprintTasksDone: number;
}

interface ReminderItem {
  id: string;
  title: string;
  dueDate: Date | null;
  taskId?: string | null;
}

interface MonzoSummary {
  totals?: {
    spent?: number;
    budget?: number;
    remaining?: number;
  } | null;
  categories?: Array<{ category?: string; name?: string; spent?: number }>;
  goalAlignment?: any;
  updatedAt?: any;
}

interface ChecklistSnapshotItem {
  id: string;
  title: string;
  dueAt: Date | null;
  type: 'chore' | 'routine';
}

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const navigate = useNavigate();
  const { themes: globalThemes } = useGlobalThemes();

  // Debug logging for authentication
  console.log('🔍 Dashboard: currentUser:', currentUser);
  console.log('🔍 Dashboard: currentUser type:', typeof currentUser);
  console.log('🔍 Dashboard: currentUser uid:', currentUser?.uid);
  console.log('🔍 Dashboard: currentUser email:', currentUser?.email);

  const [stats, setStats] = useState<DashboardStats>({
    activeGoals: 0,
    goalsDueSoon: 0,
    activeStories: 0,
    storyCompletion: 0,
    totalGoals: 0,
    doneGoals: 0,
    goalCompletion: 0,
    totalStoryPoints: 0,
    doneStoryPoints: 0,
    storyPointsCompletion: 0,
    pendingTasks: 0,
    completedToday: 0,
    upcomingDeadlines: 0,
    tasksUnlinked: 0,
    sprintTasksTotal: 0,
    sprintTasksDone: 0,
  });
  const [recentStories, setRecentStories] = useState<Story[]>([]);
  const [upcomingTasks, setUpcomingTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  // Use global sprint selection for consistency across app
  const { selectedSprintId, setSelectedSprintId, sprints, sprintsById } = useSprint();
  const selectedSprint = selectedSprintId ? (sprintsById[selectedSprintId] ?? null) : (sprints[0] ?? null);
  const [priorityBanner, setPriorityBanner] = useState<{ title: string; score: number; bucket?: string } | null>(null);
  const [todayBlocks, setTodayBlocks] = useState<any[]>([]);
  const [tasksDueToday, setTasksDueToday] = useState<number>(0);
  const [tasksDueTodayList, setTasksDueTodayList] = useState<Task[]>([]);
  const [tasksDueTodayLoading, setTasksDueTodayLoading] = useState(false);
  const [tasksDueTodaySortMode, setTasksDueTodaySortMode] = useState<'due' | 'ai'>('ai');
  const [top3Collapsed, setTop3Collapsed] = useState(false);
  const [top3Tasks, setTop3Tasks] = useState<Task[]>([]);
  const [top3Stories, setTop3Stories] = useState<Story[]>([]);
  const [top3Loading, setTop3Loading] = useState(false);
  const [unscheduledToday, setUnscheduledToday] = useState<ScheduledInstanceModel[]>([]);
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month'>('day');
  const [calendarDate, setCalendarDate] = useState<Date>(startOfDay(new Date()));
  const [calendarScrollTime, setCalendarScrollTime] = useState<Date>(() => {
    const now = new Date();
    return new Date(1970, 0, 1, now.getHours(), now.getMinutes(), 0);
  });
  const [plannerStats, setPlannerStats] = useState<any | null>(null);
  const [remindersDueToday, setRemindersDueToday] = useState<ReminderItem[]>([]);
  const [choresDueToday, setChoresDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [routinesDueToday, setRoutinesDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [monzoSummary, setMonzoSummary] = useState<MonzoSummary | null>(null);
  const [monzoIntegrationStatus, setMonzoIntegrationStatus] = useState<any | null>(null);
  const [monzoReconnectBusy, setMonzoReconnectBusy] = useState(false);
  const [monzoReconnectMsg, setMonzoReconnectMsg] = useState<string | null>(null);
  const [weeklySummary, setWeeklySummary] = useState<{ total: number; byType: Record<string, number> } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [sprintStories, setSprintStories] = useState<Story[]>([]);
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [sprintGoals, setSprintGoals] = useState<Goal[]>([]);
  const [goalsList, setGoalsList] = useState<Goal[]>([]);
  const [potsById, setPotsById] = useState<Record<string, { name: string; balance: number; currency: string }>>({});
  const [dailySummaryLines, setDailySummaryLines] = useState<string[]>([]);
  const [dailySummarySource, setDailySummarySource] = useState<string | null>(null);
  const [prioritySource, setPrioritySource] = useState<string | null>(null);
  const [aiFocusItems, setAiFocusItems] = useState<any[]>([]);
  const [metricsCollapsed, setMetricsCollapsed] = useState<boolean>(true);
  const [capacityData, setCapacityData] = useState<any | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [profileSnapshot, setProfileSnapshot] = useState<any | null>(null);
  const [choreCompletionBusy, setChoreCompletionBusy] = useState<Record<string, boolean>>({});

  const decodeToDate = useCallback((value: any): Date | null => {
    if (value == null) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') {
      try { return value.toDate(); } catch { return null; }
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return new Date(numeric);
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return new Date(parsed);
    }
    return null;
  }, []);

  const formatPotBalance = useCallback((value: number, currency = 'GBP') => {
    const minor = Number(value || 0);
    const pounds = minor / 100;
    return pounds.toLocaleString('en-GB', { style: 'currency', currency });
  }, []);

  const monzoLastSyncDate = useMemo(() => {
    if (!monzoIntegrationStatus) return null;
    return decodeToDate(
      monzoIntegrationStatus.lastSyncAt
      ?? monzoIntegrationStatus.lastSyncedAt
      ?? monzoIntegrationStatus.lastSync,
    );
  }, [decodeToDate, monzoIntegrationStatus]);

  const monzoSyncAgeDays = useMemo(() => {
    if (!monzoLastSyncDate) return null;
    const diffMs = Date.now() - monzoLastSyncDate.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }, [monzoLastSyncDate]);

  const showMonzoReconnectBanner = useMemo(() => {
    const connected = !!monzoIntegrationStatus?.connected;
    if (!connected || monzoSyncAgeDays == null) return false;
    return monzoSyncAgeDays >= 3;
  }, [monzoIntegrationStatus, monzoSyncAgeDays]);

  useEffect(() => {
    if (!currentUser) {
      setProfileSnapshot(null);
      return;
    }
    const unsub = onSnapshot(doc(db, 'profiles', currentUser.uid), (snap) => {
      setProfileSnapshot(snap.exists() ? snap.data() : null);
    }, (err) => {
      console.warn('Failed to load profile snapshot', err);
      setProfileSnapshot(null);
    });
    return () => unsub();
  }, [currentUser]);

  const youtubeTakeoutLastImportDate = useMemo(() => {
    if (!profileSnapshot) return null;
    return decodeToDate(profileSnapshot.youtubeTakeoutLastImportAt);
  }, [profileSnapshot, decodeToDate]);

  const youtubeTakeoutAgeDays = useMemo(() => {
    if (!youtubeTakeoutLastImportDate) return null;
    const diffMs = Date.now() - youtubeTakeoutLastImportDate.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }, [youtubeTakeoutLastImportDate]);

  const showYouTubeTakeoutBanner = useMemo(() => {
    if (!currentUser) return false;
    if (!youtubeTakeoutLastImportDate) return true;
    return (youtubeTakeoutAgeDays ?? 0) >= 60;
  }, [currentUser, youtubeTakeoutAgeDays, youtubeTakeoutLastImportDate]);

  const handleMonzoReconnect = useCallback(async () => {
    if (!currentUser) return;
    setMonzoReconnectMsg(null);
    setMonzoReconnectBusy(true);
    try {
      const createSession = httpsCallable(functions, 'createMonzoOAuthSession');
      const res: any = await createSession({ origin: window.location.origin });
      const data = res?.data || res;
      const sessionId = data?.sessionId;
      const startUrl = data?.startUrl || (sessionId ? `${window.location.origin}/api/monzo/start?session=${sessionId}` : null);
      if (!startUrl) throw new Error('Unable to resolve Monzo start URL');
      const popup = window.open(startUrl, 'monzo-oauth', 'width=480,height=720');
      if (!popup) {
        setMonzoReconnectMsg('Popup blocked. Please allow popups for Monzo connect.');
      }
    } catch (err: any) {
      console.error('Monzo reconnect failed', err);
      setMonzoReconnectMsg(err?.message || 'Failed to start Monzo OAuth');
    } finally {
      setMonzoReconnectBusy(false);
    }
  }, [currentUser]);

  useEffect(() => {
    const updateScrollTime = () => {
      const now = new Date();
      const isToday = isSameDay(calendarDate, now);
      if (calendarView === 'week') {
        const weekStart = startOfWeek(calendarDate, { weekStartsOn: 1 });
        const weekEnd = endOfDay(addDays(weekStart, 6));
        const inWeek = now >= weekStart && now <= weekEnd;
        setCalendarScrollTime(inWeek ? new Date(1970, 0, 1, now.getHours(), now.getMinutes(), 0) : new Date(1970, 0, 1, 6, 0, 0));
        return;
      }
      if (calendarView === 'day' && isToday) {
        setCalendarScrollTime(new Date(1970, 0, 1, now.getHours(), now.getMinutes(), 0));
        return;
      }
      setCalendarScrollTime(new Date(1970, 0, 1, 6, 0, 0));
    };
    updateScrollTime();
    const id = window.setInterval(updateScrollTime, 60000);
    return () => window.clearInterval(id);
  }, [calendarDate, calendarView]);

  const taskRefLabel = useCallback((task: Task) => {
    if (!task) return '';
    const ref = (task as any).ref
      || (task as any).referenceNumber
      || (task as any).reference
      || (task as any).code
      || (task as any).displayId
      || (task.id ? task.id.slice(-6).toUpperCase() : '');
    if (typeof ref === 'string') return ref.trim();
    return ref ? String(ref) : '';
  }, []);

  const storyLabel = useCallback((story: Story) => {
    if (!story) return '';
    const ref = (story as any).ref
      || (story as any).referenceNumber
      || (story as any).reference
      || (story as any).code
      || (story.id ? story.id.slice(-6).toUpperCase() : '');
    if (ref) return `${String(ref).trim()} — ${story.title || 'Story'}`;
    return story.title || 'Story';
  }, []);


  const storyRefLabel = useCallback((story: Story) => {
    if (!story) return '';
    const ref = (story as any).ref
      || (story as any).referenceNumber
      || (story as any).reference
      || (story as any).code
      || (story.id ? story.id.slice(-6).toUpperCase() : '');
    if (typeof ref === 'string') return ref.trim();
    return ref ? String(ref) : '';
  }, []);

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
    const raw = String((task as any)?.type || (task as any)?.task_type || '').toLowerCase();
    const normalized = raw === 'habitual' ? 'habit' : raw;
    if (['chore', 'routine', 'habit'].includes(normalized)) return normalized as any;
    const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
    const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
    if (tagKeys.includes('chore')) return 'chore';
    if (tagKeys.includes('routine')) return 'routine';
    if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
    return null;
  }, []);

  const formatDueDetail = useCallback((dueMs: number) => {
    const dueDate = new Date(dueMs);
    const dateLabel = format(dueDate, 'MMM d, yyyy');
    const timeLabel = format(dueDate, 'HH:mm');
    const hasTime = dueDate.getHours() !== 0 || dueDate.getMinutes() !== 0;
    return hasTime ? `${dateLabel} • ${timeLabel}` : dateLabel;
  }, []);

  const handleTaskStatusChange = useCallback(async (task: Task, status: number) => {
    try {
      const ref = doc(db, 'tasks', task.id);
      await updateDoc(ref, {
        status,
        completedAt: status === 2 ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to update task status', err);
    }
  }, []);

  const handleCompleteChoreTask = useCallback(async (task: Task) => {
    if (!currentUser) return;
    const taskId = task.id;
    if (!taskId || choreCompletionBusy[taskId]) return;
    setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: true }));
    try {
      const fn = httpsCallable(functions, 'completeChoreTask');
      await fn({ taskId });
    } catch (err) {
      console.warn('Failed to complete chore task', err);
      setChoreCompletionBusy((prev) => ({ ...prev, [taskId]: false }));
      return;
    }
    // allow list refresh to remove the item
    setTimeout(() => {
      setChoreCompletionBusy((prev) => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }, 1500);
  }, [currentUser, choreCompletionBusy]);

  const loadDailySummary = useCallback(async () => {
    if (!currentUser) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    setDailySummarySource(null);
    setPrioritySource(null);
    setAiFocusItems([]);
    try {
      // Prefer daily_summaries (structured); fallback to daily_digests AI text
      const summarySnap = await getDocs(query(
        collection(db, 'daily_summaries'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('generatedAt', 'desc'),
        limit(1)
      ));
      let lines: string[] = [];
      if (!summarySnap.empty) {
        const docData: any = summarySnap.docs[0].data();
        const summary = docData?.summary || {};
        const metaDay = summary?.metadata?.dayIso;
        const modelName = summary?.aiFocus?.model || summary?.metadata?.model || 'Gemini';
        if (!metaDay || metaDay === todayStr) {
            const briefSource = summary?.dailyBrief?.source;
            const summarySource = `Daily summary (${modelName})`;
            setDailySummarySource(briefSource ? `${summarySource} · ${briefSource}` : summarySource);
            const focusSource = summary?.aiFocus?.mode === 'fallback'
              ? 'Heuristic focus (AI unavailable)'
              : `Model: ${modelName}`;
            setPrioritySource(focusSource);
            const briefing = summary?.dailyBriefing || null;
            const dailyBrief = summary?.dailyBrief || null;
            if (briefing?.headline) lines.push(briefing.headline);
            if (briefing?.body) lines.push(briefing.body);
            if (briefing?.checklist) lines.push(briefing.checklist);
            if (lines.length === 0 && dailyBrief) {
              if (Array.isArray(dailyBrief.lines)) {
                lines.push(...dailyBrief.lines.filter(Boolean));
              }
              if (dailyBrief.weather?.summary) {
                const temp = dailyBrief.weather?.temp ? ` (${dailyBrief.weather.temp})` : '';
                lines.push(`Weather: ${dailyBrief.weather.summary}${temp}`);
              }
              if (Array.isArray(dailyBrief.news)) {
                dailyBrief.news.filter(Boolean).slice(0, 3).forEach((item: string) => {
                  lines.push(`News: ${item}`);
                });
              }
            }
            const aiItems: any[] = Array.isArray(summary?.aiFocus?.items) ? summary.aiFocus.items : [];
            setAiFocusItems(aiItems);
            aiItems.slice(0, 3).forEach((item) => {
              const label = [item.ref, item.title || item.summary].filter(Boolean).join(' — ') || (item.ref || '');
              lines.push(`Focus: ${label} — ${item.rationale || item.summary || item.title || ''}`.trim());
            });
        }
      }

      if (lines.length === 0) {
        const digestSnap = await getDocs(query(
          collection(db, 'daily_digests'),
          where('userId', '==', currentUser.uid),
          orderBy('generatedAt', 'desc'),
          limit(1)
        ));
        if (!digestSnap.empty) {
          const docData: any = digestSnap.docs[0].data();
          if (!docData.date || docData.date === todayStr) {
            setDailySummarySource('AI digest fallback');
            setPrioritySource('Heuristic focus (digest fallback)');
            const raw = docData.aiInsights || docData.content || '';
            lines = String(raw)
              .replace(/<[^>]+>/g, '')
              .split(/\n|•/g)
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 0)
              .slice(0, 5);
          }
        }
      }

      setDailySummaryLines(lines);
    } catch (e) {
      setDailySummaryLines([]);
    }
  }, [currentUser]);

  const themePalette = useMemo(
    () => (globalThemes && globalThemes.length ? globalThemes : GLOBAL_THEMES),
    [globalThemes],
  );

  const themeFor = useCallback((value: any) => {
    if (value == null) return undefined;
    const idNum = Number(value);
    if (Number.isFinite(idNum)) {
      const match = themePalette.find(t => t.id === idNum);
      if (match) return match;
    }
    const asString = String(value).trim();
    const lower = asString.toLowerCase();
    const direct = themePalette.find(t =>
      t.label === asString
      || t.name === asString
      || String(t.id) === asString
      || t.label.toLowerCase() === lower
      || t.name.toLowerCase() === lower,
    );
    if (direct) return direct;
    const legacyEntry = Object.entries(LEGACY_THEME_MAP).find(([key]) => key.toLowerCase() === lower);
    if (legacyEntry) {
      const legacyId = Number(legacyEntry[1]);
      return themePalette.find(t => t.id === legacyId);
    }
    return undefined;
  }, [themePalette]);

  const hexToRgba = (hex: string, alpha = 0.12) => {
    const clean = hex.replace('#', '');
    const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
    const num = parseInt(full, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  };

  const calendarRange: PlannerRange = useMemo(() => {
    if (calendarView === 'week') {
      const start = startOfWeek(calendarDate, { weekStartsOn: 1 });
      return { start, end: endOfDay(addDays(start, 6)) };
    }
    if (calendarView === 'month') {
      return { start: startOfMonth(calendarDate), end: endOfMonth(calendarDate) };
    }
    return { start: startOfDay(calendarDate), end: endOfDay(calendarDate) };
  }, [calendarDate, calendarView]);

  const planner = useUnifiedPlannerData(calendarRange);
  const refreshExternalEvents = planner.refreshExternalEvents;

  useEffect(() => {
    if (!currentUser) return;
    refreshExternalEvents().catch(() => undefined);
  }, [currentUser, refreshExternalEvents]);

  const calendarEvents: DashboardCalendarEvent[] = useMemo(() => {
    const displayBlocks = planner.blocks.filter((block) => {
      const source = String((block as any).source || '').toLowerCase();
      const entryMethod = String((block as any).entry_method || '').toLowerCase();
      const isGcal = source === 'gcal' || entryMethod === 'google_calendar';
      const blockId = String((block as any).id || '');
      const isMirrorBlock = blockId.startsWith('sched_') || blockId.startsWith('chore_');
      if (isMirrorBlock) return false;
      if (isGcal) {
        const hasLink = Boolean(block.taskId || block.storyId || block.goalId || (block as any).deepLink);
        return hasLink;
      }
      return true;
    });

    const blockEvents = displayBlocks.map((block) => {
      const theme = themeFor((block as any).theme_id ?? block.theme ?? block.subTheme ?? block.category);
      const color = theme?.color || '#3b82f6';
      return {
        id: block.id,
        title: (block as any).title || `${block.category} • ${block.theme}`,
        start: new Date(block.start),
        end: new Date(block.end),
        type: 'block' as const,
        color,
        textColor: theme?.textColor || '#ffffff',
        block,
      };
    });

    const instanceEvents = planner.instances
      .filter((instance) => instance.plannedStart || instance.occurrenceDate)
      .map((instance) => {
        const block = instance.blockId ? planner.blocks.find((b) => b.id === instance.blockId) : undefined;
        const base = instance.occurrenceDate
          ? parse(instance.occurrenceDate, 'yyyyMMdd', new Date())
          : new Date(instance.plannedStart || Date.now());
        const start = instance.plannedStart ? new Date(instance.plannedStart) : addMinutes(base, 8 * 60);
        const end = instance.plannedEnd
          ? new Date(instance.plannedEnd)
          : addMinutes(new Date(start), instance.durationMinutes || 30);
        const theme = themeFor(
          (instance as any).theme
            ?? (instance as any).sourceTheme
            ?? block?.theme_id
            ?? block?.theme
            ?? block?.category,
        );
        const fallback = instance.sourceType === 'chore'
          ? '#f59e0b'
          : instance.sourceType === 'routine'
            ? '#0ea5e9'
            : '#38bdf8';
        return {
          id: instance.id,
          title: instance.title || (instance.sourceType === 'chore' ? 'Chore' : instance.sourceType === 'routine' ? 'Routine' : 'Planned work'),
          start,
          end,
          type: 'instance' as const,
          color: theme?.color || fallback,
          textColor: theme?.textColor || '#ffffff',
          block,
          instance,
        };
      });

    const linkedGcalIds = new Set<string>();
    planner.instances.forEach((i) => {
      if (i.external?.gcalEventId) linkedGcalIds.add(i.external.gcalEventId);
    });
    displayBlocks.forEach((b) => {
      if (b.googleEventId) linkedGcalIds.add(b.googleEventId);
    });

    const externalEvents = planner.externalEvents
      .filter((external) => {
        if (linkedGcalIds.has(external.id)) return false;
        const blockIdFromExt = (external.raw as any)?.extendedProperties?.private?.blockId;
        if (blockIdFromExt && planner.blocks.some(b => b.id === blockIdFromExt)) return false;
        return true;
      })
      .map((external) => {
        const raw = external.raw as any;
        const privateMeta = raw?.extendedProperties?.private || {};
        const themeCandidate =
          privateMeta.theme
          ?? privateMeta.themeId
          ?? privateMeta.theme_id
          ?? privateMeta['bob-theme']
          ?? privateMeta['bob-theme-id']
          ?? privateMeta['bob_theme_id']
          ?? privateMeta['bob-category']
          ?? privateMeta.category
          ?? privateMeta.themeName
          ?? external.title;
        const theme = themeFor(themeCandidate);
        return {
          id: external.id,
          title: external.title,
          start: external.start,
          end: external.end,
          type: 'external' as const,
          color: theme?.color || '#9ca3af',
          textColor: theme?.textColor || '#111827',
          external,
        };
      });

    return [...externalEvents, ...blockEvents, ...instanceEvents];
  }, [planner.blocks, planner.externalEvents, planner.instances, themeFor]);

  const calendarEventStyleGetter = useCallback((event: DashboardCalendarEvent) => {
    const backgroundColor = event.color || '#3b82f6';
    const color = event.textColor || '#ffffff';
    return {
      style: {
        backgroundColor,
        borderRadius: '6px',
        border: 'none',
        color,
        padding: '2px 6px',
      },
    };
  }, []);

  const updateBlockTiming = useCallback(async (event: DashboardCalendarEvent, start: Date, end: Date) => {
    if (!event.block?.id) return;
    await updateDoc(doc(db, 'calendar_blocks', event.block.id), {
      start: start.getTime(),
      end: end.getTime(),
      updatedAt: Date.now(),
    });
  }, []);

  const updateInstanceTiming = useCallback(async (event: DashboardCalendarEvent, start: Date, end: Date) => {
    if (!event.instance?.id) return;
    await updateDoc(doc(db, 'scheduled_instances', event.instance.id), {
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
      occurrenceDate: format(start, 'yyyyMMdd'),
      updatedAt: Date.now(),
    });
  }, []);

  const updateExternalEventTiming = useCallback(async (event: DashboardCalendarEvent, start: Date, end: Date) => {
    const eventId = event.external?.id || event.id;
    if (!eventId) return;
    const raw: any = event.external?.raw || {};
    const isAllDay = Boolean(raw?.start?.date) && !raw?.start?.dateTime;
    if (isAllDay) return;
    const updateEv = httpsCallable(functions, 'updateCalendarEvent');
    await updateEv({ eventId, start: start.toISOString(), end: end.toISOString() });
    await refreshExternalEvents();
  }, [refreshExternalEvents]);

  const handleCalendarEventMove = useCallback(async ({ event, start, end }: { event: DashboardCalendarEvent; start: Date; end: Date }) => {
    if (event.type === 'external') {
      await updateExternalEventTiming(event, start, end);
      return;
    }
    if (event.type === 'block') {
      await updateBlockTiming(event, start, end);
      return;
    }
    if (event.type === 'instance') {
      await updateInstanceTiming(event, start, end);
    }
  }, [updateBlockTiming, updateExternalEventTiming, updateInstanceTiming]);

  const handleCalendarEventResize = useCallback(async ({ event, start, end }: { event: DashboardCalendarEvent; start: Date; end: Date }) => {
    await handleCalendarEventMove({ event, start, end });
  }, [handleCalendarEventMove]);
  const dailyBrief = () => {
    const parts: string[] = [];
    if (tasksDueToday > 0) parts.push(`${tasksDueToday} due/overdue`);
    if (todayBlocks.length > 0) parts.push(`${todayBlocks.length} blocks scheduled`);
    if (priorityBanner?.title) parts.push(`Focus: ${priorityBanner.title}`);
    return parts.length ? parts.join(' · ') : 'No urgent items. Plan or review your goals.';
  };

  const loadDashboardData = useCallback(() => {
    setRefreshToken((prev) => prev + 1);
    setLastUpdated(new Date());
  }, []);

  useEffect(() => {
    console.log('🔍 Dashboard useEffect triggered:', { currentUser: !!currentUser, persona: currentPersona });
    if (!currentUser) {
      console.log('🔍 Dashboard: No currentUser, returning early');
      return;
    }

    setLoading(true);

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('updatedAt', 'desc'),
      limit(8)
    );

    const storiesSummaryQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const tasksQuery = query(
      collection(db, 'sprint_task_index'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('isOpen', '==', true),
      orderBy('dueDate', 'asc'),
      limit(60)
    );

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        };
      }) as Story[];
      setRecentStories(storiesData.slice(0, 5));
      const activeStories = storiesData.filter(story => !isStatus(story.status, 'done')).length;
      const doneStories = storiesData.filter(story => isStatus(story.status, 'done')).length;
      setStats(prev => ({
        ...prev,
        activeStories,
        storyCompletion: storiesData.length > 0 ? Math.round((doneStories / storiesData.length) * 100) : 0,
      }));
    });

    const unsubscribeStorySummary = onSnapshot(storiesSummaryQuery, (snapshot) => {
      let totalPoints = 0;
      let donePoints = 0;
      let totalStories = 0;
      let doneStories = 0;
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const points = Number(data.points || 0) || 0;
        totalPoints += points;
        totalStories += 1;
        if (isStatus(data.status, 'done')) {
          donePoints += points;
          doneStories += 1;
        }
      });
      const percent = totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0;
      setStats(prev => ({
        ...prev,
        totalStoryPoints: totalPoints,
        doneStoryPoints: donePoints,
        storyPointsCompletion: percent,
        activeStories: totalStories - doneStories,
        storyCompletion: totalStories > 0 ? Math.round((doneStories / totalStories) * 100) : 0,
      }));
    });

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalData = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          ...data,
          targetDate: data.targetDate?.toDate ? data.targetDate.toDate() : data.targetDate,
          dueDate: data.dueDate?.toDate ? data.dueDate.toDate() : data.dueDate,
        } as Goal;
      });
      setGoalsList(goalData);
      const activeGoals = goalData.filter(goal => !isStatus(goal.status, 'Complete')).length;
      const doneGoals = goalData.filter(goal => isStatus(goal.status, 'Complete')).length;
      const now = new Date();
      const soon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      const dueSoon = goalData.filter(goal => {
        const due = decodeToDate(goal.targetDate || goal.dueDate);
        return due ? due >= now && due <= soon : false;
      }).length;
      setStats(prev => ({
        ...prev,
        activeGoals,
        goalsDueSoon: dueSoon,
        totalGoals: goalData.length,
        doneGoals,
        goalCompletion: goalData.length > 0 ? Math.round((doneGoals / goalData.length) * 100) : 0,
      }));
    });

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
          dueDate: data.dueDate?.toDate ? data.dueDate.toDate() : data.dueDate,
        };
      }) as Task[];
      const activeTaskList = allTasks.filter(task => !isStatus(task.status, 'done'));
      setUpcomingTasks(activeTaskList.slice(0, 5));
      const openTasks = allTasks.filter(task => !isStatus(task.status, 'done')).length;
      const todayCompleted = allTasks.filter(task => {
        if (!isStatus(task.status, 'done') || !task.updatedAt) return false;
        const completedDate = decodeToDate(task.updatedAt);
        if (!completedDate) return false;
        const today = new Date();
        return completedDate.toDateString() === today.toDateString();
      }).length;
      const unlinkedCount = allTasks.filter(task => !task.storyId).length;
      const now = new Date();
      const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const upcomingDeadlines = allTasks.filter(task => {
        const due = decodeToDate(task.dueDate ?? (task as any).targetDate ?? (task as any).dueDateMs);
        return due ? due >= now && due <= soon : false;
      }).length;
      const sprintTasks = selectedSprintId
        ? allTasks.filter(task => task.sprintId === selectedSprintId)
        : allTasks.filter(task => task.sprintId);
      const sprintDone = sprintTasks.filter(task => isStatus(task.status, 'done')).length;
      setStats(prev => ({
        ...prev,
        pendingTasks: openTasks,
        completedToday: todayCompleted,
        tasksUnlinked: unlinkedCount,
        upcomingDeadlines,
        sprintTasksTotal: sprintTasks.length,
        sprintTasksDone: sprintDone,
      }));
    });

    const potsQuery = query(
      collection(db, 'monzo_pots'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribePots = onSnapshot(potsQuery, (snapshot) => {
      const map: Record<string, { name: string; balance: number; currency: string }> = {};
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data() as any;
        const id = data.potId || docSnap.id;
        if (!id) return;
        map[String(id)] = {
          name: data.name || id,
          balance: Number(data.balance || 0),
          currency: data.currency || 'GBP',
        };
      });
      setPotsById(map);
    });

    const loadAdditionalData = async () => {
      if (!currentUser) return;
      try {
        await Promise.all([
          loadLLMPriority(),
          loadTodayBlocks(),
          countTasksDueToday(),
          loadRemindersDueToday(),
          loadChecklistDueToday(),
          loadDailySummary(),
          loadMonzoSummary()
        ]);
      } catch (error) {
        console.error("Error loading additional dashboard data:", error);
      }
    };

    loadAdditionalData();
    setLastUpdated(new Date());
    setLoading(false);

    return () => {
      unsubscribeStories();
      unsubscribeStorySummary();
      unsubscribeGoals();
      unsubscribeTasks();
      unsubscribePots();
    };
  }, [currentUser, currentPersona, selectedSprintId, refreshToken, decodeToDate]);

  useEffect(() => {
    if (!currentUser) {
      setUnscheduledToday([]);
      return;
    }
    const todayKey = format(new Date(), 'yyyyMMdd');
    const q = query(
      collection(db, 'scheduled_instances'),
      where('ownerUid', '==', currentUser.uid),
      where('occurrenceDate', '==', todayKey),
      where('status', '==', 'unscheduled'),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as ScheduledInstanceModel[];
      setUnscheduledToday(rows);
    });
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) {
      setMonzoIntegrationStatus(null);
      return;
    }
    const integrationDoc = doc(db, 'integration_status', `monzo_${currentUser.uid}`);
    const unsub = onSnapshot(
      integrationDoc,
      (snap) => setMonzoIntegrationStatus(snap.exists() ? snap.data() : null),
      (err) => {
        console.warn('Failed to load Monzo integration status', err);
        setMonzoIntegrationStatus(null);
      },
    );
    return () => unsub();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setTasksDueTodayList([]);
      setTasksDueTodayLoading(false);
      return;
    }
    setTasksDueTodayLoading(true);
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const todayDate = new Date();
        const todayStart = startOfDay(todayDate).getTime();
        const todayEnd = endOfDay(todayDate).getTime();
        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as Task))
          .filter((task) => !task.deleted)
          .filter((task) => {
            const due = getTaskDueMs(task);
            const isChore = !!getChoreKind(task);
            if (due) return due <= todayEnd;
            if (isChore) return isRecurringDueOnDate(task, todayDate, due);
            return false;
          })
          .filter((task) => (task.status ?? 0) !== 2);

        const filtered = rows.filter((task) => {
          if (!getChoreKind(task)) return true;
          const lastDone = getTaskLastDoneMs(task);
          if (!lastDone) return true;
          return lastDone < todayStart || lastDone > todayEnd;
        });

        filtered.sort((a, b) => {
          const aDue = getTaskDueMs(a) || 0;
          const bDue = getTaskDueMs(b) || 0;
          if (aDue !== bDue) return aDue - bDue;
          const aScore = Number((a as any).aiCriticalityScore || 0);
          const bScore = Number((b as any).aiCriticalityScore || 0);
          return bScore - aScore;
        });

        setTasksDueTodayList(filtered);
        setTasksDueTodayLoading(false);
      },
      (err) => {
        console.error('Failed to load tasks due today', err);
        setTasksDueTodayList([]);
        setTasksDueTodayLoading(false);
      },
    );
    return () => unsub();
  }, [currentUser, currentPersona, getTaskDueMs, getChoreKind, getTaskLastDoneMs]);

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setTop3Tasks([]);
      setTop3Stories([]);
      setTop3Loading(false);
      return;
    }
    setTop3Loading(true);
    const todayIso = new Date().toISOString().slice(0, 10);
    let tasksReady = false;
    let storiesReady = false;
    const markReady = () => {
      if (tasksReady && storiesReady) setTop3Loading(false);
    };

    const isTaskDone = (status: any) => {
      if (typeof status === 'number') return status >= 2;
      const s = String(status || '').toLowerCase();
      return ['done', 'complete', 'completed', 'finished', 'closed'].includes(s);
    };
    const isStoryDone = (status: any) => {
      if (typeof status === 'number') return status >= 4;
      const s = String(status || '').toLowerCase();
      return ['done', 'complete', 'completed', 'finished', 'closed'].includes(s);
    };

    const taskQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('aiTop3ForDay', '==', true),
    );
    const storyQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('aiTop3ForDay', '==', true),
    );

    const unsubTasks = onSnapshot(
      taskQuery,
      (snap) => {
        const rows = snap.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as any) } as Task))
          .filter((task) => !task.deleted)
          .filter((task) => !isTaskDone(task.status))
          .filter((task) => {
            const aiDate = (task as any).aiTop3Date;
            if (!aiDate) return true;
            return String(aiDate).slice(0, 10) === todayIso;
          })
          .sort((a, b) => {
            const ar = Number((a as any).aiPriorityRank || 0) || 99;
            const br = Number((b as any).aiPriorityRank || 0) || 99;
            if (ar !== br) return ar - br;
            const as = Number((a as any).aiCriticalityScore ?? -1);
            const bs = Number((b as any).aiCriticalityScore ?? -1);
            if (as !== bs) return bs - as;
            return String(a.title || '').localeCompare(String(b.title || ''));
          })
          .slice(0, 3);
        setTop3Tasks(rows);
        tasksReady = true;
        markReady();
      },
      (err) => {
        console.warn('Failed to load top 3 tasks', err);
        setTop3Tasks([]);
        tasksReady = true;
        markReady();
      },
    );

    const unsubStories = onSnapshot(
      storyQuery,
      (snap) => {
        const rows = snap.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as any) } as Story))
          .filter((story) => !isStoryDone(story.status))
          .filter((story) => {
            const aiDate = (story as any).aiTop3Date;
            if (!aiDate) return true;
            return String(aiDate).slice(0, 10) === todayIso;
          })
          .sort((a, b) => {
            const ar = Number((a as any).aiFocusStoryRank || 0) || 99;
            const br = Number((b as any).aiFocusStoryRank || 0) || 99;
            if (ar !== br) return ar - br;
            const as = Number((a as any).aiCriticalityScore ?? -1);
            const bs = Number((b as any).aiCriticalityScore ?? -1);
            if (as !== bs) return bs - as;
            return String(a.title || '').localeCompare(String(b.title || ''));
          })
          .slice(0, 3);
        setTop3Stories(rows);
        storiesReady = true;
        markReady();
      },
      (err) => {
        console.warn('Failed to load top 3 stories', err);
        setTop3Stories([]);
        storiesReady = true;
        markReady();
      },
    );

    return () => {
      unsubTasks();
      unsubStories();
    };
  }, [currentUser, currentPersona]);

  const unscheduledSummary = unscheduledToday.slice(0, 3);

  const todayDate = useMemo(() => new Date(), []);
  const todayStartMs = useMemo(() => startOfDay(new Date()).getTime(), []);

  const choresDueTodayTasks = useMemo(() => {
    const rows = tasksDueTodayList.filter((task) => !!getChoreKind(task));
    rows.sort((a, b) => {
      const aDue = resolveRecurringDueMs(a, todayDate, todayStartMs) ?? 0;
      const bDue = resolveRecurringDueMs(b, todayDate, todayStartMs) ?? 0;
      return aDue - bDue;
    });
    return rows;
  }, [tasksDueTodayList, getChoreKind, todayDate, todayStartMs]);

  const nonChoreTasksDueToday = useMemo(() => {
    return tasksDueTodayList.filter((task) => !getChoreKind(task));
  }, [tasksDueTodayList, getChoreKind]);

  const tasksDueTodayCombined = useMemo(() => {
    const items: Array<{
      id: string;
      kind: 'task' | 'routine' | 'chore';
      title: string;
      dueMs: number | null;
      task?: Task;
    }> = [];

    nonChoreTasksDueToday.forEach((task) => {
      items.push({
        id: task.id,
        kind: 'task',
        title: task.title || 'Task',
        dueMs: getTaskDueMs(task),
        task,
      });
    });

    if (tasksDueTodaySortMode === 'ai') {
      const tasks = items.filter((item) => item.kind === 'task');
      tasks.sort((a, b) => {
        const aScore = Number((a.task as any)?.aiCriticalityScore ?? (a.task as any)?.aiPriorityScore ?? 0);
        const bScore = Number((b.task as any)?.aiCriticalityScore ?? (b.task as any)?.aiPriorityScore ?? 0);
        if (aScore !== bScore) return bScore - aScore;
        const aDue = a.dueMs ?? 0;
        const bDue = b.dueMs ?? 0;
        return aDue - bDue;
      });
      return tasks;
    }

    items.sort((a, b) => (a.dueMs ?? 0) - (b.dueMs ?? 0));
    return items;
  }, [nonChoreTasksDueToday, tasksDueTodaySortMode, getTaskDueMs]);

  const tasksByRef = useMemo(() => {
    const map = new Map<string, Task>();
    const sources = [...upcomingTasks, ...tasksDueTodayList, ...sprintTasks];
    sources.forEach((task) => {
      const ref = taskRefLabel(task);
      if (!ref) return;
      map.set(ref.toUpperCase(), task);
    });
    return map;
  }, [upcomingTasks, tasksDueTodayList, sprintTasks, taskRefLabel]);

  const storiesByRef = useMemo(() => {
    const map = new Map<string, Story>();
    const sources = [...recentStories, ...sprintStories];
    sources.forEach((story) => {
      const ref = storyRefLabel(story);
      if (!ref) return;
      map.set(ref.toUpperCase(), story);
    });
    return map;
  }, [recentStories, sprintStories, storyRefLabel]);

  const sortedTasksDueToday = useMemo(() => {
    const rows = [...tasksDueTodayList];
    if (tasksDueTodaySortMode === 'ai') {
      rows.sort((a, b) => {
        const aScore = Number((a as any).aiCriticalityScore ?? (a as any).aiPriorityScore ?? 0);
        const bScore = Number((b as any).aiCriticalityScore ?? (b as any).aiPriorityScore ?? 0);
        if (aScore !== bScore) return bScore - aScore;
        const aDue = getTaskDueMs(a) || 0;
        const bDue = getTaskDueMs(b) || 0;
        return aDue - bDue;
      });
      return rows;
    }
    rows.sort((a, b) => {
      const aDue = getTaskDueMs(a) || 0;
      const bDue = getTaskDueMs(b) || 0;
      if (aDue !== bDue) return aDue - bDue;
      const aScore = Number((a as any).aiCriticalityScore ?? (a as any).aiPriorityScore ?? 0);
      const bScore = Number((b as any).aiCriticalityScore ?? (b as any).aiPriorityScore ?? 0);
      return bScore - aScore;
    });
    return rows;
  }, [tasksDueTodayList, tasksDueTodaySortMode, getTaskDueMs]);
  const potGoalLinks = useMemo(() => {
    const map: Record<string, { potId: string; potName: string; balance: number; currency: string; goals: Goal[] }> = {};
    goalsList.forEach((goal) => {
      const potId = (goal as any).linkedPotId || (goal as any).potId || null;
      if (!potId) return;
      const potInfo = potsById[potId];
      const potName = potInfo?.name || potId;
      if (!map[potId]) {
        map[potId] = {
          potId,
          potName,
          balance: potInfo?.balance || 0,
          currency: potInfo?.currency || 'GBP',
          goals: [],
        };
      }
      map[potId].goals.push(goal);
    });
    return Object.values(map);
  }, [goalsList, potsById]);

  const savingsMetrics = useMemo(() => {
    let totalEstimated = 0;
    let totalSavedPence = 0;
    const seenPotIds = new Set<string>();

    goalsList.forEach((goal) => {
      const est = Number((goal as any).estimatedCost || 0);
      totalEstimated += Number.isFinite(est) ? est : 0;

      const rawPotId = (goal as any).linkedPotId || (goal as any).potId;
      if (!rawPotId) return;
      const raw = String(rawPotId);
      const candidates = [raw];
      if (currentUser?.uid && raw.startsWith(`${currentUser.uid}_`)) {
        candidates.push(raw.replace(`${currentUser.uid}_`, ''));
      }
      const potId = candidates.find((id) => potsById[id]);
      if (!potId || seenPotIds.has(potId)) return;
      seenPotIds.add(potId);
      const balance = Number(potsById[potId]?.balance || 0);
      totalSavedPence += Number.isFinite(balance) ? balance : 0;
    });

    const savedMajor = totalSavedPence / 100;
    const savingsPct = totalEstimated > 0 ? Math.min(100, Math.round((savedMajor / totalEstimated) * 100)) : 0;

    return {
      totalEstimated,
      totalSavedPence,
      savingsPct,
    };
  }, [goalsList, potsById, currentUser?.uid]);

  const loadLLMPriority = async () => {
    if (!currentUser) return;
    try {
      // Use a small snapshot of tasks as candidates
      const tq = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('createdAt', 'desc'),
        limit(30)
      );
      const snap = await getDocs(tq);
      const tasks: any[] = [];
      snap.forEach(d => {
        const t = d.data();
        tasks.push({ id: d.id, title: t.title, dueDate: t.dueDate || null, priority: t.priority, effort: t.effort, status: t.status });
      });

      const call = httpsCallable(functions, 'prioritizeBacklog');
      const res: any = await call({ tasks });
      const items = Array.isArray(res?.data?.items) ? res.data.items : [];
      const todayItem = items.find((x: any) => (x.bucket || '').toUpperCase() === 'TODAY');
      const best = todayItem || items.sort((a: any, b: any) => (b.score || 0) - (a.score || 0))[0];
      if (best) {
        const ref = tasks.find(t => t.id === best.id);
        if (ref) setPriorityBanner({ title: ref.title, score: best.score || 0, bucket: best.bucket || null });
      }
    } catch (e) {
      // Fallback: top priority from current upcomingTasks state
      if (upcomingTasks && upcomingTasks.length > 0) {
        const top = upcomingTasks[0];
        setPriorityBanner({ title: top.title, score: 0 });
      }
    }
  };

  const loadTodayBlocks = async () => {
    if (!currentUser) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', start.getTime()),
      where('start', '<=', end.getTime())
    );
    const snap = await getDocs(q);
    const blocks: any[] = [];
    snap.forEach(d => blocks.push({ id: d.id, ...(d.data() || {}) }));
    blocks.sort((a, b) => a.start - b.start);
    setTodayBlocks(blocks);
  };

  const countTasksDueToday = async () => {
    if (!currentUser || !currentPersona) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const isPersonaMatch = (value: any) => {
      if (currentPersona === 'work') return value === 'work';
      return value == null || value === 'personal';
    };
    // Tasks due today or overdue
    const tq = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('dueDate', '<=', end.getTime())
    );
    const ts = await getDocs(tq);
    let count = 0;
    ts.forEach((docSnap) => {
      const data = docSnap.data() as any;
      if (data?.deleted) return;
      if ((data?.status ?? 0) === 2) return;
      if (!isPersonaMatch(data?.persona)) return;
      count += 1;
    });
    // Chores due today via nextDueAt precompute
    const cq = query(collection(db, 'chores'), where('ownerUid', '==', currentUser.uid));
    const cs = await getDocs(cq);
    cs.forEach(d => {
      const c: any = d.data() || {};
      const due = c.nextDueAt;
      if (due && due <= end.getTime()) count += 1;
    });
    setTasksDueToday(count);
  };

  const loadRemindersDueToday = async () => {
    if (!currentUser) {
      setRemindersDueToday([]);
      return;
    }
    const start = startOfDay(new Date()).getTime();
    const end = endOfDay(new Date()).getTime();
    const remindersQuery = query(
      collection(db, 'reminders'),
      where('ownerUid', '==', currentUser.uid),
      where('dueDate', '>=', start),
      where('dueDate', '<=', end)
    );
    const snap = await getDocs(remindersQuery).catch(() => null);
    if (!snap) {
      setRemindersDueToday([]);
      return;
    }
    const items: ReminderItem[] = [];
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if ((data.status || 'open') === 'done') return;
      const dueDate = decodeToDate(data.dueDate || data.dueAt);
      items.push({
        id: docSnap.id,
        title: data.title || data.note || 'Reminder',
        dueDate,
        taskId: data.taskId || null,
      });
    });
    items.sort((a, b) => {
      const aTime = a.dueDate ? a.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.dueDate ? b.dueDate.getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
    setRemindersDueToday(items);
  };

  const loadChecklistDueToday = async () => {
    if (!currentUser) {
      setChoresDueToday([]);
      setRoutinesDueToday([]);
      return;
    }

    const start = startOfDay(new Date()).getTime();
    const end = endOfDay(new Date()).getTime();

    const choreSnap = await getDocs(query(collection(db, 'chores'), where('ownerUid', '==', currentUser.uid))).catch(() => null);
    const routineSnap = await getDocs(query(collection(db, 'routines'), where('ownerUid', '==', currentUser.uid))).catch(() => null);

    const chores: ChecklistSnapshotItem[] = [];
    if (choreSnap) {
      choreSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const dtstart = data.dtstart || data.createdAt || undefined;
        const computed = nextDueAt(data.rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
        const due = data.nextDueAt || computed;
        if (due && due >= start && due <= end) {
          chores.push({
            id: docSnap.id,
            title: data.title || 'Chore',
            dueAt: new Date(due),
            type: 'chore',
          });
        }
      });
    }

    const routines: ChecklistSnapshotItem[] = [];
    if (routineSnap) {
      routineSnap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        const rrule = data.recurrence?.rrule || data.rrule;
        if (!rrule) return;
        const dtstart = data.recurrence?.dtstart || data.dtstart || data.createdAt || undefined;
        const computed = nextDueAt(rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
        const due = data.nextDueAt || computed;
        if (due && due >= start && due <= end) {
          routines.push({
            id: docSnap.id,
            title: data.name || 'Routine',
            dueAt: new Date(due),
            type: 'routine',
          });
        }
      });
    }

    chores.sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER));
    routines.sort((a, b) => (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER));

    setChoresDueToday(chores);
    setRoutinesDueToday(routines);
  };

  const loadMonzoSummary = async () => {
    if (!currentUser) {
      setMonzoSummary(null);
      return;
    }
    try {
      const budgetSnap = await getDoc(doc(db, 'monzo_budget_summary', currentUser.uid));
      const alignmentSnap = await getDoc(doc(db, 'monzo_goal_alignment', currentUser.uid));
      if (!budgetSnap.exists && !alignmentSnap.exists) {
        setMonzoSummary(null);
        return;
      }
      const summary: MonzoSummary = {};
      if (budgetSnap.exists) {
        const data = budgetSnap.data() as any;
        summary.totals = data?.totals || null;
        summary.categories = Array.isArray(data?.categories) ? data.categories.slice(0, 4) : [];
        summary.updatedAt = data?.updatedAt || null;
      }
      if (alignmentSnap.exists) {
        summary.goalAlignment = alignmentSnap.data();
      }
      setMonzoSummary(summary);
    } catch (error) {
      console.warn('Failed to load Monzo summary', error);
      setMonzoSummary(null);
    }
  };

  const handleNavigateToTasksToday = () => {
    navigate('/tasks', { state: { preset: 'dueToday' } });
  };

  const handleOpenChecklist = () => {
    navigate('/calendar', { state: { focus: 'checklist' } });
  };

  const handleOpenBlock = (blockId?: string | null) => {
    if (!blockId) {
      navigate('/calendar');
      return;
    }
    navigate('/calendar', { state: { focus: 'checklist', focusBlockId: blockId } });
  };

  const handleThemeSelect = (themeId: string) => {
    navigate('/stories', { state: { themeId } });
  };

  // Sprint-scoped data for metrics panel
  useEffect(() => {
    if (!currentUser || !currentPersona || !selectedSprintId) {
      setSprintStories([]);
      setSprintTasks([]);
      setSprintGoals([]);
      return;
    }

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('sprintId', '==', selectedSprintId)
    );
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('sprintId', '==', selectedSprintId)
    );
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubStories = onSnapshot(storiesQuery, (snap) => {
      setSprintStories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Story)));
    });
    const unsubTasks = onSnapshot(tasksQuery, (snap) => {
      setSprintTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Task)));
    });
    const unsubGoals = onSnapshot(goalsQuery, (snap) => {
      setSprintGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) } as Goal)));
    });

    return () => {
      unsubStories();
      unsubTasks();
      unsubGoals();
    };
  }, [currentUser, currentPersona, selectedSprintId]);

  // Planner stats snapshot
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
    if (!currentUser?.uid || !selectedSprintId) {
      setCapacityData(null);
      return;
    }
    let active = true;
    setCapacityLoading(true);
    setCapacityError(null);
    const fetchCapacity = async () => {
      try {
        const calculateCapacity = httpsCallable(functions, 'calculateSprintCapacity');
        const result = await calculateCapacity({ sprintId: selectedSprintId });
        if (!active) return;
        setCapacityData(result.data);
      } catch (err: any) {
        if (!active) return;
        console.warn('capacity fetch failed', err);
        setCapacityError(err?.message || 'Failed to load capacity data.');
        setCapacityData(null);
      } finally {
        if (!active) return;
        setCapacityLoading(false);
      }
    };
    fetchCapacity();
    return () => { active = false; };
  }, [currentUser?.uid, selectedSprintId]);

  const sprintProgress = stats.sprintTasksTotal > 0
    ? Math.min(100, Math.round((stats.sprintTasksDone / stats.sprintTasksTotal) * 100))
    : 0;
  const sprintRemaining = Math.max(stats.sprintTasksTotal - stats.sprintTasksDone, 0);
  const hasSelectedSprint = Boolean(selectedSprintId);

  const sortedUpcoming = [...upcomingTasks].sort((a, b) => {
    const aDue = decodeToDate(a.dueDate ?? (a as any).targetDate ?? (a as any).dueDateMs)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bDue = decodeToDate(b.dueDate ?? (b as any).targetDate ?? (b as any).dueDateMs)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
  const upcomingFocus = sortedUpcoming.slice(0, 4);

  const formatDueLabel = (task: Task): string => {
    const due = decodeToDate(task.dueDate ?? (task as any).targetDate ?? (task as any).dueDateMs);
    if (!due) return 'No due date';
    return format(due, 'MMM d');
  };

  const automationSnapshot = [
    { label: 'Tasks due/overdue', value: tasksDueToday },
    { label: 'Reminders pending', value: remindersDueToday.length },
    { label: 'Chores today', value: choresDueToday.length },
    { label: 'Routines today', value: routinesDueToday.length },
    { label: 'Unscheduled blocks', value: unscheduledToday.length },
  ];

  const capacitySummary = capacityData ? {
    total: Number(capacityData.totalCapacityHours ?? 0),
    allocated: Number(capacityData.allocatedHours ?? 0),
    free: Number(capacityData.freeCapacityHours ?? 0),
    utilization: capacityData.utilization ? Math.min(150, Math.round(capacityData.utilization * 100)) : 0,
    scheduled: Number(capacityData.scheduledHours ?? 0),
  } : null;
  const capacityUtilVariant = (utilization: number) => {
    if (utilization > 100) return 'danger';
    if (utilization > 80) return 'warning';
    return 'success';
  };

  const financeSummary = useMemo(() => {
    const spent = monzoSummary?.totals?.spent;
    const budget = monzoSummary?.totals?.budget;
    if (spent == null || budget == null) return '£0 spent';
    const remaining = budget - spent;
    return `£${(spent / 100).toFixed(0)} spent · £${(remaining / 100).toFixed(0)} left`;
  }, [monzoSummary]);

  const plannerSummary = useMemo(() => {
    if (!plannerStats) return 'Not yet run';
    const when = plannerStats.lastRunAt
      ? new Date(plannerStats.lastRunAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Unknown time';
    return `${when} · +${plannerStats.created || 0} created · ${plannerStats.replaced || 0} replaced · ${plannerStats.blocked || 0} blocked`;
  }, [plannerStats]);

  const sprintSummaryMetrics = useMemo(() => {
    if (!selectedSprint) return null;
    const now = new Date();
    const startDate = new Date(selectedSprint.startDate);
    const endDate = new Date(selectedSprint.endDate);
    const hasStarted = now >= startDate;
    const hasEnded = now > endDate;
    const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    const daysUntilStart = Math.max(0, Math.ceil((startDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

    const sprintStoryIds = new Set(sprintStories.map((story) => story.id));
    const sprintStoryTasks = sprintTasks.filter((task) => (
      task.parentType === 'story' && task.parentId && sprintStoryIds.has(task.parentId)
    ));

    const totalStories = sprintStories.length;
    const completedStories = sprintStories.filter((story) => story.status === 4).length;
    const totalTasks = sprintStoryTasks.length;
    const completedTasks = sprintStoryTasks.filter((task) => task.status === 2).length;

    const totalPoints = sprintStories.reduce((sum, story) => sum + (story.points || 0), 0);
    const completedPoints = sprintStories
      .filter((story) => story.status === 4)
      .reduce((sum, story) => sum + (story.points || 0), 0);

    const progress = totalPoints > 0
      ? Math.round((completedPoints / totalPoints) * 100)
      : (totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0);

    const timeLabel = hasEnded
      ? 'Ended'
      : hasStarted
        ? `${daysLeft}d left`
        : `${daysUntilStart}d to start`;

    return {
      timeLabel,
      totalStories,
      completedStories,
      totalTasks,
      completedTasks,
      progress,
      completedPoints,
      totalPoints
    };
  }, [selectedSprint, sprintStories, sprintTasks]);

  const sprintSummary = useMemo(() => {
    if (!selectedSprint || !sprintSummaryMetrics) return { label: 'Select sprint', detail: '' };
    return {
      label: `${sprintSummaryMetrics.progress}% · ${sprintSummaryMetrics.timeLabel}`,
      detail: `${sprintSummaryMetrics.completedStories}/${sprintSummaryMetrics.totalStories} stories · ${sprintSummaryMetrics.completedPoints}/${sprintSummaryMetrics.totalPoints} pts`
    };
  }, [selectedSprint, sprintSummaryMetrics]);

  if (!currentUser) {
    return <div>Please sign in to view your dashboard.</div>;
  }

  return (
    <Container fluid className="p-2 dashboard-compact">
      <Row>
        <Col>
          {stats.tasksUnlinked > 0 && (
            <div className="mb-2">
              <Badge bg="warning" text="dark" pill>
                {stats.tasksUnlinked} unlinked tasks
              </Badge>
            </div>
          )}

          {showMonzoReconnectBanner && (
            <Alert variant="warning" className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div>
                <div className="fw-semibold">Monzo sync is stale</div>
                <div className="text-muted small">
                  Last sync {monzoSyncAgeDays} days ago
                  {monzoLastSyncDate ? ` (${monzoLastSyncDate.toLocaleString()})` : ''}.
                </div>
                {monzoReconnectMsg && <div className="text-muted small mt-1">{monzoReconnectMsg}</div>}
              </div>
              <Button
                variant="outline-dark"
                size="sm"
                onClick={handleMonzoReconnect}
                disabled={monzoReconnectBusy}
              >
                {monzoReconnectBusy ? <Spinner size="sm" animation="border" className="me-2" /> : null}
                Reconnect Monzo
              </Button>
            </Alert>
          )}

          {showYouTubeTakeoutBanner && (
            <Alert variant="warning" className="d-flex align-items-center justify-content-between flex-wrap gap-2">
              <div>
                <div className="fw-semibold">YouTube watch history import is due</div>
                <div className="text-muted small">
                  {youtubeTakeoutLastImportDate
                    ? `Last import ${youtubeTakeoutAgeDays ?? 0} days ago (${youtubeTakeoutLastImportDate.toLocaleString()}).`
                    : 'No Google Takeout import detected yet.'}
                  {' '}Upload <code>watch-history.json</code> every 60 days to keep your 7-day YouTube metric accurate.
                </div>
              </div>
              <Button
                variant="outline-dark"
                size="sm"
                onClick={() => navigate('/settings/integrations/youtube')}
              >
                Import YouTube data
              </Button>
            </Alert>
          )}

          <Row className="g-2 mb-1">
            <Col xl={12}>
              <Card className="shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <div className="fw-semibold">Key Metrics</div>
                  <Button
                    size="sm"
                    variant="link"
                    className="text-decoration-none"
                    onClick={() => setMetricsCollapsed((prev) => !prev)}
                  >
                    {metricsCollapsed ? 'Expand' : 'Collapse'}
                  </Button>
                </Card.Header>
                <Card.Body className="py-2">
                  <Row className="g-2 mb-2 dashboard-inline-row dashboard-key-metrics">
                    {/* Finance Group */}
                    <Col xs={12} sm={6} lg={4}>
                      <div 
                        className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100" 
                        style={{ 
                          background: 'var(--bs-body-bg)', 
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onClick={() => navigate('/finance/dashboard')}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--bs-primary-bg-subtle)';
                          e.currentTarget.style.borderColor = 'var(--bs-primary)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                          e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                        }}
                      >
                        <Wallet size={16} className="text-info" />
                        <div className="flex-grow-1">
                          <div className="text-muted small">Finance</div>
                          <div className="fw-semibold">
                            {financeSummary}
                          </div>
                        </div>
                      </div>
                    </Col>

                    {/* Capacity Group */}
                    <Col xs={12} sm={6} lg={4}>
                      <div 
                        className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100" 
                        style={{ 
                          background: 'var(--bs-body-bg)', 
                          cursor: hasSelectedSprint ? 'pointer' : 'default',
                          transition: 'all 0.2s ease',
                          opacity: hasSelectedSprint ? 1 : 0.6
                        }}
                        onClick={hasSelectedSprint ? () => navigate('/capacity') : undefined}
                        onMouseEnter={(e) => {
                          if (hasSelectedSprint) {
                            e.currentTarget.style.backgroundColor = 'var(--bs-primary-bg-subtle)';
                            e.currentTarget.style.borderColor = 'var(--bs-primary)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (hasSelectedSprint) {
                            e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                            e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                          }
                        }}
                      >
                        <Target size={16} className="text-primary" />
                        <div className="flex-grow-1">
                          <div className="text-muted small">Capacity</div>
                          <div className="fw-semibold">
                            {hasSelectedSprint && capacitySummary ? `${capacitySummary.utilization}% · ${capacitySummary.free.toFixed(1)}h free` : 'Select sprint'}
                          </div>
                        </div>
                      </div>
                    </Col>

                    {/* Sprint Progress Group */}
                    <Col xs={12} sm={6} lg={4}>
                      <div 
                        className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100" 
                        style={{ 
                          background: 'var(--bs-body-bg)', 
                          cursor: selectedSprint ? 'pointer' : 'default',
                          transition: 'all 0.2s ease',
                          opacity: selectedSprint ? 1 : 0.6
                        }}
                        onClick={selectedSprint ? () => navigate('/sprints/management') : undefined}
                        onMouseEnter={(e) => {
                          if (selectedSprint) {
                            e.currentTarget.style.backgroundColor = 'var(--bs-success-bg-subtle)';
                            e.currentTarget.style.borderColor = 'var(--bs-success)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (selectedSprint) {
                            e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                            e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                          }
                        }}
                      >
                        <TrendingUp size={16} className="text-success" />
                        <div className="flex-grow-1">
                          <div className="text-muted small">Sprint Progress</div>
                          <div className="fw-semibold">
                            {sprintSummary.label}
                          </div>
                          {sprintSummary.detail && <div className="text-muted small">{sprintSummary.detail}</div>}
                        </div>
                      </div>
                    </Col>

                    {/* Overall Progress Group */}
                    <Col xs={12} sm={6} lg={3}>
                      <div 
                        className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100" 
                        style={{ 
                          background: 'var(--bs-body-bg)', 
                          cursor: 'pointer',
                          transition: 'all 0.2s ease'
                        }}
                        onClick={() => navigate('/metrics/progress')}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--bs-warning-bg-subtle)';
                          e.currentTarget.style.borderColor = 'var(--bs-warning)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                          e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                        }}
                      >
                        <BookOpen size={16} className="text-warning" />
                        <div className="flex-grow-1">
                          <div className="text-muted small">Overall Progress</div>
                          <div className="fw-semibold">
                            {stats.storyPointsCompletion || 0}% pts · {stats.goalCompletion || 0}% goals · {savingsMetrics.savingsPct}% saved
                          </div>
                          <div className="text-muted small">
                            Saved {formatPotBalance(savingsMetrics.totalSavedPence)} of {savingsMetrics.totalEstimated ? savingsMetrics.totalEstimated.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' }) : '£0'}
                          </div>
                          <div className="text-muted small">AI {plannerSummary}</div>
                        </div>
                      </div>
                    </Col>

                  </Row>

                  {!metricsCollapsed && hasSelectedSprint && capacitySummary && (
                    <Row className="g-2 dashboard-inline-row dashboard-key-metrics">
                      <Col xs={6} md={4} xl={2}>
                        <Card className="h-100 border-0 shadow-sm">
                          <Card.Body className="p-2">
                            <OverlayTrigger
                              placement="bottom"
                              overlay={(
                                <Tooltip id="capacity-total-tooltip">
                                  16h/day (24h − 8h sleep) minus work blocks in the sprint. If no work block, defaults to 8h weekdays.
                                </Tooltip>
                              )}
                            >
                              <div className="text-muted small" style={{ cursor: 'help' }}>Total capacity</div>
                            </OverlayTrigger>
                            <div className="fw-semibold">{capacitySummary.total.toFixed(1)}h</div>
                          </Card.Body>
                        </Card>
                      </Col>
                      <Col xs={6} md={4} xl={2}>
                        <Card className="h-100 border-0 shadow-sm">
                          <Card.Body className="p-2">
                            <OverlayTrigger
                              placement="bottom"
                              overlay={(
                                <Tooltip id="capacity-allocated-tooltip">
                                  Story estimates/points allocated to this sprint.
                                </Tooltip>
                              )}
                            >
                              <div className="text-muted small" style={{ cursor: 'help' }}>Allocated</div>
                            </OverlayTrigger>
                            <div className="fw-semibold">{capacitySummary.allocated.toFixed(1)}h</div>
                          </Card.Body>
                        </Card>
                      </Col>
                      <Col xs={6} md={4} xl={2}>
                        <Card className="h-100 border-0 shadow-sm">
                          <Card.Body className="p-2">
                            <OverlayTrigger
                              placement="bottom"
                              overlay={(
                                <Tooltip id="capacity-free-tooltip">
                                  Remaining capacity after subtracting allocated story hours.
                                </Tooltip>
                              )}
                            >
                              <div className="text-muted small" style={{ cursor: 'help' }}>Free</div>
                            </OverlayTrigger>
                            <div className={`fw-semibold ${capacitySummary.free < 0 ? 'text-danger' : 'text-success'}`}>
                              {capacitySummary.free.toFixed(1)}h
                            </div>
                          </Card.Body>
                        </Card>
                      </Col>
                      <Col xs={6} md={4} xl={2}>
                        <Card className="h-100 border-0 shadow-sm">
                          <Card.Body className="p-2">
                            <OverlayTrigger
                              placement="bottom"
                              overlay={(
                                <Tooltip id="capacity-utilization-tooltip">
                                  Allocated hours ÷ total capacity.
                                </Tooltip>
                              )}
                            >
                              <div className="text-muted small" style={{ cursor: 'help' }}>Utilization</div>
                            </OverlayTrigger>
                            <div className={`fw-semibold text-${capacityUtilVariant(capacitySummary.utilization)}`}>
                              {capacitySummary.utilization}%
                            </div>
                          </Card.Body>
                        </Card>
                      </Col>
                      <Col xs={6} md={4} xl={2}>
                        <Card className="h-100 border-0 shadow-sm">
                          <Card.Body className="p-2">
                            <OverlayTrigger
                              placement="bottom"
                              overlay={(
                                <Tooltip id="capacity-scheduled-tooltip">
                                  Calendar blocks linked to sprint stories/tasks (excludes chores/routines and external calendars).
                                </Tooltip>
                              )}
                            >
                              <div className="text-muted small" style={{ cursor: 'help' }}>Scheduled</div>
                            </OverlayTrigger>
                            <div className="fw-semibold">{capacitySummary.scheduled.toFixed(1)}h</div>
                          </Card.Body>
                        </Card>
                      </Col>
                    </Row>
                  )}
                </Card.Body>
                <Collapse in={!metricsCollapsed}>
                  <div>
                    <div className="px-3 pb-3">
                      {selectedSprint ? (
                        <SprintMetricsPanel
                          sprint={selectedSprint}
                          stories={sprintStories}
                          tasks={sprintTasks}
                          goals={sprintGoals}
                        />
                      ) : (
                        <div className="d-flex justify-content-between align-items-center">
                          <div>
                            <h6 className="mb-1">Select a sprint to see metrics</h6>
                            <div className="text-muted">Use the sprint selector above to focus the dashboard.</div>
                          </div>
                          <Button variant="primary" onClick={() => navigate('/sprints/management')}>
                            Manage sprints
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </Collapse>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mb-1">
            <Col xl={12}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center py-2">
                  <span className="fw-semibold">Today’s Plan</span>
                  <div className="d-flex align-items-center gap-2">
                    <Button variant="link" size="sm" className="text-decoration-none" onClick={handleOpenChecklist}>
                      View calendar
                    </Button>
                    <Button variant="link" size="sm" className="text-decoration-none" onClick={() => navigate('/sprints/kanban')}>
                      View kanban
                    </Button>
                  </div>
                </Card.Header>
                <Card.Body>
                  <Row className="g-3 today-plan-layout">
                    <Col md={12} className="today-plan-col today-plan-col-summary">
                      {(dailySummaryLines.length > 0 || aiFocusItems.length > 0) && (
                        <Card className="shadow-sm border-0 mb-3">
                          <Card.Header className="d-flex align-items-center justify-content-between">
                            <div className="fw-semibold">Daily Summary</div>
                            <Badge bg="secondary" pill>Today</Badge>
                          </Card.Header>
                          <Card.Body className="p-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
                            {dailySummaryLines.length > 0 && (
                              <div className="mb-3">
                                {dailySummarySource && (
                                  <div className="text-muted small mb-1">Source: {dailySummarySource}</div>
                                )}
                                <ul className="mb-0 small">
                                  {dailySummaryLines.map((line, idx) => (
                                    <li key={idx}>{line}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {aiFocusItems.length > 0 && (
                              <div>
                                <div className="fw-semibold mb-1">AI focus</div>
                                {prioritySource && <div className="text-muted small mb-1">Source: {prioritySource}</div>}
                                <ul className="mb-0 small">
                                  {aiFocusItems.slice(0, 3).map((it: any, idx: number) => {
                                    const refKey = (it.ref || '').toUpperCase();
                                    const matchedTask = refKey ? tasksByRef.get(refKey) : undefined;
                                    const matchedStory = !matchedTask && refKey ? storiesByRef.get(refKey) : undefined;
                                    const directType = String(it.type || it.entityType || '').toLowerCase();
                                    const directId = it.id || it.entityId || null;
                                    const href = directId && directType === 'task'
                                      ? `/tasks/${directId}`
                                      : directId && directType === 'story'
                                        ? `/stories/${directId}`
                                        : matchedTask
                                          ? `/tasks/${matchedTask.id}`
                                          : matchedStory
                                            ? `/stories/${matchedStory.id}`
                                            : undefined;
                                    const label = [it.ref, it.title || it.summary].filter(Boolean).join(' — ') || 'Focus';
                                    const rationale = it.rationale || it.nextStep ? ` — ${it.rationale || it.nextStep}` : '';
                                    return (
                                      <li key={idx}>
                                        {href ? (
                                          <>
                                            <a href={href} className="text-decoration-none">{label}</a>{rationale}
                                          </>
                                        ) : (
                                          <>
                                            {label}{rationale}
                                          </>
                                        )}
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}
                          </Card.Body>
                        </Card>
                      )}
                      <Card className="shadow-sm border-0 mb-3">
                        <Card.Header className="d-flex align-items-center justify-content-between">
                          <div className="fw-semibold d-flex align-items-center gap-2">
                            <ListChecks size={16} /> Top 3 priorities
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            <Badge bg="secondary" pill>{currentPersona === 'work' ? 'Work' : 'Personal'}</Badge>
                            <Button
                              size="sm"
                              variant="outline-secondary"
                              onClick={() => setTop3Collapsed((prev) => !prev)}
                            >
                              {top3Collapsed ? 'Show' : 'Hide'}
                            </Button>
                          </div>
                        </Card.Header>
                        {!top3Collapsed && (
                          <Card.Body className="p-3 d-flex flex-column gap-3">
                            {top3Loading ? (
                              <div className="d-flex align-items-center gap-2 text-muted">
                                <Spinner size="sm" animation="border" /> Loading top 3…
                              </div>
                            ) : (top3Tasks.length === 0 && top3Stories.length === 0) ? (
                              <div className="text-muted small">No Top 3 items flagged for this persona yet.</div>
                            ) : (
                              <>
                                <div>
                                  <div className="text-uppercase text-muted small fw-semibold mb-1">Stories</div>
                                  {top3Stories.length === 0 ? (
                                    <div className="text-muted small">No stories flagged.</div>
                                  ) : (
                                    top3Stories.map((story, idx) => {
                                      const label = storyLabel(story);
                                      const aiScore = (story as any).aiCriticalityScore ?? (story as any).aiPriorityScore;
                                      const href = `/stories/${(story as any).ref || story.id}`;
                                      return (
                                        <div key={story.id} className="border rounded p-2 mb-2">
                                          <div className="fw-semibold">
                                            <a href={href} className="text-decoration-none">{label}</a>
                                          </div>
                                          <div className="text-muted small d-flex justify-content-between">
                                            <span>Rank {idx + 1}</span>
                                            <span>AI {aiScore != null ? Math.round(aiScore) : '—'}</span>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                                <div>
                                  <div className="text-uppercase text-muted small fw-semibold mb-1">Tasks</div>
                                  {top3Tasks.length === 0 ? (
                                    <div className="text-muted small">No tasks flagged.</div>
                                  ) : (
                                    top3Tasks.map((task, idx) => {
                                      const refLabel = taskRefLabel(task);
                                      const label = refLabel ? `${refLabel} — ${task.title}` : task.title;
                                      const aiScore = (task as any).aiCriticalityScore ?? (task as any).aiPriorityScore;
                                      const href = `/tasks/${(task as any).ref || task.id}`;
                                      return (
                                        <div key={task.id} className="border rounded p-2 mb-2">
                                          <div className="fw-semibold">
                                            <a href={href} className="text-decoration-none">{label}</a>
                                          </div>
                                          <div className="text-muted small d-flex justify-content-between">
                                            <span>Rank {idx + 1}</span>
                                            <span>AI {aiScore != null ? Math.round(aiScore) : '—'}</span>
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              </>
                            )}
                          </Card.Body>
                        )}
                      </Card>
                    </Col>
                    <Col md={12} className="today-plan-col today-plan-col-calendar">
                      {unscheduledToday.length > 0 && (
                        <Alert variant="warning" className="py-2">
                          <div className="fw-semibold mb-1">Scheduling issues</div>
                          <ul className="mb-0 small">
                            {unscheduledSummary.map((item) => (
                              <li key={item.id}>{item.title || item.sourceId}</li>
                            ))}
                            {unscheduledToday.length > unscheduledSummary.length && (
                              <li className="text-muted">+{unscheduledToday.length - unscheduledSummary.length} more</li>
                            )}
                          </ul>
                        </Alert>
                      )}
                      <div className="fw-semibold mb-2">Calendar</div>
                      <div className="calendar-dashboard-wrap">
                        <DragAndDropCalendar
                          localizer={localizer}
                          events={calendarEvents}
                          startAccessor="start"
                          endAccessor="end"
                          views={['day', 'week', 'month']}
                          view={calendarView}
                          date={calendarDate}
                          defaultView={Views.DAY}
                          onView={(view) => setCalendarView(view as 'day' | 'week' | 'month')}
                          onNavigate={(date) => setCalendarDate(date)}
                          onEventDrop={handleCalendarEventMove}
                          onEventResize={handleCalendarEventResize}
                          resizable
                          popup
                          scrollToTime={calendarScrollTime}
                          getNow={() => new Date()}
                          style={{ height: 460 }}
                          eventPropGetter={calendarEventStyleGetter}
                        />
                      </div>
                    </Col>
                    <Col md={6} className="today-plan-col today-plan-col-due">
                      <Card className="shadow-sm border-0 h-100 dashboard-due-card">
                          <Card.Header className="d-flex align-items-center justify-content-between">
                            <div className="fw-semibold d-flex align-items-center gap-2">
                              <Clock size={16} /> Tasks due today & overdue
                            </div>
                            <div className="d-flex align-items-center gap-2">
                              <Form.Select
                                size="sm"
                                value={tasksDueTodaySortMode}
                                onChange={(e) => setTasksDueTodaySortMode(e.target.value as 'due' | 'ai')}
                              >
                                <option value="due">Sort: Due time</option>
                                <option value="ai">Sort: AI score</option>
                              </Form.Select>
                              <Badge bg={tasksDueTodayCombined.length > 0 ? 'info' : 'secondary'} pill>
                                {tasksDueTodayCombined.length}
                              </Badge>
                            </div>
                          </Card.Header>
                          <Card.Body className="p-3 d-flex flex-column gap-2">
                            {tasksDueTodayLoading ? (
                              <div className="d-flex align-items-center gap-2 text-muted">
                                <Spinner size="sm" animation="border" /> Loading tasks…
                              </div>
                            ) : tasksDueTodayCombined.length === 0 ? (
                              <div className="text-muted small">No tasks due today or overdue.</div>
                            ) : (
                              tasksDueTodayCombined.map((item) => {
                                if (item.kind === 'task' && item.task) {
                                  const task = item.task;
                                  const dueMs = getTaskDueMs(task);
                                  const aiScore = (task as any).aiCriticalityScore ?? (task as any).aiPriorityScore;
                                  const refLabel = taskRefLabel(task);
                                  const priorityBadge = getPriorityBadge((task as any).priority);
                                  const dueLabel = dueMs ? formatDueDetail(dueMs) : null;
                                  return (
                                    <div key={item.id} className="border rounded p-3 dashboard-due-item">
                                      <div className="d-flex justify-content-between align-items-start gap-2">
                                        <div className="flex-grow-1">
                                          <div className="fw-semibold">{task.title}</div>
                                          {refLabel && (
                                            <div className="text-muted small">
                                              <a href={`/tasks/${task.id}`} className="text-decoration-none">
                                                <code className="text-primary">{refLabel}</code>
                                              </a>
                                            </div>
                                          )}
                                          <div className="text-muted small d-flex align-items-center gap-1">
                                            <Clock size={12} /> Due {dueLabel ?? '—'}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="d-flex align-items-end justify-content-between mt-2 gap-2">
                                        <div className="d-flex align-items-center gap-2 flex-wrap">
                                          <Badge bg={priorityBadge.bg}>{priorityBadge.text}</Badge>
                                          <span className="text-muted small">
                                            AI score {aiScore != null ? Math.round(aiScore) : '—'}
                                          </span>
                                        </div>
                                        <Form.Select
                                          size="sm"
                                          value={Number(task.status ?? 0)}
                                          onChange={(e) => handleTaskStatusChange(task, Number(e.target.value))}
                                          aria-label="Update task status"
                                          className="dashboard-task-status-select"
                                        >
                                          <option value={0}>To do</option>
                                          <option value={1}>Doing</option>
                                          <option value={2}>Done</option>
                                        </Form.Select>
                                      </div>
                                    </div>
                                  );
                                }
                                return null;
                              })
                            )}
                          </Card.Body>
                        </Card>
                    </Col>
                    <Col md={6} className="today-plan-col today-plan-col-chores">
                      <Card className="shadow-sm border-0 h-100 dashboard-chores-card">
                        <Card.Header className="d-flex align-items-center justify-content-between">
                          <div className="fw-semibold d-flex align-items-center gap-2">
                            <ListChecks size={16} /> Chores & Habits
                          </div>
                          <div className="d-flex align-items-center gap-2">
                            <Button size="sm" variant="outline-secondary" href="/chores/checklist">
                              Checklist
                            </Button>
                            <Badge bg={choresDueTodayTasks.length > 0 ? 'info' : 'secondary'} pill>
                              {choresDueTodayTasks.length}
                            </Badge>
                          </div>
                        </Card.Header>
                        <Card.Body className="p-3 d-flex flex-column gap-2">
                          {tasksDueTodayLoading ? (
                            <div className="d-flex align-items-center gap-2 text-muted">
                              <Spinner size="sm" animation="border" /> Loading chores…
                            </div>
                          ) : choresDueTodayTasks.length === 0 ? (
                            <div className="text-muted small">No chores, habits, or routines due today.</div>
                          ) : (
                            choresDueTodayTasks.map((task) => {
                              const kind = getChoreKind(task) || 'chore';
                              const dueMs = resolveRecurringDueMs(task, todayDate, todayStartMs);
                              const dueLabel = dueMs ? formatDueDetail(dueMs) : 'today';
                              const isOverdue = !!dueMs && dueMs < todayStartMs;
                              const badgeVariant = kind === 'routine' ? 'success' : kind === 'habit' ? 'secondary' : 'primary';
                              const badgeLabel = kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore';
                              const busy = !!choreCompletionBusy[task.id];
                              return (
                                <div key={task.id} className="border rounded p-2 d-flex align-items-start gap-2">
                                  <Form.Check
                                    type="checkbox"
                                    checked={busy}
                                    disabled={busy}
                                    onChange={() => handleCompleteChoreTask(task)}
                                    aria-label={`Complete ${task.title}`}
                                  />
                                  <div className="flex-grow-1">
                                    <div className="fw-semibold">{task.title}</div>
                                    <div className="text-muted small d-flex align-items-center gap-1">
                                      <Clock size={12} /> {isOverdue ? `Overdue · ${dueLabel}` : `Due ${dueLabel}`}
                                    </div>
                                  </div>
                                  <div className="d-flex flex-column align-items-end gap-1">
                                    {isOverdue && <Badge bg="danger">Overdue</Badge>}
                                    <Badge bg={badgeVariant}>{badgeLabel}</Badge>
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </Card.Body>
                      </Card>
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          <Row className="g-3 mt-3">
            <Col xl={12}>
              <Card className="shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Automation Snapshot</span>
                  <Button variant="link" size="sm" className="text-decoration-none p-0" onClick={handleNavigateToTasksToday}>
                    Go to Tasks
                  </Button>
                </Card.Header>
                <Card.Body>
                  <ul className="list-unstyled mb-3">
                    {automationSnapshot.map((item) => (
                      <li key={item.label} className="d-flex justify-content-between align-items-center py-1">
                        <span className="text-muted">{item.label}</span>
                        <span className="fw-semibold">{item.value}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="text-muted small">
                    Weekly summary and priorities roll into this view after nightly runs.
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </Container>
  );
};

export default Dashboard;
