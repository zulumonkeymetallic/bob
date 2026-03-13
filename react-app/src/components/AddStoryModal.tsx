import React, { useState, useCallback, useEffect } from 'react';
import { Modal, Button, Form, Alert, Dropdown, DropdownButton, Row, Col } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { generateRef } from '../utils/referenceGenerator';
import { parsePointsValue } from '../utils/points';
import TagInput from './common/TagInput';

interface AddStoryModalProps {
  onClose: () => void;
  show: boolean;
  goalId?: string; // Optional goalId to pre-select the goal
}

interface Goal {
  id: string;
  title: string;
  theme: number;
  persona?: 'personal' | 'work';
}

const AddStoryModal: React.FC<AddStoryModalProps> = ({ onClose, show, goalId }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints: allSprints } = useSprint();
  const sprints = allSprints.filter((s) => {
    const st = String(s.status || '').toLowerCase();
    return !['closed', 'completed', 'done', 'cancelled', 'archived'].includes(st);
  });
  const [goals, setGoals] = useState<Goal[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    url: '',
    goalId: goalId || '', // Pre-select goal if provided
    sprintId: '',
    priority: 2,
    points: 3,
    persona: (currentPersona || 'personal') as 'personal' | 'work',
    dueDate: '',
    dueTime: '',
    timeOfDay: '' as 'morning' | 'afternoon' | 'evening' | '',
    tags: [] as string[]
  });
  const [goalInput, setGoalInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // Update goalId when prop changes
  useEffect(() => {
    if (goalId) {
      setFormData(prev => ({
        ...prev,
        goalId: goalId
      }));
      const g = goals.find(gl => gl.id === goalId);
      setGoalInput(g?.title || '');
    }
  }, [goalId, goals]);

  // Log modal open/close state changes
  useEffect(() => {
    if (show) {
      console.log('📱 AddStoryModal: Modal opened', {
        action: 'modal_opened',
        element: 'add_story_modal',
        user: currentUser?.uid,
        persona: currentPersona,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('📱 AddStoryModal: Modal closed', {
        action: 'modal_closed',
        element: 'add_story_modal',
        timestamp: new Date().toISOString()
      });
    }
  }, [show, currentUser, currentPersona]);

  // Keep persona prefilled from the currently selected app persona when opening.
  useEffect(() => {
    if (show) {
      setFormData(prev => ({
        ...prev,
        persona: (currentPersona || 'personal') as 'personal' | 'work',
      }));
    }
  }, [show, currentPersona]);

  // Load goals and sprints when modal opens
  useEffect(() => {
    if (show && currentUser) {
      let mounted = true;
      const loadData = async () => {
        try {
          console.log('🔄 AddStoryModal: Starting data load for modal', {
            action: 'modal_data_load_start',
            user: currentUser.uid,
            persona: currentPersona,
            timestamp: new Date().toISOString()
          });

          // Load goals (filter by persona on client so personal includes legacy nulls)
          const goalsQuery = query(
            collection(db, 'goals'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('priority', 'desc')
          );

          console.log('📊 AddStoryModal: Loading goals...', {
            action: 'goals_query_start',
            user: currentUser.uid
          });

          const goalsSnapshot = await getDocs(goalsQuery);
          const selectedPersona = (formData.persona || currentPersona || 'personal') as 'personal' | 'work';
          const goalsData = goalsSnapshot.docs
            .map(doc => ({
              id: doc.id,
              title: doc.data().title,
              theme: doc.data().theme as number,
              persona: doc.data().persona as any
            }))
            .filter(goal => {
              if (selectedPersona === 'work') return goal.persona === 'work';
              return goal.persona == null || goal.persona === 'personal';
            });

          console.log('✅ AddStoryModal: Goals loaded successfully', {
            action: 'goals_loaded',
            count: goalsData.length,
            goals: goalsData.map(g => ({ id: g.id, title: g.title }))
          });

          if (mounted) setGoals(goalsData);

          console.log('🎉 AddStoryModal: All data loaded successfully', {
            action: 'modal_data_load_complete',
            goalsCount: goalsData.length,
          });

        } catch (error) {
          console.error('❌ AddStoryModal: Error loading data', {
            action: 'modal_data_load_error',
            error: error.message,
            stack: error.stack,
            user: currentUser?.uid,
            persona: currentPersona
          });
        }
      };
      loadData();
      return () => { mounted = false; };
    }
  }, [show, currentUser, currentPersona, formData.persona]);

  const handleClose = () => {
    console.log('🖱️ AddStoryModal: Cancel button clicked', {
      action: 'cancel_button_click',
      element: 'cancel_button',
      formData: formData,
      timestamp: new Date().toISOString()
    });
    setFormData({ title: '', description: '', url: '', goalId: '', sprintId: '', priority: 2, points: 3, persona: (currentPersona || 'personal') as 'personal' | 'work', dueDate: '', dueTime: '', timeOfDay: '', tags: [] });
    setSubmitResult(null);
    onClose();
  };

  const handleSubmit = async () => {
    console.log('🖱️ AddStoryModal: Create Story button clicked', {
      action: 'create_story_button_click',
      element: 'create_button',
      formData: formData,
      selectedGoal: goals.find(g => g.id === formData.goalId),
      selectedSprint: sprints.find(s => s.id === formData.sprintId),
      timestamp: new Date().toISOString()
    });

    if (!currentUser || !formData.title.trim()) {
      console.log('⚠️ AddStoryModal: Create Story validation failed', {
        action: 'create_story_validation_failed',
        hasUser: !!currentUser,
        hasTitle: !!formData.title.trim(),
        formData: formData,
        timestamp: new Date().toISOString()
      });
      return;
    }

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      console.log('🚀 AddStoryModal: Starting STORY creation', {
        action: 'story_creation_start',
        user: currentUser.uid,
        persona: currentPersona,
        title: formData.title.trim(),
        goalId: formData.goalId,
        priority: formData.priority,
        timestamp: new Date().toISOString()
      });

      // Get existing story references for unique ref generation
      const existingStoriesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid)
      );
      const existingSnapshot = await getDocs(existingStoriesQuery);
      const existingRefs = existingSnapshot.docs
        .map(doc => doc.data().ref)
        .filter(ref => ref);

      // Generate unique reference number
      const ref = generateRef('story', existingRefs);
      console.log('🏷️ AddStoryModal: Generated reference', {
        action: 'reference_generated',
        ref: ref,
        timestamp: new Date().toISOString()
      });

      const linkedGoal = goals.find(g => g.id === formData.goalId);
      const parsedPoints = parsePointsValue(formData.points);
      const storyData = {
        ref: ref, // Add reference number
        title: formData.title.trim(),
        description: formData.description.trim(),
          url: formData.url.trim() || null,
        goalId: formData.goalId,
        sprintId: formData.sprintId || null,
        priority: formData.priority,
        points: parsedPoints == null ? 1 : parsedPoints,
        dueDate: formData.dueDate ? new Date(`${formData.dueDate}T00:00:00`).getTime() : null,
        dueTime: formData.dueTime || null,
        timeOfDay: formData.timeOfDay || null,
        status: 0,
        theme: linkedGoal?.theme ?? 1,
          persona: formData.persona || currentPersona || 'personal',
        ownerUid: currentUser.uid, // Ensure ownerUid is included
        orderIndex: Date.now(), // Simple ordering by creation time
        tags: formData.tags,
        acceptanceCriteria: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      console.log('💾 AddStoryModal: Saving STORY to database', {
        action: 'story_save_start',
        data: storyData,
        timestamp: new Date().toISOString()
      });

      await addDoc(collection(db, 'stories'), storyData);

      console.log('✅ AddStoryModal: STORY created successfully', {
        action: 'story_creation_success',
        ref: ref,
        storyId: 'pending_from_firestore',
        goalId: formData.goalId || 'none',
        timestamp: new Date().toISOString()
      });

      setSubmitResult(`✅ Story created successfully! (${ref})`);
      setFormData({ title: '', description: '', url: '', goalId: '', sprintId: '', priority: 2, points: 3, persona: (currentPersona || 'personal') as 'personal' | 'work', dueDate: '', dueTime: '', timeOfDay: '', tags: [] });

      // Auto-close after success
      setTimeout(() => {
        onClose();
        setSubmitResult(null);
      }, 1500);

    } catch (error) {
      console.error('❌ AddStoryModal: STORY creation failed', {
        action: 'story_creation_error',
        error: error.message,
        formData: formData,
        timestamp: new Date().toISOString()
      });
      setSubmitResult(`❌ Failed to create story: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} centered>
      <Modal.Header closeButton>
        <Modal.Title>Add New Story</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Form>
          <Form.Group className="mb-3">
            <Form.Label>Title *</Form.Label>
            <Form.Control
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Enter story title..."
              autoFocus
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Description</Form.Label>
            <Form.Control
              as="textarea"
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe this story..."
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Source URL</Form.Label>
            <Form.Control
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              placeholder="https://..."
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Persona</Form.Label>
            <Form.Select
              value={formData.persona}
              onChange={(e) => {
                setGoalInput('');
                setFormData({ ...formData, persona: e.target.value as 'personal' | 'work', goalId: '', sprintId: '' });
              }}
            >
              <option value="personal">Personal</option>
              <option value="work">Work</option>
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Tags</Form.Label>
            <TagInput
              value={formData.tags}
              onChange={(tags) => setFormData({ ...formData, tags })}
              placeholder="Add tags..."
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Link to Goal</Form.Label>
            <Form.Control
              list="add-story-goal-options"
              value={goalInput}
              onChange={(e) => setGoalInput(e.target.value)}
              onBlur={() => {
                const val = goalInput.trim();
                const match = goals.find(g => g.title === val || g.id === val);
                setFormData({ ...formData, goalId: match ? match.id : '' });
              }}
              placeholder="Search goals by title..."
            />
            <datalist id="add-story-goal-options">
              {goals.map(g => (
                <option key={g.id} value={g.title} />
              ))}
            </datalist>
            <Form.Text className="text-muted">
              Stories linked to goals contribute to goal progress
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Assign to Sprint</Form.Label>
            <Form.Select
              value={formData.sprintId}
              onChange={(e) => {
                console.log('🏃‍♂️ AddStoryModal: Sprint selection changed', {
                  action: 'sprint_select_change',
                  element: 'sprint_dropdown',
                  previousValue: formData.sprintId,
                  newValue: e.target.value,
                  selectedSprint: sprints.find(s => s.id === e.target.value),
                  availableSprints: sprints.length,
                  timestamp: new Date().toISOString()
                });
                setFormData({ ...formData, sprintId: e.target.value });
              }}
              onClick={() => {
                console.log('🖱️ AddStoryModal: Sprint dropdown clicked', {
                  action: 'sprint_dropdown_click',
                  element: 'sprint_select',
                  currentValue: formData.sprintId,
                  availableOptions: sprints.length,
                  timestamp: new Date().toISOString()
                });
              }}
            >
              <option value="">No sprint (backlog)</option>
              {sprints.map(sprint => (
                <option key={sprint.id} value={sprint.id}>
                  {sprint.name} ({sprint.status})
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">
              Assign to a sprint for sprint planning
            </Form.Text>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Priority</Form.Label>
            <Form.Select
              value={formData.priority}
              onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value, 10) })}
            >
              <option value={4}>Critical</option>
              <option value={1}>High</option>
              <option value={2}>Medium</option>
              <option value={3}>Low</option>
            </Form.Select>
          </Form.Group>

          <Row>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Due Date</Form.Label>
                <Form.Control
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Due Time</Form.Label>
                <Form.Control
                  type="time"
                  value={formData.dueTime}
                  onChange={(e) => setFormData({ ...formData, dueTime: e.target.value })}
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label>Time of Day</Form.Label>
                <Form.Select
                  value={formData.timeOfDay}
                  onChange={(e) => setFormData({ ...formData, timeOfDay: e.target.value as any as any })}
                >
                  <option value="">Auto/None</option>
                  <option value="morning">Morning</option>
                  <option value="afternoon">Afternoon</option>
                  <option value="evening">Evening</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>

          <Form.Group className="mb-3">
            <Form.Label>Story Points</Form.Label>
            <Form.Control
              type="number"
              step="any"
              inputMode="decimal"
              value={formData.points}
              onChange={(e) => setFormData({
                ...formData,
                points: e.target.value as any,
              })}
            />
          </Form.Group>
        </Form>

        {submitResult && (
          <Alert variant={submitResult.includes('✅') ? 'success' : 'danger'}>
            {submitResult}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={isSubmitting || !formData.title.trim()}
        >
          {isSubmitting ? 'Creating...' : 'Create Story'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default AddStoryModal;

export { };
