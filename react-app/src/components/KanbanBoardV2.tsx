import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ExternalLink, Target } from 'lucide-react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Story, Task, Goal, Sprint, CalendarBlock } from '../types';
import type { GlobalTheme } from '../constants/globalThemes';
import KanbanColumnV2 from './KanbanColumnV2';
import KanbanCardV2 from './KanbanCardV2';
import { themeVars } from '../utils/themeVars';
import { isStatus } from '../utils/statusHelpers';
import { statusValueForLane, storyLane, taskLane, type WorkLane } from '../utils/workStatus';
import { isCriticalPriority } from '../utils/priorityUtils';
import { getManualPriorityRank } from '../utils/manualPriority';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { formatTaskTagLabel } from '../utils/tagDisplay';
import { isGoalInHierarchySet } from '../utils/goalHierarchy';
import { compareTop3Stories, compareTop3Tasks, getEntityAiScore, isTop3Story, isTop3Task } from '../utils/top3';
import '../styles/KanbanCards.css';
import '../styles/KanbanFixes.css';

interface KanbanBoardV2Props {
    sprintId?: string | null;
    themeFilter?: number | number[] | null;
    goalFilter?: string | string[] | null;
    /** Case-insensitive title substring match — lets you find a specific story/task without
     * hunting through every theme/goal/status filter combination. */
    searchTerm?: string;
    onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
    onEdit?: (item: Story | Task, type: 'story' | 'task') => void;
    onParentClick?: (parentId: string, parentType: 'story' | 'goal') => void;
    showDescriptions?: boolean;
    showLatestNotes?: boolean;
    dueFilter?: 'all' | 'today' | 'overdue' | 'top3' | 'critical';
    sortBy?: 'ai' | 'due' | 'priority' | 'default';
    themes?: GlobalTheme[];
    focusOnly?: boolean;
    focusGoalIds?: Set<string>;
    showCompletedItems?: boolean;
    showAiScoredOnly?: boolean;
    showDelegatedOnly?: boolean;
    detailLevel?: 'full' | 'compact' | 'minimal';
    /** Goals become horizontal swimlanes: the goal on the left, its three status columns
     * beneath it. Off, the board is the flat three-column layout. Mirrors the iOS board's
     * `groupByGoal` (bob-ios KanbanBoardView.swift). */
    groupByGoal?: boolean;
}

interface ScheduledBlockInfo {
    id: string;
    start: number;
    end: number;
    title?: string;
    sourceNote?: string;
    matchConfidence?: number;
    matchConfidenceTier?: string;
}

