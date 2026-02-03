import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Card, Row, Col, Alert, Spinner, Table } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { db } from '../../firebase';
import { collection, query, where, onSnapshot, doc, updateDoc, addDoc } from 'firebase/firestore';
import { Story, Task, Goal, Sprint } from '../../types';
import { CheckCircle, RotateCcw, TrendingUp, Target, Calendar, ArrowRight, AlertCircle } from 'lucide-react';
import { isStatus } from '../../utils/statusHelpers';

interface SprintMetricsSnapshot {
  sprintId: string;
  sprintName: string;
  completionDate: number;
  storyProgress: number;
  taskProgress: number;
  totalStories: number;
  completedStories: number;
  totalTasks: number;
  completedTasks: number;
  totalPoints: number;
  completedPoints: number;
  totalCapacityHours: number;
  usedCapacityHours: number;
  capacityUtilization: number;
  daysTotal: number;
  daysUsed: number;
  goalsCovered: number;
  openStoriesCount: number;
  openTasksCount: number;
}

interface SprintCloseDialogProps {
  show: boolean;
  onHide: () => void;
  sprint: Sprint;
}

const toPlannerMinutes = (value?: string): number | null => {
  if (!value) return null;
  const [hours = '0', minutes = '0'] = value.split(':');
  const h = Number(hours);
  const m = Number(minutes);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
};

const getTimestamp = (value: any): number | null => {
  if (!value) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  return null;
};

