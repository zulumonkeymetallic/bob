import React, { useEffect, useRef, useState } from 'react';
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { Button, Modal, Spinner } from 'react-bootstrap';
import { GripVertical, Activity, Wand2, Edit3, Trash2, Target, BookOpen, Shuffle, CalendarClock } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../firebase';
import { Story, Task, Goal } from '../types';
import { useSidebar } from '../contexts/SidebarContext';
import { displayRefForEntity, validateRef } from '../utils/referenceGenerator';
import { colorWithAlpha, goalThemeColor } from '../utils/storyCardFormatting';
import { getPriorityBadge } from '../utils/statusHelpers';
import { themeVars } from '../utils/themeVars';
import type { GlobalTheme } from '../constants/globalThemes';
import { resolveThemeFromValue } from '../utils/themeResolver';
import { useAuth } from '../contexts/AuthContext';
import { addDoc, collection, serverTimestamp, updateDoc, doc, getDocs, query, where } from 'firebase/firestore';
import { ActivityStreamService } from '../services/ActivityStreamService';

interface KanbanCardV2Props {
    item: Story | Task;
    type: 'story' | 'task';
    goal?: Goal;
    story?: Story; // For tasks, the parent story
    taskCount?: number; // For stories
    themeColor?: string;
    themes?: GlobalTheme[];
    formatTag?: (tag: string) => string;
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
    themes,
    formatTag,
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
    const [flaggingPriority, setFlaggingPriority] = useState(false);
    const [showPriorityReplanPrompt, setShowPriorityReplanPrompt] = useState(false);
    const [priorityReplanLoading, setPriorityReplanLoading] = useState(false);

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

    const themeValue = (goal as any)?.theme ?? (goal as any)?.themeId ?? (goal as any)?.theme_id
        ?? (parentStory as any)?.theme ?? (parentStory as any)?.themeId ?? (parentStory as any)?.theme_id
        ?? (item as any)?.theme ?? (item as any)?.themeId ?? (item as any)?.theme_id;
    const resolvedTheme = resolveThemeFromValue(themeValue, themes);
    const resolvedThemeColor = themeColor || resolvedTheme?.color || goalThemeColor(goal, themes) || '#2563eb';

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

    const normalizeStatusValue = (rawStatus: any, entityType: 'story' | 'task') => {
        if (typeof rawStatus === 'number' && Number.isFinite(rawStatus)) return rawStatus;
        const status = String(rawStatus || '').toLowerCase();
        if (entityType === 'story') {
            if (['done', 'complete', 'completed', 'finished'].includes(status)) return 4;
            if (['testing', 'qa', 'review'].includes(status)) return 3;
            if (['in-progress', 'active', 'doing', 'blocked', 'in progress'].includes(status)) return 2;
            if (['planned', 'ready'].includes(status)) return 1;
            return 0;
        }
        if (['done', 'complete', 'completed', 'finished'].includes(status)) return 2;
        if (['blocked'].includes(status)) return 3;
        if (['in-progress', 'active', 'doing', 'in progress'].includes(status)) return 1;
        return 0;
    };

    const toDateInputValue = (value: number | null) => {
        if (!value) return '';
        const d = new Date(value);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };

