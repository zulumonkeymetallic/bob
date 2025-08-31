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

const AddStoryModal: React.FC<AddStoryModalProps> = ({ onClose, show }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 'P2',
    points: 3
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);

  // Load goals for the current persona
  useEffect(() => {
    if (show && currentUser && currentPersona === 'personal') {
      const loadGoals = async () => {
        try {
          const goalsQuery = query(
            collection(db, 'goals'),
            where('persona', '==', 'personal'),
            where('ownerUid', '==', currentUser.uid),
            where('status', '!=', 'dropped')
          );
          const snapshot = await getDocs(goalsQuery);
          const goalsData = snapshot.docs.map(doc => ({
            id: doc.id,
            title: doc.data().title,
            theme: doc.data().theme
          }));
          setGoals(goalsData);
        } catch (error) {
          console.error('Error loading goals:', error);
        }
      };
      loadGoals();
    }
  }, [show, currentUser, currentPersona]);

  const handleSubmit = async () => {
    if (!currentUser || !formData.title.trim()) return;

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
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

      await addDoc(collection(db, 'stories'), {
        ref: ref, // Add reference number
        title: formData.title.trim(),
        description: formData.description.trim(),
        goalId: formData.goalId,
        priority: formData.priority,
        points: parseInt(formData.points.toString()),
        status: 'backlog',
        persona: currentPersona,
        ownerUid: currentUser.uid,
        orderIndex: Date.now(), // Simple ordering by creation time
        tags: [],
        acceptanceCriteria: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });

      setSubmitResult(`✅ Story created successfully! (${ref})`);
      setFormData({ title: '', description: '', goalId: '', priority: 'P2', points: 3 });
      
      // Auto-close after success
      setTimeout(() => {
        onClose();
        setSubmitResult(null);
      }, 1500);

    } catch (error) {
      console.error('Story creation error:', error);
      setSubmitResult(`❌ Failed to create story: ${error.message}`);
    }
    setIsSubmitting(false);
  };

  const handleClose = () => {
    setFormData({ title: '', description: '', goalId: '', priority: 'P2', points: 3 });
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

          {currentPersona === 'personal' && (
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
          )}

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
