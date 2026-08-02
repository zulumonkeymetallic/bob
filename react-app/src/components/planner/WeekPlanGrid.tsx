/**
 * WeekPlanGrid — the roadmap's week detail level.
 *
 * A TIME GRID, the same shape as the calendar's day view: hours down the left, one column per
 * day, and everything on it — theme allocations and scheduled work alike — drawn spanning the
 * hours it actually occupies. It was previously an agenda: a stack of cards per day in
 * start-time order, which told you what was on a day but not whether the day held together,
 * where the gaps were, or that two things overlapped.
 *
 * What appears where:
 *  - Backlog column: open work with no calendar block this week — the pile you drag from.
 *  - Day columns: whatever the AI (or you) has scheduled, read from calendar_blocks joined
 *    back to their story/task, positioned and sized by the block's start and end.
 *  - Theme allocations: a translucent underlay behind the cards, straight from the plan doc
 *    rather than from materialised blocks — only Fitness and Work are ever materialised. It is
 *    context, not content, so it can be switched off and the choice is remembered.
 *
 * Dragging a card onto a day calls schedulePlannerItem, the same callable the calendar's
 * drag-from-backlog uses. That matters: it already honours planningMode, so in strict mode
 * the item is placed inside a matching theme allocation rather than any free gap, which is
 * exactly the behaviour the nightly orchestration applies. Because this grid has a time axis,
 * the drop also carries the exact time you dropped on rather than just the date.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Flame, Pin, Star } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { useThemeAppearance } from '../../hooks/useThemeAppearance';
import { schedulePlannerItem, normalizePlannerSchedulingError } from '../../utils/plannerScheduling';
import { inferPlannerDurationMinutes } from '../../utils/plannerDeferral';
import { isDoneStatus } from '../../utils/workStatus';
import {
  compareTop3Stories, compareTop3Tasks, getEntityAiScore, isTop3Story, isTop3Task,
} from '../../utils/top3';
import { getManualPriorityRank } from '../../utils/manualPriority';
import { accentTint, themeVars } from '../../utils/themeVars';
import type { Story, Task } from '../../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
const VISIBLE_DAYS = 7;
const COL_W = 200;
const BACKLOG_W = 220;
const GUTTER_W = 46;
/** Row height for one hour. 48px fits a 15-minute block at a legible 12px. */
const PX_PER_HOUR = 48;
/** Snap dropped items to the quarter hour — finer than that is noise on a 48px hour. */
const SNAP_MINUTES = 15;
/** Default visible window when nothing on the week falls outside it. */
const DEFAULT_START_HOUR = 6;
const DEFAULT_END_HOUR = 22;
/** Anything shorter still needs to be readable, so it gets a floor rather than a hairline. */
const MIN_CARD_PX = 18;
/** The backlog is a drag source, not a browsable list — past this it is a scroll marathon. */
const BACKLOG_LIMIT = 60;
/**
 * Left inset, carried on the BACKLOG COLUMN rather than on the scroll container.
 * Padding on a scroll container leaves a strip at its inner edge that a sticky child can never
 * cover — sticky only sticks as far as the padding edge — so day columns scrolled through it
 * and appeared beside the backlog. Same trap the roadmap grid hit on its vertical axis.
 */
const EDGE_PAD = 16;

const THEME_OVERLAY_STORAGE_KEY = 'bob-roadmap-week-show-theme-allocations';
const BACKLOG_SCOPE_STORAGE_KEY = 'bob-roadmap-week-backlog-scope';

type ThemeAllocationRow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  theme: string;
  subTheme?: string | null;
};

/** Anything the grid positions on the time axis. */
interface Spanning {
  startMs: number;
  endMs: number;
}

interface WeekPlanGridProps {
  /**
   * First day of the displayed window (local midnight). The caller passes today minus two, so
   * today lands in the third column with four days of runway to its right — see the comment
   * on `weekStart` in RoadmapGrid for why this is not the calendar week.
   */
  weekStart: Date;
  /** Matches the calendar surface's Smart/Strict control — passed through to the scheduler. */
  planningMode?: 'smart' | 'strict';
}

