import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from 'lucide-react';
import useMeasure from 'react-use-measure';
import { Goal, Sprint, Story } from '../../types';
import { useRoadmapStore, ZoomLevel } from '../../stores/roadmapStore';
import RoadmapAxis from './RoadmapAxis';
import './RoadmapV2.css';
import GLOBAL_THEMES, { getThemeById, migrateThemeValue } from '../../constants/globalThemes';
import logger from '../../utils/logger';
import { useDroppable } from '@dnd-kit/core';
import { RoadmapGoalCard } from './RoadmapGoalCard';
import { scaleTime } from '@visx/scale';
import { shallow } from 'zustand/shallow';

export type GanttItem = {
  id: string;
  title: string;
  theme: number;
  startDate: Date;
  endDate: Date;
  status: number;
  priority?: number;
  startLabel?: string;
  endLabel?: string;
};

export type GoalNoteSummary = {
  text: string;
  timestamp?: number;
  author?: string;
};

type Props = {
  goals: Goal[];
  sprints: Sprint[];
  stories: Story[];
  storiesByGoal: Record<string, number>;
  doneStoriesByGoal: Record<string, number>;
  latestGoalNotes?: Record<string, GoalNoteSummary>;
  onItemClick: (item: GanttItem) => void;
  updateGoalDates: (goalId: string, start: Date, end: Date) => void;
  handleGenerateStories: (item: GanttItem) => void;
  setSelectedGoalId: (id: string | null) => void;
  setActivityGoalId: (id: string | null) => void;
  setNoteGoalId: (id: string | null) => void;
  setNoteDraft: (v: string) => void;
  setEditGoal: (goal: Goal | null) => void;
  onDeleteGoal: (goalId: string) => void;
  openGlobalActivity: (goal: Goal) => void;
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onMouseDown: React.MouseEventHandler<HTMLDivElement>;
  onTouchStart: React.TouchEventHandler<HTMLDivElement>;
  onTouchMove: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd: React.TouchEventHandler<HTMLDivElement>;
  onSwitchToRoadmap?: () => void;
  selectedSprintId?: string;
};

// Lanes come from Global Theme Settings (dynamic, no hard-coding)
const LANE_THEMES = GLOBAL_THEMES.map(t => ({ id: t.id, name: t.name || t.label, color: t.color }));
const ROW_HEIGHT = 72;
const CARD_HEIGHT = 60;
const CARD_TOP_OFFSET = 6;

const MIN_WIDTH_BY_ZOOM: Record<ZoomLevel, number> = {
  week: 210,
  month: 160,
  quarter: 120,
  half: 100,
  year: 80,
};

const getDetailLevel = (zoom: ZoomLevel, widthPx: number): 'summary' | 'compact' | 'standard' | 'expanded' => {
  if (zoom === 'year') return 'summary';
  if (zoom === 'half' || zoom === 'quarter') {
    return widthPx < 180 ? 'compact' : 'standard';
  }
  if (zoom === 'month') {
    if (widthPx < 150) return 'compact';
    if (widthPx > 260) return 'standard';
    return 'standard';
  }
  if (zoom === 'week') {
    if (widthPx >= 220) return 'expanded';
    if (widthPx < 160) return 'compact';
    return 'standard';
  }
  return 'standard';
};

const trimNote = (note?: GoalNoteSummary | null): GoalNoteSummary | null => {
  if (!note || !note.text) return null;
  const trimmed = note.text.length > 180 ? `${note.text.slice(0, 177)}…` : note.text;
  return { ...note, text: trimmed };
};

