import React, { useEffect, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Button } from 'react-bootstrap';
import { GripVertical, Activity, Wand2, Edit3, Trash2, Target, BookOpen } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { Story, Task, Goal } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import { storyStatusText, taskStatusText, priorityLabel as formatPriorityLabel, priorityPillClass, colorWithAlpha, goalThemeColor } from '../utils/storyCardFormatting';
import { themeVars } from '../utils/themeVars';

interface KanbanCardV2Props {
    item: Story | Task;
    type: 'story' | 'task';
    goal?: Goal;
    story?: Story; // For tasks, the parent story
    taskCount?: number; // For stories
    themeColor?: string;
    onEdit?: (item: Story | Task) => void;
    onDelete?: (item: Story | Task) => void;
    onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
    showDescription?: boolean;
}

const KanbanCardV2: React.FC<KanbanCardV2Props> = ({
    item,
    type,
    goal,
    story: parentStory,
    taskCount = 0,
    themeColor,
    onEdit,
    onDelete,
    onItemSelect,
    showDescription = true,
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const { showSidebar } = useSidebar();

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        return draggable({
            element: el,
            getInitialData: () => ({ type, item, id: item.id }),
            onDragStart: () => setDragging(true),
            onDrop: () => setDragging(false),
        });
    }, [item, type]);

    const resolvedThemeColor = themeColor || goalThemeColor(goal) || '#2563eb';

    const handleCardClick = () => {
        if (onItemSelect) {
            onItemSelect(item, type);
        } else {
            showSidebar(item, type);
        }
    };

    const handleCardKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleCardClick();
        }
    };

    const refLabel = (() => {
        if (type === 'story') {
            const s = item as Story;
            const shortRef = (s as any).referenceNumber || s.ref;
            return shortRef && validateRef(shortRef, 'story') ? shortRef : displayRefForEntity('story', s.id);
        } else {
            const t = item as Task;
            return t.ref || `TASK-${t.id.slice(-4).toUpperCase()}`;
        }
    })();

    const statusLabel = type === 'story'
        ? storyStatusText((item as any).status)
        : taskStatusText((item as any).status);

    const priorityClass = priorityPillClass(item.priority);
    const priorityLabel = formatPriorityLabel(item.priority);

    const handleStyle: React.CSSProperties = {
        color: resolvedThemeColor,
        borderColor: colorWithAlpha(resolvedThemeColor, 0.45),
        backgroundColor: colorWithAlpha(resolvedThemeColor, 0.12),
    };

    const handleGenerateTasks = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        try {
            const callable = httpsCallable(functions, 'orchestrateStoryPlanning');
            await callable({ storyId: item.id });
        } catch (error) {
            alert((error as any)?.message || 'Failed to orchestrate story planning');
        }
    };

    return (
        <div
            ref={ref}
            className={`kanban-card kanban-card--${type} kanban-card__clickable${dragging ? ' dragging' : ''}`}
            style={{
                borderLeft: `3px solid ${((item as any).blocked ? 'var(--bs-danger, #dc3545)' : resolvedThemeColor)}`,
                opacity: dragging ? 0.4 : 1,
                marginBottom: '8px'
            }}
            role="button"
            tabIndex={0}
            onClick={handleCardClick}
            onKeyDown={handleCardKeyDown}
        >
            <button
                type="button"
                className="kanban-card__handle"
                style={handleStyle}
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
                                showSidebar(item, type);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <Activity size={12} />
                        </Button>

                        {type === 'story' && (
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
                        )}

                        {onEdit && (
                            <Button
                                variant="link"
                                size="sm"
                                className="p-0"
                                style={{ width: 24, height: 24, color: themeVars.muted }}
                                title={`Edit ${type}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onEdit(item);
                                }}
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
                                title={`Delete ${type}`}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDelete(item);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                <Trash2 size={12} />
                            </Button>
                        )}
                    </div>
                </div>

                <div className="kanban-card__title" title={item.title || `Untitled ${type}`}>
                    {item.title || `Untitled ${type}`}
                </div>

                {showDescription && item.description && item.description.trim().length > 0 && (
                    <div className="kanban-card__description">
                        {item.description}
                    </div>
                )}

                <div className="kanban-card__meta">
                    <span className={priorityClass} title={`Priority: ${priorityLabel}`}>
                        {priorityLabel}
                    </span>
                    {type === 'story' && (
                        <span className="kanban-card__meta-badge" title="Story points">
                            {((item as Story).points ?? 0)} pts
                        </span>
                    )}
                    {type === 'task' && (item as Task).effort && (
                        <span className="kanban-card__meta-badge" title="Effort">
                            {(item as Task).effort}
                        </span>
                    )}
                    <span className="kanban-card__meta-text" title="Status">
                        {statusLabel}
                    </span>
                </div>

                <div className="kanban-card__goal">
                    {type === 'story' ? (
                        <>
                            <Target size={12} color={resolvedThemeColor} />
                            <span title={goal?.title || 'No goal linked'}>
                                {goal?.title || 'No goal'}
                            </span>
                            <span className="kanban-card__meta-text" style={{ marginLeft: 'auto' }}>
                                {taskCount} task{taskCount === 1 ? '' : 's'}
                            </span>
                        </>
                    ) : (
                        <>
                            <BookOpen size={12} color={resolvedThemeColor} />
                            <span title={parentStory?.title || 'No parent story'}>
                                {parentStory?.title || 'No parent story'}
                            </span>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default KanbanCardV2;
