import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc, updateDoc, serverTimestamp, addDoc, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Story, Sprint, Task, Goal } from '../types';
import { Container, Row, Col, Card, Dropdown, Button } from 'react-bootstrap';
import ModernTaskTable from './ModernTaskTable';
import { ChoiceHelper } from '../config/choices';
import { isStatus, isTheme, getThemeName } from '../utils/statusHelpers';
import { domainThemePrimaryVar, themeVars } from '../utils/themeVars';

const CurrentSprintKanban: React.FC = () => {
    const { currentUser } = useAuth();
    const [stories, setStories] = useState<Story[]>([]);
    const [sprints, setSprints] = useState<Sprint[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);
    const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
    const [selectedStory, setSelectedStory] = useState<Story | null>(null);
    const [loading, setLoading] = useState(true);
    const [activityModal, setActivityModal] = useState<{ story: Story | null; note: string }>({ story: null, note: '' });
    const [latestActivities, setLatestActivities] = useState<{ [id: string]: any }>({});

    const kanbanLanes = [
        { id: 0, title: 'Backlog', stringId: 'backlog' },
        { id: 2, title: 'In Progress', stringId: 'active' }, // Story IN_PROGRESS = 2
        { id: 4, title: 'Done', stringId: 'done' } // Story DONE = 4
    ];

    const themeColorForGoal = (goal?: Goal) => {
        if (!goal) return themeVars.muted as string;
        return domainThemePrimaryVar(getThemeName(goal.theme));
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

            const tasksQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), where('sprintId', '==', activeSprint.id));
            const unsubscribeTasks = onSnapshot(tasksQuery, taskSnapshot => {
                const tasksData = taskSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
                setTasks(tasksData);
                setLoading(false);
            });

            return () => unsubscribeTasks();
        });

        return () => unsubscribeStories();
    }, [currentUser, activeSprint]);

    // Load latest activity for visible stories
    useEffect(() => {
        const fetchLatest = async () => {
            if (!currentUser || stories.length === 0) { setLatestActivities({}); return; }
            const map: { [id: string]: any } = {};
            for (const s of stories) {
                try {
                    const qAct = query(
                        collection(db, 'activity_stream'),
                        where('entityType', '==', 'story'),
                        where('entityId', '==', s.id),
                        where('ownerUid', '==', currentUser.uid),
                        orderBy('timestamp', 'desc')
                    );
                    const snap = await getDocs(qAct);
                    const items = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];
                    const latest = items.find((a: any) => (a.activityType === 'note_added' && a.noteContent) || a.activityType === 'updated' || a.activityType === 'created');
                    if (latest) map[s.id] = latest;
                } catch (e) {
                    // ignore errors per story
                }
            }
            setLatestActivities(map);
        };
        fetchLatest();
    }, [stories, currentUser]);


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
        <>
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
                                                const themeColor = themeColorForGoal(goal);
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
                                                                <div className="d-flex align-items-center gap-1">
                                                                  <button className="btn btn-sm btn-outline-secondary" onClick={(e) => { e.stopPropagation(); setActivityModal({ story, note: '' }); }}>Activity</button>
                                                                  <button className="btn btn-sm btn-outline-secondary" onClick={(e) => { e.stopPropagation(); setSelectedStory(story); }}>Edit</button>
                                                                  <span className="badge badge-primary ms-1">{story.ref || story.id.slice(-4)}</span>
                                                                </div>
                                                            </div>
                                                            <div className="d-flex justify-content-between align-items-center">
                                                                <small className="text-muted">
                                                                    {goal?.title} • {story.priority} • {story.points}pts
                                                                </small>
                                                                <small className="text-muted">
                                                                    {doneTaskCount}/{taskCount} tasks
                                                                </small>
                                                            </div>
                                                            {latestActivities[story.id] && (
                                                                <div className="mt-2 p-2" style={{ background: 'rgba(var(--card-rgb), 0.1)', border: `1px solid ${themeColor}`, borderRadius: 6 }}>
                                                                    <small style={{ color: themeColor as string, fontWeight: 600 }}>Latest Activity</small>
                                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text)' }}>
                                                                        {latestActivities[story.id].activityType === 'note_added' ? `"${latestActivities[story.id].noteContent}"` : latestActivities[story.id].description || 'Updated'}
                                                                    </div>
                                                                </div>
                                                            )}
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
        {activityModal.story && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setActivityModal({ story: null, note: '' })}>
            <div style={{ background: 'var(--panel)', color: 'var(--text)', width: 520, maxWidth: '90%', borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.2)', border: '1px solid var(--line)' }} onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: 16, borderBottom: '1px solid var(--line)' }}>
                <h5 style={{ margin: 0 }}>Add Note: {activityModal.story.ref || activityModal.story.title}</h5>
              </div>
              <div style={{ padding: 16, display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Write a quick note..."
                  value={activityModal.note}
                  onChange={(e) => setActivityModal(prev => ({ ...prev, note: e.target.value }))}
                  style={{ flex: 1, border: '1px solid var(--line)', color: 'var(--text)', background: 'var(--card)', borderRadius: 6, padding: '8px 10px' }}
                />
                <button
                  onClick={async () => {
                    if (!currentUser || !activityModal.story || !activityModal.note.trim()) return;
                    await addDoc(collection(db, 'activity_stream'), {
                      entityType: 'story', entityId: activityModal.story.id, ownerUid: currentUser.uid,
                      activityType: 'note_added', noteContent: activityModal.note.trim(), timestamp: serverTimestamp()
                    });
                    setActivityModal({ story: null, note: '' });
                  }}
                  style={{ padding: '8px 12px', borderRadius: 6, border: 'none', background: 'var(--brand)', color: 'var(--on-accent)' }}
                >Add</button>
                <button onClick={() => setActivityModal({ story: null, note: '' })} style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line)', background: 'var(--card)', color: 'var(--text)' }}>Close</button>
              </div>
            </div>
          </div>
        )}
        </>
    );
};

export default CurrentSprintKanban;