const hexToRgba = (hex: string, alpha: number) => {
  const value = hex.replace('#', '');
  const bigint = parseInt(value.length === 3 ? value.split('').map(c => c + c).join('') : value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

type PreparedGoalCard = {
  goal: GanttItem;
  top: number;
  left: number;
  width: number;
  subtitle: string;
  progress: number;
  themeColor: string;
  gradientStart: string;
  gradientEnd: string;
  isCompact: boolean;
  isUltra: boolean;
  detailLevel: 'summary' | 'compact' | 'standard' | 'expanded';
  activitySnippet?: GoalNoteSummary | null;
  height: number;
};

type SprintBand = {
  id: string;
  left: number;
  width: number;
  name: string;
};

type WeekGuide = {
  key: string;
  left: number;
};

type ThemeLaneProps = {
  laneId: number;
  dropThemeId: number;
  index: number;
  items: PreparedGoalCard[];
  collapsed: boolean;
  laneColor: string;
  showWeekGrid: boolean;
  sprintBands: SprintBand[];
  weekLines: WeekGuide[];
  goalById: Record<string, Goal>;
  handleGenerateStories: (item: GanttItem) => void;
  setSelectedGoalId: (id: string | null) => void;
  setEditGoal: (goal: Goal | null) => void;
  onDeleteGoal: (goalId: string) => void;
  openGlobalActivity: (goal: Goal) => void;
  onItemClick: (item: GanttItem) => void;
  updateGoalDates: (goalId: string, start: Date, end: Date) => void;
  onAddNote: (goalId: string) => void;
  zoom: ZoomLevel;
  viewStart: Date;
  viewEnd: Date;
};

type PreparedLane = {
  laneId: number;
  dropThemeId: number;
  index: number;
  laneColor: string;
  collapsed: boolean;
  items: PreparedGoalCard[];
  top: number;
  height: number;
};

const ThemeLane: React.FC<ThemeLaneProps> = ({
  laneId,
  dropThemeId,
  index,
  items,
  collapsed,
  laneColor,
  showWeekGrid,
  sprintBands,
  weekLines,
  goalById,
  handleGenerateStories,
  setSelectedGoalId,
  setEditGoal,
  onDeleteGoal,
  openGlobalActivity,
  onItemClick,
  updateGoalDates,
  onAddNote,
  zoom,
  viewStart,
  viewEnd,
}) => {
  const laneVisibleRows = collapsed ? 0 : Math.max(1, items.length);
  const laneHeight = collapsed ? 48 : laneVisibleRows * ROW_HEIGHT + 16;
  const { setNodeRef, isOver } = useDroppable({
    id: `lane-${laneId}`,
    data: { kind: 'lane', themeId: dropThemeId },
  });

  const overscanFactor = 1.5;
  const viewWidth = viewEnd.getTime() - viewStart.getTime();
  const overscan = viewWidth * overscanFactor;

  const visibleItems = useMemo(() => items.filter(item => {
    const itemStart = item.goal.startDate.getTime();
    const itemEnd = item.goal.endDate.getTime();
    const viewStartMs = viewStart.getTime();
    const viewEndMs = viewEnd.getTime();
    return itemEnd >= (viewStartMs - overscan) && itemStart <= (viewEndMs + overscan);
  }), [items, viewStart, viewEnd, overscan]);


  return (
    <div
      ref={setNodeRef}
      className={`rv2-lane ${index % 2 === 1 ? 'alt' : ''} ${isOver ? 'theme-group--target' : ''}`}
      data-theme-group={laneId}
      style={{ height: laneHeight }}
    >
      <div className="rv2-lane-accent" style={{ backgroundColor: laneColor }} />
      {sprintBands.map((band) => (
        <div
          key={`row-s-${band.id}`}
          className="rv2-sprint-shade"
          aria-hidden="true"
          style={{
            left: band.left,
            width: band.width,
            top: 0,
            bottom: 0,
          }}
        />
      ))}
      {showWeekGrid && weekLines.map((line) => (
        <div key={line.key} className="rv2-grid-week" style={{ left: line.left }} />
      ))}
      {!collapsed && (
        <div className="rv2-lane-canvas" style={{ minHeight: laneHeight }}>
          {visibleItems.map((item) => {
            const g = item.goal;
            return (
              <RoadmapGoalCard
                key={g.id}
                goal={g}
                top={item.top}
                left={item.left}
                width={item.width}
                height={item.height}
                themeColor={item.themeColor}
                gradientStart={item.gradientStart}
                gradientEnd={item.gradientEnd}
                subtitle={item.subtitle}
                isCompact={item.isCompact}
                isUltra={item.isUltra}
                progress={item.progress}
                detailLevel={item.detailLevel}
                activitySnippet={item.activitySnippet || null}
                onOpenActivity={() => {
                  const full = goalById[g.id];
                  if (full) openGlobalActivity(full);
                }}
                onGenerateStories={() => handleGenerateStories(g)}
                onEdit={() => setEditGoal(goalById[g.id] || null)}
                onDelete={() => onDeleteGoal(g.id)}
                onOpenStories={() => setSelectedGoalId(g.id)}
                onSelectGoal={() => {
                  onItemClick(g);
                  setSelectedGoalId(g.id);
                }}
                onNudgeDates={(delta) => {
                  const s = new Date(g.startDate);
                  const e = new Date(g.endDate);
                  s.setHours(0, 0, 0, 0);
                  e.setHours(0, 0, 0, 0);
                  s.setDate(s.getDate() + delta);
                  e.setDate(e.getDate() + delta);
                  updateGoalDates(g.id, s, e);
                }}
                onAddNote={() => onAddNote(g.id)}
                zoom={zoom}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

const RoadmapV2: React.FC<Props> = ({
  goals,
  sprints,
  stories,
  storiesByGoal,
  doneStoriesByGoal,
  latestGoalNotes,
  onItemClick,
  updateGoalDates,
  handleGenerateStories,
  setSelectedGoalId,
  setActivityGoalId,
  setNoteGoalId,
  setNoteDraft,
  setEditGoal,
  onDeleteGoal,
  openGlobalActivity,
  onWheel,
  onMouseDown,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onSwitchToRoadmap,
  selectedSprintId
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const userInteractedRef = useRef(false);
  const autoScrolledRef = useRef(false);
  const scrollRafRef = useRef<number | null>(null);
  const [measureRef, bounds] = useMeasure();
  const {
    start,
    end,
    width,
    zoom,
    setRange,
    setZoom,
    setWidth,
    laneCollapse,
    toggleLane,
  } = useRoadmapStore((state) => ({
    start: state.start,
    end: state.end,
    width: state.width,
    zoom: state.zoom,
    setRange: state.setRange,
    setZoom: state.setZoom,
    setWidth: state.setWidth,
    laneCollapse: state.laneCollapse,
    toggleLane: state.toggleLane,
  }), shallow);
  const scale = useMemo(
    () => scaleTime<number>({ domain: [start, end], range: [0, Math.max(1, width)] }),
    [start, end, width]
  );
  const scaleDate = useCallback((d: Date) => scale(d), [scale]);
  const [filterActiveSprint, setFilterActiveSprint] = useState(false);
  const [filterHasStories, setFilterHasStories] = useState(false);
  const [filterOverlapSprint, setFilterOverlapSprint] = useState(false);
  const [goToInput, setGoToInput] = useState<string>('');
  const dateFormatter = useMemo(() => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }), []);
  const [viewport, setViewport] = useState({ top: 0, height: 720 });

  // Keep store width synced to container
  useEffect(() => {
    if (bounds.width) {
      const w = Math.max(300, bounds.width - 250);
      setWidth(w);
      logger.debug('roadmapV2', 'measure', { container: bounds.width, timeline: w });
    }
  }, [bounds.width, setWidth]);

  useEffect(() => {
    if (!goals.length) {
      autoScrolledRef.current = false;
    }
  }, [goals.length]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const markInteraction = () => { userInteractedRef.current = true; };
    el.addEventListener('wheel', markInteraction, { passive: true });
    el.addEventListener('touchstart', markInteraction, { passive: true });
    el.addEventListener('mousedown', markInteraction);
    return () => {
      el.removeEventListener('wheel', markInteraction);
      el.removeEventListener('touchstart', markInteraction);
      el.removeEventListener('mousedown', markInteraction);
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateViewport = () => {
      setViewport(prev => ({
        top: el.scrollTop,
        height: el.clientHeight || prev.height,
      }));
    };
    updateViewport();
    const handleScroll = () => {
      if (scrollRafRef.current != null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updateViewport();
      });
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateViewport);
    return () => {
      el.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateViewport);
      if (scrollRafRef.current != null) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  // Auto-fit range once when goals list is available
  useEffect(() => {
    if (!goals || goals.length === 0) return;
    const dates: number[] = [];
    goals.forEach(g => {
      if (g.startDate) dates.push(Number(g.startDate));
      const e = g.endDate || (g.targetDate ? new Date(g.targetDate).getTime() : undefined);
      if (e) dates.push(Number(e));
    });
    if (dates.length < 2) return;
    const min = Math.min(...dates);
    const max = Math.max(...dates);
    const pad = Math.round((max - min) * 0.08);
    const ns = new Date(min - pad);
    const ne = new Date(max + pad);
    setRange(ns, ne);
    logger.info('roadmapV2', 'autoFit', { start: ns.toISOString(), end: ne.toISOString() });
  }, [goals, setRange]);

  const ganttItems = useMemo<GanttItem[]>(() => {
    return goals.map((goal) => {
      const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
      const endDate = goal.endDate ? new Date(goal.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
      return {
        id: goal.id,
        title: goal.title,
        theme: goal.theme,
        startDate,
        endDate,
        status: goal.status,
        priority: (goal as any).priority,
        startLabel: dateFormatter.format(startDate),
        endLabel: dateFormatter.format(endDate),
      };
    });
  }, [goals, dateFormatter]);

  const filteredItems = useMemo(() => {
    if ((!filterActiveSprint && !filterHasStories) || stories.length === 0) return ganttItems;
    const byGoal = new Map<string, Story[]>();
    stories.forEach(s => {
      const arr = byGoal.get(s.goalId) || [];
      arr.push(s);
      byGoal.set(s.goalId, arr);
    });
    // Sprint date overlap helper
    let sprintStart: Date | null = null;
    let sprintEnd: Date | null = null;
    if (filterOverlapSprint && selectedSprintId) {
      const sp = sprints.find(s => s.id === selectedSprintId);
      if (sp) { sprintStart = new Date(sp.startDate); sprintEnd = new Date(sp.endDate); }
    }
    return ganttItems.filter(g => {
      const st = byGoal.get(g.id) || [];
      if (filterHasStories && st.length === 0) return false;
      if (filterActiveSprint && selectedSprintId) {
        return st.some(s => s.sprintId === selectedSprintId);
      }
      if (filterOverlapSprint && sprintStart && sprintEnd) {
        // overlap if [g.start,g.end] intersects [sprintStart,sprintEnd]
        const gs = g.startDate.getTime();
        const ge = g.endDate.getTime();
        const ss = sprintStart.getTime();
        const se = sprintEnd.getTime();
        if (!(gs <= se && ge >= ss)) return false;
      }
      return true;
    });
  }, [ganttItems, stories, filterActiveSprint, filterHasStories, filterOverlapSprint, selectedSprintId, sprints]);

  const goalById = useMemo(() => Object.fromEntries(goals.map(g => [g.id, g])), [goals]);

  const handleOpenNote = useCallback((goalId: string) => {
    setNoteDraft('');
    setNoteGoalId(goalId);
  }, [setNoteDraft, setNoteGoalId]);

  const itemsByTheme = useMemo(() => {
    const grouped: Record<number, GanttItem[]> = {};
    filteredItems.forEach((g) => {
      const k = migrateThemeValue(g.theme);
      (grouped[k] = grouped[k] || []).push(g);
    });
    // order by start date in each theme
    Object.values(grouped).forEach(arr => arr.sort((a,b)=>a.startDate.getTime()-b.startDate.getTime()));
    return grouped;
  }, [filteredItems]);

  const sprintBands = useMemo(() => {
    return sprints.map((s) => {
      const startPx = scaleDate(new Date(s.startDate));
      const endPx = scaleDate(new Date(s.endDate));
      return {
        id: s.id,
        left: startPx,
        width: Math.max(2, endPx - startPx),
        name: s.name,
      } as SprintBand;
    });
  }, [sprints, scaleDate]);

  const weekLines = useMemo(() => {
    if (zoom !== 'week') return [] as WeekGuide[];
    const lines: WeekGuide[] = [];
    const startDay = new Date(start);
    startDay.setHours(0, 0, 0, 0);
    for (let cursor = new Date(startDay); cursor <= end; cursor.setDate(cursor.getDate() + 7)) {
      const left = scaleDate(new Date(cursor));
      lines.push({ key: `w-${cursor.getTime()}`, left });
    }
    return lines;
  }, [zoom, start, end, scaleDate]);

  // Pre-compute lane layout so we can virtualize visible rows efficiently.
  const { lanes: preparedLanes, totalHeight: totalLaneHeight } = useMemo(() => {
    let cursor = 0;
    const lanes = LANE_THEMES.map((t, idx) => {
      const themeItems = itemsByTheme[t.id] || [];
      const dropThemeId = migrateThemeValue(t.id);
      const laneColor = getThemeById(dropThemeId).color;
      const gradientStart = hexToRgba(laneColor, 0.12);
      const gradientEnd = hexToRgba(laneColor, 0.04);
      const collapsed = Boolean(laneCollapse[t.id]);
      const preparedItems: PreparedGoalCard[] = collapsed ? [] : themeItems.map((item, itemIdx) => {
        const startPx = scaleDate(item.startDate);
        const endPx = scaleDate(item.endDate);
        const baseWidth = endPx - startPx;
        const minWidth = MIN_WIDTH_BY_ZOOM[zoom] ?? 100;
        const widthPx = Math.max(minWidth, baseWidth);
        const isCompact = widthPx < 220;
        const isUltra = widthPx < 160;
        const total = storiesByGoal[item.id] || 0;
        const done = doneStoriesByGoal[item.id] || 0;
        const progress = total ? Math.round((done / total) * 100) : 0;
        const subtitle = `${item.startLabel ?? dateFormatter.format(item.startDate)} – ${item.endLabel ?? dateFormatter.format(item.endDate)}`;
        const detailLevel = getDetailLevel(zoom, widthPx);
        const activitySnippet = detailLevel === 'expanded' ? trimNote(latestGoalNotes?.[item.id]) : null;
        const cardHeight = detailLevel === 'expanded' ? CARD_HEIGHT + 12 : CARD_HEIGHT;
        return {
          goal: item,
          top: CARD_TOP_OFFSET + itemIdx * ROW_HEIGHT,
          left: startPx,
          width: widthPx,
          subtitle,
          progress,
          themeColor: laneColor,
          gradientStart,
          gradientEnd,
          isCompact,
          isUltra,
          detailLevel,
          activitySnippet,
          height: cardHeight,
        } as PreparedGoalCard;
      });
      const laneVisibleRows = collapsed ? 0 : Math.max(1, themeItems.length);
      const laneHeight = collapsed ? 48 : laneVisibleRows * ROW_HEIGHT + 16;
      const top = cursor;
      cursor += laneHeight;
      return {
        laneId: t.id,
        dropThemeId,
        index: idx,
        laneColor,
        collapsed,
        items: preparedItems,
        top,
        height: laneHeight,
      } as PreparedLane;
    });
    return { lanes, totalHeight: cursor };
  }, [itemsByTheme, laneCollapse, storiesByGoal, doneStoriesByGoal, zoom, scaleDate, latestGoalNotes, dateFormatter]);

  const overscan = ROW_HEIGHT * 3;
  const visibleLanes = useMemo(() => {
    const topBound = Math.max(0, viewport.top - overscan);
    const bottomBound = viewport.top + viewport.height + overscan;
    return preparedLanes.filter((lane) => (lane.top + lane.height >= topBound) && (lane.top <= bottomBound));
  }, [preparedLanes, viewport.top, viewport.height, overscan]);

  const laneMetaById = useMemo(() => {
    const map: Record<number, { id: number; name: string; index: number }> = {};
    LANE_THEMES.forEach((t, idx) => {
      map[t.id] = { id: t.id, name: t.name, index: idx };
    });
    return map;
  }, []);

  // Only render lanes inside the viewport (plus overscan) to keep the DOM small.
  const lanesToRender = visibleLanes;

  const jumpBy = (days: number) => {
    const delta = days * 24 * 60 * 60 * 1000;
    setRange(new Date(start.getTime() + delta), new Date(end.getTime() + delta));
  };

  const markManualInteraction = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const today = new Date();
  const leftToday = scaleDate(today);
  const showMonthGrid = zoom === 'week' || zoom === 'month';
  const showWeekGrid = zoom === 'week';
  const showHeaderDividers = showMonthGrid;

  // Fullscreen support (hide chrome via global CSS)
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFs = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (active) document.body.classList.add('gantt-full-active');
      else document.body.classList.remove('gantt-full-active');
      logger.info('roadmapV2', 'fullscreen-change', { active });
    };
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await (containerRef.current as any)?.requestFullscreen?.();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      logger.error && logger.error('roadmapV2', 'fullscreen-failed', e as any);
    }
  };

  // Month header fragments
  const monthBlocks = useMemo(() => {
    const blocks: Array<{ key: string; left: number; width: number; label: string }> = [];
    // Prefer explicit zoom for band selection; fallback to span
    const monthsSpan = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    const mode: ZoomLevel = zoom;
    if (mode === 'year' || monthsSpan > 60) {
      // Years band
      const cur = new Date(start.getFullYear(), 0, 1);
      while (cur <= end) {
        const next = new Date(cur.getFullYear() + 1, 0, 1);
        const left = scaleDate(cur);
        const w = scaleDate(next) - scaleDate(cur);
        blocks.push({ key: `Y-${cur.getFullYear()}`, left, width: w, label: `${cur.getFullYear()}` });
        cur.setFullYear(cur.getFullYear() + 1);
      }
    } else if (mode === 'quarter' || monthsSpan > 18) {
      const cur = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
      while (cur <= end) {
        const q = Math.floor(cur.getMonth() / 3) + 1;
        const next = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
        const left = scaleDate(cur);
        const w = scaleDate(next) - scaleDate(cur);
        const lbl = `Q${q} ${cur.getFullYear()}`;
        blocks.push({ key: `Q${q}-${cur.getFullYear()}`, left, width: w, label: lbl });
        cur.setMonth(cur.getMonth() + 3);
      }
    } else {
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        const left = scaleDate(cur);
        const w = scaleDate(next) - scaleDate(cur);
        const showYear = cur.getMonth() === 0 || monthsSpan > 12;
        // Adaptive label by pixel width
        let label = '';
        if (w >= 90) label = cur.toLocaleDateString('en-US', { month: 'long' });
        else if (w >= 50) label = cur.toLocaleDateString('en-US', { month: 'short' });
        else if (w >= 30) label = cur.toLocaleDateString('en-US', { month: 'short' });
        else label = '';
        if (showYear && w >= 60) label = `${label} ${cur.getFullYear()}`;
        blocks.push({ key: `${cur.getFullYear()}-${cur.getMonth()}`, left, width: w, label });
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    return blocks;
  }, [start, end, zoom, scaleDate]);

  // Zoom helpers
  const zoomByFactor = (factor: number) => {
    const mid = new Date((start.getTime() + end.getTime()) / 2);
    const span = end.getTime() - start.getTime();
    const newSpan = Math.max(7 * 24 * 60 * 60 * 1000, span * factor);
    const ns = new Date(mid.getTime() - newSpan / 2);
    const ne = new Date(mid.getTime() + newSpan / 2);
    setRange(ns, ne);
  };
  const scrollContainerToDate = useCallback((d: Date, behavior: ScrollBehavior = 'auto') => {
    const el = containerRef.current;
    if (!el) return;
    const offsetLeft = 250 + scaleDate(d) - el.clientWidth * 0.35;
    el.scrollTo({ left: Math.max(0, offsetLeft), behavior });
  }, [scaleDate]);

  const goToDate = (d: Date) => {
    // Recentre current zoom window on date d
    setZoom(zoom, d);
    scrollContainerToDate(d, 'smooth');
  };

  useEffect(() => {
    if (autoScrolledRef.current) return;
    if (!containerRef.current) return;
    if (!goals.length) return;
    if (userInteractedRef.current) return;
    autoScrolledRef.current = true;
    const frame = requestAnimationFrame(() => scrollContainerToDate(new Date(), 'smooth'));
    return () => cancelAnimationFrame(frame);
  }, [goals.length, scrollContainerToDate]);

  return (
    <div className="rv2-container">
      {/* Toolbar */}
          <div className="rv2-toolbar">
            <div className="rv2-toolbar-left">Roadmap Timeline</div>
            <div className="rv2-toolbar-right">
          {/* Roadmap switch button removed per feedback */}
          <Button size="sm" variant="outline-secondary" title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'} onClick={() => { markManualInteraction(); toggleFullscreen(); }}>{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</Button>
          <Button size="sm" variant="outline-secondary" title="Zoom in" onClick={() => { markManualInteraction(); zoomByFactor(0.75); }}><ZoomIn size={14} /></Button>
          <Button size="sm" variant="outline-secondary" title="Zoom out" onClick={() => { markManualInteraction(); zoomByFactor(1.25); }}><ZoomOut size={14} /></Button>
          <Button size="sm" variant="outline-secondary" title="Fit all goals" onClick={() => {
            markManualInteraction();
            const all = filteredItems;
            if (all.length === 0) return;
            const times: number[] = [];
            all.forEach(g => { times.push(g.startDate.getTime(), g.endDate.getTime()); });
            const min = Math.min(...times), max = Math.max(...times);
            const pad = Math.round((max - min) * 0.08);
            setRange(new Date(min - pad), new Date(max + pad));
          }}>Fit</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); setZoom('week'); }}>Weeks</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); setZoom('month'); }}>Months</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); setZoom('quarter'); }}>Quarters</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); setZoom('year'); }}>Years</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); setRange(new Date(today.getFullYear(), today.getMonth(), today.getDate()-42), new Date(today.getFullYear(), today.getMonth(), today.getDate()+42)); scrollContainerToDate(today, 'smooth'); }}>Today</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); jumpBy(-14); }}><ChevronLeft size={14} /></Button>
          <Button size="sm" variant="outline-secondary" onClick={() => { markManualInteraction(); jumpBy(14); }}><ChevronRight size={14} /></Button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            Go to:
            <input
              type="date"
              value={goToInput}
              onChange={(e) => {
                const v = e.target.value;
                setGoToInput(v);
                if (v) {
                  const d = new Date(v + 'T12:00:00');
                  if (!isNaN(d.getTime())) {
                    markManualInteraction();
                    goToDate(d);
                  }
                }
              }}
              style={{ fontSize: 12, padding: '2px 4px' }}
            />
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            <input type="checkbox" checked={filterHasStories} onChange={(e) => { markManualInteraction(); setFilterHasStories(e.target.checked); }} /> Has stories
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            <input type="checkbox" checked={filterActiveSprint} onChange={(e) => { markManualInteraction(); setFilterActiveSprint(e.target.checked); }} disabled={!selectedSprintId} /> In selected sprint
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            <input type="checkbox" checked={filterOverlapSprint} onChange={(e) => { markManualInteraction(); setFilterOverlapSprint(e.target.checked); }} disabled={!selectedSprintId} /> Overlaps sprint dates
          </label>
        </div>
      </div>

      {/* Header + Grid + Lanes */}
      {/* Wheel zoom disabled; rely on buttons. Preserve native scrolling. */}
      <div ref={containerRef} className="rv2-scroll" onMouseDown={onMouseDown} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div ref={measureRef} className="rv2-canvas" style={{ minWidth: Math.max(1200, width) }}>
          {/* Sticky header */}
          <div className="rv2-header">
            <div className="rv2-header-left" style={{ width: 250 }}>Themes</div>
            <div className="rv2-header-right">
              {/* Sprint shading under header */}
              {sprintBands.map((band) => (
                <div
                  key={`hdr-s-${band.id}`}
                  className="rv2-sprint-shade rv2-sprint-shade--header"
                  style={{
                    left: band.left,
                    width: band.width,
                  }}
                >
                  <span className="rv2-sprint-label">{band.name}</span>
                </div>
              ))}
              {/* Months band */}
              <div className="rv2-months">
                {monthBlocks.map(m => (
                  <div
                    key={m.key}
                    className={`rv2-month ${showHeaderDividers ? '' : 'coarse'}`.trim()}
                    style={{ left: m.left, width: m.width }}
                  >
                    {m.label}
                  </div>
                ))}
              </div>
              {/* Weeks/axis band */}
              <div className="rv2-axis">
                <RoadmapAxis height={36} />
                <div className="rv2-today-chip" style={{ left: leftToday }}>Today</div>
              </div>
              {/* Today marker (header layer) */}
              <div className="rv2-today-line" style={{ left: leftToday }} />
              {/* Monthly gridlines stronger */}
              {showMonthGrid && monthBlocks.map(m => (
                <div key={`grid-${m.key}`} className="rv2-grid-month" style={{ left: m.left }} />
              ))}
            </div>
          </div>

          {/* Lanes */}
          <div className="rv2-body">
            {/* Left sticky lane headers */}
            <div className="rv2-lane-left" style={{ width: 250, position: 'relative', height: totalLaneHeight }}>
              {lanesToRender.map((lane) => {
                const meta = laneMetaById[lane.laneId];
                return (
                  <div
                    key={lane.laneId}
                    className={`rv2-lane-header ${lane.index % 2 === 1 ? 'alt' : ''}`}
                    data-theme-group={lane.laneId}
                    onClick={() => toggleLane(lane.laneId)}
                    title="Click to collapse/expand"
                    style={{ height: lane.height, position: 'absolute', top: lane.top, left: 0, right: 0 }}
                  >
                    <div className="rv2-lane-title">
                      <span className="rv2-lane-dot" style={{ backgroundColor: lane.laneColor }} />
                      {meta?.name ?? `Theme ${lane.laneId}`}
                      {lane.collapsed ? <span className="rv2-lane-meta">(collapsed)</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {/* Right timeline area */}
            <div className="rv2-lane-right" style={{ position: 'relative', height: totalLaneHeight }}>
              <div className="rv2-today-line" style={{ left: leftToday, height: totalLaneHeight }} />
              {lanesToRender.map((lane) => (
                <div key={lane.laneId} style={{ position: 'absolute', top: lane.top, left: 0, right: 0 }}>
                  <ThemeLane
                    laneId={lane.laneId}
                    dropThemeId={lane.dropThemeId}
                    index={lane.index}
                    items={lane.items}
                    collapsed={lane.collapsed}
                    laneColor={lane.laneColor}
                    showWeekGrid={showWeekGrid}
                    sprintBands={sprintBands}
                    weekLines={weekLines}
                    goalById={goalById}
                    handleGenerateStories={handleGenerateStories}
                    setSelectedGoalId={setSelectedGoalId}
                    setEditGoal={setEditGoal}
                    onDeleteGoal={onDeleteGoal}
                    openGlobalActivity={openGlobalActivity}
                    onItemClick={onItemClick}
                    updateGoalDates={updateGoalDates}
                    onAddNote={handleOpenNote}
                    zoom={zoom}
                    viewStart={start}
                    viewEnd={end}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadmapV2;
