import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Star, Search, Edit3, Wand2, CalendarClock, Activity, Maximize2, Minimize2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useTheme } from '../../contexts/ThemeContext';
import { db, functions } from '../../firebase';
import { Goal, Story, Sprint } from '../../types';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { migrateThemeValue } from '../../constants/globalThemes';
import { isStatus } from '../../utils/statusHelpers';
import { useSprint } from '../../contexts/SprintContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { httpsCallable } from 'firebase/functions';
import EditGoalModal from '../EditGoalModal';
import SprintSelector from '../SprintSelector';
import './GoalRoadmapV6.css';

interface GanttTask {
  id: string;
  text: string;
  labelText?: string;
  start: Date;
  end: Date;
  duration: number;
  progress: number; // 0-100 for SVAR gantt
  themeColor: string;
  isMilestone?: boolean;
  pointsPct?: number;
  storyPoints?: number;
  donePoints?: number;
  financePct?: number;
  hasFinance?: boolean;
  currency?: string;
  budgetTarget?: number;
  budgetActual?: number;
  budgetCurrency?: string;
  allocatedHours?: number;
  goalRef?: Goal;
  onEdit?: (goal: Goal) => void;
  onSchedule?: (goal: Goal) => void;
  onGenerateStories?: (goal: Goal) => void;
  onOpenStream?: (goal: Goal) => void;
  uiScale?: number;
  titleSize?: number;
  showDetails?: boolean;
  showChips?: boolean;
  rowIndex?: number;
  rowSpacing?: number;
  viewLevel?: 'year' | 'quarter' | 'month' | 'week';
  isCritical?: boolean;
  progressSummary?: string;
  themeId?: number | string;
  themeName?: string;
  themeOrder?: number;
}

const DAY_MS = 86400000;
const MILESTONE_THRESHOLD_DAYS = 14;
const PROGRESS_SHOW_MIN_ZOOM = 45;
const PROGRESS_HIDE_AFTER_ZOOM = 75;
const ROADMAP_LABEL_COL_WIDTH = 260;
const ROADMAP_GROUP_HEADER_HEIGHT = 30;

interface AxisBandSegment {
  key: string;
  label: string;
  left: number;
  width: number;
}

interface ThemeLaneGroup {
  key: string;
  themeId: number | string;
  themeName: string;
  themeColor: string;
  themeOrder: number;
  lanes: GanttTask[][];
  height: number;
}

type GoalDragMode = 'move' | 'resize-start' | 'resize-end';

interface GoalDateOverride {
  startMs: number;
  endMs: number;
}

interface GoalDragOperation {
  goalId: string;
  mode: GoalDragMode;
  pointerId: number;
  originX: number;
  initialStartMs: number;
  initialEndMs: number;
  lastDeltaDays: number | null;
}

function toMillis(val: any): number | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === 'number') return isNaN(val) ? undefined : val;
  if (val instanceof Date) return isNaN(val.getTime()) ? undefined : val.getTime();
  if (typeof val.toDate === 'function') {
    const d = val.toDate();
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? undefined : d.getTime();
  }
  return undefined;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function startOfQuarter(date: Date): Date {
  const quarterMonth = Math.floor(date.getMonth() / 3) * 3;
  return new Date(date.getFullYear(), quarterMonth, 1);
}

function addQuarters(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + (count * 3), 1);
}

function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

function addYears(date: Date, count: number): Date {
  return new Date(date.getFullYear() + count, 0, 1);
}

function startOfWeek(date: Date): Date {
  const normalized = startOfDay(date);
  const day = normalized.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  normalized.setDate(normalized.getDate() + diff);
  return normalized;
}

function buildAxisRow(
  chartStart: Date,
  chartEnd: Date,
  alignStart: (date: Date) => Date,
  advance: (date: Date) => Date,
  format: (date: Date) => string,
  xFromMs: (ms: number) => number
): AxisBandSegment[] {
  const segments: AxisBandSegment[] = [];
  const rangeEndExclusive = chartEnd.getTime() + DAY_MS;
  let cursor = alignStart(chartStart);

  while (cursor.getTime() < rangeEndExclusive) {
    const next = advance(cursor);
    const clampedStart = Math.max(cursor.getTime(), chartStart.getTime());
    const clampedEnd = Math.min(next.getTime(), rangeEndExclusive);
    if (clampedEnd > clampedStart) {
      segments.push({
        key: `${cursor.toISOString()}-${next.toISOString()}`,
        label: format(cursor),
        left: xFromMs(clampedStart),
        width: Math.max(1, xFromMs(clampedEnd) - xFromMs(clampedStart))
      });
    }
    cursor = next;
  }

  return segments;
}

