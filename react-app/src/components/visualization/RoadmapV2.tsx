import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, Wand2, Pencil, Activity, Trash2, BookOpen } from 'lucide-react';
import useMeasure from 'react-use-measure';
import { Goal, Sprint, Story } from '../../types';
import { useRoadmapStore, useTimelineScale, ZoomLevel } from '../../stores/roadmapStore';
import RoadmapAxis from './RoadmapAxis';
import './RoadmapV2.css';
import GLOBAL_THEMES, { getThemeById, migrateThemeValue } from '../../constants/globalThemes';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import logger from '../../utils/logger';

type GanttItem = {
  id: string;
  title: string;
  theme: number;
  startDate: Date;
  endDate: Date;
  status: number;
  priority?: number;
};

type Props = {
  goals: Goal[];
  sprints: Sprint[];
  stories: Story[];
  storiesByGoal: Record<string, number>;
  doneStoriesByGoal: Record<string, number>;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, item: GanttItem, type: 'move' | 'resize-start' | 'resize-end') => void;
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

const RoadmapV2: React.FC<Props> = ({
  goals,
  sprints,
  stories,
  storiesByGoal,
  doneStoriesByGoal,
  onDragStart,
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
  const [measureRef, bounds] = useMeasure();
  const scale = useTimelineScale();
  const { start, end, width, zoom, setRange, setZoom, setWidth, laneCollapse, toggleLane } = useRoadmapStore();
  const [filterActiveSprint, setFilterActiveSprint] = useState(false);
  const [filterHasStories, setFilterHasStories] = useState(false);
  const [filterOverlapSprint, setFilterOverlapSprint] = useState(false);

  // Keep store width synced to container
  useEffect(() => {
    if (bounds.width) {
      const w = Math.max(300, bounds.width - 250);
      setWidth(w);
      logger.debug('roadmapV2', 'measure', { container: bounds.width, timeline: w });
    }
  }, [bounds.width, setWidth]);

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
    return goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      theme: goal.theme,
      startDate: goal.startDate ? new Date(goal.startDate) : new Date(),
      endDate: goal.endDate ? new Date(goal.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)),
      status: goal.status,
      priority: (goal as any).priority,
    }));
  }, [goals]);

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

  const hexToRgba = (hex: string, alpha: number) => {
    const v = hex.replace('#','');
    const bigint = parseInt(v.length === 3 ? v.split('').map(c => c+c).join('') : v, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

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

  const jumpBy = (days: number) => {
    const delta = days * 24 * 60 * 60 * 1000;
    setRange(new Date(start.getTime() + delta), new Date(end.getTime() + delta));
  };

  const today = new Date();
  const leftToday = scale(today);

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
    // Choose months vs quarters based on span
    const monthsSpan = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth());
    const useQuarters = monthsSpan > 18; // switch to quarters when zoomed far out
    if (useQuarters) {
      const cur = new Date(start.getFullYear(), Math.floor(start.getMonth() / 3) * 3, 1);
      while (cur <= end) {
        const q = Math.floor(cur.getMonth() / 3) + 1;
        const next = new Date(cur.getFullYear(), cur.getMonth() + 3, 1);
        const left = scale(cur);
        const w = scale(next) - scale(cur);
        blocks.push({ key: `Q${q}-${cur.getFullYear()}`, left, width: w, label: `Q${q} ${cur.getFullYear()}` });
        cur.setMonth(cur.getMonth() + 3);
      }
    } else {
      const cur = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cur <= end) {
        const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
        const left = scale(cur);
        const w = scale(next) - scale(cur);
        const showYear = cur.getMonth() === 0 || monthsSpan > 12;
        blocks.push({ key: `${cur.getFullYear()}-${cur.getMonth()}`, left, width: w, label: cur.toLocaleDateString('en-US', { month: monthsSpan > 12 ? 'short' : 'long' }) + (showYear ? ` ${cur.getFullYear()}` : '') });
        cur.setMonth(cur.getMonth() + 1);
      }
    }
    return blocks;
  }, [start, end, width, zoom, scale]);

  return (
    <div className="rv2-container">
      {/* Toolbar */}
          <div className="rv2-toolbar">
            <div className="rv2-toolbar-left">Roadmap Timeline</div>
            <div className="rv2-toolbar-right">
          {onSwitchToRoadmap && (
            <Button size="sm" variant="outline-secondary" title="Switch to Roadmap" onClick={onSwitchToRoadmap}>Roadmap</Button>
          )}
          <Button size="sm" variant="outline-secondary" title={isFullscreen ? 'Exit Full Screen' : 'Full Screen'} onClick={toggleFullscreen}>{isFullscreen ? 'Exit Full Screen' : 'Full Screen'}</Button>
          <Button size="sm" variant="outline-secondary" title="Fit all goals" onClick={() => {
            const all = filteredItems;
            if (all.length === 0) return;
            const times: number[] = [];
            all.forEach(g => { times.push(g.startDate.getTime(), g.endDate.getTime()); });
            const min = Math.min(...times), max = Math.max(...times);
            const pad = Math.round((max - min) * 0.08);
            setRange(new Date(min - pad), new Date(max + pad));
          }}>Fit</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setZoom('week')}>Weeks</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setZoom('month')}>Months</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setZoom('quarter')}>Quarters</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setRange(new Date(today.getFullYear(), today.getMonth(), today.getDate()-42), new Date(today.getFullYear(), today.getMonth(), today.getDate()+42))}>Today</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => jumpBy(-14)}><ChevronLeft size={14} /></Button>
          <Button size="sm" variant="outline-secondary" onClick={() => jumpBy(14)}><ChevronRight size={14} /></Button>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            <input type="checkbox" checked={filterHasStories} onChange={(e) => setFilterHasStories(e.target.checked)} /> Has stories
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            <input type="checkbox" checked={filterActiveSprint} onChange={(e) => setFilterActiveSprint(e.target.checked)} disabled={!selectedSprintId} /> In selected sprint
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 12 }}>
            <input type="checkbox" checked={filterOverlapSprint} onChange={(e) => setFilterOverlapSprint(e.target.checked)} disabled={!selectedSprintId} /> Overlaps sprint dates
          </label>
        </div>
      </div>

      {/* Header + Grid + Lanes */}
      <div ref={containerRef} className="rv2-scroll" onWheel={onWheel} onMouseDown={onMouseDown} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <div ref={measureRef} className="rv2-canvas" style={{ minWidth: Math.max(1200, width) }}>
          {/* Sticky header */}
          <div className="rv2-header">
            <div className="rv2-header-left" style={{ width: 250 }}>Themes</div>
            <div className="rv2-header-right">
              {/* Sprint shading under header */}
              {sprints.map((s) => (
                <div key={`hdr-s-${s.id}`} className="rv2-sprint-shade" style={{ left: scale(new Date(s.startDate)), width: scale(new Date(s.endDate)) - scale(new Date(s.startDate)) }} />
              ))}
              {/* Months band */}
              <div className="rv2-months">
                {monthBlocks.map(m => (
                  <div key={m.key} className="rv2-month" style={{ left: m.left, width: m.width }}>
                    {m.label}
                  </div>
                ))}
              </div>
              {/* Weeks/axis band */}
              <div className="rv2-axis">
                <RoadmapAxis height={36} />
                <div className="rv2-today-chip" style={{ left: leftToday }}>Today</div>
              </div>
              {/* Today marker */}
              <div className="rv2-today-line" style={{ left: leftToday }} />
              {/* Monthly gridlines stronger */}
              {monthBlocks.map(m => (
                <div key={`grid-${m.key}`} className="rv2-grid-month" style={{ left: m.left }} />
              ))}
            </div>
          </div>

          {/* Lanes */}
          <div className="rv2-body">
            {/* Left sticky lane headers */}
            <div className="rv2-lane-left" style={{ width: 250 }}>
              {LANE_THEMES.map((t, idx) => {
                const items = itemsByTheme[t.id] || [];
                const collapsed = laneCollapse[t.id];
                const laneVisibleRows = collapsed ? 0 : Math.max(1, items.length);
                const headerHeight = collapsed ? 48 : laneVisibleRows * 72 + 16;
                const themeIdNew = migrateThemeValue(t.id);
                const laneColor = getThemeById(themeIdNew).color;
                return (
                <div key={t.id} className={`rv2-lane-header ${idx % 2 === 1 ? 'alt' : ''}`} data-theme-group={t.id} onClick={() => toggleLane(t.id)} title="Click to collapse/expand" style={{ height: headerHeight }}>
                  <div className="rv2-lane-title">
                    <span className="rv2-lane-dot" style={{ backgroundColor: laneColor }} />
                    {t.name}
                    {laneCollapse[t.id] ? <span className="rv2-lane-meta">(collapsed)</span> : null}
                  </div>
                </div>
              );})}
            </div>
            {/* Right timeline area */}
            <div className="rv2-lane-right">
              {LANE_THEMES.map((t, idx) => {
                const items = itemsByTheme[t.id] || [];
                const collapsed = laneCollapse[t.id];
                const laneVisibleRows = collapsed ? 0 : Math.max(1, items.length);
                const rowHeight = collapsed ? 48 : laneVisibleRows * 72 + 16;
                const themeIdNew = migrateThemeValue(t.id);
                const laneColor = getThemeById(themeIdNew).color;
                return (
                  <div key={t.id} className={`rv2-lane ${idx % 2 === 1 ? 'alt' : ''}`} data-theme-group={t.id} style={{ height: rowHeight }}>
                    <div className="rv2-lane-accent" style={{ backgroundColor: laneColor }} />
                    {/* Sprint shading replicated behind rows */}
                    {sprints.map((s) => (
                      <div key={`row-s-${s.id}`} className="rv2-sprint-shade" style={{ left: scale(new Date(s.startDate)), width: scale(new Date(s.endDate)) - scale(new Date(s.startDate)), top: 0, bottom: 0 }} />
                    ))}
                    {/* Weekly gridlines light */}
                    {/* Approx weekly grid lines using 7d step from start */}
                    {(() => {
                      const lines = [] as JSX.Element[];
                      const startDay = new Date(start); startDay.setHours(0,0,0,0);
                      for (let d = new Date(startDay); d <= end; d.setDate(d.getDate() + 7)) {
                        lines.push(<div key={`w-${d.getTime()}`} className="rv2-grid-week" style={{ left: scale(new Date(d)) }} />);
                      }
                      return lines;
                    })()}
                    {/* Goal cards (virtualized rows) */}
                    {!collapsed && (
                      <List
                        height={rowHeight - 8}
                        width={width}
                        itemCount={items.length}
                        itemSize={72}
                        style={{ overflowX: 'hidden', position: 'relative' }}
                      >
                        {({ index, style }: ListChildComponentProps) => {
                          const g = items[index];
                          const left = scale(g.startDate);
                          const right = scale(g.endDate);
                          const widthPx = Math.max(140, right - left);
                          const themeColor = getThemeById(migrateThemeValue(g.theme)).color;
                          const bg1 = hexToRgba(themeColor, 0.12);
                          const bg2 = hexToRgba(themeColor, 0.04);
                          const total = storiesByGoal[g.id] || 0;
                          const done = doneStoriesByGoal[g.id] || 0;
                          const progress = total ? Math.round((done / total) * 100) : 0;
                          const subtitle = `${g.startDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${g.endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
                          return (
                            <div style={style} key={g.id}>
                              <div
                                className="rv2-card"
                                data-goal-id={g.id}
                                style={{ left, width: widthPx, borderColor: themeColor, borderWidth: 2, background: `linear-gradient(180deg, ${bg1}, ${bg2}), var(--card)` }}
                                tabIndex={0}
                                title={`${g.title}: ${subtitle}`}
                                onMouseDown={(e) => { logger.info('roadmapV2', 'mousedown card', { id: g.id, x: (e as any).clientX }); onDragStart(e, g, 'move'); }}
                                onTouchStart={(e) => { logger.info('roadmapV2', 'touchstart card', { id: g.id }); onDragStart(e, g, 'move'); }}
                                onDragStart={(e) => e.preventDefault()}
                                // Card click intentionally does nothing to avoid hijacking drag interactions
                                onClick={() => logger.debug && logger.debug('roadmapV2', 'card-click-ignored', { id: g.id })}
                                onKeyDown={(e) => {
                                  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                                    e.preventDefault();
                                    const step = (e.shiftKey ? 7 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
                                    const s = new Date(g.startDate);
                                    const en = new Date(g.endDate);
                                    s.setHours(0,0,0,0); en.setHours(0,0,0,0);
                                    s.setDate(s.getDate() + step);
                                    en.setDate(en.getDate() + step);
                                    updateGoalDates(g.id, s, en);
                                  }
                                }}
                              >
                                <div className="rv2-card-title">{g.title}</div>
                                <div className="rv2-card-subtitle">{subtitle}</div>
                                <div className="rv2-progress">
                                  <div className="rv2-progress-bar" style={{ width: `${progress}%` }} />
                                  <div className="rv2-progress-text">{progress}%</div>
                                </div>
                                <div className="rv2-actions">
                                  <button className="rv2-icon-btn muted" title="Activity" onClick={(e) => { e.stopPropagation(); const full = goalById[g.id]; if (full) openGlobalActivity(full); }}><Activity size={14} /></button>
                                  <button className="rv2-icon-btn brand" title="Auto-generate stories" onClick={(e) => { e.stopPropagation(); handleGenerateStories(g); }}><Wand2 size={14} /></button>
                                  <button className="rv2-icon-btn brand" title="Edit goal" onClick={(e) => { e.stopPropagation(); setEditGoal(goalById[g.id] || null); }}><Pencil size={14} /></button>
                                  <button className="rv2-icon-btn danger" title="Delete goal" onClick={(e) => { e.stopPropagation(); onDeleteGoal(g.id); }}><Trash2 size={14} /></button>
                                  <button className="rv2-icon-btn" title="Stories" onClick={(e) => { e.stopPropagation(); setSelectedGoalId(g.id); }}><BookOpen size={14} /></button>
                                </div>
                                <div className="rv2-resize-handle start" onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, g, 'resize-start'); }} onTouchStart={(e) => { e.stopPropagation(); onDragStart(e, g, 'resize-start'); }} />
                                <div className="rv2-resize-handle end" onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, g, 'resize-end'); }} onTouchStart={(e) => { e.stopPropagation(); onDragStart(e, g, 'resize-end'); }} />
                              </div>
                            </div>
                          );
                        }}
                      </List>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RoadmapV2;
