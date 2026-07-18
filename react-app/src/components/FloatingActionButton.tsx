import React, { useState, useEffect } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, addDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore';
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
import IntentBrokerModal from './IntentBrokerModal';
import { useProcessTextActivity } from '../contexts/ProcessTextActivityContext';
import { saveFocusWizardPrefill } from '../services/focusGoalsService';
import { pickDefaultPlanningSprintId } from '../utils/sprintFilter';
import { withTimeout } from '../utils/withTimeout';
import { evaluateStorySprintAlignment } from '../utils/sprintAlignment';

const CREATE_TIMEOUT_MS = 15000;

interface FloatingActionButtonProps {
  onImportClick: () => void;
}

interface Goal {
  id: string;
  title: string;
  theme: string;
  // Needed by evaluateStorySprintAlignment/isGoalInHierarchySet to walk ancestor/descendant
  // chains when checking whether the linked goal maps to one of the sprint's focus goals.
  parentGoalId?: string | null;
}

interface StoryOption {
  id: string;
  title: string;
  goalId: string;
}

const FloatingActionButton: React.FC<FloatingActionButtonProps> = ({ onImportClick }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  // sprints context: only use if sprint selector is rendered; don't gate submit on sprint loading
  const { sprints: _availableSprints } = useSprint();
  const { openComposer } = useProcessTextActivity();
  const [showMenu, setShowMenu] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  const [showBulkCreate, setShowBulkCreate] = useState(false);
  const [quickAddType, setQuickAddType] = useState<'goal' | 'story' | 'task'>('task');
  const getTomorrowStr = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  };

  const [quickAddData, setQuickAddData] = useState({
    title: '',
    description: '',
    url: '',
    theme: 'General',
    effort: 'M',
    priority: 'med',
    persona: (currentPersona || 'personal') as 'personal' | 'work',
    goalId: '',
    storyId: '',
    sprintId: '',
    dueDate: getTomorrowStr(),
  });
  // Free-text search boxes for the "searchable by title" Goal/Story pickers
  // (Story's Linked Goal, Task's Parent Story). Mirrors the pattern in
  // EditTaskModal: typed text resolves to a real id on blur via exact title match.
  const [goalInput, setGoalInput] = useState('');
  const [storyInput, setStoryInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<string | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<StoryOption[]>([]);
  const [showIntake, setShowIntake] = useState(false);
  const [showIntentBroker, setShowIntentBroker] = useState(false);
  const [showFocusIntake, setShowFocusIntake] = useState(false);
  const [focusVision, setFocusVision] = useState('');
  const [focusTimeframe, setFocusTimeframe] = useState<'sprint' | 'quarter' | 'year'>('quarter');
  const [intakeTitle, setIntakeTitle] = useState('');
  const [intakeTheme, setIntakeTheme] = useState('Growth');
  const [chatGoalId, setChatGoalId] = useState<string | null>(null);
  const [showChat, setShowChat] = useState(false);
  const [activeFocusGoalIds, setActiveFocusGoalIds] = useState<Set<string>>(new Set());

  const themes = GLOBAL_THEMES.map(theme => theme.name);
  const efforts = [
    { value: 'S', label: '30 mins (0.5)', minutes: 30, points: 0.5 },
    { value: 'M', label: '60 mins (1)', minutes: 60, points: 1 },
    { value: 'L', label: '120 mins (2)', minutes: 120, points: 2 }
  ];
  const defaultFabSprintId = pickDefaultPlanningSprintId(_availableSprints as any);

  // Warn (or block, if the sprint is in strict mode) when a Story's linked goal isn't one of
  // the selected sprint's focus goals — same check EditStoryModal/AddStoryModal/EditTaskModal
  // already run before save.
  const selectedFabSprint = quickAddData.sprintId
    ? (_availableSprints as any[])?.find((s: any) => s.id === quickAddData.sprintId)
    : null;
  const sprintAlignment = evaluateStorySprintAlignment(selectedFabSprint as any, quickAddData.goalId || '', goals as any);

  // Auto-select the sprint whose window contains the chosen due date.
  // Falls back to the closest future sprint, then the planning default.
  const sprintForDueDate = (dueDateStr: string): string => {
    if (!dueDateStr || !_availableSprints?.length) return defaultFabSprintId;
    const dueDateMs = new Date(dueDateStr + 'T00:00:00').getTime();
    const sprints = _availableSprints as any[];
    // 1. Exact containment
    const exact = sprints.find(
      (s) => s.startDate <= dueDateMs && s.endDate >= dueDateMs
    );
    if (exact) return exact.id;
    // 2. Closest sprint whose startDate is after the due date
    const future = sprints
      .filter((s) => s.startDate > dueDateMs)
      .sort((a, b) => a.startDate - b.startDate);
    if (future.length) return future[0].id;
    // 3. Closest sprint whose endDate is before the due date (most recent past)
    const past = sprints
      .filter((s) => s.endDate < dueDateMs)
      .sort((a, b) => b.endDate - a.endDate);
    if (past.length) return past[0].id;
    return defaultFabSprintId;
  };

  // Sync sprint whenever due date changes
  useEffect(() => {
    if (quickAddType !== 'task') return;
    const resolved = sprintForDueDate(quickAddData.dueDate);
    if (resolved && resolved !== quickAddData.sprintId) {
      setQuickAddData((prev) => ({ ...prev, sprintId: resolved }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickAddData.dueDate, quickAddType, _availableSprints]);

  useEffect(() => {
    const loadActiveFocusGoals = async () => {
      if (!currentUser) {
        setActiveFocusGoalIds(new Set());
        return;
      }
      try {
        const focusQuery = query(
          collection(db, 'focusGoals'),
          where('ownerUid', '==', currentUser.uid),
          where('persona', '==', (currentPersona || 'personal')),
          where('isActive', '==', true),
        );
        const focusSnapshot = await getDocs(focusQuery);
        const ids = new Set<string>();
        focusSnapshot.docs.forEach((docSnap) => {
          const goalIds = (docSnap.data() as any)?.goalIds;
          if (!Array.isArray(goalIds)) return;
          goalIds.forEach((goalId: any) => {
            const id = String(goalId || '').trim();
            if (id) ids.add(id);
          });
        });
        setActiveFocusGoalIds(ids);
      } catch {
        setActiveFocusGoalIds(new Set());
      }
    };
    loadActiveFocusGoals();
  }, [currentUser, currentPersona]);

  // Load goals and stories whenever the quick-add modal is open — the simplified
  // flow needs goals for Story's "Linked Goal" picker and stories for Task's
  // "Parent Story" picker, regardless of which type is currently selected.
  useEffect(() => {
    const loadGoalsAndStories = async () => {
      if (!currentUser || !showQuickAdd) return;

      try {
        console.log('📊 FloatingActionButton: Loading goals and stories for quick add', {
          action: 'load_goals_stories_start',
          user: currentUser.uid,
          persona: currentPersona
        });

        // Do NOT orderBy('priority')/('createdAt') — Firestore omits documents missing
        // that field, which hid priority-less goals from the picker. Sort client-side if needed.
        const goalsQuery = query(
          collection(db, 'goals'),
          where('ownerUid', '==', currentUser.uid)
        );
        const storiesQuery = query(
          collection(db, 'stories'),
          where('ownerUid', '==', currentUser.uid)
        );
        const [goalsSnapshot, storiesSnapshot] = await Promise.all([
          getDocs(goalsQuery),
          getDocs(storiesQuery),
        ]);
        const goalsData = goalsSnapshot.docs.map(doc => ({
          id: doc.id,
          title: doc.data().title,
          theme: doc.data().theme,
          parentGoalId: doc.data().parentGoalId || null,
        }));
        const storiesData = storiesSnapshot.docs.map(doc => ({
          id: doc.id,
          title: doc.data().title,
          goalId: doc.data().goalId || ''
        }));

        setGoals(goalsData);
        setStories(storiesData);

        console.log('✅ FloatingActionButton: Goals and stories loaded successfully', {
          action: 'load_goals_stories_success',
          goalsCount: goalsData.length,
          storiesCount: storiesData.length,
        });

      } catch (error) {
        console.error('❌ FloatingActionButton: Failed to load goals/stories', {
          action: 'load_goals_stories_error',
          error: error.message
        });
      }
    };

    loadGoalsAndStories();
  }, [currentUser, currentPersona, showQuickAdd]);

  // Resolve free-text "search by title" inputs to real ids — matches the pattern in
  // EditTaskModal's resolveGoalSelection/resolveStorySelection: exact title match on
  // blur, clearing the underlying id if the typed text doesn't match anything.
  const resolveGoalSelection = (value: string) => {
    const val = value.trim();
    const match = goals.find((g) => g.title === val);
    setQuickAddData((prev) => ({ ...prev, goalId: match ? match.id : '' }));
    setGoalInput(match ? match.title : val);
  };

  const resolveStorySelection = (value: string) => {
    const val = value.trim();
    const match = stories.find((s) => s.title === val);
    setQuickAddData((prev) => ({ ...prev, storyId: match ? match.id : '' }));
    setStoryInput(match ? match.title : val);
  };

  const handleQuickAdd = async () => {
    if (!currentUser || !quickAddData.title.trim()) return;

    // Per-phase timing to localise the create delay (goal/task). Read the console
    // after one create: whichever phase shows the big jump is the bottleneck.
    // Typically the gap at "after addDoc/write" isolates raw Firestore write latency.
    const _t0 = performance.now();
    const perf = (label: string) =>
      console.log(`⏱️ [FAB perf] ${quickAddType} — ${label}: +${Math.round(performance.now() - _t0)}ms`);
    perf('handler start');

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
        url: quickAddData.url.trim() || null,
        persona: (quickAddData.persona || currentPersona || 'personal') as 'personal' | 'work',
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
        if (activeFocusGoalIds.size > 0) {
          const proceed = window.confirm(
            'You have an active focus period. New goals added now will be deferred until after the focus period ends. Continue?'
          );
          if (!proceed) {
            setIsSubmitting(false);
            return;
          }
        }
        // generateRef is timestamp+random-unique; no need to read the whole goals
        // collection to build a display ref (that read slowed creation noticeably).
        const goalRef = generateRef('goal');
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
        perf('before goals addDoc');

        await withTimeout(addDoc(collection(db, 'goals'), goalData), CREATE_TIMEOUT_MS, 'goals addDoc');
        perf('after goals addDoc (raw write latency)');

        console.log('✅ FloatingActionButton: GOAL saved successfully', {
          action: 'goal_save_success',
          timestamp: new Date().toISOString(),
          ref: goalRef
        });
        setSubmitResult(`✅ Goal created successfully! (${goalRef})`);
      } else if (quickAddType === 'story') {
        if (quickAddData.sprintId && sprintAlignment.hasRule && !sprintAlignment.aligned) {
          if (sprintAlignment.blocking) {
            setSubmitResult(`❌ ${sprintAlignment.message}`);
            setIsSubmitting(false);
            return;
          }
          const proceed = window.confirm(`${sprintAlignment.message} Continue anyway?`);
          if (!proceed) {
            setIsSubmitting(false);
            return;
          }
        }
        const storyRef = generateRef('story');
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
        
        await withTimeout(addDoc(collection(db, 'stories'), storyData), CREATE_TIMEOUT_MS, 'stories addDoc');
        
        console.log('✅ FloatingActionButton: STORY saved successfully', {
          action: 'story_save_success',
          timestamp: new Date().toISOString(),
          ref: storyRef
        });
        setSubmitResult(`✅ Story created successfully! (${storyRef})`);
      } else if (quickAddType === 'task') {
        const taskRef = generateRef('task');
        const effortData = efforts.find(e => e.value === quickAddData.effort);
        const estimateMinutes = effortData?.minutes || 45;
        const effortPoints = effortData?.points ?? 1;
        const estimatedHours = Math.round((estimateMinutes / 60) * 100) / 100;
        // Simplified quick-add always creates a plain task — chore/routine/habit
        // creation (with recurrence) is out of scope for this flow.
        const taskType = 'task';
        const themeValue = quickAddData.theme;
        const linkedStory = quickAddData.storyId ? stories.find(s => s.id === quickAddData.storyId) : null;
        const normalizedTags = normalizeTaskTags({
          tags: [],
          type: taskType,
          persona: currentPersona,
          sprint: (quickAddData.sprintId || defaultFabSprintId)
            ? (_availableSprints as any).find((s: any) => s.id === (quickAddData.sprintId || defaultFabSprintId)) || null
            : null,
          themeValue,
          goalRef: null,
          storyRef: null,
          themes: GLOBAL_THEMES as any,
        });
        const dueDateMs = quickAddData.dueDate
          ? new Date(quickAddData.dueDate + 'T00:00:00').getTime()
          : new Date(new Date().setDate(new Date().getDate() + 1)).setHours(0, 0, 0, 0);
        const taskData = {
          ...baseData,
          ref: taskRef,
          parentType: 'story',
          // Parent Story is optional (matches today's permissiveness) — when the
          // user typed and resolved a story, actually link it via storyId + parentId.
          storyId: quickAddData.storyId || '',
          parentId: quickAddData.storyId || '',
          sprintId: quickAddData.sprintId || defaultFabSprintId || null,
          effort: quickAddData.effort,
          priority: quickAddData.priority,
          dueDate: quickAddData.dueDate || null,
          dueDateMs,
          estimateMin: estimateMinutes,
          estimatedHours,
          points: effortPoints,
          status: 0,
          theme: themeValue,
          type: taskType,
          repeatFrequency: null,
          repeatInterval: null,
          daysOfWeek: [],
          tags: normalizedTags,
          hasGoal: !!linkedStory?.goalId,
          alignedToGoal: !!linkedStory?.goalId,
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
        perf('before emergencyCreateTask');

        // Use emergency task creation with fallback system
        const result = await emergencyCreateTask(taskData, currentUser.uid, {
          maxRetries: 3,
          retryDelay: 1000,
          fallbackMethod: true
        });
        perf(`after emergencyCreateTask (method=${result?.method || '?'}, retries burn 1s each)`);

        if (result.success) {
          console.log('✅ FloatingActionButton: TASK saved successfully', {
            action: 'task_save_success',
            timestamp: new Date().toISOString(),
            ref: taskRef,
            method: result.method,
            taskId: result.id
          });
          
          if (result.warning) {
            setSubmitResult(`⚠️ Task created with warning! (${taskRef}) ${result.warning}`);
          } else {
            setSubmitResult(`✅ Task created successfully! (${taskRef})`);
          }
        } else {
          throw new Error(result.error || 'Emergency task creation failed');
        }
      }

      setQuickAddData({
        title: '',
        description: '',
        url: '',
        theme: 'Growth',
        effort: 'M',
        priority: 'med',
        persona: (currentPersona || 'personal') as 'personal' | 'work',
        goalId: '',
        storyId: '',
        sprintId: '',
        dueDate: getTomorrowStr(),
      });
      setGoalInput('');
      setStoryInput('');

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
    } finally {
      setIsSubmitting(false);
    }
  };

  // Shared opener for the simplified Goal/Story/Task quick-add modal. All three
  // mini-buttons (G/S/T) funnel through here, defaulting to the type clicked but
  // letting the user switch type inside the modal via the segmented control.
  const openQuickAdd = (type: 'goal' | 'story' | 'task') => {
    setQuickAddType(type);
    setQuickAddData((prev) => ({
      ...prev,
      persona: (currentPersona || 'personal') as 'personal' | 'work',
      dueDate: getTomorrowStr(),
    }));
    setGoalInput('');
    setStoryInput('');
    setSubmitResult(null);
    setShowQuickAdd(true);
    setShowMenu(false);
  };

  return (
    <>
      {/* FAB Menu Items */}
      {showMenu && (
        <div className="md-fab-menu">
          <button
            className="md-fab-mini"
            onClick={() => {
              setShowFocusIntake(true);
              setShowMenu(false);
            }}
            title="Focus Intake"
          >
            F
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              setShowIntentBroker(true);
              setShowMenu(false);
            }}
            title="Intent Broker"
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
            onClick={() => openQuickAdd('goal')}
            title="Add Goal"
          >
            G
          </button>
          <button
            className="md-fab-mini"
            onClick={() => openQuickAdd('story')}
            title="Add Story"
          >
            S
          </button>
          <button
            className="md-fab-mini"
            onClick={() => {
              openComposer('', 'web_fab');
              setShowMenu(false);
            }}
            title="Process Text"
          >
            P
          </button>
          <button
            className="md-fab-mini"
            onClick={() => openQuickAdd('task')}
            title="Quick Task"
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

      {/* Focus Intake Modal */}
      <Modal show={showFocusIntake} onHide={() => setShowFocusIntake(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Focus Intake</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>What do you want to focus on?</Form.Label>
            <Form.Control
              as="textarea"
              rows={4}
              value={focusVision}
              onChange={(e) => setFocusVision(e.target.value)}
              placeholder="Describe the outcome you want over the next focus period..."
              autoFocus
            />
          </Form.Group>
          <Form.Group>
            <Form.Label>Focus period</Form.Label>
            <Form.Select
              value={focusTimeframe}
              onChange={(e) => setFocusTimeframe(e.target.value as 'sprint' | 'quarter' | 'year')}
            >
              <option value="sprint">Sprint (2 weeks)</option>
              <option value="quarter">Quarter (13 weeks)</option>
              <option value="year">Year (52 weeks)</option>
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowFocusIntake(false)}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!focusVision.trim()}
            onClick={() => {
              const querySeed = focusVision.trim().split(/\s+/).slice(0, 6).join(' ');
              saveFocusWizardPrefill({
                source: 'fab',
                visionText: focusVision.trim(),
                timeframe: focusTimeframe,
                searchTerm: querySeed,
                autoRunMatch: true,
              });
              setShowFocusIntake(false);
              navigate('/focus-goals');
            }}
          >
            Open Focus Wizard
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Quick Add Modal: simplified Goal/Story/Task creation. One modal, one segmented
          type switch, minimal fields per Jim's spec — everything else the underlying
          write logic needs is defaulted automatically (see handleQuickAdd). */}
      <Modal show={showQuickAdd} onHide={() => setShowQuickAdd(false)} centered scrollable dialogClassName="fab-quick-add-modal">
        <Modal.Header closeButton>
          <Modal.Title>Quick Add</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="btn-group mb-3" role="group" aria-label="Item type">
            {(['goal', 'story', 'task'] as const).map((t) => (
              <Button
                key={t}
                type="button"
                size="sm"
                variant={quickAddType === t ? 'primary' : 'outline-secondary'}
                onClick={() => setQuickAddType(t)}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>

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

            {quickAddType === 'goal' && (
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
                  <Form.Label>Linked Goal *</Form.Label>
                  <Form.Control
                    list="fab-goal-options"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    onBlur={(e) => resolveGoalSelection(e.target.value)}
                    placeholder="Search goals by title..."
                  />
                  <datalist id="fab-goal-options">
                    {goals.map(g => (
                      <option key={g.id} value={g.title} />
                    ))}
                  </datalist>
                  {goalInput.trim() && !quickAddData.goalId ? (
                    <Form.Text className="text-warning">
                      No goal matches "{goalInput.trim()}" — pick one from the list.
                    </Form.Text>
                  ) : (
                    <Form.Text className="text-muted">
                      Stories must link to a goal.
                    </Form.Text>
                  )}
                </Form.Group>

                {(_availableSprints as any[])?.length > 0 && (
                  <Form.Group className="mb-3">
                    <Form.Label>Sprint</Form.Label>
                    <Form.Select
                      value={quickAddData.sprintId}
                      onChange={(e) => setQuickAddData({ ...quickAddData, sprintId: e.target.value })}
                    >
                      <option value="">No sprint (backlog)</option>
                      {(_availableSprints as any[]).map((s: any) => {
                        const start = s.startDate ? new Date(s.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
                        const end = s.endDate ? new Date(s.endDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
                        const label = s.name || s.title || `Sprint ${s.index ?? ''}`;
                        return (
                          <option key={s.id} value={s.id}>
                            {label}{start && end ? ` · ${start} – ${end}` : ''}
                          </option>
                        );
                      })}
                    </Form.Select>
                  </Form.Group>
                )}

                {quickAddData.sprintId && sprintAlignment.hasRule && !sprintAlignment.aligned && (
                  <Alert variant={sprintAlignment.blocking ? 'danger' : 'warning'} className="mb-3">
                    {sprintAlignment.message}
                  </Alert>
                )}
              </>
            )}

            {quickAddType === 'task' && (
              <>
                <Form.Group className="mb-3">
                  <Form.Label>Due Date</Form.Label>
                  <Form.Control
                    type="date"
                    value={quickAddData.dueDate}
                    onChange={(e) => setQuickAddData({ ...quickAddData, dueDate: e.target.value })}
                  />
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Parent Story</Form.Label>
                  <Form.Control
                    list="fab-story-options"
                    value={storyInput}
                    onChange={(e) => setStoryInput(e.target.value)}
                    onBlur={(e) => resolveStorySelection(e.target.value)}
                    placeholder="Search stories by title (optional)..."
                  />
                  <datalist id="fab-story-options">
                    {stories.map(s => (
                      <option key={s.id} value={s.title} />
                    ))}
                  </datalist>
                  {storyInput.trim() && !quickAddData.storyId && (
                    <Form.Text className="text-warning">
                      No story matches "{storyInput.trim()}" — pick one from the list or leave blank.
                    </Form.Text>
                  )}
                </Form.Group>
              </>
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
            disabled={
              isSubmitting
              || !quickAddData.title.trim()
              || (quickAddType === 'story' && !quickAddData.goalId)
            }
          >
            {isSubmitting ? 'Creating...' : `Create ${quickAddType.charAt(0).toUpperCase() + quickAddType.slice(1)}`}
          </Button>
        </Modal.Footer>
      </Modal>

      <BulkCreateModal
        show={showBulkCreate}
        onHide={() => setShowBulkCreate(false)}
      />

      <IntentBrokerModal
        show={showIntentBroker}
        onHide={() => setShowIntentBroker(false)}
        ownerUid={currentUser?.uid}
        persona={currentPersona}
      />

      {/* Inline Chat Modal for Intake */}
      {chatGoalId && (
        <GoalChatModal goalId={chatGoalId} show={showChat} onHide={() => setShowChat(false)} />
      )}
    </>
  );
};

export default FloatingActionButton;
