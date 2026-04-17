import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Container, Card, Row, Col, Badge, Button, Alert, Collapse, OverlayTrigger, Tooltip, Form, Spinner, Table } from 'react-bootstrap';
import { useNavigate, Link } from 'react-router-dom';
import { Target, BookOpen, TrendingUp, Wallet, Clock, ListChecks, Calendar as CalendarIcon, LayoutGrid, RefreshCw, Sparkles, Activity, GripVertical, Heart, CheckCircle, X } from 'lucide-react';
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, arrayMove, rectSortingStrategy } from '@dnd-kit/sortable';
import { CSS as DndCSS } from '@dnd-kit/utilities';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, limit, getDocs, doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Task, Sprint, Goal } from '../types';
import { isStatus, getPriorityBadge } from '../utils/statusHelpers';
import { useSprint } from '../contexts/SprintContext';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import ThemeBreakdown from './ThemeBreakdown';
import { addDays, addMinutes, endOfDay, endOfMonth, format, getDay, isSameDay, parse, startOfDay, startOfMonth, startOfWeek } from 'date-fns';
import { enGB } from 'date-fns/locale';
import type { ScheduledInstanceModel } from '../domain/scheduler/repository';
import { nextDueAt } from '../utils/recurrence';
import StatCard from './common/StatCard';
import { colors } from '../utils/colors';
import SprintMetricsPanel from './SprintMetricsPanel';
import JournalInsightsCard from './JournalInsightsCard';
import BirthdayMilestoneCard from './BirthdayMilestoneCard';
import KpiDashboardWidget from './KpiDashboardWidget';
import DailyPlanSummaryCard from './planner/DailyPlanSummaryCard';
import WeeklyPlannerSummaryCard from './planner/WeeklyPlannerSummaryCard';
import PlanActionBar from './planner/PlanActionBar';
import { GLOBAL_THEMES, LEGACY_THEME_MAP } from '../constants/globalThemes';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { useUnifiedPlannerData, type PlannerRange } from '../hooks/useUnifiedPlannerData';
import '../styles/Dashboard.css';
import { isRecurringDueOnDate, resolveRecurringDueMs, resolveTaskDueMs } from '../utils/recurringTaskDue';
import EditTaskModal from './EditTaskModal';
import EditStoryModal from './EditStoryModal';
import { useSidebar } from '../contexts/SidebarContext';
import { goalNeedsLinkedPot } from '../utils/goalCost';
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, Legend } from 'recharts';
import { Calendar as RBC, Views, dateFnsLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import RecoveryWidget from './metrics/RecoveryWidget';
import ActivityWidget from './metrics/ActivityWidget';
import FitnessWidget from './metrics/FitnessWidget';
import SprintVelocityWidget from './metrics/SprintVelocityWidget';
import { isGoalInHierarchySet } from '../utils/goalHierarchy';
import {
  callDeltaReplan,
  callFullReplan,
  formatDeltaReplanSummary,
  formatFullReplanSummary,
  normalizePlannerCallableError,
} from '../utils/plannerOrchestration';

const _rbcLocales = { 'en-GB': enGB } as const;
const _rbcLocalizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales: _rbcLocales,
});

const isSprintActiveStatus = (status: any): boolean => {
  const numeric = Number(status);
  if (Number.isFinite(numeric)) return numeric === 1;
  return String(status || '').trim().toLowerCase() === 'active';
};


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

interface FinanceWindowSummary {
  windowDays: number;
  mandatoryPence: number;
  discretionaryPence: number;
  uncategorisedPence: number;
}

interface LowerBetterTrendMetric {
  current: number | null;
  previous: number | null;
  delta: number | null;
}

interface FitnessTrendSummary {
  avgRpe: LowerBetterTrendMetric;
  avg5kSec: LowerBetterTrendMetric;
  avg10kSec: LowerBetterTrendMetric;
  runDistanceYtdKm: number | null;
  swimDistanceYtdKm: number | null;
  bikeDistanceYtdKm: number | null;
  predicted5kDisplay: string | null;
  predicted10kDisplay: string | null;
  predictedHalfMarathonDisplay: string | null;
  predictedSwim800Display: string | null;
  predictedBike50Display: string | null;
}

interface FinanceTrendSummary {
  discretionaryPence: LowerBetterTrendMetric;
  uncategorisedPence: LowerBetterTrendMetric;
}

interface DailyActiveSignal {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  ctaPath: string | null;
}

interface ChecklistSnapshotItem {
  id: string;
  title: string;
  dueAt: Date | null;
  type: 'chore' | 'routine';
}

const normalizeDailyActiveSignals = (rawSignals: any): DailyActiveSignal[] => {
  if (!Array.isArray(rawSignals)) return [];
  return rawSignals
    .map((signal: any) => {
      const severityRaw = String(signal?.severity || 'info').trim().toLowerCase();
      const severity = severityRaw === 'critical' || severityRaw === 'warning' ? severityRaw : 'info';
      const title = String(signal?.title || '').trim();
      const message = String(signal?.message || '').trim();
      const ctaRaw = String(signal?.ctaPath || '').trim();
      if (!title && !message) return null;
      return {
        type: String(signal?.type || 'signal').trim() || 'signal',
        severity,
        title: title || 'Signal',
        message,
        ctaPath: ctaRaw || null,
      } as DailyActiveSignal;
    })
    .filter(Boolean) as DailyActiveSignal[];
};

interface NextWorkRecommendedItem {
  type: 'task' | 'story';
  id: string;
  ref: string | null;
  title: string;
  label: string;
  path: string | null;
  deepLink: string | null;
  taskKind?: string | null;
  score: number | null;
  source: string | null;
  reason: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  dueDate: string | null;
}

interface NextWorkRecommendation {
  ok: boolean;
  computedAt: string | null;
  timezone: string | null;
  persona: string | null;
  selectedSprintId: string | null;
  status: string | null;
  reasonCode: string | null;
  spokenResponse: string | null;
  currentCalendarBlock: {
    title: string | null;
    start: string | null;
    end: string | null;
  } | null;
  recommendedItem: NextWorkRecommendedItem | null;
}

interface EveningPullForwardItem {
  type: 'task' | 'story';
  id: string;
  title: string;
  label?: string;
  ref?: string | null;
  score?: number | null;
  reason?: string | null;
  persona?: 'personal' | 'work' | string;
}

interface EveningPullForwardSuggestion {
  active: boolean;
  message?: string | null;
  suggestions: EveningPullForwardItem[];
}

const FINANCE_WINDOW_DAYS = 5;
const INTEGRATION_STALE_DAYS = 7;
const NEXT_WORK_REFRESH_MS = 60 * 60 * 1000;
const FINANCE_INCOME_BUCKETS = new Set(['income', 'net_salary', 'irregular_income']);
const FINANCE_UNCATEGORISED_BUCKETS = new Set(['unknown', 'uncategorized', 'uncategorised']);
const TODAY_PLAN_COLUMN_STORAGE_KEY = 'bob_dashboard_today_plan_columns_v1';
const PROFILE_OVERVIEW_LAYOUT_KEY = 'overviewWidgetLayout';
const PROFILE_TODAY_PLAN_COLUMNS_KEY = 'todayPlanColumns';
const HEALTH_BANNER_DISMISS_KEY = 'dashboard-health-banner-dismissed-date';
const HEALTH_BANNER_SHOW_EVERY_DAYS = 3;
const DASHBOARD_WIDGET_VISIBILITY_STORAGE_PREFIX = 'bob_dashboard_widget_visibility_v1';
const DASHBOARD_WIDGET_SIZE_STORAGE_PREFIX = 'bob_dashboard_widget_sizes_v2';
const DASHBOARD_WIDGET_ORDER_STORAGE_PREFIX = 'bob_dashboard_widget_order_v1';
// Col-span storage removed — widgetSizes now stores both width and height as pixels
const TODAY_PLAN_DESKTOP_BREAKPOINT = 992;
const TODAY_PLAN_COLUMN_KEYS = ['summary', 'calendar', 'due', 'chores'] as const;
type TodayPlanColumnKey = (typeof TODAY_PLAN_COLUMN_KEYS)[number];
type TodayPlanColumnWidths = Record<TodayPlanColumnKey, number>;
type DashboardDeviceType = 'mobile' | 'tablet' | 'desktop';
type DashboardWidgetKey =
  | 'lowHangingFruit'
  | 'dailySummary'
  | 'top3'
  | 'themeProgress'
  | 'kpiStudio'
  | 'unifiedTimeline'
  | 'tasksDueToday'
  | 'choresHabits'
  | 'calendar'
  | 'recoveryMetrics'
  | 'activityMetrics'
  | 'fitnessMetrics'
  | 'sprintVelocity';
