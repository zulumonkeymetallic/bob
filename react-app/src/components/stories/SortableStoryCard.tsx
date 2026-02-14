import React from 'react';
import { Button } from 'react-bootstrap';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Activity, Wand2, Edit3, Trash2, Target } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';

import { Story, Goal } from '../../types';
import { useSidebar } from '../../contexts/SidebarContext';
import { functions } from '../../firebase';
import { displayRefForEntity, validateRef } from '../../utils/referenceGenerator';
import { storyStatusText, priorityLabel as formatPriorityLabel, priorityPillClass } from '../../utils/storyCardFormatting';
import { colorWithAlpha, goalThemeColor } from '../../utils/storyCardFormatting';
import { themeVars } from '../../utils/themeVars';
import type { GlobalTheme } from '../../constants/globalThemes';

interface SortableStoryCardProps {
  story: Story;
  goal?: Goal;
  taskCount?: number;
  themeColor?: string;
  themes?: GlobalTheme[];
  onEdit?: (story: Story) => void;
  onDelete?: (story: Story) => void;
  onItemClick?: (story: Story) => void;
  showTags?: boolean;
}

const readKanbanTagPreference = (): boolean => {
  if (typeof window === 'undefined') return true;
  try {
    const stored = window.localStorage.getItem('kanbanShowTags');
    return stored ? stored === 'true' : true;
  } catch {
    return true;
  }
};

const SortableStoryCard: React.FC<SortableStoryCardProps> = ({
  story,
  goal,
  taskCount = 0,
  themeColor,
  themes,
  onEdit,
  onDelete,
  onItemClick,
  showTags,
}) => {
  const { showSidebar } = useSidebar();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: story.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const resolvedThemeColor = themeColor || goalThemeColor(goal, themes) || '#2563eb';

  const handleCardClick = () => {
    if (onItemClick) {
      onItemClick(story);
    } else {
      showSidebar(story, 'story');
    }
  };

  const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleCardClick();
    }
  };

  const refLabel = (() => {
    const shortRef = (story as any).referenceNumber || story.ref;
    return shortRef && validateRef(shortRef, 'story')
      ? shortRef
      : displayRefForEntity('story', story.id);
  })();

  const statusLabel = storyStatusText((story as any).status);
  const isTop3 = (story as any).aiTop3ForDay === true || Number((story as any).aiFocusStoryRank || 0) > 0;
  const priorityClass = isTop3 ? priorityPillClass(4) : priorityPillClass(story.priority);
  const priorityLabel = isTop3 ? 'Critical' : formatPriorityLabel(story.priority);
  const handleStyle: React.CSSProperties = {
    color: resolvedThemeColor,
    borderColor: colorWithAlpha(resolvedThemeColor, 0.45),
    backgroundColor: colorWithAlpha(resolvedThemeColor, 0.12),
  };

  const resolvedShowTags = typeof showTags === 'boolean' ? showTags : readKanbanTagPreference();
  const storyTags = Array.isArray((story as any).tags) ? (story as any).tags : [];
  const visibleTags = storyTags.slice(0, 4);
  const remainingTags = storyTags.length - visibleTags.length;

  const safeTaskCount = Number.isFinite(taskCount) ? Number(taskCount) : 0;

  const handleGenerateTasks = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
      await callable({ storyId: (story as any).id });
    } catch (error) {
      alert((error as any)?.message || 'Failed to orchestrate story planning');
    }
  };

  const handleEditClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onEdit?.(story);
  };

  const handleDeleteClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete?.(story);
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className={`kanban-card kanban-card--story kanban-card__clickable${isDragging ? ' dragging' : ''}`}
        style={{ borderLeft: `3px solid ${((story as any).blocked ? 'var(--bs-danger, #dc3545)' : resolvedThemeColor)}` }}
        role="button"
        tabIndex={0}
        onClick={handleCardClick}
        onKeyDown={handleCardKeyDown}
      >
        <button
          type="button"
          className="kanban-card__handle"
          style={handleStyle}
          {...attributes}
          {...listeners}
          onClick={(event) => event.stopPropagation()}
        >
          <GripVertical size={16} />
        </button>

        <div className="kanban-card__content">
          <div className="kanban-card__header">
            <span className="kanban-card__ref" style={{ color: resolvedThemeColor }}>
              {refLabel}
            </span>
            <div className="kanban-card__actions">
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="Activity stream"
                onClick={(event) => {
                  event.stopPropagation();
                  showSidebar(story, 'story');
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Activity size={12} />
              </Button>
              <Button
                variant="link"
                size="sm"
                className="p-0"
                style={{ width: 24, height: 24, color: themeVars.muted }}
                title="AI: Generate tasks for this story"
                onClick={handleGenerateTasks}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Wand2 size={12} />
              </Button>
              {onEdit && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0"
                  style={{ width: 24, height: 24, color: themeVars.muted }}
                  title="Edit story"
                  onClick={handleEditClick}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Edit3 size={12} />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0"
                  style={{ width: 24, height: 24, color: 'var(--red)' }}
                  title="Delete story"
                  onClick={handleDeleteClick}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
          </div>

          <div className="kanban-card__title" title={story.title || 'Untitled story'}>
            {story.title || 'Untitled story'}
          </div>

          {story.description && story.description.trim().length > 0 && (
            <div className="kanban-card__description">
              {story.description}
            </div>
          )}

          {resolvedShowTags && visibleTags.length > 0 && (
            <div className="kanban-card__tags">
              {visibleTags.map((tag) => (
                <span key={tag} className="kanban-card__tag">
                  #{tag}
                </span>
              ))}
              {remainingTags > 0 && (
                <span className="kanban-card__tag kanban-card__tag--muted">
                  +{remainingTags}
                </span>
              )}
            </div>
          )}

          <div className="kanban-card__meta">
            <span className={priorityClass} title={`Priority: ${priorityLabel}`}>
              {priorityLabel}
            </span>
            {isTop3 && (
              <span className="kanban-card__meta-badge kanban-card__meta-badge--top3" title="Top 3 priority">
                Top 3
              </span>
            )}
            <span className="kanban-card__meta-badge" title="Story points">
              {(story.points ?? 0)} pts
            </span>
            <span className="kanban-card__meta-text" title="Status">
              {statusLabel}
            </span>
          </div>

          <div className="kanban-card__goal">
            <Target size={12} color={resolvedThemeColor} />
            <span title={goal?.title || 'No goal linked'}>
              {goal?.title || 'No goal'}
            </span>
            <span className="kanban-card__meta-text" style={{ marginLeft: 'auto' }}>
              {safeTaskCount} task{safeTaskCount === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SortableStoryCard;
