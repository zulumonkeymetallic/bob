import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Gantt } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/all.css';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Star, Search, Edit3, Wand2, CalendarClock, Activity, Maximize2, Minimize2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
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
}

const DAY_MS = 86400000;
const MILESTONE_THRESHOLD_DAYS = 14;
const PROGRESS_SHOW_MIN_ZOOM = 45;
const PROGRESS_HIDE_AFTER_ZOOM = 75;

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
        <div className="grv6-milestone-row">
          <div
            className="grv6-milestone"
            style={{ backgroundColor: data.themeColor }}
          >
            <Star size={16} fill="#fff" strokeWidth={1.5} />
          </div>
          <div className={`grv6-milestone-meta ${isCriticalMilestone ? 'critical' : ''}`}>
            <div
              className="grv6-milestone-label"
              style={{ color: data.themeColor, fontSize: `${Math.max(10, titleSize)}px`, fontWeight: 600 }}
            >
              {label}
            </div>
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
  const { theme } = useTheme();
  const { themes: globalThemes } = useGlobalThemes();
  const { sprints, selectedSprintId } = useSprint();
  const { showSidebar } = useSidebar();
  const [goals, setGoals] = useState<Goal[]>([]);
  const goalsById = useMemo(() => goals.reduce<Record<string, Goal>>((acc, g) => { acc[g.id] = g; return acc; }, {}), [goals]);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyPoints, setStoryPoints] = useState<Record<string, number>>({});
  const [storyDonePoints, setStoryDonePoints] = useState<Record<string, number>>({});
  const [potBalances, setPotBalances] = useState<Record<string, { balance: number; currency: string }>>({});
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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
  const ganttApiRef = useRef<any | null>(null);

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
      const result = await planner({ persona: 'personal', startDate, days: 7, focusGoalId: goal.id, goalTimeRequest: minutes });
      const blocksCreated = (result.data as any)?.llm?.blocksCreated || 0;
      alert(`AI scheduled ${blocksCreated} block${blocksCreated === 1 ? '' : 's'} for "${goal.title || 'Goal'}"`);
    } catch (err: any) {
      alert('Failed to schedule via AI: ' + (err?.message || 'unknown'));
    }
  }, []);

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
      where('persona', '==', 'personal')
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
  }, [currentUser?.uid]);

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

  const scales = useMemo(() => {
    const quarterFormatter = (d: Date) => `Q${Math.floor(d.getMonth() / 3) + 1}`;
    const monthNarrow = (d: Date) => d.toLocaleString('default', { month: 'narrow' });
    const monthShort = (d: Date) => d.toLocaleString('default', { month: 'short' });

    if (zoomPercent <= 18) {
      // years + quarters only for ultra-zoomed out views
      return [
        { unit: 'year', step: 1, format: 'yyyy' },
        { unit: 'quarter', step: 1, format: quarterFormatter }
      ];
    }
    if (zoomPercent <= 60) {
      // quarters primary
      return [
        { unit: 'year', step: 1, format: 'yyyy' },
        { unit: 'quarter', step: 1, format: quarterFormatter }
      ];
    }
    if (zoomPercent <= 88) {
      // months
      return [
        { unit: 'year', step: 1, format: 'yyyy' },
        { unit: 'month', step: 1, format: monthShort }
      ];
    }
    // weeks
    return [
      { unit: 'month', step: 1, format: (d: Date) => `${monthShort(d)} ${d.getFullYear()}` },
      { unit: 'week', step: 1, format: 'w' }
    ];
  }, [zoomPercent]);

  const markers = useMemo(() => {
    const todayMarker = { start: new Date(), css: 'grv6-today-marker', text: 'Today' };
    return [todayMarker];
  }, []);

  const cellHeight = useMemo(() => {
    const min = 50;
    const max = 130;
    return Math.round(min + (zoomPercent / 100) * (max - min));
  }, [zoomPercent]);

  const cellWidth = useMemo(() => {
    const min = 24;
    const max = 110;
    return Math.round(min + (zoomPercent / 100) * (max - min));
  }, [zoomPercent]);

  const { tasks, chartStart, chartEnd } = useMemo(() => {
    let min: Date | null = null;
    let max: Date | null = null;
    const list: GanttTask[] = [];
    const rowsByTheme: Record<string, Array<{ rowIndex: number; lastEnd: number }>> = {};
    let nextRowIndex = 0;

    const spacingBase = 70;
    const spacingRange = 110;
    const zoomFactor = Math.max(0, Math.min(1, (100 - zoomPercent) / 100));
    const dynamicRowSpacing = Math.round(spacingBase + spacingRange * zoomFactor);

    const assignRowIndex = (key: string, startMs: number, endMs: number) => {
      if (!rowsByTheme[key]) {
        rowsByTheme[key] = [];
      }
      const rows = rowsByTheme[key];
      for (const row of rows) {
        if (startMs >= row.lastEnd) {
          row.lastEnd = endMs;
          return row.rowIndex;
        }
      }
      const rowIndex = nextRowIndex++;
      rows.push({ rowIndex, lastEnd: endMs });
      return rowIndex;
    };

    for (const goal of sortedGoals) {
      const startMs = toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate) ?? Date.now();
      const endMs = toMillis((goal as any).endDate) ?? toMillis((goal as any).targetDate) ?? (startMs + 90 * DAY_MS);
      const start = new Date(startMs);
      const end = new Date(endMs);
      if (!min || start < min) min = start;
      if (!max || end > max) max = end;

      const themeId = migrateThemeValue((goal as any).theme);
      const themeDef =
        globalThemes.find(t => t.id === themeId) ||
        (goal.parentGoalId ? globalThemes.find(t => t.id === migrateThemeValue(goalsById[goal.parentGoalId]?.theme)) : undefined);
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
      const themeKey = `theme-${normalizedThemeId}`;
      const rowIndex = assignRowIndex(themeKey, startMs, endMs);
      const rowSpacingForGoal = Math.max(56, dynamicRowSpacing - (isMilestone ? 6 : 0));
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
        rowIndex,
        rowSpacing: rowSpacingForGoal,
        isCritical: isCriticalGoal,
        progressSummary: progressSummaryParts.join(' · ')
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
  }, [sortedGoals, globalThemes, storyDonePoints, storyPoints, potBalances, calendarBlocks, goalsById, handleScheduleGoal, handleGenerateStories, showSidebar, zoomPercent, cellHeight]);

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

  const persistGoalDates = useCallback(async (goalId: string, fallbackTask?: { start?: any; end?: any }) => {
    if (!currentUser?.uid) return;
    const task = ganttApiRef.current?.getTask(goalId) || fallbackTask;
    if (!task) return;
    const startMs = toMillis(task.start);
    const endMs = toMillis(task.end ?? task.start);
    if (startMs === undefined || endMs === undefined) return;

    const goal = goalsById[goalId];
    const prevStart = goal ? (toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate)) : undefined;
    const prevEnd = goal ? (toMillis((goal as any).endDate) ?? toMillis((goal as any).targetDate) ?? prevStart) : undefined;
    if (prevStart === startMs && prevEnd === endMs) return;

    console.log('[RoadmapV6] gantt change detected', {
      goalId,
      startMs,
      endMs,
      prevStart,
      prevEnd,
      source: fallbackTask ? 'event-task' : 'api-task',
      at: new Date().toISOString()
    });

    try {
      await updateDoc(doc(db, 'goals', goalId), {
        startDate: startMs,
        endDate: endMs,
        updatedAt: serverTimestamp()
      });
      console.log('[RoadmapV6] persisted goal dates', {
        goalId,
        startMs,
        endMs,
        at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[RoadmapV6] Failed to persist gantt change', err);
    }
  }, [currentUser?.uid, goalsById]);

  const handleGanttInit = useCallback((api: any) => {
    ganttApiRef.current = api;
    api?.on?.('update-task', (ev: any) => {
      console.log('[RoadmapV6] api update-task', ev);
      const goalId = String(ev?.id || ev?.task?.id || '');
      if (!goalId) return;
      if (ev?.inProgress) return;
      persistGoalDates(goalId, ev?.task);
    });
    api?.on?.('drag-task', (ev: any) => {
      console.log('[RoadmapV6] api drag-task', ev);
    });
  }, [persistGoalDates]);

  const handleTaskUpdate = useCallback((ev: any) => {
    console.log('[RoadmapV6] onUpdateTask', ev);
    if (!ev || ev.inProgress) return;
    const goalId = String(ev.id || ev.task?.id || '');
    if (!goalId) return;
    const touchedDates = ev.task?.start || ev.task?.end || typeof ev.diff === 'number';
    if (!touchedDates) return;
    requestAnimationFrame(() => persistGoalDates(goalId, ev.task));
  }, [persistGoalDates]);

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
          <div className="grv6-gantt-layered">
            <div className="grv6-sprint-bands">
              {sprints
                .filter(s => toMillis(s.startDate) && toMillis(s.endDate))
                .map(s => {
                  const startMs = toMillis(s.startDate)!;
                  const endMs = toMillis(s.endDate)!;
                  const total = chartEnd.getTime() - chartStart.getTime();
                  const leftPct = Math.max(0, ((startMs - chartStart.getTime()) / total) * 100);
                  const widthPct = Math.max(0, ((endMs - startMs) / total) * 100);
                  // Only show sprint overlays that are visible within the chart range
                  if (widthPct <= 0 || leftPct >= 100 || (leftPct + widthPct) <= 0) return null;
                  return (
                    <div
                      key={s.id}
                      className="grv6-sprint-band"
                      style={{ 
                        left: `${Math.min(100, leftPct)}%`, 
                        width: `${Math.min(100 - leftPct, widthPct)}%` 
                      }}
                    >
                      <span className="grv6-sprint-label">{s.name || 'Sprint'}</span>
                    </div>
                  );
                })}
            </div>
            <Gantt
              tasks={tasks}
              links={[]}
              start={chartStart}
              end={chartEnd}
              init={handleGanttInit}
              cellHeight={cellHeight}
              cellWidth={cellWidth}
              columns={false as unknown as any}
              taskTemplate={TaskTemplate as any}
              onUpdateTask={handleTaskUpdate}
              highlightTime={(d: Date) => {
                if (!sprints.length) return '';
                const t = d.getTime();
                const sprint = sprints.find(s => {
                  const start = toMillis(s.startDate);
                  const end = toMillis(s.endDate);
                  return start && end && t >= start && t <= end;
                });
                return sprint ? 'grv6-sprint-highlight' : '';
              }}
              // @ts-ignore - markers not in type defs but supported by SVAR
              markers={markers}
              scales={scales}
            />
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
