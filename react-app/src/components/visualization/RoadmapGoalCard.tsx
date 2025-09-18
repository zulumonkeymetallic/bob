import React from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Activity, BookOpen, Pencil, Trash2, Wand2, StickyNote } from 'lucide-react';
import { GanttItem } from './RoadmapV2';
import { ZoomLevel } from '../../stores/roadmapStore';

type DragKind = 'move' | 'resize-start' | 'resize-end';

type BaseDragData = {
  kind: 'roadmap-card';
  goalId: string;
  themeId: number;
  start: number;
  end: number;
};

export interface RoadmapGoalCardProps {
  goal: GanttItem;
  top: number;
  left: number;
  width: number;
  height: number;
  themeColor: string;
  gradientStart: string;
  gradientEnd: string;
  subtitle: string;
  isCompact: boolean;
  isUltra: boolean;
  progress: number;
  onOpenActivity: () => void;
  onGenerateStories: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenStories: () => void;
  onSelectGoal: () => void;
  onNudgeDates: (deltaDays: number) => void;
  onAddNote: () => void;
  zoom: ZoomLevel;
}

const cardDragData = (goal: GanttItem): BaseDragData => ({
  kind: 'roadmap-card',
  goalId: goal.id,
  themeId: goal.theme,
  start: goal.startDate.getTime(),
  end: goal.endDate.getTime(),
});

export const RoadmapGoalCard: React.FC<RoadmapGoalCardProps> = ({
  goal,
  top,
  left,
  width,
  height,
  themeColor,
  gradientStart,
  gradientEnd,
  subtitle,
  isCompact,
  isUltra,
  progress,
  onOpenActivity,
  onGenerateStories,
  onEdit,
  onDelete,
  onOpenStories,
  onSelectGoal,
  onNudgeDates,
  onAddNote,
  zoom,
}) => {
  const moveDrag = useDraggable({
    id: `goal-${goal.id}-move`,
    data: {
      ...cardDragData(goal),
      dragType: 'move' as DragKind,
    },
  });

  const resizeStartDrag = useDraggable({
    id: `goal-${goal.id}-resize-start`,
    data: {
      ...cardDragData(goal),
      dragType: 'resize-start' as DragKind,
    },
  });

  const resizeEndDrag = useDraggable({
    id: `goal-${goal.id}-resize-end`,
    data: {
      ...cardDragData(goal),
      dragType: 'resize-end' as DragKind,
    },
  });

  const cardTransform = moveDrag.transform ? CSS.Translate.toString(moveDrag.transform) : undefined;
  const cardZ = moveDrag.isDragging ? 80 : 4;

  return (
    <div
      ref={moveDrag.setNodeRef}
      className={`rv2-card ${isCompact ? 'compact' : ''} ${isUltra ? 'ultra' : ''} rv2-card--zoom-${zoom}`}
      data-goal-id={goal.id}
      style={{
        top,
        left,
        width,
        height,
        borderColor: themeColor,
        borderWidth: 2,
        background: `linear-gradient(180deg, ${gradientStart}, ${gradientEnd}), var(--card)`,
        transform: cardTransform,
        zIndex: cardZ,
      }}
      tabIndex={0}
      title={`${goal.title}: ${subtitle}`}
      onClick={onSelectGoal}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const step = (e.shiftKey ? 7 : 1) * (e.key === 'ArrowLeft' ? -1 : 1);
          onNudgeDates(step);
        }
      }}
      {...moveDrag.attributes}
      {...moveDrag.listeners}
    >
      <div className="rv2-card-title" style={{ whiteSpace: isUltra ? 'nowrap' : 'normal' }}>{goal.title}</div>
      {!isCompact && <div className="rv2-card-subtitle">{subtitle}</div>}
      <div className="rv2-progress">
        <div className="rv2-progress-bar" style={{ width: `${progress}%` }} />
        <div className="rv2-progress-text">{progress}%</div>
      </div>
      {!isCompact && (
        <div className="rv2-actions">
          <button className="rv2-icon-btn muted" title="Activity" onClick={(e) => { e.stopPropagation(); onOpenActivity(); }}>
            <Activity size={14} />
          </button>
          <button className="rv2-icon-btn" title="Add note" onClick={(e) => { e.stopPropagation(); onAddNote(); }}>
            <StickyNote size={14} />
          </button>
          <button className="rv2-icon-btn brand" title="Auto-generate stories" onClick={(e) => { e.stopPropagation(); onGenerateStories(); }}>
            <Wand2 size={14} />
          </button>
          <button className="rv2-icon-btn brand" title="Edit goal" onClick={(e) => { e.stopPropagation(); onEdit(); }}>
            <Pencil size={14} />
          </button>
          <button className="rv2-icon-btn danger" title="Delete goal" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
            <Trash2 size={14} />
          </button>
          <button className="rv2-icon-btn" title="Stories" onClick={(e) => { e.stopPropagation(); onOpenStories(); }}>
            <BookOpen size={14} />
          </button>
        </div>
      )}
      <div
        ref={resizeStartDrag.setNodeRef}
        className="rv2-resize-handle start"
        {...resizeStartDrag.attributes}
        {...resizeStartDrag.listeners}
        onClick={(e) => e.stopPropagation()}
      />
      <div
        ref={resizeEndDrag.setNodeRef}
        className="rv2-resize-handle end"
        {...resizeEndDrag.attributes}
        {...resizeEndDrag.listeners}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export type RoadmapDragHandle = ReturnType<typeof cardDragData> & {
  dragType: DragKind;
};
