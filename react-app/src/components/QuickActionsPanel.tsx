import React, { useState } from 'react';
import { Card, Button, ButtonGroup, Modal, Form } from 'react-bootstrap';
import { Plus, Target, BookOpen, Calendar, CheckSquare, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { generateRef } from '../utils/referenceGenerator';
import { ActivityStreamService } from '../services/ActivityStreamService';

interface QuickActionsProps {
  onAction?: (type: string, data: any) => void;
}

const QuickActionsPanel: React.FC<QuickActionsProps> = ({ onAction }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showModal, setShowModal] = useState(false);
  const [modalType, setModalType] = useState<'goal' | 'story' | 'task' | 'sprint'>('goal');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    theme: 1,
    priority: 'P2',
    status: 'new'
  });
  const [loading, setLoading] = useState(false);

  const quickActions = [
    {
      type: 'goal',
      icon: Target,
      label: 'Quick Goal',
      color: '#8b5cf6',
      description: 'Create a new goal'
    },
    {
      type: 'story',
      icon: BookOpen,
      label: 'Quick Story',
      color: '#059669',
      description: 'Add a new story'
    },
    {
      type: 'task',
      icon: CheckSquare,
      label: 'Quick Task',
      color: '#f59e0b',
      description: 'Create a task'
    },
    {
      type: 'sprint',
      icon: Calendar,
      label: 'Quick Sprint',
      color: '#ef4444',
      description: 'Plan a sprint'
    }
  ];

  const handleQuickAction = (type: 'goal' | 'story' | 'task' | 'sprint') => {
    setModalType(type);
    setFormData({
      title: '',
      description: '',
      theme: 1,
      priority: 'P2',
      status: type === 'goal' ? 'new' : 'backlog'
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!currentUser || !formData.title.trim()) return;

    setLoading(true);
    try {
      // Generate reference number
      const ref = generateRef(modalType, []); // In real implementation, pass existing refs

      const entityData: any = {
        ...formData,
        ref,
        referenceNumber: ref,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        serverTimestamp: serverTimestamp()
      };

      // Add specific fields based on type
      if (modalType === 'goal') {
        entityData.goalTitle = formData.title;
        entityData.themeId = formData.theme;
      } else if (modalType === 'story') {
        entityData.storyTitle = formData.title;
      } else if (modalType === 'task') {
        entityData.taskTitle = formData.title;
      } else if (modalType === 'sprint') {
        entityData.sprintName = formData.title;
        entityData.startDate = Date.now();
        entityData.endDate = Date.now() + (14 * 24 * 60 * 60 * 1000); // 2 weeks
      }

      // Create in Firestore
      const docRef = await addDoc(collection(db, `${modalType}s`), entityData);

      // Log activity
      await ActivityStreamService.logCreation(
        docRef.id,
        modalType as any,
        currentUser.uid,
        currentUser.email,
        currentPersona,
        ref,
        formData.title
      );

      console.log(`✨ Quick ${modalType} created:`, ref, formData.title);
      
      if (onAction) {
        onAction('created', { type: modalType, id: docRef.id, ...entityData });
      }

      setShowModal(false);
      setFormData({ title: '', description: '', theme: 1, priority: 'P2', status: 'new' });
      
    } catch (error) {
      console.error(`Error creating ${modalType}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const themes = [
    { id: 1, name: 'Health', color: '#ef4444' },
    { id: 2, name: 'Growth', color: '#8b5cf6' },
    { id: 3, name: 'Wealth', color: '#059669' },
    { id: 4, name: 'Tribe', color: '#f59e0b' },
    { id: 5, name: 'Home', color: '#3b82f6' }
  ];

  return (
    <>
      <Card className="mb-3 shadow-sm">
        <Card.Header className="d-flex align-items-center">
          <Zap size={16} className="me-2" style={{ color: '#f59e0b' }} />
          <strong>Quick Actions</strong>
        </Card.Header>
        <Card.Body className="p-2">
          <div className="row g-2">
            {quickActions.map((action) => {
              const IconComponent = action.icon;
              return (
                <div key={action.type} className="col-6">
                  <Button
                    variant="outline-light"
                    size="sm"
                    className="w-100 d-flex flex-column align-items-center p-2"
                    style={{
                      borderColor: action.color,
                      color: action.color,
                      minHeight: '60px'
                    }}
                    onClick={() => handleQuickAction(action.type as any)}
                    onMouseOver={(e) => {
                      e.currentTarget.style.backgroundColor = action.color;
                      e.currentTarget.style.color = 'white';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = action.color;
                    }}
                  >
                    <IconComponent size={18} className="mb-1" />
                    <small className="text-center">{action.label}</small>
                  </Button>
                </div>
              );
            })}
          </div>
        </Card.Body>
      </Card>

      {/* Quick Create Modal */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            Quick {modalType.charAt(0).toUpperCase() + modalType.slice(1)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                type="text"
                placeholder={`Enter ${modalType} title...`}
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                placeholder={`Brief description of this ${modalType}...`}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </Form.Group>

            {modalType === 'goal' && (
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  value={formData.theme}
                  onChange={(e) => setFormData({ ...formData, theme: parseInt(e.target.value) })}
                >
                  {themes.map(theme => (
                    <option key={theme.id} value={theme.id}>
                      {theme.name}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            {(modalType === 'story' || modalType === 'task') && (
              <Form.Group className="mb-3">
                <Form.Label>Priority</Form.Label>
                <Form.Select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                >
                  <option value="P1">P1 - Critical</option>
                  <option value="P2">P2 - High</option>
                  <option value="P3">P3 - Medium</option>
                  <option value="P4">P4 - Low</option>
                </Form.Select>
              </Form.Group>
            )}
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setShowModal(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleSubmit}
            disabled={loading || !formData.title.trim()}
          >
            {loading ? 'Creating...' : `Create ${modalType.charAt(0).toUpperCase() + modalType.slice(1)}`}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default QuickActionsPanel;