const SprintCloseDialog: React.FC<SprintCloseDialogProps> = ({ show, onHide, sprint }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { setSelectedSprintId } = useSprint();

  // Data states
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<any[]>([]);
  const [weeklyPlannerMinutes, setWeeklyPlannerMinutes] = useState(0);

  // UI states
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [step, setStep] = useState<'metrics' | 'retrospective' | 'migration' | 'complete'>('metrics');

  // Form states
  const [retroNotes, setRetroNotes] = useState({
    wentWell: '',
    toImprove: '',
    blockers: '',
    learnings: '',
    nextSprintFocus: ''
  });
  const [targetSprintId, setTargetSprintId] = useState<string>('');
  const [createNewSprint, setCreateNewSprint] = useState(false);
  const [newSprintData, setNewSprintData] = useState({
    name: '',
    objective: '',
    duration: 14
  });

  const [capacityValidationResult, setCapacityValidationResult] = useState<{
    canFit: boolean;
    reason: string;
    remainingPoints: number;
    targetCapacity: number;
    availableCapacity?: number;
    existingWorkload?: number;
    idealCapacity?: number;
    capacityUtilization?: number;
    recommendation?: string;
  } | null>(null);

  // Validate capacity when target sprint changes
  useEffect(() => {
    const validateAndUpdate = async () => {
      if (step === 'migration' && targetSprintId) {
        const result = await validateCapacity();
        setCapacityValidationResult(result);
      } else {
        setCapacityValidationResult(null);
      }
    };
    
    validateAndUpdate();
  }, [step, targetSprintId, stories, calendarBlocks, sprints]);

  // Metrics state
  const [metricsSnapshot, setMetricsSnapshot] = useState<SprintMetricsSnapshot | null>(null);

  // Load data when dialog opens
  useEffect(() => {
    if (!show || !currentUser || !sprint) return;

    setLoading(true);
    const unsubscribes: (() => void)[] = [];

    // Load stories for this sprint
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('sprintId', '==', sprint.id)
    );

    unsubscribes.push(onSnapshot(storiesQuery, (snap) => {
      setStories(snap.docs.map(d => ({ id: d.id, ...d.data() } as Story)));
    }));

    // Load tasks for this sprint
    const tasksQuery = query(
      collection(db, 'sprint_task_index'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('sprintId', '==', sprint.id)
    );

    unsubscribes.push(onSnapshot(tasksQuery, (snap) => {
      const taskDocs = snap.docs.map(d => d.data());
      setTasks(taskDocs as Task[]);
    }));

    // Load all goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    unsubscribes.push(onSnapshot(goalsQuery, (snap) => {
      setGoals(snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal)));
    }));

    // Load other sprints for migration target
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    unsubscribes.push(onSnapshot(sprintsQuery, (snap) => {
      const allSprints = snap.docs.map(d => ({ id: d.id, ...d.data() } as Sprint));
      setSprints(allSprints.filter(s => s.id !== sprint.id));
    }));

    // Load calendar blocks for capacity calculation
    const blocksQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid)
    );

    unsubscribes.push(onSnapshot(blocksQuery, (snap) => {
      setCalendarBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      setLoading(false);
    }));

    const allocationsRef = doc(db, 'theme_allocations', currentUser.uid);
    unsubscribes.push(onSnapshot(allocationsRef, (allocSnap) => {
      const allocations = (allocSnap.data()?.allocations || []) as Array<{ startTime?: string; endTime?: string }>;
      const totalMinutes = allocations.reduce((sum, alloc) => {
        const start = toPlannerMinutes(alloc.startTime);
        const end = toPlannerMinutes(alloc.endTime);
        if (start === null || end === null) return sum;
        return sum + Math.max(0, end - start);
      }, 0);
      setWeeklyPlannerMinutes(totalMinutes);
    }, () => {
      setWeeklyPlannerMinutes(0);
    }));

    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [show, currentUser, currentPersona, sprint]);

  // Calculate metrics when data loads
  useEffect(() => {
    if (loading || !sprint) return;

    calculateMetrics();
  }, [stories, tasks, goals, calendarBlocks, loading, sprint]);

  const calculateMetrics = () => {
    const completedStories = stories.filter(s => s.status === 4).length;
    const completedTasks = tasks.filter(t => t.status === 2).length;
    const completedPoints = stories.filter(s => s.status === 4).reduce((sum, s) => sum + (s.points || 0), 0);
    const totalPoints = stories.reduce((sum, s) => sum + (s.points || 0), 0);

    // Calculate capacity from calendar blocks in sprint timeframe
    const sprintStart = new Date(sprint.startDate);
    const sprintEnd = new Date(sprint.endDate);
    const sprintBlocks = calendarBlocks.filter(block => {
      const blockStart = new Date(block.start || block.startTime || 0);
      return blockStart >= sprintStart && blockStart <= sprintEnd && !block.allDay;
    });

    const totalCapacityMinutes = sprintBlocks.reduce((sum, block) => {
      const duration = (new Date(block.end || block.endTime || 0).getTime() - new Date(block.start || block.startTime || 0).getTime()) / 1000 / 60;
      return sum + (isNaN(duration) ? 0 : duration);
    }, 0);

    const totalCapacityHours = totalCapacityMinutes / 60;
    const usedCapacityHours = completedPoints * 1; // Assuming 1 point = 1 hour
    const capacityUtilization = totalCapacityHours > 0 ? (usedCapacityHours / totalCapacityHours) * 100 : 0;

    const daysDiff = Math.ceil((sprintEnd.getTime() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));
    const daysUsed = Math.ceil((Date.now() - sprintStart.getTime()) / (1000 * 60 * 60 * 24));

    // Get unique goals covered by stories in this sprint
    const goalIds = new Set(stories.map(s => s.goalId).filter(Boolean));

    const snapshot: SprintMetricsSnapshot = {
      sprintId: sprint.id,
      sprintName: sprint.name || 'Unnamed Sprint',
      completionDate: Date.now(),
      storyProgress: stories.length > 0 ? Math.round((completedStories / stories.length) * 100) : 0,
      taskProgress: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0,
      totalStories: stories.length,
      completedStories,
      totalTasks: tasks.length,
      completedTasks,
      totalPoints,
      completedPoints,
      totalCapacityHours: Math.round(totalCapacityHours),
      usedCapacityHours: Math.round(usedCapacityHours),
      capacityUtilization: Math.round(capacityUtilization),
      daysTotal: daysDiff,
      daysUsed,
      goalsCovered: goalIds.size,
      openStoriesCount: stories.length - completedStories,
      openTasksCount: tasks.length - completedTasks
    };

    setMetricsSnapshot(snapshot);
  };

  const handleCreateNewSprint = async () => {
    if (!currentUser || !newSprintData.name.trim()) return;

    try {
      const startDate = new Date();
      const endDate = new Date(Date.now() + (newSprintData.duration * 24 * 60 * 60 * 1000));

      const newSprintDoc = await addDoc(collection(db, 'sprints'), {
        name: newSprintData.name,
        objective: newSprintData.objective,
        startDate: startDate.getTime(),
        endDate: endDate.getTime(),
        status: 1, // Active
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        points: 0,
        velocity: 0
      });

      setTargetSprintId(newSprintDoc.id);
      setCreateNewSprint(false);
      return newSprintDoc.id;
    } catch (error) {
      console.error('Error creating new sprint:', error);
      throw error;
    }
  };

  const migrateOpenStories = async () => {
    if (!targetSprintId) return;

    const openStories = stories.filter(s => s.status !== 4);
    
    for (const story of openStories) {
      await updateDoc(doc(db, 'stories', story.id), {
        sprintId: targetSprintId,
        updatedAt: Date.now()
      });
    }
  };

  const validateCapacity = async () => {
    if (!targetSprintId) return { canFit: true, reason: '', remainingPoints: 0, targetCapacity: 0 };

    const targetSprint = sprints.find(s => s.id === targetSprintId);
    if (!targetSprint) return { canFit: false, reason: 'Target sprint not found', remainingPoints: 0, targetCapacity: 0 };

    const openStories = stories.filter(s => !isStatus(s.status, 'done'));
    const openTasks = tasks.filter(t => !isStatus(t.status, 'done'));
    const remainingPoints = openStories.reduce((sum, s) => sum + (s.points || 0), 0);

    const targetStart = new Date(targetSprint.startDate);
    const targetEnd = new Date(targetSprint.endDate);
    const sprintWeeks = Math.max(1, Math.ceil((targetEnd.getTime() - targetStart.getTime()) / (1000 * 60 * 60 * 24 * 7)));
    const plannerCapacityHours = weeklyPlannerMinutes > 0 ? (weeklyPlannerMinutes / 60) * sprintWeeks : null;

    const targetBlocks = calendarBlocks.filter(block => {
      const blockStart = getTimestamp(block.start || block.startTime);
      return blockStart && blockStart >= targetStart.getTime() && blockStart <= targetEnd.getTime()
        && !block.allDay
        && block.source !== 'gcal'
        && (block.theme === 'Growth' || block.theme === 'Work' || !block.theme);
    });

    const fallbackCapacityHours = targetBlocks.reduce((sum, block) => {
      const startMs = getTimestamp(block.start || block.startTime);
      const endMs = getTimestamp(block.end || block.endTime);
      if (!startMs || !endMs || endMs <= startMs) return sum;
      return sum + (endMs - startMs) / 1000 / 60 / 60;
    }, 0);

    const targetCapacityHours = plannerCapacityHours ?? fallbackCapacityHours;
    if (!targetCapacityHours || targetCapacityHours <= 0) {
      return {
        canFit: false,
        reason: 'Planner allocations and calendar availability are empty, so sprint capacity cannot be determined.',
        remainingPoints,
        targetCapacity: 0,
        availableCapacity: 0,
        existingWorkload: 0,
        idealCapacity: 0,
        capacityUtilization: 100,
        recommendation: 'Add weekly planner blocks or calendar availability before migrating work.'
      };
    }

    const openStoryIds = new Set(openStories.map(s => s.id));
    const openTaskIds = new Set(openTasks.map(t => t.id));
    const relevantBlocks = calendarBlocks.filter(block => {
      const startMs = getTimestamp(block.start || block.startTime);
      const endMs = getTimestamp(block.end || block.endTime);
      if (!startMs || !endMs || endMs <= startMs) return false;
      if (startMs < targetStart.getTime() || startMs > targetEnd.getTime()) return false;
      if (block.allDay) return false;
      if (block.source === 'gcal') return false;
      return (block.storyId && openStoryIds.has(block.storyId)) || (block.taskId && openTaskIds.has(block.taskId));
    });

    const actualHours = relevantBlocks.reduce((sum, block) => {
      const startMs = getTimestamp(block.start || block.startTime);
      const endMs = getTimestamp(block.end || block.endTime);
      if (!startMs || !endMs || endMs <= startMs) return sum;
      return sum + (endMs - startMs) / 1000 / 60 / 60;
    }, 0);

    const availableCapacity = Math.max(0, targetCapacityHours - actualHours);
    const canFit = remainingPoints <= availableCapacity;
    const utilization = Math.min(999, Math.round(((actualHours + remainingPoints) / targetCapacityHours) * 100));

    return {
      canFit,
      reason: canFit
        ? ''
        : `Remaining ${remainingPoints} story points would exceed available capacity. Planned: ${Math.round(targetCapacityHours)}h, scheduled: ${Math.round(actualHours)}h, available: ${Math.round(availableCapacity)}h.`,
      remainingPoints,
      targetCapacity: Math.round(targetCapacityHours),
      availableCapacity: Math.round(availableCapacity),
      existingWorkload: Math.round(actualHours),
      idealCapacity: Math.round(targetCapacityHours),
      capacityUtilization: utilization,
      recommendation: utilization > 100
        ? 'Capacity exceeded. Reduce scope or add weekly planner blocks.'
        : utilization > 80
          ? 'Consider extending sprint duration or reducing scope'
          : 'Good capacity utilization'
    };
  };

  const handleSprintClosure = async () => {
    if (!currentUser || !metricsSnapshot) return;

    setClosing(true);
    try {
      // Save metrics snapshot
      await addDoc(collection(db, 'sprint_closures'), {
        ...metricsSnapshot,
        retrospective: retroNotes,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: Date.now()
      });

      // Update sprint status to closed
      await updateDoc(doc(db, 'sprints', sprint.id), {
        status: 2, // Closed
        updatedAt: Date.now(),
        closedAt: Date.now()
      });

      // Migrate open stories if target sprint selected
      if (targetSprintId || createNewSprint) {
        let finalTargetId = targetSprintId;
        
        if (createNewSprint) {
          finalTargetId = await handleCreateNewSprint();
        }

        if (finalTargetId) {
          await migrateOpenStories();
          setSelectedSprintId(finalTargetId);
        }
      }

      setStep('complete');
    } catch (error) {
      console.error('Error closing sprint:', error);
      alert('Failed to close sprint. Please try again.');
    } finally {
      setClosing(false);
    }
  };

  if (loading) {
    return (
      <Modal show={show} onHide={onHide} size="lg" centered>
        <Modal.Body className="text-center p-5">
          <Spinner animation="border" />
          <p className="mt-3">Loading sprint data...</p>
        </Modal.Body>
      </Modal>
    );
  }

  return (
    <Modal show={show} onHide={onHide} size="xl" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center">
          <RotateCcw className="me-2" />
          Close Sprint: {sprint.name}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {step === 'metrics' && metricsSnapshot && (
          <div>
            <h5 className="mb-4">📊 Sprint Metrics Snapshot</h5>
            
            <Row className="mb-4">
              <Col md={3}>
                <Card className="border-primary">
                  <Card.Body className="text-center">
                    <TrendingUp size={32} className="text-primary mb-2" />
                    <h3>{metricsSnapshot.storyProgress}%</h3>
                    <small className="text-muted">Story Completion</small>
                    <div className="mt-1">
                      <small>{metricsSnapshot.completedStories}/{metricsSnapshot.totalStories} stories</small>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={3}>
                <Card className="border-success">
                  <Card.Body className="text-center">
                    <CheckCircle size={32} className="text-success mb-2" />
                    <h3>{metricsSnapshot.taskProgress}%</h3>
                    <small className="text-muted">Task Completion</small>
                    <div className="mt-1">
                      <small>{metricsSnapshot.completedTasks}/{metricsSnapshot.totalTasks} tasks</small>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={3}>
                <Card className="border-warning">
                  <Card.Body className="text-center">
                    <Target size={32} className="text-warning mb-2" />
                    <h3>{metricsSnapshot.completedPoints}/{metricsSnapshot.totalPoints}</h3>
                    <small className="text-muted">Story Points</small>
                    <div className="mt-1">
                      <small>{Math.round((metricsSnapshot.completedPoints / metricsSnapshot.totalPoints) * 100) || 0}% complete</small>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
              <Col md={3}>
                <Card className="border-info">
                  <Card.Body className="text-center">
                    <Calendar size={32} className="text-info mb-2" />
                    <h3>{metricsSnapshot.capacityUtilization}%</h3>
                    <small className="text-muted">Capacity Used</small>
                    <div className="mt-1">
                      <small>{metricsSnapshot.usedCapacityHours}/{metricsSnapshot.totalCapacityHours} hours</small>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>

            <Table striped bordered hover size="sm">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Value</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Sprint Duration</td>
                  <td>{metricsSnapshot.daysUsed}/{metricsSnapshot.daysTotal} days</td>
                  <td>Days consumed vs total planned</td>
                </tr>
                <tr>
                  <td>Goals Covered</td>
                  <td>{metricsSnapshot.goalsCovered}</td>
                  <td>Unique goals with stories in this sprint</td>
                </tr>
                <tr>
                  <td>Open Work</td>
                  <td>{metricsSnapshot.openStoriesCount} stories, {metricsSnapshot.openTasksCount} tasks</td>
                  <td>Work that needs migration to next sprint</td>
                </tr>
              </tbody>
            </Table>

            {metricsSnapshot.openStoriesCount > 0 && (
              <Alert variant="warning">
                <AlertCircle size={16} className="me-2" />
                You have {metricsSnapshot.openStoriesCount} open stories and {metricsSnapshot.openTasksCount} open tasks that will need to be migrated to another sprint.
              </Alert>
            )}
          </div>
        )}

        {step === 'retrospective' && (
          <div>
            <h5 className="mb-4">📝 Sprint Retrospective</h5>
            <Form>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>What went well? ✅</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={retroNotes.wentWell}
                      onChange={(e) => setRetroNotes({ ...retroNotes, wentWell: e.target.value })}
                      placeholder="Successes, achievements, positive outcomes..."
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>What could be improved? 🔄</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={retroNotes.toImprove}
                      onChange={(e) => setRetroNotes({ ...retroNotes, toImprove: e.target.value })}
                      placeholder="Areas for improvement, processes to refine..."
                    />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Blockers encountered? 🚧</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={retroNotes.blockers}
                      onChange={(e) => setRetroNotes({ ...retroNotes, blockers: e.target.value })}
                      placeholder="What slowed down progress, dependencies..."
                    />
                  </Form.Group>

                  <Form.Group className="mb-3">
                    <Form.Label>Key learnings? 💡</Form.Label>
                    <Form.Control
                      as="textarea"
                      rows={4}
                      value={retroNotes.learnings}
                      onChange={(e) => setRetroNotes({ ...retroNotes, learnings: e.target.value })}
                      placeholder="Insights, lessons learned, new knowledge..."
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3">
                <Form.Label>Next sprint focus? 🎯</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={retroNotes.nextSprintFocus}
                  onChange={(e) => setRetroNotes({ ...retroNotes, nextSprintFocus: e.target.value })}
                  placeholder="What should be the main focus for the next sprint?"
                />
              </Form.Group>
            </Form>
          </div>
        )}

        {step === 'migration' && (
          <div>
            <h5 className="mb-4">📦 Migrate Open Work</h5>
            
            {metricsSnapshot && metricsSnapshot.openStoriesCount > 0 ? (
              <div>
                <Alert variant="info">
                  You have {metricsSnapshot.openStoriesCount} open stories and {metricsSnapshot.openTasksCount} open tasks that need to be moved to another sprint.
                </Alert>

                <Form.Group className="mb-3">
                  <Form.Label>Migration Option</Form.Label>
                  <div>
                    <Form.Check
                      type="radio"
                      label="Move to existing sprint"
                      name="migrationOption"
                      checked={!createNewSprint}
                      onChange={() => setCreateNewSprint(false)}
                    />
                    <Form.Check
                      type="radio"
                      label="Create new sprint"
                      name="migrationOption"
                      checked={createNewSprint}
                      onChange={() => setCreateNewSprint(true)}
                    />
                  </div>
                </Form.Group>

                {!createNewSprint ? (
                  <Form.Group className="mb-3">
                    <Form.Label>Target Sprint</Form.Label>
                    <Form.Select
                      value={targetSprintId}
                      onChange={(e) => setTargetSprintId(e.target.value)}
                    >
                      <option value="">Select a sprint...</option>
                      {sprints.filter(s => s.status !== 2).map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.status === 1 ? 'Active' : 'Planned'})
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                ) : (
                  <div>
                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-3">
                          <Form.Label>New Sprint Name</Form.Label>
                          <Form.Control
                            value={newSprintData.name}
                            onChange={(e) => setNewSprintData({ ...newSprintData, name: e.target.value })}
                            placeholder="Sprint name..."
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-3">
                          <Form.Label>Duration (days)</Form.Label>
                          <Form.Control
                            type="number"
                            value={newSprintData.duration}
                            onChange={(e) => setNewSprintData({ ...newSprintData, duration: parseInt(e.target.value) || 14 })}
                          />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Form.Group className="mb-3">
                      <Form.Label>Sprint Objective</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={2}
                        value={newSprintData.objective}
                        onChange={(e) => setNewSprintData({ ...newSprintData, objective: e.target.value })}
                        placeholder="What is the main goal for this sprint?"
                      />
                    </Form.Group>
                  </div>
                )}

                {/* Capacity validation will be shown here when implemented */}
              {capacityValidationResult && targetSprintId && (
                <Alert variant={capacityValidationResult.canFit ? "success" : "warning"} className="mt-3">
                  <h6 className="alert-heading mb-3">
                    {capacityValidationResult.canFit ? "✅ Capacity Check: Good to Go" : "⚠️ Capacity Warning"}
                  </h6>
                  <Row className="small">
                    <Col md={6}>
                      <ul className="list-unstyled mb-2">
                        <li><strong>Stories to migrate:</strong> {metricsSnapshot?.openStoriesCount} stories ({capacityValidationResult.remainingPoints} points)</li>
                        <li><strong>Target capacity:</strong> {capacityValidationResult.targetCapacity}h total</li>
                        <li><strong>Available capacity:</strong> {capacityValidationResult.availableCapacity}h free</li>
                        <li><strong>Existing workload:</strong> {capacityValidationResult.existingWorkload} points</li>
                      </ul>
                    </Col>
                    <Col md={6}>
                      <ul className="list-unstyled mb-2">
                        <li><strong>Ideal capacity:</strong> {capacityValidationResult.idealCapacity}h (6h/day)</li>
                        <li><strong>Utilization:</strong> {capacityValidationResult.capacityUtilization}%</li>
                        <li><strong>Recommendation:</strong> {capacityValidationResult.recommendation}</li>
                      </ul>
                    </Col>
                  </Row>
                  <p className="mb-0 text-muted">
                    {capacityValidationResult.canFit
                      ? 'Looks safe to migrate this work.'
                      : `Proceed with caution: ${capacityValidationResult.reason}`}
                  </p>
                </Alert>
              )}
            </div>
          ) : (
              <Alert variant="success">
                <CheckCircle size={16} className="me-2" />
                Great! All stories and tasks are complete. No migration needed.
              </Alert>
            )}
          </div>
        )}

        {step === 'complete' && (
          <div className="text-center py-5">
            <CheckCircle size={64} className="text-success mb-3" />
            <h4>Sprint Closed Successfully!</h4>
            <p className="text-muted">
              Your sprint metrics have been captured and retrospective notes saved.
              {targetSprintId && " Open work has been migrated to the target sprint."}
            </p>
          </div>
        )}
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={closing}>
          {step === 'complete' ? 'Close' : 'Cancel'}
        </Button>
        
        {step === 'metrics' && (
          <Button 
            variant="primary" 
            onClick={() => setStep('retrospective')}
          >
            Continue to Retrospective <ArrowRight size={16} className="ms-1" />
          </Button>
        )}
        
        {step === 'retrospective' && (
          <div>
            <Button 
              variant="outline-primary" 
              onClick={() => setStep('metrics')}
              className="me-2"
            >
              Back
            </Button>
            <Button 
              variant="primary" 
              onClick={() => setStep('migration')}
            >
              Continue to Migration <ArrowRight size={16} className="ms-1" />
            </Button>
          </div>
        )}
        
        {step === 'migration' && (
          <div>
            <Button 
              variant="outline-primary" 
              onClick={() => setStep('retrospective')}
              className="me-2"
            >
              Back
            </Button>
            <Button 
              variant="success" 
              onClick={handleSprintClosure}
              disabled={closing || (metricsSnapshot?.openStoriesCount! > 0 && !targetSprintId && !createNewSprint)}
            >
              {closing ? (
                <>
                  <Spinner animation="border" size="sm" className="me-2" />
                  Closing Sprint...
                </>
              ) : (
                'Complete Sprint Closure'
              )}
            </Button>
          </div>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default SprintCloseDialog;
