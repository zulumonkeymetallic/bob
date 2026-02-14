import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, orderBy, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { generateRef } from '../utils/referenceGenerator';
import { emergencyCreateTask } from '../utils/emergencyTaskCreation';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { normalizeTaskTags } from '../utils/taskTagging';
import '../styles/MaterialDesign.css';
import BulkCreateModal from './BulkCreateModal';
import GoalChatModal from './GoalChatModal';
import AddStoryModal from './AddStoryModal';

interface FloatingActionButtonProps {
  onImportClick: () => void;
}

interface Goal {
  id: string;
  title: string;
  theme: string;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onImportClick }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
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
    sprintId: '',
    type: 'task',
    repeatFrequency: '',
    repeatInterval: 1,
    daysOfWeek: [] as string[]
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showIntake, setShowIntake] = useState(false);
  const [intakeTitle, setIntakeTitle] = useState('');
  const [intakeTheme, setIntakeTheme] = useState('Growth');
  const [chatGoalId, setChatGoalId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);

  const themes = GLOBAL_THEMES.map(theme => theme.name);
  const efforts = [
    { value: 'S', label: 'Small (15-30 min)', minutes: 20 },
    { value: 'M', label: 'Medium (30-60 min)', minutes: 45 },
    { value: 'L', label: 'Large (1-2 hours)', minutes: 90 }
  ];
  const isRecurringQuickAdd = quickAddType === 'task' && ['chore', 'routine', 'habit'].includes(String(quickAddData.type || '').toLowerCase());

  // Load goals and sprints when component mounts or when quickAddType changes to 'story'
  useEffect(() => {
    const loadGoals = async () => {
      if (!currentUser || quickAddType !== 'story') return;

      try {
        console.log('📊 FloatingActionButton: Loading goals for story creation', {
          action: 'load_goals_start',
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

        setGoals(goalsData);

        console.log('✅ FloatingActionButton: Goals loaded successfully', {
          action: 'load_goals_success',
          goalsCount: goalsData.length,
        });

      } catch (error) {
        console.error('❌ FloatingActionButton: Failed to load goals', {
          action: 'load_goals_error',
          error: error.message
        });
      }
    };

    loadGoals();
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
        const estimateMinutes = effortData?.minutes || 45;
        const estimatedHours = Math.round((estimateMinutes / 60) * 100) / 100;
        const taskType = (quickAddData.type || 'task') as string;
        const isRecurring = ['chore', 'routine', 'habit'].includes(taskType);
        const normalizedFrequency = isRecurring ? (quickAddData.repeatFrequency || null) : null;
        const normalizedInterval = isRecurring ? Math.max(1, Number(quickAddData.repeatInterval || 1)) : null;
        const normalizedDays = isRecurring && quickAddData.repeatFrequency === 'weekly'
          ? (Array.isArray(quickAddData.daysOfWeek) ? quickAddData.daysOfWeek : [])
          : [];
        const themeValue = taskType === 'chore' ? 'Chores' : quickAddData.theme;
        const normalizedTags = normalizeTaskTags({
          tags: [],
          type: taskType,
          persona: currentPersona,
          sprint: null,
          themeValue,
          goalRef: null,
          storyRef: null,
          themes: GLOBAL_THEMES as any,
        });
        const taskData = {
          ...baseData,
          ref: taskRef,
          parentType: 'story',
          parentId: '', // Will need to be linked later
          effort: quickAddData.effort,
          priority: quickAddData.priority,
          estimateMin: estimateMinutes,
          estimatedHours,
          status: 0,
          theme: themeValue,
          type: taskType,
          repeatFrequency: normalizedFrequency,
          repeatInterval: normalizedInterval,
          daysOfWeek: normalizedDays,
          tags: normalizedTags,
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

      setQuickAddData({
        title: '',
        description: '',
        theme: 'Growth',
        effort: 'M',
        priority: 'med',
        goalId: '',
        sprintId: '',
        type: 'task',
        repeatFrequency: '',
        repeatInterval: 1,
        daysOfWeek: [],
      });
      
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
            onClick={() => {
              setShowIntake(true);
              setShowMenu(false);
            }}
            title="AI Goal Intake (Chat)"
          >
            A
          </button>
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

      {/* AI Intake Modal */}
      <Modal show={showIntake} onHide={() => setShowIntake(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>AI Goal Intake</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Goal Title</Form.Label>
              <Form.Control
                type="text"
                value={intakeTitle}
                onChange={(e) => setIntakeTitle(e.target.value)}
                placeholder="e.g., Make £10k off-grid; terrarium business"
                autoFocus
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={intakeTheme} onChange={(e) => setIntakeTheme(e.target.value)}>
                {themes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowIntake(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!intakeTitle.trim() || !currentUser}
            onClick={async () => {
              if (!currentUser) return;
              try {
                const ref = await addDoc(collection(db, 'goals'), {
                  ownerUid: currentUser.uid,
                  persona: currentPersona,
                  title: intakeTitle.trim(),
                  description: 'Created via AI Goal Intake',
                  theme: intakeTheme,
                  status: 'new',
                  priority: 2,
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
                setChatGoalId(ref.id);
                setShowIntake(false);
                setShowChat(true);
              } catch (e: any) {
                alert(e?.message || 'Failed to create goal');
              }
            }}
          >
            Continue to Chat
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Quick Add Modal: if adding a Story, reuse the shared AddStoryModal for consistency */}
      {quickAddType === 'story' ? (
        <AddStoryModal show={showQuickAdd} onClose={() => setShowQuickAdd(false)} goalId={quickAddData.goalId || undefined} />
      ) : (
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

            {/* Story-specific fields are handled by AddStoryModal; this quick-add modal is for goal/task only */}

            {quickAddType === 'task' && (
              <Form.Group className="mb-3">
                <Form.Label>Task type</Form.Label>
                <Form.Select
                  value={quickAddData.type}
                  onChange={(e) => {
                    const nextType = e.target.value;
                    setQuickAddData({
                      ...quickAddData,
                      type: nextType,
                      theme: nextType === 'chore' ? 'Chores' : quickAddData.theme,
                    });
                  }}
                >
                  <option value="task">Task</option>
                  <option value="chore">Chore</option>
                  <option value="routine">Routine</option>
                  <option value="habit">Habit</option>
                </Form.Select>
              </Form.Group>
            )}

            {quickAddType === 'task' && isRecurringQuickAdd && (
              <div className="mb-3">
                <div className="row">
                  <div className="col-md-4 mb-2">
                    <Form.Label>Frequency</Form.Label>
                    <Form.Select
                      value={quickAddData.repeatFrequency || ''}
                      onChange={(e) => setQuickAddData({ ...quickAddData, repeatFrequency: e.target.value })}
                    >
                      <option value="">None</option>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </Form.Select>
                  </div>
                  <div className="col-md-4 mb-2">
                    <Form.Label>Interval</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      max={365}
                      value={quickAddData.repeatInterval || 1}
                      onChange={(e) => setQuickAddData({ ...quickAddData, repeatInterval: Number(e.target.value) || 1 })}
                    />
                  </div>
                </div>
                {quickAddData.repeatFrequency === 'weekly' && (
                  <div className="mt-2">
                    <Form.Label>Days of week</Form.Label>
                    <div className="d-flex flex-wrap gap-3">
                      {[
                        { label: 'Mon', value: 'mon' },
                        { label: 'Tue', value: 'tue' },
                        { label: 'Wed', value: 'wed' },
                        { label: 'Thu', value: 'thu' },
                        { label: 'Fri', value: 'fri' },
                        { label: 'Sat', value: 'sat' },
                        { label: 'Sun', value: 'sun' },
                      ].map((day) => {
                        const days = Array.isArray(quickAddData.daysOfWeek) ? quickAddData.daysOfWeek : [];
                        const checked = days.includes(day.value);
                        return (
                          <label key={day.value} className="form-check form-check-inline">
                            <input
                              type="checkbox"
                              className="form-check-input"
                              checked={checked}
                              onChange={() => {
                                const next = checked
                                  ? days.filter((d: string) => d !== day.value)
                                  : [...days, day.value];
                                setQuickAddData({ ...quickAddData, daysOfWeek: next });
                              }}
                            />
                            <span className="form-check-label">{day.label}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
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

            {quickAddType === 'task' && (
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
      )}

      <BulkCreateModal
        show={showBulkCreate}
        onHide={() => setShowBulkCreate(false)}
      />

      {/* Inline Chat Modal for Intake */}
      {chatGoalId && (
        <GoalChatModal goalId={chatGoalId} show={showChat} onHide={() => setShowChat(false)} />
      )}
    </>
  );
};

export default FloatingActionButton;
