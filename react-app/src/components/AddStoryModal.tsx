import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { generateRef } from '../utils/referenceGenerator';

interface AddStoryModalProps {
  onClose: () => void;
  show: boolean;
  goalId?: string; // Optional goalId to pre-select the goal
}

interface Goal {
  id: string;
  title: string;
  theme: string;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
}

const AddStoryModal: React.FC<AddStoryModalProps> = ({ onClose, show, goalId }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    goalId: goalId || '', // Pre-select goal if provided
    sprintId: '',
    priority: 'P2',
    points: 3
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // Update goalId when prop changes
  useEffect(() => {
    if (goalId) {
      setFormData(prev => ({
        ...prev,
        goalId: goalId
      }));
    }
  }, [goalId]);

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

    // Load goals and sprints when modal opens
  useEffect(() => {
    if (show && currentUser) {
      const loadData = async () => {
        try {
          console.log('🔄 AddStoryModal: Starting data load for modal', {
            action: 'modal_data_load_start',
            user: currentUser.uid,
            persona: currentPersona,
            timestamp: new Date().toISOString()
          });

          // Load goals for all personas
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
          const goalsData = goalsSnapshot.docs.map(doc => ({
            id: doc.id,
            title: doc.data().title,
            theme: doc.data().theme
          }));
          
          console.log('✅ AddStoryModal: Goals loaded successfully', {
            action: 'goals_loaded',
            count: goalsData.length,
            goals: goalsData.map(g => ({ id: g.id, title: g.title }))
          });
          
          setGoals(goalsData);

          // Load all sprints for current user (simplified query to avoid index issues)
          const sprintsQuery = query(
            collection(db, 'sprints'),
            where('ownerUid', '==', currentUser.uid),
            orderBy('startDate', 'desc')
          );
          
          console.log('📊 AddStoryModal: Loading sprints...', {
            action: 'sprints_query_start',
            user: currentUser.uid
          });
          
          const sprintsSnapshot = await getDocs(sprintsQuery);
          const sprintsData = sprintsSnapshot.docs.map(doc => ({
            id: doc.id,
            name: doc.data().name,
            status: doc.data().status
          }));
          
          console.log('✅ AddStoryModal: Sprints loaded successfully', {
            action: 'sprints_loaded',
            count: sprintsData.length,
            sprints: sprintsData.map(s => ({ id: s.id, name: s.name, status: s.status }))
          });
          
          setSprints(sprintsData);
          
          console.log('🎉 AddStoryModal: All data loaded successfully', {
            action: 'modal_data_load_complete',
            goalsCount: goalsData.length,
            sprintsCount: sprintsData.length
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
    }
  }, [show, currentUser, currentPersona]);

  const handleClose = () => {
    console.log('🖱️ AddStoryModal: Cancel button clicked', {
      action: 'cancel_button_click',
      element: 'cancel_button',
      formData: formData,
      timestamp: new Date().toISOString()
    });
    setFormData({ title: '', description: '', goalId: '', sprintId: '', priority: 'P2', points: 3 });
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

      const storyData = {
        ref: ref, // Add reference number
        title: formData.title.trim(),
        description: formData.description.trim(),
        goalId: formData.goalId,
        sprintId: formData.sprintId,
        priority: formData.priority,
        points: parseInt(formData.points.toString()),
        status: 'backlog',
        persona: currentPersona,
        ownerUid: currentUser.uid, // Ensure ownerUid is included
        orderIndex: Date.now(), // Simple ordering by creation time
        tags: [],
        acceptanceCriteria: [],
        createdAt: new Date(),
        updatedAt: new Date()
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
      setFormData({ title: '', description: '', goalId: '', sprintId: '', priority: 'P2', points: 3 });
      
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
    }
    setIsSubmitting(false);
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
            <Form.Label>Link to Goal</Form.Label>
            <Form.Select
              value={formData.goalId}
              onChange={(e) => {
                console.log('🎯 AddStoryModal: Goal selection changed', {
                  action: 'goal_select_change',
                  element: 'goal_dropdown',
                  previousValue: formData.goalId,
                  newValue: e.target.value,
                  selectedGoal: goals.find(g => g.id === e.target.value),
                  availableGoals: goals.length,
                  timestamp: new Date().toISOString()
                });
                setFormData({ ...formData, goalId: e.target.value });
              }}
              onClick={() => {
                console.log('🖱️ AddStoryModal: Goal dropdown clicked', {
                  action: 'goal_dropdown_click',
                  element: 'goal_select',
                  currentValue: formData.goalId,
                  availableOptions: goals.length,
                  timestamp: new Date().toISOString()
                });
              }}
            >
              <option value="">Select a goal (optional)</option>
              {goals.map(goal => (
                <option key={goal.id} value={goal.id}>
                  {goal.title} ({goal.theme})
                </option>
              ))}
            </Form.Select>
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
              onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
            >
              <option value="P1">P1 - Critical</option>
              <option value="P2">P2 - High</option>
              <option value="P3">P3 - Normal</option>
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label>Story Points</Form.Label>
            <Form.Select
              value={formData.points}
              onChange={(e) => setFormData({ ...formData, points: parseInt(e.target.value) })}
            >
              <option value={1}>1 - Trivial</option>
              <option value={2}>2 - Small</option>
              <option value={3}>3 - Medium</option>
              <option value={5}>5 - Large</option>
              <option value={8}>8 - Very Large</option>
            </Form.Select>
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

export {};
