import React, { useState, useEffect } from 'react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Story, Sprint, Goal } from '../types';
import { Container, Row, Col, Card, Button, Modal, Form } from 'react-bootstrap';

const SprintPlanner: React.FC = () => {
    const { currentUser } = useAuth();
    const [stories, setStories] = useState<Story[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSprintModal, setShowSprintModal] = useState(false);
    const [newSprint, setNewSprint] = useState({
        name: '',
        objective: '',
        notes: '',
        startDate: '',
        endDate: ''
    });

    // Theme colors for visual consistency
    const themeColors = {
        'Health': '#22c55e',
        'Growth': '#3b82f6', 
        'Wealth': '#eab308',
        'Tribe': '#8b5cf6',
        'Home': '#f97316'
    };

    useEffect(() => {
        if (!currentUser) return;

        console.log('SprintPlanner: Loading data for user:', currentUser.uid);
        
        try {
            const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
            const sprintsQuery = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));
            const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));

            const unsubscribeStories = onSnapshot(storiesQuery, 
                snapshot => {
                    const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
                    console.log('SprintPlanner: Loaded stories:', storiesData.length);
                    setStories(storiesData.sort((a, b) => a.orderIndex - b.orderIndex));
                    setLoading(false);
                },
                error => {
                    console.error('SprintPlanner: Error loading stories:', error);
                    setLoading(false);
                }
            );

            const unsubscribeSprints = onSnapshot(sprintsQuery,
                snapshot => {
                    const sprintsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sprint));
                    console.log('SprintPlanner: Loaded sprints:', sprintsData.length);
                    setSprints(sprintsData.sort((a, b) => a.startDate - b.startDate));
                },
                error => {
                    console.error('SprintPlanner: Error loading sprints:', error);
                }
            );

            const unsubscribeGoals = onSnapshot(goalsQuery,
                snapshot => {
                    const goalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal));
                    console.log('SprintPlanner: Loaded goals:', goalsData.length);
                    setGoals(goalsData);
                },
                error => {
                    console.error('SprintPlanner: Error loading goals:', error);
                }
            );

            return () => {
                unsubscribeStories();
                unsubscribeSprints();
                unsubscribeGoals();
            };
        } catch (error) {
            console.error('SprintPlanner: Error setting up listeners:', error);
            setLoading(false);
        }
    }, [currentUser]);

    const handleDrop = async (storyId: string, sprintId: string | null) => {
        try {
            const storyRef = doc(db, 'stories', storyId);
            await updateDoc(storyRef, { 
                sprintId: sprintId,
                updatedAt: serverTimestamp()
            });
            
            // Log to activity_stream
            await addDoc(collection(db, 'activity_stream'), {
                ownerUid: currentUser?.uid,
                activityType: 'sprint_changed',
                entityType: 'story',
                entityId: storyId,
                newValue: sprintId,
                createdAt: serverTimestamp()
            });
        } catch (error) {
            console.error("Error updating story sprint:", error);
        }
    };

    const generateSprintRef = () => {
        const maxRef = sprints.reduce((max, sprint) => {
            const refNumber = parseInt(sprint.ref?.replace('SPR-', '') || '0');
            return refNumber > max ? refNumber : max;
        }, 0);
        return `SPR-${String(maxRef + 1).padStart(3, '0')}`;
    };

    const handleCreateSprint = async () => {
        if (!currentUser || !newSprint.name.trim()) return;

        try {
            await addDoc(collection(db, 'sprints'), {
                ref: generateSprintRef(),
                name: newSprint.name,
                objective: newSprint.objective,
                notes: newSprint.notes,
                status: 'planned',
                startDate: new Date(newSprint.startDate).getTime(),
                endDate: new Date(newSprint.endDate).getTime(),
                planningDate: new Date().getTime(),
                retroDate: new Date(newSprint.endDate).getTime() + 86400000, // Next day
                ownerUid: currentUser.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            setNewSprint({
                name: '',
                objective: '',
                notes: '',
                startDate: '',
                endDate: ''
            });
            setShowSprintModal(false);
        } catch (error) {
            console.error('Error creating sprint:', error);
        }
    };

    const getGoalForStory = (story: Story) => {
        return goals.find(g => g.id === story.goalId);
    };

    // Draggable Story Card Component
    const DraggableStoryCard: React.FC<{ story: Story }> = ({ story }) => {
        const goal = getGoalForStory(story);
        const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';

        const [{ isDragging }, drag] = useDrag({
            type: 'story',
            item: { id: story.id },
            collect: (monitor) => ({
                isDragging: monitor.isDragging(),
            }),
        });

        return (
            <div
                ref={drag}
                className="card mb-2"
                style={{
                    opacity: isDragging ? 0.5 : 1,
                    cursor: 'move',
                    borderLeft: `4px solid ${themeColor}`
                }}
            >
                <div className="card-body p-2">
                    <div className="d-flex justify-content-between align-items-start">
                        <div>
                            <h6 className="card-title mb-1">{story.title}</h6>
                            <small className="text-muted">
                                {goal?.title} • {story.priority} • {story.points}pts
                            </small>
                        </div>
                        <span className="badge badge-primary">{story.ref || story.id.slice(-4)}</span>
                    </div>
                    {story.description && (
                        <p className="card-text mt-1" style={{ fontSize: '0.85rem' }}>
                            {story.description.substring(0, 60)}
                            {story.description.length > 60 && '...'}
                        </p>
                    )}
                </div>
            </div>
        );
    };

    // Drop Zone Component
    const DropZone: React.FC<{ 
        children: React.ReactNode; 
        sprintId: string | null; 
        title: string;
        onDrop: (storyId: string, sprintId: string | null) => void;
    }> = ({ children, sprintId, title, onDrop }) => {
        const [{ isOver }, drop] = useDrop({
            accept: 'story',
            drop: (item: { id: string }) => {
                onDrop(item.id, sprintId);
            },
            collect: (monitor) => ({
                isOver: monitor.isOver(),
            }),
        });

        return (
            <div
                ref={drop}
                style={{
                    backgroundColor: isOver ? '#f8f9fa' : 'white',
                    minHeight: '400px',
                    border: isOver ? '2px dashed #007bff' : '1px solid #dee2e6'
                }}
                className="p-3 rounded"
            >
                <h5 className="mb-3">{title}</h5>
                {children}
            </div>
        );
    };

    if (loading) {
        return (
            <Container fluid className="p-3">
                <div className="d-flex justify-content-center align-items-center" style={{ height: '50vh' }}>
                    <div className="text-center">
                        <div className="spinner-border text-primary" role="status">
                            <span className="visually-hidden">Loading...</span>
                        </div>
                        <p className="mt-3 text-muted">Loading Sprint Planning...</p>
                    </div>
                </div>
            </Container>
        );
    }

    if (!currentUser) {
        return (
            <Container fluid className="p-3">
                <div className="alert alert-warning" role="alert">
                    Please sign in to access Sprint Planning.
                </div>
            </Container>
        );
    }

    const backlogStories = stories.filter(s => !s.sprintId);
    const groupedBacklog = backlogStories.reduce((groups, story) => {
        const goal = getGoalForStory(story);
        const theme = goal?.theme || 'Other';
        if (!groups[theme]) groups[theme] = [];
        groups[theme].push(story);
        return groups;
    }, {} as Record<string, Story[]>);

    // Show empty state if no stories exist
    if (stories.length === 0) {
        return (
            <Container fluid className="p-3">
                <div className="d-flex justify-content-between align-items-center mb-4">
                    <h1 className="h3 mb-0">Sprint Planning</h1>
                    <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                        Create Sprint
                    </Button>
                </div>
                <div className="text-center py-5">
                    <h4 className="text-muted mb-3">No Stories Available</h4>
                    <p className="text-muted">Create some stories first to start sprint planning.</p>
                    <Button variant="outline-primary" href="/stories">
                        Go to Stories Management
                    </Button>
                </div>
            </Container>
        );
    }

    return (
        <DndProvider backend={HTML5Backend}>
            <Container fluid className="p-3">
                <div className="d-flex justify-content-between align-items-center mb-4">
                    <h1 className="h3 mb-0">Sprint Planning</h1>
                    <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                        Create Sprint
                    </Button>
                </div>
                
                <Row>
                    <Col md={4}>
                        <DropZone 
                            sprintId={null} 
                            title="Backlog" 
                            onDrop={handleDrop}
                        >
                            {Object.entries(groupedBacklog).map(([theme, themeStories]) => (
                                <div key={theme} className="mb-3">
                                    <h6 
                                        className="mb-2 px-2 py-1 rounded"
                                        style={{ 
                                            backgroundColor: themeColors[theme as keyof typeof themeColors] || '#6b7280',
                                            color: 'white',
                                            fontSize: '0.85rem'
                                        }}
                                    >
                                        {theme} ({themeStories.length})
                                    </h6>
                                    {themeStories.map(story => (
                                        <DraggableStoryCard key={story.id} story={story} />
                                    ))}
                                </div>
                            ))}
                            {backlogStories.length === 0 && (
                                <div className="text-center text-muted py-4">
                                    <p>No stories in backlog</p>
                                </div>
                            )}
                        </DropZone>
                    </Col>
                    
                    <Col md={8}>
                        <Row>
                            {sprints.map(sprint => {
                                const sprintStories = stories.filter(s => s.sprintId === sprint.id);
                                const totalPoints = sprintStories.reduce((sum, s) => sum + s.points, 0);
                                
                                return (
                                    <Col key={sprint.id} md={4} className="mb-4">
                                        <DropZone 
                                            sprintId={sprint.id} 
                                            title={`${sprint.name} (${totalPoints}pts)`}
                                            onDrop={handleDrop}
                                        >
                                            <div className="mb-2">
                                                <small className="text-muted d-block">
                                                    {sprint.ref} • {sprint.status}
                                                </small>
                                                {sprint.objective && (
                                                    <small className="text-muted d-block">
                                                        {sprint.objective}
                                                    </small>
                                                )}
                                            </div>
                                            {sprintStories.map(story => (
                                                <DraggableStoryCard key={story.id} story={story} />
                                            ))}
                                            {sprintStories.length === 0 && (
                                                <div className="text-center text-muted py-2">
                                                    <small>Drop stories here</small>
                                                </div>
                                            )}
                                        </DropZone>
                                    </Col>
                                );
                            })}
                            {sprints.length === 0 && (
                                <Col>
                                    <div className="text-center text-muted py-5">
                                        <p>No sprints created yet.</p>
                                        <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                                            Create First Sprint
                                        </Button>
                                    </div>
                                </Col>
                            )}
                        </Row>
                    </Col>
                </Row>

                {/* Create Sprint Modal */}
                <Modal show={showSprintModal} onHide={() => setShowSprintModal(false)} size="lg">
                    <Modal.Header closeButton>
                        <Modal.Title>Create New Sprint</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <Form>
                            <Form.Group className="mb-3">
                                <Form.Label>Sprint Name *</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={newSprint.name}
                                    onChange={(e) => setNewSprint({...newSprint, name: e.target.value})}
                                    placeholder="e.g., Sprint 1"
                                />
                            </Form.Group>
                            <Form.Group className="mb-3">
                                <Form.Label>Objective</Form.Label>
                                <Form.Control
                                    type="text"
                                    value={newSprint.objective}
                                    onChange={(e) => setNewSprint({...newSprint, objective: e.target.value})}
                                    placeholder="What should this sprint achieve?"
                                />
                            </Form.Group>
                            <Row>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>Start Date *</Form.Label>
                                        <Form.Control
                                            type="date"
                                            value={newSprint.startDate}
                                            onChange={(e) => setNewSprint({...newSprint, startDate: e.target.value})}
                                        />
                                    </Form.Group>
                                </Col>
                                <Col md={6}>
                                    <Form.Group className="mb-3">
                                        <Form.Label>End Date *</Form.Label>
                                        <Form.Control
                                            type="date"
                                            value={newSprint.endDate}
                                            onChange={(e) => setNewSprint({...newSprint, endDate: e.target.value})}
                                        />
                                    </Form.Group>
                                </Col>
                            </Row>
                            <Form.Group className="mb-3">
                                <Form.Label>Notes</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    value={newSprint.notes}
                                    onChange={(e) => setNewSprint({...newSprint, notes: e.target.value})}
                                    placeholder="Additional notes about this sprint"
                                />
                            </Form.Group>
                        </Form>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button variant="secondary" onClick={() => setShowSprintModal(false)}>
                            Cancel
                        </Button>
                        <Button 
                            variant="primary" 
                            onClick={handleCreateSprint}
                            disabled={!newSprint.name.trim() || !newSprint.startDate || !newSprint.endDate}
                        >
                            Create Sprint
                        </Button>
                    </Modal.Footer>
                </Modal>
            </Container>
        </DndProvider>
    );
};

export default SprintPlanner;
