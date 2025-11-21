import React, { useEffect, useState } from 'react';
import { Card, Button, Form, Alert, Badge, Spinner } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot, doc, setDoc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Story, Task, Goal } from '../types';
import { isStatus } from '../utils/statusHelpers';
import { Calendar, CheckCircle, Target, TrendingUp, Edit3, Save, RotateCcw } from 'lucide-react';

interface RetroMetrics {
    totalStories: number;
    completedStories: number;
    completionRate: number;
    totalTasks: number;
    completedTasks: number;
    taskCompletionRate: number;
    totalPoints: number;
    completedPoints: number;
    velocityPoints: number;
    goalsInScope: string[];
}

interface RetroData {
    sprintId: string;
    sprintName: string;
    createdAt: number;
    updatedAt: number;
    metrics: RetroMetrics;
    llmSummary: string;
    userNotes: string;
    approved: boolean;
}

const SprintRetrospective: React.FC = () => {
    const { currentUser } = useAuth();
    const { currentPersona } = usePersona();
    const { selectedSprintId, sprints } = useSprint();
    const selectedSprint = sprints.find(s => s.id === selectedSprintId);

    const [loading, setLoading] = useState(true);
    const [generating, setGenerating] = useState(false);
    const [saving, setSaving] = useState(false);

    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [goals, setGoals] = useState<Goal[]>([]);

    const [metrics, setMetrics] = useState<RetroMetrics | null>(null);
    const [llmSummary, setLlmSummary] = useState('');
    const [userNotes, setUserNotes] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [approved, setApproved] = useState(false);

    // Load sprint data
    useEffect(() => {
        if (!currentUser || !currentPersona || !selectedSprintId) {
            setLoading(false);
            return;
        }

        setLoading(true);

        // Load stories
        const storiesQuery = query(
            collection(db, 'stories'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            where('sprintId', '==', selectedSprintId)
        );

        // Load tasks
        const tasksQuery = query(
            collection(db, 'sprint_task_index'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona),
            where('sprintId', '==', selectedSprintId)
        );

        // Load goals
        const goalsQuery = query(
            collection(db, 'goals'),
            where('ownerUid', '==', currentUser.uid),
            where('persona', '==', currentPersona)
        );

        const unsubStories = onSnapshot(storiesQuery, (snap) => {
            setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
        });

        const unsubTasks = onSnapshot(tasksQuery, (snap) => {
            setTasks(snap.docs.map(d => ({ id: d.id, ...d.data() } as Task)));
        });

        const unsubGoals = onSnapshot(goalsQuery, (snap) => {
            setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
            setLoading(false);
        });

        return () => {
            unsubStories();
            unsubTasks();
            unsubGoals();
        };
    }, [currentUser, currentPersona, selectedSprintId]);

    // Calculate metrics
    useEffect(() => {
        if (stories.length === 0 && tasks.length === 0) return;

        const totalStories = stories.length;
        const completedStories = stories.filter(s => isStatus((s as any).status, 'done')).length;
        const completionRate = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

        const totalTasks = tasks.length;
        const completedTasks = tasks.filter(t => isStatus((t as any).status, 'done')).length;
        const taskCompletionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

        const totalPoints = stories.reduce((sum, s) => sum + (s.points || 0), 0);
        const completedPoints = stories
            .filter(s => isStatus((s as any).status, 'done'))
            .reduce((sum, s) => sum + (s.points || 0), 0);

        // Get unique goal IDs from stories
        const goalIds = [...new Set(stories.map(s => s.goalId).filter(Boolean))];
        const goalsInScope = goalIds.map(gid => {
            const goal = goals.find(g => g.id === gid);
            return goal?.title || 'Unknown Goal';
        });

        setMetrics({
            totalStories,
            completedStories,
            completionRate,
            totalTasks,
            completedTasks,
            taskCompletionRate,
            totalPoints,
            completedPoints,
            velocityPoints: completedPoints,
            goalsInScope
        });
    }, [stories, tasks, goals]);

    // Load existing retrospective
    useEffect(() => {
        if (!currentUser || !selectedSprintId) return;

        const loadRetro = async () => {
            try {
                const retroDoc = await getDoc(doc(db, 'sprint_retrospectives', `${currentUser.uid}_${selectedSprintId}`));
                if (retroDoc.exists()) {
                    const data = retroDoc.data() as RetroData;
                    setLlmSummary(data.llmSummary || '');
                    setUserNotes(data.userNotes || '');
                    setApproved(data.approved || false);
                }
            } catch (error) {
                console.error('Error loading retrospective:', error);
            }
        };

        loadRetro();
    }, [currentUser, selectedSprintId]);

    // Generate LLM summary
    const generateSummary = async () => {
        if (!currentUser || !selectedSprintId || !metrics) return;

        setGenerating(true);
        try {
            const callable = httpsCallable(functions, 'generateSprintRetrospective');
            const response: any = await callable({
                sprintId: selectedSprintId,
                sprintName: selectedSprint?.name || `Sprint ${selectedSprintId}`,
                metrics: {
                    totalStories: metrics.totalStories,
                    completedStories: metrics.completedStories,
                    completionRate: metrics.completionRate,
                    totalTasks: metrics.totalTasks,
                    completedTasks: metrics.completedTasks,
                    taskCompletionRate: metrics.taskCompletionRate,
                    totalPoints: metrics.totalPoints,
                    completedPoints: metrics.completedPoints,
                    velocityPoints: metrics.velocityPoints,
                    goalsInScope: metrics.goalsInScope
                },
                stories: stories.map(s => ({
                    id: s.id,
                    title: s.title,
                    status: (s as any).status,
                    points: s.points,
                    goalId: s.goalId
                })),
                goals: metrics.goalsInScope
            });

            setLlmSummary(response.data.summary || '');
            setIsEditing(false);
        } catch (error) {
            console.error('Error generating summary:', error);
            alert('Failed to generate summary. Please try again.');
        } finally {
            setGenerating(false);
        }
    };

    // Save retrospective
    const saveRetrospective = async () => {
        if (!currentUser || !selectedSprintId || !metrics) return;

        setSaving(true);
        try {
            const retroData: RetroData = {
                sprintId: selectedSprintId,
                sprintName: selectedSprint?.name || `Sprint ${selectedSprintId}`,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                metrics,
                llmSummary,
                userNotes,
                approved
            };

            await setDoc(doc(db, 'sprint_retrospectives', `${currentUser.uid}_${selectedSprintId}`), retroData);
            alert('Retrospective saved successfully!');
        } catch (error) {
            console.error('Error saving retrospective:', error);
            alert('Failed to save retrospective.');
        } finally {
            setSaving(false);
        }
    };

    if (!selectedSprintId) {
        return (
            <div className="container py-4">
                <Alert variant="info">
                    <Calendar className="me-2" />
                    Please select a sprint to view its retrospective.
                </Alert>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="container py-4 text-center">
                <Spinner animation="border" />
                <p className="mt-2">Loading sprint data...</p>
            </div>
        );
    }

    return (
        <div className="container py-4">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h2>
                    <RotateCcw className="me-2" />
                    Sprint Retrospective: {selectedSprint?.name || selectedSprintId}
                </h2>
                {approved && (
                    <Badge bg="success" className="px-3 py-2">
                        <CheckCircle size={16} className="me-1" />
                        Approved
                    </Badge>
                )}
            </div>

            {/* Metrics Cards */}
            <div className="row g-3 mb-4">
                <div className="col-md-3">
                    <Card>
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <div className="text-muted small">Story Completion</div>
                                    <h3 className="mb-0">{metrics?.completionRate || 0}%</h3>
                                    <div className="text-muted small mt-1">
                                        {metrics?.completedStories || 0}/{metrics?.totalStories || 0} completed
                                    </div>
                                </div>
                                <CheckCircle size={32} className="text-primary opacity-50" />
                            </div>
                        </Card.Body>
                    </Card>
                </div>

                <div className="col-md-3">
                    <Card>
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <div className="text-muted small">Task Completion</div>
                                    <h3 className="mb-0">{metrics?.taskCompletionRate || 0}%</h3>
                                    <div className="text-muted small mt-1">
                                        {metrics?.completedTasks || 0}/{metrics?.totalTasks || 0} completed
                                    </div>
                                </div>
                                <CheckCircle size={32} className="text-success opacity-50" />
                            </div>
                        </Card.Body>
                    </Card>
                </div>

                <div className="col-md-3">
                    <Card>
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <div className="text-muted small">Velocity</div>
                                    <h3 className="mb-0">{metrics?.velocityPoints || 0} pts</h3>
                                    <div className="text-muted small mt-1">
                                        {metrics?.completedPoints || 0}/{metrics?.totalPoints || 0} points
                                    </div>
                                </div>
                                <TrendingUp size={32} className="text-info opacity-50" />
                            </div>
                        </Card.Body>
                    </Card>
                </div>

                <div className="col-md-3">
                    <Card>
                        <Card.Body>
                            <div className="d-flex justify-content-between align-items-start">
                                <div>
                                    <div className="text-muted small">Goals in Scope</div>
                                    <h3 className="mb-0">{metrics?.goalsInScope.length || 0}</h3>
                                    <div className="text-muted small mt-1">
                                        goals tracked
                                    </div>
                                </div>
                                <Target size={32} className="text-warning opacity-50" />
                            </div>
                        </Card.Body>
                    </Card>
                </div>
            </div>

            {/* Goals List */}
            {metrics && metrics.goalsInScope.length > 0 && (
                <Card className="mb-4">
                    <Card.Header>
                        <Target size={18} className="me-2" />
                        Goals in This Sprint
                    </Card.Header>
                    <Card.Body>
                        <ul className="mb-0">
                            {metrics.goalsInScope.map((goal, idx) => (
                                <li key={idx}>{goal}</li>
                            ))}
                        </ul>
                    </Card.Body>
                </Card>
            )}

            {/* AI Summary */}
            <Card className="mb-4">
                <Card.Header className="d-flex justify-content-between align-items-center">
                    <span>AI-Generated Summary</span>
                    <div>
                        {isEditing && (
                            <Button
                                variant="outline-secondary"
                                size="sm"
                                className="me-2"
                                onClick={() => setIsEditing(false)}
                            >
                                Cancel
                            </Button>
                        )}
                        <Button
                            variant="primary"
                            size="sm"
                            onClick={generateSummary}
                            disabled={generating}
                        >
                            {generating ? (
                                <>
                                    <Spinner animation="border" size="sm" className="me-2" />
                                    Generating...
                                </>
                            ) : (
                                <>
                                    <RotateCcw size={16} className="me-2" />
                                    {llmSummary ? 'Regenerate Summary' : 'Generate Summary'}
                                </>
                            )}
                        </Button>
                    </div>
                </Card.Header>
                <Card.Body>
                    {llmSummary ? (
                        isEditing ? (
                            <Form.Control
                                as="textarea"
                                rows={8}
                                value={llmSummary}
                                onChange={(e) => setLlmSummary(e.target.value)}
                            />
                        ) : (
                            <div style={{ whiteSpace: 'pre-wrap' }}>
                                {llmSummary}
                                <Button
                                    variant="link"
                                    size="sm"
                                    className="p-0 ms-3"
                                    onClick={() => setIsEditing(true)}
                                >
                                    <Edit3 size={14} className="me-1" />
                                    Edit
                                </Button>
                            </div>
                        )
                    ) : (
                        <div className="text-muted text-center py-5">
                            No summary generated yet. Click "Generate Summary" to create an AI-powered retrospective summary.
                        </div>
                    )}
                </Card.Body>
            </Card>

            {/* User Notes */}
            <Card className="mb-4">
                <Card.Header>Your Notes</Card.Header>
                <Card.Body>
                    <Form.Control
                        as="textarea"
                        rows={5}
                        placeholder="Add your own notes, observations, or action items from this sprint..."
                        value={userNotes}
                        onChange={(e) => setUserNotes(e.target.value)}
                    />
                </Card.Body>
            </Card>

            {/* Approval & Save */}
            <div className="d-flex justify-content-between align-items-center">
                <Form.Check
                    type="checkbox"
                    id="approve-retro"
                    label="Mark as approved (ready for review)"
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                />
                <Button
                    variant="success"
                    size="lg"
                    onClick={saveRetrospective}
                    disabled={saving}
                >
                    {saving ? (
                        <>
                            <Spinner animation="border" size="sm" className="me-2" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Save size={18} className="me-2" />
                            Save Retrospective
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
};

export default SprintRetrospective;