const TaskTemplate: React.FC<{ data: GanttTask }> = ({ data }) => {
  const label = data.labelText || data.text;
  const titleSize = data.titleSize || 12;
  const storyTotal = data.storyPoints ?? 0;
  const storyDone = data.donePoints ?? 0;
  const hasStoryProgress = storyTotal > 0;
  const storyProgress = hasStoryProgress ? Math.min(Math.round((storyDone / storyTotal) * 100), 100) : 0;
  const hasBudgetProgress =
    typeof data.budgetTarget === 'number' &&
    data.budgetTarget > 0 &&
    typeof data.budgetActual === 'number';
  const budgetProgress = hasBudgetProgress
    ? Math.min(Math.round((data.budgetActual! / data.budgetTarget!) * 100), 100)
    : Math.min(Math.max(data.financePct ?? 0, 0), 100);
  const budgetCurrency = data.budgetCurrency || data.currency || '';
  const budgetLabel =
    hasBudgetProgress && typeof data.budgetActual === 'number'
      ? `${budgetCurrency} ${data.budgetActual.toFixed(1)} / ${data.budgetTarget?.toFixed(1)}`
      : undefined;
  const viewLevel = data.viewLevel ?? 'week';
  const zoomPct = data.uiScale ?? 0;

  const progressInfoParts: string[] = [];
  if (hasStoryProgress) {
    progressInfoParts.push(`Story ${storyDone}/${storyTotal} pts (${storyProgress}%)`);
  }
  if (hasBudgetProgress) {
    progressInfoParts.push(`Budget ${budgetProgress}%`);
  } else if (data.hasFinance && data.financePct !== undefined) {
    progressInfoParts.push(`Budget ${Math.min(Math.max(data.financePct, 0), 100)}%`);
  }
  const tooltipLabel =
    progressInfoParts.length ? `${label} — ${progressInfoParts.join(' · ')}` : label;
  const progressSummary = progressInfoParts.join(' · ');
  const showProgressContent = Boolean(progressInfoParts.length);
  const finalProgressSummary =
    (!showProgressContent && !progressSummary)
      ? ''
      : data.progressSummary && showProgressContent
        ? `${data.progressSummary} · ${progressSummary}`
        : progressSummary;
  const isCriticalMilestone = Boolean(data.isMilestone && data.isCritical);

  const accentBackground = `linear-gradient(180deg, ${data.themeColor || '#2563eb'}14, ${data.themeColor || '#2563eb'}2e)`;
  const rowSpacingFallback = viewLevel === 'year' ? 140 : viewLevel === 'quarter' ? 110 : viewLevel === 'month' ? 90 : 80;
  const rowSpacing = data.rowSpacing ?? rowSpacingFallback;
  const rowOffset = (data.rowIndex ?? 0) * rowSpacing;
  const taskShellStyle = {
    transform: `translateY(${rowOffset}px)`,
    zIndex: 10 + (data.rowIndex ?? 0),
  };

  if (data.isMilestone) {
    return (
      <div className="grv6-task-shell grv6-milestone-shell" title={tooltipLabel} style={taskShellStyle}>
        <div
          className="grv6-milestone-label-above"
          style={{ color: data.themeColor, fontSize: `${Math.max(10, titleSize)}px`, fontWeight: 600 }}
        >
          {label}
        </div>
        <div className="grv6-milestone-row">
          <div
            className="grv6-milestone"
            style={{ backgroundColor: data.themeColor }}
          >
            <Star size={16} fill="#fff" strokeWidth={1.5} />
          </div>
          <div className={`grv6-milestone-meta ${isCriticalMilestone ? 'critical' : ''}`}>
            <div className="grv6-milestone-actions">
              <button
                className="grv6-icon-btn grv6-milestone-icon-btn"
                title="Edit goal"
                onClick={(e) => { e.stopPropagation(); data.goalRef && data.onEdit?.(data.goalRef); }}
              >
                <Edit3 size={12} />
              </button>
              <button
                className="grv6-icon-btn grv6-milestone-icon-btn"
                title="AI schedule time blocks"
                onClick={(e) => { e.stopPropagation(); data.goalRef && data.onSchedule?.(data.goalRef); }}
              >
                <CalendarClock size={12} />
              </button>
              <button
                className="grv6-icon-btn grv6-milestone-icon-btn"
                title="Generate stories"
                onClick={(e) => { e.stopPropagation(); data.goalRef && data.onGenerateStories?.(data.goalRef); }}
              >
                <Wand2 size={12} />
              </button>
              <button
                className="grv6-icon-btn grv6-milestone-icon-btn"
                title="Open activity stream"
                onClick={(e) => { e.stopPropagation(); data.goalRef && data.onOpenStream?.(data.goalRef); }}
              >
                <Activity size={12} />
              </button>
            </div>
          </div>
        </div>
        {progressSummary && (
          <div className="grv6-milestone-metrics">{progressSummary}</div>
        )}
      </div>
    );
  }

  return (
    <div className="grv6-task-shell" title={tooltipLabel} style={taskShellStyle}>
      <div
        className="grv6-task"
        style={{
          background: accentBackground,
          boxShadow: `inset 0 0 0 1px ${data.themeColor || 'rgba(59,130,246,0.4)'}`,
        }}
        aria-label={tooltipLabel}
      >
        <div className="grv6-task-title-row">
          <div
            className="grv6-task-title"
            style={{ fontSize: `${Math.max(12, titleSize)}px`, color: data.themeColor }}
          >
            {label}
          </div>
          {hasStoryProgress && zoomPct <= PROGRESS_HIDE_AFTER_ZOOM && zoomPct >= PROGRESS_SHOW_MIN_ZOOM && (
            <span className="grv6-task-pct">{storyProgress}%</span>
          )}
        </div>
        {showProgressContent && (
          <div className="grv6-task-progress-bottom">
            <div className="grv6-progress-bars">
              {hasStoryProgress && (
                <div className="grv6-progress-row">
                  <span className="grv6-progress-label">Story</span>
                  <div className="grv6-progress-track">
                    <div className="grv6-progress-fill story" style={{ width: `${storyProgress}%` }} />
                  </div>
                  <span className="grv6-progress-value">{`${storyDone}/${storyTotal} pts`}</span>
                </div>
              )}
              {hasBudgetProgress && (
                <div className="grv6-progress-row">
                  <span className="grv6-progress-label">Budget</span>
                  <div className="grv6-progress-track">
                    <div className="grv6-progress-fill budget" style={{ width: `${budgetProgress}%` }} />
                  </div>
                  <span className="grv6-progress-value">{budgetLabel || `${budgetCurrency} ${budgetProgress}%`}</span>
                </div>
              )}
            </div>
            {finalProgressSummary && <div className="grv6-progress-summary">{finalProgressSummary}</div>}
          </div>
        )}
        <div className="grv6-actions">
          <button
            className="grv6-icon-btn"
            title="Edit goal"
            onClick={(e) => { e.stopPropagation(); data.goalRef && data.onEdit?.(data.goalRef); }}
          >
            <Edit3 size={13} />
          </button>
          <button
            className="grv6-icon-btn"
            title="AI schedule time blocks"
            onClick={(e) => { e.stopPropagation(); data.goalRef && data.onSchedule?.(data.goalRef); }}
          >
            <CalendarClock size={13} />
          </button>
          <button
            className="grv6-icon-btn"
            title="Generate stories"
            onClick={(e) => { e.stopPropagation(); data.goalRef && data.onGenerateStories?.(data.goalRef); }}
          >
            <Wand2 size={13} />
          </button>
          <button
            className="grv6-icon-btn"
            title="Open activity stream"
            onClick={(e) => { e.stopPropagation(); data.goalRef && data.onOpenStream?.(data.goalRef); }}
          >
            <Activity size={13} />
          </button>
        </div>
      </div>
    </div>
  );
};

