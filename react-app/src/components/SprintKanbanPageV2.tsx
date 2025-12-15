import React, { useState, useEffect } from 'react';
import { Card, Container, Row, Col, Button, Dropdown, Badge, Form, Modal } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Story, Task, Goal } from '../types';
import KanbanBoardV2 from './KanbanBoardV2';
import { ChevronLeft, ChevronRight, Calendar, Target, BarChart3, Maximize2, Minimize2, Search, LayoutGrid } from 'lucide-react';
import { displayRefForEntity } from '../utils/referenceGenerator';
import { useSprint } from '../contexts/SprintContext';
import { isStatus } from '../utils/statusHelpers';
import { useSidebar } from '../contexts/SidebarContext';
import GLOBAL_THEMES from '../constants/globalThemes';
import SprintSelector from './SprintSelector';
import EditStoryModal from './EditStoryModal';

const SprintKanbanPageV2: React.FC = () => {
    const { currentUser } = useAuth();
    const { currentPersona } = usePersona();
    const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();
    const { isCollapsed, toggleCollapse, showSidebar } = useSidebar();

    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]); // Added goals state
    const [loading, setLoading] = useState(true);

    const [themeFilter, setThemeFilter] = useState<number | null>(null);
    const [goalFilter, setGoalFilter] = useState<string | null>(null);
    const [goalSearch, setGoalSearch] = useState('');
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showDescriptions, setShowDescriptions] = useState(false);
    const [editStory, setEditStory] = useState<Story | null>(null);
    const [editTask, setEditTask] = useState<Task | null>(null);
    const [taskForm, setTaskForm] = useState({
        title: '',
        description: '',
        status: 0 as number | string,
        priority: 2 as any,
        sprintId: '',
    });
    const [savingTask, setSavingTask] = useState(false);
    const boardContainerRef = React.useRef<HTMLDivElement>(null);

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

        const storiesQuery = query(
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

        // For metrics we need tasks too
        let tasksQuery;
        if (filterSprintId) {
            tasksQuery = query(
                collection(db, 'sprint_task_index'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                where('sprintId', '==', filterSprintId),
                where('isOpen', '==', true),
                limit(1000)
            );
        } else {
            tasksQuery = query(
                collection(db, 'sprint_task_index'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona),
                where('isOpen', '==', true),
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

    // Sprint metrics
    const getSprintMetrics = () => {
        const storyCompleted = (story: Story) => {
            const status = (story as any).status;
            return isStatus(status, 'done') || isStatus(status, 'Complete') || status === 4;
        };
        const taskCompleted = (task: Task) => {
            const status = (task as any).status;
            return isStatus(status, 'done') || isStatus(status, 'Complete') || status === 2;
        };

        const totalStories = sprintStories.length;
        const completedStories = sprintStories.filter(storyCompleted).length;
        const totalTasks = sprintTasks.length;
        const completedTasks = sprintTasks.filter(taskCompleted).length;
        const totalPoints = sprintStories.reduce((sum, story) => sum + (story.points || 0), 0);
        const completedPoints = sprintStories
            .filter(storyCompleted)
            .reduce((sum, story) => sum + (story.points || 0), 0);

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

    const normalizeTaskStatus = (status: any) => {
        if (typeof status === 'number') return status;
        const value = String(status || '').toLowerCase();
        if (value.includes('done') || value.includes('complete')) return 2;
        if (value.includes('progress') || value.includes('active')) return 1;
        if (value.includes('block')) return 3;
        return 0;
    };

    const normalizeTaskPriority = (priority: any) => {
        if (typeof priority === 'number') return priority;
        const value = String(priority || '').toLowerCase();
        if (value.includes('high')) return 1;
        if (value.includes('low')) return 3;
        return 2;
    };

    const handleEditItem = (item: Story | Task, type: 'story' | 'task') => {
        if (type === 'story') {
            setEditStory(item as Story);
        } else {
            const t = item as Task;
            setEditTask(t);
            setTaskForm({
                title: t.title || '',
                description: (t as any).description || '',
                status: normalizeTaskStatus((t as any).status),
                priority: normalizeTaskPriority((t as any).priority),
                sprintId: (t as any).sprintId || '',
            });
        }
    };

    const handleSaveTask = async () => {
        if (!editTask) return;
        setSavingTask(true);
        try {
            const updates: any = {
                title: taskForm.title.trim() || editTask.title,
                description: taskForm.description,
                status: typeof taskForm.status === 'string' ? Number(taskForm.status) || taskForm.status : taskForm.status,
                priority: taskForm.priority,
                sprintId: taskForm.sprintId || null,
                updatedAt: serverTimestamp()
            };
            await updateDoc(doc(db, 'tasks', editTask.id), updates);
            setEditTask(null);
        } catch (e) {
            console.error('Failed to update task', e);
            alert('Failed to update task. Please try again.');
        } finally {
            setSavingTask(false);
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
                            Sprint Kanban V2
                        </h2>

                        <Badge bg="primary" style={{ fontSize: '12px', padding: '6px 12px' }}>
                            {currentPersona.charAt(0).toUpperCase() + currentPersona.slice(1)} Persona
                        </Badge>
                    </div>

                    {/* Sprint Selector + Sidebar collapse */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {/* Removed inline sprint selector to avoid duplication with global selector */}

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

            {/* Helper: Assign unassigned stories to the selected sprint */}
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
                                    variant="outline-primary"
                                    size="sm"
                                    onClick={async () => {
                                        try {
                                            const unassigned = stories.filter(s => !('sprintId' in s) || !(s as any).sprintId);
                                            const toAssign = unassigned.slice(0, 10);
                                            if (toAssign.length === 0) {
                                                alert('No unassigned stories found.');
                                                return;
                                            }
                                            const ops = toAssign.map(s => updateDoc(doc(db, 'stories', s.id), { sprintId: currentSprint.id, updatedAt: serverTimestamp() } as any));
                                            await Promise.all(ops);
                                        } catch (e) {
                                            console.error('Failed to assign stories to sprint', e);
                                            alert('Failed to assign stories.');
                                        }
                                    }}
                                >
                                    Assign unassigned stories to this sprint
                                </Button>
                            </div>
                        </div>
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
                                                {metrics.completedPoints}/{metrics.totalPoints}
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

            <Modal show={!!editTask} onHide={() => setEditTask(null)} container={boardContainerRef.current ?? undefined}>
                <Modal.Header closeButton>
                    <Modal.Title>Edit Task</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {editTask ? (
                        <Form>
                            <Form.Group className="mb-3">
                                <Form.Label>Title</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={taskForm.title}
                                    onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })}
                                />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Description</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    value={taskForm.description}
                                    onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })}
                                />
                            </Form.Group>
                            <Row>
                                <Col md={4}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Status</Form.Label>
                                        <Form.Select
                                            value={String(taskForm.status)}
                                            onChange={(e) => setTaskForm({ ...taskForm, status: Number(e.target.value) })}
                                        >
                                            <option value={0}>Backlog</option>
                                            <option value={1}>In Progress</option>
                                            <option value={2}>Done</option>
                                            <option value={3}>Blocked</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={4}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Priority</Form.Label>
                                        <Form.Select
                                            value={String(taskForm.priority)}
                                            onChange={(e) => setTaskForm({ ...taskForm, priority: Number(e.target.value) })}
                                        >
                                            <option value={1}>High</option>
                                            <option value={2}>Medium</option>
                                            <option value={3}>Low</option>
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                                <Col md={4}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Sprint</Form.Label>
                                        <Form.Select
                                            value={taskForm.sprintId || ''}
                                            onChange={(e) => setTaskForm({ ...taskForm, sprintId: e.target.value })}
                                        >
                                            <option value="">Backlog</option>
                                            {sprints.map((s) => (
                                                <option key={s.id} value={s.id}>
                                                    {s.name}
                                                </option>
                                            ))}
                                        </Form.Select>
                                    </Form.Group>
                                </Col>
                            </Row>
                        </Form>
                    ) : null}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setEditTask(null)}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleSaveTask} disabled={savingTask}>
                        {savingTask ? 'Saving...' : 'Save'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default SprintKanbanPageV2;
