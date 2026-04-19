import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Gantt } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/all.css';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase';
import { Goal, Story, Sprint } from '../../types';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { migrateThemeValue } from '../../constants/globalThemes';
import { isStatus } from '../../utils/statusHelpers';
import EditGoalModal from '../../components/EditGoalModal';
import './GoalRoadmapV4.css';

interface GanttTask {
    id: string | number;
    text: string;
    start: Date;
    end?: Date;
    duration: number;
    parent?: string | number;
    progress: number;
    type?: string;
    // Custom fields
    theme?: number;
    themeColor?: string;
    estimatedCost?: number;
    storyPoints?: number;
    pointsPct?: number;
    totalPoints?: number;
    financePct?: number;
    hasFinance?: boolean;
    recentNote?: string;
    isThemeGroup?: boolean;
    open?: boolean;
}

const DAY_MS = 86400000;
// Feature gate to avoid permission errors on collections the user cannot read
const ENABLE_ACTIVITY_STREAM = process.env.REACT_APP_ENABLE_ACTIVITY_STREAM === 'true';

// Helper to convert Firestore Timestamp to milliseconds
function toMillis(val: any): number | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === 'number') return isNaN(val) ? undefined : val;
    if (val instanceof Date) return isNaN(val.getTime()) ? undefined : val.getTime();
    if (typeof val.toDate === 'function') {
        const d = val.toDate();
        return isNaN(d.getTime()) ? undefined : d.getTime();
    }
    if (typeof val.toMillis === 'function') return val.toMillis();
    if (typeof val === 'string') {
        const d = new Date(val);
        return isNaN(d.getTime()) ? undefined : d.getTime();
    }
    return undefined;
}

