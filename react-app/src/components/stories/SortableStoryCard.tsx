import React from 'react';
import { Button } from 'react-bootstrap';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Activity, Wand2, Edit3, Trash2, Target, CalendarPlus, CalendarClock, Clock3 } from 'lucide-react';
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
  scheduledBlock?: {
    id: string;
    start: number;
    end: number;
    title?: string;
    source?: string;
    isAiGenerated?: boolean;
    googleEventId?: string;
    linkedStoryId?: string;
    entryMethod?: string;
  };
  themeColor?: string;
  themes?: GlobalTheme[];
  onEdit?: (story: Story) => void;
  onDelete?: (story: Story) => void;
  onItemClick?: (story: Story) => void;
  onManualSchedule?: (story: Story) => void;
  onDefer?: (story: Story) => void;
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
  scheduledBlock,
  themeColor,
  themes,
  onEdit,
  onDelete,
  onItemClick,
  onManualSchedule,
  onDefer,
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
  const isTop3 = (() => {
    if ((story as any).aiTop3ForDay !== true) return false;
    const top3Date = (story as any).aiTop3Date;
    if (!top3Date) return true;
    return String(top3Date).slice(0, 10) === new Date().toISOString().slice(0, 10);
  })();
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
  const scheduledBlockLabel = (() => {
    if (!scheduledBlock?.start || !scheduledBlock?.end) return null;
    const start = new Date(scheduledBlock.start);
    const end = new Date(scheduledBlock.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const dayLabel = start.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const timeLabel = `${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}-${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return `Planned ${dayLabel} ${timeLabel}`;
  })();

  const scheduledBlockSourceLabel = (() => {
    if (!scheduledBlockLabel) return null;
    const source = String(scheduledBlock?.source || '').toLowerCase();
    const entryMethod = String(scheduledBlock?.entryMethod || '').toLowerCase();
    const fromGcal = source === 'gcal' || !!scheduledBlock?.googleEventId;
    if (fromGcal && (scheduledBlock?.linkedStoryId || scheduledBlock?.googleEventId)) return 'linked from gcal';
    if (scheduledBlock?.isAiGenerated) return 'auto-planned';
    if (entryMethod.includes('manual') || source === 'manual' || source === 'bob') return 'manual';
    return 'manual';
  })();
  const deferredUntilMs = (() => {
    const raw = (story as any).deferredUntil ?? null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (raw?.toDate) return raw.toDate().getTime();
    const parsed = raw ? Date.parse(String(raw)) : NaN;
    return Number.isNaN(parsed) ? null : parsed;
  })();
  const isDeferred = Number.isFinite(deferredUntilMs as number) && (deferredUntilMs as number) > Date.now();
  const deferredLabel = isDeferred
    ? `Deferred to ${new Date(deferredUntilMs as number).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
    : null;
  const storyProgressPct = (() => {
    const raw = (story as any).progressPct ?? (story as any).progress ?? null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
  })();
  const storyLastComment = (() => {
    const raw = (story as any).lastComment
      ?? (story as any).latestComment
      ?? (story as any).lastNote
      ?? '';
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return null;
    return text.length > 140 ? `${text.slice(0, 140)}...` : text;
  })();

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
              {onManualSchedule && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0"
                  style={{ width: 24, height: 24, color: themeVars.muted }}
                  title="Schedule manually"
                  onClick={(event) => {
                    event.stopPropagation();
                    onManualSchedule(story);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <CalendarPlus size={12} />
                </Button>
              )}
              {onDefer && (
                <Button
                  variant="link"
                  size="sm"
                  className="p-0"
                  style={{ width: 24, height: 24, color: themeVars.muted }}
                  title="Defer intelligently"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDefer(story);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Clock3 size={12} />
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
          {storyLastComment && (
            <div className="kanban-card__note">
              <span className="kanban-card__note-label">Last comment:</span>{' '}
              {storyLastComment}
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
            {(story as any).userPriorityFlag && (
              <span
                className="kanban-card__meta-badge"
                style={{
                  borderColor: 'rgba(220, 53, 69, 0.45)',
                  backgroundColor: 'rgba(220, 53, 69, 0.12)',
                  color: 'var(--bs-danger)',
                }}
                title="User #1 priority flag"
              >
                <span style={{ fontWeight: 800 }}>1</span>&nbsp;Priority
              </span>
            )}
            {isTop3 && (
              <span className="kanban-card__meta-badge kanban-card__meta-badge--top3" title="Top 3 priority">
                Top 3
              </span>
            )}
            <span className="kanban-card__meta-badge" title="Story points">
              {(story.points ?? 0)} pts
            </span>
            {storyProgressPct != null && (
              <span className="kanban-card__meta-badge" title="Story progress percentage">
                Progress {storyProgressPct}%
              </span>
            )}
            {scheduledBlockLabel && (
              <span className="d-inline-flex flex-column" style={{ lineHeight: 1.2 }}>
                <span
                  className="kanban-card__meta-badge"
                  style={{
                    borderColor: 'rgba(37, 99, 235, 0.45)',
                    backgroundColor: 'rgba(37, 99, 235, 0.12)',
                    color: '#2563eb',
                  }}
                  title={scheduledBlock?.title || 'Planned calendar block'}
                >
                  <CalendarClock size={11} style={{ marginRight: 4, marginTop: -1 }} />
                  {scheduledBlockLabel}
                </span>
                {scheduledBlockSourceLabel && (
                  <span className="text-muted" style={{ fontSize: '0.65rem', marginTop: 2 }}>
                    {scheduledBlockSourceLabel}
                  </span>
                )}
              </span>
            )}
            {deferredLabel && (
              <span
                className="kanban-card__meta-badge"
                style={{
                  borderColor: 'rgba(245, 158, 11, 0.45)',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  color: '#b45309',
                }}
                title={deferredLabel}
              >
                <Clock3 size={11} style={{ marginRight: 4, marginTop: -1 }} />
                Deferred
              </span>
            )}
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
