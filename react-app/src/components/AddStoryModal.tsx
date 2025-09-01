import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { generateRef } from '../utils/referenceGenerator';

interface AddStoryModalProps {
  onClose: () => void;
  show: boolean;
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

const AddStoryModal: React.FC<AddStoryModalProps> = ({ onClose, show }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    goalId: '',
    sprintId: '',
    priority: 'P2',
    points: 3
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // Load goals and sprints for the current persona
  useEffect(() => {
    if (show && currentUser) {
      const loadData = async () => {
        try {
          // Load goals for current persona
          const goalsQuery = query(
            collection(db, 'goals'),
            where('persona', '==', currentPersona),
            where('ownerUid', '==', currentUser.uid),
            where('status', '!=', 'dropped')
          );
          const goalsSnapshot = await getDocs(goalsQuery);
          const goalsData = goalsSnapshot.docs.map(doc => ({
            id: doc.id,
            title: doc.data().title,
            theme: doc.data().theme
          }));
          setGoals(goalsData);

          // Load active sprints for current persona
          const sprintsQuery = query(
            collection(db, 'sprints'),
            where('persona', '==', currentPersona),
            where('ownerUid', '==', currentUser.uid),
            where('status', 'in', ['active', 'planned'])
          );
          const sprintsSnapshot = await getDocs(sprintsQuery);
          const sprintsData = sprintsSnapshot.docs.map(doc => ({
            id: doc.id,
            name: doc.data().name,
            status: doc.data().status
          }));
          setSprints(sprintsData);
        } catch (error) {
          console.error('Error loading data:', error);
        }
      };
      loadData();
    }
  }, [show, currentUser, currentPersona]);

  const handleSubmit = async () => {
    if (!currentUser || !formData.title.trim()) return;

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

  const handleClose = () => {
    setFormData({ title: '', description: '', goalId: '', sprintId: '', priority: 'P2', points: 3 });
    setSubmitResult(null);
    onClose();
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
              onChange={(e) => setFormData({ ...formData, goalId: e.target.value })}
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
              onChange={(e) => setFormData({ ...formData, sprintId: e.target.value })}
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