const KanbanBoardV2: React.FC<KanbanBoardV2Props> = ({
    sprintId,
    themeFilter,
    goalFilter,
    searchTerm = '',
    onItemSelect,
    onEdit,
    onParentClick,
    showDescriptions = false,
    showLatestNotes = false,
    dueFilter = 'all',
    sortBy = 'default',
    themes,
    focusOnly = false,
    focusGoalIds = new Set(),
    showCompletedItems = false,
    showAiScoredOnly = false,
    showDelegatedOnly = false,
    detailLevel = 'full',
    groupByGoal = false,
    }) => {
    const { currentUser } = useAuth();
    const { currentPersona } = usePersona();
    const { sprints } = useSprint();
    const { trackFieldChange } = useActivityTracking();

    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [loading, setLoading] = useState(true);
    const [latestNotesById, setLatestNotesById] = useState<Record<string, string>>({});
    const [steamByAppId, setSteamByAppId] = useState<Record<string, any>>({});
    const [steamLastSyncAt, setSteamLastSyncAt] = useState<any>(null);
    const [scheduledBlocksByEntity, setScheduledBlocksByEntity] = useState<Record<string, ScheduledBlockInfo>>({});
    const formatTag = (tag: string) => formatTaskTagLabel(tag, goals, sprints);

    // Column scroll sync: hovering directly over a column's card list scrolls just that
    // column (native overflow behaviour below). Scrolling anywhere else on the board
    // (headers, gutters, background) scrolls every column together in lockstep.
    //
    // A callback ref is used (rather than useRef + a mount-only useEffect) because this
    // component renders a "Loading board..." placeholder — without the real wrapper div —
    // until data arrives; an effect with an empty dependency array would run once against
    // that placeholder's null ref and never re-attach once the real board mounts.
    const columnScrollEls = useRef<Map<string, HTMLDivElement>>(new Map());
    const wheelCleanupRef = useRef<(() => void) | null>(null);

    const registerColumnScrollEl = useCallback((status: string, el: HTMLDivElement | null) => {
        if (el) columnScrollEls.current.set(status, el);
        else columnScrollEls.current.delete(status);
    }, []);

    const boardWrapperRef = useCallback((node: HTMLDivElement | null) => {
        wheelCleanupRef.current?.();
        wheelCleanupRef.current = null;
        if (!node) return;
        const handleWheel = (e: WheelEvent) => {
            const target = e.target as HTMLElement | null;
            if (target?.closest('[data-kanban-column-body]')) return; // let the hovered column scroll itself
            const scrollable = Array.from(columnScrollEls.current.values()).filter((el) => el.scrollHeight > el.clientHeight);
            if (scrollable.length === 0) return;
            e.preventDefault();
            scrollable.forEach((el) => { el.scrollTop += e.deltaY; });
        };
        node.addEventListener('wheel', handleWheel, { passive: false });
        wheelCleanupRef.current = () => node.removeEventListener('wheel', handleWheel);
    }, []);

    // Data fetching
    useEffect(() => {
        if (!currentUser || !currentPersona) return;

        // Clear stale data immediately so old sprint items don't flash while new subscription loads
        setStories([]);
        setTasks([]);
        setLoading(true);

        // Goals
        const goalsQuery = query(
            collection(db, 'goals'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            orderBy('createdAt', 'desc'),
            limit(1000)
        );

        // Stories (respect active sprint filter when provided)
        const storiesQuery = sprintId
            ? query(
                collection(db, 'stories'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                where('sprintId', '==', sprintId),
                orderBy('createdAt', 'desc'),
                limit(1000)
            )
            : query(
                collection(db, 'stories'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                orderBy('createdAt', 'desc'),
                limit(1000)
            );

        // Tasks (using sprint_task_index)
        // Include completed tasks so Done column shows accurately; keep sprint filter when provided.
        let tasksQuery;
        if (sprintId) {
            tasksQuery = query(
                collection(db, 'sprint_task_index'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                where('sprintId', '==', sprintId),
                orderBy('dueDate', 'asc'),
                limit(1000)
            );
        } else {
            tasksQuery = query(
                collection(db, 'sprint_task_index'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                orderBy('dueDate', 'asc'),
                limit(1000)
            );
        }

        const unsubGoals = onSnapshot(goalsQuery, (snap) => {
            setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
        }, (err) => { console.error('[KanbanBoardV2] goals error', err?.message); });

        const unsubStories = onSnapshot(storiesQuery, (snap) => {
            setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
        }, (err) => { console.error('[KanbanBoardV2] stories error', err?.message); });

        const unsubTasks = onSnapshot(tasksQuery, (snap) => {
            setTasks(snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    ref: data.ref || `TASK-${d.id.slice(-4).toUpperCase()}`,
                } as Task;
            }));
            setLoading(false);
        }, (err) => { console.error('[KanbanBoardV2] tasks error', err?.message); setLoading(false); });

        return () => {
            unsubGoals();
            unsubStories();
            unsubTasks();
        };
    }, [currentUser, currentPersona, sprintId]);

    useEffect(() => {
        if (!currentUser) {
            setSteamByAppId({});
            setSteamLastSyncAt(null);
            return;
        }

        const steamQuery = query(
            collection(db, 'steam'),
            where('ownerUid', '==', currentUser.uid)
        );

        const unsubSteam = onSnapshot(steamQuery, (snap) => {
            const map: Record<string, any> = {};
            snap.docs.forEach((docSnap) => {
                const data = docSnap.data() as any;
                const appId = data.appid ?? data.steamAppId ?? data.externalId;
                if (appId != null) {
                    map[String(appId)] = { id: docSnap.id, ...data };
                }
            });
            setSteamByAppId(map);
        }, () => { setSteamByAppId({}); });

        const profileRef = doc(db, 'profiles', currentUser.uid);
        const unsubProfile = onSnapshot(profileRef, (snap) => {
            const data = snap.data() as any;
            setSteamLastSyncAt(data?.steamLastSyncAt ?? null);
        }, () => { setSteamLastSyncAt(null); });

        return () => {
            unsubSteam();
            unsubProfile();
        };
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser?.uid) {
            setScheduledBlocksByEntity({});
            return undefined;
        }

        const blocksQuery = query(
            collection(db, 'calendar_blocks'),
            where('ownerUid', '==', currentUser.uid),
            limit(2000)
        );

        return onSnapshot(
            blocksQuery,
            (snapshot) => {
                const now = Date.now();
                const windowEnd = now + (30 * 24 * 60 * 60 * 1000);
                const blocks = snapshot.docs
                    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }) as CalendarBlock)
                    .filter((block) => {
                        const start = Number(block.start);
                        const end = Number(block.end);
                        if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
                        if (end < now - 5 * 60 * 1000) return false;
                        if (start > windowEnd) return false;
                        const persona = String((block as any).persona || '').toLowerCase();
                        if (currentPersona && persona && persona !== String(currentPersona).toLowerCase()) return false;
                        return Boolean(block.storyId || block.taskId);
                    })
                    .sort((a, b) => Number(a.start) - Number(b.start));

                const nextMap: Record<string, ScheduledBlockInfo> = {};
                blocks.forEach((block) => {
                    const key = block.taskId
                        ? `task:${block.taskId}`
                        : (block.storyId ? `story:${block.storyId}` : null);
                    if (!key) return;
                    if (nextMap[key]) return;
                    const sourceRaw = String((block as any).calendarMatchSource || '').toLowerCase();
                    const sourceNote = (block as any).calendarMatchNote
                        || (sourceRaw === 'matched_user_created_calendar_event'
                            ? 'Matched user created calendar event'
                            : (sourceRaw === 'calendar_event_created_via_planner'
                                ? 'Calendar event created via planner'
                                : null));
                    nextMap[key] = {
                        id: block.id,
                        start: Number(block.start),
                        end: Number(block.end),
                        title: block.title,
                        sourceNote: sourceNote || undefined,
                        matchConfidence: Number((block as any).calendarMatchConfidence || 0) || undefined,
                        matchConfidenceTier: (block as any).calendarMatchConfidenceTier || undefined,
                    };
                });
                setScheduledBlocksByEntity(nextMap);
            },
            (error) => {
                console.warn('[KanbanBoardV2] scheduled blocks query error', error?.message || error);
                setScheduledBlocksByEntity({});
            }
        );
    }, [currentUser?.uid, currentPersona]);

    // Drag and Drop Monitor
    useEffect(() => {
        return monitorForElements({
            onDrop: async ({ source, location }) => {
                const destination = location.current.dropTargets[0];
                if (!destination) return;

                const itemId = source.data.id as string;
                const type = source.data.type as 'story' | 'task';
                const newStatus = destination.data.status as string;
                const boardSprintId = sprintId ?? null;

                // Optimistic update could go here, but for now we rely on Firestore listener

                try {
                    const collectionName = type === 'story' ? 'stories' : 'tasks';
                    const item = type === 'story' ? stories.find(s => s.id === itemId) : tasks.find(t => t.id === itemId);

                    if (!item) return;
                    const itemSprintId = (item as any).sprintId ?? null;
                    // If a sprint is selected, ignore drops for items outside that sprint
                    if (boardSprintId && itemSprintId && itemSprintId !== boardSprintId) {
                        return;
                    }

                    // Map column status to the canonical numeric value — see utils/workStatus.ts,
                    // the single source of truth shared with the triage table, the card status
                    // chips and the choice config. Stories 0/1/4, tasks 0/1/2; there is no
                    // Review lane. Docs that still hold a string status keep one.
                    const actualStatus: string | number = typeof (item as any).status === 'number'
                        ? statusValueForLane(newStatus as WorkLane, type)
                        : newStatus;

                    if ((item as any).status === actualStatus) return;

                    const updatePayload: any = {
                        status: actualStatus,
                        updatedAt: serverTimestamp()
                    };
                    if (boardSprintId) {
                        updatePayload.sprintId = boardSprintId;
                    }
                    // Completing a story should release its human-set order — a #1/#2/#3
                    // pin only makes sense for something still competing for scheduling.
                    if (type === 'story' && actualStatus === 4) {
                        updatePayload.userPriorityFlag = false;
                        updatePayload.userPriorityRank = null;
                        updatePayload.userPriorityFlagAt = null;
                    }

                    await updateDoc(doc(db, collectionName, itemId), updatePayload);

                    // Activity-stream tracking is best-effort — trackFieldChange already
                    // swallows its own errors internally, but keeping it in its own try/catch
                    // here too means a future change to that hook can never make a logging
                    // side-effect look like the drag itself failed.
                    try {
                        const oldLabel = String((item as any).status ?? '');
                        const newLabel = String(actualStatus);
                        await trackFieldChange(itemId, type, 'status', oldLabel, newLabel, (item as any).ref);
                    } catch (trackingError) {
                        console.warn('Kanban move succeeded but activity tracking failed', trackingError);
                    }

                } catch (error: any) {
                    // Surface the real cause instead of a dead-end generic message — this was
                    // previously just alert('Failed to move item'), which gave neither Jim nor
                    // whoever's debugging it any way to tell a permission error from a network
                    // blip from a stale-document race.
                    console.error('Failed to update item status', error);
                    const detail = error?.code || error?.message || 'Unknown error';
                    alert(`Failed to move item: ${detail}\n\nCheck the browser console for the full error — it's logged there too.`);
                }
            },
        });
    }, [stories, tasks, trackFieldChange, sprintId]);

    const getSteamAppId = (story: Story) => {
        const meta = (story as any)?.metadata || {};
        return meta.steamAppId ?? meta.appId ?? meta.steamId ?? (story as any).externalId ?? null;
    };

    const isSteamStory = (story: Story) => {
        const source = String((story as any).source || '').toLowerCase();
        const entry = String((story as any).entry_method || '').toLowerCase();
        return source === 'steam' || entry.includes('steam') || !!getSteamAppId(story);
    };

    // Filtering and Grouping

    const getTaskManualRank = (task: Task): number | null => {
        const directRank = getManualPriorityRank(task);
        if (directRank) return directRank;
        const parentStoryId = String(task.storyId || (task.parentType === 'story' ? task.parentId || '' : '')).trim();
        if (!parentStoryId) return null;
        return getManualPriorityRank(stories.find((story) => story.id === parentStoryId));
    };

    const isDoneStatus = (value: any, kind: 'story' | 'task'): boolean => {
        if (typeof value === 'number') return kind === 'story' ? value >= 4 : value >= 2;
        const normalized = String(value || '').trim().toLowerCase();
        return ['done', 'complete', 'completed', 'finished', 'closed', 'archived'].includes(normalized);
    };

    const getItemDueMs = (item: any): number | null => {
        const raw = item?.dueDate ?? item?.targetDate ?? item?.endDate ?? item?.dueDateMs ?? null;
        if (!raw) return null;
        if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
        if (typeof raw === 'object' && typeof raw?.toDate === 'function') {
            const d = raw.toDate();
            return d instanceof Date ? d.getTime() : null;
        }
        const parsed = Date.parse(String(raw));
        return Number.isNaN(parsed) ? null : parsed;
    };

    const matchesDueFilter = (item: any, isTop3: boolean): boolean => {
        if (dueFilter === 'all') return true;
        if (dueFilter === 'top3') return isTop3;
        if (dueFilter === 'critical') return isCriticalPriority(item?.priority);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date(todayStart);
        todayEnd.setHours(23, 59, 59, 999);
        const dueMs = getItemDueMs(item);
        if (!dueMs) return false;
        if (dueFilter === 'today') return dueMs >= todayStart.getTime() && dueMs <= todayEnd.getTime();
        if (dueFilter === 'overdue') return dueMs < todayStart.getTime();
        return true;
    };

    const EXCLUDED_TASK_TYPES = new Set(['chore', 'routine', 'habit', 'core', 'read', 'watch']);

    const filteredTasks = useMemo(() => {
        let result = tasks.filter(t => !EXCLUDED_TASK_TYPES.has(String((t as any).type || '').toLowerCase()));
        // Tasks are already filtered by query if sprintId is present,
        // but if sprintId changed rapidly, safety check:
        if (sprintId) {
            result = result.filter(t => t.sprintId === sprintId);
        }

        if (focusOnly && focusGoalIds.size > 0) {
            result = result.filter((t) => {
                const directGoalId = String((t as any).goalId || '').trim();
                if (directGoalId && isGoalInHierarchySet(directGoalId, goals, focusGoalIds)) return true;
                const parentStoryId = String(t.storyId || (t.parentType === 'story' ? t.parentId || '' : '')).trim();
                if (!parentStoryId) return false;
                const parentStory = stories.find((s) => s.id === parentStoryId);
                const parentGoalId = String((parentStory as any)?.goalId || '').trim();
                return !!parentGoalId && isGoalInHierarchySet(parentGoalId, goals, focusGoalIds);
            });
        }

        const goalIds = Array.isArray(goalFilter) ? goalFilter : goalFilter ? [goalFilter] : [];
        if (goalIds.length > 0) {
            result = result.filter(t => {
                const directGoalId = String((t as any).goalId || '').trim();
                if (directGoalId && isGoalInHierarchySet(directGoalId, goals, goalIds)) return true;
                const parentStoryId = String(t.storyId || (t.parentType === 'story' ? t.parentId || '' : '')).trim();
                if (!parentStoryId) return false;
                const s = stories.find((story) => story.id === parentStoryId);
                const storyGoalId = String((s as any)?.goalId || '').trim();
                return !!storyGoalId && isGoalInHierarchySet(storyGoalId, goals, goalIds);
            });
        }

        const themeIds = Array.isArray(themeFilter) ? themeFilter : themeFilter != null ? [themeFilter] : [];
        if (themeIds.length > 0) {
            const matchTheme = (v: any) => themeIds.includes(Number(v));
            result = result.filter(t => {
                if (matchTheme(t.theme)) return true;
                if (t.parentType === 'story' && t.parentId) {
                    const s = stories.find(s => s.id === t.parentId);
                    if (matchTheme(s?.theme)) return true;
                    const g = goals.find(g => g.id === s?.goalId);
                    return matchTheme(g?.theme);
                }
                if ((t as any).goalId) {
                    const g = goals.find(g => g.id === (t as any).goalId);
                    return matchTheme(g?.theme);
                }
                return false;
            });
        }

        // Done is always scoped to the selected sprint, never "everything ever finished".
        // The sprintId query filter alone was not enough: with no sprint selected the query
        // loads every sprint, and tasks come from sprint_task_index, a materialised mirror
        // that can carry rows whose sprintId has moved on. Confirmed by Jim, 2026-08-01 —
        // he was seeing other sprints' completed work in Done.
        if (!showCompletedItems) {
            result = result.filter((t) => !isDoneStatus((t as any).status, 'task'));
        } else {
            result = result.filter((t) => !isDoneStatus((t as any).status, 'task')
                || (!!sprintId && String((t as any).sprintId || '') === sprintId));
        }

        if (showAiScoredOnly) {
            result = result.filter((t) => Number.isFinite(getEntityAiScore(t)));
        }

        if (showDelegatedOnly) {
            result = result.filter((t) => (t as any).flaggedToAi === true);
        }

        result = result.filter((t) => matchesDueFilter(t, isTop3Task(t, getTaskManualRank)));

        const term = searchTerm.trim().toLowerCase();
        if (term) {
            result = result.filter((t) => String(t.title || '').toLowerCase().includes(term));
        }
        return result;
    }, [tasks, stories, goals, sprintId, goalFilter, themeFilter, dueFilter, focusOnly, focusGoalIds, showCompletedItems, showAiScoredOnly, showDelegatedOnly, searchTerm]);

    const filteredStories = useMemo(() => {
        let result = stories;
        if (sprintId) {
            result = result.filter(s => (s as any).sprintId === sprintId);
        }
        if (focusOnly && focusGoalIds.size > 0) {
            result = result.filter((s) => {
                const goalId = String((s as any).goalId || '').trim();
                return !!goalId && isGoalInHierarchySet(goalId, goals, focusGoalIds);
            });
        }

        const storyGoalIds = Array.isArray(goalFilter) ? goalFilter : goalFilter ? [goalFilter] : [];
        if (storyGoalIds.length > 0) {
            result = result.filter((s) => {
                const goalId = String((s as any).goalId || '').trim();
                return !!goalId && isGoalInHierarchySet(goalId, goals, storyGoalIds);
            });
        }
        const storyThemeIds = Array.isArray(themeFilter) ? themeFilter : themeFilter != null ? [themeFilter] : [];
        if (storyThemeIds.length > 0) {
            const matchTheme = (v: any) => storyThemeIds.includes(Number(v));
            result = result.filter(s => {
                if (matchTheme((s as any).theme)) return true;
                if ((s as any).goalId) {
                    const g = goals.find(g => g.id === (s as any).goalId);
                    return matchTheme(g?.theme);
                }
                return false;
            });
        }
        // Same sprint scoping as tasks above — Done shows this sprint's completed work only.
        if (!showCompletedItems) {
            result = result.filter((s) => !isDoneStatus((s as any).status, 'story'));
        } else {
            result = result.filter((s) => !isDoneStatus((s as any).status, 'story')
                || (!!sprintId && String((s as any).sprintId || '') === sprintId));
        }

        if (showAiScoredOnly) {
            result = result.filter((s) => Number.isFinite(getEntityAiScore(s)));
        }

        if (showDelegatedOnly) {
            result = result.filter((s) => (s as any).flaggedToAi === true);
        }

        result = result.filter((s) => matchesDueFilter(s, isTop3Story(s)));

        const term = searchTerm.trim().toLowerCase();
        if (term) {
            result = result.filter((s) => String(s.title || '').toLowerCase().includes(term));
        }
        return result;
    }, [stories, goals, sprintId, goalFilter, themeFilter, dueFilter, focusOnly, focusGoalIds, showCompletedItems, showAiScoredOnly, showDelegatedOnly, searchTerm]);

    const visibleEntityIds = useMemo(() => {
        const ids = new Set<string>();
        filteredStories.forEach((story) => ids.add(story.id));
        filteredTasks.forEach((task) => ids.add(task.id));
        return ids;
    }, [filteredStories, filteredTasks]);

    useEffect(() => {
        if (!showLatestNotes) {
            setLatestNotesById({});
            return;
        }
        const uid = currentUser?.uid;
        if (!uid || visibleEntityIds.size === 0) {
            setLatestNotesById({});
            return;
        }

        const queryLimit = Math.min(500, Math.max(50, visibleEntityIds.size * 3));
        const notesQuery = query(
            collection(db, 'activity_stream'),
            where('ownerUid', '==', uid),
            where('activityType', '==', 'note_added'),
            orderBy('timestamp', 'desc'),
            limit(queryLimit)
        );

        return onSnapshot(
            notesQuery,
            (snapshot) => {
                const next: Record<string, string> = {};
                snapshot.docs.forEach((docSnap) => {
                    const data = docSnap.data() as any;
                    const entityId = data.entityId || data.storyId || data.taskId;
                    if (!entityId || !visibleEntityIds.has(entityId)) return;
                    if (data.userId && data.userId !== uid) return;
                    const noteContent = typeof data.noteContent === 'string' ? data.noteContent.trim() : '';
                    if (!noteContent) return;
                    if (!next[entityId]) next[entityId] = noteContent;
                });
                setLatestNotesById(next);
            },
            (error) => {
                console.warn('[KanbanBoardV2] latest notes query error', error?.message || error);
                setLatestNotesById({});
            }
        );
    }, [showLatestNotes, currentUser?.uid, visibleEntityIds]);

    // Column placement is type-aware — the two numeric scales overlap (story 2 is the legacy
    // Review value and belongs In Progress; task 2 is Done). See utils/workStatus.ts.
    const getStoryColumn = (s: Story) => storyLane((s as any).status);
    const getTaskColumn = (t: Task) => taskLane((t as any).status);

    type ColumnKey = 'backlog' | 'in-progress' | 'done';

    const columns = {
        backlog: {
            title: 'Backlog',
            color: themeVars.muted,
            items: [] as (Story | Task)[]
        },
        'in-progress': {
            title: 'In Progress',
            color: themeVars.brand,
            items: [] as (Story | Task)[]
        },
        done: {
            title: 'Done',
            color: 'var(--green)',
            items: [] as (Story | Task)[]
        }
    };

    filteredStories.forEach(s => {
        const col = getStoryColumn(s);
        columns[col].items.push(s);
    });

    filteredTasks.forEach(t => {
        const col = getTaskColumn(t);
        columns[col].items.push(t);
    });

    const applySorting = () => {
        const scoreOf = (item: any) => {
            const score = Number(item.aiCriticalityScore ?? 0);
            return Number.isFinite(score) ? score : 0;
        };
        const dueMs = (item: any) => {
            const d = item.dueDate || item.targetDate || item.endDate || null;
            if (!d) return Number.MAX_SAFE_INTEGER;
            if (typeof d === 'number') return d;
            const parsed = Date.parse(d);
            return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
        };
        const priorityVal = (item: any) => {
            const p = Number(item.priority);
            return Number.isFinite(p) ? p : 0;
        };

        const sorter = (a: any, b: any) => {
            const aIsTask = tasks.some((task) => task.id === a.id);
            const bIsTask = tasks.some((task) => task.id === b.id);
            if (sortBy === 'default') {
                if (aIsTask && bIsTask) return compareTop3Tasks(a as Task, b as Task, getTaskManualRank);
                if (!aIsTask && !bIsTask) return compareTop3Stories(a as Story, b as Story);
            }
            const manualA = aIsTask ? getTaskManualRank(a as Task) : getManualPriorityRank(a);
            const manualB = bIsTask ? getTaskManualRank(b as Task) : getManualPriorityRank(b);
            if ((manualA || 99) !== (manualB || 99)) return (manualA || 99) - (manualB || 99);
            if (sortBy === 'ai') {
                const sa = scoreOf(a);
                const sb = scoreOf(b);
                if (sa !== sb) return sb - sa;
                return dueMs(a) - dueMs(b);
            }
            if (sortBy === 'due') {
                const da = dueMs(a);
                const db = dueMs(b);
                if (da !== db) return da - db;
                return scoreOf(b) - scoreOf(a);
            }
            if (sortBy === 'priority') {
                const pa = priorityVal(a);
                const pb = priorityVal(b);
                if (pa !== pb) return pb - pa;
                return dueMs(a) - dueMs(b);
            }
            return 0;
        };

        (Object.values(columns) as any[]).forEach(col => {
            col.items.sort(sorter);
        });
    };

    applySorting();

    // Swimlanes — one band per goal, mirroring the iOS board (KanbanBoardView.swift).
    // A task usually has no goalId of its own: it inherits one through its parent story,
    // so grouping on the raw field alone would file most of the board under Unassigned.
    const swimlanes = useMemo(() => {
        if (!groupByGoal) return [];

        const storiesById = new Map(stories.map((s) => [s.id, s]));
        const resolveGoalId = (item: Story | Task, type: 'story' | 'task'): string => {
            const direct = String((item as any).goalId || '').trim();
            if (direct) return direct;
            if (type === 'story') return '';
            const parentStoryId = String((item as any).storyId || (item as any).parentId || '').trim();
            if (!parentStoryId) return '';
            return String(storiesById.get(parentStoryId)?.goalId || '').trim();
        };

        const empty = (): Record<ColumnKey, (Story | Task)[]> => ({ 'backlog': [], 'in-progress': [], 'done': [] });
        const buckets = new Map<string, Record<ColumnKey, (Story | Task)[]>>();
        const push = (key: string, column: ColumnKey, item: Story | Task) => {
            if (!buckets.has(key)) buckets.set(key, empty());
            buckets.get(key)![column].push(item);
        };

        // Reuse the already-sorted column arrays so bands inherit the board's sort order.
        (Object.keys(columns) as ColumnKey[]).forEach((column) => {
            columns[column].items.forEach((item) => {
                const type = stories.some((s) => s.id === item.id) ? 'story' : 'task';
                const goalId = resolveGoalId(item, type);
                // A goalId that no longer resolves to a live goal falls in with the unassigned
                // rather than vanishing — work with no goal is still work.
                push(goals.some((g) => g.id === goalId) ? goalId : '', column, item);
            });
        });

        const bands = Array.from(buckets.entries()).map(([goalId, itemsByColumn]) => {
            const goal = goalId ? goals.find((g) => g.id === goalId) : undefined;
            return {
                id: goalId || '__unassigned__',
                goal,
                title: goal?.title || 'Unassigned',
                isFocus: !!goalId && focusGoalIds.has(goalId),
                itemsByColumn,
                count: (Object.values(itemsByColumn) as (Story | Task)[][]).reduce((n, list) => n + list.length, 0),
            };
        });

        // Focus goals first, then the rest by title, then Unassigned — and drop any band
        // whose items were all filtered out.
        return bands
            .filter((band) => band.count > 0)
            .sort((a, b) => {
                if (!a.goal !== !b.goal) return a.goal ? -1 : 1; // Unassigned always last
                if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
                return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
            });
    }, [groupByGoal, stories, goals, focusGoalIds, filteredStories, filteredTasks, sortBy]);

    const renderCard = (item: Story | Task) => {
        const type = stories.some(s => s.id === item.id) ? 'story' : 'task';

        let itemGoal: Goal | undefined;
        let parentStory: Story | undefined;
        let isFocusAligned = false;

        if (type === 'story') {
            itemGoal = goals.find(g => g.id === (item as any).goalId);
            const sGoalId = String((item as any).goalId || '').trim();
            if (sGoalId && focusGoalIds.size > 0) {
                isFocusAligned = isGoalInHierarchySet(sGoalId, goals, focusGoalIds);
            }
        } else {
            // Task
            parentStory = stories.find(s => s.id === (item as any).parentId);
            if (parentStory) {
                itemGoal = goals.find(g => g.id === parentStory.goalId);
                const pgId = String((parentStory as any).goalId || '').trim();
                if (pgId && focusGoalIds.size > 0) isFocusAligned = isGoalInHierarchySet(pgId, goals, focusGoalIds);
            } else if ((item as any).goalId) {
                itemGoal = goals.find(g => g.id === (item as any).goalId);
                const tgId = String((item as any).goalId || '').trim();
                if (tgId && focusGoalIds.size > 0) isFocusAligned = isGoalInHierarchySet(tgId, goals, focusGoalIds);
            }
        }

        let steamMeta: { playtimeMinutes?: number; lastPlayedAt?: number; lastSyncAt?: any; appId?: string | number } | undefined;
        if (type === 'story' && isSteamStory(item as Story)) {
            const appId = getSteamAppId(item as Story);
            if (appId != null) {
                const steamEntry = steamByAppId[String(appId)];
                if (steamEntry) {
                    steamMeta = {
                        appId,
                        playtimeMinutes: steamEntry.playtime_forever ?? steamEntry.playtimeForever ?? steamEntry.playtime ?? null,
                        lastPlayedAt: steamEntry.rtime_last_played ? steamEntry.rtime_last_played * 1000 : (steamEntry.last_played ? steamEntry.last_played * 1000 : null),
                        lastSyncAt: steamLastSyncAt ?? steamEntry.updatedAt ?? null
                    };
                } else {
                    steamMeta = {
                        appId,
                        lastSyncAt: steamLastSyncAt ?? null
                    };
                }
            }
        }

        return (
            <KanbanCardV2
                key={item.id}
                item={item}
                type={type}
                goal={itemGoal}
                story={parentStory}
                taskCount={type === 'story' ? tasks.filter(t => t.parentId === item.id).length : 0}
                onItemSelect={onItemSelect}
                showDescription={showDescriptions}
                showLatestNote={showLatestNotes}
                latestNote={latestNotesById[item.id]}
                scheduledBlock={scheduledBlocksByEntity[`${type}:${item.id}`]}
                steamMeta={steamMeta}
                onEdit={() => onEdit?.(item, type)}
                onParentClick={onParentClick}
                formatTag={formatTag}
                themes={themes}
                goals={goals}
                focusGoalIds={focusGoalIds}
                isFocusAligned={isFocusAligned}
                detailLevel={detailLevel}
            />
        );
    };

    // "Show completed" off hides the Done column entirely (not just its cards) so
    // Backlog/In Progress get the reclaimed width — matters most on iPad landscape,
    // where showCompletedItems defaults to false for exactly this reason. Confirmed
    // by Jim, 2026-07-24. Status can still be changed via a card's own status chip.
    const visibleColumnKeys = (Object.keys(columns) as ColumnKey[])
        .filter((key) => key !== 'done' || showCompletedItems);

    if (loading) {
        return <div>Loading board...</div>;
    }

    if (groupByGoal) {
        return (
            <div ref={boardWrapperRef} className="kanban-board-v2 kanban-board-v2--swimlanes" style={{ display: 'flex', flexDirection: 'column', gap: '20px', height: '100%', overflowY: 'auto', paddingBottom: '16px' }}>
                {swimlanes.length === 0 && (
                    <div style={{ color: themeVars.muted as string, fontSize: 13, padding: '32px 8px', textAlign: 'center' }}>
                        Nothing on the board for the current filters.
                    </div>
                )}
                {swimlanes.map((lane) => (
                    <div key={lane.id}>
                        {/* Goal band header — the goal on the left, its item count on the right */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 8px', flexWrap: 'wrap' }}>
                            {lane.goal ? (
                                <button
                                    type="button"
                                    onClick={() => onParentClick?.(lane.goal!.id, 'goal')}
                                    style={{
                                        display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent',
                                        border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text)',
                                        fontSize: 16, fontWeight: 600,
                                    }}
                                    title="Open goal"
                                >
                                    <Target size={13} />
                                    {lane.title}
                                    <ExternalLink size={11} />
                                </button>
                            ) : (
                                <span style={{ fontSize: 16, fontWeight: 600, color: themeVars.muted as string }}>{lane.title}</span>
                            )}
                            {lane.isFocus && (
                                <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 10, color: 'var(--orange, #fd7e14)', background: 'rgba(253, 126, 20, 0.14)' }}>
                                    Focus
                                </span>
                            )}
                            <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, color: themeVars.muted as string }}>{lane.count}</span>
                        </div>

                        {/* Columns inside a band do NOT scroll independently: the band is as tall
                            as its fullest column and the page scrolls. A vertical scroller per
                            cell would trap the outer gesture. Same rule as the iOS board. */}
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            {visibleColumnKeys.map((key) => (
                                <KanbanColumnV2
                                    key={key}
                                    status={key}
                                    scrollKey={`${lane.id}:${key}`}
                                    scrolls={false}
                                    title={columns[key].title}
                                    color={columns[key].color as string}
                                >
                                    {lane.itemsByColumn[key].map(renderCard)}
                                </KanbanColumnV2>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div ref={boardWrapperRef} className="kanban-board-v2" style={{ display: 'flex', gap: '16px', height: '100%', overflowX: 'auto', paddingBottom: '16px' }}>
            {visibleColumnKeys.map((key) => (
                <KanbanColumnV2 key={key} status={key} title={columns[key].title} color={columns[key].color as string} registerScrollEl={registerColumnScrollEl}>
                    {columns[key].items.map(renderCard)}
                </KanbanColumnV2>
            ))}
        </div>
    );
};

export default KanbanBoardV2;
