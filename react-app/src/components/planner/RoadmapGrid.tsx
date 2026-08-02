/**
 * RoadmapGrid — rows × time periods, drag a goal to reschedule it.
 *
 * Four detail levels, chosen by `?detailLevel=` and switchable from the toolbar: year and
 * quarter put themes on the rows, sprint puts goals on them, and week hands over to
 * WeekPlanGrid, which is an hour-by-hour time grid rather than a period grid at all.
 *
 * Extracted from VisualCanvas so the roadmap can be a real planner level
 * (/planner?level=roadmap) instead of a layout mode buried in a 1,500-line canvas component.
 * VisualCanvas renders this same component for ?layout=roadmap, so there is one implementation
 * and the two entry points cannot drift.
 *
 * It owns its own goals subscription and filters. That is the whole point of the extraction:
 * the grid previously depended on VisualCanvas's Firestore listeners, zoom, link-mode and
 * filter state, none of which a planner level has or wants.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Filter, Maximize2, Minimize2, Plus, Search } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { Goal } from '../../types';
import { GLOBAL_THEMES, LEGACY_THEME_MAP } from '../../constants/globalThemes';
import { goalThemeColor as resolveGoalThemeColor } from '../../utils/storyCardFormatting';
import {
  rescheduleGoalToPeriod,
  roadmapPeriodOrder,
  computePeriodKey,
  periodLabel,
  periodDateRange,
  ROADMAP_ROW_AXIS,
  UNSCHEDULED_COLUMN,
  computeQuarterKey,
  quarterLabel,
  type RoadmapGranularity,
} from '../../utils/roadmapSchedule';
import {
  buildPlannerPath, normalizePlannerLevel, parsePlannerSearch,
  DEFAULT_ROADMAP_DETAIL, ROADMAP_DETAIL_PARAM, type RoadmapDetail,
} from '../../utils/plannerRoutes';
import {
  columnWindow, computeColumnCapacity, formatCapacity, pointsToHours, weeklyHoursByTheme,
  type CapacitySlice, type CapacityTone, type ColumnCapacity, type ThemeAllocationRow,
} from '../../utils/roadmapCapacity';
import EditGoalModal from '../EditGoalModal';
import AddGoalModal from '../AddGoalModal';
import AddStoryModal from '../AddStoryModal';
import GoalRoadmapV6 from '../visualization/GoalRoadmapV6';
import WeekPlanGrid from './WeekPlanGrid';
import ThemeMultiSelect from '../shared/ThemeMultiSelect';
import ShareGoalsPanel from '../shared/ShareGoalsPanel';
import YearMultiSelect from '../shared/YearMultiSelect';
import { useSprint } from '../../contexts/SprintContext';
import { useSidebar } from '../../contexts/SidebarContext';
import {
  goalMatchesRoadmapFilters,
  hasActiveRoadmapFilters,
  EMPTY_ROADMAP_FILTERS,
  type RoadmapFilterState,
} from '../../utils/roadmapFilters';
import '../visualization/GoalRoadmapV5.css';
import { Z } from '../../utils/layoutTokens';
import { accentTint, themeVars } from '../../utils/themeVars';

const GOAL_KIND_ICON: Record<string, string> = {
  focus: '◆', umbrella: '◈', phase: '◉', leaf: '○',
};

const COL_W = 210;
const THEME_COL_W = 168;

/** Green while it fits, amber before it stops fitting, red once it does not. */
const CAPACITY_TONE_COLOR: Record<CapacityTone, string> = {
  empty: 'var(--muted, #9ca3af)',
  ok: 'var(--bs-success, #22c55e)',
  tight: 'var(--bs-warning, #f59e0b)',
  over: 'var(--bs-danger, #ef4444)',
};

/** Row key for goals whose `theme` matches nothing we know about. */
const UNTHEMED_ID = -1;
const UNTHEMED_NAME = 'Unthemed';

/**
 * Canonical theme id for the several shapes `theme` actually takes in the data: a number (7),
 * a numeric string ('3'), a canonical name ('Finance & Wealth'), a legacy name ('Growth',
 * 'Wealth'), free text ('Home and Garden'), or nothing at all.
 *
 * This existed nowhere, and the grid used a bare `Number(g.theme ?? 0)` for row placement. That
 * yields NaN for every name-shaped theme — 21 of the live goals — which matches no theme row,
 * so those goals were silently dropped from the grid entirely. They now land on their real
 * theme's row, or on an Unthemed row if the value resolves to nothing.
 *
 * Unrecognised text deliberately does NOT collapse into General: General has half an hour a
 * week allocated to it, so quietly filing strays there would report a permanent, loud capacity
 * breach that is really a data-quality problem.
 */
const themeIdOf = (value: unknown): number => {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (Number.isFinite(n)) return GLOBAL_THEMES.some((t) => t.id === n) ? n : 0;
  const direct = GLOBAL_THEMES.find((t) => t.name === raw || t.label === raw);
  if (direct) return direct.id;
  const legacy = (LEGACY_THEME_MAP as Record<string, number>)[raw];
  return legacy !== undefined ? legacy : UNTHEMED_ID;
};

/** The GLOBAL_THEMES name the allocation plan is keyed on. */
const themeNameOf = (value: unknown): string => {
  const id = themeIdOf(value);
  return id === UNTHEMED_ID
    ? UNTHEMED_NAME
    : GLOBAL_THEMES.find((t) => t.id === id)?.name || 'General';
};

/**
 * Committed-versus-available for one column or one theme cell.
 *
 * The bar is capped at 100% width but the tone is not — 130% still reads as a full red bar
 * with "130%" beside it, rather than silently overflowing the column.
 */