type DashboardWidgetVisibility = Record<DashboardWidgetKey, boolean>;
interface DashboardWidgetSize {
  width: number;
  height: number;
}
type DashboardWidgetSizes = Partial<Record<DashboardWidgetKey, DashboardWidgetSize>>;
const SUMMARY_WIDGET_KEYS: DashboardWidgetKey[] = ['unifiedTimeline', 'top3', 'dailySummary', 'kpiStudio', 'choresHabits', 'lowHangingFruit', 'themeProgress', 'tasksDueToday', 'calendar', 'recoveryMetrics', 'activityMetrics', 'fitnessMetrics', 'sprintVelocity'];
const dashboardWidgetOrderStorageKey = (deviceType: DashboardDeviceType) => `${DASHBOARD_WIDGET_ORDER_STORAGE_PREFIX}_${deviceType}`;
const readDashboardWidgetOrder = (deviceType: DashboardDeviceType): DashboardWidgetKey[] => {
  try {
    const stored = window.localStorage.getItem(dashboardWidgetOrderStorageKey(deviceType));
    if (stored) {
      const parsed = JSON.parse(stored) as DashboardWidgetKey[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch { /* ignore */ }
  return [...SUMMARY_WIDGET_KEYS];
};

function SortableDashboardWidget({ id, widgetWidth, dragEnabled, children }: {
  id: string;
  widgetWidth?: number;
  dragEnabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: DndCSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    position: 'relative',
    ...(widgetWidth != null
      ? { width: `${widgetWidth}px`, flexBasis: `${widgetWidth}px`, flexShrink: 0, flexGrow: 0, maxWidth: '100%' }
      : {}),
  };
  return (
    <div ref={setNodeRef} style={style} className="dashboard-sortable-item">
      {dragEnabled && (
        <div
          className="dashboard-drag-handle"
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label="Drag to reorder widget"
        />
      )}
      {children}
    </div>
  );
}
interface ThemeProgressGoalRow {
  id: string;
  title: string;
  status: number | string;
  statusLabel: string;
  statusBg: string;
  storiesDone: number;
  storiesTotal: number;
  tasksDone: number;
  tasksTotal: number;
  pointsDone: number;
  pointsTotal: number;
  pointsProgressPct: number;
  progressPct: number;
  dueDateMs: number | null;
  dueThisSprint: boolean;
  savingsSavedPence: number;
  savingsTarget: number;
  savingsCurrency: string;
}
interface ThemeProgressRow {
  themeKey: string;
  themeId: number;
  themeLabel: string;
  color: string;
  textColor: string;
  goalsDone: number;
  goalsTotal: number;
  storiesDone: number;
  storiesTotal: number;
  tasksDone: number;
  tasksTotal: number;
  pointsDone: number;
  pointsTotal: number;
  completedItems: number;
  totalItems: number;
  progressPct: number;
  goalRows: ThemeProgressGoalRow[];
  savingsSavedPence: number;
  savingsTarget: number;
  savingsCurrency: string;
}
interface DailyCompletionTrendPoint {
  dayKey: string;
  label: string;
  totalDue: number;
  totalCompleted: number;
  totalPct: number;
  storyDue: number;
  storyCompleted: number;
  storyPct: number;
  taskDue: number;
  taskCompleted: number;
  taskPct: number;
  choreDue: number;
  choreCompleted: number;
  chorePct: number;
}
const TODAY_PLAN_DEFAULT_WIDTHS: TodayPlanColumnWidths = {
  summary: 24,
  calendar: 31,
  due: 25,
  chores: 20,
};
const TODAY_PLAN_MIN_WIDTHS: TodayPlanColumnWidths = {
  summary: 16,
  calendar: 20,
  due: 18,
  chores: 14,
};
const LOW_HANGING_MAX_POINTS = 0.25;
const LOW_HANGING_MIN_STALE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
type DayTimelineBucket = 'morning' | 'afternoon' | 'evening';
const DAY_TIMELINE_BUCKETS: Array<{ key: DayTimelineBucket; label: string; range: string }> = [
  { key: 'morning', label: 'Morning', range: '05:00 - 12:59' },
  { key: 'afternoon', label: 'Afternoon', range: '13:00 - 18:59' },
  { key: 'evening', label: 'Evening', range: '19:00 - 04:59' },
];

const normalizeTimelineText = (value: string | null | undefined) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const bucketFromMinutes = (minutes: number): DayTimelineBucket => {
  if (minutes >= 300 && minutes <= 779) return 'morning';
  if (minutes >= 780 && minutes <= 1139) return 'afternoon';
  return 'evening';
};

const bucketFromTimeOfDay = (value: string | null | undefined): DayTimelineBucket | null => {
  const normalized = String(value || '').toLowerCase().trim();
  if (normalized === 'morning') return 'morning';
  if (normalized === 'afternoon') return 'afternoon';
  if (normalized === 'evening') return 'evening';
  return null;
};

const isTaskDoneState = (status: any): boolean => {
  if (typeof status === 'number') {
    // Task statuses are normally 0=todo, 1=doing, 2=done, 3=blocked.
    // Treat legacy/story-style values >=4 as complete as well.
    return status === 2 || status >= 4;
  }
  const normalized = String(status ?? '').trim().toLowerCase();
  return ['done', 'complete', 'completed', 'finished', 'closed'].includes(normalized);
};

const isStoryDoneState = (status: any): boolean => {
  if (typeof status === 'number') return status >= 4;
  const normalized = String(status ?? '').trim().toLowerCase();
  return ['done', 'complete', 'completed', 'finished', 'closed', 'archived'].includes(normalized);
};

const isGoalDoneState = (status: any): boolean => {
  if (typeof status === 'number') return status >= 2;
  const normalized = String(status ?? '').trim().toLowerCase();
  return ['done', 'complete', 'completed', 'finished', 'closed', 'archived'].includes(normalized);
};

const getNextWorkBadge = (status: string | null | undefined) => {
  switch (status) {
    case 'current_block':
      return { bg: 'success', label: 'Now' };
    case 'upcoming_block':
      return { bg: 'primary', label: 'Queued' };
    case 'after_busy_event':
      return { bg: 'warning', label: 'After calendar' };
    case 'top3':
      return { bg: 'info', label: 'Top 3' };
    case 'ai_score':
      return { bg: 'secondary', label: 'AI score' };
    default:
      return { bg: 'secondary', label: 'Next' };
  }
};

const roundToSingleDecimal = (value: number) => Math.round(value * 10) / 10;

const normalizeTodayPlanWidths = (candidate: Record<string, unknown> | null | undefined): TodayPlanColumnWidths | null => {
  if (!candidate) return null;
  const parsed = TODAY_PLAN_COLUMN_KEYS.reduce((acc, key) => {
    const raw = Number(candidate[key]);
    acc[key] = Number.isFinite(raw) ? raw : NaN;
    return acc;
  }, {} as TodayPlanColumnWidths);
  const hasInvalid = TODAY_PLAN_COLUMN_KEYS.some((key) => !Number.isFinite(parsed[key]) || parsed[key] <= 0);
  if (hasInvalid) return null;

  const total = TODAY_PLAN_COLUMN_KEYS.reduce((sum, key) => sum + parsed[key], 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  const normalized = TODAY_PLAN_COLUMN_KEYS.reduce((acc, key) => {
    acc[key] = roundToSingleDecimal((parsed[key] / total) * 100);
    return acc;
  }, {} as TodayPlanColumnWidths);

  const minViolation = TODAY_PLAN_COLUMN_KEYS.some((key) => normalized[key] < TODAY_PLAN_MIN_WIDTHS[key]);
  if (minViolation) return null;

  const subtotalWithoutLast = TODAY_PLAN_COLUMN_KEYS.slice(0, -1).reduce((sum, key) => sum + normalized[key], 0);
  const lastKey = TODAY_PLAN_COLUMN_KEYS[TODAY_PLAN_COLUMN_KEYS.length - 1];
  normalized[lastKey] = roundToSingleDecimal(100 - subtotalWithoutLast);
  if (normalized[lastKey] < TODAY_PLAN_MIN_WIDTHS[lastKey]) return null;

  return normalized;
};

const readTodayPlanWidthsFromStorage = (): TodayPlanColumnWidths => {
  if (typeof window === 'undefined') return TODAY_PLAN_DEFAULT_WIDTHS;
  try {
    const stored = window.localStorage.getItem(TODAY_PLAN_COLUMN_STORAGE_KEY);
    if (!stored) return TODAY_PLAN_DEFAULT_WIDTHS;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return normalizeTodayPlanWidths(parsed) ?? TODAY_PLAN_DEFAULT_WIDTHS;
  } catch {
    return TODAY_PLAN_DEFAULT_WIDTHS;
  }
};

const areTodayPlanWidthsEqual = (a: TodayPlanColumnWidths | null | undefined, b: TodayPlanColumnWidths | null | undefined): boolean => {
  if (!a || !b) return false;
  return TODAY_PLAN_COLUMN_KEYS.every((key) => Math.abs((a[key] ?? 0) - (b[key] ?? 0)) < 0.01);
};

const DASHBOARD_WIDGET_CONFIG: Array<{ key: DashboardWidgetKey; label: string }> = [
  { key: 'lowHangingFruit', label: 'Low hanging fruit' },
  { key: 'dailySummary', label: 'Daily summary' },
  { key: 'top3', label: 'Top 3 priorities' },
  { key: 'themeProgress', label: 'Theme progress' },
  { key: 'kpiStudio', label: 'Pinned focus KPIs' },
  { key: 'unifiedTimeline', label: 'Daily Plan' },
  { key: 'tasksDueToday', label: 'Tasks due today' },
  { key: 'choresHabits', label: 'Chores & habits' },
  { key: 'calendar', label: 'Calendar (mini)' },
  { key: 'recoveryMetrics', label: 'Recovery (HRV, Sleep, Calories)' },
  { key: 'activityMetrics', label: 'Activity (Steps + HRV trend)' },
  { key: 'fitnessMetrics', label: 'Fitness (Run / Swim / Bike)' },
  { key: 'sprintVelocity', label: 'Sprint velocity + Theme rings' },
];

const DASHBOARD_WIDGET_DEFAULT_VISIBILITY: DashboardWidgetVisibility = {
  lowHangingFruit: false,
  dailySummary: true,
  top3: true,
  themeProgress: false,
  kpiStudio: true,
  unifiedTimeline: true,
  tasksDueToday: false,
  choresHabits: true,
  calendar: false,
  recoveryMetrics: false,
  activityMetrics: false,
  fitnessMetrics: false,
  sprintVelocity: false,
};

const getDashboardDeviceType = (): DashboardDeviceType => {
  if (typeof window === 'undefined') return 'desktop';
  const width = window.innerWidth;
  if (width < 768) return 'mobile';
  if (width < TODAY_PLAN_DESKTOP_BREAKPOINT) return 'tablet';
  return 'desktop';
};

const dashboardWidgetVisibilityStorageKey = (deviceType: DashboardDeviceType) =>
  `${DASHBOARD_WIDGET_VISIBILITY_STORAGE_PREFIX}_${deviceType}`;
const dashboardWidgetSizeStorageKey = (deviceType: DashboardDeviceType) =>
  `${DASHBOARD_WIDGET_SIZE_STORAGE_PREFIX}_${deviceType}`;

const readDashboardWidgetVisibility = (deviceType: DashboardDeviceType): DashboardWidgetVisibility => {
  if (typeof window === 'undefined') return DASHBOARD_WIDGET_DEFAULT_VISIBILITY;
  try {
    const stored = window.localStorage.getItem(dashboardWidgetVisibilityStorageKey(deviceType));
    if (!stored) return DASHBOARD_WIDGET_DEFAULT_VISIBILITY;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const next = { ...DASHBOARD_WIDGET_DEFAULT_VISIBILITY };
    DASHBOARD_WIDGET_CONFIG.forEach(({ key }) => {
      if (typeof parsed[key] === 'boolean') {
        next[key] = parsed[key] as boolean;
      }
    });
    return next;
  } catch {
    return DASHBOARD_WIDGET_DEFAULT_VISIBILITY;
  }
};

const readDashboardWidgetSizes = (deviceType: DashboardDeviceType): DashboardWidgetSizes => {
  if (typeof window === 'undefined') return {};
  try {
    const stored = window.localStorage.getItem(dashboardWidgetSizeStorageKey(deviceType));
    if (!stored) return {};
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const next: DashboardWidgetSizes = {};
    DASHBOARD_WIDGET_CONFIG.forEach(({ key }) => {
      const value = parsed[key] as Record<string, unknown> | undefined;
      const width = Number(value?.width);
      const height = Number(value?.height);
      if (Number.isFinite(width) && width > 140 && Number.isFinite(height) && height > 140) {
        next[key] = {
          width: Math.round(width),
          height: Math.round(height),
        };
      }
    });
    return next;
  } catch {
    return {};
  }
};

const extractMonzoAmountPence = (tx: any): number => {
  if (Number.isFinite(tx?.amountMinor)) return Number(tx.amountMinor);
  const raw = Number(tx?.amount || 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.abs(raw) < 10 ? Math.round(raw * 100) : Math.round(raw);
};

const resolveMonzoBucket = (tx: any): string => {
  const raw = tx?.aiBucket ?? tx?.userCategoryType ?? tx?.defaultCategoryType ?? tx?.categoryType ?? tx?.category ?? 'unknown';
  const bucket = String(raw || '').toLowerCase();
  return bucket === 'optional' ? 'discretionary' : bucket;
};

const Dashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
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
  const [openTasksPool, setOpenTasksPool] = useState<Task[]>([]);
  const [personaTasksPool, setPersonaTasksPool] = useState<Task[]>([]);
  const [personaStoriesPool, setPersonaStoriesPool] = useState<Story[]>([]);
  const [tasksDueTodayLoading, setTasksDueTodayLoading] = useState(false);
  const [tasksDueTodaySortMode, setTasksDueTodaySortMode] = useState<'due' | 'ai' | 'top3'>('ai');
  const [top3Collapsed, setTop3Collapsed] = useState(false);
  const [top3Tasks, setTop3Tasks] = useState<Task[]>([]);
  const [top3Stories, setTop3Stories] = useState<Story[]>([]);
  const [top3Loading, setTop3Loading] = useState(false);
  const [unscheduledToday, setUnscheduledToday] = useState<ScheduledInstanceModel[]>([]);
  const [inlineEditTask, setInlineEditTask] = useState<Task | null>(null);
  const [inlineEditStory, setInlineEditStory] = useState<Story | null>(null);
  const [replanLoading, setReplanLoading] = useState(false);
  const [fullReplanLoading, setFullReplanLoading] = useState(false);
  const [replanFeedback, setReplanFeedback] = useState<string | null>(null);
  const [nextWorkRecommendation, setNextWorkRecommendation] = useState<NextWorkRecommendation | null>(null);
  const [nextWorkLoading, setNextWorkLoading] = useState(false);
  const [nextWorkError, setNextWorkError] = useState<string | null>(null);
  const [eveningPullForward, setEveningPullForward] = useState<EveningPullForwardSuggestion | null>(null);
  const [eveningPullForwardBusyId, setEveningPullForwardBusyId] = useState<string | null>(null);
  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month'>('day');
  const [calendarDate, setCalendarDate] = useState<Date>(startOfDay(new Date()));
  const [calendarScrollTime, setCalendarScrollTime] = useState<Date>(() => {
    const now = new Date();
    return new Date(1970, 0, 1, now.getHours(), now.getMinutes(), 0);
  });
  const [timelineNowMs, setTimelineNowMs] = useState<number>(() => Date.now());
  const [remindersDueToday, setRemindersDueToday] = useState<ReminderItem[]>([]);
  const [choresDueToday, setChoresDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [routinesDueToday, setRoutinesDueToday] = useState<ChecklistSnapshotItem[]>([]);
  const [monzoSummary, setMonzoSummary] = useState<MonzoSummary | null>(null);
  const [financeWindowSummary, setFinanceWindowSummary] = useState<FinanceWindowSummary | null>(null);
  const [monzoIntegrationStatus, setMonzoIntegrationStatus] = useState<any | null>(null);
  const [monzoReconnectBusy, setMonzoReconnectBusy] = useState(false);
  const [monzoReconnectMsg, setMonzoReconnectMsg] = useState<string | null>(null);
  const [fitnessOverviewSnapshot, setFitnessOverviewSnapshot] = useState<any | null>(null);
  const [runAnalysisSnapshot, setRunAnalysisSnapshot] = useState<any | null>(null);
  const [fitnessTrendSummary, setFitnessTrendSummary] = useState<FitnessTrendSummary | null>(null);
  const [financeTrendSummary, setFinanceTrendSummary] = useState<FinanceTrendSummary | null>(null);
  const [runwaySortMode, setRunwaySortMode] = useState<'soonest' | 'shortfall' | 'theme'>('soonest');
  const [runwayThemeFilter, setRunwayThemeFilter] = useState<string>('all');
  const [weeklySummary, setWeeklySummary] = useState<{ total: number; byType: Record<string, number> } | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [sprintStories, setSprintStories] = useState<Story[]>([]);
  const [sprintTasks, setSprintTasks] = useState<Task[]>([]);
  const [sprintGoals, setSprintGoals] = useState<Goal[]>([]);
  const [activeFocusGoalIds, setActiveFocusGoalIds] = useState<Set<string>>(new Set());
  const [strictAlignmentViolations, setStrictAlignmentViolations] = useState<{ last24h: number; last7d: number; lastViolationAt: number | null }>({
    last24h: 0,
    last7d: 0,
    lastViolationAt: null,
  });
  const [selectedSprintAuditSnapshot, setSelectedSprintAuditSnapshot] = useState<{ unalignedStories: number; alignmentPct: number; updatedAtMs: number | null } | null>(null);
  const [goalsList, setGoalsList] = useState<Goal[]>([]);
  const [potsById, setPotsById] = useState<Record<string, { name: string; balance: number; currency: string }>>({});
  const [dailySummaryLines, setDailySummaryLines] = useState<string[]>([]);
  const [dailySummarySource, setDailySummarySource] = useState<string | null>(null);
  const [dailyActiveSignals, setDailyActiveSignals] = useState<DailyActiveSignal[]>([]);
  const [prioritySource, setPrioritySource] = useState<string | null>(null);
  const [aiFocusItems, setAiFocusItems] = useState<any[]>([]);
  const [metricsCollapsed, setMetricsCollapsed] = useState<boolean>(true);
  const [dailyCompletionTrendExpanded, setDailyCompletionTrendExpanded] = useState<boolean>(false);
  const [capacityData, setCapacityData] = useState<any | null>(null);
  const [capacityLoading, setCapacityLoading] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [profileSnapshot, setProfileSnapshot] = useState<any | null>(null);
  const [showHealthBanner, setShowHealthBanner] = useState(true);
  const [choreCompletionBusy, setChoreCompletionBusy] = useState<Record<string, boolean>>({});
  const [showWidgetSettings, setShowWidgetSettings] = useState(false);
  const [dashboardDeviceType, setDashboardDeviceType] = useState<DashboardDeviceType>(() => getDashboardDeviceType());
  const [widgetVisibility, setWidgetVisibility] = useState<DashboardWidgetVisibility>(() =>
    readDashboardWidgetVisibility(getDashboardDeviceType())
  );
  const [widgetSizes, setWidgetSizes] = useState<DashboardWidgetSizes>(() =>
    readDashboardWidgetSizes(getDashboardDeviceType())
  );
  const [widgetOrder, setWidgetOrder] = useState<DashboardWidgetKey[]>(() =>
    readDashboardWidgetOrder(getDashboardDeviceType())
  );
  const [themeProgressExpanded, setThemeProgressExpanded] = useState<Record<string, boolean>>({});
  const [todayPlanColumnWidths, setTodayPlanColumnWidths] = useState<TodayPlanColumnWidths>(() => readTodayPlanWidthsFromStorage());
  const [todayPlanDesktopMode, setTodayPlanDesktopMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth >= TODAY_PLAN_DESKTOP_BREAKPOINT;
  });
  const todayPlanLayoutRef = useRef<HTMLDivElement | null>(null);
  const todayPlanDragRef = useRef<{
    leftKey: TodayPlanColumnKey;
    rightKey: TodayPlanColumnKey;
    startX: number;
    containerWidth: number;
    startWidths: TodayPlanColumnWidths;
  } | null>(null);
  const widgetGridRef = useRef<HTMLDivElement | null>(null);
  const timelineScrollBodyRef = useRef<HTMLDivElement | null>(null);
  const timelineNowMarkerRef = useRef<HTMLDivElement | null>(null);
  const widgetResizeDragRef = useRef<{
    key: DashboardWidgetKey;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    maxWidth: number;
    minWidth: number;
    minHeight: number;
    maxHeight: number;
    fromLeft?: boolean;
    fromRight?: boolean;
    fromTop?: boolean;
    fromBottom?: boolean;
  } | null>(null);
  const [widgetEditMode, setWidgetEditMode] = useState(false);
  const dashboardDeviceTypeRef = useRef(dashboardDeviceType);
  const showPersistentDashboardBanners = dashboardDeviceType !== 'mobile';

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

  const nextSprint = useMemo(() => {
    const currentEndMs = decodeToDate(selectedSprint?.endDate)?.getTime() || Date.now();
    return [...sprints]
      .filter((sprint) => String(sprint.id || '') !== String(selectedSprint?.id || ''))
      .map((sprint) => ({
        sprint,
        startMs: decodeToDate(sprint.startDate)?.getTime() || 0,
      }))
      .filter((row) => row.startMs > currentEndMs)
      .sort((a, b) => a.startMs - b.startMs)[0]?.sprint || null;
  }, [decodeToDate, selectedSprint, sprints]);

  const formatPotBalance = useCallback((value: number, currency = 'GBP') => {
    const minor = Number(value || 0);
    const pounds = minor / 100;
    return pounds.toLocaleString('en-GB', { style: 'currency', currency });
  }, []);

  const formatPenceCompact = useCallback((pence: number, currency = 'GBP') => {
    const pounds = Number(pence || 0) / 100;
    return pounds.toLocaleString('en-GB', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    });
  }, []);

  const formatSecondsDisplay = useCallback((seconds: number | null | undefined) => {
    const total = Number(seconds);
    if (!Number.isFinite(total) || total <= 0) return '—';
    const rounded = Math.max(0, Math.round(total));
    const h = Math.floor(rounded / 3600);
    const m = Math.floor((rounded % 3600) / 60);
    const s = rounded % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }, []);

  const lowerBetterTrendArrow = useCallback((delta: number | null | undefined) => {
    const val = Number(delta);
    if (!Number.isFinite(val) || Math.abs(val) < 0.001) {
      return <span className="text-muted ms-1">→</span>;
    }
    if (val > 0) {
      return <span className="text-danger ms-1">↑</span>;
    }
    return <span className="text-success ms-1">↓</span>;
  }, []);

  const workoutHasDadMarker = useCallback((data: any) => {
    const text = `${String(data?.title || '')} ${String(data?.name || '')} ${String(data?.event || '')}`.toLowerCase();
    return /\bdad\b/i.test(text);
  }, []);

  const resolveWorkoutStartMs = useCallback((data: any) => {
    const direct = Number(data?.startDate || 0);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const parsed = Date.parse(String(data?.utcStartDate || ''));
    return Number.isFinite(parsed) ? parsed : 0;
  }, []);

  const classifyWorkoutSport = useCallback((data: any): 'run' | 'swim' | 'bike' | 'other' => {
    if (!data) return 'other';
    if (String(data.provider || '').toLowerCase() === 'parkrun') return 'run';
    if (data.run === true) return 'run';
    const type = String(data.type || data.sportType || '').toLowerCase();
    if (type.includes('swim')) return 'swim';
    if (type.includes('ride') || type.includes('bike') || type.includes('cycling')) return 'bike';
    if (type.includes('run') || type.includes('walk') || type.includes('hike')) return 'run';
    return 'other';
  }, []);

  const estimateEquivalentRaceSeconds = useCallback((
    distanceKm: number,
    timeSec: number,
    targetKm: number,
    options: { minKm?: number; maxKm?: number; exponent?: number } = {},
  ) => {
    const {
      minKm = 0.2,
      maxKm = 250,
      exponent = 1.06,
    } = options;
    if (!Number.isFinite(distanceKm) || !Number.isFinite(timeSec) || distanceKm <= 0 || timeSec <= 0) return null;
    if (distanceKm < minKm || distanceKm > maxKm) return null;
    return timeSec * Math.pow(targetKm / distanceKm, exponent);
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

  const todayPlanColumnStyle = useCallback((key: TodayPlanColumnKey): React.CSSProperties | undefined => {
    if (!todayPlanDesktopMode) return undefined;
    return {
      width: `${todayPlanColumnWidths[key]}%`,
    };
  }, [todayPlanColumnWidths, todayPlanDesktopMode]);

  const beginTodayPlanResize = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, leftKey: TodayPlanColumnKey, rightKey: TodayPlanColumnKey) => {
      if (!todayPlanDesktopMode) return;
      const containerWidth = todayPlanLayoutRef.current?.getBoundingClientRect().width ?? 0;
      if (!containerWidth) return;
      event.preventDefault();
      todayPlanDragRef.current = {
        leftKey,
        rightKey,
        startX: event.clientX,
        containerWidth,
        startWidths: todayPlanColumnWidths,
      };
      document.body.classList.add('today-plan-resizing');
    },
    [todayPlanColumnWidths, todayPlanDesktopMode],
  );

  // No-op ref callback — kept for call-site compatibility; size is tracked via widgetSizes state
  const setWidgetResizeContainer = useCallback(
    (_key: DashboardWidgetKey) => (_node: HTMLDivElement | null) => { /* no-op */ },
    [],
  );

  // Returns height style only; width is applied on the SortableDashboardWidget outer div
  const getWidgetSizeStyle = useCallback(
    (key: DashboardWidgetKey, minHeight: number): React.CSSProperties => {
      const size = widgetSizes[key];
      if (!size) return { minHeight: `${minHeight}px` };
      return { height: `${size.height}px`, minHeight: `${minHeight}px`, overflowY: 'auto' };
    },
    [widgetSizes],
  );

  // Unified resize start — direction flags determine which axis/side moves
  const beginResize = useCallback(
    (
      event: React.PointerEvent<HTMLButtonElement>,
      key: DashboardWidgetKey,
      dirs: { fromLeft?: boolean; fromRight?: boolean; fromTop?: boolean; fromBottom?: boolean },
    ) => {
      if (!widgetEditMode) return;
      const gridEl = widgetGridRef.current ?? document.querySelector('.dashboard-widget-grid');
      const gridRect = gridEl?.getBoundingClientRect();
      const maxWidth = Math.max(280, Math.floor(gridRect?.width ?? (window.innerWidth - 60)));
      const currentSize = widgetSizes[key];
      const startWidth = currentSize?.width ?? Math.max(300, Math.floor(maxWidth / 2));
      const startHeight = currentSize?.height ?? 400;
      event.preventDefault();
      event.stopPropagation();
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* ignore */ }
      widgetResizeDragRef.current = {
        key,
        startX: event.clientX,
        startY: event.clientY,
        startWidth,
        startHeight,
        maxWidth,
        minWidth: 220,
        minHeight: 100,
        maxHeight: Math.floor(window.innerHeight * 0.95),
        ...dirs,
      };
      document.body.classList.add('dashboard-widget-resizing');
    },
    [widgetEditMode, widgetSizes],
  );

  // Kept for call-site compatibility — now a no-op (corners covered by renderWidgetEdgeHandles)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const renderWidgetResizeHandle = useCallback((_key: DashboardWidgetKey, _minH: number, _label: string) => null, []);

  const renderWidgetEdgeHandles = useCallback(
    (key: DashboardWidgetKey) => {
      if (!widgetEditMode) return null;
      return (
        <>
          {/* Edge handles */}
          <button type="button" className="dashboard-widget-resize-left"
            onPointerDown={(e) => beginResize(e, key, { fromLeft: true })} aria-label="Resize left" />
          <button type="button" className="dashboard-widget-resize-right"
            onPointerDown={(e) => beginResize(e, key, { fromRight: true })} aria-label="Resize right" />
          <button type="button" className="dashboard-widget-resize-top"
            onPointerDown={(e) => beginResize(e, key, { fromTop: true })} aria-label="Resize top" />
          <button type="button" className="dashboard-widget-resize-bottom"
            onPointerDown={(e) => beginResize(e, key, { fromBottom: true })} aria-label="Resize bottom" />
          {/* Corner handles */}
          <button type="button" className="dashboard-widget-resize-nw"
            onPointerDown={(e) => beginResize(e, key, { fromTop: true, fromLeft: true })} aria-label="Resize top-left" />
          <button type="button" className="dashboard-widget-resize-ne"
            onPointerDown={(e) => beginResize(e, key, { fromTop: true, fromRight: true })} aria-label="Resize top-right" />
          <button type="button" className="dashboard-widget-resize-sw"
            onPointerDown={(e) => beginResize(e, key, { fromBottom: true, fromLeft: true })} aria-label="Resize bottom-left" />
          <button type="button" className="dashboard-widget-resize-se"
            onPointerDown={(e) => beginResize(e, key, { fromBottom: true, fromRight: true })} aria-label="Resize bottom-right" />
        </>
      );
    },
    [beginResize, widgetEditMode],
  );

  const widgetDndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleWidgetDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setWidgetOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as DashboardWidgetKey);
      const newIndex = prev.indexOf(over.id as DashboardWidgetKey);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = arrayMove(prev, oldIndex, newIndex);
      try { window.localStorage.setItem(dashboardWidgetOrderStorageKey(dashboardDeviceType), JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, [dashboardDeviceType]);

  const toggleWidgetVisibility = useCallback((key: DashboardWidgetKey) => {
    setWidgetVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleThemeProgressExpanded = useCallback((key: string) => {
    setThemeProgressExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleResize = () => {
      setTodayPlanDesktopMode(window.innerWidth >= TODAY_PLAN_DESKTOP_BREAKPOINT);
      setDashboardDeviceType(getDashboardDeviceType());
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setWidgetVisibility(readDashboardWidgetVisibility(dashboardDeviceType));
  }, [dashboardDeviceType]);

  useEffect(() => {
    setWidgetSizes(readDashboardWidgetSizes(dashboardDeviceType));
  }, [dashboardDeviceType]);

  useEffect(() => {
    dashboardDeviceTypeRef.current = dashboardDeviceType;
    setWidgetOrder(readDashboardWidgetOrder(dashboardDeviceType));
  }, [dashboardDeviceType]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TODAY_PLAN_COLUMN_STORAGE_KEY, JSON.stringify(todayPlanColumnWidths));
    } catch {
      // Ignore storage quota and privacy-mode write failures.
    }
  }, [todayPlanColumnWidths]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        dashboardWidgetVisibilityStorageKey(dashboardDeviceType),
        JSON.stringify(widgetVisibility),
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [dashboardDeviceType, widgetVisibility]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        dashboardWidgetSizeStorageKey(dashboardDeviceType),
        JSON.stringify(widgetSizes),
      );
    } catch {
      // Ignore storage write failures.
    }
  }, [dashboardDeviceType, widgetSizes]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handleMouseMove = (event: MouseEvent) => {
      const dragState = todayPlanDragRef.current;
      if (!dragState) return;
      event.preventDefault();

      const deltaPercent = ((event.clientX - dragState.startX) / dragState.containerWidth) * 100;
      const pairTotal = dragState.startWidths[dragState.leftKey] + dragState.startWidths[dragState.rightKey];
      const minLeft = TODAY_PLAN_MIN_WIDTHS[dragState.leftKey];
      const minRight = TODAY_PLAN_MIN_WIDTHS[dragState.rightKey];
      const maxLeft = pairTotal - minRight;
      const nextLeft = Math.min(maxLeft, Math.max(minLeft, dragState.startWidths[dragState.leftKey] + deltaPercent));
      const nextRight = pairTotal - nextLeft;

      const nextWidths: TodayPlanColumnWidths = {
        ...dragState.startWidths,
        [dragState.leftKey]: roundToSingleDecimal(nextLeft),
        [dragState.rightKey]: roundToSingleDecimal(nextRight),
      };

      const totalWithoutLast = TODAY_PLAN_COLUMN_KEYS.slice(0, -1).reduce((sum, key) => sum + nextWidths[key], 0);
      const lastKey = TODAY_PLAN_COLUMN_KEYS[TODAY_PLAN_COLUMN_KEYS.length - 1];
      nextWidths[lastKey] = roundToSingleDecimal(100 - totalWithoutLast);

      setTodayPlanColumnWidths(nextWidths);
    };

    const stopDrag = () => {
      if (!todayPlanDragRef.current) return;
      todayPlanDragRef.current = null;
      document.body.classList.remove('today-plan-resizing');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', stopDrag);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      document.body.classList.remove('today-plan-resizing');
    };
  }, []);

  // Compute default pixel sizes on first mount if nothing is stored yet
  useEffect(() => {
    if (Object.keys(widgetSizes).length > 0) return;
    const grid = widgetGridRef.current;
    const gridWidth = grid ? grid.getBoundingClientRect().width : window.innerWidth - 80;
    if (gridWidth < 300) return;
    const gap = 4;
    // Keep the top summary widgets visually aligned by default while preserving relative widths.
    const threeQuarter = Math.max(400, Math.floor((gridWidth - gap) * 0.75));
    const quarter = Math.max(220, Math.floor((gridWidth - gap) * 0.25));
    const third = Math.max(240, Math.floor((gridWidth - gap * 2) / 3));
    setWidgetSizes({
      unifiedTimeline: { width: threeQuarter, height: 420 },
      top3: { width: quarter, height: 420 },
      dailySummary: { width: third, height: 420 },
      kpiStudio: { width: third, height: 420 },
      choresHabits: { width: third, height: 420 },
      lowHangingFruit: { width: third, height: 400 },
      themeProgress: { width: third, height: 400 },
      tasksDueToday: { width: third, height: 400 },
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const handlePointerMove = (event: PointerEvent) => {
      const d = widgetResizeDragRef.current;
      if (!d) return;
      event.preventDefault();
      const dx = event.clientX - d.startX;
      const dy = event.clientY - d.startY;
      const newWidth = d.fromLeft ? d.startWidth - dx : d.fromRight ? d.startWidth + dx : d.startWidth;
      const newHeight = d.fromTop ? d.startHeight - dy : d.fromBottom ? d.startHeight + dy : d.startHeight;
      const resizingH = d.fromLeft || d.fromRight;
      const resizingV = d.fromTop || d.fromBottom;
      const clampedWidth = resizingH
        ? Math.max(d.minWidth, Math.min(d.maxWidth, newWidth))
        : d.startWidth;
      const clampedHeight = resizingV
        ? Math.max(d.minHeight, Math.min(d.maxHeight, newHeight))
        : d.startHeight;
      setWidgetSizes((prev) => ({
        ...prev,
        [d.key]: { width: Math.round(clampedWidth), height: Math.round(clampedHeight) },
      }));
    };

    const stopPointerResize = () => {
      if (!widgetResizeDragRef.current) return;
      widgetResizeDragRef.current = null;
      document.body.classList.remove('dashboard-widget-resizing');
    };

    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', stopPointerResize);
    window.addEventListener('pointercancel', stopPointerResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopPointerResize);
      window.removeEventListener('pointercancel', stopPointerResize);
      document.body.classList.remove('dashboard-widget-resizing');
    };
  }, []);

  const monzoLastSyncDate = useMemo(() => {
    const candidates = [
      decodeToDate(
        monzoIntegrationStatus?.lastSyncAt
        ?? monzoIntegrationStatus?.lastSyncedAt
        ?? monzoIntegrationStatus?.lastSync,
      ),
      decodeToDate(profileSnapshot?.monzoLastSyncAt ?? profileSnapshot?.monzoLastSyncedAt),
      decodeToDate(monzoSummary?.updatedAt),
    ].filter((value): value is Date => value instanceof Date && !Number.isNaN(value.getTime()));

    if (candidates.length === 0) return null;
    return candidates.reduce((latest, current) => (
      current.getTime() > latest.getTime() ? current : latest
    ));
  }, [decodeToDate, monzoIntegrationStatus, monzoSummary?.updatedAt, profileSnapshot?.monzoLastSyncAt, profileSnapshot?.monzoLastSyncedAt]);

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

  const stravaConnected = !!profileSnapshot?.stravaConnected;
  const stravaLastSyncDate = useMemo(() => {
    if (!profileSnapshot) return null;
    return decodeToDate(
      profileSnapshot.stravaLastSyncAt
      ?? profileSnapshot.stravaLastSyncEpochMs
      ?? profileSnapshot.stravaLastSync,
    );
  }, [decodeToDate, profileSnapshot]);

  const stravaSyncAgeDays = useMemo(() => {
    if (!stravaLastSyncDate) return null;
    const diffMs = Date.now() - stravaLastSyncDate.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }, [stravaLastSyncDate]);

  const showStravaReconnectBanner = useMemo(() => {
    if (!stravaConnected || stravaSyncAgeDays == null) return false;
    return stravaSyncAgeDays >= 3;
  }, [stravaConnected, stravaSyncAgeDays]);

  const traktConnected = !!(profileSnapshot?.traktConnected || profileSnapshot?.traktUser);
  const traktLastSyncDate = useMemo(() => {
    if (!profileSnapshot) return null;
    return decodeToDate(
      profileSnapshot.traktLastSyncAt
      ?? profileSnapshot.traktLastSyncEpochMs
      ?? profileSnapshot.traktLastSync,
    );
  }, [decodeToDate, profileSnapshot]);

  const traktSyncAgeDays = useMemo(() => {
    if (!traktLastSyncDate) return null;
    const diffMs = Date.now() - traktLastSyncDate.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }, [traktLastSyncDate]);

  const showTraktReconnectBanner = useMemo(() => {
    if (!traktConnected || traktSyncAgeDays == null) return false;
    return traktSyncAgeDays >= INTEGRATION_STALE_DAYS;
  }, [traktConnected, traktSyncAgeDays]);

  const hardcoverConfigured = !!profileSnapshot?.hardcoverToken;
  const hardcoverLastSyncDate = useMemo(() => {
    if (!profileSnapshot) return null;
    return decodeToDate(
      profileSnapshot.hardcoverLastSyncAt
      ?? profileSnapshot.hardcoverLastSyncEpochMs
      ?? profileSnapshot.hardcoverLastSync,
    );
  }, [decodeToDate, profileSnapshot]);

  const hardcoverSyncAgeDays = useMemo(() => {
    if (!hardcoverLastSyncDate) return null;
    const diffMs = Date.now() - hardcoverLastSyncDate.getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }, [hardcoverLastSyncDate]);

  const showHardcoverReconnectBanner = useMemo(() => {
    if (!hardcoverConfigured || hardcoverSyncAgeDays == null) return false;
    return hardcoverSyncAgeDays >= INTEGRATION_STALE_DAYS;
  }, [hardcoverConfigured, hardcoverSyncAgeDays]);

  const healthBannerData = useMemo(() => {
    if (!profileSnapshot) return null;

    const readNumber = (...values: any[]): number | null => {
      for (const value of values) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      return null;
    };

    const stepsToday = readNumber(profileSnapshot.healthkitStepsToday, profileSnapshot.manualStepsToday);
    const distanceKmToday = readNumber(profileSnapshot.healthkitDistanceKmToday, profileSnapshot.manualDistanceKmToday);
    const workoutMinutesToday = readNumber(profileSnapshot.healthkitWorkoutMinutesToday, profileSnapshot.manualWorkoutMinutesToday);
    const proteinTodayG = readNumber(profileSnapshot.healthkitProteinTodayG, profileSnapshot.manualProteinTodayG);
    const fatTodayG = readNumber(profileSnapshot.healthkitFatTodayG, profileSnapshot.manualFatTodayG);
    const carbsTodayG = readNumber(profileSnapshot.healthkitCarbsTodayG, profileSnapshot.manualCarbsTodayG);
    const caloriesTodayKcal = readNumber(profileSnapshot.healthkitCaloriesTodayKcal, profileSnapshot.manualCaloriesTodayKcal);
    const weightKg = readNumber(profileSnapshot.healthkitWeightKg, profileSnapshot.manualWeightKg);
    const bodyFatPct = readNumber(profileSnapshot.healthkitBodyFatPct, profileSnapshot.manualBodyFatPct);
    const targetWeightKg = readNumber(profileSnapshot.targetWeightKg, profileSnapshot.healthTargetWeightKg);
    const targetBodyFatPct = readNumber(profileSnapshot.targetBodyFatPct, profileSnapshot.healthTargetBodyFatPct, profileSnapshot.bodyFatTarget);
    const targetProteinG = readNumber(profileSnapshot.targetProteinG, profileSnapshot.dailyProteinTargetG, profileSnapshot.healthTargetProteinG);
    const targetFatG = readNumber(profileSnapshot.targetFatG, profileSnapshot.dailyFatTargetG, profileSnapshot.healthTargetFatG);
    const targetCarbsG = readNumber(profileSnapshot.targetCarbsG, profileSnapshot.dailyCarbsTargetG, profileSnapshot.healthTargetCarbsG);
    const targetCaloriesKcal = readNumber(profileSnapshot.targetCaloriesKcal, profileSnapshot.dailyCaloriesTargetKcal, profileSnapshot.healthTargetCaloriesKcal);
    const weeksToTargetWeight = readNumber(profileSnapshot.weeksToTargetWeight);
    const weeksToTargetBodyFat = readNumber(profileSnapshot.weeksToTargetBodyFat);

    const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));
    const adherencePct = (actual: number | null, target: number | null): number | null => {
      if (actual == null || target == null || target <= 0) return null;
      return clampPct((actual / target) * 100);
    };
    const isWeekend = [0, 6].includes(new Date().getDay());
    const workoutTargetMinutes = Math.round((isWeekend ? 16 * 60 : 8 * 60) * 0.2);
    const bodyFatGoalPct = targetBodyFatPct ?? 15;
    const stepHabitTarget = 10000;
    const proteinPct = adherencePct(proteinTodayG, targetProteinG);
    const fatPct = adherencePct(fatTodayG, targetFatG);
    const carbsPct = adherencePct(carbsTodayG, targetCarbsG);
    const caloriesPct = adherencePct(caloriesTodayKcal, targetCaloriesKcal);
    const macroComponents = [proteinPct, fatPct, carbsPct, caloriesPct].filter((value): value is number => value != null);
    const macroAdherencePct = macroComponents.length
      ? Math.round(macroComponents.reduce((sum, value) => sum + value, 0) / macroComponents.length)
      : null;

    const macroTone = macroAdherencePct == null ? 'secondary' : macroAdherencePct >= 80 ? 'success' : macroAdherencePct >= 60 ? 'warning' : 'danger';
    const bodyFatGoalProgressPct = bodyFatPct == null
      ? null
      : (bodyFatPct <= bodyFatGoalPct ? 100 : 0);
    const primaryProgressPct = bodyFatGoalProgressPct ?? macroAdherencePct ?? null;
    const primaryProgressLabel = bodyFatGoalProgressPct != null
      ? `Body fat target ${bodyFatGoalPct}%`
      : (macroAdherencePct != null ? 'Macro adherence' : 'Health progress');
    const missingTargets = targetWeightKg == null || targetBodyFatPct == null;

    return {
      sourceLabel: ['authorized', 'synced'].includes(String(profileSnapshot.healthkitStatus || '').toLowerCase()) ? 'HealthKit' : 'Manual',
      stepsToday,
      distanceKmToday,
      workoutMinutesToday,
      proteinTodayG,
      fatTodayG,
      carbsTodayG,
      caloriesTodayKcal,
      weightKg,
      bodyFatPct,
      targetWeightKg,
      targetBodyFatPct,
      targetProteinG,
      targetFatG,
      targetCarbsG,
      targetCaloriesKcal,
      weeksToTargetWeight,
      weeksToTargetBodyFat,
      stepPct: stepsToday == null ? null : clampPct((stepsToday / 12000) * 100),
      stepHabitTarget,
      stepHabitPct: stepsToday == null ? null : clampPct((stepsToday / stepHabitTarget) * 100),
      distancePct: distanceKmToday == null ? null : clampPct((distanceKmToday / 5) * 100),
      workoutPct: workoutMinutesToday == null ? null : clampPct((workoutMinutesToday / workoutTargetMinutes) * 100),
      macroAdherencePct,
      macroTone,
      bodyFatGoalPct,
      bodyFatGoalProgressPct,
      primaryProgressPct,
      primaryProgressLabel,
      missingTargets,
      workoutTargetMinutes,
    };
  }, [profileSnapshot]);

  useEffect(() => {
    try {
      const dismissedDate = window.localStorage.getItem(HEALTH_BANNER_DISMISS_KEY);
      if (dismissedDate) {
        const lastDismissed = new Date(dismissedDate);
        const now = new Date();
        const daysSinceDismiss = Math.floor((now.getTime() - lastDismissed.getTime()) / (1000 * 60 * 60 * 24));
        if (daysSinceDismiss < HEALTH_BANNER_SHOW_EVERY_DAYS) {
          setShowHealthBanner(false);
          return;
        }
      }
    } catch {
      // Ignore localStorage issues and keep the card visible.
    }
    setShowHealthBanner(true);
  }, []);

  const handleDismissHealthBanner = useCallback(() => {
    try {
      window.localStorage.setItem(HEALTH_BANNER_DISMISS_KEY, new Date().toISOString());
    } catch {
      // Ignore localStorage failures.
    }
    setShowHealthBanner(false);
  }, []);

  const rawFitnessScoreSummary = fitnessOverviewSnapshot?.fitnessScore
    ?? runAnalysisSnapshot?.fitnessScore
    ?? null;
  const parsedFitnessScoreSummary = rawFitnessScoreSummary == null
    ? null
    : Number(rawFitnessScoreSummary);
  const fitnessScoreSummary = Number.isFinite(parsedFitnessScoreSummary)
    ? parsedFitnessScoreSummary
    : null;
  const fitnessLevelSummary = fitnessOverviewSnapshot?.fitnessLevel || null;
  const predicted5kDisplay = fitnessTrendSummary?.predicted5kDisplay
    || fitnessOverviewSnapshot?.predictions?.fiveKDisplay
    || runAnalysisSnapshot?.predicted5kDisplay
    || null;
  const predicted10kDisplay = fitnessTrendSummary?.predicted10kDisplay
    || fitnessOverviewSnapshot?.predictions?.tenKDisplay
    || runAnalysisSnapshot?.predicted10kDisplay
    || null;
  const predictedHalfMarathonDisplay = fitnessTrendSummary?.predictedHalfMarathonDisplay
    || fitnessOverviewSnapshot?.predictions?.halfMarathonDisplay
    || null;
  const predictedSwim800Display = fitnessTrendSummary?.predictedSwim800Display
    || fitnessOverviewSnapshot?.predictions?.swim800mDisplay
    || null;
  const predictedBike50Display = fitnessTrendSummary?.predictedBike50Display
    || fitnessOverviewSnapshot?.predictions?.bike50kDisplay
    || fitnessOverviewSnapshot?.predictions?.bike30miDisplay
    || null;
  const avgRpe30Summary = fitnessOverviewSnapshot?.rpe?.avg30
    ?? runAnalysisSnapshot?.averagePairRpe
    ?? null;
  const avgRpe90 = fitnessTrendSummary?.avgRpe?.current ?? null;
  const avg5k90Sec = fitnessTrendSummary?.avg5kSec?.current ?? null;
  const avg10k90Sec = fitnessTrendSummary?.avg10kSec?.current ?? null;
  const avgRpe90Delta = fitnessTrendSummary?.avgRpe?.delta ?? null;
  const avg5k90Delta = fitnessTrendSummary?.avg5kSec?.delta ?? null;
  const avg10k90Delta = fitnessTrendSummary?.avg10kSec?.delta ?? null;
  const runDistanceYtdKm = fitnessTrendSummary?.runDistanceYtdKm ?? null;
  const swimDistanceYtdKm = fitnessTrendSummary?.swimDistanceYtdKm ?? null;
  const bikeDistanceYtdKm = fitnessTrendSummary?.bikeDistanceYtdKm ?? null;
  const financeDiscretionary90 = financeTrendSummary?.discretionaryPence?.current ?? null;
  const financeUncategorised90 = financeTrendSummary?.uncategorisedPence?.current ?? null;
  const financeDiscretionaryDelta = financeTrendSummary?.discretionaryPence?.delta ?? null;
  const financeUncategorisedDelta = financeTrendSummary?.uncategorisedPence?.delta ?? null;

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

  const profileTodayPlanWidths = useMemo(() => {
    const layout = profileSnapshot?.[PROFILE_OVERVIEW_LAYOUT_KEY];
    if (!layout || typeof layout !== 'object') return null;
    return normalizeTodayPlanWidths((layout as any)[PROFILE_TODAY_PLAN_COLUMNS_KEY] as Record<string, unknown> | null | undefined);
  }, [profileSnapshot]);

  useEffect(() => {
    if (!profileTodayPlanWidths) return;
    setTodayPlanColumnWidths((current) => (
      areTodayPlanWidthsEqual(current, profileTodayPlanWidths) ? current : profileTodayPlanWidths
    ));
  }, [profileTodayPlanWidths]);

  useEffect(() => {
    if (!currentUser) return;
    if (profileTodayPlanWidths && areTodayPlanWidthsEqual(todayPlanColumnWidths, profileTodayPlanWidths)) return;

    const timeoutId = window.setTimeout(async () => {
      try {
        await setDoc(
          doc(db, 'profiles', currentUser.uid),
          {
            [PROFILE_OVERVIEW_LAYOUT_KEY]: {
              [PROFILE_TODAY_PLAN_COLUMNS_KEY]: todayPlanColumnWidths,
              updatedAt: serverTimestamp(),
            },
          },
          { merge: true },
        );
      } catch (error) {
        console.warn('Failed to persist overview layout widths to profile', error);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [currentUser, profileTodayPlanWidths, todayPlanColumnWidths]);

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

  useEffect(() => {
    setTimelineNowMs(Date.now());
    const id = window.setInterval(() => setTimelineNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-scroll the Daily Plan widget to the current-time marker on load and each minute tick.
  useEffect(() => {
    const body = timelineScrollBodyRef.current;
    const marker = timelineNowMarkerRef.current;
    if (!body || !marker) return;
    const targetScroll = Math.max(0, marker.offsetTop - body.clientHeight * 0.3);
    body.scrollTo({ top: targetScroll, behavior: 'smooth' });
  }, [timelineNowMs]);

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
    const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
    const normalized = raw === 'habitual' ? 'habit' : raw;
    if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
    // If explicit type exists (task/read/watch/etc), do not infer chore-kind from tags.
    if (normalized) return null;
    const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
    const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
    if (tagKeys.includes('chore')) return 'chore';
    if (tagKeys.includes('routine')) return 'routine';
    if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
    return null;
  }, []);

  const getTaskQuickPoints = useCallback((task: Task): number | null => {
    const direct = Number((task as any)?.points);
    if (Number.isFinite(direct) && direct > 0) return direct;
    const mins = Number((task as any)?.estimateMin);
    if (Number.isFinite(mins) && mins > 0) return mins / 60;
    const hours = Number((task as any)?.estimatedHours);
    if (Number.isFinite(hours) && hours > 0) return hours;
    return null;
  }, []);

  const getTaskStaleAnchorMs = useCallback((task: Task): number | null => {
    const dueMs = getTaskDueMs(task);
    if (dueMs && dueMs > 0 && dueMs <= Date.now()) return dueMs;
    const updatedMs = decodeToDate((task as any)?.updatedAt)?.getTime();
    if (updatedMs) return updatedMs;
    const createdMs = decodeToDate((task as any)?.createdAt)?.getTime();
    if (createdMs) return createdMs;
    const serverUpdatedAt = Number((task as any)?.serverUpdatedAt);
    if (Number.isFinite(serverUpdatedAt) && serverUpdatedAt > 0) return serverUpdatedAt;
    const deviceUpdatedAt = Number((task as any)?.deviceUpdatedAt);
    if (Number.isFinite(deviceUpdatedAt) && deviceUpdatedAt > 0) return deviceUpdatedAt;
    return dueMs && dueMs > 0 ? dueMs : null;
  }, [decodeToDate, getTaskDueMs]);

  const formatDueDetail = useCallback((dueMs: number) => {
    const dueDate = new Date(dueMs);
    const dateLabel = format(dueDate, 'MMM d, yyyy');
    const timeLabel = format(dueDate, 'HH:mm');
    const hasTime = dueDate.getHours() !== 0 || dueDate.getMinutes() !== 0;
    return hasTime ? `${dateLabel} • ${timeLabel}` : dateLabel;
  }, []);

  const triggerDeltaRescore = useCallback((entityId: string, entityType: 'task' | 'story') => {
    httpsCallable(functions, 'deltaPriorityRescore')({ entityId, entityType })
      .catch((err) => console.warn('Delta rescore failed (non-blocking)', err));
  }, []);

  const handleTaskStatusChange = useCallback(async (task: Task, status: number) => {
    try {
      const ref = doc(db, 'tasks', task.id);
      await updateDoc(ref, {
        status,
        completedAt: status === 2 ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      });
      triggerDeltaRescore(task.id, 'task');
    } catch (err) {
      console.error('Failed to update task status', err);
    }
  }, [triggerDeltaRescore]);

  const handleTaskPriorityChange = useCallback(async (task: Task, priority: number) => {
    try {
      const ref = doc(db, 'tasks', task.id);
      await updateDoc(ref, { priority, updatedAt: serverTimestamp() });
      triggerDeltaRescore(task.id, 'task');
    } catch (err) {
      console.error('Failed to update task priority', err);
    }
  }, [triggerDeltaRescore]);

  const handleTaskDueDateChange = useCallback(async (task: Task, dueDate: number) => {
    try {
      const ref = doc(db, 'tasks', task.id);
      await updateDoc(ref, { dueDate, updatedAt: serverTimestamp() });
      triggerDeltaRescore(task.id, 'task');
    } catch (err) {
      console.error('Failed to update task due date', err);
    }
  }, [triggerDeltaRescore]);

  const handleStoryStatusChange = useCallback(async (story: Story, status: number) => {
    try {
      const ref = doc(db, 'stories', story.id);
      await updateDoc(ref, { status, updatedAt: serverTimestamp() });
      triggerDeltaRescore(story.id, 'story');
    } catch (err) {
      console.error('Failed to update story status', err);
    }
  }, [triggerDeltaRescore]);

  const handleStoryPriorityChange = useCallback(async (story: Story, priority: number) => {
    try {
      const ref = doc(db, 'stories', story.id);
      await updateDoc(ref, { priority, updatedAt: serverTimestamp() });
      triggerDeltaRescore(story.id, 'story');
    } catch (err) {
      console.error('Failed to update story priority', err);
    }
  }, [triggerDeltaRescore]);

  const handleStoryDueDateChange = useCallback(async (story: Story, dueDate: number) => {
    try {
      const ref = doc(db, 'stories', story.id);
      await updateDoc(ref, { targetDate: dueDate, dueDate, updatedAt: serverTimestamp() });
      triggerDeltaRescore(story.id, 'story');
    } catch (err) {
      console.error('Failed to update story due date', err);
    }
  }, [triggerDeltaRescore]);

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
    setDailyActiveSignals([]);
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
          const signalItems = normalizeDailyActiveSignals(summary?.dashboardAlerts);
          setAiFocusItems(aiItems);
          setDailyActiveSignals(signalItems.slice(0, 6));
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
            setDailyActiveSignals([]);
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
      setDailyActiveSignals([]);
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

  const fetchNextWorkRecommendation = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!currentUser || !currentPersona) {
      setNextWorkRecommendation(null);
      setNextWorkError(null);
      setNextWorkLoading(false);
      return;
    }
    if (!silent) {
      setNextWorkLoading(true);
      setNextWorkError(null);
    }
    try {
      const call = httpsCallable(functions, 'whatToWorkOnNext');
      const response = await call({
        persona: currentPersona,
        selectedSprintId: selectedSprintId || null,
      });
      setNextWorkRecommendation((response.data || null) as NextWorkRecommendation);
      if (!silent) setNextWorkError(null);
    } catch (error) {
      console.warn('Failed to load next work recommendation', error);
      if (!silent) {
        setNextWorkError('Could not calculate what to work on next.');
      }
    } finally {
      if (!silent) setNextWorkLoading(false);
    }
  }, [currentUser, currentPersona, selectedSprintId]);

  const handleApplyEveningPullForward = useCallback(async (item: EveningPullForwardItem) => {
    if (!currentUser || !item?.id || !item?.type) return;
    setEveningPullForwardBusyId(item.id);
    try {
      const call = httpsCallable(functions, 'applyEveningPullForward');
      await call({ entityType: item.type, entityId: item.id });
      setReplanFeedback(`Brought forward: ${item.label || item.title || item.id}`);
      loadDashboardData();
      fetchNextWorkRecommendation({ silent: true });
    } catch (error) {
      console.warn('Failed to apply evening pull-forward suggestion', error);
      setReplanFeedback('Could not bring that suggestion forward.');
    } finally {
      setEveningPullForwardBusyId(null);
    }
  }, [currentUser, fetchNextWorkRecommendation, loadDashboardData]);

  useEffect(() => {
    if (!currentUser) {
      setEveningPullForward(null);
      return;
    }

    const alertRef = doc(db, 'users', currentUser.uid, 'planner_alerts', 'evening-pull-forward');
    const unsubscribe = onSnapshot(alertRef, (snap) => {
      if (!snap.exists()) {
        setEveningPullForward(null);
        return;
      }
      const data = snap.data() as any;
      const rawSuggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
      const scopedSuggestions = rawSuggestions.filter((entry: any) => {
        const persona = String(entry?.persona || '').toLowerCase();
        if (!persona) return true;
        return persona === String(currentPersona || 'personal').toLowerCase();
      });
      const isActive = data?.active === true;
      if (!isActive || !scopedSuggestions.length) {
        setEveningPullForward(null);
        return;
      }
      setEveningPullForward({
        active: true,
        message: String(data?.message || ''),
        suggestions: scopedSuggestions,
      });
    }, () => {
      setEveningPullForward(null);
    });

    return () => unsubscribe();
  }, [currentUser, currentPersona]);

  useEffect(() => {
    console.log('🔍 Dashboard useEffect triggered:', { currentUser: !!currentUser, persona: currentPersona });
    if (!currentUser) {
      console.log('🔍 Dashboard: No currentUser, returning early');
      setPersonaStoriesPool([]);
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
      const allStories = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as Story));
      setPersonaStoriesPool(allStories);
      let totalPoints = 0;
      let donePoints = 0;
      let totalStories = 0;
      let doneStories = 0;
      allStories.forEach((story) => {
        const data = story as any;
        const points = Number.isFinite(Number(data.points)) ? Number(data.points) : 0;
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
      const activeTaskList = allTasks.filter(task => !isTaskDoneState(task.status));
      setUpcomingTasks(activeTaskList.slice(0, 5));
      const openTasks = allTasks.filter(task => !isTaskDoneState(task.status)).length;
      const todayCompleted = allTasks.filter(task => {
        if (!isTaskDoneState(task.status) || !task.updatedAt) return false;
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
      const sprintDone = sprintTasks.filter(task => isTaskDoneState(task.status)).length;
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
          loadMonzoSummary(),
          loadFitnessTrendSummary()
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
  }, [currentUser, currentPersona, selectedSprintId, refreshToken, decodeToDate, profileSnapshot?.excludeWithDadFromMetrics]);

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setNextWorkRecommendation(null);
      setNextWorkError(null);
      setNextWorkLoading(false);
      return;
    }
    fetchNextWorkRecommendation();
    const intervalId = window.setInterval(() => {
      fetchNextWorkRecommendation({ silent: true });
    }, NEXT_WORK_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [currentUser, currentPersona, selectedSprintId, refreshToken, fetchNextWorkRecommendation]);

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
    if (!currentUser) {
      setFitnessOverviewSnapshot(null);
      setRunAnalysisSnapshot(null);
      return;
    }
    const overviewRef = doc(db, 'fitness_overview', currentUser.uid);
    const analysisRef = doc(db, 'run_analysis', currentUser.uid);
    const unsubOverview = onSnapshot(overviewRef, (snap) => {
      setFitnessOverviewSnapshot(snap.exists() ? snap.data() : null);
    }, () => setFitnessOverviewSnapshot(null));
    const unsubAnalysis = onSnapshot(analysisRef, (snap) => {
      setRunAnalysisSnapshot(snap.exists() ? snap.data() : null);
    }, () => setRunAnalysisSnapshot(null));
    return () => {
      unsubOverview();
      unsubAnalysis();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setTasksDueTodayList([]);
      setOpenTasksPool([]);
      setPersonaTasksPool([]);
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
        const openRows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) } as Task))
          .filter((task) => !task.deleted);
        setPersonaTasksPool(openRows);
        const openActiveRows = openRows
          .filter((task) => !isTaskDoneState(task.status));

        setOpenTasksPool(openActiveRows);

        const rows = openActiveRows
          .filter((task) => {
            const due = getTaskDueMs(task);
            const isChore = !!getChoreKind(task);
            if (due) return due <= todayEnd;
            if (isChore) return isRecurringDueOnDate(task, todayDate, due);
            return false;
          });

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
        setOpenTasksPool([]);
        setPersonaTasksPool([]);
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

  const lowHangingFruitTasks = useMemo(() => {
    const now = Date.now();
    const staleThresholdMs = LOW_HANGING_MIN_STALE_DAYS * MS_PER_DAY;
    const rows = openTasksPool.filter((task) => {
      const quickPoints = getTaskQuickPoints(task);
      if (!Number.isFinite(quickPoints) || !quickPoints || quickPoints > LOW_HANGING_MAX_POINTS) {
        return false;
      }
      const priority = Number((task as any).priority || 0);
      if (Number.isFinite(priority) && priority >= 4) return false;
      const anchorMs = getTaskStaleAnchorMs(task);
      if (!anchorMs) return false;
      return (now - anchorMs) >= staleThresholdMs;
    });
    rows.sort((a, b) => {
      const aAnchor = getTaskStaleAnchorMs(a) ?? now;
      const bAnchor = getTaskStaleAnchorMs(b) ?? now;
      if (aAnchor !== bAnchor) return aAnchor - bAnchor;
      const aPoints = getTaskQuickPoints(a) ?? LOW_HANGING_MAX_POINTS;
      const bPoints = getTaskQuickPoints(b) ?? LOW_HANGING_MAX_POINTS;
      if (aPoints !== bPoints) return aPoints - bPoints;
      const aDue = getTaskDueMs(a) ?? Number.MAX_SAFE_INTEGER;
      const bDue = getTaskDueMs(b) ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
    return rows.slice(0, 8);
  }, [openTasksPool, getTaskQuickPoints, getTaskStaleAnchorMs, getTaskDueMs]);

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

    if (tasksDueTodaySortMode === 'ai' || tasksDueTodaySortMode === 'top3') {
      const tasks = items.filter((item) => item.kind === 'task');
      tasks.sort((a, b) => {
        const aScore = Number((a.task as any)?.aiCriticalityScore ?? (a.task as any)?.aiPriorityScore ?? 0);
        const bScore = Number((b.task as any)?.aiCriticalityScore ?? (b.task as any)?.aiPriorityScore ?? 0);
        if (aScore !== bScore) return bScore - aScore;
        const aDue = a.dueMs ?? 0;
        const bDue = b.dueMs ?? 0;
        return aDue - bDue;
      });
      if (tasksDueTodaySortMode === 'top3') return tasks.slice(0, 3);
      return tasks;
    }

    items.sort((a, b) => (a.dueMs ?? 0) - (b.dueMs ?? 0));
    return items;
  }, [nonChoreTasksDueToday, tasksDueTodaySortMode, getTaskDueMs]);

  const unifiedTodayTimelineItems = useMemo(() => {
    const rows: Array<any> = [];
    const seenTaskIds = new Set<string>();
    const seenStoryIds = new Set<string>();
    const seenSignatures = new Set<string>();

    const now = new Date();
    const todayStart = startOfDay(now).getTime();
    const todayEnd = endOfDay(now).getTime();

    const taskById = new Map<string, Task>();
    [...openTasksPool, ...tasksDueTodayList, ...upcomingTasks, ...sprintTasks].forEach((task) => {
      if (!task?.id) return;
      if (taskById.has(task.id)) return;
      taskById.set(task.id, task);
    });

    const storyById = new Map<string, Story>();
    [...recentStories, ...sprintStories].forEach((story) => {
      if (!story?.id) return;
      if (storyById.has(story.id)) return;
      storyById.set(story.id, story);
    });

    const buildSignature = (title: string | null | undefined, startMs?: number | null) => {
      const minuteOfDay = Number.isFinite(startMs as number)
        ? (() => {
            const date = new Date(startMs as number);
            return date.getHours() * 60 + date.getMinutes();
          })()
        : -1;
      return `${normalizeTimelineText(title)}|${minuteOfDay}`;
    };

    const resolveBlockSourceLabel = (block: any): 'auto-planned' | 'linked from gcal' | 'manual' => {
      const source = String(block?.source || '').toLowerCase();
      const entryMethod = String(block?.entry_method || '').toLowerCase();
      if (source === 'gcal' || entryMethod === 'google_calendar') return 'linked from gcal';
      if (
        entryMethod.includes('auto')
        || source.includes('auto')
        || source.includes('ai')
        || source === 'planner'
        || source === 'bob_auto'
      ) {
        return 'auto-planned';
      }
      return 'manual';
    };

    const pushRow = (item: any) => {
      const signature = buildSignature(item.title, item.startMs);
      if (seenSignatures.has(signature)) return;
      seenSignatures.add(signature);
      rows.push(item);
    };

    calendarEvents.forEach((event) => {
      const startMs = event.start?.getTime?.() ?? null;
      const endMs = event.end?.getTime?.() ?? startMs;
      if (!Number.isFinite(startMs as number)) return;
      if ((startMs as number) < todayStart || (startMs as number) > todayEnd) return;

      const block: any = (event as any).block || {};
      if (block?.taskId && taskById.has(block.taskId)) {
        const task = taskById.get(block.taskId)!;
        seenTaskIds.add(task.id);
        pushRow({
          id: `timeline-task-calendar-${task.id}-${event.id}`,
          kind: 'task',
          source: 'calendar',
          sourceLabel: resolveBlockSourceLabel(block),
          title: task.title || event.title || 'Task',
          startMs,
          endMs,
          task,
        });
        return;
      }

      if (block?.storyId && storyById.has(block.storyId)) {
        const story = storyById.get(block.storyId)!;
        seenStoryIds.add(story.id);
        pushRow({
          id: `timeline-story-calendar-${story.id}-${event.id}`,
          kind: 'story',
          source: 'calendar',
          sourceLabel: resolveBlockSourceLabel(block),
          title: story.title || event.title || 'Story',
          startMs,
          endMs,
          story,
        });
        return;
      }

      pushRow({
        id: `timeline-calendar-${event.id}`,
        kind: 'calendar',
        source: 'calendar',
        sourceLabel: event.type === 'external' ? 'linked from gcal' : resolveBlockSourceLabel(block),
        title: event.title || 'Calendar event',
        startMs,
        endMs,
        event,
      });
    });

    tasksDueTodayCombined.forEach((item) => {
      if (item.kind !== 'task' || !item.task) return;
      if (seenTaskIds.has(item.task.id)) return;
      pushRow({
        id: `timeline-task-due-${item.task.id}`,
        kind: 'task',
        source: 'due',
        sourceLabel: 'manual',
        title: item.task.title || item.title || 'Task',
        startMs: item.dueMs ?? getTaskDueMs(item.task),
        endMs: null,
        task: item.task,
      });
    });

    choresDueTodayTasks.forEach((task) => {
      const choreKind = getChoreKind(task) || 'chore';
      pushRow({
        id: `timeline-${choreKind}-${task.id}`,
        kind: choreKind,
        source: 'checklist',
        sourceLabel: 'manual',
        title: task.title || 'Checklist item',
        startMs: getTaskDueMs(task),
        endMs: null,
        task,
      });
    });

    return rows.sort((a, b) => {
      const aStart = Number.isFinite(a.startMs) ? a.startMs : Number.MAX_SAFE_INTEGER;
      const bStart = Number.isFinite(b.startMs) ? b.startMs : Number.MAX_SAFE_INTEGER;
      if (aStart !== bStart) return aStart - bStart;
      return String(a.title || '').localeCompare(String(b.title || ''));
    });
  }, [
    calendarEvents,
    choresDueTodayTasks,
    getChoreKind,
    getTaskDueMs,
    openTasksPool,
    recentStories,
    sprintStories,
    sprintTasks,
    tasksDueTodayCombined,
    tasksDueTodayList,
    upcomingTasks,
  ]);

  const unifiedTodayTimelineByBucket = useMemo(() => {
    const grouped: Record<DayTimelineBucket, Array<any>> = {
      morning: [],
      afternoon: [],
      evening: [],
    };

    unifiedTodayTimelineItems.forEach((item) => {
      const todBucket = bucketFromTimeOfDay(item?.task?.timeOfDay);
      if (todBucket) {
        grouped[todBucket].push(item);
        return;
      }
      if (Number.isFinite(item?.startMs)) {
        const date = new Date(item.startMs);
        const minute = date.getHours() * 60 + date.getMinutes();
        grouped[bucketFromMinutes(minute)].push(item);
        return;
      }
      grouped.morning.push(item);
    });

    return grouped;
  }, [unifiedTodayTimelineItems]);

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

  const top3TargetsByRef = useMemo(() => {
    const map = new Map<string, { href: string; label: string }>();
    top3Stories.forEach((story) => {
      const ref = storyRefLabel(story).toUpperCase();
      if (!ref) return;
      map.set(ref, {
        href: `/stories/${story.id}`,
        label: `${storyRefLabel(story)} — ${story.title || 'Story'}`,
      });
    });
    top3Tasks.forEach((task) => {
      const ref = taskRefLabel(task).toUpperCase();
      if (!ref) return;
      map.set(ref, {
        href: `/tasks/${task.id}`,
        label: `${taskRefLabel(task)} — ${task.title || 'Task'}`,
      });
    });
    return map;
  }, [top3Stories, top3Tasks, storyRefLabel, taskRefLabel]);

  const renderDailySummaryLine = useCallback((line: string) => {
    const text = String(line || '').trim();
    if (!text) return text;
    if (!text.toLowerCase().startsWith('focus:')) return text;

    const lineUpper = text.toUpperCase();
    const top3Match = Array.from(top3TargetsByRef.entries()).find(([ref]) => lineUpper.includes(ref));
    const refMatch = text.match(/\b[A-Z]{2,4}-[A-Z0-9]{4,}\b/i);
    const matchedRef = String(top3Match?.[0] || refMatch?.[0] || '').toUpperCase();
    const target = top3Match
      ? top3Match[1]
      : (() => {
          if (!matchedRef) return null;
          const matchedTask = tasksByRef.get(matchedRef);
          if (matchedTask) {
            return {
              href: `/tasks/${matchedTask.id}`,
              label: `${taskRefLabel(matchedTask)} — ${matchedTask.title || 'Task'}`,
            };
          }
          const matchedStory = storiesByRef.get(matchedRef);
          if (matchedStory) {
            return {
              href: `/stories/${matchedStory.id}`,
              label: `${storyRefLabel(matchedStory)} — ${matchedStory.title || 'Story'}`,
            };
          }
          return null;
        })();

    if (!target) return text;

    const labelIndex = lineUpper.indexOf(target.label.toUpperCase());
    if (labelIndex >= 0) {
      const prefix = text.slice(0, labelIndex);
      const suffix = text.slice(labelIndex + target.label.length);
      return (
        <>
          {prefix}
          <a href={target.href} className="text-decoration-none">{target.label}</a>
          {suffix}
        </>
      );
    }

    const refIndex = matchedRef ? lineUpper.indexOf(matchedRef) : -1;
    if (refIndex >= 0 && matchedRef) {
      const prefix = text.slice(0, refIndex);
      const suffix = text.slice(refIndex + matchedRef.length);
      return (
        <>
          {prefix}
          <a href={target.href} className="text-decoration-none">{text.slice(refIndex, refIndex + matchedRef.length)}</a>
          {suffix}
        </>
      );
    }

    return text;
  }, [storiesByRef, storyRefLabel, taskRefLabel, tasksByRef, top3TargetsByRef]);

  const nextWorkPath = useMemo(() => {
    const item = nextWorkRecommendation?.recommendedItem;
    if (!item) return null;
    if (item.path) return item.path;
    const kind = String(item.taskKind || '').toLowerCase();
    if (item.type === 'task' && ['chore', 'routine', 'habit'].includes(kind)) {
      return '/chores/checklist';
    }
    return null;
  }, [nextWorkRecommendation?.recommendedItem]);

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

  const goalsMissingPotWithCostCount = useMemo(() => {
    return goalsList.filter((goal) => goalNeedsLinkedPot(goal)).length;
  }, [goalsList]);

  const themeProgressRows = useMemo<ThemeProgressRow[]>(() => {
    const resolveThemeId = (value: any): number => {
      const match = themeFor(value);
      return typeof match?.id === 'number' ? match.id : 0;
    };

    const resolveGoalSavings = (goal: Goal) => {
      const target = Number((goal as any).estimatedCost || 0);
      const rawPotId = (goal as any).linkedPotId || (goal as any).potId || null;
      if (!rawPotId) {
        return {
          savingsSavedPence: 0,
          savingsTarget: Number.isFinite(target) ? target : 0,
          savingsCurrency: 'GBP',
        };
      }

      const base = String(rawPotId);
      const candidates = [base];
      if (currentUser?.uid && base.startsWith(`${currentUser.uid}_`)) {
        candidates.push(base.replace(`${currentUser.uid}_`, ''));
      } else if (currentUser?.uid) {
        candidates.push(`${currentUser.uid}_${base}`);
      }
      const potId = candidates.find((id) => potsById[id]);
      const pot = potId ? potsById[potId] : null;
      return {
        savingsSavedPence: Number(pot?.balance || 0),
        savingsTarget: Number.isFinite(target) ? target : 0,
        savingsCurrency: pot?.currency || 'GBP',
      };
    };

    const sprintStartMs = selectedSprint ? Number(selectedSprint.startDate || 0) : null;
    const sprintEndMs = selectedSprint ? Number(selectedSprint.endDate || 0) : null;

    const resolveGoalDueMs = (goal: Goal): number | null => {
      const dueCandidate = (goal as any).dueDate ?? (goal as any).endDate ?? (goal as any).targetDate ?? null;
      const decoded = decodeToDate(dueCandidate);
      const dueMs = decoded?.getTime() ?? null;
      if (!Number.isFinite(dueMs as number)) return null;
      return dueMs as number;
    };

    const isGoalDueThisSprint = (goal: Goal): boolean => {
      if (!Number.isFinite(sprintStartMs as number) || !Number.isFinite(sprintEndMs as number)) return false;
      const dueMs = resolveGoalDueMs(goal);
      if (!dueMs) return false;
      return dueMs >= (sprintStartMs as number) && dueMs <= (sprintEndMs as number);
    };

    const storyById = new Map<string, Story>();
    sprintStories.forEach((story) => {
      if (!story?.id) return;
      storyById.set(story.id, story);
    });

    const storiesByGoal = new Map<string, Story[]>();
    sprintStories.forEach((story) => {
      const goalId = String((story as any).goalId || '').trim();
      if (!goalId) return;
      const rows = storiesByGoal.get(goalId) || [];
      rows.push(story);
      storiesByGoal.set(goalId, rows);
    });

    const tasksByGoal = new Map<string, Task[]>();
    sprintTasks.forEach((task) => {
      let goalId = String((task as any).goalId || '').trim();
      if (!goalId && task.storyId) {
        goalId = String(storyById.get(task.storyId)?.goalId || '').trim();
      }
      if (!goalId) return;
      const rows = tasksByGoal.get(goalId) || [];
      rows.push(task);
      tasksByGoal.set(goalId, rows);
    });

    const sprintGoalIds = new Set<string>();
    storiesByGoal.forEach((_, goalId) => sprintGoalIds.add(goalId));
    tasksByGoal.forEach((_, goalId) => sprintGoalIds.add(goalId));

    const isGoalInSprintContext = (goal: Goal): boolean => {
      if (sprintGoalIds.has(goal.id)) return true;
      return isGoalDueThisSprint(goal);
    };

    const rows: ThemeProgressRow[] = [];
    themePalette.forEach((theme) => {
      const themeId = Number(theme.id);
      const themeGoals = goalsList.filter((goal) => (
        resolveThemeId((goal as any).theme) === themeId && isGoalInSprintContext(goal)
      ));
      const themeGoalIds = new Set(themeGoals.map((goal) => goal.id));

      const themeStories = sprintStories.filter((story) => {
        if (resolveThemeId((story as any).theme) === themeId) return true;
        return !!story.goalId && themeGoalIds.has(story.goalId);
      });
      const themeStoryIds = new Set(themeStories.map((story) => story.id));

      const themeTasks = sprintTasks.filter((task) => {
        if (resolveThemeId((task as any).theme) === themeId) return true;
        if (task.goalId && themeGoalIds.has(task.goalId)) return true;
        if (task.storyId && themeStoryIds.has(task.storyId)) return true;
        if (task.storyId) {
          const storyGoalId = String(storyById.get(task.storyId)?.goalId || '').trim();
          if (storyGoalId && themeGoalIds.has(storyGoalId)) return true;
        }
        return false;
      });

      const totalItems = themeGoals.length + themeStories.length + themeTasks.length;
      if (totalItems === 0) return;

      const goalRows: ThemeProgressGoalRow[] = themeGoals.map((goal) => {
        const goalStories = storiesByGoal.get(goal.id) || [];
        const goalTasks = tasksByGoal.get(goal.id) || [];
        const storiesDone = goalStories.filter((story) => isStoryDoneState((story as any).status)).length;
        const tasksDone = goalTasks.filter((task) => isTaskDoneState((task as any).status)).length;
        const pointsTotal = goalStories.reduce((sum, story) => sum + (Number((story as any).points || 0) || 0), 0);
        const pointsDone = goalStories
          .filter((story) => isStoryDoneState((story as any).status))
          .reduce((sum, story) => sum + (Number((story as any).points || 0) || 0), 0);
        const pointsProgressPct = pointsTotal > 0
          ? Math.round((pointsDone / pointsTotal) * 100)
          : (isGoalDoneState((goal as any).status) ? 100 : 0);
        const totalChildItems = goalStories.length + goalTasks.length;
        const progressPct = pointsTotal > 0
          ? pointsProgressPct
          : totalChildItems > 0
            ? Math.round(((storiesDone + tasksDone) / totalChildItems) * 100)
            : (isGoalDoneState((goal as any).status) ? 100 : 0);
        const dueDateMs = resolveGoalDueMs(goal);
        const dueThisSprint = !!(
          dueDateMs
          && Number.isFinite(sprintStartMs as number)
          && Number.isFinite(sprintEndMs as number)
          && dueDateMs >= (sprintStartMs as number)
          && dueDateMs <= (sprintEndMs as number)
        );
        const statusNum = Number((goal as any).status);
        const statusLabel = Number.isFinite(statusNum)
          ? (
            statusNum === 2 ? 'Complete'
              : statusNum === 1 ? 'In Progress'
                : statusNum === 3 ? 'Blocked'
                  : statusNum === 4 ? 'Deferred'
                    : 'New'
          )
          : String((goal as any).status || 'New');
        const statusBg = Number.isFinite(statusNum)
          ? (
            statusNum === 2 ? 'success'
              : statusNum === 1 ? 'primary'
                : statusNum === 3 ? 'warning'
                  : statusNum === 4 ? 'secondary'
                    : 'dark'
          )
          : 'secondary';
        const savings = resolveGoalSavings(goal);
        return {
          id: goal.id,
          title: goal.title || goal.id,
          status: (goal as any).status,
          statusLabel,
          statusBg,
          storiesDone,
          storiesTotal: goalStories.length,
          tasksDone,
          tasksTotal: goalTasks.length,
          pointsDone,
          pointsTotal,
          pointsProgressPct,
          progressPct,
          dueDateMs,
          dueThisSprint,
          savingsSavedPence: savings.savingsSavedPence,
          savingsTarget: savings.savingsTarget,
          savingsCurrency: savings.savingsCurrency,
        };
      }).sort((a, b) => {
        if (a.dueThisSprint !== b.dueThisSprint) return a.dueThisSprint ? -1 : 1;
        if (a.pointsProgressPct !== b.pointsProgressPct) return a.pointsProgressPct - b.pointsProgressPct;
        if (a.progressPct !== b.progressPct) return a.progressPct - b.progressPct;
        return a.title.localeCompare(b.title);
      });

      const goalsDone = themeGoals.filter((goal) => isGoalDoneState((goal as any).status)).length;
      const storiesDone = themeStories.filter((story) => isStoryDoneState((story as any).status)).length;
      const tasksDone = themeTasks.filter((task) => isTaskDoneState((task as any).status)).length;
      const pointsTotal = themeStories.reduce((sum, story) => sum + (Number((story as any).points || 0) || 0), 0);
      const pointsDone = themeStories
        .filter((story) => isStoryDoneState((story as any).status))
        .reduce((sum, story) => sum + (Number((story as any).points || 0) || 0), 0);
      const completedItems = goalsDone + storiesDone + tasksDone;
      const progressPct = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      const savingsSavedPence = goalRows.reduce((sum, goalRow) => sum + goalRow.savingsSavedPence, 0);
      const savingsTarget = goalRows.reduce((sum, goalRow) => sum + goalRow.savingsTarget, 0);
      const savingsCurrency = goalRows.find((goalRow) => goalRow.savingsCurrency)?.savingsCurrency || 'GBP';

      rows.push({
        themeKey: String(theme.id),
        themeId,
        themeLabel: theme.label || theme.name || `Theme ${theme.id}`,
        color: theme.color || '#6c757d',
        textColor: theme.textColor || '#ffffff',
        goalsDone,
        goalsTotal: themeGoals.length,
        storiesDone,
        storiesTotal: themeStories.length,
        tasksDone,
        tasksTotal: themeTasks.length,
        pointsDone,
        pointsTotal,
        completedItems,
        totalItems,
        progressPct,
        goalRows,
        savingsSavedPence,
        savingsTarget,
        savingsCurrency,
      });
    });

    return rows.sort((a, b) => {
      if (a.pointsTotal !== b.pointsTotal) return b.pointsTotal - a.pointsTotal;
      if (a.totalItems !== b.totalItems) return b.totalItems - a.totalItems;
      return a.themeLabel.localeCompare(b.themeLabel);
    });
  }, [currentUser?.uid, decodeToDate, goalsList, potsById, selectedSprint, sprintStories, sprintTasks, themeFor, themePalette]);

  const lowProgressGoalsDueThisSprint = useMemo(() => {
    const rows: Array<ThemeProgressGoalRow & { themeLabel: string; themeColor: string }> = [];
    themeProgressRows.forEach((themeRow) => {
      themeRow.goalRows.forEach((goalRow) => {
        if (!goalRow.dueThisSprint) return;
        if (goalRow.pointsProgressPct >= 25) return;
        if (isGoalDoneState(goalRow.status)) return;
        rows.push({
          ...goalRow,
          themeLabel: themeRow.themeLabel,
          themeColor: themeRow.color,
        });
      });
    });
    return rows.sort((a, b) => {
      if (a.pointsProgressPct !== b.pointsProgressPct) return a.pointsProgressPct - b.pointsProgressPct;
      const aDue = Number.isFinite(a.dueDateMs as number) ? (a.dueDateMs as number) : Number.MAX_SAFE_INTEGER;
      const bDue = Number.isFinite(b.dueDateMs as number) ? (b.dueDateMs as number) : Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return a.title.localeCompare(b.title);
    });
  }, [themeProgressRows]);

  const dailyCompletionTrend = useMemo<DailyCompletionTrendPoint[]>(() => {
    const trendDays = 14;
    const today = startOfDay(new Date());
    const rows: DailyCompletionTrendPoint[] = [];
    const storyDueMsFor = (story: Story): number | null => {
      const raw = (story as any).dueDate ?? (story as any).targetDate ?? (story as any).sprintDueDate ?? null;
      const dueDate = decodeToDate(raw);
      return dueDate ? dueDate.getTime() : null;
    };
    const storyCompletedMsFor = (story: Story): number | null => {
      const raw = (story as any).completedAt ?? (story as any).doneAt ?? (story as any).updatedAt ?? null;
      const doneDate = decodeToDate(raw);
      return doneDate ? doneDate.getTime() : null;
    };
    const taskCompletedMsFor = (task: Task): number | null => {
      const raw = (task as any).completedAt ?? (task as any).doneAt ?? (task as any).updatedAt ?? null;
      const doneDate = decodeToDate(raw);
      return doneDate ? doneDate.getTime() : null;
    };
    const ratioToPct = (done: number, due: number) => (due > 0 ? Math.round((done / due) * 100) : 0);

    for (let i = trendDays - 1; i >= 0; i -= 1) {
      const day = startOfDay(addDays(today, -i));
      const dayStartMs = day.getTime();
      const dayEndMs = endOfDay(day).getTime();

      let taskDue = 0;
      let taskCompleted = 0;
      let storyDue = 0;
      let storyCompleted = 0;
      let choreDue = 0;
      let choreCompleted = 0;

      personaTasksPool.forEach((task) => {
        const dueMs = getTaskDueMs(task);
        const choreKind = getChoreKind(task);
        const dueOnDay = dueMs
          ? dueMs >= dayStartMs && dueMs <= dayEndMs
          : isRecurringDueOnDate(task, day, dueMs);
        if (!dueOnDay) return;

        if (choreKind) {
          choreDue += 1;
          const lastDoneMs = getTaskLastDoneMs(task);
          const completedMs = taskCompletedMsFor(task);
          const completedOnDay = !!(
            (Number.isFinite(lastDoneMs as number) && (lastDoneMs as number) >= dayStartMs && (lastDoneMs as number) <= dayEndMs)
            || (
              isTaskDoneState(task.status)
              && Number.isFinite(completedMs as number)
              && (completedMs as number) >= dayStartMs
              && (completedMs as number) <= dayEndMs
            )
          );
          if (completedOnDay) choreCompleted += 1;
          return;
        }

        taskDue += 1;
        const completedMs = taskCompletedMsFor(task);
        const completedOnDay = !!(
          isTaskDoneState(task.status)
          && Number.isFinite(completedMs as number)
          && (completedMs as number) >= dayStartMs
          && (completedMs as number) <= dayEndMs
        );
        if (completedOnDay) taskCompleted += 1;
      });

      personaStoriesPool.forEach((story) => {
        const dueMs = storyDueMsFor(story);
        if (!Number.isFinite(dueMs as number)) return;
        if ((dueMs as number) < dayStartMs || (dueMs as number) > dayEndMs) return;
        storyDue += 1;
        const completedMs = storyCompletedMsFor(story);
        const completedOnDay = !!(
          isStoryDoneState((story as any).status)
          && Number.isFinite(completedMs as number)
          && (completedMs as number) >= dayStartMs
          && (completedMs as number) <= dayEndMs
        );
        if (completedOnDay) storyCompleted += 1;
      });

      const totalDue = taskDue + storyDue + choreDue;
      const totalCompleted = taskCompleted + storyCompleted + choreCompleted;
      rows.push({
        dayKey: format(day, 'yyyy-MM-dd'),
        label: format(day, 'dd MMM'),
        totalDue,
        totalCompleted,
        totalPct: ratioToPct(totalCompleted, totalDue),
        storyDue,
        storyCompleted,
        storyPct: ratioToPct(storyCompleted, storyDue),
        taskDue,
        taskCompleted,
        taskPct: ratioToPct(taskCompleted, taskDue),
        choreDue,
        choreCompleted,
        chorePct: ratioToPct(choreCompleted, choreDue),
      });
    }
    return rows;
  }, [decodeToDate, getChoreKind, getTaskDueMs, getTaskLastDoneMs, personaStoriesPool, personaTasksPool]);

  const todayCompletionSnapshot = useMemo(() => {
    if (!dailyCompletionTrend.length) return null;
    return dailyCompletionTrend[dailyCompletionTrend.length - 1];
  }, [dailyCompletionTrend]);

  const completionSevenDayPct = useMemo(() => {
    const rows = dailyCompletionTrend.slice(-7);
    if (!rows.length) return 0;
    const due = rows.reduce((sum, row) => sum + row.totalDue, 0);
    const done = rows.reduce((sum, row) => sum + row.totalCompleted, 0);
    return due > 0 ? Math.round((done / due) * 100) : 0;
  }, [dailyCompletionTrend]);

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
      if (isTaskDoneState(data?.status)) return;
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

  const loadFitnessTrendSummary = async () => {
    if (!currentUser) {
      setFitnessTrendSummary(null);
      return;
    }
    try {
      const dayMs = 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const currentStartMs = nowMs - (90 * dayMs);
      const previousStartMs = nowMs - (180 * dayMs);
      const yearStartMs = new Date(new Date().getFullYear(), 0, 1).getTime();
      const snap = await getDocs(query(
        collection(db, 'metrics_workouts'),
        where('ownerUid', '==', currentUser.uid),
        orderBy('startDate', 'desc'),
        limit(2000)
      )).catch(() => null);

      if (!snap) {
        setFitnessTrendSummary(null);
        return;
      }

      const workoutRows = snap.docs.map((docSnap) => docSnap.data() as any);
      const current = { rpe: [] as number[], fiveK: [] as number[], tenK: [] as number[] };
      const previous = { rpe: [] as number[], fiveK: [] as number[], tenK: [] as number[] };
      const excludeWithDadFromMetrics = profileSnapshot?.excludeWithDadFromMetrics !== false;
      const avg = (items: number[]) => (items.length ? (items.reduce((sum, value) => sum + value, 0) / items.length) : null);
      let ytdRunDistanceM = 0;
      let ytdSwimDistanceM = 0;
      let ytdBikeDistanceM = 0;

      workoutRows.forEach((data: any) => {
        if (excludeWithDadFromMetrics && workoutHasDadMarker(data)) return;
        const startMs = resolveWorkoutStartMs(data);
        if (!Number.isFinite(startMs) || startMs > nowMs) return;
        const sport = classifyWorkoutSport(data);

        const rpe = Number(data.perceivedExertion ?? data.rpe ?? data.stravaRpe ?? null);
        const distanceM = Number(data.distance_m || 0);
        const durationS = Number(data.movingTime_s || data.elapsedTime_s || 0);
        if (startMs >= yearStartMs && distanceM > 0) {
          if (sport === 'run') ytdRunDistanceM += distanceM;
          else if (sport === 'swim') ytdSwimDistanceM += distanceM;
          else if (sport === 'bike') ytdBikeDistanceM += distanceM;
        }
        if (sport !== 'run') return;
        if (startMs < previousStartMs) return;
        const target = startMs >= currentStartMs ? current : previous;
        if (Number.isFinite(rpe) && rpe > 0) target.rpe.push(rpe);
        if (distanceM <= 0 || durationS <= 0) return;
        const secPerMeter = durationS / distanceM;
        if (distanceM >= 4000 && distanceM <= 6000) target.fiveK.push(secPerMeter * 5000);
        if (distanceM >= 8000 && distanceM <= 12000) target.tenK.push(secPerMeter * 10000);
      });

      const computePredictionDisplay = (
        sport: 'run' | 'swim' | 'bike',
        targetKm: number,
        options: { minKm?: number; maxKm?: number; exponent?: number },
      ) => {
        const monthMap = new Map<string, { sumSec: number; count: number }>();
        workoutRows.forEach((data: any) => {
          if (excludeWithDadFromMetrics && workoutHasDadMarker(data)) return;
          if (classifyWorkoutSport(data) !== sport) return;
          const startMs = resolveWorkoutStartMs(data);
          if (!Number.isFinite(startMs) || startMs <= 0) return;
          const distanceKm = Number(data.distance_m || 0) / 1000;
          const timeSec = Number(data.movingTime_s ?? data.elapsedTime_s ?? 0);
          const normalizedSec = estimateEquivalentRaceSeconds(distanceKm, timeSec, targetKm, options);
          if (normalizedSec == null) return;
          const date = new Date(startMs);
          const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
          const bucket = monthMap.get(monthKey) || { sumSec: 0, count: 0 };
          bucket.sumSec += normalizedSec;
          bucket.count += 1;
          monthMap.set(monthKey, bucket);
        });

        const latestAvgSec = Array.from(monthMap.values())
          .map((value) => (value.count > 0 ? value.sumSec / value.count : null))
          .filter((value): value is number => value != null)
          .pop();

        return latestAvgSec != null ? formatSecondsDisplay(latestAvgSec) : null;
      };

      const predicted5kFallback = computePredictionDisplay('run', 5, { minKm: 3, maxKm: 21.2, exponent: 1.06 });
      const predicted10kFallback = computePredictionDisplay('run', 10, { minKm: 3, maxKm: 42.2, exponent: 1.06 });
      const predictedHalfFallback = computePredictionDisplay('run', 21.0975, { minKm: 3, maxKm: 42.2, exponent: 1.06 });
      const predictedSwim800Fallback = computePredictionDisplay('swim', 0.8, { minKm: 0.2, maxKm: 5, exponent: 1.04 });
      const predictedBike50Fallback = computePredictionDisplay('bike', 50, { minKm: 10, maxKm: 250, exponent: 1.06 });

      const currentRpe = avg(current.rpe);
      const previousRpe = avg(previous.rpe);
      const current5k = avg(current.fiveK);
      const previous5k = avg(previous.fiveK);
      const current10k = avg(current.tenK);
      const previous10k = avg(previous.tenK);

      setFitnessTrendSummary({
        avgRpe: {
          current: currentRpe,
          previous: previousRpe,
          delta: (currentRpe != null && previousRpe != null) ? Number((currentRpe - previousRpe).toFixed(2)) : null,
        },
        avg5kSec: {
          current: current5k,
          previous: previous5k,
          delta: (current5k != null && previous5k != null) ? Number((current5k - previous5k).toFixed(1)) : null,
        },
        avg10kSec: {
          current: current10k,
          previous: previous10k,
          delta: (current10k != null && previous10k != null) ? Number((current10k - previous10k).toFixed(1)) : null,
        },
        runDistanceYtdKm: Number((ytdRunDistanceM / 1000).toFixed(1)),
        swimDistanceYtdKm: Number((ytdSwimDistanceM / 1000).toFixed(1)),
        bikeDistanceYtdKm: Number((ytdBikeDistanceM / 1000).toFixed(1)),
        predicted5kDisplay: predicted5kFallback,
        predicted10kDisplay: predicted10kFallback,
        predictedHalfMarathonDisplay: predictedHalfFallback,
        predictedSwim800Display: predictedSwim800Fallback,
        predictedBike50Display: predictedBike50Fallback,
      });
    } catch (error) {
      console.warn('Failed to load fitness trend summary', error);
      setFitnessTrendSummary(null);
    }
  };

  const loadMonzoSummary = async () => {
    if (!currentUser) {
      setMonzoSummary(null);
      setFinanceWindowSummary(null);
      setFinanceTrendSummary(null);
      return;
    }
    try {
      const windowStart = startOfDay(addDays(new Date(), -(FINANCE_WINDOW_DAYS - 1)));
      const windowEnd = startOfDay(addDays(new Date(), 1));
      const trendCurrentStart = startOfDay(addDays(new Date(), -89));
      const trendPreviousStart = startOfDay(addDays(new Date(), -179));
      const windowStartMs = windowStart.getTime();
      const windowEndMs = windowEnd.getTime();
      const trendCurrentStartMs = trendCurrentStart.getTime();
      const trendPreviousStartMs = trendPreviousStart.getTime();

      const [budgetSnap, alignmentSnap, txSnap] = await Promise.all([
        getDoc(doc(db, 'monzo_budget_summary', currentUser.uid)),
        getDoc(doc(db, 'monzo_goal_alignment', currentUser.uid)),
        getDocs(query(
          collection(db, 'monzo_transactions'),
          where('ownerUid', '==', currentUser.uid),
          where('createdAt', '>=', trendPreviousStart),
          where('createdAt', '<', windowEnd),
          orderBy('createdAt', 'desc'),
          limit(1200),
        )).catch(() => null),
      ]);

      if (!budgetSnap.exists && !alignmentSnap.exists) {
        setMonzoSummary(null);
      } else {
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
      }

      if (!txSnap) {
        setFinanceWindowSummary(null);
        setFinanceTrendSummary(null);
      } else {
        let mandatoryPence = 0;
        let discretionaryPence = 0;
        let uncategorisedPence = 0;
        let currentDiscretionaryPence = 0;
        let previousDiscretionaryPence = 0;
        let currentUncategorisedPence = 0;
        let previousUncategorisedPence = 0;

        txSnap.forEach((docSnap) => {
          const tx: any = docSnap.data() || {};
          const amount = extractMonzoAmountPence(tx);
          if (amount >= 0) return;

          const bucket = resolveMonzoBucket(tx);
          if (FINANCE_INCOME_BUCKETS.has(bucket)) return;

          const spendPence = Math.abs(amount);
          const txDate = decodeToDate(tx.createdAt || tx.createdISO || tx.created_at || tx.settledAt || tx.updatedAt);
          const txMs = txDate?.getTime() ?? NaN;

          if (bucket === 'mandatory') {
            if (Number.isFinite(txMs) && txMs >= windowStartMs && txMs < windowEndMs) mandatoryPence += spendPence;
            return;
          }
          if (bucket === 'discretionary') {
            if (Number.isFinite(txMs) && txMs >= windowStartMs && txMs < windowEndMs) discretionaryPence += spendPence;
            if (Number.isFinite(txMs) && txMs >= trendCurrentStartMs && txMs < windowEndMs) {
              currentDiscretionaryPence += spendPence;
            } else if (Number.isFinite(txMs) && txMs >= trendPreviousStartMs && txMs < trendCurrentStartMs) {
              previousDiscretionaryPence += spendPence;
            }
            return;
          }
          if (FINANCE_UNCATEGORISED_BUCKETS.has(bucket)) {
            if (Number.isFinite(txMs) && txMs >= windowStartMs && txMs < windowEndMs) uncategorisedPence += spendPence;
            if (Number.isFinite(txMs) && txMs >= trendCurrentStartMs && txMs < windowEndMs) {
              currentUncategorisedPence += spendPence;
            } else if (Number.isFinite(txMs) && txMs >= trendPreviousStartMs && txMs < trendCurrentStartMs) {
              previousUncategorisedPence += spendPence;
            }
          }
        });

        setFinanceWindowSummary({
          windowDays: FINANCE_WINDOW_DAYS,
          mandatoryPence,
          discretionaryPence,
          uncategorisedPence,
        });
        setFinanceTrendSummary({
          discretionaryPence: {
            current: currentDiscretionaryPence,
            previous: previousDiscretionaryPence,
            delta: currentDiscretionaryPence - previousDiscretionaryPence,
          },
          uncategorisedPence: {
            current: currentUncategorisedPence,
            previous: previousUncategorisedPence,
            delta: currentUncategorisedPence - previousUncategorisedPence,
          },
        });
      }
    } catch (error) {
      console.warn('Failed to load Monzo summary', error);
      setMonzoSummary(null);
      setFinanceWindowSummary(null);
      setFinanceTrendSummary(null);
    }
  };

  const handleReplan = async () => {
    if (!currentUser) return;
    setReplanFeedback(null);
    setReplanLoading(true);
    try {
      const payload = await callDeltaReplan(functions, { days: 7 });
      const parts = formatDeltaReplanSummary(payload);
      setReplanFeedback(parts.length ? `Delta replan complete: ${parts.join(', ')}.` : 'Delta replan complete.');
      fetchNextWorkRecommendation({ silent: true });
    } catch (e) {
      console.error('Replan failed', e);
      setReplanFeedback(normalizePlannerCallableError(e, 'Delta replan failed. Please retry.'));
    } finally {
      setReplanLoading(false);
    }
  };

  const handleFullReplan = async () => {
    if (!currentUser) return;
    setReplanFeedback(null);
    setFullReplanLoading(true);
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
      fetchNextWorkRecommendation({ silent: true });
    } catch (e) {
      console.error('Full replan failed', e);
      setReplanFeedback(normalizePlannerCallableError(e, 'Full replan failed. Please retry.'));
    } finally {
      setFullReplanLoading(false);
    }
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

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setActiveFocusGoalIds(new Set());
      return;
    }

    const activeFocusQuery = query(
      collection(db, 'focusGoals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('isActive', '==', true)
    );

    const unsubscribe = onSnapshot(activeFocusQuery, (snap) => {
      const ids = new Set<string>();
      snap.docs.forEach((docSnap) => {
        const row = docSnap.data() as any;
        const goalIds = Array.isArray(row?.goalIds) ? row.goalIds : [];
        goalIds.forEach((goalId: any) => {
          const normalized = String(goalId || '').trim();
          if (normalized) ids.add(normalized);
        });
      });
      setActiveFocusGoalIds(ids);
    }, (err) => {
      console.warn('Failed to load active focus goals for dashboard alignment', err);
      setActiveFocusGoalIds(new Set());
    });

    return () => unsubscribe();
  }, [currentUser, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid || !selectedSprintId) {
      setSelectedSprintAuditSnapshot(null);
      return;
    }

    const auditDocId = `${currentUser.uid}_${selectedSprintId}`;
    const unsubscribe = onSnapshot(doc(db, 'sprint_alignment_audit', auditDocId), (snap) => {
      if (!snap.exists()) {
        setSelectedSprintAuditSnapshot(null);
        return;
      }
      const row = snap.data() as any;
      const updatedAtRaw = row?.updatedAt;
      const updatedAtMs = typeof updatedAtRaw?.toMillis === 'function'
        ? updatedAtRaw.toMillis()
        : (Number.isFinite(Number(updatedAtRaw)) ? Number(updatedAtRaw) : null);
      setSelectedSprintAuditSnapshot({
        unalignedStories: Number(row?.unalignedStories || 0),
        alignmentPct: Number(row?.alignmentPct || 100),
        updatedAtMs,
      });
    }, () => {
      setSelectedSprintAuditSnapshot(null);
    });

    return () => unsubscribe();
  }, [currentUser?.uid, selectedSprintId]);

  useEffect(() => {
    if (!currentUser?.uid || !selectedSprintId) {
      setStrictAlignmentViolations({ last24h: 0, last7d: 0, lastViolationAt: null });
      return;
    }

    const logsQuery = query(
      collection(db, 'integration_logs'),
      where('userId', '==', currentUser.uid),
      where('integration', '==', 'sprint_alignment'),
      where('type', '==', 'strict_enforcement'),
      where('status', '==', 'blocked'),
      limit(200),
    );

    const unsubscribe = onSnapshot(logsQuery, (snap) => {
      const nowMs = Date.now();
      const cutoff24h = nowMs - (24 * 60 * 60 * 1000);
      const cutoff7d = nowMs - (7 * 24 * 60 * 60 * 1000);
      let last24h = 0;
      let last7d = 0;
      let lastViolationAt: number | null = null;

      snap.docs.forEach((docSnap) => {
        const row = docSnap.data() as any;
        if (String(row?.sprintId || '') !== String(selectedSprintId)) return;
        const timestampRaw = row?.timestamp;
        const ts = typeof timestampRaw?.toMillis === 'function'
          ? timestampRaw.toMillis()
          : (Number.isFinite(Number(timestampRaw)) ? Number(timestampRaw) : null);
        if (!ts) return;
        if (ts >= cutoff7d) last7d += 1;
        if (ts >= cutoff24h) last24h += 1;
        if (!lastViolationAt || ts > lastViolationAt) lastViolationAt = ts;
      });

      setStrictAlignmentViolations({ last24h, last7d, lastViolationAt });
    }, () => {
      setStrictAlignmentViolations({ last24h: 0, last7d: 0, lastViolationAt: null });
    });

    return () => unsubscribe();
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
    if (financeWindowSummary) {
      const currency = 'GBP';
      return `Last ${financeWindowSummary.windowDays}d · M ${formatPenceCompact(financeWindowSummary.mandatoryPence, currency)} · D ${formatPenceCompact(financeWindowSummary.discretionaryPence, currency)} · U ${formatPenceCompact(financeWindowSummary.uncategorisedPence, currency)}`;
    }
    const spent = monzoSummary?.totals?.spent;
    const budget = monzoSummary?.totals?.budget;
    if (spent == null || budget == null) return '£0 spent';
    const remaining = budget - spent;
    return `£${(spent / 100).toFixed(0)} spent · £${(remaining / 100).toFixed(0)} left`;
  }, [financeWindowSummary, formatPenceCompact, monzoSummary]);

  const financeSyncSummary = useMemo(() => {
    const syncDate = monzoLastSyncDate || decodeToDate(monzoSummary?.updatedAt);
    if (!syncDate) return 'Last sync unavailable';
    const stamp = syncDate.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    return `Last sync ${stamp}`;
  }, [decodeToDate, monzoLastSyncDate, monzoSummary]);

  const savingsRunwayRows = useMemo(() => {
    const goals = Array.isArray(monzoSummary?.goalAlignment?.goals)
      ? monzoSummary.goalAlignment.goals
      : [];
    const avgMonthlySavingsGlobal = Number(monzoSummary?.goalAlignment?.goalFundingPlan?.avgMonthlySavings || 0) || 0;

    const rows = goals
      .map((goal: any) => {
        const linkedPotId = goal?.potId || null;
        const linkedPotName = goal?.potName || null;
        if (!linkedPotId && !linkedPotName) return null;

        const targetAmount = Number(goal?.estimatedCost || 0) || 0;
        const linkedPotBalance = Number(goal?.potBalance || 0) || 0;
        const remainingAmount = Math.max(targetAmount - linkedPotBalance, 0);
        const avgMonthlyAllocationRaw = Number(
          goal?.avgMonthlyAllocation3mo
          || goal?.avgMonthlyAllocation
          || goal?.monthlyAllocation3mo
          || 0,
        ) || 0;
        const avgMonthlyAllocation = avgMonthlyAllocationRaw > 0
          ? avgMonthlyAllocationRaw
          : (avgMonthlySavingsGlobal > 0 ? avgMonthlySavingsGlobal : null);
        const monthsToTarget = remainingAmount <= 0
          ? 0
          : (avgMonthlyAllocation && avgMonthlyAllocation > 0
            ? Math.ceil(remainingAmount / avgMonthlyAllocation)
            : (Number.isFinite(Number(goal?.monthsToSave)) ? Number(goal.monthsToSave) : null));

        return {
          goalId: String(goal?.goalId || ''),
          goalTitle: String(goal?.title || 'Goal'),
          themeName: String(goal?.themeName || 'General'),
          targetAmount,
          linkedPotBalance,
          avgMonthlyAllocation,
          remainingAmount,
          monthsToTarget,
          shortfall: Number(goal?.shortfall || remainingAmount || 0) || 0,
        };
      })
      .filter(Boolean) as Array<{
        goalId: string;
        goalTitle: string;
        themeName: string;
        targetAmount: number;
        linkedPotBalance: number;
        avgMonthlyAllocation: number | null;
        remainingAmount: number;
        monthsToTarget: number | null;
        shortfall: number;
      }>;

    const filtered = runwayThemeFilter === 'all'
      ? rows
      : rows.filter((row) => row.themeName === runwayThemeFilter);

    return filtered.sort((a, b) => {
      if (runwaySortMode === 'shortfall') return b.shortfall - a.shortfall;
      if (runwaySortMode === 'theme') {
        const byTheme = a.themeName.localeCompare(b.themeName);
        if (byTheme !== 0) return byTheme;
      }
      const aMonths = Number.isFinite(Number(a.monthsToTarget)) ? Number(a.monthsToTarget) : Number.MAX_SAFE_INTEGER;
      const bMonths = Number.isFinite(Number(b.monthsToTarget)) ? Number(b.monthsToTarget) : Number.MAX_SAFE_INTEGER;
      if (aMonths !== bMonths) return aMonths - bMonths;
      return b.shortfall - a.shortfall;
    });
  }, [monzoSummary, runwaySortMode, runwayThemeFilter]);

  const savingsRunwayThemes = useMemo(() => {
    const themes = new Set<string>();
    (Array.isArray(monzoSummary?.goalAlignment?.goals) ? monzoSummary.goalAlignment.goals : []).forEach((goal: any) => {
      if (goal?.themeName) themes.add(String(goal.themeName));
    });
    return Array.from(themes).sort((a, b) => a.localeCompare(b));
  }, [monzoSummary]);

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

    const totalPoints = sprintStories.reduce((sum, story) => sum + (Number.isFinite(Number(story.points)) ? Number(story.points) : 0), 0);
    const completedPoints = sprintStories
      .filter((story) => story.status === 4)
      .reduce((sum, story) => sum + (Number.isFinite(Number(story.points)) ? Number(story.points) : 0), 0);

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

  const focusAlignmentSummary = useMemo(() => {
    const hasSelectedSprint = Boolean(selectedSprintId);
    const selectedSprintIsActive = hasSelectedSprint && isSprintActiveStatus((selectedSprint as any)?.status);
    const hasActiveFocus = selectedSprintIsActive && activeFocusGoalIds.size > 0;

    if (!hasActiveFocus) {
      return {
        hasActiveFocus: false,
        totalSprintStories: sprintStories.length,
        unalignedStories: 0,
        focusedStories: 0,
        focusedStoriesDone: 0,
        focusedCompletionPct: 0,
        alignmentPct: 100,
      };
    }

    const unalignedStories = sprintStories.filter((story) => {
      const goalId = String((story as any).goalId || '').trim();
      return !goalId || !isGoalInHierarchySet(goalId, goalsList, activeFocusGoalIds);
    });
    const focusedStories = sprintStories.filter((story) => {
      const goalId = String((story as any).goalId || '').trim();
      return !!goalId && isGoalInHierarchySet(goalId, goalsList, activeFocusGoalIds);
    });
    const focusedStoriesDone = focusedStories.filter((story) => isStoryDoneState((story as any).status)).length;
    const focusedCompletionPct = focusedStories.length > 0
      ? Math.round((focusedStoriesDone / focusedStories.length) * 100)
      : 0;
    const alignmentPct = sprintStories.length > 0
      ? Math.max(0, Math.round(((sprintStories.length - unalignedStories.length) / sprintStories.length) * 100))
      : 100;

    return {
      hasActiveFocus: true,
      totalSprintStories: sprintStories.length,
      unalignedStories: unalignedStories.length,
      focusedStories: focusedStories.length,
      focusedStoriesDone,
      focusedCompletionPct,
      alignmentPct,
    };
  }, [activeFocusGoalIds, goalsList, selectedSprint, selectedSprintId, sprintStories]);

  const selectedSprintAlignmentSummary = useMemo(() => {
    if (!selectedSprint) {
      return {
        hasSprint: false,
        mode: 'warn' as 'warn' | 'strict',
        focusGoalCount: 0,
      };
    }

    const focusGoalIds = Array.isArray((selectedSprint as any)?.focusGoalIds)
      ? (selectedSprint as any).focusGoalIds.map((goalId: any) => String(goalId || '').trim()).filter((goalId: string) => !!goalId)
      : [];
    const mode = String((selectedSprint as any)?.alignmentMode || 'warn').toLowerCase() === 'strict' ? 'strict' : 'warn';

    return {
      hasSprint: true,
      mode,
      focusGoalCount: focusGoalIds.length,
    };
  }, [selectedSprint]);

  const renderUnifiedTodayTimelineItem = useCallback((item: any) => {
    const startLabel = Number.isFinite(item?.startMs) ? format(new Date(item.startMs), 'HH:mm') : 'Anytime';
    const endLabel = Number.isFinite(item?.endMs) ? format(new Date(item.endMs), 'HH:mm') : null;
    const timeLabel = endLabel ? `${startLabel} - ${endLabel}` : startLabel;
    const sourceLabel = String(item?.sourceLabel || '').trim().toLowerCase();
    const sourceBadge = sourceLabel === 'auto-planned'
      ? { bg: 'success', text: 'auto-planned' }
      : sourceLabel === 'linked from gcal'
        ? { bg: 'info', text: 'linked from gcal' }
        : { bg: 'secondary', text: 'manual' };
    const activityButtonBaseStyle: React.CSSProperties = {
      color: 'var(--bs-secondary-color)',
      padding: 4,
      borderRadius: 4,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      lineHeight: 0,
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
    };
    const renderActivityButton = (
      target: any,
      targetType: 'task' | 'story' | null,
      label: string
    ) => {
      const enabled = !!target && !!targetType;
      return (
        <button
          type="button"
          onClick={() => {
            if (enabled && targetType) showSidebar(target, targetType);
          }}
          title={enabled ? `Open activity stream for ${label}` : 'No activity stream linked'}
          aria-label={enabled ? `Open activity stream for ${label}` : 'No activity stream linked'}
          disabled={!enabled}
          style={{
            ...activityButtonBaseStyle,
            color: enabled ? 'var(--bs-secondary-color)' : 'var(--bs-tertiary-color)',
            cursor: enabled ? 'pointer' : 'not-allowed',
            opacity: enabled ? 1 : 0.7,
          }}
        >
          <Activity size={14} />
        </button>
      );
    };

    if (item?.kind === 'task' && item?.task) {
      const task: Task = item.task;
      const dueMs = getTaskDueMs(task);
      const aiScore = (task as any).aiCriticalityScore ?? (task as any).aiPriorityScore;
      const refLabel = taskRefLabel(task);
      const priorityBadge = getPriorityBadge((task as any).priority);

      const taskDone = Number(task.status ?? 0) >= 2;
      return (
        <div key={item.id} className={`border rounded p-2 mb-2 dashboard-due-item${taskDone ? ' opacity-50' : ''}`}>
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div className="d-flex align-items-start gap-2 flex-grow-1 min-w-0">
              <input
                type="checkbox"
                checked={taskDone}
                className="mt-1 flex-shrink-0"
                style={{ cursor: 'pointer', width: 15, height: 15 }}
                title={taskDone ? 'Mark not done' : 'Mark done'}
                onChange={() => handleTaskStatusChange(task, taskDone ? 0 : 2)}
              />
              <div className="fw-semibold small">
                <a href="#" className={`text-decoration-none${taskDone ? ' text-decoration-line-through text-muted' : ''}`} onClick={(e) => { e.preventDefault(); setInlineEditTask(task); }}>
                  {task.title}
                </a>
              </div>
            </div>
            <div className="d-flex align-items-center gap-1 flex-shrink-0">
              <Badge bg={item.source === 'calendar' ? 'primary' : 'secondary'}>{item.source === 'calendar' ? 'Scheduled' : 'Due'}</Badge>
              <Badge bg={sourceBadge.bg}>{sourceBadge.text}</Badge>
              {renderActivityButton(task, 'task', task.title || 'task')}
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 11 }}>
            {refLabel ? `${refLabel} · ` : ''}{timeLabel}
          </div>
          <div className="d-flex align-items-center gap-2 mt-1 flex-wrap">
            <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: 11 }}>
              <Clock size={11} />
              <input
                type="date"
                className="dashboard-due-date-input"
                value={dueMs ? format(new Date(dueMs), 'yyyy-MM-dd') : ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) return;
                  handleTaskDueDateChange(task, new Date(`${val}T12:00:00`).getTime());
                }}
              />
            </span>
            <span className="dashboard-chip-select-wrap">
              <select
                className="dashboard-chip-select"
                value={Number((task as any).priority ?? 0)}
                onChange={(e) => handleTaskPriorityChange(task, Number(e.target.value))}
                style={{
                  backgroundColor: `var(--bs-${priorityBadge.bg})`,
                  color: priorityBadge.bg === 'warning' || priorityBadge.bg === 'orange' || priorityBadge.bg === 'light' ? '#000' : '#fff',
                }}
              >
                <option value={0}>None</option>
                <option value={1}>Low</option>
                <option value={2}>Medium</option>
                <option value={3}>High</option>
                <option value={4}>Critical</option>
              </select>
            </span>
            {(() => {
              const statusVal = Number(task.status ?? 0);
              const statusMap: Record<number, { bg: string; label: string }> = {
                0: { bg: 'secondary', label: 'To do' },
                1: { bg: 'primary', label: 'Doing' },
                2: { bg: 'success', label: 'Done' },
              };
              const s = statusMap[statusVal] || statusMap[0];
              return (
                <span className="dashboard-chip-select-wrap">
                  <select
                    className="dashboard-chip-select"
                    value={statusVal}
                    onChange={(e) => handleTaskStatusChange(task, Number(e.target.value))}
                    style={{ backgroundColor: `var(--bs-${s.bg})`, color: '#fff' }}
                  >
                    <option value={0}>To do</option>
                    <option value={1}>Doing</option>
                    <option value={2}>Done</option>
                  </select>
                </span>
              );
            })()}
            <span className="text-muted" style={{ fontSize: 11 }}>
              AI {aiScore != null ? Math.round(aiScore) : '—'}
            </span>
          </div>
        </div>
      );
    }

    if ((item?.kind === 'chore' || item?.kind === 'routine' || item?.kind === 'habit') && item?.task) {
      const task: Task = item.task;
      const kind = getChoreKind(task);
      const busy = kind ? !!choreCompletionBusy[task.id] : false;
      const badgeVariant = kind === 'routine' ? 'success' : kind === 'habit' ? 'secondary' : 'primary';
      const badgeLabel = kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore';
      return (
        <div key={item.id} className="border rounded p-2 mb-2 d-flex align-items-start gap-2">
          <Form.Check
            type="checkbox"
            checked={busy}
            disabled={busy}
            onChange={() => void handleCompleteChoreTask(task)}
            aria-label={`Complete ${task.title}`}
          />
          <div className="flex-grow-1">
            <a href="#" className="text-decoration-none fw-semibold small" onClick={(e) => { e.preventDefault(); setInlineEditTask(task); }}>
              {task.title}
            </a>
            <div className="text-muted" style={{ fontSize: 11 }}>{timeLabel}</div>
          </div>
          <div className="d-flex align-items-center gap-1">
            <Badge bg={badgeVariant}>{badgeLabel}</Badge>
            <Badge bg={sourceBadge.bg}>{sourceBadge.text}</Badge>
            {renderActivityButton(task, 'task', task.title || 'task')}
          </div>
        </div>
      );
    }

    if (item?.kind === 'story') {
      const story = item.story as Story | undefined;
      const storyDone = Number(story?.status ?? 0) >= 4;
      return (
        <div key={item.id} className={`border rounded p-2 mb-2 dashboard-due-item${storyDone ? ' opacity-50' : ''}`}>
          <div className="d-flex align-items-start justify-content-between gap-2">
            <div className="d-flex align-items-start gap-2 flex-grow-1 min-w-0">
              {story && (
                <input
                  type="checkbox"
                  checked={storyDone}
                  className="mt-1 flex-shrink-0"
                  style={{ cursor: 'pointer', width: 15, height: 15 }}
                  title={storyDone ? 'Mark not done' : 'Mark done'}
                  onChange={() => handleStoryStatusChange(story, storyDone ? 2 : 4)}
                />
              )}
              <div className="fw-semibold small">
                <a
                  href="#"
                  className={`text-decoration-none${storyDone ? ' text-decoration-line-through text-muted' : ''}`}
                  onClick={(e) => {
                    e.preventDefault();
                    if (story) setInlineEditStory(story);
                  }}
                >
                  {item.title}
                </a>
              </div>
            </div>
            <div className="d-flex align-items-center gap-1 flex-shrink-0">
              <Badge bg="info">Story</Badge>
              <Badge bg={sourceBadge.bg}>{sourceBadge.text}</Badge>
              {renderActivityButton(story, 'story', item.title || 'story')}
            </div>
          </div>
          <div className="text-muted" style={{ fontSize: 11 }}>{timeLabel}</div>
        </div>
      );
    }

    return (
      <div key={item.id} className="border rounded p-2 mb-2 dashboard-due-item">
        <div className="d-flex align-items-start justify-content-between gap-2">
          <div className="fw-semibold small flex-grow-1">{item.title}</div>
          <div className="d-flex align-items-center gap-1">
            <Badge bg="secondary">Calendar</Badge>
            <Badge bg={sourceBadge.bg}>{sourceBadge.text}</Badge>
            {renderActivityButton(null, null, item.title || 'calendar event')}
          </div>
        </div>
        <div className="text-muted" style={{ fontSize: 11 }}>{timeLabel}</div>
      </div>
    );
  }, [
    choreCompletionBusy,
    getChoreKind,
    getTaskDueMs,
    handleCompleteChoreTask,
    handleTaskDueDateChange,
    handleTaskPriorityChange,
    handleTaskStatusChange,
    showSidebar,
    setInlineEditStory,
    setInlineEditTask,
    taskRefLabel,
  ]);

  if (!currentUser) {
    return <div>Please sign in to view your dashboard.</div>;
  }

  return (
    <>
      <Container fluid className="p-2 dashboard-compact">
        <Row>
          <Col>
            <BirthdayMilestoneCard 
              targetDate={new Date('2027-09-22')} 
              age={45} 
              linkedGoalsCount={goalsList.length} 
            />

            {stats.tasksUnlinked > 0 && (
              <div className="mb-2">
                <Badge bg="warning" text="dark" pill>
                  {stats.tasksUnlinked} unlinked tasks
                </Badge>
              </div>
            )}

            {showPersistentDashboardBanners && healthBannerData && showHealthBanner && (
              <Card
                className="mb-3"
                style={{
                  background: healthBannerData.macroTone === 'success'
                    ? 'linear-gradient(135deg, #198754 0%, #0f5132 100%)'
                    : healthBannerData.macroTone === 'warning'
                      ? 'linear-gradient(135deg, #fd7e14 0%, #b35c00 100%)'
                      : 'linear-gradient(135deg, #0d6efd 0%, #0b5ed7 100%)',
                  border: 'none',
                  color: '#fff',
                  boxShadow: '0 6px 18px rgba(13, 110, 253, 0.18)'
                }}
              >
                <Card.Body style={{ padding: '8px 12px' }}>
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <div
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 6,
                        backgroundColor: 'rgba(255, 255, 255, 0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        backdropFilter: 'blur(10px)',
                        flexShrink: 0,
                      }}
                    >
                      <Heart size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ margin: 0, fontSize: 11, fontWeight: 700 }}>
                        Daily Health Progress
                      </div>
                      <div style={{ marginTop: 2, fontSize: 9, opacity: 0.9 }}>
                        {healthBannerData.weightKg != null ? `${healthBannerData.weightKg.toFixed(1)} kg` : 'weight missing'}
                        {' • '}
                        {healthBannerData.bodyFatPct != null ? `${healthBannerData.bodyFatPct.toFixed(1)}% body fat` : 'body fat missing'}
                        {' • '}
                        {healthBannerData.targetWeightKg != null ? `target ${healthBannerData.targetWeightKg.toFixed(1)} kg` : 'set weight target'}
                        {' / '}
                        {healthBannerData.targetBodyFatPct != null ? `${healthBannerData.targetBodyFatPct.toFixed(1)}%` : 'set body-fat target'}
                        {' • '}
                        {healthBannerData.weeksToTargetBodyFat != null ? `${Math.round(healthBannerData.weeksToTargetBodyFat)}w ETA` : 'ETA n/a'}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 52 }}>
                      <div style={{ fontSize: 15, fontWeight: 800, lineHeight: 1 }}>
                        {healthBannerData.primaryProgressPct != null ? `${healthBannerData.primaryProgressPct}%` : '—'}
                      </div>
                      <div style={{ fontSize: 9, opacity: 0.85 }}>
                        {healthBannerData.primaryProgressLabel}
                      </div>
                    </div>
                    <button
                      onClick={handleDismissHealthBanner}
                      style={{
                        background: 'rgba(255, 255, 255, 0.2)',
                        border: 'none',
                        color: '#fff',
                        cursor: 'pointer',
                        padding: 4,
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                      title="Dismiss for 3 days"
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap" style={{ marginTop: 5, fontSize: 9, opacity: 0.9 }}>
                    <div>
                      Source {healthBannerData.sourceLabel}
                      {' • '}
                      {healthBannerData.stepsToday != null ? `${Math.round(healthBannerData.stepsToday).toLocaleString()} steps` : 'steps missing'}
                      {' • '}
                      {healthBannerData.workoutMinutesToday != null ? `${Math.round(healthBannerData.workoutMinutesToday)} min workout` : 'workout missing'}
                      {' • '}
                      {healthBannerData.macroAdherencePct != null ? `${healthBannerData.macroAdherencePct}% macros` : 'macro targets missing'}
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      {healthBannerData.missingTargets && (
                        <Button variant="light" size="sm" onClick={() => navigate('/settings?tab=profile')}>
                          Set targets
                        </Button>
                      )}
                      <Button variant="outline-light" size="sm" onClick={() => navigate('/fitness')}>
                        View health
                      </Button>
                    </div>
                  </div>
                </Card.Body>
              </Card>
            )}

            {showPersistentDashboardBanners && showMonzoReconnectBanner && (
              <Alert variant="warning" className="d-flex align-items-center justify-content-between flex-wrap gap-1 py-1 px-2 mb-1" style={{ fontSize: 11 }}>
                <div>
                  <span className="fw-semibold">Monzo sync stale</span>
                  <span className="text-muted ms-1">— {monzoSyncAgeDays}d ago{monzoReconnectMsg ? ` · ${monzoReconnectMsg}` : ''}</span>
                </div>
                <Button variant="outline-dark" size="sm" style={{ fontSize: 10, padding: '1px 8px' }} onClick={handleMonzoReconnect} disabled={monzoReconnectBusy}>
                  {monzoReconnectBusy ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                  Reconnect
                </Button>
              </Alert>
            )}

            {showPersistentDashboardBanners && showStravaReconnectBanner && (
              <Alert variant="warning" className="d-flex align-items-center justify-content-between flex-wrap gap-1 py-1 px-2 mb-1" style={{ fontSize: 11 }}>
                <div>
                  <span className="fw-semibold">Strava sync stale</span>
                  <span className="text-muted ms-1">— {stravaSyncAgeDays}d ago</span>
                </div>
                <Button variant="outline-dark" size="sm" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => navigate('/settings/integrations/strava')}>
                  Reconnect
                </Button>
              </Alert>
            )}

            {showPersistentDashboardBanners && showTraktReconnectBanner && (
              <Alert variant="warning" className="d-flex align-items-center justify-content-between flex-wrap gap-1 py-1 px-2 mb-1" style={{ fontSize: 11 }}>
                <div>
                  <span className="fw-semibold">Trakt sync stale</span>
                  <span className="text-muted ms-1">— {traktSyncAgeDays}d ago</span>
                </div>
                <Button variant="outline-dark" size="sm" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => navigate('/settings/integrations/trakt')}>
                  Settings
                </Button>
              </Alert>
            )}

            {showPersistentDashboardBanners && showHardcoverReconnectBanner && (
              <Alert variant="warning" className="d-flex align-items-center justify-content-between flex-wrap gap-1 py-1 px-2 mb-1" style={{ fontSize: 11 }}>
                <div>
                  <span className="fw-semibold">Hardcover sync stale</span>
                  <span className="text-muted ms-1">— {hardcoverSyncAgeDays}d ago</span>
                </div>
                <Button variant="outline-dark" size="sm" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => navigate('/settings/integrations/hardcover')}>
                  Settings
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
                      {/* Overall Progress Group */}
                      <Col xs={12} sm={6} lg={6} xl={3}>
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
                          <div className="flex-grow-1" title={`Points: ${stats.storyPointsCompletion || 0}% · Goals: ${stats.goalCompletion || 0}% · Savings: ${savingsMetrics.savingsPct}% · Saved ${formatPotBalance(savingsMetrics.totalSavedPence)} of ${savingsMetrics.totalEstimated ? savingsMetrics.totalEstimated.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' }) : '£0'}`}>
                            <div className="text-muted small">Progress</div>
                            <div className="fw-semibold">{stats.storyPointsCompletion || 0}%pts · {stats.goalCompletion || 0}%g · {savingsMetrics.savingsPct}%sav</div>
                          </div>
                        </div>
                      </Col>

                      {/* Daily Completion Group */}
                      <Col xs={12} sm={6} lg={6} xl={3}>
                        <div
                          className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100"
                          style={{
                            background: 'var(--bs-body-bg)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                          }}
                          onClick={() => setDailyCompletionTrendExpanded((prev) => !prev)}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-info-bg-subtle)';
                            e.currentTarget.style.borderColor = 'var(--bs-info)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                            e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                          }}
                        >
                          <TrendingUp size={16} className="text-info" />
                          <div className="flex-grow-1" title={`Today: Str ${todayCompletionSnapshot?.storyCompleted ?? 0}/${todayCompletionSnapshot?.storyDue ?? 0} · Tsk ${todayCompletionSnapshot?.taskCompleted ?? 0}/${todayCompletionSnapshot?.taskDue ?? 0} · Ch ${todayCompletionSnapshot?.choreCompleted ?? 0}/${todayCompletionSnapshot?.choreDue ?? 0} | 7d: ${completionSevenDayPct}%`}>
                            <div className="text-muted small">Completion</div>
                            <div className="fw-semibold">
                              {todayCompletionSnapshot
                                ? `${todayCompletionSnapshot.totalPct}% (${todayCompletionSnapshot.totalCompleted}/${todayCompletionSnapshot.totalDue})`
                                : 'No due items'}
                              {' '}· 7d {completionSevenDayPct}%
                            </div>
                          </div>
                        </div>
                      </Col>

                      {/* Finance Group */}
                      <Col xs={12} sm={6} lg={6} xl={3}>
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
                          <div className="flex-grow-1" title={`${financeSummary} | D90: ${financeDiscretionary90 != null ? formatPenceCompact(financeDiscretionary90, 'GBP') : '—'} U90: ${financeUncategorised90 != null ? formatPenceCompact(financeUncategorised90, 'GBP') : '—'} | ${financeSyncSummary}`}>
                            <div className="text-muted small">Finance</div>
                            <div className="fw-semibold">{financeSummary}</div>
                            <div className="text-muted small">
                              D90 {financeDiscretionary90 != null ? formatPenceCompact(financeDiscretionary90, 'GBP') : '—'}
                              {lowerBetterTrendArrow(financeDiscretionaryDelta)}
                              {' '}· U90 {financeUncategorised90 != null ? formatPenceCompact(financeUncategorised90, 'GBP') : '—'}
                              {lowerBetterTrendArrow(financeUncategorisedDelta)}
                            </div>
                          </div>
                        </div>
                      </Col>

                      {/* Goals Missing Pot Group */}
                      <Col xs={6} sm={4} lg={3} xl={2}>
                        <div
                          className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100"
                          style={{
                            background: 'var(--bs-body-bg)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onClick={() => navigate('/goals?filter=cost_without_pot')}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-warning-bg-subtle)';
                            e.currentTarget.style.borderColor = 'var(--bs-warning)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                            e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                          }}
                        >
                          <Target size={16} className="text-warning" />
                          <div className="flex-grow-1" title="Cost-linked goals without a linked Monzo pot">
                            <div className="text-muted small">NoPot</div>
                            <div className="fw-semibold">{goalsMissingPotWithCostCount} goals</div>
                          </div>
                        </div>
                      </Col>

                      {/* Capacity Group */}
                      <Col xs={6} sm={4} lg={3} xl={2}>
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
                          <div className="flex-grow-1" title={hasSelectedSprint && capacitySummary ? `Utilization: ${capacitySummary.utilization}% · Free: ${capacitySummary.free.toFixed(1)}h` : 'No sprint selected'}>
                            <div className="text-muted small">Capacity</div>
                            <div className="fw-semibold">
                              {hasSelectedSprint && capacitySummary ? `${capacitySummary.utilization}% · ${capacitySummary.free.toFixed(1)}h free` : 'Select sprint'}
                            </div>
                          </div>
                        </div>
                      </Col>

                      {/* Focus Alignment Group */}
                      <Col xs={12} sm={6} lg={6} xl={3}>
                        <div
                          className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100"
                          style={{
                            background: 'var(--bs-body-bg)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onClick={() => navigate('/focus-goals')}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-warning-bg-subtle)';
                            e.currentTarget.style.borderColor = 'var(--bs-warning)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                            e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                          }}
                        >
                          <Target size={16} className={focusAlignmentSummary.unalignedStories > 0 ? 'text-warning' : 'text-success'} />
                          <div
                            className="flex-grow-1"
                            title={focusAlignmentSummary.hasActiveFocus
                              ? `${focusAlignmentSummary.unalignedStories} unaligned stories in current sprint. Focus stories: ${focusAlignmentSummary.focusedStoriesDone}/${focusAlignmentSummary.focusedStories} complete. Alignment ${focusAlignmentSummary.alignmentPct}%.`
                              : 'No active focus period for this sprint/persona. Open Focus page for details.'}
                          >
                            <div className="text-muted small">Focus Alignment Status</div>
                            <div className="fw-semibold" style={{ fontSize: '0.85rem' }}>
                              {focusAlignmentSummary.hasActiveFocus
                                ? `${focusAlignmentSummary.unalignedStories} unaligned · ${focusAlignmentSummary.alignmentPct}% aligned`
                                : 'No active focus'}
                            </div>
                            <div className="text-muted small">
                              {selectedSprintAlignmentSummary.hasSprint
                                ? `Mode ${selectedSprintAlignmentSummary.mode === 'strict' ? 'Strict' : 'Warn'} · ${selectedSprintAlignmentSummary.focusGoalCount} sprint focus goals`
                                : 'Select a sprint to view alignment mode'}
                            </div>
                            <div className="text-muted small">
                              {selectedSprintAlignmentSummary.mode === 'strict'
                                ? `Strict blocks: ${strictAlignmentViolations.last24h} (24h) · ${strictAlignmentViolations.last7d} (7d)`
                                : 'Strict-mode enforcement inactive for this sprint'}
                              {selectedSprintAlignmentSummary.mode === 'strict' && strictAlignmentViolations.lastViolationAt
                                ? ` · Last ${new Date(strictAlignmentViolations.lastViolationAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                                : ''}
                            </div>
                            {selectedSprintAuditSnapshot && (
                              <div className="text-muted small">
                                Audit: {selectedSprintAuditSnapshot.unalignedStories} unaligned · {selectedSprintAuditSnapshot.alignmentPct}% aligned
                              </div>
                            )}
                            <div className="text-muted small">
                              {focusAlignmentSummary.hasActiveFocus
                                ? `${focusAlignmentSummary.focusedStoriesDone}/${focusAlignmentSummary.focusedStories} focus stories done (${focusAlignmentSummary.focusedCompletionPct}%) · View details on Focus page`
                                : 'View details on Focus page'}
                            </div>
                          </div>
                        </div>
                      </Col>

                      {/* Fitness Group */}
                      <Col xs={12} sm={6} lg={6} xl={5}>
                        <div
                          className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100"
                          style={{
                            background: 'var(--bs-body-bg)',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease'
                          }}
                          onClick={() => navigate('/fitness')}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-success-bg-subtle)';
                            e.currentTarget.style.borderColor = 'var(--bs-success)';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                            e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                          }}
                        >
                          <Activity size={16} className="text-success" />
                          <div className="flex-grow-1" title={`Score: ${fitnessScoreSummary ?? '—'}${fitnessLevelSummary ? ` (${fitnessLevelSummary})` : ''} | RPE ${avgRpe90 != null ? Number(avgRpe90).toFixed(1) : '—'} · 5K ${formatSecondsDisplay(avg5k90Sec)} · 10K ${formatSecondsDisplay(avg10k90Sec)} | YTD Run ${runDistanceYtdKm != null ? `${runDistanceYtdKm.toFixed(1)}km` : '—'} Swim ${swimDistanceYtdKm != null ? `${swimDistanceYtdKm.toFixed(1)}km` : '—'} Bike ${bikeDistanceYtdKm != null ? `${bikeDistanceYtdKm.toFixed(1)}km` : '—'} | Pred 5K ${predicted5kDisplay || '—'} 10K ${predicted10kDisplay || '—'} Half ${predictedHalfMarathonDisplay || '—'}`}>
                            <div className="text-muted small">Fitness</div>
                            <div className="fw-semibold">
                              Sc:{fitnessScoreSummary ?? '—'} RPE:{avgRpe90 != null ? Number(avgRpe90).toFixed(1) : '—'} 5K:{formatSecondsDisplay(avg5k90Sec)} 10K:{formatSecondsDisplay(avg10k90Sec)}
                            </div>
                            <div className="text-muted small">
                              Pr 5K:{predicted5kDisplay || '—'} · 10K:{predicted10kDisplay || '—'} · Half:{predictedHalfMarathonDisplay || '—'} · Sw800:{predictedSwim800Display || '—'} · Bk50:{predictedBike50Display || '—'}
                            </div>
                          </div>
                        </div>
                      </Col>

                      {/* Journal Signals Group */}
                      <Col xs={12} sm={6} lg={6} xl={3}>
                        <JournalInsightsCard compact inlineMetric />
                      </Col>

                      {/* Health Metrics Group */}
                      {healthBannerData && (
                        <Col xs={12} sm={6} lg={6} xl={4}>
                          <div
                            className="d-flex align-items-center gap-2 px-2 py-1 rounded border h-100"
                            style={{ background: 'var(--bs-body-bg)', cursor: 'pointer', transition: 'all 0.2s ease' }}
                            onClick={() => navigate('/fitness')}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = 'var(--bs-danger-bg-subtle)';
                              e.currentTarget.style.borderColor = 'var(--bs-danger)';
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = 'var(--bs-body-bg)';
                              e.currentTarget.style.borderColor = 'var(--bs-border-color)';
                            }}
                          >
                            <Heart size={16} className="text-danger flex-shrink-0" />
                            <div
                              className="flex-grow-1"
                              title={`Health data from ${healthBannerData.sourceLabel}. Weight ${healthBannerData.weightKg != null ? `${healthBannerData.weightKg.toFixed(1)}kg` : '—'} · Body fat ${healthBannerData.bodyFatPct != null ? `${healthBannerData.bodyFatPct.toFixed(1)}%` : '—'} · Steps ${healthBannerData.stepsToday != null ? Math.round(healthBannerData.stepsToday).toLocaleString() : '—'} · Workout ${healthBannerData.workoutMinutesToday != null ? `${Math.round(healthBannerData.workoutMinutesToday)}m` : '—'} · Macros ${healthBannerData.macroAdherencePct != null ? `${healthBannerData.macroAdherencePct}%` : '—'}`}
                            >
                              <div className="text-muted small">Health</div>
                              <div className="fw-semibold" style={{ fontSize: '0.8rem' }}>
                                {[
                                  healthBannerData.weightKg != null ? `${healthBannerData.weightKg.toFixed(1)}kg` : null,
                                  healthBannerData.bodyFatPct != null ? `${healthBannerData.bodyFatPct.toFixed(1)}% bf` : null,
                                  healthBannerData.stepsToday != null ? `${Math.round(healthBannerData.stepsToday).toLocaleString()} steps` : null,
                                ].filter(Boolean).join(' · ') || 'No health snapshot'}
                              </div>
                              <div className="text-muted small">
                                {[
                                  healthBannerData.workoutMinutesToday != null ? `${Math.round(healthBannerData.workoutMinutesToday)}m workout` : null,
                                  healthBannerData.distanceKmToday != null ? `${healthBannerData.distanceKmToday.toFixed(1)}km` : null,
                                  healthBannerData.macroAdherencePct != null ? `${healthBannerData.macroAdherencePct}% macros` : null,
                                  `Source ${healthBannerData.sourceLabel}`,
                                ].filter(Boolean).join(' · ')}
                              </div>
                            </div>
                          </div>
                        </Col>
                      )}

                    </Row>

                    <Collapse in={dailyCompletionTrendExpanded}>
                      <div className="mb-2">
                        <Card className="border-0 shadow-sm">
                          <Card.Body className="p-2">
                            <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
                              <div className="fw-semibold">Daily Completion Trend</div>
                              <div className="text-muted small">
                                Overall + Stories + Tasks + Chores/Habits
                              </div>
                            </div>
                            {dailyCompletionTrend.length === 0 ? (
                              <div className="text-muted small">No trend data yet.</div>
                            ) : (
                              <>
                                <div style={{ width: '100%', height: 220 }}>
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={dailyCompletionTrend} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                      <CartesianGrid strokeDasharray="3 3" />
                                      <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                      <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                                      <RechartsTooltip
                                        formatter={(value: number, name: string) => [`${Math.round(Number(value || 0))}%`, name]}
                                        labelFormatter={(label) => `Day ${label}`}
                                      />
                                      <Legend />
                                      <Line type="monotone" dataKey="totalPct" stroke="#0d6efd" strokeWidth={2.4} dot={false} name="Overall %" />
                                      <Line type="monotone" dataKey="storyPct" stroke="#20c997" strokeWidth={1.8} dot={false} name="Stories %" />
                                      <Line type="monotone" dataKey="taskPct" stroke="#fd7e14" strokeWidth={1.8} dot={false} name="Tasks %" />
                                      <Line type="monotone" dataKey="chorePct" stroke="#6f42c1" strokeWidth={1.8} dot={false} name="Chores/Habits %" />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                                <div className="d-flex flex-wrap gap-2 mt-2">
                                  {dailyCompletionTrend.slice(-7).map((row) => (
                                    <Badge key={row.dayKey} bg="light" text="dark" pill>
                                      {row.label}: {row.totalCompleted}/{row.totalDue} ({row.totalPct}%)
                                    </Badge>
                                  ))}
                                </div>
                              </>
                            )}
                          </Card.Body>
                        </Card>
                      </div>
                    </Collapse>

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

            {false && (
              <Row className="g-3 mb-1">
                <Col xl={12}>
                  <Card className="shadow-sm border-0">
                    <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2 py-2">
                      <div className="fw-semibold">Savings Runway</div>
                      <div className="d-flex align-items-center gap-2 flex-wrap">
                        <Form.Select
                          size="sm"
                          value={runwaySortMode}
                          onChange={(e) => setRunwaySortMode(e.target.value as 'soonest' | 'shortfall' | 'theme')}
                          style={{ width: 160 }}
                        >
                          <option value="soonest">Sort: Soonest funded</option>
                          <option value="shortfall">Sort: Highest shortfall</option>
                          <option value="theme">Sort: Theme</option>
                        </Form.Select>
                        <Form.Select
                          size="sm"
                          value={runwayThemeFilter}
                          onChange={(e) => setRunwayThemeFilter(e.target.value)}
                          style={{ width: 180 }}
                        >
                          <option value="all">Theme: All</option>
                          {savingsRunwayThemes.map((theme) => (
                            <option key={theme} value={theme}>{theme}</option>
                          ))}
                        </Form.Select>
                      </div>
                    </Card.Header>
                    <Card.Body className="py-2">
                      <div className="text-muted small mb-2">{financeSyncSummary}</div>
                      {savingsRunwayRows.length === 0 ? (
                        <div className="text-muted small">No linked savings-pot runway data available yet.</div>
                      ) : (
                        <div className="table-responsive">
                          <Table size="sm" hover className="mb-0 align-middle">
                            <thead>
                              <tr>
                                <th>Goal</th>
                                <th style={{ textAlign: 'right' }}>Target</th>
                                <th style={{ textAlign: 'right' }}>Pot Balance</th>
                                <th style={{ textAlign: 'right' }}>Avg Monthly Allocation</th>
                                <th style={{ textAlign: 'right' }}>Remaining</th>
                                <th style={{ textAlign: 'right' }}>Estimated Months</th>
                              </tr>
                            </thead>
                            <tbody>
                              {savingsRunwayRows.slice(0, 12).map((row) => (
                                <tr key={row.goalId || row.goalTitle}>
                                  <td>
                                    <div className="fw-semibold">{row.goalTitle}</div>
                                    <div className="text-muted" style={{ fontSize: 12 }}>{row.themeName}</div>
                                  </td>
                                  <td style={{ textAlign: 'right' }}>{formatPotBalance(row.targetAmount * 100, 'GBP')}</td>
                                  <td style={{ textAlign: 'right' }}>{formatPotBalance(row.linkedPotBalance * 100, 'GBP')}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    {row.avgMonthlyAllocation && row.avgMonthlyAllocation > 0
                                      ? formatPotBalance(row.avgMonthlyAllocation * 100, 'GBP')
                                      : 'Insufficient history'}
                                  </td>
                                  <td style={{ textAlign: 'right' }}>{formatPotBalance(row.remainingAmount * 100, 'GBP')}</td>
                                  <td style={{ textAlign: 'right' }}>
                                    {row.monthsToTarget == null ? 'TBD' : (row.monthsToTarget <= 0 ? 'Funded' : `${Math.ceil(row.monthsToTarget)} mo`)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </Table>
                        </div>
                      )}
                    </Card.Body>
                  </Card>
                </Col>
              </Row>
            )}

            <Row className="g-3 mb-1">
              <Col xl={12}>
                <Card className="h-100 shadow-sm border-0">
                  <Card.Header className="d-flex justify-content-between align-items-start flex-wrap gap-2 py-2">
                    <div className="d-flex flex-column gap-1">
                      <span className="fw-semibold">Today’s Plan</span>
                      {nextWorkLoading && !nextWorkRecommendation?.recommendedItem && (
                        <div className="text-muted small d-flex align-items-center gap-2">
                          <Spinner size="sm" animation="border" />
                          <span>Calculating what to work on next…</span>
                        </div>
                      )}
                      {!nextWorkLoading && nextWorkRecommendation?.recommendedItem && (
                        <div className="text-muted small d-flex align-items-center gap-2 flex-wrap">
                          <span className="fw-semibold text-body">What to work on next</span>
                          <Badge bg={getNextWorkBadge(nextWorkRecommendation.status).bg}>
                            {getNextWorkBadge(nextWorkRecommendation.status).label}
                          </Badge>
                          {nextWorkPath ? (
                            <Link to={nextWorkPath} className="text-decoration-none">
                              {nextWorkRecommendation.recommendedItem.label}
                            </Link>
                          ) : (
                            <span className="text-body">{nextWorkRecommendation.recommendedItem.label}</span>
                          )}
                          {nextWorkRecommendation.recommendedItem.reason && (
                            <span>· {nextWorkRecommendation.recommendedItem.reason}</span>
                          )}
                        </div>
                      )}
                      {!nextWorkLoading && !nextWorkRecommendation?.recommendedItem && nextWorkRecommendation?.spokenResponse && (
                        <div className="text-muted small">
                          <span className="fw-semibold text-body">What to work on next</span>
                          {' · '}
                          {nextWorkRecommendation.spokenResponse}
                        </div>
                      )}
                      {nextWorkError && (
                        <div className="text-danger small">{nextWorkError}</div>
                      )}
                      {eveningPullForward?.active && eveningPullForward.suggestions.length > 0 && (
                        <div className="small mt-1">
                          <div className="text-body fw-semibold">Evening opportunity</div>
                          {eveningPullForward.message && (
                            <div className="text-muted">{eveningPullForward.message}</div>
                          )}
                          <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                            {eveningPullForward.suggestions.slice(0, 2).map((item) => (
                              <Button
                                key={`${item.type}-${item.id}`}
                                variant="outline-success"
                                size="sm"
                                disabled={eveningPullForwardBusyId === item.id}
                                onClick={() => handleApplyEveningPullForward(item)}
                                title={item.reason || 'Bring this item forward to today'}
                              >
                                {eveningPullForwardBusyId === item.id ? (
                                  <Spinner size="sm" animation="border" className="me-1" />
                                ) : null}
                                Bring forward: {item.label || item.title}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="d-flex align-items-center gap-2 flex-wrap">
                      <PlanActionBar />
                      <Button
                        variant="outline-primary"
                        size="sm"
                        disabled={replanLoading}
                        onClick={handleReplan}
                        title="Delta replan: quickly rebalance existing calendar blocks using current priorities."
                      >
                        {replanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
                        Delta replan
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={fullReplanLoading}
                        onClick={handleFullReplan}
                        title="Full replan: runs full nightly orchestration (pointing, conversions, priority scoring, and calendar planning)."
                      >
                        {fullReplanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <Sparkles size={14} className="me-1" />}
                        Full replan
                      </Button>
                      <Button
                        variant={widgetEditMode ? 'success' : 'outline-secondary'}
                        size="sm"
                        onClick={() => setWidgetEditMode((prev) => !prev)}
                        title={widgetEditMode ? 'Save layout and exit edit mode' : 'Edit widget layout: drag, resize, show/hide'}
                      >
                        {widgetEditMode ? <><CheckCircle size={14} className="me-1" /> Done</> : <><LayoutGrid size={14} className="me-1" /> Edit layout</>}
                      </Button>
                      <Button
                        variant={showWidgetSettings ? 'secondary' : 'outline-secondary'}
                        size="sm"
                        onClick={() => setShowWidgetSettings((prev) => !prev)}
                        title={`Customize visible widgets for ${dashboardDeviceType}`}
                      >
                        <LayoutGrid size={14} className="me-1" /> Widgets
                      </Button>
                    </div>
                  </Card.Header>
                  <Card.Body>
                    {replanFeedback && (
                      <div className="text-muted small mb-2">{replanFeedback}</div>
                    )}
                    {showWidgetSettings && (
                      <Card className="mb-3 border-0" style={{ background: 'var(--bs-light-bg-subtle, #f8f9fa)' }}>
                        <Card.Body className="py-2">
                          <div className="d-flex justify-content-between align-items-center mb-2">
                            <div className="fw-semibold small">Visible Widgets</div>
                            <div className="d-flex align-items-center gap-2">
                              <span className="text-muted small">Profile: {dashboardDeviceType}</span>
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-secondary"
                                onClick={() => {
                                  setWidgetOrder([...SUMMARY_WIDGET_KEYS]);
                                  setWidgetSizes({});
                                  setWidgetVisibility({ ...DASHBOARD_WIDGET_DEFAULT_VISIBILITY });
                                  try {
                                    window.localStorage.removeItem(dashboardWidgetOrderStorageKey(dashboardDeviceType));
                                    window.localStorage.removeItem(dashboardWidgetSizeStorageKey(dashboardDeviceType));
                                    window.localStorage.removeItem(dashboardWidgetVisibilityStorageKey(dashboardDeviceType));
                                  } catch { /* ignore */ }
                                  // Recompute default sizes from current grid width
                                  requestAnimationFrame(() => {
                                    const grid = widgetGridRef.current;
                                    const gridWidth = grid ? grid.getBoundingClientRect().width : window.innerWidth - 80;
                                    if (gridWidth < 300) return;
                                    const gap = 4;
                                    const half = Math.max(300, Math.floor((gridWidth - gap) / 2));
                                    const third = Math.max(240, Math.floor((gridWidth - gap * 2) / 3));
                                    setWidgetSizes({
                                      unifiedTimeline: { width: half, height: 420 },
                                      top3: { width: third, height: 420 },
                                      dailySummary: { width: third, height: 420 },
                                      kpiStudio: { width: third, height: 420 },
                                      choresHabits: { width: third, height: 420 },
                                      lowHangingFruit: { width: third, height: 400 },
                                      themeProgress: { width: third, height: 400 },
                                      tasksDueToday: { width: third, height: 400 },
                                    });
                                  });
                                }}
                                title="Reset widget order, sizes and visibility to defaults"
                              >
                                Reset layout
                              </button>
                            </div>
                          </div>
                          <div className="d-flex flex-wrap gap-3">
                            {DASHBOARD_WIDGET_CONFIG.map((widget) => (
                              <Form.Check
                                key={widget.key}
                                type="switch"
                                id={`dashboard-widget-${widget.key}`}
                                label={widget.label}
                                checked={widgetVisibility[widget.key]}
                                onChange={() => toggleWidgetVisibility(widget.key)}
                              />
                            ))}
                          </div>
                        </Card.Body>
                      </Card>
                    )}
                    <div ref={todayPlanLayoutRef}>
                        <DndContext sensors={widgetDndSensors} collisionDetection={closestCenter} onDragEnd={handleWidgetDragEnd}>
                          <SortableContext items={widgetOrder.filter((k) => widgetVisibility[k])} strategy={rectSortingStrategy}>
                            <div className="dashboard-widget-grid" ref={widgetGridRef}>
                              {widgetOrder.filter((k) => widgetVisibility[k]).map((widgetKey) => {
                                const wSize = widgetSizes[widgetKey];
                                return (
                                  <SortableDashboardWidget
                                    key={widgetKey}
                                    id={widgetKey}
                                    widgetWidth={wSize?.width}
                                    dragEnabled={widgetEditMode}
                                  >
                                    {widgetKey === 'lowHangingFruit' && widgetVisibility.lowHangingFruit && (
                          <div
                            ref={setWidgetResizeContainer('lowHangingFruit')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('lowHangingFruit', 220)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Header className="d-flex align-items-center justify-content-between">
                                <div className="fw-semibold d-flex align-items-center gap-2">
                                  <Sparkles size={16} /> Low hanging fruit
                                </div>
                                <div className="d-flex align-items-center gap-2">
                                  <Link to="/tasks" className="btn btn-sm btn-outline-secondary">
                                    Tasks
                                  </Link>
                                  <Link to="/chores/checklist" className="btn btn-sm btn-outline-secondary">
                                    Checklist
                                  </Link>
                                  <Badge bg={lowHangingFruitTasks.length > 0 ? 'warning' : 'secondary'} pill>
                                    {lowHangingFruitTasks.length}
                                  </Badge>
                                </div>
                              </Card.Header>
                              <Card.Body className="p-3">
                                {lowHangingFruitTasks.length === 0 ? (
                                  <div className="text-muted small">No quick, non-critical, stale tasks right now.</div>
                                ) : (
                                  <div className="widget-items-grid">
                                  {lowHangingFruitTasks.map((task) => {
                                    const kind = getChoreKind(task);
                                    const busy = kind ? !!choreCompletionBusy[task.id] : false;
                                    const points = getTaskQuickPoints(task);
                                    const pointsLabel = Number.isFinite(points)
                                      ? points.toFixed(2).replace(/\.?0+$/, '')
                                      : '0.25';
                                    const dueMs = getTaskDueMs(task) ?? resolveRecurringDueMs(task, todayDate, todayStartMs);
                                    const dueLabel = dueMs ? formatDueDetail(dueMs) : null;
                                    const staleAnchorMs = getTaskStaleAnchorMs(task);
                                    const staleDays = staleAnchorMs
                                      ? Math.max(1, Math.floor((Date.now() - staleAnchorMs) / MS_PER_DAY))
                                      : LOW_HANGING_MIN_STALE_DAYS;
                                    const rawType = String((task as any)?.type || '').toLowerCase();
                                    const kindLabel = kind
                                      ? (kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore')
                                      : (rawType ? `${rawType.charAt(0).toUpperCase()}${rawType.slice(1)}` : 'Task');
                                    const kindBadge = kind === 'routine'
                                      ? 'success'
                                      : kind === 'habit'
                                        ? 'secondary'
                                        : kind === 'chore'
                                          ? 'primary'
                                          : 'dark';
                                    const taskPath = kind
                                      ? `/chores/checklist?taskId=${encodeURIComponent(task.id)}`
                                      : ((task as any).deepLink || `/tasks?taskId=${encodeURIComponent(task.id)}`);
                                    return (
                                      <div key={task.id} className="border rounded p-2 mb-2 d-flex align-items-start gap-2">
                                        <Form.Check
                                          type="checkbox"
                                          checked={busy}
                                          disabled={busy}
                                          onChange={() => {
                                            if (kind) {
                                              void handleCompleteChoreTask(task);
                                            } else {
                                              void handleTaskStatusChange(task, 2);
                                            }
                                          }}
                                          aria-label={`Complete ${task.title}`}
                                        />
                                        <div className="flex-grow-1">
                                          <Link
                                            to={taskPath}
                                            className="text-decoration-none fw-semibold"
                                          >
                                            {task.title}
                                          </Link>
                                          <div className="text-muted small">
                                            {dueLabel ? `Due ${dueLabel} · ` : ''}
                                            {staleDays}d stale
                                          </div>
                                        </div>
                                        <div className="d-flex flex-column align-items-end gap-1">
                                          <Badge bg="warning" text="dark">{pointsLabel} pts</Badge>
                                          <Badge bg={kindBadge}>{kindLabel}</Badge>
                                        </div>
                                      </div>
                                    );
                                  })}
                                  </div>
                                )}
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('lowHangingFruit')}
                              {renderWidgetResizeHandle('lowHangingFruit', 220, 'Resize low hanging fruit widget')}
                          </div>
                        )}
                                    {widgetKey === 'dailySummary' && widgetVisibility.dailySummary && (dailySummaryLines.length > 0 || dailyActiveSignals.length > 0 || aiFocusItems.length > 0) && (
                          <div
                            ref={setWidgetResizeContainer('dailySummary')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('dailySummary', 220)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Header className="d-flex align-items-center justify-content-between">
                                <div className="fw-semibold">Daily Summary</div>
                                <Badge bg="secondary" pill>Today</Badge>
                              </Card.Header>
                              <Card.Body className="p-3" style={{ overflowY: 'auto' }}>
                                {dailySummaryLines.length > 0 && (
                                  <div className="mb-3">
                                    {dailySummarySource && (
                                      <div className="text-muted small mb-1">Source: {dailySummarySource}</div>
                                    )}
                                    <ul className="mb-0 small">
                                      {dailySummaryLines.map((line, idx) => (
                                        <li key={idx}>{renderDailySummaryLine(line)}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {dailyActiveSignals.length > 0 && (
                                  <div className="mb-3">
                                    <div className="fw-semibold mb-1">Active Signals</div>
                                    <ul className="mb-0 small">
                                      {dailyActiveSignals.slice(0, 5).map((signal: DailyActiveSignal, idx: number) => {
                                        const badge = signal.severity === 'critical' ? 'danger' : signal.severity === 'warning' ? 'warning' : 'info';
                                        const message = signal.message ? ` - ${signal.message}` : '';
                                        return (
                                          <li key={`signal-${idx}`}>
                                            <Badge bg={badge} className="me-1">{signal.severity}</Badge>
                                            {signal.title}{message}
                                            {signal.ctaPath && (
                                              <>
                                                {' '}
                                                <a href={signal.ctaPath} className="text-decoration-none" target="_blank" rel="noreferrer">Open</a>
                                              </>
                                            )}
                                          </li>
                                        );
                                      })}
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
                            {renderWidgetEdgeHandles('dailySummary')}
                              {renderWidgetResizeHandle('dailySummary', 220, 'Resize daily summary widget')}
                          </div>
                        )}
                                    {widgetKey === 'top3' && widgetVisibility.top3 && (
                          <div
                            ref={setWidgetResizeContainer('top3')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('top3', 260)}
                          >
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
                                (() => {
                                  const top3Wide = (widgetSizes.top3?.width ?? 0) >= 600;
                                  return (
                                  <div style={top3Wide ? { display: 'flex', gap: '16px', alignItems: 'flex-start' } : undefined}>
                                  <div style={top3Wide ? { flex: '1 1 0', minWidth: 0 } : undefined}>
                                    <div className="text-uppercase text-muted small fw-semibold mb-1">Stories</div>
                                    {top3Stories.length === 0 ? (
                                      <div className="text-muted small">No stories flagged.</div>
                                    ) : (
                                      <div className="widget-items-grid">
                                      {top3Stories.map((story, idx) => {
                                        const label = storyLabel(story);
                                        const aiScore = (story as any).aiCriticalityScore ?? (story as any).aiPriorityScore;
                                        const href = `/stories/${(story as any).ref || story.id}`;
                                        const storyPriorityBadge = getPriorityBadge((story as any).priority);
                                        const storyDueMs = (() => {
                                          const raw = (story as any).targetDate ?? (story as any).dueDate ?? null;
                                          if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
                                          if (raw?.toDate) return raw.toDate().getTime();
                                          const parsed = raw ? Date.parse(String(raw)) : NaN;
                                          return Number.isNaN(parsed) ? null : parsed;
                                        })();
                                        const storyStatusVal = Number(story.status ?? 0);
                                        const storyStatusMap: Record<number, { bg: string; label: string }> = {
                                          0: { bg: 'light', label: 'Backlog' },
                                          1: { bg: 'info', label: 'Planned' },
                                          2: { bg: 'primary', label: 'In Progress' },
                                          3: { bg: 'warning', label: 'Testing' },
                                          4: { bg: 'success', label: 'Done' },
                                        };
                                        const storyS = storyStatusMap[storyStatusVal] || storyStatusMap[0];
                                        return (
                                          <div key={story.id} className="border rounded p-2 mb-2 dashboard-due-item">
                                            <div className="d-flex align-items-start justify-content-between gap-2">
                                              <div className="fw-semibold small flex-grow-1">
                                                <a href="#" className="text-decoration-none" onClick={(e) => { e.preventDefault(); setInlineEditStory(story); }}>{label}</a>
                                              </div>
                                              <button
                                                type="button"
                                                className="d-none d-md-inline-flex align-items-center justify-content-center"
                                                onClick={() => showSidebar(story as any, 'story')}
                                                title="Activity stream"
                                                style={{
                                                  color: 'var(--bs-secondary-color)',
                                                  padding: 4,
                                                  borderRadius: 4,
                                                  border: 'none',
                                                  background: 'transparent',
                                                  cursor: 'pointer',
                                                  lineHeight: 0,
                                                  flexShrink: 0,
                                                }}
                                              >
                                                <Activity size={14} />
                                              </button>
                                            </div>
                                            <div className="d-flex align-items-center gap-2 mt-1 flex-wrap">
                                              <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                                                <Clock size={11} />
                                                <input
                                                  type="date"
                                                  className="dashboard-due-date-input"
                                                  value={storyDueMs ? format(new Date(storyDueMs), 'yyyy-MM-dd') : ''}
                                                  onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (!val) return;
                                                    const newDue = new Date(val + 'T12:00:00').getTime();
                                                    handleStoryDueDateChange(story, newDue);
                                                  }}
                                                />
                                              </span>
                                              <span className="dashboard-chip-select-wrap">
                                                <select
                                                  className="dashboard-chip-select"
                                                  value={Number((story as any).priority ?? 0)}
                                                  onChange={(e) => handleStoryPriorityChange(story, Number(e.target.value))}
                                                  style={{
                                                    backgroundColor: `var(--bs-${storyPriorityBadge.bg})`,
                                                    color: storyPriorityBadge.bg === 'warning' || storyPriorityBadge.bg === 'light' ? '#000' : '#fff',
                                                  }}
                                                >
                                                  <option value={0}>None</option>
                                                  <option value={1}>Low</option>
                                                  <option value={2}>Medium</option>
                                                  <option value={3}>High</option>
                                                  <option value={4}>Critical</option>
                                                </select>
                                              </span>
                                              <span className="dashboard-chip-select-wrap">
                                                <select
                                                  className="dashboard-chip-select"
                                                  value={storyStatusVal}
                                                  onChange={(e) => handleStoryStatusChange(story, Number(e.target.value))}
                                                  style={{
                                                    backgroundColor: `var(--bs-${storyS.bg})`,
                                                    color: storyS.bg === 'light' || storyS.bg === 'warning' ? '#000' : '#fff',
                                                  }}
                                                >
                                                  <option value={0}>Backlog</option>
                                                  <option value={1}>Planned</option>
                                                  <option value={2}>In Progress</option>
                                                  <option value={3}>Testing</option>
                                                  <option value={4}>Done</option>
                                                </select>
                                              </span>
                                              <span className="text-muted" style={{ fontSize: 11 }}>
                                                AI {aiScore != null ? Math.round(aiScore) : '—'}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                      </div>
                                    )}
                                  </div>
                                  <div style={top3Wide ? { flex: '1 1 0', minWidth: 0 } : undefined}>
                                    <div className="text-uppercase text-muted small fw-semibold mb-1">Tasks</div>
                                    {top3Tasks.length === 0 ? (
                                      <div className="text-muted small">No tasks flagged.</div>
                                    ) : (
                                      <div className="widget-items-grid">
                                      {top3Tasks.map((task, idx) => {
                                        const refLabel = taskRefLabel(task);
                                        const aiScore = (task as any).aiCriticalityScore ?? (task as any).aiPriorityScore;
                                        const priorityBadge = getPriorityBadge((task as any).priority);
                                        const dueMs = getTaskDueMs(task);
                                        return (
                                          <div key={task.id} className="border rounded p-2 mb-2 dashboard-due-item">
                                            <div className="d-flex align-items-start justify-content-between gap-2">
                                              <div className="fw-semibold small flex-grow-1">
                                                <a href="#" className="text-decoration-none" onClick={(e) => { e.preventDefault(); setInlineEditTask(task); }}>{task.title}</a>
                                              </div>
                                              <button
                                                type="button"
                                                className="d-none d-md-inline-flex align-items-center justify-content-center"
                                                onClick={() => showSidebar(task as any, 'task')}
                                                title="Activity stream"
                                                style={{
                                                  color: 'var(--bs-secondary-color)',
                                                  padding: 4,
                                                  borderRadius: 4,
                                                  border: 'none',
                                                  background: 'transparent',
                                                  cursor: 'pointer',
                                                  lineHeight: 0,
                                                  flexShrink: 0,
                                                }}
                                              >
                                                <Activity size={14} />
                                              </button>
                                            </div>
                                            {refLabel && (
                                              <a href="#" className="text-decoration-none" onClick={(e) => { e.preventDefault(); setInlineEditTask(task); }}>
                                                <code className="text-primary" style={{ fontSize: 11 }}>{refLabel}</code>
                                              </a>
                                            )}
                                            <div className="d-flex align-items-center gap-2 mt-1 flex-wrap">
                                              <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                                                <Clock size={11} />
                                                <input
                                                  type="date"
                                                  className="dashboard-due-date-input"
                                                  value={dueMs ? format(new Date(dueMs), 'yyyy-MM-dd') : ''}
                                                  onChange={(e) => {
                                                    const val = e.target.value;
                                                    if (!val) return;
                                                    const newDue = new Date(val + 'T12:00:00').getTime();
                                                    handleTaskDueDateChange(task, newDue);
                                                  }}
                                                />
                                              </span>
                                              <span className="dashboard-chip-select-wrap">
                                                <select
                                                  className="dashboard-chip-select"
                                                  value={Number((task as any).priority ?? 0)}
                                                  onChange={(e) => handleTaskPriorityChange(task, Number(e.target.value))}
                                                  style={{
                                                    backgroundColor: `var(--bs-${priorityBadge.bg})`,
                                                    color: priorityBadge.bg === 'warning' || priorityBadge.bg === 'orange' || priorityBadge.bg === 'light' ? '#000' : '#fff',
                                                  }}
                                                >
                                                  <option value={0}>None</option>
                                                  <option value={1}>Low</option>
                                                  <option value={2}>Medium</option>
                                                  <option value={3}>High</option>
                                                  <option value={4}>Critical</option>
                                                </select>
                                              </span>
                                              {(() => {
                                                const statusVal = Number(task.status ?? 0);
                                                const statusMap: Record<number, { bg: string; label: string }> = {
                                                  0: { bg: 'secondary', label: 'To do' },
                                                  1: { bg: 'primary', label: 'Doing' },
                                                  2: { bg: 'success', label: 'Done' },
                                                };
                                                const s = statusMap[statusVal] || statusMap[0];
                                                return (
                                                  <span className="dashboard-chip-select-wrap">
                                                    <select
                                                      className="dashboard-chip-select"
                                                      value={statusVal}
                                                      onChange={(e) => handleTaskStatusChange(task, Number(e.target.value))}
                                                      style={{
                                                        backgroundColor: `var(--bs-${s.bg})`,
                                                        color: '#fff',
                                                      }}
                                                    >
                                                      <option value={0}>To do</option>
                                                      <option value={1}>Doing</option>
                                                      <option value={2}>Done</option>
                                                    </select>
                                                  </span>
                                                );
                                              })()}
                                              <span className="text-muted" style={{ fontSize: 11 }}>
                                                AI {aiScore != null ? Math.round(aiScore) : '—'}
                                              </span>
                                            </div>
                                          </div>
                                        );
                                      })}
                                      </div>
                                    )}
                                  </div>
                                  </div>
                                  );
                                })()
                              )}
                                </Card.Body>
                              )}
                            </Card>
                            {renderWidgetEdgeHandles('top3')}
                              {renderWidgetResizeHandle('top3', 260, 'Resize top 3 priorities widget')}
                          </div>
                        )}
                                    {widgetKey === 'themeProgress' && widgetVisibility.themeProgress && (
                          <div
                            ref={setWidgetResizeContainer('themeProgress')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('themeProgress', 280)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Header className="d-flex align-items-center justify-content-between">
                                <div className="fw-semibold d-flex align-items-center gap-2">
                                  <TrendingUp size={16} /> Theme & goal progress
                                </div>
                                <Badge bg={themeProgressRows.length > 0 ? 'info' : 'secondary'} pill>
                                  {themeProgressRows.length}
                                </Badge>
                              </Card.Header>
                              <Card.Body className="p-3">
                              {lowProgressGoalsDueThisSprint.length > 0 && (
                                <Alert variant="warning" className="py-2 mb-3">
                                  <div className="fw-semibold small mb-1">
                                    Goals due this sprint with low progress (&lt;25% points complete)
                                  </div>
                                  <ul className="mb-0 small">
                                    {lowProgressGoalsDueThisSprint.slice(0, 5).map((goalRow) => (
                                      <li key={goalRow.id}>
                                        {goalRow.title}
                                        {' · '}
                                        {goalRow.pointsDone}/{goalRow.pointsTotal} pts ({goalRow.pointsProgressPct}%)
                                        {' · '}
                                        {goalRow.themeLabel}
                                      </li>
                                    ))}
                                    {lowProgressGoalsDueThisSprint.length > 5 && (
                                      <li className="text-muted">+{lowProgressGoalsDueThisSprint.length - 5} more</li>
                                    )}
                                  </ul>
                                </Alert>
                              )}
                              {themeProgressRows.length === 0 ? (
                                <div className="text-muted small">
                                  No sprint-linked goals, stories, or tasks are mapped to themes for the selected sprint.
                                </div>
                              ) : (
                                themeProgressRows.map((row) => {
                                  const isOpen = !!themeProgressExpanded[row.themeKey];
                                  const pointsPct = row.pointsTotal > 0
                                    ? Math.round((row.pointsDone / row.pointsTotal) * 100)
                                    : 0;
                                  const savingsPct = row.savingsTarget > 0
                                    ? Math.round(((row.savingsSavedPence / 100) / row.savingsTarget) * 100)
                                    : 0;
                                  return (
                                    <div key={row.themeKey} className="border rounded p-2 mb-2">
                                      <div className="d-flex align-items-start justify-content-between gap-2">
                                        <div className="d-flex align-items-center gap-2 flex-wrap">
                                          <span
                                            style={{
                                              width: 10,
                                              height: 10,
                                              borderRadius: 999,
                                              backgroundColor: row.color,
                                              border: '1px solid rgba(0,0,0,0.12)',
                                              display: 'inline-block',
                                            }}
                                          />
                                          <span className="fw-semibold small">{row.themeLabel}</span>
                                          <span className="text-muted" style={{ fontSize: 11 }}>
                                            {row.completedItems}/{row.totalItems} complete ({row.progressPct}%)
                                          </span>
                                        </div>
                                        <Button
                                          variant="link"
                                          size="sm"
                                          className="text-decoration-none p-0"
                                          onClick={() => toggleThemeProgressExpanded(row.themeKey)}
                                        >
                                          {isOpen ? 'Hide goals' : 'Show goals'}
                                        </Button>
                                      </div>
                                      <div
                                        style={{
                                          height: 6,
                                          background: 'rgba(0,0,0,0.08)',
                                          borderRadius: 999,
                                          overflow: 'hidden',
                                          marginTop: 8,
                                        }}
                                      >
                                        <div
                                          style={{
                                            width: `${row.progressPct}%`,
                                            height: '100%',
                                            background: row.color,
                                          }}
                                        />
                                      </div>
                                      <div className="d-flex align-items-center gap-2 flex-wrap mt-2">
                                        <Badge bg="secondary">{row.goalsDone}/{row.goalsTotal} goals</Badge>
                                        <Badge bg="secondary">{row.storiesDone}/{row.storiesTotal} stories</Badge>
                                        <Badge bg="secondary">{row.tasksDone}/{row.tasksTotal} tasks</Badge>
                                        {row.pointsTotal > 0 && (
                                          <Badge bg="primary">{row.pointsDone}/{row.pointsTotal} pts ({pointsPct}%)</Badge>
                                        )}
                                        {row.savingsTarget > 0 && (
                                          <Badge bg="success">
                                            Savings {formatPotBalance(row.savingsSavedPence, row.savingsCurrency)} / {row.savingsTarget.toLocaleString('en-GB', { style: 'currency', currency: row.savingsCurrency })}
                                            {' '}({savingsPct}%)
                                          </Badge>
                                        )}
                                      </div>
                                      {isOpen && (
                                        <div className="mt-2">
                                          {row.goalRows.length === 0 ? (
                                            <div className="text-muted small">
                                              No goals in this theme for the selected scope.
                                            </div>
                                          ) : (
                                            row.goalRows.map((goalRow) => (
                                              <div key={goalRow.id} className="border rounded p-2 mb-2">
                                                <div className="d-flex align-items-start justify-content-between gap-2">
                                                  <div className="fw-semibold small flex-grow-1">{goalRow.title}</div>
                                                  <Badge bg={goalRow.statusBg}>{goalRow.statusLabel}</Badge>
                                                </div>
                                                <div className="d-flex align-items-center gap-2 flex-wrap mt-1">
                                                  <span className="text-muted" style={{ fontSize: 11 }}>
                                                    Stories {goalRow.storiesDone}/{goalRow.storiesTotal}
                                                  </span>
                                                  <span className="text-muted" style={{ fontSize: 11 }}>
                                                    Tasks {goalRow.tasksDone}/{goalRow.tasksTotal}
                                                  </span>
                                                  {goalRow.pointsTotal > 0 && (
                                                    <span className="text-muted" style={{ fontSize: 11 }}>
                                                      Points {goalRow.pointsDone}/{goalRow.pointsTotal}
                                                    </span>
                                                  )}
                                                  {goalRow.dueThisSprint && (
                                                    <span className="text-warning-emphasis" style={{ fontSize: 11 }}>
                                                      Due this sprint
                                                    </span>
                                                  )}
                                                  <span className="text-muted" style={{ fontSize: 11 }}>
                                                    Progress {goalRow.progressPct}%
                                                  </span>
                                                </div>
                                                <div
                                                  style={{
                                                    height: 5,
                                                    background: 'rgba(0,0,0,0.08)',
                                                    borderRadius: 999,
                                                    overflow: 'hidden',
                                                    marginTop: 6,
                                                  }}
                                                >
                                                  <div
                                                    style={{
                                                      width: `${goalRow.progressPct}%`,
                                                      height: '100%',
                                                      background: row.color,
                                                    }}
                                                  />
                                                </div>
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('themeProgress')}
                              {renderWidgetResizeHandle('themeProgress', 280, 'Resize theme and goal progress widget')}
                          </div>
                        )}
                        {widgetKey === 'kpiStudio' && widgetVisibility.kpiStudio && (
                          <div
                            ref={setWidgetResizeContainer('kpiStudio')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('kpiStudio', 340)}
                          >
                            <KpiDashboardWidget
                              ownerUid={currentUser?.uid || ''}
                              goals={goalsList}
                              stories={sprintStories}
                              tasks={sprintTasks}
                              activeFocusGoalIds={activeFocusGoalIds}
                              selectedSprintId={selectedSprintId || null}
                              capacitySummary={capacitySummary}
                              nextSprint={nextSprint ? {
                                id: nextSprint.id,
                                name: (nextSprint as any).name || (nextSprint as any).title || 'Next sprint',
                                startDate: (nextSprint as any).startDate || null,
                              } : null}
                              onOpenFocusGoals={() => navigate('/focus-goals')}
                            />
                            {renderWidgetEdgeHandles('kpiStudio')}
                            {renderWidgetResizeHandle('kpiStudio', 280, 'Resize KPI studio widget')}
                          </div>
                        )}
                        {widgetKey === 'unifiedTimeline' && widgetVisibility.unifiedTimeline && (
                          <div
                            ref={setWidgetResizeContainer('unifiedTimeline')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('unifiedTimeline', 360)}
                          >
                            <div className="d-flex flex-column gap-3 h-100 dashboard-summary-stack">
                              <DailyPlanSummaryCard />
                              <WeeklyPlannerSummaryCard />
                            </div>
                            {renderWidgetEdgeHandles('unifiedTimeline')}
                            {renderWidgetResizeHandle('unifiedTimeline', 360, 'Resize Daily Plan widget')}
                          </div>
                        )}
                        {widgetKey === 'tasksDueToday' && widgetVisibility.tasksDueToday && (
                          <div
                            ref={setWidgetResizeContainer('tasksDueToday')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('tasksDueToday', 320)}
                          >
                            <Card className="shadow-sm border-0 dashboard-due-card">
                              <Card.Header className="d-flex align-items-center justify-content-between">
                                <div className="fw-semibold d-flex align-items-center gap-2">
                                  <Clock size={16} /> Tasks due today
                                </div>
                                <div className="d-flex align-items-center gap-2">
                                  <Form.Select size="sm" value={tasksDueTodaySortMode} onChange={(e) => setTasksDueTodaySortMode(e.target.value as 'due' | 'ai' | 'top3')}>
                                    <option value="due">Sort: Due time</option>
                                    <option value="ai">Sort: AI score</option>
                                    <option value="top3">Top 3 (AI)</option>
                                  </Form.Select>
                                  <Badge bg={tasksDueTodayCombined.length > 0 ? 'info' : 'secondary'} pill>{tasksDueTodayCombined.length}</Badge>
                                </div>
                              </Card.Header>
                              <Card.Body className="p-3">
                                {tasksDueTodayLoading ? (
                                  <div className="d-flex align-items-center gap-2 text-muted"><Spinner size="sm" animation="border" /> Loading tasks…</div>
                                ) : tasksDueTodayCombined.length === 0 ? (
                                  <div className="text-muted small">No tasks due today.</div>
                                ) : (
                                  (() => {
                                    const morning: typeof tasksDueTodayCombined = [];
                                    const afternoon: typeof tasksDueTodayCombined = [];
                                    const evening: typeof tasksDueTodayCombined = [];
                                    const other: typeof tasksDueTodayCombined = [];
                                    tasksDueTodayCombined.forEach((item) => {
                                      const tod = item.task && (item.task as any).timeOfDay;
                                      if (tod === 'morning') morning.push(item);
                                      else if (tod === 'afternoon') afternoon.push(item);
                                      else if (tod === 'evening') evening.push(item);
                                      else other.push(item);
                                    });
                                    const sortByDueTime = (arr: typeof tasksDueTodayCombined) =>
                                      [...arr].sort((a, b) => {
                                        const aTime = (a.task as any)?.dueTime ?? '';
                                        const bTime = (b.task as any)?.dueTime ?? '';
                                        if (aTime && bTime) return aTime.localeCompare(bTime);
                                        if (aTime) return -1;
                                        if (bTime) return 1;
                                        return (a.dueMs ?? 0) - (b.dueMs ?? 0);
                                      });
                                    const renderItem = (item: any) => {
                                      if (item.kind === 'task' && item.task) {
                                        const task = item.task;
                                        const dueMs = getTaskDueMs(task);
                                        const aiScore = (task as any).aiCriticalityScore ?? (task as any).aiPriorityScore;
                                        const refLabel = taskRefLabel(task);
                                        const priorityBadge = getPriorityBadge((task as any).priority);
                                        const dueLabel = dueMs ? formatDueDetail(dueMs) : null;
                                        return (
                                          <div key={item.id} className="border rounded p-2 mb-2 dashboard-due-item">
                                            <div className="d-flex align-items-start justify-content-between gap-2">
                                              <div className="fw-semibold small flex-grow-1">
                                                <a href="#" className="text-decoration-none" onClick={(e) => { e.preventDefault(); setInlineEditTask(task); }}>{task.title}</a>
                                              </div>
                                              <button type="button" className="d-none d-md-inline-flex align-items-center justify-content-center" onClick={() => showSidebar(task as any, 'task')} title="Activity stream" style={{ color: 'var(--bs-secondary-color)', padding: 4, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 0, flexShrink: 0 }}>
                                                <Activity size={14} />
                                              </button>
                                            </div>
                                            {refLabel && (
                                              <a href="#" className="text-decoration-none" onClick={(e) => { e.preventDefault(); setInlineEditTask(task); }}>
                                                <code className="text-primary" style={{ fontSize: 11 }}>{refLabel}</code>
                                              </a>
                                            )}
                                            <div className="d-flex align-items-center gap-2 mt-1 flex-wrap">
                                              <span className="text-muted d-inline-flex align-items-center gap-1" style={{ fontSize: 11 }}>
                                                <Clock size={11} />
                                                <input type="date" className="dashboard-due-date-input" value={dueMs ? format(new Date(dueMs), 'yyyy-MM-dd') : ''} onChange={(e) => { const val = e.target.value; if (!val) return; handleTaskDueDateChange(task, new Date(val + 'T12:00:00').getTime()); }} />
                                              </span>
                                              <span className="dashboard-chip-select-wrap">
                                                <select className="dashboard-chip-select" value={Number((task as any).priority ?? 0)} onChange={(e) => handleTaskPriorityChange(task, Number(e.target.value))} style={{ backgroundColor: `var(--bs-${priorityBadge.bg})`, color: priorityBadge.bg === 'warning' || priorityBadge.bg === 'light' ? '#000' : '#fff' }}>
                                                  <option value={0}>None</option>
                                                  <option value={1}>Low</option>
                                                  <option value={2}>Medium</option>
                                                  <option value={3}>High</option>
                                                  <option value={4}>Critical</option>
                                                </select>
                                              </span>
                                              {(() => {
                                                const statusVal = Number(task.status ?? 0);
                                                const statusMap: Record<number, { bg: string; label: string }> = { 0: { bg: 'secondary', label: 'To do' }, 1: { bg: 'primary', label: 'Doing' }, 2: { bg: 'success', label: 'Done' } };
                                                const s = statusMap[statusVal] || statusMap[0];
                                                return (
                                                  <span className="dashboard-chip-select-wrap">
                                                    <select className="dashboard-chip-select" value={statusVal} onChange={(e) => handleTaskStatusChange(task, Number(e.target.value))} style={{ backgroundColor: `var(--bs-${s.bg})`, color: '#fff' }}>
                                                      <option value={0}>To do</option>
                                                      <option value={1}>Doing</option>
                                                      <option value={2}>Done</option>
                                                    </select>
                                                  </span>
                                                );
                                              })()}
                                              <span className="text-muted" style={{ fontSize: 11 }}>AI {aiScore != null ? Math.round(aiScore) : '—'}</span>
                                            </div>
                                          </div>
                                        );
                                      }
                                      return null;
                                    };
                                    return (
                                      <div className="widget-time-buckets">
                                        {morning.length > 0 && (<div className="mb-3"><h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Morning</small></h6>{sortByDueTime(morning).map(renderItem)}</div>)}
                                        {afternoon.length > 0 && (<div className="mb-3"><h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Afternoon</small></h6>{sortByDueTime(afternoon).map(renderItem)}</div>)}
                                        {evening.length > 0 && (<div className="mb-3"><h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Evening</small></h6>{sortByDueTime(evening).map(renderItem)}</div>)}
                                        {other.length > 0 && (<div className="mb-0">{(morning.length > 0 || afternoon.length > 0 || evening.length > 0) && <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Other / Anytime</small></h6>}{sortByDueTime(other).map(renderItem)}</div>)}
                                      </div>
                                    );
                                  })()
                                )}
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('tasksDueToday')}
                            {renderWidgetResizeHandle('tasksDueToday', 320, 'Resize tasks due today widget')}
                          </div>
                        )}
                        {widgetKey === 'choresHabits' && widgetVisibility.choresHabits && (
                          <div
                            ref={setWidgetResizeContainer('choresHabits')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('choresHabits', 320)}
                          >
                            <Card className="shadow-sm border-0 h-100 dashboard-chores-card">
                              <Card.Header className="d-flex align-items-center justify-content-between">
                                <div className="fw-semibold d-flex align-items-center gap-2">
                                  <ListChecks size={16} /> Chores & Habits
                                </div>
                                <div className="d-flex align-items-center gap-2">
                                  <Link to="/dashboard/habit-tracking" className="btn btn-sm btn-outline-secondary">Tracking</Link>
                                  <Link to="/chores/checklist" className="btn btn-sm btn-outline-secondary">Checklist</Link>
                                  <Badge bg={choresDueTodayTasks.length > 0 ? 'info' : 'secondary'} pill>{choresDueTodayTasks.length}</Badge>
                                </div>
                              </Card.Header>
                              <Card.Body className="p-3">
                                {tasksDueTodayLoading ? (
                                  <div className="d-flex align-items-center gap-2 text-muted"><Spinner size="sm" animation="border" /> Loading chores…</div>
                                ) : choresDueTodayTasks.length === 0 ? (
                                  <div className="text-muted small">No chores, habits, or routines due today.</div>
                                ) : (
                                  (() => {
                                    const morning: typeof choresDueTodayTasks = [];
                                    const afternoon: typeof choresDueTodayTasks = [];
                                    const evening: typeof choresDueTodayTasks = [];
                                    const other: typeof choresDueTodayTasks = [];
                                    choresDueTodayTasks.forEach((task) => {
                                      const tod = (task as any).timeOfDay;
                                      if (tod === 'morning') morning.push(task);
                                      else if (tod === 'afternoon') afternoon.push(task);
                                      else if (tod === 'evening') evening.push(task);
                                      else other.push(task);
                                    });
                                    const renderChore = (task: any) => {
                                      const kind = getChoreKind(task) || 'chore';
                                      const dueMs = resolveRecurringDueMs(task, todayDate, todayStartMs);
                                      const dueLabel = dueMs ? formatDueDetail(dueMs) : 'today';
                                      const isOverdue = !!dueMs && dueMs < todayStartMs;
                                      const badgeVariant = kind === 'routine' ? 'success' : kind === 'habit' ? 'secondary' : 'primary';
                                      const badgeLabel = kind === 'routine' ? 'Routine' : kind === 'habit' ? 'Habit' : 'Chore';
                                      const busy = !!choreCompletionBusy[task.id];
                                      return (
                                        <div key={task.id} className="border rounded p-2 mb-2 d-flex align-items-start gap-2">
                                          <Form.Check type="checkbox" checked={busy} disabled={busy} onChange={() => handleCompleteChoreTask(task)} aria-label={`Complete ${task.title}`} />
                                          <div className="flex-grow-1">
                                            <Link to={`/chores/checklist?taskId=${encodeURIComponent(task.id)}`} className="text-decoration-none fw-semibold small">{task.title}</Link>
                                            <div className="text-muted small">Due {dueLabel}</div>
                                          </div>
                                          <div className="d-flex flex-column align-items-end gap-1">
                                            <button type="button" className="d-inline-flex align-items-center justify-content-center" onClick={() => showSidebar(task as any, 'task' as any)} title="Activity stream" style={{ color: 'var(--bs-secondary-color)', padding: 4, borderRadius: 4, border: 'none', background: 'transparent', cursor: 'pointer', lineHeight: 0 }}>
                                              <Activity size={14} />
                                            </button>
                                            {isOverdue && <Badge bg="danger">Overdue</Badge>}
                                            <Badge bg={badgeVariant}>{badgeLabel}</Badge>
                                          </div>
                                        </div>
                                      );
                                    };
                                    return (
                                      <div className="widget-time-buckets">
                                        {morning.length > 0 && (<div className="mb-3"><h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Morning</small></h6>{morning.map((t) => renderChore(t))}</div>)}
                                        {afternoon.length > 0 && (<div className="mb-3"><h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Afternoon</small></h6>{afternoon.map((t) => renderChore(t))}</div>)}
                                        {evening.length > 0 && (<div className="mb-3"><h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Evening</small></h6>{evening.map((t) => renderChore(t))}</div>)}
                                        {other.length > 0 && (<div className="mb-0">{(morning.length > 0 || afternoon.length > 0 || evening.length > 0) && <h6 className="text-muted mb-2 border-bottom pb-1 fw-bold"><small>Other / Anytime</small></h6>}{other.map((t) => renderChore(t))}</div>)}
                                      </div>
                                    );
                                  })()
                                )}
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('choresHabits')}
                            {renderWidgetResizeHandle('choresHabits', 320, 'Resize chores and habits widget')}
                          </div>
                        )}
                                    {widgetKey === 'calendar' && widgetVisibility.calendar && (
                          <div
                            ref={setWidgetResizeContainer('calendar')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('calendar', 420)}
                          >
                            <Card className="shadow-sm border-0 mb-3 d-flex flex-column">
                              <Card.Header className="d-flex align-items-center justify-content-between">
                                <div className="fw-semibold d-flex align-items-center gap-2">
                                  <CalendarIcon size={16} /> Calendar
                                </div>
                                <Link to="/calendar" className="btn btn-sm btn-outline-secondary">Open full calendar</Link>
                              </Card.Header>
                              <Card.Body className="p-0 flex-grow-1" style={{ minHeight: 0, overflow: 'hidden' }}>
                                <RBC
                                  localizer={_rbcLocalizer}
                                  events={calendarEvents}
                                  defaultView={Views.AGENDA}
                                  view={Views.AGENDA}
                                  date={new Date()}
                                  onView={() => {}}
                                  onNavigate={() => {}}
                                  style={{ height: '100%', minHeight: 360 }}
                                  eventPropGetter={(event: any) => ({
                                    style: { backgroundColor: event.color || '#3b82f6', color: event.textColor || '#fff', border: 'none' },
                                  })}
                                  formats={{
                                    timeGutterFormat: (date: Date) => format(date, 'HH:mm'),
                                    eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) => `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`,
                                  }}
                                />
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('calendar')}
                          </div>
                        )}
                                    {widgetKey === 'recoveryMetrics' && widgetVisibility.recoveryMetrics && (
                          <div
                            ref={setWidgetResizeContainer('recoveryMetrics')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('recoveryMetrics', 300)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Body>
                                <RecoveryWidget />
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('recoveryMetrics')}
                          </div>
                        )}
                        {widgetKey === 'activityMetrics' && widgetVisibility.activityMetrics && (
                          <div
                            ref={setWidgetResizeContainer('activityMetrics')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('activityMetrics', 240)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Body>
                                <ActivityWidget />
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('activityMetrics')}
                          </div>
                        )}
                        {widgetKey === 'fitnessMetrics' && widgetVisibility.fitnessMetrics && (
                          <div
                            ref={setWidgetResizeContainer('fitnessMetrics')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('fitnessMetrics', 280)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Body>
                                <FitnessWidget />
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('fitnessMetrics')}
                          </div>
                        )}
                        {widgetKey === 'sprintVelocity' && widgetVisibility.sprintVelocity && (
                          <div
                            ref={setWidgetResizeContainer('sprintVelocity')}
                            className="dashboard-widget-shell"
                            style={getWidgetSizeStyle('sprintVelocity', 220)}
                          >
                            <Card className="shadow-sm border-0 mb-3">
                              <Card.Body>
                                <SprintVelocityWidget />
                              </Card.Body>
                            </Card>
                            {renderWidgetEdgeHandles('sprintVelocity')}
                          </div>
                        )}
                                  </SortableDashboardWidget>
                                );
                              })}
                            </div>
                          </SortableContext>
                        </DndContext>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

          </Col>
        </Row>
      </Container>

      <EditTaskModal
        show={!!inlineEditTask}
        task={inlineEditTask}
        onHide={() => setInlineEditTask(null)}
      />
      <EditStoryModal
        show={!!inlineEditStory}
        story={inlineEditStory}
        goals={goalsList}
        onHide={() => setInlineEditStory(null)}
      />
    </>
  );
};

export default Dashboard;
