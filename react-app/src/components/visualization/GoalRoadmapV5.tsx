import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Gantt } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/all.css';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../../firebase';
import { Goal, Story, Sprint } from '../../types';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { migrateThemeValue } from '../../constants/globalThemes';
import { isStatus } from '../../utils/statusHelpers';
import EditGoalModal from '../../components/EditGoalModal';
import { Star, Search } from 'lucide-react';
import './GoalRoadmapV5.css';

interface GanttTask {
    id: string | number;
    text: string;
    start: Date;
    end?: Date;
    duration: number;
    parent?: string | number;
    progress: number; // percent 0-100 for SVAR gantt
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
    isMilestone?: boolean;
    currency?: string;
}

const DAY_MS = 86400000;

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

const TaskTemplate: React.FC<{ data: GanttTask }> = ({ data }) => {
    const { theme } = useTheme();
    const isDark = theme === 'dark';

    if (data.isThemeGroup) {
        return (
            <div className="grv5-task-content" style={{
                color: isDark ? '#e0e0e0' : '#1f2937',
                fontWeight: 700,
                backgroundColor: 'transparent',
                border: 'none',
                boxShadow: 'none',
                paddingLeft: 0
            }}>
                {data.text}
            </div>
        );
    }

    if (data.isMilestone) {
        return (
            <div
                className="grv5-milestone"
                style={{
                    backgroundColor: data.themeColor || '#3b82f6',
                }}
                title={data.text}
            >
                <Star size={14} fill="white" strokeWidth={1.5} color="white" />
            </div>
        );
    }

    // Goal Bar with Metrics
    const pct = Math.round(data.progress ?? 0);
    return (
        <div
            className="grv5-task-content"
            style={{
                background: `linear-gradient(to bottom right, ${data.themeColor || '#3b82f6'}, ${data.themeColor ? data.themeColor + 'dd' : '#2563eb'})`,
                border: '1px solid rgba(255,255,255,0.2)',
                display: 'flex',
                justifyContent: 'space-between',
                padding: '0 8px'
            }}
            title={`${data.text} (${pct}%)`}
        >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.text}</span>
            {(data.hasFinance || data.pointsPct !== undefined) && (
                <div style={{ display: 'flex', gap: '6px', fontSize: '10px', opacity: 0.9 }}>
                    {data.pointsPct !== undefined && (
                        <span className="badge bg-dark bg-opacity-25" style={{ fontWeight: 500 }}>
                            SP {data.pointsPct}%
                        </span>
                    )}
                    {data.hasFinance && (
                        <span className="badge bg-dark bg-opacity-25" style={{ fontWeight: 500 }}>
                            ${data.financePct}%
                        </span>
                    )}
                </div>
            )}
        </div>
    );
};

