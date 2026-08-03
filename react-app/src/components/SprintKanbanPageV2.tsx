import React, { useState, useEffect, useMemo } from 'react';
import { Card, Container, Row, Col, Button, Dropdown, Badge, Form, Spinner } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Story, Task, Goal } from '../types';
import KanbanBoardV2 from './KanbanBoardV2';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, RefreshCw, Sparkles, LayoutList, Columns2, Rows3, Plus, SlidersHorizontal, Search, X } from 'lucide-react';
import SprintTriageTable from './SprintTriageTable';
import { displayRefForEntity } from '../utils/referenceGenerator';
import { useSprint } from '../contexts/SprintContext';
import { isStatus } from '../utils/statusHelpers';
// Merged-away duplicates carry deleted:true and were showing on every surface — see utils/softDelete.
import { excludeSoftDeleted } from '../utils/softDelete';
import { useSidebar } from '../contexts/SidebarContext';
import GLOBAL_THEMES from '../constants/globalThemes';
import SprintSelector from './SprintSelector';
import ThemeMultiSelect from './shared/ThemeMultiSelect';
import GoalMultiSelect from './shared/GoalMultiSelect';
import EditStoryModal from './EditStoryModal';
import AddStoryModal from './AddStoryModal';
import EditTaskModal from './EditTaskModal';
import EditGoalModal from './EditGoalModal';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { useDetailLevel } from '../contexts/DetailLevelContext';
import { useDeviceInfo, getDeviceInfo } from '../utils/deviceDetection';
import { useFocusGoals } from '../hooks/useFocusGoals';
import { getActiveFocusLeafGoalIds, isGoalInHierarchySet } from '../utils/goalHierarchy';
import {
    callDeltaReplan,
    callFullReplan,
    formatDeltaReplanSummary,
    formatFullReplanSummary,
    normalizePlannerCallableError,
} from '../utils/plannerOrchestration';

/** Board = flat three columns. Swimlanes = one band per goal (parity with the iOS
 *  board's groupByGoal). Table = the triage list. */
type ViewMode = 'board' | 'swimlanes' | 'table';

