import React, { useEffect, useState, useMemo } from 'react';
import { monitorForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Story, Task, Goal, Sprint } from '../types';
import type { GlobalTheme } from '../constants/globalThemes';
import KanbanColumnV2 from './KanbanColumnV2';
import KanbanCardV2 from './KanbanCardV2';
import { themeVars } from '../utils/themeVars';
import { isStatus } from '../utils/statusHelpers';
import { isCriticalPriority } from '../utils/priorityUtils';
import { useActivityTracking } from '../hooks/useActivityTracking';
import { formatTaskTagLabel } from '../utils/tagDisplay';
import '../styles/KanbanCards.css';
import '../styles/KanbanFixes.css';

interface KanbanBoardV2Props {
    sprintId?: string | null;
    themeFilter?: number | null;
    goalFilter?: string | null;
    onItemSelect?: (item: Story | Task, type: 'story' | 'task') => void;
    onEdit?: (item: Story | Task, type: 'story' | 'task') => void;
    showDescriptions?: boolean;
    showLatestNotes?: boolean;
    dueFilter?: 'all' | 'today' | 'overdue' | 'top3' | 'critical';
    sortBy?: 'ai' | 'due' | 'priority' | 'default';
    themes?: GlobalTheme[];
}

const KanbanBoardV2: React.FC<KanbanBoardV2Props> = ({
    sprintId,
    themeFilter,
    goalFilter,
    onItemSelect,
    onEdit,
    showDescriptions = false,
    showLatestNotes = false,
    dueFilter = 'all',
    sortBy = 'ai',
    themes
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
    const formatTag = (tag: string) => formatTaskTagLabel(tag, goals, sprints);

    // Data fetching
    useEffect(() => {
        if (!currentUser || !currentPersona) return;

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
        });

        const unsubStories = onSnapshot(storiesQuery, (snap) => {
            setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
        });

        const unsubTasks = onSnapshot(tasksQuery, (snap) => {
            setTasks(snap.docs.map(d => {
                const data = d.data();
                return {
                    id: d.id,
                    ...data,
                    // Ensure required fields for Task type
                    ref: data.ref || `TASK-${d.id.slice(-4).toUpperCase()}`,
                } as Task;
            }));
            setLoading(false);
        });

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
        });

        const profileRef = doc(db, 'profiles', currentUser.uid);
        const unsubProfile = onSnapshot(profileRef, (snap) => {
            const data = snap.data() as any;
            setSteamLastSyncAt(data?.steamLastSyncAt ?? null);
        });

        return () => {
            unsubSteam();
            unsubProfile();
        };
    }, [currentUser]);

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

                    // Map column status to actual status value
                    let actualStatus: string | number = newStatus;

                    // If the item uses numeric status, map it
                    if (typeof (item as any).status === 'number') {
                        if (newStatus === 'backlog') actualStatus = 0;
                        else if (newStatus === 'in-progress') actualStatus = type === 'story' ? 2 : 1;
                        else if (newStatus === 'done') actualStatus = type === 'story' ? 4 : 2;
                    } else {
                        // String status
                        actualStatus = newStatus;
                    }

                    if ((item as any).status === actualStatus) return;

                    const updatePayload: any = {
                        status: actualStatus,
                        updatedAt: serverTimestamp()
                    };
                    if (boardSprintId) {
                        updatePayload.sprintId = boardSprintId;
                    }

                    await updateDoc(doc(db, collectionName, itemId), updatePayload);

                    // Track change
                    const oldLabel = String((item as any).status ?? '');
                    const newLabel = String(actualStatus);
                    await trackFieldChange(itemId, type, 'status', oldLabel, newLabel, (item as any).ref);

                } catch (error) {
                    console.error('Failed to update item status', error);
                    alert('Failed to move item');
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

    const isTop3Task = (task: Task): boolean => {
        return (task as any).aiTop3ForDay === true
            || (task as any).aiFlaggedTop === true
            || Number((task as any).aiPriorityRank || 0) > 0;
    };

    const isTop3Story = (story: Story): boolean => {
        return (story as any).aiTop3ForDay === true
            || Number((story as any).aiFocusStoryRank || 0) > 0;
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

    const filteredTasks = useMemo(() => {
        let result = tasks;
        // Tasks are already filtered by query if sprintId is present, 
        // but if sprintId changed rapidly, safety check:
        if (sprintId) {
            result = result.filter(t => t.sprintId === sprintId);
        }

        if (goalFilter) {
            // Filter tasks by goal. Tasks might have goalId or be linked to a story with goalId.
            result = result.filter(t => {
                if ((t as any).goalId === goalFilter) return true;
                if (t.parentType === 'story' && t.parentId) {
                    const s = stories.find(s => s.id === t.parentId);
                    return s?.goalId === goalFilter;
                }
                return false;
            });
        }

        if (themeFilter) {
            result = result.filter(t => {
                if (t.theme === themeFilter) return true;
                // Check parent story -> goal -> theme
                if (t.parentType === 'story' && t.parentId) {
                    const s = stories.find(s => s.id === t.parentId);
                    if (s?.theme === themeFilter) return true;
                    const g = goals.find(g => g.id === s?.goalId);
                    return g?.theme === themeFilter;
                }
                // Check direct goal link
                if ((t as any).goalId) {
                    const g = goals.find(g => g.id === (t as any).goalId);
                    return g?.theme === themeFilter;
                }
                return false;
            });
        }

        result = result.filter((t) => matchesDueFilter(t, isTop3Task(t)));
        return result;
    }, [tasks, stories, goals, sprintId, goalFilter, themeFilter, dueFilter]);

    const filteredStories = useMemo(() => {
        let result = stories;
        if (sprintId) {
            result = result.filter(s => (s as any).sprintId === sprintId);
        }
        if (goalFilter) {
            result = result.filter(s => (s as any).goalId === goalFilter);
        }
        if (themeFilter) {
            result = result.filter(s => {
                if ((s as any).theme === themeFilter) return true;
                if ((s as any).goalId) {
                    const g = goals.find(g => g.id === (s as any).goalId);
                    return g?.theme === themeFilter;
                }
                return false;
            });
        }
        result = result.filter((s) => matchesDueFilter(s, isTop3Story(s)));
        return result;
    }, [stories, goals, sprintId, goalFilter, themeFilter, dueFilter]);

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

    // Helper to determine column for an item
    const getColumnForStatus = (status: string | number): 'backlog' | 'in-progress' | 'done' => {
        if (typeof status === 'number') {
            if (status >= 4) return 'done'; // Story done
            if (status === 2 || status === 3) return 'in-progress'; // Story active/testing or Task done(2) wait.. task done is 2?
            // Let's check ModernKanbanBoard logic
            // Story: 0=backlog, 1=ready, 2=active, 3=testing, 4=done
            // Task: 0=backlog, 1=active, 2=done, 3=blocked

            // Wait, if I pass a task with status 2 (done), it should go to done.
            // If I pass a story with status 2 (active), it goes to in-progress.

            // I need to know the type to be precise, but let's try to infer or pass type.
            // Actually, I process stories and tasks separately below.
            return 'backlog';
        }

        const s = String(status).toLowerCase();
        if (['done', 'complete', 'completed', 'finished'].includes(s)) return 'done';
        if (['in-progress', 'active', 'doing', 'testing', 'qa', 'review', 'blocked'].includes(s)) return 'in-progress';
        return 'backlog';
    };

    const getStoryColumn = (s: Story) => {
        const raw = (s as any).status;
        const status = (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : raw;
        if (typeof status === 'number') {
            if (status >= 4) return 'done';
            if (status >= 1) return 'in-progress'; // 1=ready, 2=active, 3=testing.
            return 'backlog';
        }
        return getColumnForStatus(status);
    };

    const getTaskColumn = (t: Task) => {
        const raw = (t as any).status;
        const status = (typeof raw === 'string' && /^\d+$/.test(raw)) ? Number(raw) : raw;
        if (typeof status === 'number') {
            if (status === 2 || status === 4) return 'done';
            if (status === 1 || status === 3) return 'in-progress'; // 1=active, 3=blocked
            return 'backlog';
        }
        return getColumnForStatus(status);
    };

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

    if (loading) {
        return <div>Loading board...</div>;
    }

    return (
        <div className="kanban-board-v2" style={{ display: 'flex', gap: '16px', height: '100%', overflowX: 'auto', paddingBottom: '16px' }}>
            {Object.entries(columns).map(([key, col]) => (
                <KanbanColumnV2 key={key} status={key} title={col.title} color={col.color as string}>
                    {col.items.map(item => {
                        const isStory = 'points' in item || (item as any).storyId === undefined; // Rough check, better to check ID or something
                        // Actually, my Task type has storyId, Story doesn't (usually). 
                        // Better: check if it's in the stories array
                        const type = stories.some(s => s.id === item.id) ? 'story' : 'task';

                        let itemGoal: Goal | undefined;
                        let parentStory: Story | undefined;

                        if (type === 'story') {
                            itemGoal = goals.find(g => g.id === (item as any).goalId);
                        } else {
                            // Task
                            parentStory = stories.find(s => s.id === (item as any).parentId);
                            if (parentStory) {
                                itemGoal = goals.find(g => g.id === parentStory.goalId);
                            } else if ((item as any).goalId) {
                                itemGoal = goals.find(g => g.id === (item as any).goalId);
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
                                steamMeta={steamMeta}
                                onEdit={() => onEdit?.(item, type)}
                                formatTag={formatTag}
                                themes={themes}
                            />
                        );
                    })}
                </KanbanColumnV2>
            ))}
        </div>
    );
};

export default KanbanBoardV2;
