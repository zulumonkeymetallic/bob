import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Row, Col, Badge, Button, Alert, Collapse, OverlayTrigger, Tooltip, Form, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { Target, BookOpen, TrendingUp, ListChecks, Wallet, Clock } from 'lucide-react';
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
import { addDays, addMinutes, endOfDay, endOfMonth, format, getDay, parse, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
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
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { useUnifiedPlannerData, type PlannerRange } from '../hooks/useUnifiedPlannerData';
import '../styles/Dashboard.css';

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
  const [tasksDueTodaySortMode, setTasksDueTodaySortMode] = useState<'due' | 'ai'>('due');
  const [scheduledToday, setScheduledToday] = useState<ScheduledInstanceModel[]>([]);
  const [scheduledTodayLoading, setScheduledTodayLoading] = useState(false);
  const [unscheduledToday, setUnscheduledToday] = useState<ScheduledInstanceModel[]>([]);
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month'>('day');
  const [calendarDate, setCalendarDate] = useState<Date>(startOfDay(new Date()));
  const [plannerStats, setPlannerStats] = useState<any | null>(null);
  const [remindersDueToday, setRemindersDueToday] = useState<ReminderItem[]>([]);
  const [choresDueToday, setChoresDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [routinesDueToday, setRoutinesDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [monzoSummary, setMonzoSummary] = useState<MonzoSummary | null>(null);
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

  const formatInstanceTime = useCallback((instance: ScheduledInstanceModel) => {
    try {
      if (instance.plannedStart && instance.plannedEnd) {
        const start = new Date(instance.plannedStart);
        const end = new Date(instance.plannedEnd);
        return `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`;
      }
      if (instance.plannedStart) {
        return format(new Date(instance.plannedStart), 'HH:mm');
      }
      return 'Flexible window';
    } catch (err) {
      console.warn('Failed to format instance window', err);
      return 'Flexible window';
    }
  }, []);

  const focusStatusVariant = useCallback((status: ScheduledInstanceModel['status']) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'missed':
      case 'cancelled':
        return 'danger';
      case 'unscheduled':
        return 'warning';
      case 'committed':
        return 'primary';
      default:
        return 'secondary';
    }
  }, []);

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

  const getTaskDueMs = useCallback((task: Task): number | null => {
    const raw: any = (task as any).dueDateMs
      ?? (task as any).dueDate
      ?? (task as any).targetDate
      ?? (task as any).dueAt
      ?? (task as any).due;
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

  const themeFor = (value: any) => {
    const idNum = Number(value);
    return GLOBAL_THEMES.find(t => t.id === idNum || t.label === value || t.name === value);
  };

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
      return source !== 'gcal' && entryMethod !== 'google_calendar';
    });

    const blockEvents = displayBlocks.map((block) => {
      const theme = themeFor(block.theme || block.subTheme);
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
        const theme = themeFor((instance as any).theme || block?.theme || (instance as any).sourceTheme);
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
      .map((external) => ({
        id: external.id,
        title: external.title,
        start: external.start,
        end: external.end,
        type: 'external' as const,
        color: '#9ca3af',
        textColor: '#111827',
        external,
      }));

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
    if (tasksDueToday > 0) parts.push(`${tasksDueToday} due today`);
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
      setScheduledToday([]);
      setScheduledTodayLoading(false);
      return;
    }
    setScheduledTodayLoading(true);
    const todayKey = format(new Date(), 'yyyyMMdd');
    const q = query(
      collection(db, 'scheduled_instances'),
      where('ownerUid', '==', currentUser.uid),
      where('occurrenceDate', '==', todayKey),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as ScheduledInstanceModel)
          .filter((instance) => {
            if (!currentPersona || !instance.persona) return true;
            return instance.persona === currentPersona;
          })
          .sort((a, b) => {
            const aStart = a.plannedStart ? new Date(a.plannedStart).getTime() : 0;
            const bStart = b.plannedStart ? new Date(b.plannedStart).getTime() : 0;
            return aStart - bStart;
          });
        setScheduledToday(rows);
        setScheduledTodayLoading(false);
      },
      (err) => {
        console.error('Failed to load scheduled instances', err);
        setScheduledToday([]);
        setScheduledTodayLoading(false);
      },
    );
    return () => unsub();
  }, [currentUser, currentPersona]);

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
    const sprintStart = selectedSprint?.startDate ? startOfDay(new Date(selectedSprint.startDate)).getTime() : null;
    const sprintEnd = selectedSprint?.endDate ? endOfDay(new Date(selectedSprint.endDate)).getTime() : null;

    const unsub = onSnapshot(
      q,
      (snap) => {
        const todayStart = startOfDay(new Date()).getTime();
        const todayEnd = endOfDay(new Date()).getTime();
        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as Task))
          .filter((task) => !task.deleted)
          .filter((task) => {
            const due = getTaskDueMs(task);
            if (!due) return false;
            return due >= todayStart && due <= todayEnd;
          })
          .filter((task) => {
            if (sprintStart == null || sprintEnd == null) return true;
            const due = getTaskDueMs(task);
            if (!due) return false;
            return due >= sprintStart && due <= sprintEnd;
          })
          .filter((task) => (task.status ?? 0) !== 2);

        rows.sort((a, b) => {
          const aDue = getTaskDueMs(a) || 0;
          const bDue = getTaskDueMs(b) || 0;
          if (aDue !== bDue) return aDue - bDue;
          const aScore = Number((a as any).aiCriticalityScore || 0);
          const bScore = Number((b as any).aiCriticalityScore || 0);
          return bScore - aScore;
        });

        setTasksDueTodayList(rows);
        setTasksDueTodayLoading(false);
      },
      (err) => {
        console.error('Failed to load tasks due today', err);
        setTasksDueTodayList([]);
        setTasksDueTodayLoading(false);
      },
    );
    return () => unsub();
  }, [currentUser, currentPersona, getTaskDueMs, selectedSprint?.startDate, selectedSprint?.endDate]);

  const unscheduledSummary = unscheduledToday.slice(0, 3);
  const scheduledCompletionRate = useMemo(() => {
    if (scheduledToday.length === 0) return 0;
    const completed = scheduledToday.filter((instance) => instance.status === 'completed').length;
    return Math.round((completed / scheduledToday.length) * 100);
  }, [scheduledToday]);

  const nowNextLater = useMemo(() => {
    const now = Date.now();
    const mapped = scheduledToday.map((instance) => {
      const base = instance.occurrenceDate
        ? parse(instance.occurrenceDate, 'yyyyMMdd', new Date())
        : new Date(instance.plannedStart || now);
      const start = instance.plannedStart ? new Date(instance.plannedStart) : addMinutes(base, 8 * 60);
      const end = instance.plannedEnd
        ? new Date(instance.plannedEnd)
        : addMinutes(new Date(start), instance.durationMinutes || 30);
      return { instance, startMs: start.getTime(), endMs: end.getTime() };
    });
    const upcoming = mapped
      .filter((item) => item.endMs >= now)
      .sort((a, b) => a.startMs - b.startMs);
    return {
      nowNext: upcoming.slice(0, 2).map((item) => item.instance),
      later: upcoming.slice(2, 6).map((item) => item.instance),
    };
  }, [scheduledToday]);

  const tasksDueTodayCombined = useMemo(() => {
    const items: Array<{
      id: string;
      kind: 'task' | 'routine' | 'chore';
      title: string;
      dueMs: number | null;
      task?: Task;
    }> = [];

    tasksDueTodayList.forEach((task) => {
      items.push({
        id: task.id,
        kind: 'task',
        title: task.title || 'Task',
        dueMs: getTaskDueMs(task),
        task,
      });
    });

    choresDueToday.forEach((chore) => {
      items.push({
        id: `chore-${chore.id}`,
        kind: 'chore',
        title: chore.title || 'Chore',
        dueMs: chore.dueAt ? chore.dueAt.getTime() : null,
      });
    });

    routinesDueToday.forEach((routine) => {
      items.push({
        id: `routine-${routine.id}`,
        kind: 'routine',
        title: routine.title || 'Routine',
        dueMs: routine.dueAt ? routine.dueAt.getTime() : null,
      });
    });

    if (tasksDueTodaySortMode === 'ai') {
      const tasks = items.filter((item) => item.kind === 'task');
      const habits = items.filter((item) => item.kind !== 'task');
      tasks.sort((a, b) => {
        const aScore = Number((a.task as any)?.aiCriticalityScore ?? (a.task as any)?.aiPriorityScore ?? 0);
        const bScore = Number((b.task as any)?.aiCriticalityScore ?? (b.task as any)?.aiPriorityScore ?? 0);
        if (aScore !== bScore) return bScore - aScore;
        const aDue = a.dueMs ?? 0;
        const bDue = b.dueMs ?? 0;
        return aDue - bDue;
      });
      habits.sort((a, b) => (a.dueMs ?? 0) - (b.dueMs ?? 0));
      return [...tasks, ...habits];
    }

    items.sort((a, b) => (a.dueMs ?? 0) - (b.dueMs ?? 0));
    return items;
  }, [tasksDueTodayList, choresDueToday, routinesDueToday, tasksDueTodaySortMode, getTaskDueMs]);

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
    if (!currentUser) return;
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    // Tasks due today
    const tq = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('dueDate', '>=', start.getTime()),
      where('dueDate', '<=', end.getTime())
    );
    const ts = await getDocs(tq);
    let count = ts.size;
    // Chores due today via nextDueAt precompute
    const cq = query(collection(db, 'chores'), where('ownerUid', '==', currentUser.uid));
    const cs = await getDocs(cq);
    cs.forEach(d => {
      const c: any = d.data() || {};
      const due = c.nextDueAt;
      if (due && due >= start.getTime() && due <= end.getTime()) count += 1;
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


  const handleInstanceStatusChange = useCallback(
    async (instance: ScheduledInstanceModel, status: ScheduledInstanceModel['status']) => {
      try {
        const ref = doc(db, 'scheduled_instances', instance.id);
        await updateDoc(ref, {
          status,
          statusUpdatedAt: Date.now(),
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.error('Failed to update instance status', err);
      }
    },
    [],
  );

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
    { label: 'Tasks due today', value: tasksDueToday },
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
    <Container fluid className="p-4">
      <Row>
        <Col>
          <div className="d-flex justify-content-between flex-wrap gap-3 align-items-start mb-3">
            <div>
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <h2 className="mb-0">Dashboard</h2>
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => navigate('/metrics/progress')}
                    style={{
                      border: '1px solid var(--bs-border-color, #dee2e6)',
                      backgroundColor: 'var(--bs-body-bg)',
                      color: 'var(--bs-body-color)',
                      textAlign: 'left'
                    }}
                  >
                    <div className="text-muted" style={{ fontSize: 10 }}>Story Points</div>
                    <div className="fw-semibold" style={{ fontSize: 12 }}>
                      {stats.doneStoryPoints}/{stats.totalStoryPoints} pts
                      {stats.totalStoryPoints > 0 ? ` · ${stats.storyPointsCompletion}%` : ' · 0%'}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => navigate('/metrics/progress')}
                    style={{
                      border: '1px solid var(--bs-border-color, #dee2e6)',
                      backgroundColor: 'var(--bs-body-bg)',
                      color: 'var(--bs-body-color)',
                      textAlign: 'left'
                    }}
                  >
                    <div className="text-muted" style={{ fontSize: 10 }}>Goals</div>
                    <div className="fw-semibold" style={{ fontSize: 12 }}>
                      {stats.doneGoals}/{stats.totalGoals}
                      {stats.totalGoals > 0 ? ` · ${stats.goalCompletion}%` : ' · 0%'}
                    </div>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      border: '1px solid var(--bs-border-color, #dee2e6)',
                      backgroundColor: 'var(--bs-body-bg)',
                      color: 'var(--bs-body-color)',
                      textAlign: 'left'
                    }}
                    disabled
                  >
                    <div className="text-muted" style={{ fontSize: 10 }}>AI Planning</div>
                    <div className="fw-semibold" style={{ fontSize: 12 }}>
                      {plannerSummary}
                    </div>
                  </button>
                </div>
                {stats.tasksUnlinked > 0 && (
                  <Badge bg="warning" text="dark" pill>
                    {stats.tasksUnlinked} unlinked tasks
                  </Badge>
                )}
              </div>
              <div className="text-muted small mt-2">{dailyBrief()}</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <small className="text-muted">Last updated {lastUpdated.toLocaleTimeString()}</small>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={() => loadDashboardData()}
              >
                Refresh
              </Button>
            </div>
          </div>

          <Row className="g-3 mb-3">
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
                  <Row className="g-2 mb-2">
                    {/* Finance Group */}
                    <Col xs={12} sm={6} lg={3}>
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
                    <Col xs={12} sm={6} lg={3}>
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
                    <Col xs={12} sm={6} lg={3}>
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
                            {stats.storyPointsCompletion || 0}% pts · {stats.goalCompletion || 0}% goals
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

          <Row className="g-3 mb-4">
            <Col xl={12}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">Today’s Plan</span>
                  <Button variant="link" size="sm" className="text-decoration-none" onClick={handleOpenChecklist}>
                    Open planner
                  </Button>
                </Card.Header>
                <Card.Body>
                  <Row className="g-3">
                    <Col lg={8}>
                      <Row className="g-3 mb-3">
                        <Col lg={7}>
                          {dailySummaryLines.length > 0 && (
                            <div>
                              <div className="fw-semibold mb-1">Daily Summary</div>
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
                        </Col>
                        <Col lg={5}>
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
                        </Col>
                      </Row>
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
                          scrollToTime={new Date(1970, 0, 1, 6, 0, 0)}
                          style={{ height: 520 }}
                          eventPropGetter={calendarEventStyleGetter}
                        />
                      </div>
                    </Col>
                    <Col lg={4}>
                      <Card className="shadow-sm border-0 mb-3">
                        <Card.Header className="d-flex align-items-center justify-content-between">
                          <div className="fw-semibold">Now / Next</div>
                          <Badge bg={scheduledToday.length > 0 ? 'info' : 'secondary'} pill>
                            {scheduledCompletionRate}%
                          </Badge>
                        </Card.Header>
                        <Card.Body className="p-3">
                          {scheduledTodayLoading ? (
                            <div className="d-flex align-items-center gap-2 text-muted">
                              <Spinner size="sm" animation="border" /> Loading schedule…
                            </div>
                          ) : nowNextLater.nowNext.length === 0 ? (
                            <div className="text-muted small">Nothing scheduled right now.</div>
                          ) : (
                            nowNextLater.nowNext.map((instance) => (
                              <div key={instance.id} className="border rounded p-2 mb-2">
                                <div className="d-flex justify-content-between align-items-start">
                                  <div>
                                    <div className="fw-semibold">{instance.title || instance.sourceId}</div>
                                    <div className="text-muted small d-flex align-items-center gap-1">
                                      <Clock size={12} /> {formatInstanceTime(instance)}
                                    </div>
                                  </div>
                                  <Badge bg={focusStatusVariant(instance.status)}>{instance.status}</Badge>
                                </div>
                                <div className="d-flex gap-2 mt-2">
                                  <Form.Check
                                    type="checkbox"
                                    id={`dashboard-instance-${instance.id}`}
                                    label="Completed"
                                    checked={instance.status === 'completed'}
                                    onChange={(event) =>
                                      handleInstanceStatusChange(
                                        instance,
                                        event.target.checked ? 'completed' : 'planned',
                                      )
                                    }
                                  />
                                  <Button
                                    size="sm"
                                    variant="outline-secondary"
                                    onClick={() => handleInstanceStatusChange(instance, 'missed')}
                                  >
                                    Skip
                                  </Button>
                                </div>
                              </div>
                            ))
                          )}
                          <div className="fw-semibold text-muted mt-3 mb-2">Later Today</div>
                          {scheduledTodayLoading ? null : nowNextLater.later.length === 0 ? (
                            <div className="text-muted small">Nothing later today.</div>
                          ) : (
                            nowNextLater.later.map((instance) => (
                              <div key={instance.id} className="border rounded p-2 mb-2">
                                <div className="d-flex justify-content-between align-items-start">
                                  <div>
                                    <div className="fw-semibold">{instance.title || instance.sourceId}</div>
                                    <div className="text-muted small d-flex align-items-center gap-1">
                                      <Clock size={12} /> {formatInstanceTime(instance)}
                                    </div>
                                  </div>
                                  <Badge bg={focusStatusVariant(instance.status)}>{instance.status}</Badge>
                                </div>
                              </div>
                            ))
                          )}
                        </Card.Body>
                      </Card>
                      <Card className="shadow-sm border-0">
                        <Card.Header className="d-flex align-items-center justify-content-between">
                          <div className="fw-semibold d-flex align-items-center gap-2">
                            <Clock size={16} /> Tasks due today
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
                            <div className="text-muted small">No tasks or habits due today.</div>
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
                                  <div key={item.id} className="border rounded p-2">
                                    <div className="d-flex justify-content-between align-items-start gap-2">
                                      <div>
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
                                      <Form.Select
                                        size="sm"
                                        value={Number(task.status ?? 0)}
                                        onChange={(e) => handleTaskStatusChange(task, Number(e.target.value))}
                                        aria-label="Update task status"
                                        style={{ width: 140 }}
                                      >
                                        <option value={0}>To Do</option>
                                        <option value={1}>In Progress</option>
                                        <option value={2}>Done</option>
                                      </Form.Select>
                                    </div>
                                    <div className="d-flex align-items-center justify-content-between mt-2">
                                      <div className="d-flex align-items-center gap-2 flex-wrap">
                                        <Badge bg={priorityBadge.bg}>{priorityBadge.text}</Badge>
                                      </div>
                                      <span className="text-muted small">
                                        AI score {aiScore != null ? Math.round(aiScore) : '—'}
                                      </span>
                                    </div>
                                  </div>
                                );
                              }
                              const dueLabel = item.dueMs ? new Date(item.dueMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'today';
                              const badge = item.kind === 'routine' ? 'Routine' : 'Habit';
                              const badgeVariant = item.kind === 'routine' ? 'success' : 'secondary';
                              return (
                                <div key={item.id} className="border rounded p-2">
                                  <div className="d-flex justify-content-between align-items-start gap-2">
                                    <div>
                                      <div className="fw-semibold">{item.title}</div>
                                      <div className="text-muted small d-flex align-items-center gap-1">
                                        <Clock size={12} /> Due {dueLabel}
                                      </div>
                                    </div>
                                    <Badge bg={badgeVariant}>{badge}</Badge>
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
