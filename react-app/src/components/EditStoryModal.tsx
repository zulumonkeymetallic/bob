import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { collection, query, getDocs, where, orderBy, updateDoc, doc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Goal, Sprint } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { getPriorityName, getStatusName, getThemeName } from '../utils/statusHelpers';

interface EditStoryModalProps {
  show: boolean;
  onHide: () => void;
  story: Story | null;
  goals: Goal[];
  onStoryUpdated?: () => void;
}

const EditStoryModal: React.FC<EditStoryModalProps> = ({ 
  show, 
  onHide, 
  story, 
  goals,
  onStoryUpdated 
}) => {
  const [editedStory, setEditedStory] = useState({
    title: '',
    description: '',
    goalId: '',
    priority: 2,
    status: 1,
    theme: 1,
    points: 0,
    acceptanceCriteria: '',
    sprintId: '' as string | ''
  });
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const { currentUser } = useAuth();

  // Initialize form when story changes
  useEffect(() => {
    if (story) {
      console.log('📝 EditStoryModal: Initializing with story:', story);
      setEditedStory({
        title: story.title || '',
        description: story.description || '',
        goalId: story.goalId || '',
        priority: story.priority || 2,
        status: story.status || 1,
        theme: story.theme || 1,
        points: story.points || 0,
        acceptanceCriteria: Array.isArray(story.acceptanceCriteria) 
          ? story.acceptanceCriteria.join('\n') 
          : story.acceptanceCriteria || '',
        sprintId: (story as any).sprintId || ''
      });
      setError(null);
      const currentGoal = goals.find(g => g.id === story.goalId);
      setGoalInput(currentGoal?.title || '');
    }
  }, [story, goals]);

  // Load sprints for the selector
  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('startDate', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[];
      setSprints(data);
    });
    return () => unsub();
  }, [currentUser]);

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
      const updates: any = {
        title: editedStory.title.trim(),
        description: editedStory.description.trim(),
        goalId: editedStory.goalId || null,
        priority: editedStory.priority,
        status: editedStory.status,
        points: editedStory.points,
        sprintId: editedStory.sprintId || null,
        acceptanceCriteria: editedStory.acceptanceCriteria.trim() 
          ? editedStory.acceptanceCriteria.split('\n').map(line => line.trim()).filter(line => line.length > 0)
          : [],
        updatedAt: serverTimestamp()
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
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>Edit Story: {story?.ref}</Modal.Title>
      </Modal.Header>
      
      <Modal.Body>
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}

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
                  {sprints.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.status === 1 ? '(Active)' : ''}
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
                  <option value={1}>P1 - High</option>
                  <option value={2}>P2 - Medium</option>
                  <option value={3}>P3 - Low</option>
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
                  <option value={1}>Planned</option>
                  <option value={2}>In Progress</option>
                  <option value={3}>Testing</option>
                  <option value={4}>Done</option>
                </Form.Select>
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
