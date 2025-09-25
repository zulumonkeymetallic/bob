import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { generateRef } from '../utils/referenceGenerator';
import { emergencyCreateTask } from '../utils/emergencyTaskCreation';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import '../styles/MaterialDesign.css';
import BulkCreateModal from './BulkCreateModal';

interface FloatingActionButtonProps {
  onImportClick: () => void;
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

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onImportClick }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [showMenu, setShowMenu] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'goal' | 'story' | 'task'>('task');
  const [quickAddData, setQuickAddData] = useState({
    title: '',
    description: '',
    theme: 'General',
    effort: 'M',
    priority: 'med',
    goalId: '',
    sprintId: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);

  const themes = GLOBAL_THEMES.map(theme => theme.name);
  const efforts = [
    { value: 'S', label: 'Small (15-30 min)', minutes: 20 },
    { value: 'M', label: 'Medium (30-60 min)', minutes: 45 },
    { value: 'L', label: 'Large (1-2 hours)', minutes: 90 }
  ];

  // Load goals and sprints when component mounts or when quickAddType changes to 'story'
  useEffect(() => {
    const loadGoalsAndSprints = async () => {
      if (!currentUser || quickAddType !== 'story') return;

      try {
        console.log('📊 FloatingActionButton: Loading goals and sprints for story creation', {
          action: 'load_goals_sprints_start',
          user: currentUser.uid,
          persona: currentPersona
        });

        // Load goals
        const goalsQuery = query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid),
          orderBy('priority', 'desc')
        );
        const goalsSnapshot = await getDocs(goalsQuery);
        const goalsData = goalsSnapshot.docs.map(doc => ({
          id: doc.id,
          title: doc.data().title,
          theme: doc.data().theme
        }));

        // Load sprints
        const sprintsQuery = query(
          collection(db, 'sprints'),
          where('ownerUid', '==', currentUser.uid),
          orderBy('startDate', 'desc')
        );
        const sprintsSnapshot = await getDocs(sprintsQuery);
        const sprintsData = sprintsSnapshot.docs.map(doc => ({
          id: doc.id,
          name: doc.data().name,
          status: doc.data().status
        }));

        setGoals(goalsData);
        setSprints(sprintsData);

        console.log('✅ FloatingActionButton: Goals and sprints loaded successfully', {
          action: 'load_goals_sprints_success',
          goalsCount: goalsData.length,
          sprintsCount: sprintsData.length
        });

      } catch (error) {
        console.error('❌ FloatingActionButton: Failed to load goals and sprints', {
          action: 'load_goals_sprints_error',
          error: error.message
        });
      }
    };

    loadGoalsAndSprints();
  }, [currentUser, currentPersona, quickAddType]);

  const handleQuickAdd = async () => {
    if (!currentUser || !quickAddData.title.trim()) return;

    console.log('🚀 FloatingActionButton: QUICK ADD button clicked', {
      action: 'quick_add_button_clicked',
      itemType: quickAddType,
      formData: quickAddData,
      user: currentUser.uid,
      persona: currentPersona,
      timestamp: new Date().toISOString()
    });

    setIsSubmitting(true);
    setSubmitResult(null);

    try {
      const baseData = {
        title: quickAddData.title.trim(),
        description: quickAddData.description.trim(),
        persona: currentPersona,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };

      console.log('📝 FloatingActionButton: Prepared base data', {
        action: 'base_data_prepared',
        itemType: quickAddType,
        baseData: baseData
      });

      if (quickAddType === 'goal') {
        // Get existing goal references for unique ref generation
        const existingGoalsQuery = query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid)
        );
        const existingSnapshot = await getDocs(existingGoalsQuery);
        const existingRefs = existingSnapshot.docs
          .map(doc => doc.data().ref)
          .filter(ref => ref);
        
        const goalRef = generateRef('goal', existingRefs);
        const goalData = {
          ...baseData,
          ref: goalRef,
          theme: quickAddData.theme,
          size: 'M',
          timeToMasterHours: 40,
          confidence: 0.5,
          status: 'active',
          kpis: []
        };
        
        console.log('💾 FloatingActionButton: Saving GOAL to database', {
          action: 'goal_save_start',
          data: goalData,
          ref: goalRef
        });
        
        await addDoc(collection(db, 'goals'), goalData);
        
        console.log('✅ FloatingActionButton: GOAL saved successfully', {
          action: 'goal_save_success',
          timestamp: new Date().toISOString(),
          ref: goalRef
        });
      } else if (quickAddType === 'story') {
        // Get existing story references for unique ref generation
        const existingStoriesQuery = query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid)
        );
        const existingSnapshot = await getDocs(existingStoriesQuery);
        const existingRefs = existingSnapshot.docs
          .map(doc => doc.data().ref)
          .filter(ref => ref);
        
        const storyRef = generateRef('story', existingRefs);
        const linkedGoal = goals.find(g => g.id === quickAddData.goalId);
        const themeId = (linkedGoal && (linkedGoal as any).theme !== undefined) ? (linkedGoal as any).theme : 1;
        const storyData = {
          ...baseData,
          ref: storyRef,
          goalId: quickAddData.goalId || '',
          sprintId: quickAddData.sprintId || '',
          priority: quickAddData.priority,
          points: 3,
          status: 'backlog',
          theme: themeId,
          orderIndex: 0,
          tags: [],
          acceptanceCriteria: []
        };
        
        console.log('💾 FloatingActionButton: Saving STORY to database', {
          action: 'story_save_start',
          data: storyData,
          ref: storyRef
        });
        
        await addDoc(collection(db, 'stories'), storyData);
        
        console.log('✅ FloatingActionButton: STORY saved successfully', {
          action: 'story_save_success',
          timestamp: new Date().toISOString(),
          ref: storyRef
        });
      } else if (quickAddType === 'task') {
        // Get existing task references for unique ref generation
        const existingTasksQuery = query(
          collection(db, 'tasks'),
          where('ownerUid', '==', currentUser.uid)
        );
        const existingSnapshot = await getDocs(existingTasksQuery);
        const existingRefs = existingSnapshot.docs
          .map(doc => doc.data().ref)
          .filter(ref => ref);
        
        const taskRef = generateRef('task', existingRefs);
        const effortData = efforts.find(e => e.value === quickAddData.effort);
        const taskData = {
          ...baseData,
          ref: taskRef,
          parentType: 'story',
          parentId: '', // Will need to be linked later
          effort: quickAddData.effort,
          priority: quickAddData.priority,
          estimateMin: effortData?.minutes || 45,
          status: 'planned',
          theme: quickAddData.theme,
          hasGoal: false,
          alignedToGoal: false,
          source: 'web',
          syncState: 'clean',
          labels: [],
          checklist: []
        };
        
        console.log('💾 FloatingActionButton: Saving TASK to database', {
          action: 'task_save_start',
          data: taskData,
          ref: taskRef
        });
        
        // Use emergency task creation with fallback system
        const result = await emergencyCreateTask(taskData, currentUser.uid, {
          maxRetries: 3,
          retryDelay: 1000,
          fallbackMethod: true
        });
        
        if (result.success) {
          console.log('✅ FloatingActionButton: TASK saved successfully', {
            action: 'task_save_success',
            timestamp: new Date().toISOString(),
            ref: taskRef,
            method: result.method,
            taskId: result.id
          });
          
          if (result.warning) {
            setSubmitResult(`⚠️ Task created locally: ${result.warning}`);
          } else {
            setSubmitResult(`✅ Task created successfully!`);
          }
        } else {
          throw new Error(result.error || 'Emergency task creation failed');
        }
      } else {
        // For goals and stories, use standard success message after creation
        const itemTypeCapitalized = quickAddType === 'goal' ? 'Goal' : 'Story';
        setSubmitResult(`✅ ${itemTypeCapitalized} created successfully!`);
      }

      setQuickAddData({ title: '', description: '', theme: 'Growth', effort: 'M', priority: 'med', goalId: '', sprintId: '' });
      
      // Auto-close after success
      setTimeout(() => {
        setShowQuickAdd(false);
        setSubmitResult(null);
      }, 2000);

    } catch (error) {
      console.error('❌ FloatingActionButton: QUICK ADD operation failed', {
        action: 'quick_add_error',
        itemType: quickAddType,
        error: error.message,
        formData: quickAddData,
        timestamp: new Date().toISOString()
      });
      setSubmitResult(`❌ Failed to create ${quickAddType}: ${error.message}`);
    }
    setIsSubmitting(false);
  };

  return (
    <>
      {/* FAB Menu Items */}
      {showMenu && (
        <div className="md-fab-menu">
          <button
            className="md-fab-mini"
            onClick={onImportClick}
            title="Import & Templates"
          >
            ↓
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setShowBulkCreate(true);
              setShowMenu(false);
            }}
            title="Bulk Create from Clipboard"
          >
            B
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setQuickAddType('goal');
              setShowQuickAdd(true);
              setShowMenu(false);
            }}
            title="Add Goal"
          >
            G
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setQuickAddType('story');
              setShowQuickAdd(true);
              setShowMenu(false);
            }}
            title="Add Story"
          >
            S
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setQuickAddType('task');
              setShowQuickAdd(true);
              setShowMenu(false);
            }}
            title="Add Task"
          >
            T
          </button>
        </div>
      )}

      {/* Main FAB */}
      <button
        className="md-fab"
        onClick={() => setShowMenu(!showMenu)}
        title="Add new item"
      >
        {showMenu ? '×' : '+'}
      </button>

      {/* Quick Add Modal */}
      <Modal show={showQuickAdd} onHide={() => setShowQuickAdd(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            Add New {quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title *</Form.Label>
              <Form.Control
                type="text"
                value={quickAddData.title}
                onChange={(e) => setQuickAddData({ ...quickAddData, title: e.target.value })}
                placeholder={`Enter ${quickAddType} title...`}
                autoFocus
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control
                as="textarea"
                rows={3}
                value={quickAddData.description}
                onChange={(e) => setQuickAddData({ ...quickAddData, description: e.target.value })}
                placeholder={`Describe this ${quickAddType}...`}
              />
            </Form.Group>

            {(quickAddType === 'goal' || quickAddType === 'task') && (
              <Form.Group className="mb-3">
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  value={quickAddData.theme}
                  onChange={(e) => setQuickAddData({ ...quickAddData, theme: e.target.value })}
                >
                  {themes.map(theme => (
                    <option key={theme} value={theme}>{theme}</option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            {quickAddType === 'story' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Link to Goal</Form.Label>
                  <Form.Select
                    value={quickAddData.goalId}
                    onChange={(e) => {
                      console.log('🎯 FloatingActionButton: Goal selection changed', {
                        action: 'fab_goal_select_change',
                        element: 'fab_goal_dropdown',
                        quickAddType: quickAddType,
                        previousValue: quickAddData.goalId,
                        newValue: e.target.value,
                        selectedGoal: goals.find(g => g.id === e.target.value),
                        availableGoals: goals.length,
                        timestamp: new Date().toISOString()
                      });
                      setQuickAddData({ ...quickAddData, goalId: e.target.value });
                    }}
                    onClick={() => {
                      console.log('🖱️ FloatingActionButton: Goal dropdown clicked', {
                        action: 'fab_goal_dropdown_click',
                        element: 'fab_goal_select',
                        currentValue: quickAddData.goalId,
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
                    value={quickAddData.sprintId}
                    onChange={(e) => {
                      console.log('🏃‍♂️ FloatingActionButton: Sprint selection changed', {
                        action: 'fab_sprint_select_change',
                        element: 'fab_sprint_dropdown',
                        quickAddType: quickAddType,
                        previousValue: quickAddData.sprintId,
                        newValue: e.target.value,
                        selectedSprint: sprints.find(s => s.id === e.target.value),
                        availableSprints: sprints.length,
                        timestamp: new Date().toISOString()
                      });
                      setQuickAddData({ ...quickAddData, sprintId: e.target.value });
                    }}
                    onClick={() => {
                      console.log('🖱️ FloatingActionButton: Sprint dropdown clicked', {
                        action: 'fab_sprint_dropdown_click',
                        element: 'fab_sprint_select',
                        currentValue: quickAddData.sprintId,
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
              </>
            )}

            {quickAddType === 'task' && (
              <Form.Group className="mb-3">
                <Form.Label>Effort</Form.Label>
                <Form.Select
                  value={quickAddData.effort}
                  onChange={(e) => setQuickAddData({ ...quickAddData, effort: e.target.value })}
                >
                  {efforts.map(effort => (
                    <option key={effort.value} value={effort.value}>
                      {effort.label}
                    </option>
                  ))}
                </Form.Select>
              </Form.Group>
            )}

            {(quickAddType === 'story' || quickAddType === 'task') && (
              <Form.Group className="mb-3">
                <Form.Label>Priority</Form.Label>
                <Form.Select
                  value={quickAddData.priority}
                  onChange={(e) => setQuickAddData({ ...quickAddData, priority: e.target.value })}
                >
                  <option value="low">Low</option>
                  <option value="med">Medium</option>
                  <option value="high">High</option>
                </Form.Select>
              </Form.Group>
            )}
          </Form>

          {submitResult && (
            <Alert variant={submitResult.includes('✅') ? 'success' : 'danger'}>
              {submitResult}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowQuickAdd(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleQuickAdd}
            disabled={isSubmitting || !quickAddData.title.trim()}
          >
            {isSubmitting ? 'Creating...' : `Create ${quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)}`}
          </Button>
        </Modal.Footer>
      </Modal>

      <BulkCreateModal
        show={showBulkCreate}
        onHide={() => setShowBulkCreate(false)}
      />
    </>
  );
};

export default FloatingActionButton;

export {};
