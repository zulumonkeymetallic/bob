import React, { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Button, Dropdown, Badge, Form, Spinner } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Story, Task, Goal } from '../types';
import KanbanBoardV2 from './KanbanBoardV2';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, LayoutGrid, RefreshCw, Sparkles } from 'lucide-react';
import { displayRefForEntity } from '../utils/referenceGenerator';
import { useSprint } from '../contexts/SprintContext';
import { isStatus } from '../utils/statusHelpers';
import { useSidebar } from '../contexts/SidebarContext';
import GLOBAL_THEMES from '../constants/globalThemes';
import SprintSelector from './SprintSelector';
import EditStoryModal from './EditStoryModal';
import EditTaskModal from './EditTaskModal';
import { useGlobalThemes } from '../hooks/useGlobalThemes';

const SprintKanbanPageV2: React.FC = () => {
    const navigate = useNavigate();
    const { currentUser } = useAuth();
    const { currentPersona } = usePersona();
    const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();
    const { isCollapsed, toggleCollapse, showSidebar } = useSidebar();
    const { themes: globalThemes } = useGlobalThemes();

    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]); // Added goals state
    const [loading, setLoading] = useState(true);

    const [themeFilter, setThemeFilter] = useState<number | null>(null);
    const [goalFilter, setGoalFilter] = useState<string | null>(null);
    const [goalSearch, setGoalSearch] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showDescriptions, setShowDescriptions] = useState(false);
    const [showLatestNotes, setShowLatestNotes] = useState(false);
    const [editStory, setEditStory] = useState<Story | null>(null);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [dueFilter, setDueFilter] = useState<'all' | 'today' | 'overdue' | 'top3' | 'critical'>('top3');
    const [sortBy, setSortBy] = useState<'ai' | 'due' | 'priority' | 'default'>('ai');
    const [replanLoading, setReplanLoading] = useState(false);
    const [fullReplanLoading, setFullReplanLoading] = useState(false);
    const [replanFeedback, setReplanFeedback] = useState<string | null>(null);
    const boardContainerRef = React.useRef<HTMLDivElement>(null);

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
            setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
        });

        const unsubGoals = onSnapshot(goalsQuery, (snap) => {
            setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
        });

        const unsubTasks = onSnapshot(tasksQuery, (snap) => {
            setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
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
    });

    const sprintTasks = tasks; // Already filtered by query if sprintId is set
    const sprintStartMs = resolveTimestampMs(currentSprint?.startDate);
    const sprintEndMs = resolveTimestampMs(currentSprint?.endDate);
    const sprintTasksForMetrics = sprintTasks.filter((task) => {
        if (!filterSprintId) return true;
        if (sprintStartMs == null || sprintEndMs == null) return true;
        const dueMs = resolveTimestampMs((task as any).dueDate ?? (task as any).targetDate ?? (task as any).endDate ?? (task as any).dueDateMs);
        if (dueMs == null) return false;
        return dueMs >= sprintStartMs && dueMs <= sprintEndMs;
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



    const filteredGoals = goals.filter(g =>
        g.title.toLowerCase().includes(goalSearch.toLowerCase())
    );

    const activeTheme = themeFilter !== null ? GLOBAL_THEMES.find(t => t.id === themeFilter) : null;

    const handleEditItem = (item: Story | Task, type: 'story' | 'task') => {
        if (type === 'story') {
            setEditStory(item as Story);
        } else {
            setEditTask(item as Task);
        }
    };

    const handleDeltaReplan = async () => {
        if (!currentUser) return;
        setReplanFeedback(null);
        setReplanLoading(true);
        try {
            const callable = httpsCallable(functions, 'replanCalendarNow');
            const response = await callable({ days: 7 });
            const payload = response.data as { created?: number; rescheduled?: number; blocked?: number };
            const parts: string[] = [];
            if (payload?.created) parts.push(`${payload.created} created`);
            if (payload?.rescheduled) parts.push(`${payload.rescheduled} moved`);
            if (payload?.blocked) parts.push(`${payload.blocked} blocked`);
            setReplanFeedback(parts.length ? `Delta replan complete: ${parts.join(', ')}.` : 'Delta replan complete.');
        } catch (error) {
            console.error('Delta replan failed', error);
            setReplanFeedback('Delta replan failed. Please retry.');
        } finally {
            setReplanLoading(false);
        }
    };

    const handleFullReplan = async () => {
        if (!currentUser) return;
        setReplanFeedback(null);
        setFullReplanLoading(true);
        try {
            const callable = httpsCallable(functions, 'runNightlyChainNow');
            const response = await callable({});
            const payload = response.data as { results?: Array<{ status?: string }> };
            const total = payload?.results?.length || 0;
            const ok = (payload?.results || []).filter((item) => item.status === 'ok').length;
            if (total > 0 && ok === total) {
                setReplanFeedback(`Full replan complete: ${ok}/${total} orchestration steps succeeded.`);
            } else if (total > 0 && ok > 0) {
                setReplanFeedback(`Full replan partial: ${ok}/${total} orchestration steps succeeded.`);
            } else {
                setReplanFeedback('Full replan finished with errors. Check logs.');
            }
        } catch (error) {
            console.error('Full replan failed', error);
            setReplanFeedback('Full replan failed. Please retry.');
        } finally {
            setFullReplanLoading(false);
        }
    };

    return (
        <Container fluid style={{ padding: '24px', backgroundColor: 'var(--bg)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <Row className="mb-4 flex-shrink-0">
                <Col>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        <h2 style={{ margin: 0, fontSize: '28px', fontWeight: '700', color: 'var(--text)' }}>
                            Sprint Kanban
                        </h2>

                        <Badge bg="primary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                            {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona
                        </Badge>
                    </div>

                    {/* Right-side controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Button
                            variant="outline-secondary"
                                size="sm"
                                title={isCollapsed ? 'Expand details panel' : 'Collapse details panel'}
                                onClick={toggleCollapse}
                            >
                                {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                            </Button>

                            <Dropdown>
                                <Dropdown.Toggle variant="outline-secondary" size="sm" style={{ minWidth: '140px' }}>
                                    {activeTheme ? activeTheme.label : 'All Themes'}
                                </Dropdown.Toggle>
                                <Dropdown.Menu style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                    <Dropdown.Item onClick={() => setThemeFilter(null)} active={themeFilter === null}>All Themes</Dropdown.Item>
                                    <Dropdown.Divider />
                                    {GLOBAL_THEMES.map((theme) => (
                                        <Dropdown.Item
                                            key={theme.id}
                                            onClick={() => setThemeFilter(theme.id)}
                                            active={themeFilter === theme.id}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', backgroundColor: theme.color }}></div>
                                                {theme.label}
                                            </div>
                                        </Dropdown.Item>
                                    ))}
                                </Dropdown.Menu>
                            </Dropdown>

                            <Dropdown>
                                <Dropdown.Toggle variant="outline-secondary" size="sm" style={{ minWidth: '160px', maxWidth: '240px' }} className="text-truncate">
                                    {goalFilter ? (goals.find(g => g.id === goalFilter)?.title || 'Unknown Goal') : 'All Goals'}
                                </Dropdown.Toggle>
                                <Dropdown.Menu style={{ maxHeight: '400px', overflowY: 'auto', minWidth: '260px' }}>
                                    <div className="p-2 sticky-top bg-white border-bottom">
                                        <Form.Control
                                            size="sm"
                                            placeholder="Search goals..."
                                            value={goalSearch}
                                            onChange={(e) => setGoalSearch(e.target.value)}
                                            autoFocus
                                        />
                                    </div>
                                    <Dropdown.Item onClick={() => setGoalFilter(null)} active={goalFilter === null}>All Goals</Dropdown.Item>
                                    <Dropdown.Divider />
                                    {filteredGoals.length > 0 ? (
                                        filteredGoals.map(g => (
                                            <Dropdown.Item key={g.id} onClick={() => setGoalFilter(g.id)} active={goalFilter === g.id}>
                                                <div className="text-truncate" title={g.title}>{g.title}</div>
                                            </Dropdown.Item>
                                        ))
                                    ) : (
                                        <div className="p-2 text-muted small text-center">No goals found</div>
                                    )}
                                </Dropdown.Menu>
                            </Dropdown>

                            <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={() => window.location.href = '/sprints/planning'}
                                title="Planning Matrix"
                                style={{ padding: '6px 12px' }}
                            >
                                <LayoutGrid size={16} />
                            </Button>

                            <Form.Check
                                type="switch"
                                id="toggle-kanban-descriptions"
                                label="Show story descriptions"
                                checked={showDescriptions}
                                onChange={(e) => setShowDescriptions(e.target.checked)}
                                className="ms-2"
                            />
                            <Form.Check
                                type="switch"
                                id="toggle-kanban-notes"
                                label="Show latest notes"
                                checked={showLatestNotes}
                                onChange={(e) => setShowLatestNotes(e.target.checked)}
                                className="ms-2"
                            />

                            <Dropdown>
                                <Dropdown.Toggle variant="outline-secondary" size="sm">
                                    {dueFilter === 'today'
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
                                    <Dropdown.Item active={dueFilter === 'all'} onClick={() => setDueFilter('all')}>All</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'today'} onClick={() => setDueFilter('today')}>Due Today</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'overdue'} onClick={() => setDueFilter('overdue')}>Overdue</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'top3'} onClick={() => setDueFilter('top3')}>Top 3</Dropdown.Item>
                                    <Dropdown.Item active={dueFilter === 'critical'} onClick={() => setDueFilter('critical')}>Critical</Dropdown.Item>
                                </Dropdown.Menu>
                            </Dropdown>

                                <Form.Group className="ms-2">
                                    <Form.Select
                                        size="sm"
                                        value={sortBy}
                                        onChange={(e) => setSortBy(e.target.value as any)}
                                    >
                                        <option value="ai">Sort: AI score</option>
                                        <option value="due">Sort: Due date</option>
                                        <option value="priority">Sort: Priority</option>
                                        <option value="default">Sort: Default</option>
                                    </Form.Select>
                                </Form.Group>

                            <Button
                                variant="outline-secondary"
                                size="sm"
                                onClick={toggleFullscreen}
                                title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                                style={{ padding: '6px 12px' }}
                            >
                                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                            </Button>
                        </div>
                    </div>
                </Col>
            </Row>

            {/* Selected sprint helper + navigation + replanning actions */}
            {currentSprint && (
                <Row className="mb-3 flex-shrink-0">
                    <Col>
                        <div className="d-flex align-items-center justify-content-between p-2 border rounded" style={{ background: 'var(--notion-hover)' }}>
                            <div>
                                <strong>Selected sprint:</strong> {currentSprint.name || currentSprint.id}
                                {currentSprint.id && (
                                    <span className="ms-2">
                                        <span className="badge bg-light text-dark">
                                            {displayRefForEntity('sprint', currentSprint.id)}
                                        </span>
                                    </span>
                                )}
                            </div>
                            <div className="d-flex gap-2">
                                <Button
                                    variant="outline-secondary"
                                    size="sm"
                                    onClick={() => navigate('/dashboard')}
                                >
                                    View overview
                                </Button>
                                <Button
                                    variant="outline-secondary"
                                    size="sm"
                                    onClick={() => navigate('/sprints/planning')}
                                >
                                    View planner
                                </Button>
                                <Button
                                    variant="outline-primary"
                                    size="sm"
                                    onClick={handleDeltaReplan}
                                    disabled={replanLoading || fullReplanLoading}
                                    title="Delta replan: quickly rebalance existing calendar blocks using current priorities."
                                >
                                    {replanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
                                    Delta replan
                                </Button>
                                <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={handleFullReplan}
                                    disabled={fullReplanLoading || replanLoading}
                                    title="Full replan: runs full nightly orchestration (pointing, conversions, priority scoring, and calendar planning)."
                                >
                                    {fullReplanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <Sparkles size={14} className="me-1" />}
                                    Full replan
                                </Button>
                            </div>
                        </div>
                    </Col>
                </Row>
            )}
            {replanFeedback && (
                <Row className="mb-3 flex-shrink-0">
                    <Col>
                        <div className="text-muted small">{replanFeedback}</div>
                    </Col>
                </Row>
            )}

            {/* Sprint Metrics */}
            {currentSprint && (
                <Row className="mb-4 flex-shrink-0">
                    <Col>
                        <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
                            <Card.Body>
                                <Row>
                                    <Col md={3}>
                                            <div style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--green)' }}>
                                                {metrics.completedStories}/{metrics.totalStories}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Stories Done
                                            </div>
                                            <div style={{ marginTop: '4px' }}>
                                                <Badge bg="success" style={{ fontSize: '11px' }}>
                                                    {metrics.storyProgress}%
                                                </Badge>
                                            </div>
                                        </div>
                                    </Col>
                                    <Col md={3}>
                                                <div style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--brand)' }}>
                                                {metrics.completedTasks}/{metrics.totalTasks}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Tasks Completed
                                            </div>
                                            <div style={{ marginTop: '4px' }}>
                                                <Badge bg="primary" style={{ fontSize: '11px' }}>
                                                    {metrics.taskProgress}%
                                                </Badge>
                                            </div>
                                        </div>
                                    </Col>
                                    <Col md={3}>
                                                <div style={{ textAlign: 'center' }}>
                                                <div style={{ fontSize: '24px', fontWeight: '700', color: 'var(--purple)' }}>
                                                {metrics.completedPoints.toLocaleString()}/{metrics.totalPoints.toLocaleString()}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Story Points
                                            </div>
                                            <div style={{ marginTop: '4px' }}>
                                                <Badge bg="secondary" style={{ fontSize: '11px' }}>
                                                    {metrics.pointsProgress}%
                                                </Badge>
                                            </div>
                                        </div>
                                    </Col>
                                    <Col md={3}>
                                        <div style={{ textAlign: 'center' }}>
                                            <div style={{ fontSize: '20px', fontWeight: '700', color: 'var(--text)' }}>
                                                {currentSprint.name}
                                            </div>
                                            <div style={{ fontSize: '12px', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                Sprint Duration
                                            </div>
                                            <div style={{ marginTop: '4px', fontSize: '11px', color: 'var(--muted)' }}>
                                                {Math.ceil((currentSprint.endDate - currentSprint.startDate) / (1000 * 60 * 60 * 24))} days
                                            </div>
                                        </div>
                                    </Col>
                                </Row>
                            </Card.Body>
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Kanban Board */}
            <Row style={{ flex: 1, minHeight: 0 }} ref={boardContainerRef as any}>
                <Col style={{ height: '100%' }}>
                    <Card style={{ border: 'none', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', height: '100%', borderRadius: isFullscreen ? 0 : undefined }}>
                        <Card.Body style={{ padding: '24px', height: '100%', overflow: 'hidden', backgroundColor: isFullscreen ? 'var(--bg)' : undefined }}>
                                <KanbanBoardV2
                                    sprintId={filterSprintId}
                                    themeFilter={themeFilter}
                                    goalFilter={goalFilter}
                                    onItemSelect={(item, type) => showSidebar(item, type)}
                                    onEdit={handleEditItem}
                                    showDescriptions={showDescriptions}
                                    showLatestNotes={showLatestNotes}
                                    dueFilter={dueFilter}
                                    sortBy={sortBy}
                                    themes={globalThemes}
                                />
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

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
        </Container>
    );
};

export default SprintKanbanPageV2;
