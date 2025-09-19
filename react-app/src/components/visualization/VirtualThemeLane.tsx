import React from 'react';
import { FixedSizeList as List, ListChildComponentProps } from 'react-window';
import { Goal } from '../../types';

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
  themeId: number;
  themeName: string;
  themeColor: string;
  items: GanttItem[];
  rowHeight?: number;
  getDatePosition: (d: Date) => number;
  storiesByGoal: Record<string, number>;
  doneStoriesByGoal: Record<string, number>;
  onDragStart: (e: React.MouseEvent | React.TouchEvent, item: any, type: 'move' | 'resize-start' | 'resize-end') => void;
  onItemClick: (item: any) => void;
  setSelectedGoalId: (id: string | null) => void;
  handleGenerateStories: (item: any) => void;
  setActivityGoalId: (id: string) => void;
  setNoteGoalId: (id: string) => void;
  setNoteDraft: (v: string) => void;
  updateGoalDates: (goalId: string, newStart: Date, newEnd: Date) => void;
  getThemeStyle: (id: number) => { color: string } | undefined;
};

const VirtualThemeLane: React.FC<Props> = ({
  items,
  rowHeight = 110,
  getDatePosition,
  storiesByGoal,
  doneStoriesByGoal,
  onDragStart,
  onItemClick,
  setSelectedGoalId,
  handleGenerateStories,
  setActivityGoalId,
  setNoteGoalId,
  setNoteDraft,
  updateGoalDates,
  getThemeStyle
}) => {
  const hexToRgba = (hex: string, alpha: number) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const Row = ({ index, style }: ListChildComponentProps) => {
    const goal = items[index];
    const theme = getThemeStyle(goal.theme);
    const startPos = getDatePosition(goal.startDate);
    const endPos = getDatePosition(goal.endDate);
    const width = Math.max(endPos - startPos, 20);
    const total = storiesByGoal[goal.id] || 0;
    const done = doneStoriesByGoal[goal.id] || 0;
    const progress = total ? Math.round((done / total) * 100) : 0;
    const alt = index % 2 === 1;
    const themeColor = theme?.color || '#6c757d';
    const bg1 = hexToRgba(themeColor, 0.18);
    const bg2 = hexToRgba(themeColor, 0.08);
    return (
      <div style={{ ...style, background: alt ? 'rgba(0,0,0,0.03)' : 'transparent' }} className="goal-row d-flex align-items-center border-bottom">
        <div className="goal-label p-2" style={{ width: '250px', minWidth: '250px' }}>
          <div className="d-flex align-items-center">
            <div className="theme-indicator me-2" style={{ width: 12, height: 12, backgroundColor: themeColor, borderRadius: 2 }} />
            <span className="fw-medium">{goal.title}</span>
          </div>
        </div>
        <div className="goal-timeline position-relative" style={{ minHeight: rowHeight - 36, flex: 1 }}>
          <div
            data-goal-id={goal.id}
            className={`goal-bar position-absolute cursor-move d-flex align-items-center`}
            style={{
              left: `${startPos}px`,
              width: `${width}px`,
              height: '60px',
              background: `linear-gradient(180deg, ${bg1}, ${bg2})`,
              border: (storiesByGoal[goal.id] || 0) === 0 ? '2px solid var(--red)' : `2px solid ${themeColor}`,
              borderRadius: '4px',
              top: '5px',
              zIndex: 5
            }}
            tabIndex={0}
            draggable={false}
            onMouseDown={(e) => onDragStart(e, goal as any, 'move')}
            onTouchStart={(e) => onDragStart(e, goal as any, 'move')}
            onDragStart={(e) => e.preventDefault()}
            onClick={() => onItemClick(goal as any)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const step = (e.shiftKey ? 7 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
                const s = new Date(goal.startDate);
                const en = new Date(goal.endDate);
                s.setHours(0,0,0,0); en.setHours(0,0,0,0);
                s.setDate(s.getDate() + step);
                en.setDate(en.getDate() + step);
                updateGoalDates(goal.id, s, en);
              }
            }}
            title={`${goal.title}: ${goal.startDate.toLocaleDateString()} - ${goal.endDate.toLocaleDateString()}${(storiesByGoal[goal.id]||0)===0 ? ' • No linked stories' : ''}`}
          >
            <div className="resize-handle resize-start position-absolute" style={{ left: 0, top: 0, width: 8, height: '100%', cursor: 'ew-resize', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '4px 0 0 4px' }}
              onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, goal as any, 'resize-start'); }}
              onTouchStart={(e) => { e.stopPropagation(); onDragStart(e, goal as any, 'resize-start'); }}
            />
            <div className="goal-content px-2 text-white flex-grow-1" style={{ fontSize: 13, lineHeight: '16px' }}>
              <div className="d-flex align-items-center justify-content-between">
                <div style={{ whiteSpace: 'normal', overflow: 'visible' }}>
                  <strong>{goal.title}</strong>
                  {typeof goal.priority !== 'undefined' && (<span className="ms-2">P{goal.priority}</span>)}
                </div>
                <div className="d-flex align-items-center gap-1">
                  <button className="btn btn-light btn-sm py-0 px-1" title="Generate stories with AI" onClick={(e) => { e.stopPropagation(); handleGenerateStories(goal as any); }}>✨</button>
                  <button className="btn btn-light btn-sm py-0 px-1" title="View activity" onClick={(e) => { e.stopPropagation(); setActivityGoalId(goal.id); }}>📝</button>
                  <button className="btn btn-light btn-sm py-0 px-1" title="View stories" onClick={(e) => { e.stopPropagation(); setSelectedGoalId(goal.id); }}>📖</button>
                  <button className="btn btn-light btn-sm py-0 px-1" title="Add note" onClick={(e) => { e.stopPropagation(); setNoteGoalId(goal.id); setNoteDraft(''); }}>💬</button>
                </div>
              </div>
              <div className="small">{total === 0 ? 'No linked stories' : `${total} stories`}</div>
              <div className="goal-progress mt-1 d-flex align-items-center" title={`Progress: ${done}/${total} stories`}>
                <div className="goal-progress-bar-bg">
                  <div className="goal-progress-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <span className="goal-progress-percent">{progress}%</span>
              </div>
            </div>
            <div className="resize-handle resize-end position-absolute" style={{ right: 0, top: 0, width: 8, height: '100%', cursor: 'ew-resize', backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: '0 4px 4px 0' }}
              onMouseDown={(e) => { e.stopPropagation(); onDragStart(e, goal as any, 'resize-end'); }}
              onTouchStart={(e) => { e.stopPropagation(); onDragStart(e, goal as any, 'resize-end'); }}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <List height={Math.min(items.length * rowHeight, 600)} width={'100%'} itemCount={items.length} itemSize={rowHeight} style={{ overflowX: 'hidden' }}>
      {Row}
    </List>
  );
};

export default VirtualThemeLane;
