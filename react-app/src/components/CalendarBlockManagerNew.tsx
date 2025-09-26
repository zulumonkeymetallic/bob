import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CalendarBlock, Story, Task, IHabit } from '../types';
import { Container, Row, Col, Card, Button, Modal, Form, Alert } from 'react-bootstrap';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { httpsCallable } from 'firebase/functions';

interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    backgroundColor: string;
    extendedProps: {
        block: CalendarBlock;
        entity?: Story | Task | IHabit;
    };
}

const CalendarBlockManager: React.FC = () => {
    const { currentUser } = useAuth();
    const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [habits, setHabits] = useState<IHabit[]>([]);
    const [showBlockModal, setShowBlockModal] = useState(false);
    const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [aiScheduling, setAiScheduling] = useState(false);
    const [aiMessage, setAiMessage] = useState<string | null>(null);
    const [aiVariant, setAiVariant] = useState<'info' | 'success' | 'warning' | 'danger'>('info');
    const [formError, setFormError] = useState<string | null>(null);

    const [newBlock, setNewBlock] = useState({
        theme: 'Health' as 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home',
        subTheme: '',
        category: 'Fitness' as 'Tribe' | 'Chores' | 'Gaming' | 'Fitness' | 'Wellbeing' | 'Sauna' | 'Sleep',
        start: '',
        end: '',
        flexibility: 'soft' as 'hard' | 'soft',
        status: 'proposed' as 'proposed' | 'applied',
        storyId: '',
        taskId: '',
        habitId: ''
    });

    const themeColors = {
        'Health': '#22c55e',
        'Growth': '#3b82f6', 
        'Wealth': '#eab308',
        'Tribe': '#8b5cf6',
        'Home': '#f97316'
    };

    useEffect(() => {
        if (!currentUser) return;

        const blocksQuery = query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid));
        const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
        const tasksQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
        const habitsQuery = query(collection(db, 'habits'), where('ownerUid', '==', currentUser.uid));

        const unsubscribeBlocks = onSnapshot(blocksQuery, snapshot => {
            const blocksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CalendarBlock));
            setBlocks(blocksData);
            setLoading(false);
        });

        const unsubscribeStories = onSnapshot(storiesQuery, snapshot => {
            const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
            setStories(storiesData);
        });

        const unsubscribeTasks = onSnapshot(tasksQuery, snapshot => {
            const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
            setTasks(tasksData);
        });

        const unsubscribeHabits = onSnapshot(habitsQuery, snapshot => {
            const habitsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IHabit));
            setHabits(habitsData);
        });

        return () => {
            unsubscribeBlocks();
            unsubscribeStories();
            unsubscribeTasks();
            unsubscribeHabits();
        };
    }, [currentUser]);

    const handleCreateBlock = async () => {
        if (!currentUser || !newBlock.start || !newBlock.end) return;

        try {
            const startTime = new Date(newBlock.start).getTime();
            const endTime = new Date(newBlock.end).getTime();

            if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
                setFormError('Please provide valid start and end times.');
                return;
            }
            if (endTime <= startTime) {
                setFormError('End time must be after start time.');
                return;
            }

            // Overlap detection: prevent conflicts with hard/applied blocks
            const overlapAny = blocks
              .filter(b => b.ownerUid === currentUser.uid)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime));
            const overlapHard = blocks
              .filter(b => b.ownerUid === currentUser.uid)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime) && (b.flexibility === 'hard' || b.status === 'applied'));
            if (overlapHard && (newBlock.flexibility === 'hard' || newBlock.status === 'applied')) {
                setFormError('Time window conflicts with an existing applied/hard block. Switch to Soft/Proposed or adjust times.');
                return;
            }
            if (overlapAny && !(newBlock.flexibility === 'hard' || newBlock.status === 'applied')) {
                setAiMessage('⚠️ Overlaps existing block(s). Saved as proposed/soft.');
                setAiVariant('warning');
                setTimeout(() => setAiMessage(null), 4500);
            }

            await addDoc(collection(db, 'calendar_blocks'), {
                googleEventId: null,
                taskId: newBlock.taskId || null,
                goalId: null,
                storyId: newBlock.storyId || null,
                habitId: newBlock.habitId || null,
                subTheme: newBlock.subTheme || null,
                persona: 'personal',
                theme: newBlock.theme,
                category: newBlock.category,
                start: startTime,
                end: endTime,
                flexibility: newBlock.flexibility,
                status: newBlock.status,
                colorId: null,
                visibility: 'default',
                createdBy: 'user',
                rationale: 'Manual block creation',
                version: 1,
                supersededBy: null,
                ownerUid: currentUser.uid,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            setNewBlock({
                theme: 'Health',
                subTheme: '',
                category: 'Fitness',
                start: '',
                end: '',
                flexibility: 'soft',
                status: 'proposed',
                storyId: '',
                taskId: '',
                habitId: ''
            });
            setFormError(null);
            setShowBlockModal(false);
        } catch (error) {
            console.error('Error creating calendar block:', error);
        }
    };

    const openEditModal = (block: CalendarBlock) => {
        setEditingBlockId(block.id);
        setNewBlock({
            theme: block.theme,
            subTheme: block.subTheme || '',
            category: block.category,
            start: new Date(block.start).toISOString().slice(0,16),
            end: new Date(block.end).toISOString().slice(0,16),
            flexibility: block.flexibility,
            status: (block.status === 'proposed' || block.status === 'applied') ? block.status : 'proposed',
            storyId: block.storyId || '',
            taskId: block.taskId || '',
            habitId: block.habitId || ''
        });
        setFormError(null);
        setShowBlockModal(true);
    };

    const handleUpdateBlock = async () => {
        if (!currentUser || !editingBlockId || !newBlock.start || !newBlock.end) return;
        try {
            const startTime = new Date(newBlock.start).getTime();
            const endTime = new Date(newBlock.end).getTime();
            if (Number.isNaN(startTime) || Number.isNaN(endTime)) { setFormError('Please provide valid start and end times.'); return; }
            if (endTime <= startTime) { setFormError('End time must be after start time.'); return; }
            const overlapAny = blocks
              .filter(b => b.ownerUid === currentUser.uid && b.id !== editingBlockId)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime));
            const overlapHard = blocks
              .filter(b => b.ownerUid === currentUser.uid && b.id !== editingBlockId)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime) && (b.flexibility === 'hard' || b.status === 'applied'));
            if (overlapHard && (newBlock.flexibility === 'hard' || newBlock.status === 'applied')) { setFormError('Time window conflicts with an existing applied/hard block.'); return; }
            if (overlapAny && !(newBlock.flexibility === 'hard' || newBlock.status === 'applied')) {
              setAiMessage('⚠️ Overlaps existing block(s). Saved as proposed/soft.');
              setAiVariant('warning');
              setTimeout(() => setAiMessage(null), 4500);
            }

            await updateDoc(doc(db, 'calendar_blocks', editingBlockId), {
                theme: newBlock.theme,
                subTheme: newBlock.subTheme || null,
                category: newBlock.category,
                start: startTime,
                end: endTime,
                flexibility: newBlock.flexibility,
                status: newBlock.status,
                storyId: newBlock.storyId || null,
                habitId: newBlock.habitId || null,
                updatedAt: Date.now()
            });

            setEditingBlockId(null);
            setShowBlockModal(false);
        } catch (e) {
            console.error('Failed to update block', e);
        }
    };

    const handleDeleteBlock = async (blockId: string) => {
        if (!blockId) return;
        const ok = window.confirm('Delete this time block? This cannot be undone.');
        if (!ok) return;
        try {
            await deleteDoc(doc(db, 'calendar_blocks', blockId));
        } catch (e) {
            console.error('Failed to delete block', e);
            alert('Failed to delete block.');
        }
    };

    const triggerAiScheduling = async () => {
        setAiScheduling(true);
        try {
            const planCalendar = httpsCallable(functions, 'planCalendar');
            const startDate = new Date().toISOString().split('T')[0];
            const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            setAiMessage('🤖 Planning your calendar for the next 7 days...');
            setAiVariant('info');
            const result = await planCalendar({ startDate, endDate, persona: 'personal' });
            const data = result.data as any;
            const created = Number((data && (data.blocksCreated ?? data.created ?? 0)) || 0);
            if (created > 0) {
                setAiMessage(`✅ Scheduled ${created} new time block${created===1?'':'s'}.`);
                setAiVariant('success');
            } else {
                setAiMessage('⚠️ No open slots found to schedule.');
                setAiVariant('warning');
            }
        } catch (error: any) {
            console.error('Error triggering AI scheduling:', error);
            setAiMessage('❌ Failed to trigger AI scheduling: ' + (error?.message || 'unknown'));
            setAiVariant('danger');
        } finally {
            setAiScheduling(false);
            // Auto-dismiss after a few seconds
            setTimeout(() => setAiMessage(null), 5500);
        }
    };

    if (loading) {
        return <div className="d-flex justify-content-center p-5"><div className="spinner-border" role="status"></div></div>;
    }

    return (
        <Container fluid className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="h3 mb-0">Calendar & Time Blocking</h1>
                <div>
                    <Button 
                        variant="outline-primary" 
                        className="me-2"
                        onClick={triggerAiScheduling}
                        disabled={aiScheduling}
                    >
                        {aiScheduling ? 'AI Scheduling...' : 'Trigger AI Scheduling'}
                    </Button>
                    <Button variant="primary" onClick={() => setShowBlockModal(true)}>
                        Create Time Block
                    </Button>
                </div>
            </div>

            <Row>
                <Col md={8}>
                    <Card>
                        <Card.Header>Calendar Blocks</Card.Header>
                        <Card.Body>
                            {aiMessage && (
                                <Alert variant={aiVariant} className="mb-3" onClose={() => setAiMessage(null)} dismissible>
                                    {aiMessage}
                                </Alert>
                            )}
                            {blocks.length === 0 ? (
                                <div className="text-center text-muted py-4">
                                    <p>No calendar blocks created yet.</p>
                                    <Button variant="primary" onClick={() => setShowBlockModal(true)}>
                                        Create First Block
                                    </Button>
                                </div>
                            ) : (
                                <div className="calendar-blocks">
                                    {blocks.map(block => (
                                        <Card key={block.id} className="mb-2">
                                            <Card.Body>
                                                <div className="d-flex justify-content-between align-items-start">
                                                    <div className="calendar-block" data-theme={block.theme} style={{ border: '1px solid transparent', borderRadius: 8, padding: '6px 8px' }}>
                                                        <h6 className="mb-1">
                                                            {block.theme} - {block.category}
                                                            {block.subTheme && ` (${block.subTheme})`}
                                                        </h6>
                                                        <small className="text-muted">
                                                            {new Date(block.start).toLocaleString()} - {new Date(block.end).toLocaleString()}
                                                        </small>
                                                        <br />
                                                        <small className="text-muted">
                                                            {block.flexibility} • {block.status} • by {block.createdBy}
                                                        </small>
                                                    </div>
                                                    <span 
                                                        className="badge"
                                                        style={{ 
                                                            backgroundColor: themeColors[block.theme],
                                                            color: 'white'
                                                        }}
                                                    >
                                                        {block.theme}
                                                    </span>
                                                </div>
                                                {block.rationale && (
                                                    <p className="mt-2 mb-0 text-muted" style={{ fontSize: '0.85rem' }}>
                                                        {block.rationale}
                                                    </p>
                                                )}
                                                <div className="d-flex gap-2 mt-2">
                                                    <Button size="sm" variant="outline-secondary" onClick={() => openEditModal(block)}>
                                                        Edit
                                                    </Button>
                                                    <Button size="sm" variant="outline-danger" onClick={() => handleDeleteBlock(block.id!)}>
                                                        Delete
                                                    </Button>
                                                </div>
                                            </Card.Body>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={4}>
                    <Card className="mb-3">
                        <Card.Header>Quick Stats</Card.Header>
                        <Card.Body>
                            <div className="mb-2">
                                <strong>Total Blocks:</strong> {blocks.length}
                            </div>
                            <div className="mb-2">
                                <strong>Active Blocks:</strong> {blocks.filter(b => b.status === 'applied').length}
                            </div>
                            <div className="mb-2">
                                <strong>Proposed Blocks:</strong> {blocks.filter(b => b.status === 'proposed').length}
                            </div>
                        </Card.Body>
                    </Card>

                    <Alert variant="info">
                        <Alert.Heading>AI Scheduling</Alert.Heading>
                        <p>
                            AI will automatically fill unblocked time based on task importance, 
                            due dates, and your weekly theme targets.
                        </p>
                        <Button variant="outline-info" size="sm" onClick={triggerAiScheduling}>
                            Learn More
                        </Button>
                    </Alert>
                </Col>
            </Row>

            {/* Create Block Modal */}
            <Modal show={showBlockModal} onHide={() => { setShowBlockModal(false); setEditingBlockId(null); }} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>{editingBlockId ? 'Edit Calendar Block' : 'Create Calendar Block'}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        {formError && <Alert variant="danger">{formError}</Alert>}
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Theme *</Form.Label>
                                    <Form.Select
                                        value={newBlock.theme}
                                        onChange={(e) => setNewBlock({...newBlock, theme: e.target.value as any})}
                                    >
                                        {Object.keys(themeColors).map(theme => (
                                            <option key={theme} value={theme}>{theme}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Category *</Form.Label>
                                    <Form.Select
                                        value={newBlock.category}
                                        onChange={(e) => setNewBlock({...newBlock, category: e.target.value as any})}
                                    >
                                        <option value="Fitness">Fitness</option>
                                        <option value="Wellbeing">Wellbeing</option>
                                        <option value="Tribe">Tribe</option>
                                        <option value="Chores">Chores</option>
                                        <option value="Gaming">Gaming</option>
                                        <option value="Sauna">Sauna</option>
                                        <option value="Sleep">Sleep</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Group className="mb-3">
                            <Form.Label>Sub-theme</Form.Label>
                            <Form.Control
                                type="text"
                                value={newBlock.subTheme}
                                onChange={(e) => setNewBlock({...newBlock, subTheme: e.target.value})}
                                placeholder="e.g., Cardio, Reading, Cooking"
                            />
                        </Form.Group>

                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Start Time *</Form.Label>
                                    <Form.Control
                                        type="datetime-local"
                                        value={newBlock.start}
                                        onChange={(e) => setNewBlock({...newBlock, start: e.target.value})}
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>End Time *</Form.Label>
                                    <Form.Control
                                        type="datetime-local"
                                        value={newBlock.end}
                                        onChange={(e) => setNewBlock({...newBlock, end: e.target.value})}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Group className="mb-3">
                            <Form.Label>Flexibility</Form.Label>
                            <Form.Select
                                value={newBlock.flexibility}
                                onChange={(e) => setNewBlock({...newBlock, flexibility: e.target.value as any})}
                            >
                                <option value="soft">Soft (moveable)</option>
                                <option value="hard">Hard (fixed)</option>
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Status</Form.Label>
                            <Form.Select
                                value={newBlock.status}
                                onChange={(e) => setNewBlock({...newBlock, status: e.target.value as any})}
                            >
                                <option value="proposed">Proposed</option>
                                <option value="applied">Applied</option>
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Link to Story</Form.Label>
                            <Form.Select
                                value={newBlock.storyId}
                                onChange={(e) => setNewBlock({...newBlock, storyId: e.target.value})}
                            >
                                <option value="">No story</option>
                                {stories.map(story => (
                                    <option key={story.id} value={story.id}>{story.title}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Link to Habit</Form.Label>
                            <Form.Select
                                value={newBlock.habitId}
                                onChange={(e) => setNewBlock({...newBlock, habitId: e.target.value})}
                            >
                                <option value="">No habit</option>
                                {habits.map(habit => (
                                    <option key={habit.id} value={habit.id}>{habit.name}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowBlockModal(false)}>
                        Cancel
                    </Button>
                    {editingBlockId ? (
                        <Button 
                            variant="primary" 
                            onClick={handleUpdateBlock}
                            disabled={!newBlock.start || !newBlock.end}
                        >
                            Save Changes
                        </Button>
                    ) : (
                        <Button 
                            variant="primary" 
                            onClick={handleCreateBlock}
                            disabled={!newBlock.start || !newBlock.end}
                        >
                            Create Block
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default CalendarBlockManager;
