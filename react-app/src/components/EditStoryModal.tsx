import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { updateDoc, doc, serverTimestamp, collection, query, where, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Goal, Sprint, Task } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { usePersona } from '../contexts/PersonaContext';
import { isStatus } from '../utils/statusHelpers';
import { normalizePriorityValue } from '../utils/priorityUtils';
import TagInput from './common/TagInput';
import ActivityStreamPanel from './common/ActivityStreamPanel';
import ModernTaskTable from './ModernTaskTable';

interface EditStoryModalProps {
  show: boolean;
  onHide: () => void;
  story: Story | null;
  goals: Goal[];
  onStoryUpdated?: () => void;
  container?: HTMLElement | null;
}

const EditStoryModal: React.FC<EditStoryModalProps> = ({
  show,
  onHide,
  story,
  goals,
  onStoryUpdated,
  container
}) => {
  const { sprints } = useSprint();
  const { currentPersona } = usePersona();
  const [editedStory, setEditedStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 2,
    status: 0,
    theme: 1,
    points: 0,
    acceptanceCriteria: '',
    sprintId: '' as string | '',
    blocked: false as boolean,
    tags: [] as string[]
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const { currentUser } = useAuth();
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const isHiddenSprint = (sprint: Sprint) => isStatus(sprint.status, 'closed') || isStatus(sprint.status, 'cancelled');
  const formatSprintLabel = (sprint: Sprint, statusOverride?: string) => {
    const name = sprint.name || sprint.ref || `Sprint ${sprint.id.slice(-4)}`;
    const statusLabel = statusOverride
      ? ` (${statusOverride})`
      : (isStatus(sprint.status, 'active') ? ' (Active)' : '');
    return `${name}${statusLabel}`;
  };
  const visibleSprints = sprints.filter((sprint) => !isHiddenSprint(sprint));
  const selectedSprint = editedStory.sprintId ? sprints.find((sprint) => sprint.id === editedStory.sprintId) : null;
  const selectedSprintStatus = selectedSprint
    ? (isStatus(selectedSprint.status, 'closed') ? 'Completed' : (isStatus(selectedSprint.status, 'cancelled') ? 'Cancelled' : ''))
    : '';

  // Initialize form when story changes
  useEffect(() => {
    if (story) {
      console.log('📝 EditStoryModal: Initializing with story:', story);
      const normalizedPriority = normalizePriorityValue((story as any).priority);
      setEditedStory({
        title: story.title || '',
        description: story.description || '',
        goalId: story.goalId || '',
        priority: normalizedPriority > 0 ? normalizedPriority : 2,
        status: (typeof story.status === 'number' ? (story.status >= 4 ? 4 : story.status >= 2 ? 2 : 0) : 0),
        theme: story.theme || 1,
        points: story.points || 0,
        acceptanceCriteria: Array.isArray(story.acceptanceCriteria)
          ? story.acceptanceCriteria.join('\n')
          : story.acceptanceCriteria || '',
        sprintId: (story as any).sprintId || '',
        blocked: Boolean((story as any).blocked),
        tags: (story as any).tags || []
      });
      setError(null);
      const currentGoal = goals.find(g => g.id === story.goalId);
      setGoalInput(currentGoal?.title || '');
    }
  }, [story, goals]);

  useEffect(() => {
    const loadTasks = async () => {
      if (!show || !story || !currentUser) {
        setLinkedTasks([]);
        return;
      }
      setTasksLoading(true);
      try {
        const baseQuery = query(
          collection(db, 'tasks'),
          where('ownerUid', '==', currentUser.uid)
        );
        const snap = await getDocs(baseQuery);
        const raw = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
        const persona = (story as any)?.persona || currentPersona;
        const filtered = raw.filter((task) => {
          if (persona && task.persona && task.persona !== persona) return false;
          return task.parentId === story.id || task.storyId === story.id;
        });
        setLinkedTasks(filtered);
      } catch (err) {
        console.error('Failed to load linked tasks', err);
        setLinkedTasks([]);
      } finally {
        setTasksLoading(false);
      }
    };
    loadTasks();
  }, [show, story?.id, currentUser?.uid, currentPersona]);

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    if (!currentUser) return;
    const payload: any = { ...updates, updatedAt: serverTimestamp() };
    if (updates.storyId) {
      payload.parentType = 'story';
      payload.parentId = updates.storyId;
      const targetStory = updates.storyId === story?.id ? story : null;
      if (targetStory?.goalId) payload.goalId = targetStory.goalId;
    }
    await updateDoc(doc(db, 'tasks', taskId), payload);
    setLinkedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } as Task : t)));
    if (updates.storyId && story && updates.storyId !== story.id) {
      setLinkedTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    await deleteDoc(doc(db, 'tasks', taskId));
    setLinkedTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() } as any);
    setLinkedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, priority: newPriority } as Task : t)));
  };

  const handleTaskCreate = async (newTask: Partial<Task>) => {
    if (!currentUser || !story) return;
    const payload: any = {
      title: newTask.title || '',
      description: newTask.description || '',
      status: (newTask as any).status ?? 0,
      priority: (newTask as any).priority ?? 2,
      effort: (newTask as any).effort ?? 'M',
      dueDate: (newTask as any).dueDate || null,
      points: (newTask as any).points ?? 1,
      ownerUid: currentUser.uid,
      persona: (story as any)?.persona || currentPersona || 'personal',
      storyId: story.id,
      parentType: 'story',
      parentId: story.id,
      goalId: story.goalId || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'tasks'), payload);
    setLinkedTasks((prev) => [...prev, { id: ref.id, ...(payload as any) } as Task]);
  };

  const handleSave = async () => {
    if (!story || !editedStory.title.trim()) {
      setError('Title is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('💾 EditStoryModal: Saving story updates:', editedStory);

      const selectedGoal = goals.find(g => g.id === editedStory.goalId);
      const normalizedPriority = normalizePriorityValue(editedStory.priority);
      const updates: any = {
        title: editedStory.title.trim(),
        description: editedStory.description.trim(),
        goalId: editedStory.goalId || null,
        priority: normalizedPriority > 0 ? normalizedPriority : 2,
        status: editedStory.status,
        blocked: !!editedStory.blocked,
        points: editedStory.points,
        sprintId: editedStory.sprintId || null,
        acceptanceCriteria: editedStory.acceptanceCriteria.trim()
          ? editedStory.acceptanceCriteria.split('\n').map(line => line.trim()).filter(line => line.length > 0)
          : [],
        updatedAt: serverTimestamp(),
        tags: editedStory.tags
      };
      // Inherit theme from linked goal when available
      if (selectedGoal && typeof (selectedGoal as any).theme !== 'undefined') {
        updates.theme = (selectedGoal as any).theme;
      }
      await updateDoc(doc(db, 'stories', story.id), updates);

      console.log('✅ EditStoryModal: Story updated successfully');
      onStoryUpdated?.();
      onHide();
    } catch (err) {
      console.error('❌ EditStoryModal: Error updating story:', err);
      setError('Failed to update story. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setEditedStory(prev => ({
      ...prev,
      [field]: value
    }));
  };

  return (
    <Modal show={show} onHide={onHide} size="xl" container={container || undefined} fullscreen="lg-down" scrollable>
      <Modal.Header closeButton>
        <Modal.Title>Edit Story: {story?.ref}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}

        <Row className="g-3">
          <Col lg={8}>
            <Form>
              <Row>
                <Col md={8}>
                  <Form.Group className="mb-3">
                    <Form.Label>Title *</Form.Label>
                    <Form.Control
                      type="text"
                      value={editedStory.title}
                      onChange={(e) => handleInputChange('title', e.target.value)}
                      placeholder="Enter story title"
                    />
                  </Form.Group>
                </Col>

                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Story Points</Form.Label>
                    <Form.Control
                      type="number"
                      min="0"
                      max="21"
                      value={editedStory.points}
                      onChange={(e) => handleInputChange('points', parseInt(e.target.value) || 0)}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Sprint</Form.Label>
                    <Form.Select
                      value={editedStory.sprintId}
                      onChange={(e) => handleInputChange('sprintId', e.target.value)}
                    >
                      <option value="">Backlog (No Sprint)</option>
                      {selectedSprint && isHiddenSprint(selectedSprint) && (
                        <option key={selectedSprint.id} value={selectedSprint.id} disabled>
                          {formatSprintLabel(selectedSprint, selectedSprintStatus || 'Inactive')}
                        </option>
                      )}
                      {visibleSprints.map((sprint) => (
                        <option key={sprint.id} value={sprint.id}>
                          {formatSprintLabel(sprint)}
                        </option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Linked Goal</Form.Label>
                    <Form.Control
                      list="edit-story-goal-options"
                      value={goalInput}
                      onChange={(e) => setGoalInput(e.target.value)}
                      onBlur={() => {
                        const val = goalInput.trim();
                        const match = goals.find(g => g.title === val || g.id === val);
                        handleInputChange('goalId', match ? match.id : '');
                      }}
                      placeholder="Search goals by title..."
                    />
                    <datalist id="edit-story-goal-options">
                      {goals.map(g => (
                        <option key={g.id} value={g.title} />
                      ))}
                    </datalist>
                  </Form.Group>
                </Col>

                <Col md={2}>
                  <Form.Group className="mb-3">
                    <Form.Label>Priority</Form.Label>
                    <Form.Select
                      value={editedStory.priority}
                      onChange={(e) => handleInputChange('priority', parseInt(e.target.value))}
                    >
                      <option value={4}>Critical</option>
                      <option value={3}>High</option>
                      <option value={2}>Medium</option>
                      <option value={1}>Low</option>
                    </Form.Select>
                  </Form.Group>
                </Col>

                <Col md={2}>
                  <Form.Group className="mb-3">
                    <Form.Label>Status</Form.Label>
                    <Form.Select
                      value={editedStory.status}
                      onChange={(e) => handleInputChange('status', parseInt(e.target.value))}
                    >
                      <option value={0}>Backlog</option>
                      <option value={2}>In Progress</option>
                      <option value={4}>Done</option>
                    </Form.Select>
                  </Form.Group>
                </Col>

                <Col md={2}>
                  <Form.Group className="mb-3">
                    <Form.Label>&nbsp;</Form.Label>
                    <Form.Check
                      type="checkbox"
                      id="story-blocked-checkbox"
                      label="Blocked"
                      checked={!!editedStory.blocked}
                      onChange={(e) => handleInputChange('blocked', e.target.checked)}
                    />
                  </Form.Group>
                </Col>

                {/* Theme removed: stories inherit from linked goal */}
              </Row>

              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={editedStory.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Enter story description"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Tags</Form.Label>
                <TagInput
                  value={editedStory.tags}
                  onChange={(tags) => handleInputChange('tags', tags)}
                  placeholder="Add tags..."
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Acceptance Criteria</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={3}
                  value={editedStory.acceptanceCriteria}
                  onChange={(e) => handleInputChange('acceptanceCriteria', e.target.value)}
                  placeholder="Enter acceptance criteria"
                />
              </Form.Group>
            </Form>

          </Col>
          <Col lg={4}>
            <ActivityStreamPanel
              entityId={story?.id}
              entityType="story"
              referenceNumber={story?.ref || (story as any)?.referenceNumber}
            />
          </Col>
        </Row>

        <div className="mt-4">
          <h5 className="mb-2">Linked Tasks</h5>
          {tasksLoading ? (
            <div className="text-muted small">Loading tasks…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <ModernTaskTable
                tasks={linkedTasks}
                stories={story ? [story] : []}
                goals={goals}
                sprints={sprints as any}
                compact
                defaultColumns={['ref', 'title', 'status', 'priority', 'dueDate', 'points']}
                onTaskCreate={handleTaskCreate}
                onTaskUpdate={handleTaskUpdate}
                onTaskDelete={handleTaskDelete}
                onTaskPriorityChange={handleTaskPriorityChange}
              />
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={loading}>
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EditStoryModal;