const CapacityBar: React.FC<{
  slice: CapacitySlice;
  /** Themes individually over their own allocation. Only meaningful on a column total. */
  themesOver?: string[];
  compact?: boolean;
}> = ({ slice, themesOver = [], compact = false }) => {
  const color = CAPACITY_TONE_COLOR[slice.tone];
  const width = Math.min(100, slice.utilizationPct);
  return (
    <div title={themesOver.length
      ? `Over capacity: ${themesOver.join(', ')}`
      : `${formatCapacity(slice)} · ${slice.utilizationPct}%`}>
      <div style={{
        height: compact ? 3 : 4, background: 'var(--line, #e5e7eb)',
        borderRadius: 2, overflow: 'hidden', marginBottom: 2,
      }}>
        <div style={{ height: '100%', width: `${width}%`, background: color, borderRadius: 2 }} />
      </div>
      <div style={{
        fontSize: compact ? 9 : 10, fontWeight: 400, display: 'flex',
        gap: 5, alignItems: 'baseline', flexWrap: 'wrap',
      }}>
        <span style={{ color: 'var(--muted, #6b7280)' }}>{formatCapacity(slice)}</span>
        <span style={{ color, fontWeight: 600 }}>{slice.utilizationPct}%</span>
        {themesOver.length > 0 && (
          <span style={{ color: CAPACITY_TONE_COLOR.over, fontWeight: 600 }}>
            ⚠ {themesOver.length} over
          </span>
        )}
      </div>
    </div>
  );
};