const GoalRoadmapV5: React.FC = () => {
    const { currentUser } = useAuth();
    const { theme } = useTheme();
    const { themes: globalThemes } = useGlobalThemes();

    const [goals, setGoals] = useState<Goal[]>([]);
    const [stories, setStories] = useState<Story[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [loading, setLoading] = useState(true);

    // Filters
    const [search, setSearch] = useState('');
    const [themeFilter, setThemeFilter] = useState<number | 'all'>('all');

    // Stats
    const [storyPoints, setStoryPoints] = useState<Record<string, number>>({});
    const [storyDonePoints, setStoryDonePoints] = useState<Record<string, number>>({});
    const [potBalances, setPotBalances] = useState<Record<string, { balance: number; currency: string }>>({});
    const [lastNotes, setLastNotes] = useState<Record<string, string>>({});

    const [editGoal, setEditGoal] = useState<Goal | null>(null);
    const ENABLE_MONZO_POTS = process.env.REACT_APP_ENABLE_MONZO_POTS === 'true';
    const [debugError, setDebugError] = useState<string | null>(null);

    // Data Loaders
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
            setLoading(false);
        }, err => {
            console.warn('[RoadmapV5] Goals error:', err);
            setDebugError(`Goals Error: ${err.message}`);
            if ((err as any)?.code === 'permission-denied') setGoals([]);
            setLoading(false);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Story));
            setStories(data);
            const points: Record<string, number> = {};
            const donePoints: Record<string, number> = {};
            for (const s of data) {
                const gid = s.goalId;
                if (!gid) continue;
                const pts = Number(s.points || 0);
                points[gid] = (points[gid] || 0) + pts;
                if (isStatus(s.status as any, 'done')) donePoints[gid] = (donePoints[gid] || 0) + pts;
            }
            setStoryPoints(points);
            setStoryDonePoints(donePoints);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => setSprints(snap.docs.map(d => ({ id: d.id, ...d.data() } as Sprint))));
        return () => unsub();
    }, [currentUser?.uid]);

    // Subscribe to Activity Stream for notes
    useEffect(() => {
        if (!currentUser?.uid) return;
        const q = query(
            collection(db, 'activity_stream'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('timestamp', 'desc'),
            limit(200)
        );
        const unsub = onSnapshot(q, (snap) => {
            if (!snap || !snap.docs) return; // Defensive check
            const map: Record<string, string> = {};
            for (const d of snap.docs) {
                const data = d.data();
                if (data.entityType !== 'goal' || data.activityType !== 'note_added') continue;
                const gid = String(data.entityId);
                if (gid && !map[gid] && data.noteContent) {
                    map[gid] = String(data.noteContent);
                }
            }
            setLastNotes(map);
        }, (error) => {
            console.warn('[RoadmapV5] Activity stream blocked or failed', error);
        });
        return () => unsub();
    }, [currentUser?.uid]);

    useEffect(() => {
        if (!ENABLE_MONZO_POTS || !currentUser?.uid) return;
        const q = query(collection(db, 'monzo_pots'), where('ownerUid', '==', currentUser.uid));
        const unsub = onSnapshot(q, snap => {
            if (!snap || !snap.docs) return; // Defensive check
            const map: Record<string, any> = {};
            snap.docs.forEach(d => map[d.id] = { balance: Number(d.data().balance || 0) / 100, currency: d.data().currency || 'GBP' });
            setPotBalances(map);
        }, err => console.warn('Monzo Pots Error', err));
        return () => unsub();
    }, [currentUser?.uid, ENABLE_MONZO_POTS]);

    // Derived State
    const themeOptions = useMemo(() => (globalThemes || []).map(t => ({ id: t.id, name: t.name || t.label || `Theme ${t.id}`, color: t.color })), [globalThemes]);

    const filteredGoals = useMemo(() => {
        const term = search.trim().toLowerCase();
        return goals.filter(g => {
            const tId = migrateThemeValue(g.theme);
            if (themeFilter !== 'all' && tId !== themeFilter) return false;
            if (term && !(g.title || '').toLowerCase().includes(term)) return false;
            return true;
        });
    }, [goals, search, themeFilter]);

    // Transform to Gantt Tasks
    const { ganttTasks, chartStart, chartEnd } = useMemo(() => {
        const list: GanttTask[] = [];
        const themeGroups = new Map<number, { start: Date, end: Date }>();
        let min = new Date();
        let max = new Date(Date.now() + 90 * DAY_MS);

        // First pass: Goals
        filteredGoals.forEach(g => {
            const tId = migrateThemeValue(g.theme);
            const parentKey = `theme-group-${tId}`;

            const startMs = toMillis(g.startDate) ?? toMillis(g.targetDate) ?? Date.now();
            const endMs = toMillis(g.endDate) ?? toMillis(g.targetDate) ?? (startMs + 30 * DAY_MS);
            const start = new Date(startMs);
            const end = new Date(endMs);

            if (start < min) min = start;
            if (end > max) max = end;

            const existing = themeGroups.get(tId);
            if (!existing) themeGroups.set(tId, { start, end });
            else {
                if (start < existing.start) existing.start = start;
                if (end > existing.end) existing.end = end;
            }

            const totalPts = storyPoints[g.id] || 0;
            const donePts = storyDonePoints[g.id] || 0;
            const pointsPct = totalPts > 0 ? Math.min(Math.round((donePts / totalPts) * 100), 100) : 0;

            let financePct = 0;
            let hasFinance = false;
            let currency = 'GBP';
            if (g.potId && potBalances[g.potId] && g.estimatedCost) {
                const pot = potBalances[g.potId];
                financePct = g.estimatedCost > 0 ? Math.round((pot.balance / g.estimatedCost) * 100) : 0;
                hasFinance = true;
                currency = pot.currency;
            }

            const duration = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
            const isMilestone = duration < 14;
            const themeDef = globalThemes.find(t => t.id === tId);

            list.push({
                id: g.id,
                text: g.title,
                start,
                end,
                duration,
                parent: parentKey,
                progress: pointsPct,
                type: 'task',
                theme: tId,
                themeColor: themeDef?.color || '#3b82f6',
                storyPoints: totalPts,
                pointsPct: totalPts > 0 ? pointsPct : undefined,
                financePct,
                hasFinance,
                currency,
                isMilestone,
                open: true
            });
        });

        // Second pass: Create Groups
        if (themeFilter === 'all') { // Only group if showing all
            themeGroups.forEach((range, tId) => {
                const themeDef = globalThemes.find(t => t.id === tId);
                list.push({
                    id: `theme-group-${tId}`,
                    text: themeDef?.name || `Theme ${tId}`,
                    start: range.start,
                    end: range.end,
                    duration: Math.round((range.end.getTime() - range.start.getTime()) / DAY_MS),
                    progress: 0,
                    type: 'summary',
                    isThemeGroup: true,
                    open: true
                });
            });
        } else {
            // If filtering by theme, remove parent ref so they show flat
            list.forEach(t => t.parent = undefined);
        }

        return { ganttTasks: list, chartStart: min, chartEnd: max };
    }, [filteredGoals, themeFilter, globalThemes, storyPoints, storyDonePoints, potBalances]);

    // Link generation
    const links = useMemo(() => {
        return filteredGoals
            .filter(g => g.parentGoalId && goals.find(Gx => Gx.id === g.parentGoalId))
            .map(g => ({
                id: `link-${g.id}`,
                source: g.parentGoalId!,
                target: g.id,
                type: 'e2s' // SVAR expects end-to-start shorthand
            }));
    }, [filteredGoals, goals]);


    // Handlers
    const handleTaskChange = useCallback(async (task: any) => {
        // ID string check to avoid updating groups
        if (String(task.id).startsWith('theme-group-')) return;

        try {
            await updateDoc(doc(db, 'goals', String(task.id)), {
                startDate: task.start.getTime(),
                endDate: task.end.getTime(),
                updatedAt: serverTimestamp()
            });
            if (currentUser?.uid) {
                // Log activity (simplified)
            }
        } catch (e) {
            console.error('Failed to update goal dates', e);
        }
    }, [currentUser?.uid]);

    const handleTaskDblClick = useCallback((task: any) => {
        if (String(task.id).startsWith('theme-group-')) return;
        const goal = goals.find(g => g.id === String(task.id));
        if (goal) setEditGoal(goal);
    }, [goals]);

    const handleLinkAdd = useCallback(async (link: any) => {
        const sId = String(link.source);
        const tId = String(link.target);
        if (!sId || !tId || sId.startsWith('theme-') || tId.startsWith('theme-')) return;
        try {
            await updateDoc(doc(db, 'goals', tId), {
                parentGoalId: sId,
                updatedAt: serverTimestamp()
            });
        } catch (e) { console.error('Failed to link goals', e); }
    }, []);

    // Zoom
    const [zoomLevel, setZoomLevel] = useState<'year' | 'month' | 'week' | 'quarter'>('month');
    const scales = useMemo(() => {
        switch (zoomLevel) {
            case 'year': return [{ unit: 'year', step: 1, format: 'yyyy' }];
            case 'month': return [{ unit: 'year', step: 1, format: 'yyyy' }, { unit: 'month', step: 1, format: 'MMM' }];
            case 'week': return [{ unit: 'month', step: 1, format: 'MMM yyyy' }, { unit: 'week', step: 1, format: 'w' }];
            case 'quarter': return [{ unit: 'year', step: 1, format: 'yyyy' }, { unit: 'quarter', step: 1, format: (d: Date) => `Q${Math.floor(d.getMonth() / 3) + 1}` }];
            default: return [{ unit: 'month', step: 1, format: 'MMM' }];
        }
    }, [zoomLevel]);

    const highlightTime = useCallback((date: Date) => {
        const time = date.getTime();
        const sprint = sprints.find(s => {
            const start = toMillis(s.startDate);
            const end = toMillis(s.endDate);
            return start && end && time >= start && time <= end;
        });
        return sprint ? 'grv5-sprint-highlight' : '';
    }, [sprints]);

    const markers = useMemo(() => [{ start: new Date(), css: 'grv5-today-marker', text: 'Today' }], []);

    // Strict validation for Gantt tasks
    const cleanTasks = useMemo(() => {
        const ids = new Set(ganttTasks.map(t => t.id));
        return ganttTasks.filter(t => {
            // Check dates
            if (!t.start || isNaN(t.start.getTime())) return false;
            // Check parent existence
            if (t.parent && !ids.has(t.parent)) {
                // If parent missing, make it root or filter it? 
                // Better to make it root to avoid hiding data
                t.parent = undefined;
            }
            return true;
        });
    }, [ganttTasks]);

    if (loading) return <div className="grv5-loading">Loading Roadmap...</div>;

    if (!loading && goals.length === 0) {
        return (
            <div className={`grv5-container theme-${theme} d-flex flex-column align-items-center justify-content-center`}>
                <div className="text-center p-5">
                    <h3>No Goals Found</h3>
                    <p className="text-muted">You haven't created any goals yet, or you don't have permission to view them.</p>
                    <button className="btn btn-primary" onClick={() => window.location.reload()}>Refresh</button>
                </div>
            </div>
        );
    }

    return (
        <div className={`grv5-container theme-${theme}`}>
            <div className="grv5-header">
                <div className="grv5-title-section">
                    <h1 className="grv5-title">Goal Roadmap</h1>
                    <div className="grv5-subtitle">Unified Timeline • {cleanTasks.filter(t => !t.isThemeGroup).length} Goals</div>
                </div>
                <div className="grv5-toolbar">
                    <div className="grv5-filters">
                        <div className="grv5-search">
                            <Search size={16} />
                            <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                        <select className="grv5-select" value={themeFilter} onChange={e => setThemeFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                            <option value="all">All Themes</option>
                            {themeOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </select>
                    </div>
                    <div className="btn-group">
                        {['year', 'quarter', 'month', 'week'].map((z) => (
                            <button key={z} className={`btn btn-sm ${zoomLevel === z ? 'btn-primary' : 'btn-outline-secondary'}`} onClick={() => setZoomLevel(z as any)}>
                                {z.charAt(0).toUpperCase() + z.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="grv5-gantt-wrapper">
                <Gantt
                    tasks={cleanTasks}
                    links={links}
                    start={chartStart}
                    end={chartEnd}
                    scales={scales}
                    highlightTime={highlightTime}
                    // @ts-ignore
                    markers={markers}
                    taskTemplate={TaskTemplate as any}
                    onTaskChange={handleTaskChange}
                    onTaskDblClick={handleTaskDblClick}
                    onLinkAdd={handleLinkAdd}
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

export default GoalRoadmapV5;