const startOfDayMs = (d: Date | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

/** "HH:mm" to minutes past midnight, or null if it is not a time. */
const parseClock = (value: unknown): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

const readFlag = (key: string, fallback: boolean): boolean => {
  try {
    const stored = window.localStorage.getItem(key);
    return stored == null ? fallback : stored === '1';
  } catch { return fallback; }
};

/**
 * Side-by-side placement for things that overlap in time.
 *
 * Events are grouped into clusters of transitively-overlapping items, and every item in a
 * cluster is given the SAME column count, so a 09:00–17:00 block and a 10:00–10:30 one sitting
 * inside it each take half the width rather than the short one shrinking on its own and leaving
 * a gap. Within a cluster each item takes the first column free at its start time.
 */
function packLanes<T extends Spanning>(items: T[]): Array<T & { lane: number; laneCount: number }> {
  const sorted = [...items].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const out: Array<T & { lane: number; laneCount: number }> = [];
  let cluster: Array<T & { lane: number; laneCount: number }> = [];
  let clusterEnd = -Infinity;
  let laneEnds: number[] = [];

  const flush = () => {
    const laneCount = Math.max(1, laneEnds.length);
    cluster.forEach((item) => { item.laneCount = laneCount; });
    out.push(...cluster);
    cluster = [];
    laneEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length && item.startMs >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.startMs);
    if (lane === -1) {
      laneEnds.push(item.endMs);
      lane = laneEnds.length - 1;
    } else {
      laneEnds[lane] = item.endMs;
    }
    cluster.push({ ...item, lane, laneCount: 1 });
    clusterEnd = Math.max(clusterEnd, item.endMs);
  }
  if (cluster.length) flush();
  return out;
}

/**
 * The four things that make an item matter, as icons rather than words.
 *
 * A card in a time grid has room for a title and one short line, so the signals that decide
 * whether you work on something have to be glanceable: pin = you ranked it by hand, flame = the
 * AI made it a Top 3 for today, star = its goal is a focus goal, and the bare number is the AI
 * criticality score. Every one carries a title so the meaning is one hover away.
 *
 * Order is deliberate: human judgement first, then the AI's, then context. Manual priority
 * outranks everything else in the app's sort comparators, so it reads first here too.
 */
const CardSignals: React.FC<{
  entity: Story | Task;
  type: 'story' | 'task';
  isFocusGoal: boolean;
  /** Hide the AI score on very short cards, where the row would not fit. */
  compact?: boolean;
}> = ({ entity, type, isFocusGoal, compact = false }) => {
  const manualRank = getManualPriorityRank(entity as any);
  const isTop3 = type === 'story'
    ? isTop3Story(entity as Story)
    : isTop3Task(entity as Task);
  const score = getEntityAiScore(entity);
  const hasScore = Number.isFinite(score) && score > 0;

  return (
    <>
      {manualRank && (
        <span title={`You ranked this P${manualRank}`}
          style={{ color: 'var(--bs-danger, #ef4444)', display: 'inline-flex', alignItems: 'center', gap: 1 }}>
          <Pin size={9} />P{manualRank}
        </span>
      )}
      {isTop3 && (
        <span title="AI Top 3 for today" style={{ color: 'var(--bs-warning, #f59e0b)', display: 'inline-flex' }}>
          <Flame size={9} />
        </span>
      )}
      {isFocusGoal && (
        <span title="Its goal is a focus goal" style={{ color: 'var(--brand, #5f77dc)', display: 'inline-flex' }}>
          <Star size={9} />
        </span>
      )}
      {!compact && hasScore && <span title="AI criticality score">AI {Math.round(score)}</span>}
    </>
  );
};

