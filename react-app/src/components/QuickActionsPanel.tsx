import React, { useState, useEffect } from 'react';
import { Card, Button, ButtonGroup, Modal, Form } from 'react-bootstrap';
import { Plus, Target, BookOpen, Calendar, CheckSquare, Zap } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { addDoc, collection, serverTimestamp, query, where, onSnapshot, updateDoc, doc, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { generateRef } from '../utils/referenceGenerator';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { Story, Goal, Sprint } from '../types';
import AddGoalModal from './AddGoalModal';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { useTheme } from '../contexts/ModernThemeContext';

interface QuickActionsProps {
  onAction?: (type: string, data: any) => void;
}

const QuickActionsPanel: React.FC<QuickActionsProps> = ({ onAction }) => {
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  // Debug logging for QuickActionsPanel
  console.log('🔍 QuickActionsPanel: currentUser:', !!currentUser);
  console.log('🔍 QuickActionsPanel: currentPersona:', currentPersona);
  
  const [showModal, setShowModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [modalType, setModalType] = useState<'story' | 'task'>('story');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    theme: 1,
    priority: 'P2',
    status: 'new',
    dueDate: '',
    storyId: '',
    goalId: '',
    sprintId: '',
    size: ''
  });
  const [loading, setLoading] = useState(false);
  
  // Data for linking
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);

  // Load data for linking
  useEffect(() => {
    if (!currentUser?.uid) return;

    const loadData = async () => {
      try {
        // Load goals
        const goalsQuery = query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        const goalsSnapshot = await getDocs(goalsQuery);
        const goalsData = goalsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal));
        setGoals(goalsData);

        // Load sprints
        const sprintsQuery = query(
          collection(db, 'sprints'),
          where('ownerUid', '==', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        const sprintsSnapshot = await getDocs(sprintsQuery);
        const sprintsData = sprintsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sprint));
        setSprints(sprintsData);
        
        // Find active sprint
        const active = sprintsData.find(sprint => sprint.status === 1); // 1 = Active
        setActiveSprint(active || null);

        // Load stories
        const storiesQuery = query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid),
          orderBy('createdAt', 'desc')
        );
        const storiesSnapshot = await getDocs(storiesQuery);
        const storiesData = storiesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
        setStories(storiesData);

      } catch (error) {
        console.error('Error loading data for QuickActions:', error);
      }
    };

    loadData();
  }, [currentUser?.uid]);

  // Helper functions
  const getStoryTheme = (storyId: string): number => {
    const story = stories.find(s => s.id === storyId);
    if (story && story.goalId) {
      const goal = goals.find(g => g.id === story.goalId);
      return goal?.theme || 1;
    }
    return 1;
  };

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
    }
  ];

    const handleQuickAction = (type: 'goal' | 'story' | 'task') => {
    console.log('🚀 QuickActionsPanel: Quick action triggered:', type);
    
    if (type === 'goal') {
      // Use enhanced AddGoalModal for goals
      setShowGoalModal(true);
      return;
    }
    
    // For other types, use the existing modal
    setModalType(type as 'story' | 'task');
    const handleCreateGoal = () => {
    setShowGoalModal(true);
    setFormData({
      title: '',
      description: '',
      theme: 1,
      priority: 'P2',
      status: 'backlog',
      dueDate: '',
      storyId: '',
      goalId: '',
      sprintId: '',
      size: ''
    });
  };
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!currentUser || !formData.title.trim()) return;

    setLoading(true);
    try {
      // Generate reference number
      const ref = generateRef(modalType, []); // In real implementation, pass existing refs

      const entityData: any = {
        ref,
        referenceNumber: ref,
        ownerUid: currentUser.uid,
        persona: currentPersona,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        serverTimestamp: serverTimestamp(),
        title: formData.title,
        description: formData.description
      };

      // Add specific fields based on type
      if (modalType === 'story') {
        entityData.storyTitle = formData.title;
        entityData.status = 0; // Backlog
        entityData.priority = parseInt(formData.priority.replace('P', ''));
        entityData.points = formData.size ? parseInt(formData.size) : 1;
        entityData.wipLimit = 1;
        entityData.orderIndex = 0;
        
        // Link to goal and inherit theme
        if (formData.goalId) {
          entityData.goalId = formData.goalId;
          const goal = goals.find(g => g.id === formData.goalId);
          if (goal) {
            entityData.theme = goal.theme;
          }
        }
        
        // Link to sprint
        if (formData.sprintId) {
          entityData.sprintId = formData.sprintId;
        } else if (activeSprint) {
          entityData.sprintId = activeSprint.id;
        }
        
      } else if (modalType === 'task') {
        entityData.taskTitle = formData.title;
        entityData.status = 0; // To Do
        entityData.priority = parseInt(formData.priority.replace('P', ''));
        entityData.effort = formData.size || 'M';
        entityData.estimateMin = 60; // Default estimate
        entityData.alignedToGoal = !!formData.storyId;
        entityData.source = 'web';
        entityData.aiLinkConfidence = 0;
        
        // Link to story and inherit theme + goal
        if (formData.storyId) {
          entityData.parentType = 'story';
          entityData.parentId = formData.storyId;
          
          const story = stories.find(s => s.id === formData.storyId);
          if (story) {
            entityData.theme = story.theme || getStoryTheme(formData.storyId);
          }
        }
        
        // Set due date
        if (formData.dueDate) {
          entityData.dueDate = new Date(formData.dueDate).getTime();
        }
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
      setFormData({ 
        title: '', 
        description: '', 
        theme: 1, 
        priority: 'P2', 
        status: 'new',
        dueDate: '',
        storyId: '',
        goalId: '',
        sprintId: '',
        size: ''
      });
      
    } catch (error) {
      console.error(`Error creating ${modalType}:`, error);
    } finally {
      setLoading(false);
    }
  };

  // Use centralized theme management
  const themes = GLOBAL_THEMES.map(theme => ({
    id: theme.id,
    name: theme.name,
    color: theme.color
  }));

  return (
    <>
      <Card className="mb-3 shadow-sm" data-testid="quick-actions-panel">
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
                    data-testid={`create-${action.type}-button`}
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

            {(modalType === 'story' || modalType === 'task') && (
              <>
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

                {modalType === 'task' && (
                  <>
                    <Form.Group className="mb-3">
                      <Form.Label>Due Date</Form.Label>
                      <Form.Control
                        type="date"
                        value={formData.dueDate}
                        onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                      />
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>Link to Story</Form.Label>
                      <Form.Select
                        value={formData.storyId}
                        onChange={(e) => setFormData({ ...formData, storyId: e.target.value })}
                      >
                        <option value="">Select a story (optional)</option>
                        {stories.map(story => (
                          <option key={story.id} value={story.id}>
                            {story.ref} - {story.title}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>Size</Form.Label>
                      <Form.Select
                        value={formData.size}
                        onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                      >
                        <option value="S">S - Small</option>
                        <option value="M">M - Medium</option>
                        <option value="L">L - Large</option>
                      </Form.Select>
                    </Form.Group>
                  </>
                )}

                {modalType === 'story' && (
                  <>
                    <Form.Group className="mb-3">
                      <Form.Label>Link to Goal</Form.Label>
                      <Form.Select
                        value={formData.goalId}
                        onChange={(e) => setFormData({ ...formData, goalId: e.target.value })}
                      >
                        <option value="">Select a goal (optional)</option>
                        {goals.map(goal => (
                          <option key={goal.id} value={goal.id}>
                            {goal.title}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>Sprint</Form.Label>
                      <Form.Select
                        value={formData.sprintId}
                        onChange={(e) => setFormData({ ...formData, sprintId: e.target.value })}
                      >
                        <option value="">Select sprint (defaults to active)</option>
                        {sprints.map(sprint => (
                          <option key={sprint.id} value={sprint.id}>
                            {sprint.ref} - {sprint.name} {sprint.status === 1 ? '(Active)' : ''}
                          </option>
                        ))}
                      </Form.Select>
                    </Form.Group>

                    <Form.Group className="mb-3">
                      <Form.Label>Story Points</Form.Label>
                      <Form.Select
                        value={formData.size}
                        onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                      >
                        <option value="1">1 - Small</option>
                        <option value="2">2 - Medium</option>
                        <option value="3">3 - Large</option>
                        <option value="5">5 - Extra Large</option>
                        <option value="8">8 - Epic</option>
                      </Form.Select>
                    </Form.Group>
                  </>
                )}
              </>
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

      {/* Enhanced Goal Creation Modal */}
      <AddGoalModal
        show={showGoalModal}
        onClose={() => setShowGoalModal(false)}
      />
    </>
  );
};

export default QuickActionsPanel;