    const isTop3 = (item as any).aiTop3ForDay === true
        || (item as any).aiFlaggedTop === true
        || Number((item as any).aiPriorityRank || 0) > 0
        || Number((item as any).aiFocusStoryRank || 0) > 0;
    const aiReason = isTop3 && (item as any).aiTop3Reason
        ? (item as any).aiTop3Reason
        : ((item as any).aiCriticalityReason || null);
    const dueDateMs = (() => {
        const raw = (item as any).dueDate ?? (item as any).targetDate ?? (item as any).dueDateMs ?? null;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
        if (raw?.toDate) return raw.toDate().getTime();
        const parsed = raw ? Date.parse(String(raw)) : NaN;
        return Number.isNaN(parsed) ? null : parsed;
    })();
    const [priorityValue, setPriorityValue] = useState<number>(Number((item as any).priority ?? 0));
    const [statusValue, setStatusValue] = useState<number>(normalizeStatusValue((item as any).status, type));
    const [dueInputValue, setDueInputValue] = useState<string>(toDateInputValue(dueDateMs));
    const [updatingField, setUpdatingField] = useState<'priority' | 'status' | 'dueDate' | null>(null);
    const priorityBadge = getPriorityBadge(priorityValue);
    const statusBadge = type === 'story'
        ? ({
            0: { bg: 'secondary', text: 'Backlog' },
            1: { bg: 'info', text: 'Planned' },
            2: { bg: 'primary', text: 'In progress' },
            3: { bg: 'warning', text: 'Testing' },
            4: { bg: 'success', text: 'Done' },
        } as Record<number, { bg: string; text: string }>)[statusValue] || { bg: 'secondary', text: 'Backlog' }
        : ({
            0: { bg: 'secondary', text: 'To do' },
            1: { bg: 'primary', text: 'Doing' },
            2: { bg: 'success', text: 'Done' },
            3: { bg: 'danger', text: 'Blocked' },
        } as Record<number, { bg: string; text: string }>)[statusValue] || { bg: 'secondary', text: 'To do' };

    useEffect(() => {
        setPriorityValue(Number((item as any).priority ?? 0));
        setStatusValue(normalizeStatusValue((item as any).status, type));
        setDueInputValue(toDateInputValue(dueDateMs));
    }, [item.id, (item as any).priority, (item as any).status, dueDateMs, type]);

    const applyQuickPatch = async (patch: Record<string, any>) => {
        const collectionName = type === 'story' ? 'stories' : 'tasks';
        await updateDoc(doc(db, collectionName, item.id), {
            ...patch,
            updatedAt: serverTimestamp(),
        });
    };