const WeekPlanGrid: React.FC<WeekPlanGridProps> = ({ weekStart, planningMode = 'smart' }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();
  const { showSidebar } = useSidebar();
  const { resolveThemeAppearance } = useThemeAppearance();
  const navigate = useNavigate();

  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  /** Goal ids on the focus list — the star on a card means "its goal is a focus goal". */
  const [focusGoalIds, setFocusGoalIds] = useState<Set<string>>(new Set());
  const [allocations, setAllocations] = useState<{
    allocations: ThemeAllocationRow[];
    weeklyOverrides: Record<string, ThemeAllocationRow[]>;
  }>({ allocations: [], weeklyOverrides: {} });
  const [dragItem, setDragItem] = useState<{ type: 'story' | 'task'; id: string; title: string; entity: Story | Task } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  /** Theme allocations are context, not content — off is a legitimate way to work. */
  const [showAllocations, setShowAllocations] = useState<boolean>(() => readFlag(THEME_OVERLAY_STORAGE_KEY, true));
  /**
   * 'sprint' is the focused pile; 'all' is every open story and task with nothing on the
   * calendar this week — the answer to "did the orchestrator miss anything".
   */
  const [backlogScope, setBacklogScope] = useState<'sprint' | 'all'>(() => {
    try { return window.localStorage.getItem(BACKLOG_SCOPE_STORAGE_KEY) === 'all' ? 'all' : 'sprint'; } catch { return 'sprint'; }
  });

  useEffect(() => {
    try { window.localStorage.setItem(THEME_OVERLAY_STORAGE_KEY, showAllocations ? '1' : '0'); } catch { /* private mode */ }
  }, [showAllocations]);
  useEffect(() => {
    try { window.localStorage.setItem(BACKLOG_SCOPE_STORAGE_KEY, backlogScope); } catch { /* private mode */ }
  }, [backlogScope]);

  const days = useMemo(
    () => Array.from({ length: VISIBLE_DAYS }, (_, i) => new Date(startOfDayMs(weekStart) + i * DAY_MS)),
    [weekStart],
  );
  const rangeStart = startOfDayMs(weekStart);
  const rangeEnd = rangeStart + VISIBLE_DAYS * DAY_MS;

  useEffect(() => {
    if (!currentUser?.uid) return;
    const personaMatch = (row: any) =>
      currentPersona === 'work' ? row.persona === 'work' : row.persona == null || row.persona === 'personal';
    const unsubs = [
      onSnapshot(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)),
        (s) => setStories(s.docs.map((d) => ({ id: d.id, ...d.data() } as Story)).filter(personaMatch)),
        () => setStories([])),
      onSnapshot(query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid)),
        (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() } as Task)).filter(personaMatch)),
        () => setTasks([])),
      onSnapshot(query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid)),
        (s) => setBlocks(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setBlocks([])),
      onSnapshot(query(collection(db, 'focusGoals'), where('ownerUid', '==', currentUser.uid)),
        (s) => {
          const ids = new Set<string>();
          s.docs.forEach((d) => ((d.data()?.goalIds || []) as string[]).forEach((gid) => ids.add(gid)));
          setFocusGoalIds(ids);
        },
        () => setFocusGoalIds(new Set())),
      onSnapshot(doc(db, 'theme_allocations', currentUser.uid),
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : null;
          setAllocations({
            allocations: Array.isArray(data?.allocations) ? data.allocations : [],
            weeklyOverrides: (data?.weeklyOverrides && typeof data.weeklyOverrides === 'object') ? data.weeklyOverrides : {},
          });
        },
        () => setAllocations({ allocations: [], weeklyOverrides: {} })),
    ];
    return () => unsubs.forEach((u) => u());
  }, [currentUser?.uid, currentPersona]);

  const storyById = useMemo(() => new Map(stories.map((s) => [s.id, s])), [stories]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  /** Scheduled work per day — calendar blocks in range that point at a story or task. */
  const scheduledByDay = useMemo(() => {
    const map = new Map<number, Array<{ block: any; entity: Story | Task; type: 'story' | 'task'; startMs: number; endMs: number }>>();
    days.forEach((d) => map.set(startOfDayMs(d), []));
    for (const b of blocks) {
      const start = Number(b.start || 0);
      if (!Number.isFinite(start) || start < rangeStart || start >= rangeEnd) continue;
      const storyId = b.storyId ? String(b.storyId) : '';
      const taskId = b.taskId ? String(b.taskId) : '';
      const entity = storyId ? storyById.get(storyId) : taskId ? taskById.get(taskId) : undefined;
      if (!entity) continue;
      const key = startOfDayMs(start);
      if (!map.has(key)) continue;
      // A block with no usable end still has to be drawable — 30 minutes matches what the
      // scheduler gives a task with no estimate.
      const rawEnd = Number(b.end || 0);
      const endMs = Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : start + 30 * MIN_MS;
      map.get(key)!.push({ block: b, entity, type: storyId ? 'story' : 'task', startMs: start, endMs });
    }
    return map;
  }, [blocks, days, rangeStart, rangeEnd, storyById, taskById]);

  const scheduledEntityIds = useMemo(() => {
    const ids = new Set<string>();
    scheduledByDay.forEach((list) => list.forEach((x) => ids.add(x.entity.id)));
    return ids;
  }, [scheduledByDay]);

  /**
   * Theme bands for a given day, from the plan doc, with that day's own weekly override
   * winning if one exists.
   *
   * The override key is derived from EACH DAY's Monday, not from the start of the displayed
   * window. The window is a rolling seven days from two days ago, so it straddles a week
   * boundary most of the time — keying every day off the window's first day would apply last
   * week's overrides to days that belong to this week, and vice versa.
   */
  const allocationsForDay = useCallback((day: Date): ThemeAllocationRow[] => {
    const monday = new Date(day);
    monday.setHours(0, 0, 0, 0);
    // getDay(): 0 = Sunday. Shift back so Monday starts the week.
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    // Local date parts, not toISOString(): that converts to UTC first, so anywhere east of
    // Greenwich in summer the Monday becomes the previous Sunday and every override misses.
    const weekKey = [
      monday.getFullYear(),
      String(monday.getMonth() + 1).padStart(2, '0'),
      String(monday.getDate()).padStart(2, '0'),
    ].join('-');

    const rows = Array.isArray(allocations.weeklyOverrides[weekKey])
      ? allocations.weeklyOverrides[weekKey]
      : allocations.allocations;
    return rows.filter((r) => Number(r.dayOfWeek) === day.getDay());
  }, [allocations]);

  /**
   * The visible hours. Fixed 06:00–22:00 unless the week actually contains something outside
   * it, in which case the window grows to include it — a 05:30 gym block or a late shift must
   * never be silently cropped off the top or bottom of the grid.
   */
  const [startHour, endHour] = useMemo(() => {
    let lo = DEFAULT_START_HOUR;
    let hi = DEFAULT_END_HOUR;
    days.forEach((day) => {
      allocationsForDay(day).forEach((row) => {
        const s = parseClock(row.startTime);
        const e = parseClock(row.endTime);
        if (s != null) lo = Math.min(lo, Math.floor(s / 60));
        if (e != null) hi = Math.max(hi, Math.ceil(e / 60));
      });
      (scheduledByDay.get(startOfDayMs(day)) || []).forEach(({ startMs, endMs }) => {
        lo = Math.min(lo, new Date(startMs).getHours());
        // An item ending at 18:00 needs the grid to reach 18, not 19 — hence the -1ms.
        hi = Math.max(hi, new Date(endMs - 1).getHours() + 1);
      });
    });
    return [Math.max(0, lo), Math.min(24, Math.max(lo + 1, hi))];
  }, [days, allocationsForDay, scheduledByDay]);

  const hours = useMemo(
    () => Array.from({ length: endHour - startHour }, (_, i) => startHour + i),
    [startHour, endHour],
  );
  const gridHeight = (endHour - startHour) * PX_PER_HOUR;

  /** Position on the vertical axis, clamped to the visible window. */
  const offsetFor = useCallback((ms: number, dayStart: number) => {
    const minutes = (ms - dayStart) / MIN_MS;
    return ((minutes / 60) - startHour) * PX_PER_HOUR;
  }, [startHour]);

  /**
   * The pile you drag from: open work with no calendar block anywhere in the visible week.
   *
   * Both scopes include TASKS as well as stories. The sprint scope alone was hiding two whole
   * categories of unscheduled work — every task, and every story not in the selected sprint —
   * so the orchestrator could skip an item and nothing on this surface would show it.
   */
  const { backlog, backlogTotal } = useMemo(() => {
    const openStories = stories.filter((s) => !isDoneStatus((s as any).status, 'story') && !scheduledEntityIds.has(s.id));
    const openTasks = tasks.filter((t) => !isDoneStatus((t as any).status, 'task') && !scheduledEntityIds.has(t.id));

    const scopedStories = backlogScope === 'sprint' && selectedSprintId
      ? openStories.filter((s) => String((s as any).sprintId || '') === selectedSprintId)
      : openStories;
    const scopedTasks = backlogScope === 'sprint' && selectedSprintId
      ? openTasks.filter((t) => String((t as any).sprintId || '') === selectedSprintId)
      : openTasks;

    const rows: Array<{ type: 'story' | 'task'; entity: Story | Task }> = [
      ...scopedStories.sort(compareTop3Stories).map((entity) => ({ type: 'story' as const, entity })),
      ...scopedTasks.sort((a, b) => compareTop3Tasks(a, b)).map((entity) => ({ type: 'task' as const, entity })),
    ];
    // Stories lead tasks at equal priority: a story is the unit the sprint is committed to.
    rows.sort((a, b) => {
      const scoreDiff = getEntityAiScore(b.entity) - getEntityAiScore(a.entity);
      if (scoreDiff !== 0 && Number.isFinite(scoreDiff)) return scoreDiff;
      if (a.type !== b.type) return a.type === 'story' ? -1 : 1;
      return String(a.entity.title || '').localeCompare(String(b.entity.title || ''));
    });
    return { backlog: rows.slice(0, BACKLOG_LIMIT), backlogTotal: rows.length };
  }, [stories, tasks, selectedSprintId, scheduledEntityIds, backlogScope]);

  /**
   * Drop lands at the time you dropped on, not just the date. `exactTargetStartMs` is a request
   * rather than a command — in strict mode the server still confines placement to a matching
   * theme allocation — so the response's applied time is what gets reported back.
   */
  const handleDrop = useCallback(async (day: Date, offsetY: number) => {
    const item = dragItem;
    setDragItem(null);
    setDragOverDay(null);
    if (!item) return;

    const dayStart = startOfDayMs(day);
    const rawMinutes = startHour * 60 + (offsetY / PX_PER_HOUR) * 60;
    const clamped = Math.min(Math.max(rawMinutes, startHour * 60), endHour * 60 - SNAP_MINUTES);
    const snapped = Math.round(clamped / SNAP_MINUTES) * SNAP_MINUTES;
    const durationMinutes = inferPlannerDurationMinutes(item.type, item.entity as any);
    const startMs = dayStart + snapped * MIN_MS;

    setBusyId(item.id);
    setFeedback(null);
    try {
      const result = await schedulePlannerItem({
        itemType: item.type,
        itemId: item.id,
        targetDateMs: dayStart,
        intent: 'move',
        source: 'roadmap_week_grid',
        targetSprintId: selectedSprintId || null,
        durationMinutes,
        exactTargetStartMs: startMs,
        exactTargetEndMs: startMs + durationMinutes * MIN_MS,
        // Passed through so strict mode confines placement to a matching theme allocation,
        // the same rule the nightly orchestration applies.
        planningMode,
      });
      const applied = Number(result?.appliedStartMs);
      const at = Number.isFinite(applied)
        ? new Date(applied).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : null;
      setFeedback({ tone: 'ok', text: at ? `Scheduled "${item.title}" at ${at}` : `Scheduled "${item.title}"` });
    } catch (err) {
      setFeedback({ tone: 'error', text: normalizePlannerSchedulingError(err).message });
    } finally {
      setBusyId(null);
    }
  }, [dragItem, selectedSprintId, planningMode, startHour, endHour]);

  const entityAccent = (entity: Story | Task): string =>
    resolveThemeAppearance((entity as any).theme)?.color || 'var(--brand, #5f77dc)';

  const backlogCardStyle = (accent: string): React.CSSProperties => ({
    borderLeft: `3px solid ${accent}`,
    background: 'var(--card, #fff)',
    color: themeVars.text as string,
    borderRadius: '0 6px 6px 0',
    padding: '5px 7px',
    marginBottom: 4,
    fontSize: 11,
    boxShadow: '0 1px 2px rgba(0,0,0,0.07)',
    cursor: 'grab',
  });

  const todayStart = startOfDayMs(new Date());
  const nowOffset = offsetFor(Date.now(), todayStart);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg, #f8f9fa)' }}>
      {/* The week grid's own controls. The roadmap's goal filters are hidden at this detail
          level (they select goals, and nothing here is a goal), so this row is what remains. */}
      <div className="d-flex align-items-center gap-3 flex-wrap px-3 pt-2 pb-1" style={{ flexShrink: 0 }}>
        <label className="small d-flex align-items-center gap-1" style={{ marginBottom: 0, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={showAllocations}
            onChange={(e) => setShowAllocations(e.target.checked)}
          />
          {showAllocations ? <Eye size={14} /> : <EyeOff size={14} />}
          Theme allocations
        </label>
        <div className="btn-group btn-group-sm" role="group" aria-label="Backlog scope">
          {/* "This sprint", not "Sprint" — the detail-level group directly above has its own
              Sprint button, and two adjacent buttons with the same word mean two different
              things. */}
          {([['sprint', 'This sprint'], ['all', 'All unscheduled']] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="grv5-select"
              style={{
                cursor: 'pointer', padding: '0 10px',
                background: backlogScope === key ? 'var(--brand, #5f77dc)' : undefined,
                color: backlogScope === key ? '#fff' : undefined,
              }}
              onClick={() => setBacklogScope(key)}
              title={key === 'sprint'
                ? 'Backlog shows the selected sprint only'
                : 'Backlog shows every open story and task with nothing on the calendar this week'}
            >
              {label}
            </button>
          ))}
        </div>
        {feedback && (
          <span className={`small ${feedback.tone === 'ok' ? 'text-success' : 'text-danger'}`}>{feedback.text}</span>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', paddingBottom: 12 }}>
        <div style={{ display: 'flex', minWidth: 'max-content', alignItems: 'flex-start' }}>
          {/* Backlog — sticky so it never scrolls away from the day you are dragging onto. */}
          <div style={{
            width: BACKLOG_W + EDGE_PAD, flexShrink: 0, paddingLeft: EDGE_PAD, paddingRight: 8,
            position: 'sticky', left: 0, zIndex: 5, background: 'var(--bg, #f8f9fa)',
          }}>
            <div style={{
              position: 'sticky', top: 0, zIndex: 1, padding: '8px 4px 6px',
              background: 'var(--bg, #f8f9fa)', fontSize: 11, fontWeight: 700, color: themeVars.text as string,
            }}>
              Backlog <span style={{ color: themeVars.muted as string }}>
                ({backlogTotal > backlog.length ? `${backlog.length} of ${backlogTotal}` : backlogTotal})
              </span>
            </div>
            {backlog.length === 0 && (
              <div style={{ fontSize: 10, color: themeVars.muted as string, padding: '4px' }}>
                {backlogScope === 'sprint' && !selectedSprintId
                  ? 'No active sprint selected — switch to All unscheduled.'
                  : 'Everything open is scheduled this week.'}
              </div>
            )}
            {backlog.map(({ entity, type }) => (
              <div
                key={`${type}-${entity.id}`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', entity.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDragItem({ type, id: entity.id, title: entity.title || (type === 'story' ? 'Story' : 'Task'), entity });
                }}
                onDragEnd={() => { setDragItem(null); setDragOverDay(null); }}
                onClick={() => showSidebar(entity as any, type)}
                title={`${entity.title} — drag onto the grid to schedule, click for detail and activity`}
                style={{ ...backlogCardStyle(entityAccent(entity)), opacity: busyId === entity.id ? 0.5 : 1 }}
              >
                <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{entity.title}</div>
                <div style={{
                  color: themeVars.muted as string, fontSize: 9, marginTop: 2,
                  display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <span>{(entity as any).ref}</span>
                  {type === 'task' && <span style={{ textTransform: 'uppercase' }}>task</span>}
                  <CardSignals
                    entity={entity}
                    type={type}
                    isFocusGoal={focusGoalIds.has(String((entity as any).goalId || ''))}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Hour gutter — sticky beside the backlog so the times stay readable when the week
              is scrolled sideways. */}
          <div style={{
            width: GUTTER_W, flexShrink: 0, position: 'sticky', left: BACKLOG_W + EDGE_PAD, zIndex: 4,
            background: 'var(--bg, #f8f9fa)',
          }}>
            <div style={{ height: 34, position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg, #f8f9fa)' }} />
            <div style={{ position: 'relative', height: gridHeight }}>
              {/* Sits just BELOW its hour line rather than centred on it. Centring reads
                  slightly better mid-grid but pushes the first label half-way above the grid,
                  where the sticky day header — which owns a stacking context — clips it. */}
              {hours.map((h, i) => (
                <div key={h} style={{
                  position: 'absolute', top: i * PX_PER_HOUR + 2, right: 6, fontSize: 9,
                  color: themeVars.muted as string,
                }}>
                  {String(h).padStart(2, '0')}:00
                </div>
              ))}
            </div>
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const dayKey = startOfDayMs(day);
            const scheduled = packLanes(scheduledByDay.get(dayKey) || []);
            const bands = showAllocations
              ? packLanes(allocationsForDay(day)
                .map((row) => {
                  const s = parseClock(row.startTime);
                  const e = parseClock(row.endTime);
                  return s != null && e != null && e > s
                    ? { row, startMs: dayKey + s * MIN_MS, endMs: dayKey + e * MIN_MS }
                    : null;
                })
                .filter((x): x is { row: ThemeAllocationRow; startMs: number; endMs: number } => x != null))
              : [];
            const isToday = dayKey === todayStart;
            const isDropTarget = dragItem != null && dragOverDay === dayKey;
            return (
              <div key={dayKey} style={{ width: COL_W, flexShrink: 0 }}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 3, height: 34, padding: '8px 6px 6px',
                  background: isToday ? accentTint(themeVars.bg, 18) : 'var(--bg, #f8f9fa)',
                  borderLeft: '1px solid var(--line, #e5e7eb)',
                  fontSize: 11, fontWeight: 700, color: themeVars.text as string,
                }}>
                  {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                  {isToday && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--brand, #3b82f6)' }}>▶ today</span>}
                </div>

                <div
                  onDragOver={(e) => { if (dragItem) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDay(dayKey); } }}
                  onDragLeave={() => setDragOverDay((p) => (p === dayKey ? null : p))}
                  onDrop={(e) => {
                    e.preventDefault();
                    // Relative to the column body, so the drop time is the hour under the
                    // cursor. offsetY would be relative to whatever child was hit instead.
                    const rect = e.currentTarget.getBoundingClientRect();
                    handleDrop(day, e.clientY - rect.top);
                  }}
                  style={{
                    position: 'relative', height: gridHeight,
                    borderLeft: '1px solid var(--line, #e5e7eb)',
                    background: isDropTarget
                      ? accentTint(themeVars.card, 22)
                      : isToday ? accentTint(themeVars.card, 6) : 'var(--card, #fff)',
                  }}
                >
                  {/* Hour lines. The half-hour is a lighter rule so a 30-minute block reads as
                      half an hour without having to measure it. */}
                  {hours.map((h, i) => (
                    <React.Fragment key={h}>
                      <div style={{
                        position: 'absolute', left: 0, right: 0, top: i * PX_PER_HOUR,
                        borderTop: '1px solid var(--line, #e5e7eb)', pointerEvents: 'none',
                      }} />
                      <div style={{
                        position: 'absolute', left: 0, right: 0, top: i * PX_PER_HOUR + PX_PER_HOUR / 2,
                        borderTop: '1px dotted var(--line, #eef1f4)', opacity: 0.6, pointerEvents: 'none',
                      }} />
                    </React.Fragment>
                  ))}

                  {/* Theme allocations: a translucent underlay, behind the cards and below them
                      in the stack, so a soft "this was meant to be Family time" band never
                      competes with what is actually scheduled. Clicking one opens the weekly
                      capacity planner, which is where allocations are edited. */}
                  {bands.map(({ row, startMs, endMs, lane, laneCount }, i) => {
                    const appearance = resolveThemeAppearance(row.subTheme || row.theme);
                    const color = appearance?.color || '#94a3b8';
                    const top = offsetFor(startMs, dayKey);
                    const height = Math.max(MIN_CARD_PX, offsetFor(endMs, dayKey) - top);
                    return (
                      <div
                        key={`${dayKey}-band-${i}`}
                        onClick={() => navigate('/planner/weekly-capacity')}
                        title={`${row.subTheme || row.theme} · ${row.startTime}–${row.endTime} — click to edit theme allocations`}
                        style={{
                          position: 'absolute', top, height,
                          left: `${(lane / laneCount) * 100}%`, width: `${(1 / laneCount) * 100}%`,
                          background: `color-mix(in srgb, ${color} 18%, transparent)`,
                          borderLeft: `3px solid color-mix(in srgb, ${color} 55%, transparent)`,
                          borderRadius: '0 4px 4px 0',
                          padding: '1px 5px', overflow: 'hidden', cursor: 'pointer',
                          fontSize: 9, color: themeVars.muted as string,
                        }}
                      >
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {row.subTheme || row.theme}
                        </div>
                        {height > 30 && <div>{row.startTime}–{row.endTime}</div>}
                      </div>
                    );
                  })}

                  {isToday && nowOffset >= 0 && nowOffset <= gridHeight && (
                    <div style={{
                      position: 'absolute', left: 0, right: 0, top: nowOffset, zIndex: 2,
                      borderTop: '2px solid var(--bs-danger, #ef4444)', pointerEvents: 'none',
                    }} />
                  )}

                  {/* Scheduled work, spanning the hours it occupies. Clicking opens the global
                      sidebar — the app's detail-and-activity-stream surface for an entity — so
                      you can edit it or read its history without leaving the week. */}
                  {scheduled.map(({ block, entity, type, startMs, endMs, lane, laneCount }) => {
                    const top = offsetFor(startMs, dayKey);
                    const height = Math.max(MIN_CARD_PX, offsetFor(endMs, dayKey) - top);
                    const accent = entityAccent(entity);
                    return (
                      <div
                        key={block.id}
                        onClick={() => showSidebar(entity as any, type)}
                        title={`${entity.title} — click for detail and activity`}
                        style={{
                          position: 'absolute', top, height,
                          left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                          width: `calc(${(1 / laneCount) * 100}% - 4px)`,
                          zIndex: 1,
                          borderLeft: `3px solid ${accent}`,
                          background: 'var(--card, #fff)',
                          color: themeVars.text as string,
                          borderRadius: '0 6px 6px 0',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.14)',
                          padding: '2px 6px', overflow: 'hidden', cursor: 'pointer',
                          fontSize: 11, opacity: isDoneStatus((entity as any).status, type) ? 0.55 : 1,
                        }}
                      >
                        <div style={{ fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {entity.title}
                        </div>
                        {height > 34 && (
                          <div style={{
                            color: themeVars.muted as string, fontSize: 9,
                            display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap',
                          }}>
                            <span>{(entity as any).ref}</span>
                            <span>
                              {new Date(startMs).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            {/* Compact below ~3 lines of room: the icons still fit where the
                                AI score's extra characters would push the row to wrap. */}
                            <CardSignals
                              entity={entity}
                              type={type}
                              isFocusGoal={focusGoalIds.has(String((entity as any).goalId || ''))}
                              compact={height < 56}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default WeekPlanGrid;