const GoalRoadmapV6: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { theme } = useTheme();
  const { themes: globalThemes } = useGlobalThemes();
  const { sprints, selectedSprintId } = useSprint();
  const { showSidebar } = useSidebar();
  const [goals, setGoals] = useState<Goal[]>([]);
  const goalsById = useMemo(
    () => goals.reduce<Record<string, Goal>>((acc, goal) => {
      acc[goal.id] = goal;
      return acc;
    }, {}),
    [goals]
  );
  const [stories, setStories] = useState<Story[]>([]);
  const [storyPoints, setStoryPoints] = useState<Record<string, number>>({});
  const [storyDonePoints, setStoryDonePoints] = useState<Record<string, number>>({});
  const [potBalances, setPotBalances] = useState<Record<string, { balance: number; currency: string }>>({});
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [goalDateOverrides, setGoalDateOverrides] = useState<Record<string, GoalDateOverride>>({});
  const [activeDragGoalId, setActiveDragGoalId] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [themeFilter, setThemeFilter] = useState<number | 'all'>('all');
  const [sortMode, setSortMode] = useState<'start' | 'end'>('start');
  const [zoomLevel, setZoomLevel] = useState<'year' | 'quarter' | 'month' | 'week'>('year');
  const [zoomPercent, setZoomPercent] = useState<number>(5); // 5..100 mapped to levels
  const [showStoryGoalsOnly, setShowStoryGoalsOnly] = useState(true);
  const [respectSprintScope, setRespectSprintScope] = useState(true);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragOperationRef = useRef<GoalDragOperation | null>(null);
  const dayWidthRef = useRef<number>(1);
  const chartStartMsRef = useRef<number>(0);
  const chartEndMsRef = useRef<number>(0);
  const goalsByIdRef = useRef<Record<string, Goal>>({});
  const goalDateOverridesRef = useRef<Record<string, GoalDateOverride>>({});
  const currentUserUidRef = useRef<string | undefined>(undefined);
  const pointerMoveHandlerRef = useRef<(event: PointerEvent) => void>(() => {});
  const pointerUpHandlerRef = useRef<(event: PointerEvent) => void>(() => {});

  const ENABLE_MONZO_POTS = process.env.REACT_APP_ENABLE_MONZO_POTS === 'true';

  const handleGenerateStories = useCallback(async (goal: Goal) => {
    try {
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      await callable({ goalId: goal.id });
    } catch (e: any) {
      console.error('generateStoriesForGoal failed', e);
      alert('Failed to trigger story generation');
    }
  }, []);

  const handleScheduleGoal = useCallback(async (goal: Goal) => {
    try {
      const planner = httpsCallable(functions, 'runPlanner');
      const minutes = Math.min(Math.max(60, (goal.timeToMasterHours || 2) * 60), 300);
      const startDate = new Date().toISOString().slice(0, 10);
      const result = await planner({ persona: currentPersona || 'personal', startDate, days: 7, focusGoalId: goal.id, goalTimeRequest: minutes });
      const blocksCreated = (result.data as any)?.llm?.blocksCreated || 0;
      alert(`AI scheduled ${blocksCreated} block${blocksCreated === 1 ? '' : 's'} for "${goal.title || 'Goal'}"`);
    } catch (err: any) {
      alert('Failed to schedule via AI: ' + (err?.message || 'unknown'));
    }
  }, [currentPersona]);

  // Goals
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
        setGoals(data);
        setLoading(false);
      },
      err => {
        if ((err as any)?.code === 'permission-denied') {
          console.warn('[RoadmapV6] goals blocked by rules; rendering empty', { uid: currentUser.uid });
          setGoals([]);
          setLoading(false);
          return;
        }
        console.error('[RoadmapV6] goals error', err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Stories + story point aggregation
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Story));
        setStories(data);
        const totals: Record<string, number> = {};
        const done: Record<string, number> = {};
        for (const story of data) {
          const gid = (story as any).goalId as string | undefined;
          if (!gid) continue;
          const pts = Number((story as any).points || 0);
          totals[gid] = (totals[gid] || 0) + pts;
          if (isStatus((story as any).status, 'done')) {
            done[gid] = (done[gid] || 0) + pts;
          }
        }
        setStoryPoints(totals);
        setStoryDonePoints(done);
      },
      err => {
        if ((err as any)?.code === 'permission-denied') {
          console.warn('[RoadmapV6] stories blocked by rules; rendering empty', { uid: currentUser?.uid });
          setStories([]);
          setStoryPoints({});
          setStoryDonePoints({});
          return;
        }
        console.error('[RoadmapV6] stories error', err);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Calendar blocks for allocated hours
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'calendarBlocks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona || 'personal')
    );
    const unsub = onSnapshot(
      q,
      snap => {
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setCalendarBlocks(data);
      },
      err => {
        console.error('[RoadmapV6] calendar blocks error', err);
      }
    );
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  // Monzo pots (optional)
  useEffect(() => {
    if (!ENABLE_MONZO_POTS) return;
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(
      q,
      snap => {
        const map: Record<string, { balance: number; currency: string }> = {};
        snap.docs.forEach(d => {
          const data = d.data();
          map[d.id] = { balance: Number(data.balance || 0) / 100, currency: data.currency || 'GBP' };
        });
        setPotBalances(map);
      },
      err => {
        if ((err as any)?.code === 'permission-denied') {
          console.warn('[RoadmapV6] monzo_pots blocked; skipping finance overlays', { uid: currentUser?.uid });
          return;
        }
        console.error('[RoadmapV6] monzo_pots error', err);
      }
    );
    return () => unsub();
  }, [currentUser?.uid, ENABLE_MONZO_POTS]);

  const themeOptions = useMemo(
    () => (globalThemes || []).map(t => ({ id: t.id, name: t.name || t.label || `Theme ${t.id}`, color: t.color })),
    [globalThemes]
  );

  const storySprintMap = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    stories.forEach(story => {
      if (!story.goalId || !story.sprintId) return;
      if (!map[story.goalId]) map[story.goalId] = new Set();
      map[story.goalId].add(story.sprintId);
    });
    return map;
  }, [stories]);

  const selectedSprint: Sprint | undefined = useMemo(() => {
    if (!selectedSprintId) return undefined;
    return sprints.find(s => s.id === selectedSprintId);
  }, [selectedSprintId, sprints]);

  const filteredGoals = useMemo(() => {
    const term = search.trim().toLowerCase();
    return goals.filter(g => {
      const themeId = migrateThemeValue((g as any).theme);
      if (themeFilter !== 'all' && themeId !== themeFilter) return false;
      if (showStoryGoalsOnly && !(storyPoints[g.id] > 0)) return false;
      if (respectSprintScope && selectedSprint) {
        const sprintStart = toMillis(selectedSprint.startDate);
        const sprintEnd = toMillis(selectedSprint.endDate);
        const overlapsSprint = (() => {
          if (!sprintStart || !sprintEnd) return false;
          const gStart = toMillis((g as any).startDate) ?? toMillis((g as any).targetDate) ?? Date.now();
          const gEnd = toMillis((g as any).endDate) ?? toMillis((g as any).targetDate) ?? gStart;
          return gStart <= sprintEnd && gEnd >= sprintStart;
        })();
        const hasStoryInSprint = storySprintMap[g.id]?.has(selectedSprint.id);
        if (!overlapsSprint && !hasStoryInSprint) return false;
      }
      if (!term) return true;
      return (g.title || '').toLowerCase().includes(term);
    });
  }, [goals, search, themeFilter, showStoryGoalsOnly, storyPoints, respectSprintScope, selectedSprint, storySprintMap]);

  const sortedGoals = useMemo(() => {
    const enriched = filteredGoals.map(goal => {
      const startMs = toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate) ?? Date.now();
      const endMs = toMillis((goal as any).endDate) ?? toMillis((goal as any).targetDate) ?? (startMs + 90 * DAY_MS);
      return { goal, startMs, endMs };
    });

    enriched.sort((a, b) => {
      const primary = sortMode === 'end' ? (a.endMs ?? 0) - (b.endMs ?? 0) : (a.startMs ?? 0) - (b.startMs ?? 0);
      if (primary !== 0) return primary;
      return (a.endMs ?? 0) - (b.endMs ?? 0);
    });

    return enriched.map(e => e.goal);
  }, [filteredGoals, sortMode]);

  const { tasks, chartStart, chartEnd } = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    const list: GanttTask[] = [];
    const themeOrderMap = new Map((globalThemes || []).map((t, index) => [String(t.id), index]));

    for (const goal of sortedGoals) {
      const fallbackStartMs = toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate) ?? Date.now();
      const fallbackEndMs = toMillis((goal as any).endDate) ?? toMillis((goal as any).targetDate) ?? (fallbackStartMs + 90 * DAY_MS);
      const dateOverride = goalDateOverrides[goal.id];
      const startMs = dateOverride?.startMs ?? fallbackStartMs;
      const endMs = Math.max(startMs + DAY_MS, dateOverride?.endMs ?? fallbackEndMs);
      const start = new Date(startMs);
      const end = new Date(endMs);
      if (!min || start < min) min = start;
      if (!max || end > max) max = end;

      const themeId = migrateThemeValue((goal as any).theme);
      const themeDef = globalThemes.find(t => t.id === themeId);
      const color = themeDef?.color || '#3b82f6';

      const totalPts = storyPoints[goal.id] || 0;
      const donePts = storyDonePoints[goal.id] || 0;
      const progressPct = totalPts > 0 ? Math.min(Math.round((donePts / totalPts) * 100), 100) : 0;
      const durationDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
      const isMilestone = durationDays < MILESTONE_THRESHOLD_DAYS;

      const allocatedHours = calendarBlocks
        .filter(block => block.goalId === goal.id)
        .reduce((total, block) => {
          const duration = block.durationMinutes || 60;
          return total + (duration / 60);
        }, 0);

      let financePct = 0;
      let hasFinance = false;
      let currency: string | undefined;
      let budgetTarget: number | undefined;
      let budgetActual: number | undefined;
      let budgetCurrency: string | undefined;
      if ((goal as any).potId && potBalances[(goal as any).potId]) {
        const pot = potBalances[(goal as any).potId];
        const target = Number((goal as any).estimatedCost || 0);
        if (target > 0) {
          const pct = Math.min(Math.round((pot.balance / target) * 100), 100);
          financePct = pct;
          hasFinance = true;
          currency = pot.currency;
          budgetTarget = target;
          budgetActual = pot.balance;
          budgetCurrency = pot.currency;
        }
      }

      const title = goal.title || 'Untitled Goal';
      const titleSize = Math.max(10, Math.round(10 + (zoomPercent / 100) * 6));
      const showDetails = zoomPercent >= 65;
      const showChips = zoomPercent >= 75;
      const normalizedThemeId = themeDef?.id ?? themeId ?? 'unknown';
      const normalizedThemeKey = String(normalizedThemeId);
      const isCriticalGoal = Boolean((goal as any).priority && (goal as any).priority >= 4);

      const progressSummaryParts: string[] = [];
      if (totalPts > 0) {
        progressSummaryParts.push(`Story ${donePts}/${totalPts} pts`);
      }
      if (hasFinance && typeof financePct === 'number') {
        progressSummaryParts.push(`Budget ${financePct}%`);
      }

      list.push({
        id: goal.id,
        text: '',
        labelText: title,
        start,
        end,
        duration: durationDays,
        progress: progressPct,
        themeColor: color,
        isMilestone,
        pointsPct: totalPts > 0 ? progressPct : undefined,
        storyPoints: totalPts || undefined,
        donePoints: donePts || undefined,
        financePct,
        hasFinance,
        currency,
        budgetTarget,
        budgetActual,
        budgetCurrency,
        allocatedHours: Math.round(allocatedHours * 10) / 10,
        goalRef: goal,
        uiScale: zoomPercent,
        viewLevel: zoomLevel,
        titleSize,
        showDetails,
        showChips,
        onEdit: (g: Goal) => setEditGoal(g),
        onSchedule: (g: Goal) => handleScheduleGoal(g),
        onGenerateStories: (g: Goal) => handleGenerateStories(g),
        onOpenStream: (g: Goal) => showSidebar(g, 'goal'),
        isCritical: isCriticalGoal,
        progressSummary: progressSummaryParts.join(' · '),
        themeId: normalizedThemeId,
        themeName: themeDef?.name || themeDef?.label || `Theme ${normalizedThemeId}`,
        themeOrder: themeOrderMap.get(normalizedThemeKey) ?? Number.MAX_SAFE_INTEGER
      });
    }

    const today = new Date();
    const startDate = min ? new Date(Math.min(min.getTime(), today.getTime())) : today;
    const longHorizonDays =
      zoomPercent <= 10 ? 365 * 5 :
        zoomPercent <= 18 ? 365 * 3 :
          zoomPercent <= 60 ? 365 * 2 :
            zoomPercent <= 88 ? 365 * 1.25 :
              140;
    const endDate = max ? new Date(max.getTime() + longHorizonDays * DAY_MS) : new Date(today.getTime() + longHorizonDays * DAY_MS);
    return { tasks: list, chartStart: startDate, chartEnd: endDate };
  }, [sortedGoals, globalThemes, storyDonePoints, storyPoints, potBalances, calendarBlocks, goalDateOverrides, handleScheduleGoal, handleGenerateStories, showSidebar, zoomLevel, zoomPercent]);

  const handleThemeChange = useCallback((val: string) => {
    if (val === 'all') {
      setThemeFilter('all');
      return;
    }
    const parsed = Number(val);
    if (!Number.isNaN(parsed)) {
      setThemeFilter(parsed as number);
    }
  }, []);

  const levelToPercent = useCallback((level: typeof zoomLevel) => {
    switch (level) {
      case 'year': return 5;
      case 'quarter': return 45;
      case 'month': return 72;
      case 'week':
      default:
        return 92;
    }
  }, []);

  const percentToLevel = useCallback((pct: number): typeof zoomLevel => {
    if (pct <= 10) return 'year';
    if (pct <= 60) return 'quarter';
    if (pct <= 88) return 'month';
    return 'week';
  }, []);

  // Removed conflicting useEffect: setZoomPercent is now handled explicitly in handlers
  // useEffect(() => {
  //   setZoomPercent(levelToPercent(zoomLevel));
  // }, [zoomLevel, levelToPercent]);

  const computeFitZoom = useCallback(() => {
    if (!tasks.length) return zoomLevel;
    const spanDays = Math.max(1, Math.round((chartEnd.getTime() - chartStart.getTime()) / DAY_MS));
    let targetZoom: typeof zoomLevel = 'month';
    const spanYears = spanDays / 365;
    if (spanYears > 5) targetZoom = 'year';
    else if (spanYears > 2) targetZoom = 'quarter';
    else if (spanYears > 0.6) targetZoom = 'month';
    else targetZoom = 'week';
    return targetZoom;
  }, [chartEnd, chartStart, tasks.length, zoomLevel]);

  // Auto-fit zoom based on range
  useEffect(() => {
    if (!tasks.length) return;
    if (zoomPercent <= 10) return; // honor ultra-wide default view
    setZoomLevel(computeFitZoom());
  }, [computeFitZoom, tasks.length, zoomPercent]);

  const handleSortChange = useCallback((val: 'start' | 'end') => {
    setSortMode(val);
  }, []);

  const visibleGoalCount = tasks.length;
  const milestoneCount = tasks.filter(t => t.isMilestone).length;

  const handleClearFilters = useCallback(() => {
    setSearch('');
    setThemeFilter('all');
    setShowStoryGoalsOnly(false);
    setRespectSprintScope(false);
  }, []);

  const handleFitAll = useCallback(() => {
    const z = computeFitZoom();
    setZoomLevel(z || 'year');
    setZoomPercent(levelToPercent(z || 'year'));
  }, [computeFitZoom, levelToPercent]);

  const handleZoomSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const pct = Number(e.target.value);
    setZoomPercent(pct);
    setZoomLevel(percentToLevel(pct));
  }, [percentToLevel]);

  const dayWidth = useMemo(() => {
    return Math.max(1.5, Number((1.1 + (zoomPercent * 0.14)).toFixed(2)));
  }, [zoomPercent]);

  const totalTimelineDays = useMemo(() => {
    return Math.max(1, Math.ceil((chartEnd.getTime() - chartStart.getTime()) / DAY_MS) + 1);
  }, [chartEnd, chartStart]);

  const timelineWidth = useMemo(() => {
    return Math.max(1200, Math.round(totalTimelineDays * dayWidth));
  }, [dayWidth, totalTimelineDays]);

  const xFromMs = useCallback((ms: number) => {
    const clamped = Math.max(chartStart.getTime(), Math.min(ms, chartEnd.getTime() + DAY_MS));
    return ((clamped - chartStart.getTime()) / DAY_MS) * dayWidth;
  }, [chartEnd, chartStart, dayWidth]);

  const laneHeight = useMemo(() => {
    if (zoomLevel === 'week') return 112;
    if (zoomLevel === 'month') return 100;
    if (zoomLevel === 'quarter') return 88;
    return 82;
  }, [zoomLevel]);

  const themeGroups = useMemo<ThemeLaneGroup[]>(() => {
    const grouped = new Map<string, {
      key: string;
      themeId: number | string;
      themeName: string;
      themeColor: string;
      themeOrder: number;
      items: GanttTask[];
    }>();

    tasks.forEach((task) => {
      const key = String(task.themeId ?? 'unknown');
      const existing = grouped.get(key);
      if (existing) {
        existing.items.push(task);
        return;
      }
      grouped.set(key, {
        key,
        themeId: task.themeId ?? 'unknown',
        themeName: task.themeName || 'Other',
        themeColor: task.themeColor || '#3b82f6',
        themeOrder: task.themeOrder ?? Number.MAX_SAFE_INTEGER,
        items: [task]
      });
    });

    return Array.from(grouped.values())
      .sort((a, b) => {
        const orderDiff = a.themeOrder - b.themeOrder;
        if (orderDiff !== 0) return orderDiff;
        return a.themeName.localeCompare(b.themeName);
      })
      .map((group) => {
        const lanes: Array<{ lastEnd: number; items: GanttTask[] }> = [];
        group.items.forEach((item) => {
          const startMs = item.start.getTime();
          const endMs = item.end.getTime();
          let lane = lanes.find((candidate) => startMs >= candidate.lastEnd + DAY_MS);
          if (!lane) {
            lane = { lastEnd: endMs, items: [] };
            lanes.push(lane);
          } else {
            lane.lastEnd = endMs;
          }
          lane.items.push(item);
        });

        return {
          key: group.key,
          themeId: group.themeId,
          themeName: group.themeName,
          themeColor: group.themeColor,
          themeOrder: group.themeOrder,
          lanes: lanes.map((lane) => lane.items),
          height: ROADMAP_GROUP_HEADER_HEIGHT + (Math.max(1, lanes.length) * laneHeight)
        };
      });
  }, [laneHeight, tasks]);

  const topAxisSegments = useMemo(() => {
    if (zoomLevel === 'week') {
      return buildAxisRow(
        chartStart,
        chartEnd,
        startOfMonth,
        (date) => addMonths(date, 1),
        (date) => date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }),
        xFromMs
      );
    }
    return buildAxisRow(chartStart, chartEnd, startOfYear, (date) => addYears(date, 1), (date) => String(date.getFullYear()), xFromMs);
  }, [chartEnd, chartStart, xFromMs, zoomLevel]);

  const detailAxisSegments = useMemo(() => {
    if (zoomLevel === 'week') {
      return buildAxisRow(
        chartStart,
        chartEnd,
        startOfWeek,
        (date) => addDays(date, 7),
        (date) => `W/C ${date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
        xFromMs
      );
    }
    if (zoomLevel === 'month') {
      return buildAxisRow(
        chartStart,
        chartEnd,
        startOfMonth,
        (date) => addMonths(date, 1),
        (date) => date.toLocaleDateString('en-GB', { month: 'short' }),
        xFromMs
      );
    }
    return buildAxisRow(
      chartStart,
      chartEnd,
      startOfQuarter,
      (date) => addQuarters(date, 1),
      (date) => `Q${Math.floor(date.getMonth() / 3) + 1}`,
      xFromMs
    );
  }, [chartEnd, chartStart, xFromMs, zoomLevel]);

  const gridLines = useMemo(() => {
    const lines: number[] = [];
    let cursor =
      zoomLevel === 'week'
        ? startOfDay(chartStart)
        : zoomLevel === 'month'
          ? startOfWeek(chartStart)
          : startOfMonth(chartStart);

    while (cursor.getTime() <= chartEnd.getTime() + DAY_MS) {
      lines.push(xFromMs(cursor.getTime()));
      cursor =
        zoomLevel === 'week'
          ? addDays(cursor, 1)
          : zoomLevel === 'month'
            ? addDays(cursor, 7)
            : addMonths(cursor, 1);
    }

    return lines;
  }, [chartEnd, chartStart, xFromMs, zoomLevel]);

  const sprintBands = useMemo(() => {
    return sprints
      .filter((sprint) => toMillis(sprint.startDate) && toMillis(sprint.endDate))
      .map((sprint) => {
        const startMs = toMillis(sprint.startDate)!;
        const endMs = toMillis(sprint.endDate)! + DAY_MS;
        const left = xFromMs(startMs);
        const width = Math.max(0, xFromMs(endMs) - xFromMs(startMs));
        return {
          id: sprint.id,
          label: sprint.name || 'Sprint',
          left,
          width
        };
      })
      .filter((band) => band.width > 0);
  }, [sprints, xFromMs]);

  const todayLineX = useMemo(() => {
    return xFromMs(Date.now());
  }, [xFromMs]);

  useEffect(() => {
    dayWidthRef.current = dayWidth;
  }, [dayWidth]);

  useEffect(() => {
    chartStartMsRef.current = chartStart.getTime();
    chartEndMsRef.current = chartEnd.getTime() + DAY_MS;
  }, [chartEnd, chartStart]);

  useEffect(() => {
    goalsByIdRef.current = goalsById;
  }, [goalsById]);

  useEffect(() => {
    goalDateOverridesRef.current = goalDateOverrides;
  }, [goalDateOverrides]);

  useEffect(() => {
    currentUserUidRef.current = currentUser?.uid;
  }, [currentUser?.uid]);

  useEffect(() => {
    setGoalDateOverrides((previous) => {
      let changed = false;
      const next = { ...previous };

      Object.entries(previous).forEach(([goalId, override]) => {
        const goal = goalsById[goalId];
        if (!goal) {
          delete next[goalId];
          changed = true;
          return;
        }

        const goalStart = toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate) ?? null;
        const goalEnd =
          toMillis((goal as any).endDate) ??
          toMillis((goal as any).targetDate) ??
          goalStart;

        if (goalStart === override.startMs && goalEnd === override.endMs) {
          delete next[goalId];
          changed = true;
        }
      });

      return changed ? next : previous;
    });
  }, [goalsById]);

  const persistGoalDates = useCallback(async (goalId: string, startMs: number, endMs: number) => {
    if (!currentUserUidRef.current) return;
    try {
      await updateDoc(doc(db, 'goals', goalId), {
        startDate: startMs,
        endDate: endMs,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('[RoadmapV6] Failed to persist goal date change', {
        goalId,
        startMs,
        endMs,
        error
      });
      setGoalDateOverrides((previous) => {
        if (!previous[goalId]) return previous;
        const next = { ...previous };
        delete next[goalId];
        return next;
      });
    }
  }, []);

  useEffect(() => {
    pointerMoveHandlerRef.current = (event: PointerEvent) => {
      const operation = dragOperationRef.current;
      if (!operation || event.pointerId !== operation.pointerId) return;

      const widthPerDay = Math.max(0.5, dayWidthRef.current);
      const deltaDays = Math.round((event.clientX - operation.originX) / widthPerDay);
      if (deltaDays === operation.lastDeltaDays) return;
      operation.lastDeltaDays = deltaDays;

      const startBoundsMs = chartStartMsRef.current;
      const endBoundsMs = chartEndMsRef.current;

      let nextStartMs = operation.initialStartMs;
      let nextEndMs = operation.initialEndMs;

      if (operation.mode === 'move') {
        nextStartMs = operation.initialStartMs + (deltaDays * DAY_MS);
        nextEndMs = operation.initialEndMs + (deltaDays * DAY_MS);

        if (nextStartMs < startBoundsMs) {
          const adjustment = startBoundsMs - nextStartMs;
          nextStartMs += adjustment;
          nextEndMs += adjustment;
        }
        if (nextEndMs > endBoundsMs) {
          const adjustment = nextEndMs - endBoundsMs;
          nextStartMs -= adjustment;
          nextEndMs -= adjustment;
        }
      } else if (operation.mode === 'resize-start') {
        nextStartMs = operation.initialStartMs + (deltaDays * DAY_MS);
        nextStartMs = Math.max(startBoundsMs, Math.min(nextStartMs, operation.initialEndMs - DAY_MS));
      } else {
        nextEndMs = operation.initialEndMs + (deltaDays * DAY_MS);
        nextEndMs = Math.min(endBoundsMs, Math.max(nextEndMs, operation.initialStartMs + DAY_MS));
      }

      setGoalDateOverrides((previous) => {
        const existing = previous[operation.goalId];
        if (existing && existing.startMs === nextStartMs && existing.endMs === nextEndMs) {
          return previous;
        }
        return {
          ...previous,
          [operation.goalId]: {
            startMs: nextStartMs,
            endMs: nextEndMs
          }
        };
      });
    };

    pointerUpHandlerRef.current = (event: PointerEvent) => {
      const operation = dragOperationRef.current;
      if (!operation || event.pointerId !== operation.pointerId) return;

      dragOperationRef.current = null;
      setActiveDragGoalId(null);
      document.body.classList.remove('grv6-is-dragging');

      const override = goalDateOverridesRef.current[operation.goalId];
      if (!override) return;

      const unchanged =
        override.startMs === operation.initialStartMs &&
        override.endMs === operation.initialEndMs;
      if (unchanged) {
        setGoalDateOverrides((previous) => {
          if (!previous[operation.goalId]) return previous;
          const next = { ...previous };
          delete next[operation.goalId];
          return next;
        });
        return;
      }

      void persistGoalDates(operation.goalId, override.startMs, override.endMs);
    };
  }, [persistGoalDates]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => pointerMoveHandlerRef.current(event);
    const handlePointerUp = (event: PointerEvent) => pointerUpHandlerRef.current(event);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
      document.body.classList.remove('grv6-is-dragging');
    };
  }, []);

  const startGoalDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, goalId: string, mode: GoalDragMode) => {
    if (event.pointerType !== 'touch' && event.button !== 0) return;

    if (mode === 'move') {
      const target = event.target as HTMLElement;
      if (target.closest('button') || target.closest('.grv6-resize-handle')) {
        return;
      }
    }

    const goal = goalsByIdRef.current[goalId];
    if (!goal) return;

    const fallbackStartMs = toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate) ?? Date.now();
    const fallbackEndMs = toMillis((goal as any).endDate) ?? toMillis((goal as any).targetDate) ?? (fallbackStartMs + DAY_MS);
    const existingOverride = goalDateOverridesRef.current[goalId];
    const initialStartMs = existingOverride?.startMs ?? fallbackStartMs;
    const initialEndMs = Math.max(initialStartMs + DAY_MS, existingOverride?.endMs ?? fallbackEndMs);

    dragOperationRef.current = {
      goalId,
      mode,
      pointerId: event.pointerId,
      originX: event.clientX,
      initialStartMs,
      initialEndMs,
      lastDeltaDays: null
    };

    setActiveDragGoalId(goalId);
    document.body.classList.add('grv6-is-dragging');

    if (event.currentTarget.setPointerCapture) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch (error) {
        console.debug('[RoadmapV6] pointer capture not applied', error);
      }
    }

    event.preventDefault();
    event.stopPropagation();
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === boardRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const className = 'grv6-full-active';
    if (isFullscreen) document.body.classList.add(className);
    else document.body.classList.remove(className);
    return () => document.body.classList.remove(className);
  }, [isFullscreen]);

  const toggleFullscreen = useCallback(async () => {
    if (!boardRef.current) return;
    try {
      if (document.fullscreenElement === boardRef.current) {
        await document.exitFullscreen();
      } else if (boardRef.current.requestFullscreen) {
        await boardRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn('[RoadmapV6] fullscreen toggle failed', err);
    }
  }, []);

  if (!currentUser) return null;

  const renderTopbar = () => (
    <div className={`grv6-topbar ${isFullscreen ? 'grv6-topbar-fullscreen' : ''}`}>
      <div className="grv6-search">
        <Search size={16} />
        <input
          placeholder="Search goals"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="grv6-control-group">
        <label className="grv6-label">Theme</label>
        <select
          value={themeFilter === 'all' ? 'all' : String(themeFilter)}
          onChange={e => handleThemeChange(e.target.value)}
        >
          <option value="all">All themes</option>
          {themeOptions.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grv6-control-group">
        <label className="grv6-label">Arrange</label>
        <div className="grv6-segment">
          <button
            className={sortMode === 'start' ? 'active' : ''}
            onClick={() => handleSortChange('start')}
          >
            Start
          </button>
          <button
            className={sortMode === 'end' ? 'active' : ''}
            onClick={() => handleSortChange('end')}
          >
            End
          </button>
        </div>
      </div>
      <div className="grv6-control-group grv6-filters-inline">
        <label className="grv6-filter-row">
          <input
            type="checkbox"
            checked={showStoryGoalsOnly}
            onChange={(e) => setShowStoryGoalsOnly(e.target.checked)}
          />{' '}
          Goals with stories
        </label>
        <label className="grv6-filter-row">
          <input
            type="checkbox"
            checked={respectSprintScope}
            onChange={(e) => setRespectSprintScope(e.target.checked)}
          />{' '}
          Limit to selected sprint
        </label>
        <SprintSelector className="grv6-sprint-selector" />

      </div>
      <div className="grv6-zoom-group compact">
        {(['year', 'quarter', 'month', 'week'] as const).map(z => (
          <button
            key={`toolbar-${z}`}
            className={`grv6-zoom-btn ${zoomLevel === z ? 'active' : ''}`}
            onClick={() => {
              setZoomLevel(z);
              setZoomPercent(levelToPercent(z));
            }}
          >
            {z.charAt(0).toUpperCase() + z.slice(1)}
          </button>
        ))}
        <button className="grv6-zoom-btn" onClick={handleFitAll}>Fit all</button>
      </div>
      <div className="grv6-zoom-slider">
        <span className="grv6-label">Zoom</span>
        <input
          type="range"
          min={1}
          max={100}
          step={1}
          value={zoomPercent}
          onChange={handleZoomSliderChange}
          title={`Zoom: ${zoomPercent}%`}
        />
        <span className="grv6-zoom-pct">{zoomPercent}%</span>
      </div>
      <div className="grv6-topbar-actions">
        <button className="grv6-ghost-btn" onClick={handleClearFilters}>Clear filters</button>
        <a className="grv6-link" href="/goals" target="_blank" rel="noreferrer">Goals list</a>
        <a className="grv6-link" href="/goals-management" target="_blank" rel="noreferrer">Card view</a>
        <button
          className="grv6-fullscreen-toggle"
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          <span>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
        </button>
      </div>
    </div>
  );

  const renderGanttContent = () => {
    if (loading) {
      return <div className="grv6-loading">Loading roadmap...</div>;
    }
    return (
      <div className="grv6-gantt-wrapper">
        {tasks.length === 0 ? (
          <div className="grv6-empty text-center">
            <h3>No Goals Found</h3>
            <p className="text-muted">No goals match your filters, or you don't have permission to view them.</p>
          </div>
        ) : (
          <div className="grv6-roadmap-shell" style={{ width: ROADMAP_LABEL_COL_WIDTH + timelineWidth }}>
            <div className="grv6-pill-row grv6-roadmap-summary">
              <span className="grv6-pill">{visibleGoalCount} goals</span>
              <span className="grv6-pill subtle">{themeGroups.length} themes</span>
              <span className="grv6-pill subtle">{milestoneCount} milestones</span>
            </div>

            <div className="grv6-roadmap-header" style={{ width: ROADMAP_LABEL_COL_WIDTH + timelineWidth }}>
              <div className="grv6-roadmap-label-spacer">
                <div className="grv6-roadmap-header-title">Themes</div>
                <div className="grv6-roadmap-header-subtitle">Grouped by theme and packed into shared lanes</div>
              </div>
              <div className="grv6-roadmap-axis" style={{ width: timelineWidth }}>
                <div className="grv6-roadmap-axis-row year">
                  {topAxisSegments.map((segment) => (
                    <div
                      key={`year-${segment.key}`}
                      className="grv6-roadmap-axis-segment"
                      style={{ left: segment.left, width: segment.width }}
                    >
                      {segment.label}
                    </div>
                  ))}
                </div>
                <div className="grv6-roadmap-axis-row detail">
                  {detailAxisSegments.map((segment) => (
                    <div
                      key={`detail-${segment.key}`}
                      className="grv6-roadmap-axis-segment"
                      style={{ left: segment.left, width: segment.width }}
                    >
                      {segment.label}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="grv6-roadmap-body" style={{ width: ROADMAP_LABEL_COL_WIDTH + timelineWidth }}>
              {themeGroups.map((group) => (
                <div
                  key={group.key}
                  className="grv6-theme-group"
                  style={{ minHeight: group.height }}
                >
                  <div className="grv6-theme-label-cell" style={{ minHeight: group.height }}>
                    <div className="grv6-theme-label-stack">
                      <span className="grv6-theme-dot" style={{ backgroundColor: group.themeColor }} />
                      <div className="grv6-theme-label-copy">
                        <span className="grv6-theme-label-title">{group.themeName}</span>
                        <span className="grv6-theme-label-meta">
                          {group.lanes.reduce((total, lane) => total + lane.length, 0)} goals on {group.lanes.length} line{group.lanes.length === 1 ? '' : 's'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grv6-theme-track" style={{ width: timelineWidth, minHeight: group.height }}>
                    <div className="grv6-theme-track-header" />
                    {sprintBands.map((band) => (
                      <div
                        key={`${group.key}-${band.id}`}
                        className="grv6-roadmap-sprint-band"
                        style={{ left: band.left, width: band.width, height: group.height }}
                      >
                        <span className="grv6-roadmap-sprint-label">{band.label}</span>
                      </div>
                    ))}
                    {gridLines.map((lineX, index) => (
                      <div
                        key={`${group.key}-grid-${index}`}
                        className="grv6-roadmap-grid-line"
                        style={{ left: lineX, height: group.height }}
                      />
                    ))}
                    <div className="grv6-roadmap-today-line" style={{ left: todayLineX, height: group.height }} />

                    {group.lanes.map((lane, laneIndex) => (
                      <div
                        key={`${group.key}-lane-${laneIndex}`}
                        className="grv6-theme-lane-row"
                        style={{
                          top: ROADMAP_GROUP_HEADER_HEIGHT + (laneIndex * laneHeight),
                          height: laneHeight
                        }}
                      >
                        <span className="grv6-theme-lane-label">Line {laneIndex + 1}</span>
                      </div>
                    ))}

                    {group.lanes.flatMap((lane, laneIndex) =>
                      lane.map((task) => {
                        const startMs = task.start.getTime();
                        const endMs = Math.max(task.end.getTime() + DAY_MS, startMs + DAY_MS);
                        const left = xFromMs(startMs);
                        const width = Math.max(task.isMilestone ? 120 : 72, xFromMs(endMs) - xFromMs(startMs));
                        const previousHeight = laneHeight - 16;
                        const height = Math.max(22, Math.round(previousHeight * 0.5));
                        const top = ROADMAP_GROUP_HEADER_HEIGHT + (laneIndex * laneHeight) + Math.round((laneHeight - height) / 2);
                        const isDragging = activeDragGoalId === task.id;

                        return (
                          <div
                            key={`${group.key}-${task.id}`}
                            className={`grv6-roadmap-bar ${task.isMilestone ? 'milestone' : ''} ${isDragging ? 'dragging' : ''}`}
                            style={{ left, top, width, height }}
                            onPointerDown={(event) => startGoalDrag(event, task.id, 'move')}
                          >
                            <div
                              className="grv6-resize-handle start"
                              title="Adjust goal start date"
                              onPointerDown={(event) => startGoalDrag(event, task.id, 'resize-start')}
                            />
                            <div className="grv6-roadmap-bar-content">
                              <TaskTemplate data={task} />
                            </div>
                            <div
                              className="grv6-resize-handle end"
                              title="Adjust goal end date"
                              onPointerDown={(event) => startGoalDrag(event, task.id, 'resize-end')}
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={boardRef}
      className={`grv6-container theme-${theme} ${isFullscreen ? 'grv6-in-fullscreen' : ''}`}
    >
      <div className="grv6-header">
        <div className="grv6-title-stack">
          <h1 className="grv6-title">Goal Roadmap V6</h1>
        </div>
      </div>

      <div className="grv6-body">
        <div className="grv6-main">
          {renderTopbar()}
          {renderGanttContent()}
        </div>
      </div>

      {editGoal && (
        <EditGoalModal
          show={true}
          goal={editGoal}
          onClose={() => setEditGoal(null)}
          currentUserId={currentUser?.uid || ''}
          allGoals={goals}
        />
      )}
    </div>
  );
};

export default GoalRoadmapV6;