    const handlePriorityChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        event.stopPropagation();
        const previous = priorityValue;
        const next = Number(event.target.value);
        setPriorityValue(next);
        setUpdatingField('priority');
        try {
            await applyQuickPatch({ priority: next });
        } catch (error) {
            console.warn('Failed to update priority on kanban card', error);
            setPriorityValue(previous);
            setActionMessage('Priority update failed');
            setTimeout(() => setActionMessage(null), 2200);
        } finally {
            setUpdatingField(null);
        }
    };

    const handleStatusChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
        event.stopPropagation();
        const previous = statusValue;
        const next = Number(event.target.value);
        setStatusValue(next);
        setUpdatingField('status');
        try {
            await applyQuickPatch({ status: next });
        } catch (error) {
            console.warn('Failed to update status on kanban card', error);
            setStatusValue(previous);
            setActionMessage('Status update failed');
            setTimeout(() => setActionMessage(null), 2200);
        } finally {
            setUpdatingField(null);
        }
    };

    const handleDueDateChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        event.stopPropagation();
        const previous = dueInputValue;
        const next = event.target.value;
        setDueInputValue(next);
        setUpdatingField('dueDate');
        try {
            const dueMs = next ? new Date(`${next}T12:00:00`).getTime() : null;
            if (type === 'story') {
                await applyQuickPatch({ targetDate: dueMs });
            } else {
                await applyQuickPatch({ dueDate: dueMs });
            }
        } catch (error) {
            console.warn('Failed to update due date on kanban card', error);
            setDueInputValue(previous);
            setActionMessage('Due date update failed');
            setTimeout(() => setActionMessage(null), 2200);
        } finally {
            setUpdatingField(null);
        }
    };

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
    const macSyncedAt = toDate((item as any).macSyncedAt ?? (item as any).deviceUpdatedAt ?? (item as any).reminderCreatedAt ?? null);
    const macSyncLabel = macSyncedAt
        ? `${macSyncedAt.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${macSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
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

    const handleFlagPriorityStory = async (event: React.MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (!currentUser || type !== 'story') return;
        const story = item as Story;
        const storyPersona = String((story as any).persona || 'personal');
        setActionMessage(null);
        setFlaggingPriority(true);
        try {
            const storiesSnap = await getDocs(
                query(
                    collection(db, 'stories'),
                    where('ownerUid', '==', currentUser.uid)
                )
            );
            const existingFlagged = storiesSnap.docs
                .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
                .filter((s: any) => (
                    s.id !== story.id
                    && s.userPriorityFlag === true
                    && String(s.persona || 'personal') === storyPersona
                ));

            for (const flagged of existingFlagged) {
                await updateDoc(doc(db, 'stories', flagged.id), {
                    userPriorityFlag: false,
                    userPriorityFlagAt: null,
                    updatedAt: serverTimestamp(),
                });
            }

            const isAlreadyFlagged = (story as any).userPriorityFlag === true;
            await updateDoc(doc(db, 'stories', story.id), {
                userPriorityFlag: !isAlreadyFlagged,
                userPriorityFlagAt: isAlreadyFlagged ? null : new Date().toISOString(),
                updatedAt: serverTimestamp(),
            });

            if (!isAlreadyFlagged) {
                const rescore = httpsCallable(functions, 'deltaPriorityRescore');
                await rescore({ entityId: story.id, entityType: 'story' }).catch(() => { });
                setActionMessage('Marked as #1 priority');
                setShowPriorityReplanPrompt(true);
            } else {
                setActionMessage('Removed #1 priority');
            }
            setTimeout(() => setActionMessage(null), 2200);
        } catch (error) {
            console.warn('Failed to toggle #1 priority on kanban card', error);
            setActionMessage('Priority flag update failed');
            setTimeout(() => setActionMessage(null), 2200);
        } finally {
            setFlaggingPriority(false);
        }
    };

    const handlePriorityPromptReplanNow = async () => {
        setPriorityReplanLoading(true);
        try {
            const replan = httpsCallable(functions, 'replanCalendarNow');
            const response = await replan({ days: 7 });
            const payload = response.data as { rescheduled?: number; blocked?: number; created?: number };
            const parts: string[] = [];
            if (payload?.created) parts.push(`${payload.created} created`);
            if (payload?.rescheduled) parts.push(`${payload.rescheduled} moved`);
            if (payload?.blocked) parts.push(`${payload.blocked} blocked`);
            setActionMessage(parts.length ? `Delta replan complete: ${parts.join(', ')}` : 'Delta replan complete.');
            setShowPriorityReplanPrompt(false);
        } catch (error) {
            console.warn('Delta replan failed after #1 priority flag', error);
            setActionMessage('Delta replan failed');
        } finally {
            setPriorityReplanLoading(false);
            setTimeout(() => setActionMessage(null), 2400);
        }
    };

    return (
        <>
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
                        {type === 'story' && (
                            <Button
                                variant="link"
                                size="sm"
                                className="p-0"
                                style={{
                                    width: 24,
                                    height: 24,
                                    color: (item as any).userPriorityFlag ? 'var(--bs-danger)' : themeVars.muted,
                                    opacity: flaggingPriority ? 0.6 : 1,
                                }}
                                title={(item as any).userPriorityFlag ? 'Remove #1 priority flag' : 'Set as #1 priority'}
                                onClick={handleFlagPriorityStory}
                                onPointerDown={(e) => e.stopPropagation()}
                                disabled={flaggingPriority}
                            >
                                <CalendarClock size={12} />
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

                <div className="kanban-card__quick-edit">
                    <select
                        className="kanban-card__chip-select"
                        value={priorityValue}
                        onChange={handlePriorityChange}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={updatingField === 'priority'}
                        title="Priority"
                        style={{
                            backgroundColor: `var(--bs-${priorityBadge.bg})`,
                            color: priorityBadge.bg === 'warning' || priorityBadge.bg === 'orange' || priorityBadge.bg === 'light' ? '#000' : '#fff',
                        }}
                    >
                        <option value={0}>None</option>
                        <option value={1}>Low</option>
                        <option value={2}>Medium</option>
                        <option value={3}>High</option>
                        <option value={4}>Critical</option>
                    </select>
                    <input
                        type="date"
                        className="kanban-card__chip-date"
                        value={dueInputValue}
                        onChange={handleDueDateChange}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={updatingField === 'dueDate'}
                        title="Due date"
                    />
                    <select
                        className="kanban-card__chip-select"
                        value={statusValue}
                        onChange={handleStatusChange}
                        onClick={(e) => e.stopPropagation()}
                        onPointerDown={(e) => e.stopPropagation()}
                        disabled={updatingField === 'status'}
                        title="Status"
                        style={{
                            backgroundColor: `var(--bs-${statusBadge.bg})`,
                            color: statusBadge.bg === 'warning' || statusBadge.bg === 'light' ? '#000' : '#fff',
                        }}
                    >
                        {type === 'story' ? (
                            <>
                                <option value={0}>Backlog</option>
                                <option value={1}>Planned</option>
                                <option value={2}>In progress</option>
                                <option value={3}>Testing</option>
                                <option value={4}>Done</option>
                            </>
                        ) : (
                            <>
                                <option value={0}>To do</option>
                                <option value={1}>Doing</option>
                                <option value={3}>Blocked</option>
                                <option value={2}>Done</option>
                            </>
                        )}
                    </select>
                </div>

                {resolvedShowTags && visibleTags.length > 0 && (
                    <div className="kanban-card__tags">
                        {visibleTags.map((tag: string) => {
                            const formatted = formatTag ? formatTag(tag) : tag;
                            const display = formatted && String(formatted).trim().length > 0 ? formatted : tag;
                            const title = display !== tag ? `#${tag}` : undefined;
                            return (
                                <span key={tag} className="kanban-card__tag" title={title}>
                                    #{display}
                                </span>
                            );
                        })}
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
                <div className="kanban-card__meta">
                    {type === 'story' && (item as any).userPriorityFlag && (
                        <span
                            className="kanban-card__meta-badge"
                            style={{
                                borderColor: 'rgba(220, 53, 69, 0.45)',
                                backgroundColor: 'rgba(220, 53, 69, 0.12)',
                                color: 'var(--bs-danger)',
                            }}
                            title="User #1 priority flag"
                        >
                            #1 Priority
                        </span>
                    )}
                    {isTop3 && (
                        <span className="kanban-card__meta-badge kanban-card__meta-badge--top3" title="Top 3 priority">
                            Top 3
                        </span>
                    )}
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
                            {macSyncLabel && (
                                <span className="kanban-card__meta-text" style={{ marginLeft: 'auto' }}>
                                    Mac sync {macSyncLabel}
                                </span>
                            )}
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
        <Modal show={showPriorityReplanPrompt} onHide={() => setShowPriorityReplanPrompt(false)} centered>
            <Modal.Header closeButton>
                <Modal.Title style={{ fontSize: 16 }}>Run Delta Replan?</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p className="mb-2">
                    <strong>{(item as Story).title || 'This story'}</strong> is now flagged as #1 priority.
                </p>
                <p className="mb-0 text-muted small">
                    Run delta replan now to create or rebalance calendar blocks for the new priority.
                </p>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" size="sm" onClick={() => setShowPriorityReplanPrompt(false)}>
                    Not now
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    onClick={handlePriorityPromptReplanNow}
                    disabled={priorityReplanLoading}
                >
                    {priorityReplanLoading ? <Spinner animation="border" size="sm" className="me-1" /> : null}
                    Run delta replan
                </Button>
            </Modal.Footer>
        </Modal>
        </>
    );
};

export default KanbanCardV2;
