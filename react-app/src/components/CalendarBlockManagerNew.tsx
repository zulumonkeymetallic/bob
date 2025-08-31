import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CalendarBlock, Story, Task, IHabit } from '../types';
import { Container, Row, Col, Card, Button, Modal, Form, Alert } from 'react-bootstrap';

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
    const [loading, setLoading] = useState(true);
    const [aiScheduling, setAiScheduling] = useState(false);

    const [newBlock, setNewBlock] = useState({
        theme: 'Health' as 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home',
        subTheme: '',
        category: 'Fitness' as 'Tribe' | 'Chores' | 'Gaming' | 'Fitness' | 'Wellbeing' | 'Sauna' | 'Sleep',
        start: '',
        end: '',
        flexibility: 'soft' as 'hard' | 'soft',
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
        const habitsQuery = query(collection(db, 'habits'), where('userId', '==', currentUser.uid));

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
                status: 'proposed',
                colorId: null,
                visibility: 'default',
                createdBy: 'user',
                rationale: 'Manual block creation',
                version: 1,
                supersededBy: null,
                ownerUid: currentUser.uid,
                createdAt: startTime,
                updatedAt: startTime
            });

            setNewBlock({
                theme: 'Health',
                subTheme: '',
                category: 'Fitness',
                start: '',
                end: '',
                flexibility: 'soft',
                storyId: '',
                taskId: '',
                habitId: ''
            });
            setShowBlockModal(false);
        } catch (error) {
            console.error('Error creating calendar block:', error);
        }
    };

    const triggerAiScheduling = async () => {
        setAiScheduling(true);
        try {
            // This would trigger the AI scheduling function
            // For now, just a placeholder
            console.log('AI scheduling triggered');
            // In real implementation, this would call a Cloud Function
            setTimeout(() => setAiScheduling(false), 3000);
        } catch (error) {
            console.error('Error triggering AI scheduling:', error);
            setAiScheduling(false);
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
                                                    <div>
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
            <Modal show={showBlockModal} onHide={() => setShowBlockModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Create Calendar Block</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
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
                    <Button 
                        variant="primary" 
                        onClick={handleCreateBlock}
                        disabled={!newBlock.start || !newBlock.end}
                    >
                        Create Block
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default CalendarBlockManager;
