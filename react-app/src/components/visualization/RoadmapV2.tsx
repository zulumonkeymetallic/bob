import React, { useEffect, useMemo, useRef } from 'react';
import { Button, Card } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, Wand2, Pencil, Activity, Trash2, BookOpen } from 'lucide-react';
import useMeasure from 'react-use-measure';
import { Goal, Sprint, Story } from '../../types';
import { useRoadmapStore, useTimelineScale, ZoomLevel } from '../../stores/roadmapStore';
import RoadmapAxis from './RoadmapAxis';
import './RoadmapV2.css';
import { getThemeById, migrateThemeValue } from '../../constants/globalThemes';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';

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
  onWheel: React.WheelEventHandler<HTMLDivElement>;
  onMouseDown: React.MouseEventHandler<HTMLDivElement>;
  onTouchStart: React.TouchEventHandler<HTMLDivElement>;
  onTouchMove: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd: React.TouchEventHandler<HTMLDivElement>;
  onSwitchToRoadmap?: () => void;
};

const THEMES = [
  { id: 1, name: 'Health', color: 'var(--theme-health-primary)' },
  { id: 2, name: 'Growth', color: 'var(--theme-growth-primary)' },
  { id: 3, name: 'Wealth', color: 'var(--theme-wealth-primary)' },
  { id: 4, name: 'Tribe', color: 'var(--theme-tribe-primary)' },
  { id: 5, name: 'Home', color: 'var(--theme-home-primary)' }
];

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
  onWheel,
  onMouseDown,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onSwitchToRoadmap
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [measureRef, bounds] = useMeasure();
  const scale = useTimelineScale();
  const { start, end, width, zoom, setRange, setZoom, setWidth, laneCollapse, toggleLane } = useRoadmapStore();

  // Keep store width synced to container
  useEffect(() => {
    if (bounds.width) setWidth(bounds.width);
  }, [bounds.width, setWidth]);

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
    ganttItems.forEach((g) => {
      (grouped[g.theme] = grouped[g.theme] || []).push(g);
    });
    // order by start date in each theme
    Object.values(grouped).forEach(arr => arr.sort((a,b)=>a.startDate.getTime()-b.startDate.getTime()));
    return grouped;
  }, [ganttItems]);

  const jumpBy = (days: number) => {
    const delta = days * 24 * 60 * 60 * 1000;
    setRange(new Date(start.getTime() + delta), new Date(end.getTime() + delta));
  };

  const today = new Date();
  const leftToday = scale(today);

  // Month header fragments
  const monthBlocks = useMemo(() => {
    const blocks: Array<{ key: string; left: number; width: number; label: string }> = [];
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      const next = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const left = scale(cur);
      const w = scale(next) - scale(cur);
      blocks.push({ key: `${cur.getFullYear()}-${cur.getMonth()}`, left, width: w, label: cur.toLocaleDateString('en-US', { month: 'long' }) + (cur.getMonth()===0 ? ` ${cur.getFullYear()}` : '') });
      cur.setMonth(cur.getMonth() + 1);
    }
    return blocks;
  }, [start, end, width, zoom]);

  return (
    <div className="rv2-container">
      {/* Toolbar */}
      <div className="rv2-toolbar">
        <div className="rv2-toolbar-left">Roadmap Timeline</div>
        <div className="rv2-toolbar-right">
          {onSwitchToRoadmap && (
            <Button size="sm" variant="outline-secondary" title="Switch to Roadmap" onClick={onSwitchToRoadmap}>Roadmap</Button>
          )}
          <Button size="sm" variant="outline-secondary" onClick={() => setZoom('week')}>Weeks</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setZoom('month')}>Months</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setZoom('quarter')}>Quarters</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => setRange(new Date(today.getFullYear(), today.getMonth(), today.getDate()-42), new Date(today.getFullYear(), today.getMonth(), today.getDate()+42))}>Today</Button>
          <Button size="sm" variant="outline-secondary" onClick={() => jumpBy(-14)}><ChevronLeft size={14} /></Button>
          <Button size="sm" variant="outline-secondary" onClick={() => jumpBy(14)}><ChevronRight size={14} /></Button>
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
              {THEMES.map((t, idx) => {
                const items = itemsByTheme[t.id] || [];
                const collapsed = laneCollapse[t.id];
                const laneVisibleRows = collapsed ? 0 : Math.min(8, Math.max(1, items.length));
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
              {THEMES.map((t, idx) => {
                const items = itemsByTheme[t.id] || [];
                const collapsed = laneCollapse[t.id];
                const laneVisibleRows = collapsed ? 0 : Math.min(8, Math.max(1, items.length));
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
                                onMouseDown={(e) => onDragStart(e, g, 'move')}
                                onTouchStart={(e) => onDragStart(e, g, 'move')}
                                onDragStart={(e) => e.preventDefault()}
                                onClick={() => onItemClick(g)}
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
                                  <button className="rv2-icon-btn muted" title="Activity stream" onClick={(e) => { e.stopPropagation(); setActivityGoalId(g.id); }}><Activity size={14} /></button>
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