const GoalRoadmapV4: React.FC = () => {
    const { currentUser } = useAuth();
    const { theme } = useTheme();
    const { themes: globalThemes } = useGlobalThemes();

    const [goals, setGoals] = useState<Goal[]>([]);
    const [stories, setStories] = useState<Story[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [loading, setLoading] = useState(true);

    // Additional Data States
    const [storyPoints, setStoryPoints] = useState<Record<string, number>>({});
    const [storyDonePoints, setStoryDonePoints] = useState<Record<string, number>>({});
    const [potBalances, setPotBalances] = useState<Record<string, { balance: number; currency: string }>>({});
    const [lastNotes, setLastNotes] = useState<Record<string, string>>({});

    const [editGoal, setEditGoal] = useState<Goal | null>(null);

    // Subscribe to goals
    useEffect(() => {
        if (!currentUser?.uid) return;
        console.log('[RoadmapV4] Subscribing to goals for user:', currentUser.uid);
        const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
            console.log('[RoadmapV4] Goals fetched:', data.length);
            setGoals(data);
            setLoading(false);
        }, error => {
            console.error('[RoadmapV4] Error fetching goals:', error);
            setLoading(false);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    // Subscribe to stories (aggregated)
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Story));
            console.log('[RoadmapV4] Stories fetched:', data.length);
            setStories(data);

            const points: Record<string, number> = {};
            const donePoints: Record<string, number> = {};

            for (const story of data) {
                const gid = story.goalId as string | undefined;
                if (gid) {
                    const pts = Number(story.points || 0);
                    points[gid] = (points[gid] || 0) + pts;
                    if (isStatus(story.status as any, 'done')) {
                        donePoints[gid] = (donePoints[gid] || 0) + pts;
                    }
                }
            }
            setStoryPoints(points);
            setStoryDonePoints(donePoints);
        }, error => {
            console.error('[RoadmapV4] Error fetching stories:', error);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    // Subscribe to sprints
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Sprint));
            console.log('[RoadmapV4] Sprints fetched:', data.length);
            setSprints(data);
        }, error => {
            console.error('[RoadmapV4] Error fetching sprints:', error);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    // Subscribe to Monzo pots
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            console.log('[RoadmapV4] Monzo pots fetched:', snap.size);
            const map: Record<string, { balance: number; currency: string }> = {};
            snap.docs.forEach(d => {
                const data = d.data();
                map[d.id] = { balance: Number(data.balance || 0) / 100, currency: data.currency || 'GBP' };
            });
            setPotBalances(map);
        }, error => {
            console.error('[RoadmapV4] Error fetching monzo_pots:', error);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    // Subscribe to Activity Stream for latest notes (opt-in; Firestore rules may block list)
    useEffect(() => {
        if (!ENABLE_ACTIVITY_STREAM) return;
        if (!currentUser?.uid) return;
        try {
            const q = query(
                collection(db, 'activity_stream'),
                where('ownerUid', '==', currentUser.uid),
                orderBy('timestamp', 'desc'),
                limit(300)
            );
            const unsub = onSnapshot(q, (snap) => {
                console.log('[RoadmapV4] Activity stream fetched:', snap.size);
                const map: Record<string, string> = {};
                for (const d of snap.docs) {
                    const data = d.data() as any;
                    if (data.entityType !== 'goal') continue;
                    if (data.activityType !== 'note_added') continue;
                    const gid = data.entityId as string;
                    if (!gid || map[gid]) continue;
                    if (data.noteContent) {
                        map[gid] = String(data.noteContent);
                    }
                }
                setLastNotes(map);
            }, error => {
                if ((error as any)?.code === 'permission-denied') {
                    console.warn('[RoadmapV4] activity_stream read blocked by rules; skipping notes', { uid: currentUser?.uid });
                    return;
                }
                console.error('[RoadmapV4] Error fetching activity_stream:', error);
            });
            return () => unsub();
        } catch (error) {
            console.error('[RoadmapV4] Failed to init activity_stream listener', error);
        }
    }, [currentUser?.uid]);

    const { tasks: ganttTasks, chartStart, chartEnd } = useMemo<{
        tasks: GanttTask[];
        chartStart: Date;
        chartEnd: Date;
    }>(() => {
        console.log('[RoadmapV4] Transforming goals...', goals.length);
        const goalTasks: GanttTask[] = [];
        const themeGroups = new Set<string>();
        const themeRanges = new Map<string, { start: Date; end: Date }>();
        let globalStart: Date | null = null;
        let globalEnd: Date | null = null;

        // Transform goals to SVAR Gantt format
        goals.forEach(goal => {
            const startMs = toMillis(goal.startDate);
            const endMs = toMillis(goal.endDate);

            // Ensure valid dates, fallback to now/future if missing
            let startDate = startMs ? new Date(startMs) : new Date();
            let endDate = endMs ? new Date(endMs) : new Date(Date.now() + 90 * DAY_MS);

            // Skip goals with invalid dates
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
                console.warn('[RoadmapV4] Skipping goal due to invalid dates:', goal.title, goal.startDate, goal.endDate);
                return;
            }

            const themeId = migrateThemeValue(goal.theme);
            const themeDef = globalThemes.find(t => t.id === themeId);
            const themeKey = `theme-${themeId}`;
            themeGroups.add(themeKey);

            // Calculate progress from stories
            const goalStories = stories.filter(s => s.goalId === goal.id);
            const doneStories = goalStories.filter(s => isStatus(s.status as any, 'done'));
            const progress = goalStories.length > 0 ? doneStories.length / goalStories.length : 0;

            // Calculate Story Points Progress
            const totalPts = storyPoints[goal.id] || 0;
            const donePts = storyDonePoints[goal.id] || 0;
            const pointsPct = totalPts > 0 ? Math.round((donePts / totalPts) * 100) : 0;

            // Calculate Finance Progress
            let financePct = 0;
            let hasFinance = false;
            if (goal.potId && potBalances[goal.potId] && goal.estimatedCost) {
                const potBalance = potBalances[goal.potId].balance;
                const target = goal.estimatedCost;
                financePct = target > 0 ? Math.round((potBalance / target) * 100) : 0;
                hasFinance = true;
            }

            const duration = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS));

            // Track min/max per theme so we can size the summary row
            const existingRange = themeRanges.get(themeKey);
            if (!existingRange) {
                themeRanges.set(themeKey, { start: startDate, end: endDate });
            } else {
                if (startDate < existingRange.start) existingRange.start = startDate;
                if (endDate > existingRange.end) existingRange.end = endDate;
            }

            // Track global min/max for chart window
            if (!globalStart || startDate < globalStart) globalStart = startDate;
            if (!globalEnd || endDate > globalEnd) globalEnd = endDate;

            goalTasks.push({
                id: goal.id,
                text: goal.title || 'Untitled Goal',
                start: startDate,
                end: endDate,
                duration: isNaN(duration) ? 1 : duration,
                parent: themeKey, // Group by Theme ID (String)
                progress,
                type: 'task',
                theme: themeId,
                themeColor: themeDef?.color || '#3b82f6',
                estimatedCost: goal.estimatedCost,
                storyPoints: totalPts,
                pointsPct,
                totalPoints: totalPts,
                financePct,
                hasFinance,
                recentNote: lastNotes[goal.id] || (goal as any).recentNote,
                open: true
            });
        });

        // Create Theme Group Tasks
        const themeTasks: GanttTask[] = [];
        Array.from(themeGroups).forEach(themeKey => {
            const themeId = parseInt(themeKey.replace('theme-', ''), 10) || 0;
            const themeDef = globalThemes.find(t => t.id === themeId);
            const range = themeRanges.get(themeKey);
            const start = range?.start || new Date();
            const end = range?.end || new Date(Date.now() + DAY_MS);
            const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
            themeTasks.push({
                id: themeKey, // String ID
                text: themeDef?.name || `Theme ${themeId}`,
                start,
                end,
                duration,
                type: 'summary',
                theme: themeId,
                themeColor: themeDef?.color || '#3b82f6',
                isThemeGroup: true,
                progress: 0,
                open: true
            } as any);
        });

        // Parents first, then goals to avoid parent-missing drops
        const tasks = [...themeTasks, ...goalTasks];
        const chartStartDate = globalStart || new Date();
        const chartEndDate = globalEnd || new Date(Date.now() + 90 * DAY_MS);
        console.log('[RoadmapV4] Generated Gantt tasks:', tasks.length);
        if (tasks.length > 0) {
            console.log('[RoadmapV4] Sample task:', tasks[0]);
            console.log('[RoadmapV4] Sample theme group:', tasks.find(t => t.isThemeGroup));
        }

        return { tasks, chartStart: chartStartDate, chartEnd: chartEndDate };
    }, [goals, stories, globalThemes, storyPoints, storyDonePoints, potBalances, lastNotes]);

    const [zoomLevel, setZoomLevel] = useState<'year' | 'month' | 'week' | 'quarter'>('month');

    const scales = useMemo(() => {
        switch (zoomLevel) {
            case 'year':
                return [
                    { unit: 'year', step: 1, format: 'yyyy' }
                ];
            case 'month':
                return [
                    { unit: 'year', step: 1, format: 'yyyy' },
                    { unit: 'month', step: 1, format: 'MMM' }
                ];
            case 'week':
                return [
                    { unit: 'month', step: 1, format: 'MMM yyyy' },
                    { unit: 'week', step: 1, format: 'w' }
                ];
            case 'quarter':
                return [
                    { unit: 'year', step: 1, format: 'yyyy' },
                    { unit: 'quarter', step: 1, format: (date: Date) => `Q${Math.floor(date.getMonth() / 3) + 1}` }
                ];
            default:
                return [
                    { unit: 'year', step: 1, format: 'yyyy' },
                    { unit: 'month', step: 1, format: 'MMM' }
                ];
        }
    }, [zoomLevel]);

    // Today marker (SVAR supports markers even if the type defs don't surface it)
    const markers = useMemo(() => [
        { start: new Date(), css: 'grv4-today-marker', text: 'Today' }
    ], []);

    // Highlight Sprints
    const highlightTime = useCallback((date: Date) => {
        const time = date.getTime();
        const sprint = sprints.find(s => {
            const start = toMillis(s.startDate);
            const end = toMillis(s.endDate);
            return start && end && time >= start && time <= end;
        });
        return sprint ? 'grv4-sprint-highlight' : '';
    }, [sprints]);

    if (loading) {
        return (
            <div className="grv4-loading">
                <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading roadmap...</span>
                </div>
            </div>
        );
    }

    return (
        <div className={`grv4-container theme-${theme}`}>
            <div className="grv4-header">
                <h1 className="grv4-title">Goal Roadmap V4</h1>
                <div className="grv4-toolbar">
                    <div className="btn-group me-3">
                        <button
                            className={`btn btn-sm ${zoomLevel === 'year' ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => setZoomLevel('year')}
                        >
                            Year
                        </button>
                        <button
                            className={`btn btn-sm ${zoomLevel === 'quarter' ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => setZoomLevel('quarter')}
                        >
                            Quarter
                        </button>
                        <button
                            className={`btn btn-sm ${zoomLevel === 'month' ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => setZoomLevel('month')}
                        >
                            Month
                        </button>
                        <button
                            className={`btn btn-sm ${zoomLevel === 'week' ? 'btn-primary' : 'btn-outline-secondary'}`}
                            onClick={() => setZoomLevel('week')}
                        >
                            Week
                        </button>
                    </div>
                    <span className="badge bg-info">
                        {ganttTasks.length || 0} items
                    </span>
                </div>
            </div>

            <div className="grv4-gantt-wrapper" style={{ position: 'relative' }}>
                <Gantt
                    tasks={ganttTasks}
                    links={[]}
                    start={chartStart}
                    end={chartEnd}
                    scales={scales}
                    highlightTime={highlightTime}
                    // @ts-ignore markers supported by SVAR store
                    markers={markers}
                    // Use default SVAR rendering (no custom template)
                />
            </div>

            {editGoal && (
                <EditGoalModal
                    show={true}
                    goal={editGoal}
                    onClose={() => setEditGoal(null)}
                    currentUserId={currentUser?.uid || ''}
                    allGoals={goals}
                />
            )}
        </div>
    );
};

export default GoalRoadmapV4;
