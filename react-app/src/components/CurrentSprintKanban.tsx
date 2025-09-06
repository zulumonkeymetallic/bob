import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Story, Sprint, Task, Goal } from '../types';
import { Container, Row, Col, Card, Dropdown, Button } from 'react-bootstrap';
import ModernTaskTable from './ModernTaskTable';
import { ChoiceHelper } from '../config/choices';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { useTheme } from '../contexts/ModernThemeContext';

const CurrentSprintKanban: React.FC = () => {
  const { theme } = useTheme();
    const { currentUser } = useAuth();
    const [stories, setStories] = useState<Story[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
    const [selectedStory, setSelectedStory] = useState<Story | null>(null);
    const [loading, setLoading] = useState(true);

    const kanbanLanes = [
        { id: 0, title: 'Backlog', stringId: 'backlog' },
        { id: 2, title: 'In Progress', stringId: 'active' }, // Story IN_PROGRESS = 2
        { id: 4, title: 'Done', stringId: 'done' } // Story DONE = 4
    ];

    const themeColors = {
        1: '#22c55e', // Health
        2: '#3b82f6', // Growth
        3: '#eab308', // Wealth
        4: '#8b5cf6', // Tribe
        5: '#f97316'  // Home
    };

    useEffect(() => {
        if (!currentUser) return;

        const sprintsQuery = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));
        const goalsQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
        
        const unsubscribeSprints = onSnapshot(sprintsQuery, snapshot => {
            const sprintsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sprint));
            setSprints(sprintsData);
            const currentSprint = sprintsData.find(s => s.status === 1); // Sprint Active = 1
            setActiveSprint(currentSprint || null);
        });

        const unsubscribeGoals = onSnapshot(goalsQuery, snapshot => {
            const goalsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal));
            setGoals(goalsData);
        });

        return () => {
            unsubscribeSprints();
            unsubscribeGoals();
        };
    }, [currentUser]);

    useEffect(() => {
        if (!currentUser || !activeSprint) {
            setStories([]);
            setTasks([]);
            setLoading(false);
            return;
        };

        setLoading(true);
        const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), where('sprintId', '==', activeSprint.id));
        const unsubscribeStories = onSnapshot(storiesQuery, snapshot => {
            const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
            setStories(storiesData);

            if (storiesData.length > 0) {
                const storyIds = storiesData.map(s => s.id);
                const tasksQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), where('parentId', 'in', storyIds));
                const unsubscribeTasks = onSnapshot(tasksQuery, taskSnapshot => {
                    const tasksData = taskSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
                    setTasks(tasksData);
                    setLoading(false);
                });
                return () => unsubscribeTasks();
            } else {
                setTasks([]);
                setLoading(false);
            }
        });

        return () => unsubscribeStories();
    }, [currentUser, activeSprint]);


    const updateStoryStatus = async (storyId: string, newStatus: string) => {
        try {
            await updateDoc(doc(db, 'stories', storyId), {
                status: newStatus,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating story status:', error);
        }
    };

    const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
        try {
            await updateDoc(doc(db, 'tasks', taskId), {
                ...updates,
                updatedAt: serverTimestamp()
            });
        } catch (error) {
            console.error('Error updating task:', error);
        }
    };

    const handleTaskDelete = async (taskId: string) => {
        // Implementation would be similar to existing delete functions
    };

    const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
        // Priority is now numeric: 1=High, 2=Medium, 3=Low
        await handleTaskUpdate(taskId, { priority: newPriority });
    };

    const getGoalForStory = (story: Story) => {
        return goals.find(g => g.id === story.goalId);
    };

    const getTasksForStory = (storyId: string) => {
        return tasks.filter(t => t.parentId === storyId && t.parentType === 'story');
    };

    if (loading) {
        return <div className="d-flex justify-content-center p-5"><div className="spinner-border" role="status"></div></div>;
    }

    return (
        <Container fluid className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="h3 mb-0">Current Sprint Kanban</h1>
                <Dropdown>
                    <Dropdown.Toggle variant="primary" id="dropdown-basic">
                        {activeSprint ? activeSprint.name : "Select Sprint"}
                    </Dropdown.Toggle>
                    <Dropdown.Menu>
                        {sprints.map(sprint => (
                            <Dropdown.Item key={sprint.id} onClick={() => setActiveSprint(sprint)}>
                                {sprint.name} ({sprint.status})
                            </Dropdown.Item>
                        ))}
                    </Dropdown.Menu>
                </Dropdown>
            </div>

            {activeSprint ? (
                <Row>
                    {selectedStory ? (
                        // Show task detail view when story is selected
                        <Col>
                            <div className="d-flex justify-content-between align-items-center mb-3">
                                <div>
                                    <h4>{selectedStory.title}</h4>
                                    <small className="text-muted">
                                        {getGoalForStory(selectedStory)?.title} • {getTasksForStory(selectedStory.id).length} tasks
                                    </small>
                                </div>
                                <Button variant="secondary" onClick={() => setSelectedStory(null)}>
                                    Back to Kanban
                                </Button>
                            </div>
                            <ModernTaskTable
                                tasks={getTasksForStory(selectedStory.id)}
                                stories={[selectedStory]}
                                goals={goals}
                                sprints={sprints}
                                onTaskUpdate={handleTaskUpdate}
                                onTaskDelete={handleTaskDelete}
                                onTaskPriorityChange={handleTaskPriorityChange}
                            />
                        </Col>
                    ) : (
                        // Show Kanban view
                        kanbanLanes.map(lane => {
                            const laneStories = stories.filter(s => s.status === lane.id);
                            return (
                                <Col key={lane.id} md={4}>
                                    <Card className="h-100">
                                        <Card.Header className="d-flex justify-content-between align-items-center">
                                            <span>{lane.title}</span>
                                            <span className="badge badge-secondary">{laneStories.length}</span>
                                        </Card.Header>
                                        <Card.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                                            {laneStories.map(story => {
                                                const goal = getGoalForStory(story);
                                                const themeColor = goal?.theme ? themeColors[goal.theme] : '#6b7280';
                                                const taskCount = getTasksForStory(story.id).length;
                                                const doneTaskCount = getTasksForStory(story.id).filter(t => t.status === 2).length; // Task Done = 2
                                                
                                                return (
                                                    <Card 
                                                        key={story.id} 
                                                        className="mb-2 cursor-pointer hover-shadow"
                                                        style={{ borderLeft: `4px solid ${themeColor}` }}
                                                        onClick={() => setSelectedStory(story)}
                                                    >
                                                        <Card.Body className="p-3">
                                                            <div className="d-flex justify-content-between align-items-start mb-2">
                                                                <h6 className="card-title mb-1">{story.title}</h6>
                                                                <span className="badge badge-primary">{story.ref || story.id.slice(-4)}</span>
                                                            </div>
                                                            <div className="d-flex justify-content-between align-items-center">
                                                                <small className="text-muted">
                                                                    {goal?.title} • {story.priority} • {story.points}pts
                                                                </small>
                                                                <small className="text-muted">
                                                                    {doneTaskCount}/{taskCount} tasks
                                                                </small>
                                                            </div>
                                                            {story.description && (
                                                                <p className="card-text mt-2 mb-0" style={{ fontSize: '0.85rem' }}>
                                                                    {story.description.substring(0, 80)}
                                                                    {story.description.length > 80 && '...'}
                                                                </p>
                                                            )}
                                                        </Card.Body>
                                                    </Card>
                                                );
                                            })}
                                            {laneStories.length === 0 && (
                                                <div className="text-center text-muted py-4">
                                                    <p>No stories in {lane.title.toLowerCase()}</p>
                                                </div>
                                            )}
                                        </Card.Body>
                                    </Card>
                                </Col>
                            );
                        })
                    )}
                </Row>
            ) : (
                <div className="text-center py-5">
                    <p>No active sprint. Please select a sprint from the dropdown above.</p>
                </div>
            )}
        </Container>
    );
};

export default CurrentSprintKanban;
