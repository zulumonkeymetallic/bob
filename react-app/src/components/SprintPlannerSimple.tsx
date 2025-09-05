import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Story, Sprint, Goal } from '../types';
import { Container, Row, Col, Card, Button, Modal, Form } from 'react-bootstrap';

const SprintPlannerSimple: React.FC = () => {
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
                    setStories(storiesData.sort((a, b) => (a.orderIndex || 0) - (b.orderIndex || 0)));
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
                    setSprints(sprintsData.sort((a, b) => (a.startDate || 0) - (b.startDate || 0)));
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

    const getGoalForStory = (story: Story): Goal | undefined => {
        return goals.find(g => g.id === story.goalId);
    };

    const handleAssignToSprint = async (storyId: string, sprintId: string) => {
        try {
            const storyRef = doc(db, 'stories', storyId);
            await updateDoc(storyRef, { 
                sprintId: sprintId,
                updatedAt: serverTimestamp()
            });
            
            console.log('Story assigned to sprint:', storyId, sprintId);
        } catch (error) {
            console.error('Error assigning story to sprint:', error);
        }
    };

    const handleCreateSprint = async () => {
        if (!currentUser || !newSprint.name.trim()) return;

        try {
            const sprintRef = await addDoc(collection(db, 'sprints'), {
                name: newSprint.name,
                objective: newSprint.objective,
                notes: newSprint.notes,
                startDate: newSprint.startDate ? new Date(newSprint.startDate).getTime() : null,
                endDate: newSprint.endDate ? new Date(newSprint.endDate).getTime() : null,
                status: 'planned',
                ownerUid: currentUser.uid,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            });

            console.log('Sprint created:', sprintRef.id);
            setShowSprintModal(false);
            setNewSprint({ name: '', objective: '', notes: '', startDate: '', endDate: '' });
        } catch (error) {
            console.error('Error creating sprint:', error);
        }
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
                        Go to Stories
                    </Button>
                </div>
            </Container>
        );
    }

    return (
        <Container fluid className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="h3 mb-0">Sprint Planning</h1>
                <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                    Create Sprint
                </Button>
            </div>

            <Row>
                {/* Backlog Column */}
                <Col lg={6}>
                    <Card>
                        <Card.Header>
                            <h5 className="mb-0">Backlog ({backlogStories.length})</h5>
                        </Card.Header>
                        <Card.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                            {backlogStories.length === 0 ? (
                                <p className="text-muted">No stories in backlog</p>
                            ) : (
                                backlogStories.map(story => {
                                    const goal = getGoalForStory(story);
                                    return (
                                        <Card key={story.id} className="mb-2">
                                            <Card.Body className="p-3">
                                                <div className="d-flex justify-content-between align-items-start">
                                                    <div>
                                                        <h6 className="mb-1">{story.title}</h6>
                                                        <small className="text-muted">
                                                            Goal: {goal?.title || 'Unknown'}
                                                        </small>
                                                        <div className="mt-2">
                                                            <Form.Select
                                                                size="sm"
                                                                onChange={(e) => {
                                                                    if (e.target.value) {
                                                                        handleAssignToSprint(story.id, e.target.value);
                                                                    }
                                                                }}
                                                                defaultValue=""
                                                            >
                                                                <option value="">Assign to Sprint...</option>
                                                                {sprints.map(sprint => (
                                                                    <option key={sprint.id} value={sprint.id}>
                                                                        {sprint.name}
                                                                    </option>
                                                                ))}
                                                            </Form.Select>
                                                        </div>
                                                    </div>
                                                    <span className="badge bg-secondary">{story.points || 1} pts</span>
                                                </div>
                                            </Card.Body>
                                        </Card>
                                    );
                                })
                            )}
                        </Card.Body>
                    </Card>
                </Col>

                {/* Sprints Column */}
                <Col lg={6}>
                    <Card>
                        <Card.Header>
                            <h5 className="mb-0">Sprints ({sprints.length})</h5>
                        </Card.Header>
                        <Card.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                            {sprints.length === 0 ? (
                                <p className="text-muted">No sprints created yet.</p>
                            ) : (
                                sprints.map(sprint => {
                                    const sprintStories = stories.filter(s => s.sprintId === sprint.id);
                                    const totalPoints = sprintStories.reduce((sum, s) => sum + (s.points || 1), 0);
                                    
                                    return (
                                        <Card key={sprint.id} className="mb-3">
                                            <Card.Header className="bg-light">
                                                <div className="d-flex justify-content-between align-items-center">
                                                    <h6 className="mb-0">{sprint.name}</h6>
                                                    <span className="badge bg-primary">{totalPoints} pts</span>
                                                </div>
                                            </Card.Header>
                                            <Card.Body>
                                                {sprint.objective && (
                                                    <p className="text-muted small mb-2">{sprint.objective}</p>
                                                )}
                                                <div>
                                                    <strong>Stories ({sprintStories.length}):</strong>
                                                    {sprintStories.length === 0 ? (
                                                        <p className="text-muted small mt-1">No stories assigned</p>
                                                    ) : (
                                                        <ul className="list-unstyled mt-1">
                                                            {sprintStories.map(story => (
                                                                <li key={story.id} className="small">
                                                                    • {story.title} ({story.points || 1} pts)
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </div>
                                            </Card.Body>
                                        </Card>
                                    );
                                })
                            )}
                        </Card.Body>
                    </Card>
                </Col>
            </Row>

            {/* Create Sprint Modal */}
            <Modal show={showSprintModal} onHide={() => setShowSprintModal(false)}>
                <Modal.Header closeButton>
                    <Modal.Title>Create New Sprint</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Form.Group className="mb-3">
                            <Form.Label>Sprint Name</Form.Label>
                            <Form.Control
                                type="text"
                                value={newSprint.name}
                                onChange={(e) => setNewSprint({...newSprint, name: e.target.value})}
                                placeholder="e.g., Sprint 1, March 2025"
                            />
                        </Form.Group>
                        <Form.Group className="mb-3">
                            <Form.Label>Objective</Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={2}
                                value={newSprint.objective}
                                onChange={(e) => setNewSprint({...newSprint, objective: e.target.value})}
                                placeholder="What is the main goal of this sprint?"
                            />
                        </Form.Group>
                        <Row>
                            <Col>
                                <Form.Group className="mb-3">
                                    <Form.Label>Start Date</Form.Label>
                                    <Form.Control
                                        type="date"
                                        value={newSprint.startDate}
                                        onChange={(e) => setNewSprint({...newSprint, startDate: e.target.value})}
                                    />
                                </Form.Group>
                            </Col>
                            <Col>
                                <Form.Group className="mb-3">
                                    <Form.Label>End Date</Form.Label>
                                    <Form.Control
                                        type="date"
                                        value={newSprint.endDate}
                                        onChange={(e) => setNewSprint({...newSprint, endDate: e.target.value})}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowSprintModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleCreateSprint} disabled={!newSprint.name.trim()}>
                        Create Sprint
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default SprintPlannerSimple;