const RoadmapChip: React.FC<{
  goal: Goal;
  themeColor: string;
  onEdit: (goal: Goal) => void;
  onDragStartGoal: (goalId: string) => void;
  onDragEndGoal: () => void;
  /** Public share view: the chip is a label, not a control. */
  readOnly?: boolean;
}> = ({ goal, themeColor, onEdit, onDragStartGoal, onDragEndGoal, readOnly = false }) => {
  const g = goal as any;
  // plannedStartDate is set on zero goals in the live data — startDate is what's actually
  // populated (104 of 119 goals), so anchoring this on plannedStartDate meant the "Start Qx"
  // annotation never rendered for anyone.
  const plannedStartKey = computeQuarterKey(typeof g.startDate === 'number' ? g.startDate : null);
  const isDone = Number(g.status) === 4;
  const isActive = Number(g.status) === 1;

  return (
    <div
      draggable={!readOnly}
      onDragStart={readOnly ? undefined : (e) => {
        e.dataTransfer.setData('text/plain', goal.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartGoal(goal.id);
      }}
      onDragEnd={readOnly ? undefined : onDragEndGoal}
      onClick={readOnly ? undefined : () => onEdit(goal)}
      title={readOnly ? goal.title : `${goal.title} — click for detail, drag to reschedule`}
      style={{
        borderLeft: `3px solid ${themeColor}`,
        // Theme variables throughout: fixed light greys here left white blocks glowing in dark mode.
        background: isDone ? 'var(--panel, #f3f4f6)' : isActive ? 'var(--card, #fff)' : 'var(--panel, #fafafa)',
        color: 'var(--text, #1a1a1a)',
        borderRadius: '0 6px 6px 0',
        padding: '4px 7px',
        cursor: readOnly ? 'default' : 'grab',
        boxShadow: '0 1px 2px rgba(0,0,0,0.07)',
        fontSize: 11,
        opacity: isDone ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: themeColor, fontSize: 9, flexShrink: 0 }}>{GOAL_KIND_ICON[g.goalKind] ?? '○'}</span>
        <span style={{ fontWeight: 600, whiteSpace: 'normal', wordBreak: 'break-word' }}>{goal.title}</span>
      </div>
      <div style={{ color: 'var(--muted, #9ca3af)', fontSize: 9, marginTop: 1, display: 'flex', gap: 6 }}>
        {g.ref && <span>{g.ref}</span>}
        {plannedStartKey && <span>Start {quarterLabel(plannedStartKey)}</span>}
      </div>
    </div>
  );
};

/** ms epoch (any shape Firestore hands back) to a short "Mon 'YY" label, or null if unusable. */
function shortDate(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
}

/**
 * Sprint-level goal lane label: title, description, story progress, KPIs/savings, and the
 * planned window — the goal context you'd otherwise have to leave the roadmap to look up while
 * deciding what to schedule against it.
 */
const GoalLaneLabel: React.FC<{
  goal: Goal;
  color: string;
  stats?: { total: number; done: number };
  pots: Record<string, { name: string; balance: number }>;
}> = ({ goal, color, stats, pots }) => {
  const g = goal as any;
  const total = stats?.total ?? 0;
  const done = stats?.done ?? 0;
  const progressPercent = total > 0 ? Math.round((done / total) * 100) : 0;

  const kpis = Array.isArray(g.kpis) ? g.kpis : [];
  const kpiLabel = kpis.length > 0 ? `${kpis[0].name}: ${kpis[0].target}${kpis[0].unit ?? ''}` : null;

  const potId = g.monzoPotId || g.linkedPotId || g.potId;
  const potBalance = potId && pots[potId] ? pots[potId].balance : 0;
  const estimated = Number(g.estimatedCost || 0);
  const savingsPct = estimated > 0 && potId ? Math.min(100, Math.round(((potBalance / 100) / estimated) * 100)) : null;

  const startLabel = shortDate(g.startDate);
  const endLabel = shortDate(g.endDate || g.dueDate);
  const dateRange = startLabel && endLabel ? `${startLabel} → ${endLabel}` : startLabel || endLabel;

  const metaLine = [kpiLabel, savingsPct != null ? `Savings ${savingsPct}%` : null].filter(Boolean).join(' · ');

  return (
    <div>
      <div style={{
        overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
        WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
      }}>
        {goal.title || '(untitled)'}
      </div>
      {g.description && (
        <div style={{
          fontSize: 10, fontWeight: 400, color: 'var(--muted, #6b7280)', marginTop: 3,
          overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box',
          WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as any,
        }}>
          {g.description}
        </div>
      )}
      {total > 0 && (
        <>
          <div style={{ height: 4, background: 'var(--line, #e5e7eb)', borderRadius: 2, marginTop: 5, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPercent}%`, background: color, borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted, #9ca3af)', marginTop: 2 }}>
            {done}/{total} stories · {progressPercent}%
          </div>
        </>
      )}
      {metaLine && (
        <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted, #9ca3af)', marginTop: 1 }}>{metaLine}</div>
      )}
      {dateRange && (
        <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted, #9ca3af)', marginTop: 1 }}>{dateRange}</div>
      )}
    </div>
  );
};

interface RoadmapGridProps {
  /** Hide the built-in filter row when the host already provides one (VisualCanvas does). */
  showFilters?: boolean;
  /** Goals to render. Omit to let this component load and filter them itself. */
  goals?: Goal[];
  /** Which rendering to open on. `?level=gantt` routes here with 'gantt'. */
  initialView?: 'grid' | 'gantt';
  /** Time axis to open on, from `?detailLevel=`. Changing it here writes back to the URL. */
  detail?: RoadmapDetail;
  /**
   * No dragging, no click-through, no create or share controls.
   *
   * For the public share page, which renders this same component so a shared roadmap looks
   * exactly like the real one — rather than a third parallel implementation, which is what
   * PublicRoadmapView used to be.
   */
  readOnly?: boolean;
}

const RoadmapGrid: React.FC<RoadmapGridProps> = ({
  showFilters = true, goals: providedGoals, initialView = 'grid', detail: detailProp,
  readOnly = false,
}) => {
  const { currentUser } = useAuth();
  const [ownGoals, setOwnGoals] = useState<Goal[]>([]);
  const [filters, setFilters] = useState<RoadmapFilterState>(EMPTY_ROADMAP_FILTERS);
  const setFilter = <K extends keyof RoadmapFilterState>(key: K, value: RoadmapFilterState[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));
  const [stories, setStories] = useState<any[]>([]);
  const [focusGoalIds, setFocusGoalIds] = useState<Set<string>>(new Set());
  const [pots, setPots] = useState<Record<string, { name: string; balance: number }>>({});
  const [allocations, setAllocations] = useState<ThemeAllocationRow[]>([]);
  const [fullScreen, setFullScreen] = useState(false);
  const shellRef = React.useRef<HTMLDivElement>(null);
  /**
   * Real Fullscreen API, matching the Gantt. A `position: fixed` overlay is not full screen —
   * it still sits inside the browser chrome, and because it creates a stacking context it also
   * caps every dropdown inside it. Falls back to the overlay if the browser refuses.
   */
  const toggleFullScreen = useCallback(async () => {
    const el = shellRef.current;
    try {
      if (!document.fullscreenElement && el?.requestFullscreen) {
        await el.requestFullscreen();
        return;
      }
      if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    } catch { /* fall through to the overlay */ }
    setFullScreen((v) => !v);
  }, []);

  useEffect(() => {
    const onChange = () => setFullScreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  /**
   * Grid and Gantt are two renderings of the same question — when is each goal happening —
   * so they are one surface with a view switch rather than two planner levels. `?level=gantt`
   * now lands here with this preset (see UnifiedPlannerLevels), which also retires the third
   * duplicate: the old Gantt page's own "Roadmap" tab rendered VisualCanvas, a different
   * roadmap again from this one.
   *
   * GoalRoadmapV6 is self-contained — it owns its data, filters, zoom and time-axis controls.
   * So in Gantt mode this component's own filter row steps aside rather than stacking a second
   * toolbar on top of the Gantt's. Folding the two filter sets into one means giving V6 props
   * it does not currently take; that is the next step, not this one.
   */
  const [view, setView] = useState<'grid' | 'gantt'>(initialView);
  /**
   * Week is a detail level rather than another RoadmapGranularity: year/quarter/sprint are
   * period columns of goal chips, whereas week is a day-by-hour time grid of scheduled work —
   * a different component entirely (WeekPlanGrid). `granularity` below therefore maps week
   * onto sprint so none of the period maths has to know about it.
   *
   * The level is deep-linkable (`?level=roadmap&detailLevel=week`) and the buttons write back
   * to the URL, so the address bar always describes what is on screen and any view can be
   * shared. See ROADMAP_DETAIL_PARAM for why it is not simply `detail`.
   */
  const detail: RoadmapDetail = detailProp ?? DEFAULT_ROADMAP_DETAIL;
  const navigate = useNavigate();
  const location = useLocation();
  const setDetail = useCallback((next: RoadmapDetail) => {
    const params = parsePlannerSearch(location.search);
    const level = normalizePlannerLevel(params.get('level'));
    params.set(ROADMAP_DETAIL_PARAM, next);
    // Levels that merely alias the roadmap (`year`, `quarter`) would otherwise fight the
    // detail buttons — ?level=year&detailLevel=sprint reads as a contradiction. Normalise to
    // the one level that owns a detail axis.
    navigate(buildPlannerPath(level === 'gantt' ? 'gantt' : 'roadmap', params), { replace: true });
  }, [location.search, navigate]);
  const granularity: RoadmapGranularity = detail === 'week' ? 'sprint' : detail;

  /**
   * The window WeekPlanGrid plans over: a ROLLING seven days starting two days ago, so today
   * is always the third column with four days of runway to its right.
   *
   * Not the calendar week. Anchoring on Monday meant that by Sunday the entire view was
   * history — today sat in the last column with nothing ahead of it, which is precisely when
   * you most want to see the week coming. Planning looks forwards; the calendar week boundary
   * is an accident of the calendar, not of how the days are used.
   */
  const weekStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - 2);
    return d;
  }, []);
  const rowAxis = ROADMAP_ROW_AXIS[granularity];
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  /**
   * Create straight from the planning surface, matching the goal list view's own Add button.
   * WHICH entity depends on the detail level, because that is what the level is made of:
   * year and quarter are grids of goals, sprint and week are grids of stories. Offering "Add
   * goal" on the week grid would create something that cannot appear on it.
   */
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [showAddStory, setShowAddStory] = useState(false);
  const addsGoal = detail === 'year' || detail === 'quarter';
  const [drag, setDrag] = useState<{ kind: 'goal' | 'story'; id: string } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const { sprints, selectedSprintId } = useSprint();
  // Clicking a chip opens the Activity Stream rather than the edit modal: the stream is the
  // app's existing "detail for entity X" surface, already wired from ~20 other components, and
  // it keeps you on the roadmap instead of trapping you behind a dialog.
  const { showSidebar } = useSidebar();
  const selfLoading = providedGoals === undefined;

  useEffect(() => {
    if (!selfLoading || !currentUser?.uid) return;
    const unsub = onSnapshot(
      query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid)),
      (snap) => setOwnGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Goal))),
    );
    return () => unsub();
  }, [selfLoading, currentUser]);

  // Stories and focus goals back "Goals with stories", "Focus goals only" and the sprint scope.
  useEffect(() => {
    if (!selfLoading || !currentUser?.uid) return;
    const unsubs = [
      onSnapshot(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)),
        (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(query(collection(db, 'focusGoals'), where('ownerUid', '==', currentUser.uid)),
        (snap) => {
          const ids = new Set<string>();
          snap.docs.forEach((d) => (d.data()?.goalIds || []).forEach((gid: string) => ids.add(gid)));
          setFocusGoalIds(ids);
        }),
      // The recurring weekly time plan — what makes column capacity knowable rather than
      // estimated. See roadmapCapacity for how it turns into hours per column.
      onSnapshot(doc(db, 'theme_allocations', currentUser.uid),
        (snap) => setAllocations(Array.isArray(snap.data()?.allocations) ? snap.data()!.allocations : []),
        () => setAllocations([])),
      // Backs the savings-progress line in the sprint-level goal lane — same source
      // GlobalGoalFocusBanner reads for goal.estimatedCost vs pot balance.
      onSnapshot(query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid)),
        (snap) => {
          const map: Record<string, { name: string; balance: number }> = {};
          snap.docs.forEach((d) => {
            const data = d.data() as any;
            if (data.potId) map[data.potId] = { name: data.name || '', balance: data.balance || 0 };
          });
          setPots(map);
        }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [selfLoading, currentUser]);

  const sourceGoals = providedGoals ?? ownGoals;

  /**
   * Per-goal story completion, for the sprint-level lane label. Same STORY status scale as
   * GlobalGoalFocusBanner (status >= 4 is done) — see the comment there for why this used to
   * read the task/goal scale and reported 0% on goals that were actually finished.
   */
  const goalStoryStats = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const st of stories) {
      const gid = st.goalId;
      if (!gid) continue;
      const status = Number(st.status ?? 0);
      const cur = map.get(gid) ?? { total: 0, done: 0 };
      cur.total++;
      if (status >= 4) cur.done++;
      map.set(gid, cur);
    }
    return map;
  }, [stories]);

  /** Story counts and sprint membership per goal — the inputs the filters need. */
  const filterContext = useMemo(() => {
    const storyCountByGoal: Record<string, number> = {};
    const sprintIdsByGoal: Record<string, Set<string>> = {};
    for (const st of stories) {
      const gid = st.goalId;
      if (!gid) continue;
      storyCountByGoal[gid] = (storyCountByGoal[gid] || 0) + 1;
      if (st.sprintId) {
        if (!sprintIdsByGoal[gid]) sprintIdsByGoal[gid] = new Set();
        sprintIdsByGoal[gid].add(st.sprintId);
      }
    }
    return {
      storyCountByGoal,
      sprintIdsByGoal,
      focusGoalIds,
      selectedSprint: sprints.find((sp) => sp.id === selectedSprintId) || null,
      allGoals: sourceGoals,
    };
  }, [stories, focusGoalIds, sprints, selectedSprintId, sourceGoals]);

  const goals = useMemo(() => {
    if (!selfLoading) return sourceGoals;   // host has already filtered
    return sourceGoals.filter((g) => goalMatchesRoadmapFilters(g, filters, filterContext));
  }, [sourceGoals, selfLoading, filters, filterContext]);

  /**
   * Years present in the data, for the multi-select — mirrors the Gantt's Years filter.
   * Falls back to startDate for the same reason the grid placement below does: a goal with
   * only a start date still has a year worth filtering on.
   */
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    for (const g of sourceGoals) {
      const key = computeQuarterKey((g as any).endDate || (g as any).dueDate || (g as any).startDate);
      if (key) ys.add(Number(key.split('-')[0]));
    }
    return [...ys].sort();
  }, [sourceGoals]);

  const currentPeriodKey = useMemo(
    () => computePeriodKey(Date.now(), granularity, sprints as any), [granularity, sprints]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    if (currentPeriodKey) keys.add(currentPeriodKey);
    for (const g of goals) {
      const k1 = computePeriodKey((g as any).endDate || (g as any).dueDate, granularity, sprints as any);
      const k2 = computePeriodKey((g as any).startDate, granularity, sprints as any);
      if (k1) keys.add(k1);
      if (k2) keys.add(k2);
    }
    return roadmapPeriodOrder([...keys], currentPeriodKey, granularity, sprints as any);
  }, [goals, currentPeriodKey, granularity, sprints]);

  /**
   * Rows are themes at quarter granularity and individual goals at sprint granularity. Across a
   * quarter you are balancing themes; across a month you are asking which goals land when, and
   * a theme row there just stacks unrelated goals on top of each other.
   */
  const rows = useMemo(() => {
    if (rowAxis === 'theme') {
      const known = GLOBAL_THEMES
        .filter((t) => goals.some((g) => themeIdOf((g as any).theme) === t.id))
        .map((t) => ({ key: `theme-${t.id}`, label: t.name, color: t.color, themeId: t.id, goalId: null as string | null }));
      // A row for the strays, so a goal with an unrecognised theme is visible and fixable
      // rather than absent.
      return goals.some((g) => themeIdOf((g as any).theme) === UNTHEMED_ID)
        ? [...known, {
            key: `theme-${UNTHEMED_ID}`, label: UNTHEMED_NAME,
            color: 'var(--muted, #9ca3af)', themeId: UNTHEMED_ID, goalId: null as string | null,
          }]
        : known;
    }
    return goals
      .slice()
      .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
      .map((g) => ({
        key: `goal-${g.id}`,
        label: g.title || '(untitled)',
        color: resolveGoalThemeColor(g, GLOBAL_THEMES) || 'var(--brand, #6366f1)',
        themeId: themeIdOf((g as any).theme),
        goalId: g.id,
      }));
  }, [goals, rowAxis]);

  const goalsById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);
  /** 240px at sprint granularity so the goal lane's progress/KPI/date detail has room; the
   * plain theme label at quarter granularity doesn't need it. */
  const labelColW = rowAxis === 'goal' ? 240 : THEME_COL_W;

  const grid = useMemo(() => {
    const m = new Map<string, Map<string, Goal[]>>();
    for (const g of goals) {
      // themeIdOf, not Number(): see its comment — the bare cast dropped every name-themed goal.
      const rowKey = rowAxis === 'theme' ? `theme-${themeIdOf((g as any).theme)}` : `goal-${g.id}`;
      // Falls back to startDate before giving up to Backlog: a goal with a start date but no
      // end/due date does have a planned quarter, even though nothing had been anchoring its
      // placement to it before.
      const cell = computePeriodKey(
        (g as any).endDate || (g as any).dueDate || (g as any).startDate, granularity, sprints as any,
      ) ?? UNSCHEDULED_COLUMN;
      if (!m.has(rowKey)) m.set(rowKey, new Map());
      const row = m.get(rowKey)!;
      if (!row.has(cell)) row.set(cell, []);
      row.get(cell)!.push(g);
    }
    return m;
  }, [goals, rowAxis, granularity, sprints]);

  /**
   * Stories per (goal, sprint) — only meaningful at sprint granularity, where rows are goals.
   *
   * Keyed off the story's OWN sprintId rather than its dates: a story's sprint is an explicit
   * assignment, and inferring it from dates would disagree with the Kanban and the sprint
   * planner, which both read the field.
   */
  const storiesByGoalSprint = useMemo(() => {
    const m = new Map<string, any[]>();
    if (granularity !== 'sprint') return m;
    for (const st of stories) {
      if (!st.goalId) continue;
      // No sprintId — including one just cleared by a drag to this column — lands in
      // UNSCHEDULED_COLUMN rather than being dropped. It used to be skipped outright, which
      // made a story vanish the moment you dragged it out of a sprint: writing sprintId=null
      // took it out of every bucket with nothing to put it back into.
      const key = `goal-${st.goalId}:${st.sprintId || UNSCHEDULED_COLUMN}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(st);
    }
    return m;
  }, [stories, granularity]);

  /**
   * Committed hours and available hours per column, keyed by theme.
   *
   * "Committed" means something different at each detail level, which is why it is assembled
   * here rather than in roadmapCapacity: at year and quarter the cells hold GOALS, so it is the
   * goal's stories rolled up (a goal with no stories yet genuinely contributes nothing — see
   * `goalsWithoutStories` below, which is surfaced so the number is not mistaken for a
   * verdict); at sprint the cells hold the stories themselves.
   *
   * The DRAGGED item is counted against the column it is currently over rather than the one it
   * came from, so the bars answer "would this fit?" before the drop, not after.
   */
  const weeklyHours = useMemo(() => weeklyHoursByTheme(allocations), [allocations]);
  const hasAllocationPlan = weeklyHours.size > 0;

  /** The column under the cursor mid-drag. Cell ids are `${rowKey}:${columnKey}`. */
  const dragOverColumn = useMemo(
    () => (dragOverCell ? dragOverCell.slice(dragOverCell.indexOf(':') + 1) : null),
    [dragOverCell],
  );

  const storyHoursByGoal = useMemo(() => {
    const m = new Map<string, number>();
    for (const st of stories) {
      if (!st.goalId) continue;
      m.set(st.goalId, (m.get(st.goalId) ?? 0) + pointsToHours(st.points));
    }
    return m;
  }, [stories]);

  const { capacityByColumn, goalsWithoutStories, unthemedHours } = useMemo(() => {
    const committed = new Map<string, Map<string, number>>();
    /**
     * Work whose theme resolves to nothing known is held OUT of the capacity maths and
     * reported separately. Counted, it would show as a permanent breach of a theme that does
     * not exist; ignored, it would quietly vanish from the totals. Neither is honest.
     */
    const unthemed = new Map<string, number>();
    const addHours = (col: string, theme: string, hours: number) => {
      if (hours <= 0) return;
      if (theme === UNTHEMED_NAME) {
        unthemed.set(col, (unthemed.get(col) ?? 0) + hours);
        return;
      }
      if (!committed.has(col)) committed.set(col, new Map());
      const row = committed.get(col)!;
      row.set(theme, (row.get(theme) ?? 0) + hours);
    };
    /** Where an entity counts right now — its drop target while dragging, else where it is. */
    const placement = (id: string, actual: string) =>
      (drag?.id === id && dragOverColumn ? dragOverColumn : actual);

    const undecomposed = new Map<string, number>();

    if (rowAxis === 'theme') {
      for (const g of goals) {
        const actual = computePeriodKey(
          (g as any).endDate || (g as any).dueDate || (g as any).startDate, granularity, sprints as any,
        ) ?? UNSCHEDULED_COLUMN;
        const col = placement(g.id, actual);
        const hours = storyHoursByGoal.get(g.id) ?? 0;
        if (hours <= 0) undecomposed.set(col, (undecomposed.get(col) ?? 0) + 1);
        addHours(col, themeNameOf((g as any).theme), hours);
      }
    } else {
      for (const st of stories) {
        const goal = st.goalId ? goalsById.get(st.goalId) : null;
        // Rows are the visible goals, so a story hanging off a filtered-out goal is not in
        // this grid and must not be counted against its columns either.
        if (!goal) continue;
        const col = placement(st.id, st.sprintId || UNSCHEDULED_COLUMN);
        addHours(col, themeNameOf(st.theme ?? (goal as any).theme), pointsToHours(st.points));
      }
    }

    const byColumn = new Map<string, ColumnCapacity>();
    for (const col of columns) {
      byColumn.set(col, computeColumnCapacity(
        columnWindow(col, granularity, sprints as any),
        weeklyHours,
        committed.get(col) ?? new Map(),
      ));
    }
    return { capacityByColumn: byColumn, goalsWithoutStories: undecomposed, unthemedHours: unthemed };
  }, [goals, stories, goalsById, storyHoursByGoal, columns, granularity, sprints, rowAxis,
      weeklyHours, drag, dragOverColumn]);

  /**
   * A drop writes BOTH goal dates. Only endDate used to be written, which left startDate stale
   * and made the overnight story realignment behave differently here than on the Gantt.
   */
  const reschedule = useCallback(async (goalId: string, qKey: string) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    try {
      if (qKey === UNSCHEDULED_COLUMN) {
        await updateDoc(doc(db, 'goals', goalId), { endDate: null, dueDate: null, updatedAt: serverTimestamp() } as any);
        return;
      }
      const next = rescheduleGoalToPeriod(qKey, granularity, (goal as any).startDate, (goal as any).endDate ?? (goal as any).dueDate, sprints as any);
      if (!next) return;
      await updateDoc(doc(db, 'goals', goalId), {
        startDate: next.startDate, endDate: next.endDate, updatedAt: serverTimestamp(),
      } as any);
    } catch (err) {
      console.error('Failed to reschedule goal', goalId, err);
    }
    // granularity and sprints MUST be dependencies: without them a drop captured the
    // granularity in force when the callback was first created, so switching to sprint
    // columns and dragging wrote quarter dates.
  }, [goals, granularity, sprints]);

  /**
   * A story's sprint is the same explicit `sprintId` field the Kanban and sprint planner read
   * (see storiesByGoalSprint above) — dragging a story card here writes that field directly
   * rather than touching dates, so all three surfaces keep agreeing on which sprint it's in.
   */
  const rescheduleStory = useCallback(async (storyId: string, qKey: string) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        sprintId: qKey === UNSCHEDULED_COLUMN ? null : qKey,
        updatedAt: serverTimestamp(),
      } as any);
    } catch (err) {
      console.error('Failed to reschedule story', storyId, err);
    }
  }, []);

  return (
    <div ref={shellRef} style={fullScreen
      ? { position: 'fixed', inset: 0, zIndex: Z.panel, background: 'var(--bg, #f8f9fa)',
          display: 'flex', flexDirection: 'column' }
      : { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {/* One control row: which rendering (Grid/Gantt) and which time axis (Year…Week) are the
          same decision — "what am I looking at" — and used to sit on two separate rows with the
          detail buttons stranded at the end of the filter toolbar. Filters stay on their own row
          below, because they answer a different question. */}
      {showFilters && (
        <div className="d-flex align-items-center gap-2 flex-wrap px-3 pt-2" style={{ flexShrink: 0 }}>
          <div className="btn-group btn-group-sm" role="group" aria-label="Roadmap view">
            {([['grid', 'Grid'], ['gantt', 'Gantt']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                className="grv5-select"
                style={{
                  cursor: 'pointer', padding: '0 12px',
                  background: view === key ? 'var(--brand, #5f77dc)' : undefined,
                  color: view === key ? '#fff' : undefined,
                }}
                onClick={() => setView(key)}
                title={key === 'grid'
                  ? 'Grid — themes or goals against periods, drag to reschedule'
                  : 'Gantt — continuous timeline with bars and dependencies'}
              >
                {label}
              </button>
            ))}
          </div>
          {/* Detail also flips the row axis — themes across a year or quarter (the balance
              question), goals across a sprint (the what-is-in-flight question), and the week
              is a time grid entirely. Grid-only: the Gantt has a continuous time axis with its
              own Quarter/Month/Week/Fit-all controls. */}
          {view === 'grid' && (
            <div className="btn-group btn-group-sm" role="group" aria-label="Detail level">
              {(['year', 'quarter', 'sprint', 'week'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  className="grv5-select"
                  style={{
                    cursor: 'pointer', padding: '0 10px', textTransform: 'capitalize',
                    background: detail === g ? 'var(--brand, #5f77dc)' : undefined,
                    color: detail === g ? '#fff' : undefined,
                  }}
                  onClick={() => setDetail(g)}
                  title={g === 'year'
                    ? 'Years, one row per theme'
                    : g === 'quarter'
                      ? 'Quarters, one row per theme'
                      : g === 'sprint'
                        ? 'Sprints, one row per goal'
                        : 'This week by the hour — drag from the backlog to schedule'}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
          {view === 'grid' && !readOnly && (
            <button
              type="button"
              className="grv5-select"
              style={{
                cursor: 'pointer', padding: '0 10px', whiteSpace: 'nowrap',
                background: 'var(--brand, #5f77dc)', color: '#fff',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
              onClick={() => (addsGoal ? setShowAddGoal(true) : setShowAddStory(true))}
              title={addsGoal
                ? 'Create a goal — it lands on this grid straight away'
                : 'Create a story — it lands in the backlog, ready to schedule'}
            >
              <Plus size={14} />
              {addsGoal ? 'Add goal' : 'Add story'}
            </button>
          )}
          {/* Public sharing. Only offered on the goal-shaped levels: the public view renders
              goals, so sharing from the week grid would produce a link showing something the
              user was not looking at. */}
          {view === 'grid' && addsGoal && !readOnly && currentUser?.uid && (
            <ShareGoalsPanel uid={currentUser.uid} />
          )}
          {view === 'grid' && detail !== 'week' && (
            <span className="text-muted small text-nowrap">{goals.length} goals</span>
          )}
          <button
            type="button" className="grv5-select" style={{ cursor: 'pointer', padding: '0 10px' }}
            onClick={toggleFullScreen}
            title={fullScreen ? 'Exit full screen' : 'Full screen'}
          >
            {fullScreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          {view === 'gantt' && (
            <span className="text-muted small">Zoom, Arrange and the time axis are in the Gantt&apos;s own toolbar.</span>
          )}
        </div>
      )}
      {/* Hidden at week detail: every one of these filters selects GOALS, and the week grid
          shows scheduled work and a backlog, not goals — leaving them on offered controls that
          do nothing. The week grid carries its own controls instead. */}
      {showFilters && !(view === 'grid' && detail === 'week') && (
        <div className="d-flex flex-column gap-2 px-3 pt-2" style={{ flexShrink: 0 }}>          {/* Same filter set as the Gantt — search, theme, years — so switching between the two
              views does not mean relearning the controls. */}
          {/* Deliberately the Gantt's own markup and classes (grv5-filters / grv5-search /
              grv5-select) rather than Bootstrap equivalents, so the two views are visually
              identical and share one stylesheet. GoalRoadmapV5.css is imported for them. */}
          {/* Same filter set as the Gantt (GoalRoadmapV6): search, theme, years, goals with
              stories, focus goals, sprint scope. The Gantt's zoom / Quarter / Month / Week
              controls are deliberately absent — they change a timeline's granularity, and this
              grid's columns are quarters by definition. */}
          {/* overflowX:auto with no matching overflowY forces the UA to resolve overflowY to
              auto too (CSS Overflow §3) — with the row sized exactly to its 32px controls,
              that auto-clipped every button's border and focus ring by a pixel or two. The
              vertical padding gives it slack to clip nothing while still scrolling sideways. */}
          <div className="grv5-toolbar" style={{ flexWrap: 'nowrap', overflowX: 'auto', overflowY: 'hidden', padding: '4px 2px' }}>
            <div className="grv5-filters">
              <div className="grv5-search">
                <Search size={16} />
                <input
                  placeholder="Search goals..."
                  value={filters.search}
                  onChange={(e) => setFilter('search', e.target.value)}
                />
              </div>
              <ThemeMultiSelect
                selectedIds={filters.themeIds}
                onChange={(ids) => setFilter('themeIds', ids)}
                size="sm"
                style={{ minWidth: 150 }}
              />
              <YearMultiSelect
                availableYears={availableYears}
                selectedYears={filters.years}
                onChange={(years) => setFilter('years', years)}
                allYears={filters.years.length === 0}
                onAllYearsChange={(all) => setFilter('years', all ? [] : availableYears)}
              />
              <label className="small text-nowrap d-flex align-items-center gap-1" style={{ marginBottom: 0 }}>
                <input type="checkbox" checked={filters.withStoriesOnly}
                  onChange={(e) => setFilter('withStoriesOnly', e.target.checked)} />
                Goals with stories
              </label>
              <label className="small text-nowrap d-flex align-items-center gap-1" style={{ marginBottom: 0 }}>
                <input type="checkbox" checked={filters.limitToSprint}
                  onChange={(e) => setFilter('limitToSprint', e.target.checked)} />
                Limit to selected sprint
              </label>
              <label className="small text-nowrap d-flex align-items-center gap-1" style={{ marginBottom: 0 }}>
                <input type="checkbox" checked={filters.focusOnly}
                  onChange={(e) => setFilter('focusOnly', e.target.checked)} />
                Focus goals only
              </label>
            </div>
            {hasActiveRoadmapFilters(filters) && (
              <button type="button" className="grv5-select" style={{ cursor: 'pointer', padding: '0 10px' }}
                onClick={() => setFilters(EMPTY_ROADMAP_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {detail === 'week' && view === 'grid' ? (
        <WeekPlanGrid weekStart={weekStart} />
      ) : view === 'gantt' ? (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <GoalRoadmapV6 externalFilters={filters} />
        </div>
      ) : (
      <>
      {/* No top padding here — it moves onto the header cells below. Padding on the SCROLL
          CONTAINER, not the sticky header, leaves a strip at the container's inner top edge
          that a sticky child can never cover (sticky only sticks as far as the padding edge),
          so whatever row had scrolled to that band stayed uncovered and read as content
          poking through above the header. */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg, #f8f9fa)', padding: '0 16px 12px' }}>
        {goals.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted, #6b7280)' }}>
            <Filter size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <div className="fw-medium">No goals match current filters</div>
          </div>
        ) : (
          <div style={{ minWidth: 'max-content' }}>
            {/* Sticky on both axes: the quarter header stays visible while scrolling down,
                and the theme column while scrolling right. Without this you lose track of which
                quarter a column is as soon as the grid is taller or wider than the viewport.
                The 12px top padding lives on each cell (so its own opaque background paints
                it) rather than on the row or the scroll container — see the comment above. */}
            <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 3 }}>
              <div style={{
                width: labelColW, flexShrink: 0, paddingTop: 12, position: 'sticky', left: 0, zIndex: 4,
                background: 'var(--bg, #f8f9fa)',
              }} />
              {columns.map((qKey) => {
                const cap = capacityByColumn.get(qKey);
                const undecomposed = goalsWithoutStories.get(qKey) ?? 0;
                return (
                <div key={qKey} style={{
                  width: COL_W, flexShrink: 0, padding: '17px 10px 6px',
                  fontSize: 11, fontWeight: 700, color: 'var(--text, #374151)',
                  borderLeft: '1px solid var(--line, #e5e7eb)',
                  background: qKey === currentPeriodKey ? accentTint(themeVars.panel, 20) : 'var(--panel, #f1f5f9)',
                  position: 'sticky', top: 0,
                }}>
                  {periodLabel(qKey, granularity, sprints as any)}
                  {qKey === currentPeriodKey && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--brand, #3b82f6)' }}>▶ now</span>}
                  {/* Sprint columns carry their window under the name: the name says what the
                      sprint is for, the dates say when it is, and dropping work into a column
                      is a scheduling decision you cannot make without both. */}
                  {(() => {
                    const range = periodDateRange(qKey, granularity, sprints as any);
                    return range ? (
                      <div style={{
                        fontSize: 9, fontWeight: 400, color: 'var(--muted, #6b7280)',
                        textAlign: 'center', marginTop: 1,
                      }}>
                        {range}
                      </div>
                    ) : null;
                  })()}
                  {/* Capacity only means something against a weekly plan. With no
                      theme_allocations doc there is nothing to be over, so nothing is drawn. */}
                  {hasAllocationPlan && cap && (
                    qKey === UNSCHEDULED_COLUMN ? (
                      // The Backlog has no window and therefore no capacity — but how much work
                      // is parked in it is exactly the number you want beside the columns that do.
                      cap.committedHours > 0 && (
                        <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted, #6b7280)', marginTop: 4 }}>
                          {Math.round(cap.committedHours)}h unscheduled
                        </div>
                      )
                    ) : (
                      <div style={{ marginTop: 5 }}>
                        <CapacityBar slice={cap} themesOver={cap.themesOver} />
                        {/* Named, not hidden: at year and quarter the cells hold goals, and a
                            goal with no stories written yet contributes zero hours. Without
                            this the emptiest plans would look like the healthiest. */}
                        {rowAxis === 'theme' && undecomposed > 0 && (
                          <div style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted, #9ca3af)' }}>
                            {undecomposed} goal{undecomposed === 1 ? '' : 's'} not broken down
                          </div>
                        )}
                        {(unthemedHours.get(qKey) ?? 0) > 0 && (
                          <div
                            style={{ fontSize: 9, fontWeight: 400, color: 'var(--muted, #9ca3af)' }}
                            title="These carry a theme the app does not recognise, so they cannot be matched to an allocation. Excluded from the figures above."
                          >
                            +{Math.round(unthemedHours.get(qKey)!)}h unthemed
                          </div>
                        )}
                      </div>
                    )
                  )}
                </div>
                );
              })}
            </div>

            {rows.map((theme) => {
              const themeGoals = grid.get(theme.key);
              return (
                <div key={theme.key} style={{ display: 'flex', marginBottom: 1 }}>
                  <div
                    onClick={theme.goalId ? () => {
                      const g = goalsById.get(theme.goalId!);
                      if (g) showSidebar(g, 'goal');
                    } : undefined}
                    title={theme.goalId ? `${theme.label} — click for detail` : undefined}
                    style={{
                      width: labelColW, flexShrink: 0, padding: '8px 10px',
                      borderTop: `3px solid ${theme.color}`,
                      // Opaque, not the usual 18% tint: a sticky column has cells sliding beneath
                      // it, and a translucent background shows them through.
                      background: `color-mix(in srgb, ${theme.color} 12%, var(--card, #fff))`,
                      fontSize: 11, fontWeight: 700, color: theme.color,
                      position: 'sticky', left: 0, zIndex: 2,
                      cursor: theme.goalId ? 'pointer' : undefined,
                    }}>
                    {theme.goalId && goalsById.get(theme.goalId) ? (
                      <GoalLaneLabel
                        goal={goalsById.get(theme.goalId)!}
                        color={theme.color}
                        stats={goalStoryStats.get(theme.goalId)}
                        pots={pots}
                      />
                    ) : theme.label}
                  </div>
                  {columns.map((qKey) => {
                    const cellGoals = themeGoals?.get(qKey) || [];
                    const cellId = `${theme.key}:${qKey}`;
                    const isDropTarget = drag != null && dragOverCell === cellId;
                    return (
                      <div
                        key={qKey}
                        onDragOver={(e) => { if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCell(cellId); } }}
                        onDragLeave={() => setDragOverCell((p) => (p === cellId ? null : p))}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData('text/plain') || drag?.id;
                          const kind = drag?.kind ?? 'goal';
                          setDragOverCell(null);
                          if (!id) return;
                          if (kind === 'story') rescheduleStory(id, qKey);
                          else reschedule(id, qKey);
                        }}
                        style={{
                          width: COL_W, flexShrink: 0, padding: '6px 8px', minHeight: 72,
                          borderLeft: '1px solid var(--line, #e5e7eb)', borderTop: '1px solid var(--line, #e5e7eb)',
                          background: isDropTarget ? accentTint(themeVars.card, 22) : 'var(--card, #fff)',
                          boxShadow: isDropTarget ? `inset 0 0 0 2px ${theme.color}` : undefined,
                          display: 'flex', flexDirection: 'column', gap: 4,
                        }}
                      >
                        {/* Per-theme capacity, which only exists where a row IS a theme. At
                            sprint level a row is a goal, and several goals share a theme, so a
                            per-cell figure there would count the same allocation repeatedly —
                            the column header carries the number instead. */}
                        {hasAllocationPlan && rowAxis === 'theme' && qKey !== UNSCHEDULED_COLUMN && (() => {
                          const slice = capacityByColumn.get(qKey)?.byTheme.get(themeNameOf(theme.themeId));
                          return slice ? <CapacityBar slice={slice} compact /> : null;
                        })()}
                        {granularity === 'sprint' && rowAxis === 'goal'
                          && (storiesByGoalSprint.get(`${theme.key}:${qKey}`) || []).map((st: any) => (
                          <div
                            key={st.id}
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData('text/plain', st.id);
                              e.dataTransfer.effectAllowed = 'move';
                              setDrag({ kind: 'story', id: st.id });
                            }}
                            onDragEnd={() => { setDrag(null); setDragOverCell(null); }}
                            onClick={() => showSidebar(st, 'story')}
                            title={`${st.title} — click for detail, drag to move sprint`}
                            style={{
                              borderLeft: `2px solid ${theme.color}`, background: 'var(--panel, #fafafa)',
                              color: 'var(--text, #1a1a1a)', borderRadius: '0 4px 4px 0',
                              padding: '2px 6px', fontSize: 10, cursor: 'grab',
                              opacity: Number(st.status) >= 4 ? 0.5 : 1,
                            }}
                          >
                            <span style={{ color: 'var(--muted, #9ca3af)', marginRight: 4 }}>{st.ref}</span>
                            {st.title}
                          </div>
                        ))}
                        {/* Goal-level view only. At sprint granularity the row IS this goal
                            already (see ROADMAP_ROW_AXIS), so re-showing it as a chip inside
                            its own row is pure clutter — the cell's job there is story cards. */}
                        {granularity !== 'sprint' && cellGoals.map((g) => (
                          <RoadmapChip
                            key={g.id} goal={g}
                            themeColor={resolveGoalThemeColor(g, GLOBAL_THEMES) || theme.color}
                            readOnly={readOnly}
                            onEdit={(g) => { if (!readOnly) showSidebar(g, 'goal'); }}
                            onDragStartGoal={(id) => setDrag({ kind: 'goal', id })}
                            onDragEndGoal={() => { setDrag(null); setDragOverCell(null); }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
      </>
      )}

      {/* The same two modals the goal list and card views use, so a goal or story created here
          is identical to one created anywhere else — no second creation path to drift. */}
      <AddGoalModal show={showAddGoal} onClose={() => setShowAddGoal(false)} />
      <AddStoryModal show={showAddStory} onClose={() => setShowAddStory(false)} />

      {editingGoal && (
        <EditGoalModal
          goal={editingGoal}
          show={!!editingGoal}
          onClose={() => setEditingGoal(null)}
          currentUserId={currentUser?.uid || ''}
          allGoals={sourceGoals}
        />
      )}
    </div>
  );
};

export default RoadmapGrid;
