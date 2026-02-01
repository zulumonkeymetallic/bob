import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { Story, Sprint, Goal } from '../types';
import { Container, Row, Col, Card, Button, Modal, Form } from 'react-bootstrap';
import { getThemeName, isStatus } from '../utils/statusHelpers';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { Calendar, Target, FileText } from 'lucide-react';
import SortableStoryCard from './stories/SortableStoryCard';
import EditStoryModal from './EditStoryModal';

const SprintPlanner: React.FC = () => {
    const { currentUser } = useAuth();
    const { currentPersona } = usePersona();
    const { sprints } = useSprint();
    const [stories, setStories] = useState<Story[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [loading, setLoading] = useState(true);
    const [showSprintModal, setShowSprintModal] = useState(false);
    const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
    const [newSprint, setNewSprint] = useState({
        name: '',
        objective: '',
        notes: '',
        startDate: '',
        endDate: ''
    });
    const [selectedStory, setSelectedStory] = useState<Story | null>(null);
    const [showEditModal, setShowEditModal] = useState(false);

    // Theme colors for visual consistency
    const themeColors = {
        'Health': '#22c55e',
        'Growth': '#3b82f6', 
        'Wealth': '#eab308',
        'Tribe': '#8b5cf6',
        'Home': '#f97316'
    };

    // Configure drag sensors
    const sensors = useSensors(
        useSensor(PointerSensor, {
            activationConstraint: {
                distance: 8,
            },
        }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const getGoalForStory = (story: Story): Goal | undefined => goals.find(goal => goal.id === story.goalId);

    const resolveThemeColor = (story: Story, goal?: Goal): string => {
        const rawTheme = goal?.theme ?? (story as any)?.theme ?? 1;
        if (typeof rawTheme === 'string') {
            return themeColors[rawTheme as keyof typeof themeColors] || '#6c757d';
        }
        const numericTheme = Number(rawTheme);
        const themeName = Number.isNaN(numericTheme) ? 'Growth' : getThemeName(numericTheme);
        return themeColors[themeName as keyof typeof themeColors] || '#6c757d';
    };

    const getTaskCount = (story: Story): number => {
        if (Array.isArray((story as any)?.tasks)) {
            return (story as any).tasks.length;
        }
        if (typeof (story as any)?.taskCount === 'number') {
            return Number((story as any).taskCount) || 0;
        }
        return 0;
    };

    const handleEditStory = (story: Story) => {
        setSelectedStory(story);
        setShowEditModal(true);
    };

    const handleDeleteStory = async (story: Story) => {
        if (!window.confirm('Are you sure you want to delete this story?')) return;
        try {
            await deleteDoc(doc(db, 'stories', story.id));
        } catch (error) {
            console.error('Error deleting story:', error);
            alert('Failed to delete story.');
        }
    };

    const handleCloseEditModal = () => {
        setShowEditModal(false);
        setSelectedStory(null);
    };

    useEffect(() => {
        if (!currentUser) return;

        console.log('SprintPlanner: Loading data for user:', currentUser.uid);
        
        try {
            const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
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
                unsubscribeGoals();
            };
        } catch (error) {
            console.error('SprintPlanner: Error setting up listeners:', error);
            setLoading(false);
        }
    }, [currentUser]);

    // Droppable Sprint Container Component using @dnd-kit
    const DroppableSprintContainer: React.FC<{
        sprint: Sprint;
        sprintStories: Story[];
        children: React.ReactNode;
    }> = ({ sprint, sprintStories, children }) => {
        const sprintProgress = sprintStories.length > 0 
            ? Math.round((sprintStories.filter(s => isStatus(s.status, 'Complete')).length / sprintStories.length) * 100)
            : 0;

        return (
            <Card className="sprint-container mb-3">
                <Card.Header className="bg-primary text-white">
                    <div className="d-flex justify-content-between align-items-center">
                        <div>
                            <h5 className="mb-1">{sprint.name}</h5>
                            <small>{sprint.objective}</small>
                        </div>
                        <div className="text-end">
                            <div className="small">
                                <Calendar size={14} className="me-1" />
                                {sprint.startDate} - {sprint.endDate}
                            </div>
                            <div className="progress mt-1" style={{ width: '100px', height: '6px' }}>
                                <div 
                                    className="progress-bar bg-success" 
                                    style={{ width: `${sprintProgress}%` }}
                                ></div>
                            </div>
                            <small>{sprintProgress}% Complete</small>
                        </div>
                    </div>
                </Card.Header>
                <Card.Body style={{ minHeight: '200px' }}>
                    {children}
                </Card.Body>
            </Card>
        );
    };

    const handleDragStart = (event: DragStartEvent) => {
        setActiveId(event.active.id);
    };

    const handleDragEnd = async (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);

        if (!over) return;

        const activeStoryId = active.id;
        const overId = over.id;

        // Find the story being dragged
        const activeStory = stories.find(story => story.id === activeStoryId);
        if (!activeStory) return;

        try {
            let newSprintId = null;
            
            // Determine destination sprint
            if (overId === 'backlog') {
                newSprintId = null; // Moving to backlog
            } else if (overId.toString().startsWith('sprint-')) {
                newSprintId = overId.toString().replace('sprint-', '');
            } else {
                // Dragged over another story, find its sprint
                const targetStory = stories.find(story => story.id === overId);
                if (targetStory) {
                    newSprintId = targetStory.sprintId || null;
                }
            }

            // Update the story's sprint assignment
            if (activeStory.sprintId !== newSprintId) {
                console.log(`Moving story ${activeStoryId} to sprint ${newSprintId || 'backlog'}`);
                
                await updateDoc(doc(db, 'stories', activeStoryId as string), {
                    sprintId: newSprintId,
                    updatedAt: serverTimestamp()
                });
            }
        } catch (error) {
            console.error('Error updating story sprint assignment:', error);
        }
    };

    const createSprint = async () => {
        if (!currentUser || !newSprint.name || !newSprint.startDate || !newSprint.endDate) {
            alert('Please fill in all required fields');
            return;
        }

        try {
            await addDoc(collection(db, 'sprints'), {
                name: newSprint.name,
                objective: newSprint.objective,
                notes: newSprint.notes,
                startDate: newSprint.startDate,
                endDate: newSprint.endDate,
                ownerUid: currentUser.uid,
                persona: currentPersona,
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
            alert('Error creating sprint');
        }
    };

    if (loading) {
        return (
            <Container className="mt-4">
                <div className="text-center">
                    <div className="spinner-border" role="status">
                        <span className="visually-hidden">Loading...</span>
                    </div>
                    <p className="mt-2">Loading sprint planning data...</p>
                </div>
            </Container>
        );
    }

    const backlogStories = stories.filter(story => !story.sprintId);

    return (
        <Container fluid className="mt-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>
                    <Target className="me-2" />
                    Sprint Planning
                </h2>
                <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                    Create New Sprint
                </Button>
            </div>

            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
            >
                <Row>
                    {/* Backlog Column */}
                    <Col md={4}>
                        <Card className="backlog-container mb-3">
                            <Card.Header className="bg-secondary text-white">
                                <h5 className="mb-0">
                                    <FileText size={18} className="me-2" />
                                    Backlog ({backlogStories.length})
                                </h5>
                            </Card.Header>
                            <Card.Body style={{ minHeight: '400px' }}>
                                <SortableContext 
                                    items={backlogStories.map(story => story.id)}
                                    strategy={verticalListSortingStrategy}
                                >
                                    {backlogStories.map(story => {
                                        const storyGoal = getGoalForStory(story);
                                        const themeColor = resolveThemeColor(story, storyGoal);
                                        const taskCount = getTaskCount(story);
                                        return (
                                            <SortableStoryCard
                                                key={story.id}
                                                story={story}
                                                goal={storyGoal}
                                                taskCount={taskCount}
                                                themeColor={themeColor}
                                                onEdit={handleEditStory}
                                                onDelete={handleDeleteStory}
                                            />
                                        );
                                    })}
                                </SortableContext>
                                {backlogStories.length === 0 && (
                                    <div className="text-center text-muted mt-4">
                                        <FileText size={48} className="mb-2" />
                                        <p>No stories in backlog</p>
                                    </div>
                                )}
                            </Card.Body>
                        </Card>
                    </Col>

                    {/* Sprints Column */}
                    <Col md={8}>
                        <div className="sprints-container">
                            {sprints.map(sprint => {
                                const sprintStories = stories.filter(story => story.sprintId === sprint.id);
                                return (
                                    <DroppableSprintContainer 
                                        key={sprint.id} 
                                        sprint={sprint}
                                        sprintStories={sprintStories}
                                    >
                                        <SortableContext 
                                            items={sprintStories.map(story => story.id)}
                                            strategy={verticalListSortingStrategy}
                                        >
                                            {sprintStories.map(story => {
                                                const storyGoal = getGoalForStory(story);
                                                const themeColor = resolveThemeColor(story, storyGoal);
                                                const taskCount = getTaskCount(story);
                                                return (
                                                    <SortableStoryCard
                                                        key={story.id}
                                                        story={story}
                                                        goal={storyGoal}
                                                        taskCount={taskCount}
                                                        themeColor={themeColor}
                                                        onEdit={handleEditStory}
                                                        onDelete={handleDeleteStory}
                                                    />
                                                );
                                            })}
                                        </SortableContext>
                                        {sprintStories.length === 0 && (
                                            <div className="text-center text-muted mt-3">
                                                <p>Drag stories here to add to this sprint</p>
                                            </div>
                                        )}
                                    </DroppableSprintContainer>
                                );
                            })}
                            
                            {sprints.length === 0 && (
                                <Card className="text-center">
                                    <Card.Body className="py-5">
                                        <Calendar size={48} className="text-muted mb-3" />
                                        <h5>No Sprints Created</h5>
                                        <p className="text-muted">Create your first sprint to start planning!</p>
                                        <Button variant="primary" onClick={() => setShowSprintModal(true)}>
                                            Create Sprint
                                        </Button>
                                    </Card.Body>
                                </Card>
                            )}
                        </div>
                    </Col>
                </Row>
            </DndContext>

            <EditStoryModal
                show={showEditModal}
                onHide={handleCloseEditModal}
                story={selectedStory}
                goals={goals}
                onStoryUpdated={handleCloseEditModal}
            />

            {/* Create Sprint Modal */}
            <Modal show={showSprintModal} onHide={() => setShowSprintModal(false)} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>Create New Sprint</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Sprint Name *</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={newSprint.name}
                                        onChange={(e) => setNewSprint({...newSprint, name: e.target.value})}
                                        placeholder="e.g., Sprint 1, Q4 Goals Sprint"
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Objective</Form.Label>
                                    <Form.Control
                                        type="text"
                                        value={newSprint.objective}
                                        onChange={(e) => setNewSprint({...newSprint, objective: e.target.value})}
                                        placeholder="What's the main goal of this sprint?"
                                    />
                                </Form.Group>
                            </Col>
                        </Row>
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
                                placeholder="Any additional notes or context for this sprint..."
                            />
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowSprintModal(false)}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={createSprint}>
                        Create Sprint
                    </Button>
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default SprintPlanner;