const SprintKanbanPageV2: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { currentPersona } = usePersona();
    const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();
    const { isCollapsed, toggleCollapse, showSidebar } = useSidebar();
    const { themes: globalThemes } = useGlobalThemes();
    const { activeFocusGoals } = useFocusGoals(currentUser?.uid);

    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]); // Added goals state
    const [loading, setLoading] = useState(true);

    const [themeFilterIds, setThemeFilterIds] = useState<number[]>([]);
    const [goalFilterIds, setGoalFilterIds] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showDescriptions, setShowDescriptions] = useState(() => {
        try {
            const stored = localStorage.getItem('kanban_show_descriptions');
            return stored === null ? true : stored === 'true';
        } catch { return true; }
    });
    const [showLatestNotes, setShowLatestNotes] = useState(() => {
        try {
            const stored = localStorage.getItem('kanban_show_latest_notes');
            return stored === null ? true : stored === 'true';
        } catch { return true; }
    });
    const [editStory, setEditStory] = useState<Story | null>(null);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [editGoal, setEditGoal] = useState<Goal | null>(null);
    const [showAddStory, setShowAddStory] = useState(false);
    const [dueFilter, setDueFilter] = useState<'all' | 'today' | 'overdue' | 'top3' | 'critical'>('all');
    const [showFocusOnly, setShowFocusOnly] = useState(false);
    // Done items are hidden by default on the board's columns only on iPad landscape (the
    // one device where 3 full columns are cramped) — everywhere else "Show completed" stays
    // on, matching prior behaviour. Not persisted, same as before. Confirmed by Jim, 2026-07-24.
    const [showCompletedItems, setShowCompletedItems] = useState(() => !(getDeviceInfo().isIPad && getDeviceInfo().isTablet));
    const [showAiScoredOnly, setShowAiScoredOnly] = useState(false);
    const [showDelegatedOnly, setShowDelegatedOnly] = useState(false);
    const [sortBy, setSortBy] = useState<'ai' | 'due' | 'priority' | 'default'>('default');
    // iPad landscape defaults to the Triage table (less horizontal scrolling than 3 Kanban
    // columns) unless the user has already picked a view explicitly, in which case that
    // sticks. Confirmed by Jim, 2026-07-24.
    const [viewMode, setViewMode] = useState<ViewMode>(() => {
        try {
            const stored = localStorage.getItem('kanban_view_mode');
            if (stored === 'board' || stored === 'table' || stored === 'swimlanes') return stored;
        } catch { /* noop */ }
        const d = getDeviceInfo();
        return (d.isIPad && d.isTablet) ? 'table' : 'board';
    });
    const selectViewMode = (mode: ViewMode) => {
        setViewMode(mode);
        try { localStorage.setItem('kanban_view_mode', mode); } catch { /* noop */ }
    };
    const [replanLoading, setReplanLoading] = useState(false);
    const [fullReplanLoading, setFullReplanLoading] = useState(false);
    const [replanFeedback, setReplanFeedback] = useState<string | null>(null);
    const { detailLevel, setDetailLevel } = useDetailLevel();
    const deviceInfo = useDeviceInfo();
    // Filter/metrics chrome (theme+goal pickers, all the switches, due/sort/detail selects,
    // and the sprint metrics card) collapses by default on iPad — per Jim 2026-07-23, the
    // same filtering already exists on the Modern*Table list pages, so the board itself
    // should get the real estate here instead. Desktop keeps it open by default since screen
    // space isn't the constraint there. Persisted so the choice sticks across visits.
    const [showFilterChrome, setShowFilterChrome] = useState(() => {
        try {
            const stored = localStorage.getItem('kanban_show_filter_chrome');
            if (stored !== null) return stored === 'true';
        } catch { /* noop */ }
        return !deviceInfo.isIPad;
    });
    const toggleFilterChrome = () => {
        setShowFilterChrome((prev) => {
            const next = !prev;
            try { localStorage.setItem('kanban_show_filter_chrome', String(next)); } catch { /* noop */ }
            return next;
        });
    };
    const boardContainerRef = React.useRef<HTMLDivElement>(null);
    const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);

    useEffect(() => {
        // Desktop keeps its own default (full detail — there's room for it). iPad/tablet
        // and mobile fall through to DetailLevelContext's default ('minimal', always, no
        // exceptions per Jim 2026-07-21) — this effect used to force 'full' unconditionally
        // on every device, which is exactly what made iPad Kanban cards land at full detail
        // instead of the easy-to-scan minimal view.
        if (!deviceInfo.isMobile && !deviceInfo.isTablet) {
            setDetailLevel('full');
        }
    }, [setDetailLevel, deviceInfo.isMobile, deviceInfo.isTablet]);

    const resolveTimestampMs = (value: any): number | null => {
        if (!value) return null;
        if (typeof value === 'number') return Number.isFinite(value) ? value : null;
        if (typeof value?.toDate === 'function') {
            const d = value.toDate();
            return d instanceof Date ? d.getTime() : null;
        }
        if (typeof value?.seconds === 'number') return value.seconds * 1000;
        const parsed = Date.parse(String(value));
        return Number.isNaN(parsed) ? null : parsed;
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === boardContainerRef.current);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = () => {
        if (!boardContainerRef.current) return;
        if (!document.fullscreenElement) {
            boardContainerRef.current.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    };

    // Resolve filter: explicit "All" (empty string) disables filtering entirely
    const filterSprintId: string | null = selectedSprintId === ''
        ? null
        : (selectedSprintId || null);

    // Get current sprint only when a specific ID is chosen
    const currentSprint = filterSprintId
        ? sprints.find(s => s.id === filterSprintId)
        : null;

    // Data fetching for METRICS only (Board handles its own fetching for now, maybe we should lift state? 
    // For V2 simplicity and performance, let's let the Board fetch what it needs, 
    // but we need metrics here. So we might duplicate some fetching or lift it.
    // Given the "rebuild from scratch" and "performance" goals, lifting state is better.
    // But to keep it simple and modular, I'll fetch data here for metrics and pass it down?
    // Actually, KanbanBoardV2 fetches its own data. 
    // Let's fetch data here for metrics and pass it to board? 
    // No, let's keep Board self-contained for now as per my previous step.
    // I will duplicate the fetching here just for metrics to ensure parity without refactoring BoardV2 yet.
    // Wait, if I fetch here, I can pass to BoardV2 and avoid double fetch.
    // Let's modify BoardV2 to accept data? No, I already wrote BoardV2 to fetch.
    // I'll stick to BoardV2 fetching for now, and I'll fetch here for metrics. 
    // It's a bit inefficient but safe for "feature parity" without breaking BoardV2 logic I just wrote.
    // Actually, I can just fetch here and pass to BoardV2 if I modify BoardV2.
    // But I won't modify BoardV2 right now to avoid context switching.
    // I'll just fetch for metrics here.

    useEffect(() => {
        if (!currentUser) return;

        const storiesQuery = filterSprintId
            ? query(
                collection(db, 'stories'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                where('sprintId', '==', filterSprintId),
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

        const goalsQuery = query(
            collection(db, 'goals'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            orderBy('createdAt', 'desc'),
            limit(1000)
        );

        // For metrics we need tasks too (include done so counts/Done lane align)
        let tasksQuery;
        if (filterSprintId) {
            tasksQuery = query(
                collection(db, 'sprint_task_index'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                where('sprintId', '==', filterSprintId),
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

        const unsubStories = onSnapshot(storiesQuery, (snap) => {
            setStories(excludeSoftDeleted(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story))));
        }, (err) => {
            console.error('[kanban] stories snapshot error', err?.message || err);
        });

        const unsubGoals = onSnapshot(goalsQuery, (snap) => {
            setGoals(excludeSoftDeleted(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal))));
        }, (err) => {
            console.error('[kanban] goals snapshot error', err?.message || err);
        });

        const unsubTasks = onSnapshot(tasksQuery, (snap) => {
            setTasks(excludeSoftDeleted(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task))));
            setLoading(false);
        }, (err) => {
            console.error('[kanban] tasks snapshot error', err?.message || err);
            setLoading(false);
        });

        return () => {
            unsubStories();
            unsubGoals();
            unsubTasks();
        };
    }, [currentUser, currentPersona, filterSprintId]);

    // Filter for metrics and board
    const sprintStories = stories.filter((story) => {
        const storySprint = (story as any).sprintId as string | undefined;
        if (!filterSprintId && !currentSprint) return true;
        if (!filterSprintId) return true;
        return storySprint === filterSprintId;
    }).filter((story) => {
        if (!showFocusOnly || activeFocusGoalIds.size === 0) return true;
        const goalId = String((story as any).goalId || '').trim();
        if (!goalId) return false;
        return isGoalInHierarchySet(goalId, goals, activeFocusGoalIds);
    });

    // Chores, routines, habits, read and watch tasks are excluded from kanban
    // (chores → daily plan; read/watch → media consumption, not sprint work)
    const CHORE_TYPES = new Set(['chore', 'routine', 'habit', 'read', 'watch']);
    const sprintTasks = tasks.filter(
        (t) => !CHORE_TYPES.has(String((t as any).type || '').toLowerCase())
    );
    const sprintStartMs = resolveTimestampMs(currentSprint?.startDate);
    const sprintEndMs = resolveTimestampMs(currentSprint?.endDate);
    const sprintTasksForMetrics = sprintTasks.filter((task) => {
        if (!filterSprintId) return true;
        if (sprintStartMs == null || sprintEndMs == null) return true;
        const dueMs = resolveTimestampMs((task as any).dueDate ?? (task as any).targetDate ?? (task as any).endDate ?? (task as any).dueDateMs);
        if (dueMs == null) return false;
        return dueMs >= sprintStartMs && dueMs <= sprintEndMs;
    }).filter((task) => {
        if (!showFocusOnly || activeFocusGoalIds.size === 0) return true;
        const directGoalId = String((task as any).goalId || '').trim();
        if (directGoalId && isGoalInHierarchySet(directGoalId, goals, activeFocusGoalIds)) return true;
        const storyId = String((task as any).storyId || (task as any).parentId || '').trim();
        if (!storyId) return false;
        const linkedStory = stories.find((story) => story.id === storyId);
        const storyGoalId = String((linkedStory as any)?.goalId || '').trim();
        return !!storyGoalId && isGoalInHierarchySet(storyGoalId, goals, activeFocusGoalIds);
    });

    // Sprint metrics
    const getSprintMetrics = () => {
        const storyCompleted = (story: Story) => {
            const status = (story as any).status;
            if (typeof status === 'number') return status >= 4;
            const s = String(status || '').toLowerCase();
            return s === 'done' || s === 'complete' || s === 'completed';
        };
        const taskCompleted = (task: Task) => {
            const status = (task as any).status;
            if (typeof status === 'number') return status === 2;
            const s = String(status || '').toLowerCase();
            return s === 'done' || s === 'complete' || s === 'completed';
        };

        const totalStories = sprintStories.length;
        const completedStories = sprintStories.filter(storyCompleted).length;
        const totalTasks = sprintTasksForMetrics.length;
        const completedTasks = sprintTasksForMetrics.filter(taskCompleted).length;
        const normalizePoints = (story: Story) => {
            const val = Number((story as any).points);
            return Number.isFinite(val) ? val : 0;
        };
        const totalPoints = sprintStories.reduce((sum, story) => sum + normalizePoints(story), 0);
        const completedPoints = sprintStories
            .filter(storyCompleted)
            .reduce((sum, story) => sum + normalizePoints(story), 0);

        return {
            totalStories,
            completedStories,
            totalTasks,
            completedTasks,
            totalPoints,
            completedPoints,
            storyProgress: totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0,
            taskProgress: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
            pointsProgress: totalPoints > 0 ? Math.round((completedPoints / totalPoints) * 100) : 0
        };
    };

    const metrics = getSprintMetrics();



    const handleEditItem = (item: Story | Task, type: 'story' | 'task') => {
        if (type === 'story') {
            setEditStory(item as Story);
        } else {
            setEditTask(item as Task);
        }
    };

    const handleParentClick = (parentId: string, parentType: 'story' | 'goal') => {
        if (parentType === 'story') {
            const story = stories.find((s) => s.id === parentId);
            if (story) setEditStory(story);
        } else {
            const goal = goals.find((g) => g.id === parentId);
            if (goal) setEditGoal(goal);
        }
    };

    const handleDeltaReplan = async () => {
        if (!currentUser) return;
        setReplanFeedback(null);
        setReplanLoading(true);
        try {
            const payload = await callDeltaReplan(functions, { days: 7 });
            const parts = formatDeltaReplanSummary(payload);
            setReplanFeedback(parts.length ? `Delta replan complete: ${parts.join(', ')}.` : 'Delta replan complete.');
        } catch (error) {
            console.error('Delta replan failed', error);
            setReplanFeedback(normalizePlannerCallableError(error, 'Delta replan failed. Please retry.'));
        } finally {
            setReplanLoading(false);
        }
    };

    const handleFullReplan = async () => {
        if (!currentUser) return;
        setReplanFeedback(null);
        setFullReplanLoading(true);
        try {
            const payload = await callFullReplan(functions, {});
            const { total, ok } = formatFullReplanSummary(payload);
            if (total > 0 && ok === total) {
                setReplanFeedback(`Full replan complete: ${ok}/${total} orchestration steps succeeded.`);
            } else if (total > 0 && ok > 0) {
                setReplanFeedback(`Full replan partial: ${ok}/${total} orchestration steps succeeded.`);
            } else {
                setReplanFeedback('Full replan finished with errors. Check logs.');
            }
        } catch (error) {
            console.error('Full replan failed', error);
            setReplanFeedback(normalizePlannerCallableError(error, 'Full replan failed. Please retry.'));
        } finally {
            setFullReplanLoading(false);
        }
    };

    return (
        <Container fluid style={{ padding: deviceInfo.isIPad ? '12px' : '24px', backgroundColor: 'var(--bg)', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Header — title, sprint context, primary actions and a slim always-on metrics
                strip all share one row so the board gets the vertical space back. Detailed
                filters (theme/goal pickers, switches, sort/detail) stay behind the Filters
                toggle below, same collapse mechanism as before. Confirmed by Jim, 2026-07-23:
                the old 4-row header (title / sprint+actions / big stat cards / filters) ate
                too much space before the board even started. */}
            <Row className="mb-2 flex-shrink-0">
                <Col>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', position: 'relative', zIndex: 5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                            <h2 style={{ margin: 0, fontSize: deviceInfo.isIPad ? '16px' : '20px', fontWeight: '700', color: 'var(--text)' }}>
                                Sprint Kanban
                            </h2>
                            {currentSprint && (
                                <span className="text-muted small d-flex align-items-center gap-1">
                                    {currentSprint.name || currentSprint.id}
                                    {currentSprint.id && (
                                        <span className="badge bg-light text-dark">
                                            {displayRefForEntity('sprint', currentSprint.id)}
                                        </span>
                                    )}
                                </span>
                            )}
                            {currentSprint && (
                                <div className="d-flex align-items-center gap-1 small text-muted">
                                    <Badge bg="success" style={{ fontSize: '11px' }}>{metrics.completedStories}/{metrics.totalStories} stories · {metrics.storyProgress}%</Badge>
                                    <Badge bg="primary" style={{ fontSize: '11px' }}>{metrics.completedTasks}/{metrics.totalTasks} tasks · {metrics.taskProgress}%</Badge>
                                    <Badge bg="secondary" style={{ fontSize: '11px' }}>{metrics.completedPoints.toLocaleString()}/{metrics.totalPoints.toLocaleString()} pts · {metrics.pointsProgress}%</Badge>
                                    <Badge bg="light" text="dark" style={{ fontSize: '11px' }}>{Math.ceil((currentSprint.endDate - currentSprint.startDate) / (1000 * 60 * 60 * 24))}d</Badge>
                                </div>
                            )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>                            <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={handleDeltaReplan}
                                disabled={replanLoading || fullReplanLoading}
                                title="Delta replan: quickly rebalance existing calendar blocks using current priorities."
                            >
                                {replanLoading ? <Spinner size="sm" animation="border" /> : <RefreshCw size={14} />}
                                <span className="d-none d-xl-inline ms-1">Delta replan</span>
                            </Button>
                            <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={handleFullReplan}
                                disabled={fullReplanLoading || replanLoading}
                                title="Full replan: runs full nightly orchestration (pointing, conversions, priority scoring, and calendar planning)."
                            >
                                {fullReplanLoading ? <Spinner size="sm" animation="border" /> : <Sparkles size={14} />}
                                <span className="d-none d-xl-inline ms-1">Full replan</span>
                            </Button>
                            <span style={{ width: 1, height: 20, background: 'var(--bs-border-color)' }} />
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <Search size={13} style={{ position: 'absolute', left: 8, color: 'var(--muted, #9ca3af)', pointerEvents: 'none' }} />
                                <Form.Control
                                    type="text"
                                    size="sm"
                                    placeholder="Search title..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    style={{ paddingLeft: 26, paddingRight: searchTerm ? 26 : 8, width: 160 }}
                                />
                                {searchTerm && (
                                    <button
                                        type="button"
                                        onClick={() => setSearchTerm('')}
                                        title="Clear search"
                                        style={{
                                            position: 'absolute', right: 6, background: 'none', border: 'none',
                                            padding: 2, display: 'flex', color: 'var(--muted, #9ca3af)', cursor: 'pointer',
                                        }}
                                    >
                                        <X size={13} />
                                    </button>
                                )}
                            </div>
                            <span style={{ width: 1, height: 20, background: 'var(--bs-border-color)' }} />
                            <Button
                                variant={showFilterChrome ? 'secondary' : 'outline-secondary'}
                                size="sm"
                                onClick={toggleFilterChrome}
                                title={showFilterChrome ? 'Hide filters (same filtering is on the Stories/Tasks list pages)' : 'Show filters'}
                            >
                                <SlidersHorizontal size={14} />
                                <span className="ms-1">Filters</span>
                            </Button>
                            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
                                <Button
                                    variant={viewMode === 'board' ? 'secondary' : 'outline-secondary'}
                                    size="sm"
                                    onClick={() => selectViewMode('board')}
                                    title="Board view"
                                    style={{ borderRadius: 0, border: 'none', padding: '4px 10px' }}
                                >
                                    <Columns2 size={15} />
                                </Button>
                                <Button
                                    variant={viewMode === 'swimlanes' ? 'secondary' : 'outline-secondary'}
                                    size="sm"
                                    onClick={() => selectViewMode('swimlanes')}
                                    title="Swimlanes — group by goal"
                                    style={{ borderRadius: 0, border: 'none', padding: '4px 10px' }}
                                >
                                    <Rows3 size={15} />
                                </Button>
                                <Button
                                    variant={viewMode === 'table' ? 'secondary' : 'outline-secondary'}
                                    size="sm"
                                    onClick={() => selectViewMode('table')}
                                    title="Triage table view"
                                    style={{ borderRadius: 0, border: 'none', padding: '4px 10px' }}
                                >
                                    <LayoutList size={15} />
                                </Button>
                            </div>
                            <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={toggleFullscreen}
                                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                                style={{ padding: '6px 12px' }}
                            >
                                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </Button>
                            <Button
                                variant="primary"
                                size="sm"
                                onClick={() => setShowAddStory(true)}
                            >
                                <Plus size={14} className="me-1" />
                                Add Story
                            </Button>
                        </div>
                    </div>

                    {/* Filter chrome — theme/goal pickers, switches, due/sort/detail selects.
                        Collapsed by default on iPad, persisted everywhere. */}
                    {showFilterChrome && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '10px' }}>
                            <Badge bg="primary" style={{ fontSize: '11px' }}>
                                {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)}
                            </Badge>
                        <Button
                            variant="outline-secondary"
                                size="sm"
                                title={isCollapsed ? 'Expand details panel' : 'Collapse details panel'}
                                onClick={toggleCollapse}
                            >
                                {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                            </Button>

                            <ThemeMultiSelect
                                selectedIds={themeFilterIds}
                                onChange={setThemeFilterIds}
                                style={{ minWidth: 140 }}
                            />

                            <GoalMultiSelect
                                goals={goals}
                                selectedIds={goalFilterIds}
                                onChange={setGoalFilterIds}
                                style={{ minWidth: 160 }}
                            />

                            <Form.Check
                                type="switch"
                                id="toggle-kanban-descriptions"
                                label="Show story descriptions"
                                checked={showDescriptions}
                                onChange={(e) => {
                                    setShowDescriptions(e.target.checked);
                                    try { localStorage.setItem('kanban_show_descriptions', String(e.target.checked)); } catch { /* noop */ }
                                }}
                                className="ms-2"
                            />
                            <Form.Check
                                type="switch"
                                id="toggle-kanban-notes"
                                label="Show latest notes"
                                checked={showLatestNotes}
                                onChange={(e) => {
                                    setShowLatestNotes(e.target.checked);
                                    try { localStorage.setItem('kanban_show_latest_notes', String(e.target.checked)); } catch { /* noop */ }
                                }}
                                className="ms-2"
                            />
                            <Form.Check
                                type="switch"
                                id="toggle-kanban-completed"
                                label="Show completed"
                                checked={showCompletedItems}
                                onChange={(e) => setShowCompletedItems(e.target.checked)}
                                className="ms-2"
                            />
                            <Form.Check
                                type="switch"
                                id="toggle-kanban-ai-scored"
                                label="AI-scored only"
                                checked={showAiScoredOnly}
                                onChange={(e) => setShowAiScoredOnly(e.target.checked)}
                                className="ms-2"
                            />
                            <Form.Check
                                type="switch"
                                id="toggle-kanban-delegated"
                                label="Delegated to AI"
                                checked={showDelegatedOnly}
                                onChange={(e) => setShowDelegatedOnly(e.target.checked)}
                                className="ms-2"
                            />

                            <Dropdown>
                                <Dropdown.Toggle variant="outline-secondary" size="sm">
                                    {dueFilter === 'all'
                                        ? 'All items'
                                        : dueFilter === 'today'
                                        ? 'Due Today'
                                        : dueFilter === 'overdue'
                                            ? 'Overdue'
                                            : dueFilter === 'top3'
                                                ? 'Top 3'
                                                : dueFilter === 'critical'
                                                    ? 'Critical'
                                                    : 'All Due'}
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                    <Dropdown.Item active={dueFilter === 'all'} onClick={() => setDueFilter('all')}>All items</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'today'} onClick={() => setDueFilter('today')}>Due Today</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'overdue'} onClick={() => setDueFilter('overdue')}>Overdue</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'top3'} onClick={() => setDueFilter('top3')}>Top 3</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'critical'} onClick={() => setDueFilter('critical')}>Critical</Dropdown.Item>
                                </Dropdown.Menu>
                            </Dropdown>
                            <Form.Check
                                type="switch"
                                id="toggle-kanban-focus-only"
                                label={`Focus only${activeFocusGoalIds.size > 0 ? ` (${activeFocusGoalIds.size})` : ''}`}
                                checked={showFocusOnly}
                                onChange={(e) => setShowFocusOnly(e.target.checked)}
                                disabled={activeFocusGoalIds.size === 0}
                                className="ms-2"
                            />

                                <Form.Group className="ms-2">
                                    <Form.Select
                                        size="sm"
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                    >
                                        <option value="default">Sort: Priority stack</option>
                                        <option value="ai">Sort: AI score</option>
                                        <option value="due">Sort: Due date</option>
                                        <option value="priority">Sort: Priority</option>
                                    </Form.Select>
                                </Form.Group>

                                <Form.Group className="ms-2">
                                    <Form.Select
                                        size="sm"
                                        value={detailLevel}
                                        onChange={(e) => setDetailLevel(e.target.value as any)}
                                        title="Card detail level"
                                    >
                                        <option value="full">Detail: Full</option>
                                        <option value="compact">Detail: Compact</option>
                                        <option value="minimal">Detail: Minimal</option>
                                    </Form.Select>
                                </Form.Group>
                    </div>
                    )}
                </Col>
            </Row>

            {replanFeedback && (
                <Row className="mb-2 flex-shrink-0">
                    <Col>
                        <div className="text-muted small">{replanFeedback}</div>
                    </Col>
                </Row>
            )}

            {/* Kanban Board / Triage Table */}
            <Row style={{ flex: 1, minHeight: 0 }} ref={boardContainerRef as any}>
                <Col style={{ height: '100%' }}>
                    <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: '100%', borderRadius: isFullscreen ? 0 : undefined }}>
                        <Card.Body style={{ padding: deviceInfo.isIPad ? '10px' : '24px', height: '100%', overflow: 'auto', backgroundColor: isFullscreen ? 'var(--bg)' : undefined }}>
                            {viewMode !== 'table' ? (
                                <KanbanBoardV2
                                    groupByGoal={viewMode === 'swimlanes'}
                                    sprintId={filterSprintId}
                                    themeFilter={themeFilterIds.length > 0 ? themeFilterIds : null}
                                    goalFilter={goalFilterIds.length > 0 ? goalFilterIds : null}
                                    searchTerm={searchTerm}
                                    focusOnly={showFocusOnly}
                                    focusGoalIds={activeFocusGoalIds}
                                    onItemSelect={(item, type) => showSidebar(item, type)}
                                    onEdit={handleEditItem}
                                    onParentClick={handleParentClick}
                                    showDescriptions={showDescriptions}
                                    showLatestNotes={showLatestNotes}
                                    dueFilter={dueFilter}
                                    sortBy={sortBy}
                                    showCompletedItems={!!filterSprintId && showCompletedItems}
                                    showAiScoredOnly={showAiScoredOnly}
                                    showDelegatedOnly={showDelegatedOnly}
                                    themes={globalThemes}
                                    detailLevel={detailLevel}
                                />
                            ) : (
                                <SprintTriageTable
                                    stories={stories}
                                    tasks={tasks}
                                    goals={goals}
                                    sprints={sprints as any}
                                    filterSprintId={filterSprintId}
                                    searchTerm={searchTerm}
                                    onEditStory={setEditStory}
                                    onEditTask={setEditTask}
                                    onEditGoal={setEditGoal}
                                    compactColumns={deviceInfo.isIPad && deviceInfo.isTablet}
                                />
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            <AddStoryModal
                show={showAddStory}
                onClose={() => setShowAddStory(false)}
            />

            <EditStoryModal
                show={!!editStory}
                onHide={() => setEditStory(null)}
                story={editStory}
                goals={goals}
                onStoryUpdated={() => setEditStory(null)}
                container={boardContainerRef.current}
            />

            <EditTaskModal
                show={!!editTask}
                task={editTask}
                onHide={() => setEditTask(null)}
                onUpdated={() => setEditTask(null)}
                container={boardContainerRef.current}
            />

            <EditGoalModal
                show={!!editGoal}
                goal={editGoal}
                onClose={() => setEditGoal(null)}
                currentUserId={currentUser?.uid || ''}
                allGoals={goals}
            />
        </Container>
    );
};

export default SprintKanbanPageV2;
