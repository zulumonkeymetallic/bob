import React, { useEffect, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Button } from 'react-bootstrap';
import { GripVertical, Activity, Wand2, Edit3, Trash2, Target, BookOpen, Shuffle } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../firebase';
import { Story, Task, Goal } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import { storyStatusText, taskStatusText, priorityLabel as formatPriorityLabel, priorityPillClass, colorWithAlpha, goalThemeColor } from '../utils/storyCardFormatting';
import { themeVars } from '../utils/themeVars';
import { useAuth } from '../contexts/AuthContext';
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { ActivityStreamService } from '../services/ActivityStreamService';

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
    showLatestNote?: boolean;
    showTags?: boolean;
    latestNote?: string;
    steamMeta?: {
        appId?: string | number;
        playtimeMinutes?: number | null;
        lastPlayedAt?: number | null;
        lastSyncAt?: any;
    };
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
    showLatestNote = false,
    latestNote,
    steamMeta,
    showTags,
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [dragging, setDragging] = useState(false);
    const { showSidebar } = useSidebar();
    const { currentUser } = useAuth();
    const [actionMessage, setActionMessage] = useState<string | null>(null);

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

    const isTop3 = (item as any).aiTop3ForDay === true
        || (item as any).aiFlaggedTop === true
        || Number((item as any).aiPriorityRank || 0) > 0
        || Number((item as any).aiFocusStoryRank || 0) > 0;
    const aiReason = isTop3 && (item as any).aiTop3Reason
        ? (item as any).aiTop3Reason
        : ((item as any).aiCriticalityReason || null);
    const priorityClass = isTop3 ? priorityPillClass(4) : priorityPillClass(item.priority);
    const priorityLabel = isTop3 ? 'Critical' : formatPriorityLabel(item.priority);
    const dueDateMs = (() => {
        const raw = (item as any).dueDate ?? (item as any).targetDate ?? (item as any).dueDateMs ?? null;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (raw?.toDate) return raw.toDate().getTime();
        const parsed = raw ? Date.parse(String(raw)) : NaN;
        return Number.isNaN(parsed) ? null : parsed;
    })();
    const dueDateLabel = dueDateMs
        ? new Date(dueDateMs).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' })
        : null;
    const overdueDays = dueDateMs && dueDateMs < Date.now()
        ? Math.max(1, Math.floor((Date.now() - dueDateMs) / 86400000))
        : 0;
    const notePreview = latestNote ? latestNote.replace(/\s+/g, ' ').trim() : '';
    const trimmedNote = notePreview.length > 140 ? `${notePreview.slice(0, 140)}...` : notePreview;
    const toDate = (value: any): Date | null => {
        if (!value) return null;
        if (typeof value?.toDate === 'function') return value.toDate();
        if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
        if (typeof value === 'number') return new Date(value);
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    };
    const steamPlaytimeMinutes = steamMeta?.playtimeMinutes ?? null;
    const steamPlaytimeHours = steamPlaytimeMinutes != null ? Math.round((steamPlaytimeMinutes / 60) * 10) / 10 : null;
    const steamSyncDate = toDate(steamMeta?.lastSyncAt);
    const steamSyncLabel = steamSyncDate ? steamSyncDate.toLocaleDateString() : null;
    const showSteamInfo = type === 'story' && steamMeta && (steamPlaytimeHours != null || steamSyncLabel);
    const reminderSyncedAt = toDate((item as any).deviceUpdatedAt || (item as any).reminderCreatedAt);
    const reminderSyncLabel = reminderSyncedAt
        ? `${reminderSyncedAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${reminderSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : null;
    const readKanbanTagPreference = () => {
        if (typeof window === 'undefined') return true;
        try {
            const stored = window.localStorage.getItem('kanbanShowTags');
            return stored ? stored === 'true' : true;
        } catch {
            return true;
        }
    };
    const resolvedShowTags = typeof showTags === 'boolean' ? showTags : readKanbanTagPreference();
    const itemTags = Array.isArray((item as any).tags) ? (item as any).tags : [];
    const visibleTags = itemTags.slice(0, 4);
    const remainingTags = itemTags.length - visibleTags.length;

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
            setActionMessage('Planning tasks…');
            setTimeout(() => setActionMessage(null), 2000);
        } catch (error) {
            alert((error as any)?.message || 'Failed to orchestrate story planning');
        }
    };

    const handleConvertTaskToStory = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        setActionMessage(null);
        try {
            const suggest = httpsCallable(functions, 'suggestTaskStoryConversions');
            const convert = httpsCallable(functions, 'convertTasksToStories');

            const suggestionResp: any = await suggest({
                persona: (item as any).persona || 'personal',
                taskIds: [item.id],
                limit: 1
            });
            const suggestions: any[] = Array.isArray(suggestionResp?.data?.suggestions) ? suggestionResp.data.suggestions : [];
            const suggestion = suggestions.find(s => s.taskId === item.id) || suggestions[0] || {};

            const storyTitle = (suggestion?.storyTitle || item.title || 'Converted task').slice(0, 140);
            const storyDescription = (suggestion?.storyDescription || (item as any).description || '').slice(0, 1200);
            const goalId = suggestion?.goalId || (item as any).goalId || (parentStory as any)?.goalId || null;

            const resp: any = await convert({
                conversions: [{
                    taskId: item.id,
                    storyTitle,
                    storyDescription,
                    goalId
                }]
            });

            const created = (resp?.data?.created || resp?.data?.stories || resp?.data?.results || [])[0] || {};
            const newStoryId = created.storyId || created.id || null;
            const newStoryRef = created.storyRef || created.ref || created.reference || null;

            // Close the task locally
            try {
                await updateDoc(doc(db, 'tasks', item.id), {
                    status: 2,
                    convertedToStoryId: newStoryId || null,
                    updatedAt: serverTimestamp(),
                });
            } catch (e) {
                console.warn('Failed to close task after conversion', e);
            }

            // Activity stream entry
            if (currentUser) {
                const desc = `Converted to story ${newStoryRef || newStoryId || ''}`.trim();
                await ActivityStreamService.addActivity({
                    entityId: item.id,
                    entityType: 'task',
                    activityType: 'task_to_story_conversion',
                    userId: currentUser.uid,
                    userEmail: currentUser.email || undefined,
                    description: desc || 'Converted to story',
                    persona: (item as any).persona || 'personal',
                    referenceNumber: (item as any).ref,
                    source: 'human'
                } as any);
                if (newStoryId) {
                    await ActivityStreamService.addActivity({
                        entityId: newStoryId,
                        entityType: 'story',
                        activityType: 'task_to_story_conversion',
                        userId: currentUser.uid,
                        userEmail: currentUser.email || undefined,
                        description: `Created from task ${(item as any).ref || item.id}`,
                        persona: (item as any).persona || 'personal',
                        referenceNumber: newStoryRef || undefined,
                        source: 'human'
                    } as any);
                }
            }

            setActionMessage('Converted to story');
            setTimeout(() => setActionMessage(null), 2500);
        } catch (err: any) {
            alert(err?.message || 'Convert failed');
        }
    };

    const handleConvertStoryToTask = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!currentUser) {
            alert('Sign in required');
            return;
        }
        setActionMessage(null);
        try {
            const story = item as Story;
            const payload: any = {
                ownerUid: currentUser.uid,
                title: story.title || 'Converted story',
                description: story.description || '',
                status: 0,
                storyId: story.id,
                sprintId: (story as any).sprintId || null,
                goalId: (story as any).goalId || null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                persona: (story as any).persona || 'personal',
              };
            await addDoc(collection(db, 'tasks'), payload);
            setActionMessage('Converted to task');
            setTimeout(() => setActionMessage(null), 2500);
        } catch (err: any) {
            alert(err?.message || 'Convert failed');
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
                        {type === 'task' && (
                            <Button
                                variant="link"
                                size="sm"
                                className="p-0"
                                style={{ width: 24, height: 24, color: themeVars.muted }}
                                title="Convert to story"
                                onClick={handleConvertTaskToStory}
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                <Wand2 size={12} />
                            </Button>
                        )}
                        {type === 'story' && (
                            <Button
                                variant="link"
                                size="sm"
                                className="p-0"
                                style={{ width: 24, height: 24, color: themeVars.muted }}
                                title="Convert to task"
                                onClick={handleConvertStoryToTask}
                                onPointerDown={(e) => e.stopPropagation()}
                            >
                                <Shuffle size={12} />
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
                {resolvedShowTags && visibleTags.length > 0 && (
                    <div className="kanban-card__tags">
                        {visibleTags.map((tag: string) => (
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
                {showLatestNote && trimmedNote && (
                    <div className="kanban-card__note">
                        <span className="kanban-card__note-label">Last note:</span>{' '}
                        {trimmedNote}
                    </div>
                )}
                {showSteamInfo && (
                    <div className="kanban-card__steam">
                        <span className="kanban-card__steam-label">Steam</span>
                        <span>{steamPlaytimeHours != null ? ` ${steamPlaytimeHours}h` : ' —'}</span>
                        {steamSyncLabel && (
                            <span className="kanban-card__steam-muted"> · synced {steamSyncLabel}</span>
                        )}
                    </div>
                )}
                {(item as any).reminderId && reminderSyncLabel && (
                    <div className="kanban-card__steam" style={{ justifyContent: 'flex-end' }}>
                        <span className="kanban-card__steam-label">Reminder sync</span>
                        <span className="kanban-card__steam-muted"> · {reminderSyncLabel}</span>
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
                    {dueDateLabel && (
                        <span className="kanban-card__meta-badge" title="Due date">
                            Due {dueDateLabel}
                        </span>
                    )}
                    <span className="kanban-card__meta-badge" title="Status">
                        {statusLabel}
                    </span>
                    {overdueDays > 0 && (
                        <span className="kanban-card__meta-badge" style={{ color: 'var(--red)' }} title="Overdue">
                            {overdueDays}d overdue
                        </span>
                    )}
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
                    {(item as any).aiCriticalityScore != null ? (
                        <span className="kanban-card__meta-badge" title={aiReason ? `AI reason: ${aiReason}` : 'AI score'}>
                            AI&nbsp;
                            {Math.round(Number((item as any).aiCriticalityScore))}
                        </span>
                    ) : null}
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
            {actionMessage && (
                <div className="kanban-card__meta-text text-muted small px-3 pb-2">
                    {actionMessage}
                </div>
            )}
        </div>
    );
};

export default KanbanCardV2;
