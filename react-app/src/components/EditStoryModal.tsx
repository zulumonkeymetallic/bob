import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Modal, Button, Form, Row, Col, Alert } from 'react-bootstrap';
import { updateDoc, doc, serverTimestamp, collection, query, where, getDocs, addDoc, deleteDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { Story, Goal, Sprint, Task } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { isStatus } from '../utils/statusHelpers';
import { normalizePriorityValue } from '../utils/priorityUtils';
import { parsePointsValue, TASK_DEFAULT_POINTS } from '../utils/points';
import TagInput from './common/TagInput';
import ActivityStreamPanel from './common/ActivityStreamPanel';
import ModernTaskTable from './ModernTaskTable';
import { cascadeStoryPersona } from '../utils/personaCascade';
import { useNavigate } from 'react-router-dom';
import { Activity, CalendarPlus, Clock3, Shuffle, Trash2, Wand2 } from 'lucide-react';
import { planningSprints } from '../utils/sprintFilter';
import { evaluateStorySprintAlignment } from '../utils/sprintAlignment';
import { getGoalDisplayPath, getLeafGoalOptions, resolveLeafGoalSelection } from '../utils/goalHierarchy';
import NewCalendarEventModal, { buildCalendarComposerInitialValues } from './planner/NewCalendarEventModal';
import DeferItemModal from './DeferItemModal';
import { findItemWithManualPriorityRank, getManualPriorityLabel, getManualPriorityRank, getNextManualPriorityRank } from '../utils/manualPriority';
import {
  buildStoryProgressUpdate,
  computePointsRemaining,
  deriveProgressPctFromPointsRemaining,
  formatStoryProgressLabel,
  normalizeProgressPct,
} from '../utils/storyProgress';

interface EditStoryModalProps {
  show: boolean;
  onHide: () => void;
  story: Story | null;
  goals: Goal[];
  onStoryUpdated?: () => void;
  container?: HTMLElement | null;
}

const EditStoryModal: React.FC<EditStoryModalProps> = ({
  show,
  onHide,
  story,
  goals,
  onStoryUpdated,
  container
}) => {
  const navigate = useNavigate();
  const { showSidebar } = useSidebar();
  const { sprints } = useSprint();
  const { currentPersona } = usePersona();
  const [editedStory, setEditedStory] = useState({
    title: '',
    description: '',
    url: '',
    goalId: '',
    priority: 2,
    status: 0,
    theme: 1,
    points: '' as string | number,
    progressPct: 0,
    pointsRemaining: '' as string | number,
    acceptanceCriteria: '',
    sprintId: '' as string | '',
    dueDate: '' as string,
    dueTime: '' as string,
    timeOfDay: '' as 'morning' | 'afternoon' | 'evening' | '',
    blocked: false as boolean,
    tags: [] as string[],
    persona: (currentPersona || 'personal') as 'personal' | 'work',
  });

  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const { currentUser } = useAuth();
  const [linkedTasks, setLinkedTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [isGeneratingTasks, setIsGeneratingTasks] = useState(false);
  const [showCalendarComposer, setShowCalendarComposer] = useState(false);
  const [calendarComposerInitialValues, setCalendarComposerInitialValues] = useState<any>({});
  const [showDeferModal, setShowDeferModal] = useState(false);
  const [flaggingPriority, setFlaggingPriority] = useState(false);
  const isHiddenSprint = (sprint: Sprint) => isStatus(sprint.status, 'closed') || isStatus(sprint.status, 'cancelled');
  const formatSprintLabel = (sprint: Sprint, statusOverride?: string) => {
    const name = sprint.name || sprint.ref || `Sprint ${sprint.id.slice(-4)}`;
    const statusLabel = statusOverride
      ? ` (${statusOverride})`
      : (isStatus(sprint.status, 'active') ? ' (Active)' : '');
    return `${name}${statusLabel}`;
  };
  const visibleSprints = planningSprints(sprints);
  const selectedSprint = editedStory.sprintId ? sprints.find((sprint) => sprint.id === editedStory.sprintId) : null;
  const selectedSprintStatus = selectedSprint
    ? (isStatus(selectedSprint.status, 'closed') ? 'Completed' : (isStatus(selectedSprint.status, 'cancelled') ? 'Cancelled' : ''))
    : '';
  const linkedGoal = useMemo(
    () => (editedStory.goalId ? goals.find((g) => g.id === editedStory.goalId) : null),
    [editedStory.goalId, goals],
  );
  const leafGoalOptions = useMemo(() => getLeafGoalOptions(goals), [goals]);
  const selectedGoalResolution = useMemo(
    () => resolveLeafGoalSelection(editedStory.goalId || null, goals),
    [editedStory.goalId, goals],
  );
  const sprintAlignment = useMemo(
    () => evaluateStorySprintAlignment(selectedSprint as any, editedStory.goalId || '', goals),
    [selectedSprint, editedStory.goalId, goals],
  );

  const reloadLinkedTasks = useCallback(async (sourceStory: Story | null) => {
    if (!sourceStory || !currentUser) {
      setLinkedTasks([]);
      return;
    }
    setTasksLoading(true);
    try {
      const baseQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid)
      );
      const snap = await getDocs(baseQuery);
      const raw = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) })) as Task[];
      const persona = (sourceStory as any)?.persona || currentPersona;
      const filtered = raw.filter((task) => {
        if (persona && task.persona && task.persona !== persona) return false;
        return task.parentId === sourceStory.id || task.storyId === sourceStory.id;
      });
      setLinkedTasks(filtered);
    } catch (err) {
      console.error('Failed to load linked tasks', err);
      setLinkedTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, [currentUser, currentPersona]);

  // Initialize form when story changes
  useEffect(() => {
    if (story) {
      console.log('📝 EditStoryModal: Initializing with story:', story);
      const parsedPoints = parsePointsValue((story as any).points);
      const normalizedPoints = parsedPoints == null ? 1 : parsedPoints;
      const normalizedPriority = normalizePriorityValue((story as any).priority);
      setEditedStory({
        title: story.title || '',
        description: story.description || '',
        url: String((story as any).url || ''),
        goalId: story.goalId || '',
        priority: normalizedPriority > 0 ? normalizedPriority : 2,
        status: (typeof story.status === 'number' ? (story.status >= 4 ? 4 : story.status >= 2 ? 2 : 0) : 0),
        theme: story.theme || 1,
        points: normalizedPoints,
        progressPct: normalizeProgressPct((story as any).progressPct ?? 0),
        pointsRemaining: (story as any).pointsRemaining ?? computePointsRemaining(normalizedPoints, (story as any).progressPct ?? 0),
        acceptanceCriteria: Array.isArray(story.acceptanceCriteria)
          ? story.acceptanceCriteria.join('\n')
          : story.acceptanceCriteria || '',
        sprintId: (story as any).sprintId || '',
        dueDate: (story as any).dueDate ? new Date((story as any).dueDate).toISOString().slice(0, 10) : '',
        dueTime: (story as any).dueTime || '',
        timeOfDay: (story as any).timeOfDay || '',
        blocked: Boolean((story as any).blocked),
        tags: (story as any).tags || [],
        persona: ((story as any).persona || currentPersona || 'personal') as 'personal' | 'work',
      });
      setError(null);
      setAiResult(null);
      const currentGoal = goals.find(g => g.id === story.goalId);
      setGoalInput(currentGoal ? getGoalDisplayPath(currentGoal.id, goals) : '');
    }
  }, [story, goals]);

  useEffect(() => {
    if (!show || !story) {
      setLinkedTasks([]);
      return;
    }
    reloadLinkedTasks(story);
  }, [show, story, reloadLinkedTasks]);

  const handleTaskUpdate = async (taskId: string, updates: Partial<Task>) => {
    if (!currentUser) return;
    const payload: any = { ...updates, updatedAt: serverTimestamp() };
    if (updates.storyId) {
      payload.parentType = 'story';
      payload.parentId = updates.storyId;
      const targetStory = updates.storyId === story?.id ? story : null;
      if (targetStory?.goalId) payload.goalId = targetStory.goalId;
    }
    await updateDoc(doc(db, 'tasks', taskId), payload);
    setLinkedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } as Task : t)));
    if (updates.storyId && story && updates.storyId !== story.id) {
      setLinkedTasks((prev) => prev.filter((t) => t.id !== taskId));
    }
  };

  const handleTaskDelete = async (taskId: string) => {
    await deleteDoc(doc(db, 'tasks', taskId));
    setLinkedTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  const handleTaskPriorityChange = async (taskId: string, newPriority: number) => {
    await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() } as any);
    setLinkedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, priority: newPriority } as Task : t)));
  };

  const handleTaskCreate = async (newTask: Partial<Task>) => {
    if (!currentUser || !story) return;
    const parsedTaskPoints = parsePointsValue((newTask as any).points);
    const normalizedTaskPoints = parsedTaskPoints == null ? TASK_DEFAULT_POINTS : parsedTaskPoints;
    const payload: any = {
      title: newTask.title || '',
      description: newTask.description || '',
      url: (newTask as any).url || null,
      status: (newTask as any).status ?? 0,
      priority: (newTask as any).priority ?? 2,
      effort: (newTask as any).effort ?? 'M',
      dueDate: (newTask as any).dueDate || null,
      points: normalizedTaskPoints,
      ownerUid: currentUser.uid,
      persona: (editedStory as any).persona || (story as any)?.persona || currentPersona || 'personal',
      storyId: story.id,
      parentType: 'story',
      parentId: story.id,
      goalId: story.goalId || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'tasks'), payload);
    setLinkedTasks((prev) => [...prev, { id: ref.id, ...(payload as any) } as Task]);
  };

  const handleSave = async () => {
    if (!story || !editedStory.title.trim()) {
      setError('Title is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log('💾 EditStoryModal: Saving story updates:', editedStory);

      if (editedStory.sprintId && sprintAlignment.hasRule && !sprintAlignment.aligned) {
        if (sprintAlignment.blocking) {
          setError(sprintAlignment.message);
          return;
        }
        const proceed = window.confirm(`${sprintAlignment.message} Continue anyway?`);
        if (!proceed) {
          return;
        }
      }

      const resolvedGoalSelection = resolveLeafGoalSelection(editedStory.goalId || null, goals);
      if (editedStory.goalId && !resolvedGoalSelection.goalId) {
        setError(
          resolvedGoalSelection.reason === 'ambiguous_parent'
            ? 'Stories must link to a specific leaf goal. Select the child goal you want this story to execute against.'
            : 'Please select a valid leaf goal before saving this story.'
        );
        return;
      }

      const selectedGoal = goals.find((g) => g.id === (resolvedGoalSelection.goalId || editedStory.goalId));
      const normalizedPriority = normalizePriorityValue(editedStory.priority);
      const parsedStoryPoints = parsePointsValue(editedStory.points);
      const normalizedStoryPoints = parsedStoryPoints == null ? 1 : parsedStoryPoints;
      const progressUpdate = buildStoryProgressUpdate({
        points: normalizedStoryPoints,
        pointsRemaining: editedStory.pointsRemaining,
      });
      const existingDueDate = (story as any).dueDate ? new Date((story as any).dueDate).toISOString().slice(0, 10) : '';
      const existingDueTime = String((story as any).dueTime || '');
      const existingTimeOfDay = String((story as any).timeOfDay || '');
      const dueOverrideChanged = existingDueDate !== editedStory.dueDate
        || existingDueTime !== editedStory.dueTime
        || existingTimeOfDay !== editedStory.timeOfDay;
      const updates: any = {
        title: editedStory.title.trim(),
        description: editedStory.description.trim(),
        url: editedStory.url.trim() || null,
        goalId: resolvedGoalSelection.goalId || null,
        priority: normalizedPriority > 0 ? normalizedPriority : 2,
        status: editedStory.status,
        blocked: !!editedStory.blocked,
        points: normalizedStoryPoints,
        ...progressUpdate,
        sprintId: editedStory.sprintId || null,
        dueDate: editedStory.dueDate ? new Date(`${editedStory.dueDate}T00:00:00`).getTime() : null,
        dueTime: editedStory.dueTime || null,
        timeOfDay: editedStory.timeOfDay || null,
        persona: editedStory.persona || currentPersona || 'personal',
        acceptanceCriteria: editedStory.acceptanceCriteria.trim()
          ? editedStory.acceptanceCriteria.split('\n').map(line => line.trim()).filter(line => line.length > 0)
          : [],
        updatedAt: serverTimestamp(),
        tags: editedStory.tags
      };
      if (dueOverrideChanged) {
        updates.dueDateLocked = !!editedStory.dueDate;
        updates.dueDateReason = editedStory.dueDate ? 'user' : null;
        updates.targetDate = updates.dueDate;
      }
      // Inherit theme from linked goal when available
      if (selectedGoal && typeof (selectedGoal as any).theme !== 'undefined') {
        updates.theme = (selectedGoal as any).theme;
      }
      await updateDoc(doc(db, 'stories', story.id), updates);
      const prevPersona = ((story as any).persona || currentPersona || 'personal') as 'personal' | 'work';
      const nextPersona = (updates.persona || prevPersona) as 'personal' | 'work';
      if (prevPersona !== nextPersona && currentUser?.uid) {
        try {
          await cascadeStoryPersona(currentUser.uid, story.id, nextPersona);
          setLinkedTasks((prev) => prev.map((task) => ({ ...task, persona: nextPersona } as Task)));
        } catch (err) {
          console.warn('Failed to cascade persona for story', err);
        }
      }

      console.log('✅ EditStoryModal: Story updated successfully');
      // Fire-and-forget delta rescore for priority/top3 recalculation
      httpsCallable(functions, 'deltaPriorityRescore')({ entityId: story.id, entityType: 'story' })
        .catch((err) => console.warn('Delta rescore failed (non-blocking)', err));
      onStoryUpdated?.();
      onHide();
    } catch (err) {
      console.error('❌ EditStoryModal: Error updating story:', err);
      setError('Failed to update story. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!story) return;
    const label = story.ref || story.title || story.id;
    const confirmed = window.confirm(`Delete story "${label}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteDoc(doc(db, 'stories', story.id));
      onStoryUpdated?.();
      onHide();
    } catch (err) {
      console.error('❌ EditStoryModal: Error deleting story:', err);
      setError('Failed to delete story. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setEditedStory(prev => {
      if (field === 'sprintId' && value) {
        const sprint = sprints.find((s) => s.id === value);
        const sprintStart = sprint?.startDate ?? (sprint as any)?.start ?? null;
        if (sprintStart) {
          const snapMs = typeof sprintStart === 'number' ? sprintStart
            : typeof sprintStart === 'string' ? Date.parse(sprintStart)
            : (sprintStart as any)?.seconds ? (sprintStart as any).seconds * 1000
            : null;
          if (snapMs) {
            const snapDate = new Date(snapMs).toISOString().slice(0, 10);
            return { ...prev, sprintId: value, dueDate: snapDate };
          }
        }
      }
      if (field === 'progressPct') {
        const progressPct = normalizeProgressPct(value);
        return {
          ...prev,
          progressPct,
          pointsRemaining: computePointsRemaining(prev.points, progressPct),
        };
      }
      if (field === 'pointsRemaining') {
        return {
          ...prev,
          pointsRemaining: value,
          progressPct: deriveProgressPctFromPointsRemaining(prev.points, value),
        };
      }
      if (field === 'points') {
        return {
          ...prev,
          points: value,
          pointsRemaining: computePointsRemaining(value, prev.progressPct),
        };
      }
      return { ...prev, [field]: value };
    });
  };

  const handleGenerateTasks = async () => {
    if (!story || !currentUser || isGeneratingTasks) return;
    setIsGeneratingTasks(true);
    setError(null);
    setAiResult(null);
    try {
      let created = 0;
      let usedFallback = false;
      try {
        const fn = httpsCallable(functions, 'generateTasksForStory');
        const res: any = await fn({ storyId: story.id });
        created = Number(res?.data?.created ?? res?.data?.tasksCreated ?? 0);
      } catch {
        // Fallback to the callable currently deployed in this repo.
        const alt = httpsCallable(functions, 'orchestrateStoryPlanning');
        const res: any = await alt({ storyId: story.id, research: false });
        created = Number(res?.data?.tasksCreated ?? res?.data?.created ?? 0);
        usedFallback = true;
      }
      await reloadLinkedTasks(story);
      const base = created > 0
        ? `Generated ${created} tasks for this story.`
        : 'AI generation completed with no new tasks.';
      setAiResult(usedFallback ? `${base} (via orchestration)` : base);
    } catch (err: any) {
      console.error('AI task generation failed', err);
      setError(err?.message || 'Failed to generate tasks for this story.');
    } finally {
      setIsGeneratingTasks(false);
    }
  };

  const handleOpenCalendarComposer = () => {
    if (!story) return;
    setCalendarComposerInitialValues(buildCalendarComposerInitialValues({
      title: editedStory.title || story.title || 'Story block',
      persona: editedStory.persona || ((story as any).persona || currentPersona || 'personal'),
      theme: String((linkedGoal as any)?.theme || (story as any).theme || 'General'),
      category: ((editedStory.persona || (story as any).persona || currentPersona) === 'work' ? 'Work (Main Gig)' : 'Wellbeing') as any,
      storyId: story.id,
      points: Number(editedStory.points || (story as any).points || 0) || null,
      aiScore: Number.isFinite(Number((story as any).aiCriticalityScore)) ? Number((story as any).aiCriticalityScore) : null,
      aiReason: String((story as any).aiTop3Reason || (story as any).aiCriticalityReason || '').trim() || null,
      rationale: 'Manual schedule from story editor',
    }));
    setShowCalendarComposer(true);
  };

  const handleConvertToTask = async () => {
    if (!story || !currentUser) return;
    const confirmed = window.confirm('Convert this story into a task card copy?');
    if (!confirmed) return;
    try {
      await addDoc(collection(db, 'tasks'), {
        ownerUid: currentUser.uid,
        title: editedStory.title.trim() || story.title || 'Converted story',
        description: editedStory.description.trim() || story.description || '',
        status: 0,
        priority: normalizePriorityValue(editedStory.priority),
        sprintId: editedStory.sprintId || (story as any).sprintId || null,
        goalId: resolvedLeafGoalSelection(editedStory.goalId || story.goalId || null, goals),
        persona: editedStory.persona || ((story as any).persona || currentPersona || 'personal'),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('Failed to convert story to task copy', err);
      setError('Could not create a task copy for this story.');
    }
  };

  const handleToggleManualPriority = async () => {
    if (!story || !currentUser?.uid || flaggingPriority) return;
    setFlaggingPriority(true);
    try {
      const storiesSnap = await getDocs(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)));
      const existingFlagged = storiesSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((s: any) => String(s.persona || 'personal') === String((story as any).persona || currentPersona || 'personal'));
      const currentRank = getManualPriorityRank(story);
      if (currentRank) {
        await updateDoc(doc(db, 'stories', story.id), {
          userPriorityFlag: false,
          userPriorityRank: null,
          userPriorityFlagAt: null,
          updatedAt: serverTimestamp(),
        });
      } else {
        const nextRank = getNextManualPriorityRank(existingFlagged, String((story as any).persona || currentPersona || 'personal'), story.id);
        const conflicting = findItemWithManualPriorityRank(existingFlagged, String((story as any).persona || currentPersona || 'personal'), nextRank, story.id);
        if (conflicting?.id) {
          await updateDoc(doc(db, 'stories', conflicting.id), {
            userPriorityFlag: false,
            userPriorityRank: null,
            userPriorityFlagAt: null,
            updatedAt: serverTimestamp(),
          });
        }
        await updateDoc(doc(db, 'stories', story.id), {
          userPriorityFlag: true,
          userPriorityRank: nextRank,
          userPriorityFlagAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      console.error('Failed to toggle manual priority for story', err);
      setError('Could not update manual priority.');
    } finally {
      setFlaggingPriority(false);
    }
  };

  const resolvedManualPriorityRank = story ? getManualPriorityRank(story) : null;
  const resolvedManualPriorityLabel = story ? getManualPriorityLabel(story) : null;
  const resolvedLeafGoalSelection = (goalId: string | null, availableGoals: Goal[]) =>
    resolveLeafGoalSelection(goalId, availableGoals).goalId || null;

  return (
    <Modal show={show} onHide={onHide} size="xl" container={container || undefined} fullscreen="lg-down" scrollable>
      <Modal.Header closeButton>
        <div className="d-flex w-100 align-items-center justify-content-between gap-2">
          <Modal.Title>Edit Story: {story?.ref}</Modal.Title>
          {story && (
            <div className="d-flex align-items-center gap-2">
              <Button variant="outline-secondary" size="sm" title="Activity stream" onClick={() => showSidebar(story, 'story')}>
                <Activity size={14} />
              </Button>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handleGenerateTasks}
                disabled={isGeneratingTasks || loading || deleting}
                title="Auto-generate tasks for this story"
              >
                <Wand2 size={14} />
              </Button>
              <Button variant="outline-secondary" size="sm" title="Create task copy" onClick={handleConvertToTask}>
                <Shuffle size={14} />
              </Button>
              <Button
                variant={resolvedManualPriorityRank ? 'outline-danger' : 'outline-secondary'}
                size="sm"
                title={resolvedManualPriorityLabel || 'Set manual priority'}
                onClick={handleToggleManualPriority}
                disabled={flaggingPriority}
              >
                <span style={{ fontSize: 11, fontWeight: 800, lineHeight: 1 }}>{resolvedManualPriorityRank || 1}</span>
              </Button>
              <Button variant="outline-secondary" size="sm" title="Open calendar composer" onClick={handleOpenCalendarComposer}>
                <CalendarPlus size={14} />
              </Button>
              <Button variant="outline-secondary" size="sm" title="Defer intelligently" onClick={() => setShowDeferModal(true)}>
                <Clock3 size={14} />
              </Button>
              <Button variant="outline-danger" size="sm" title="Delete story" onClick={handleDelete} disabled={loading || deleting}>
                <Trash2 size={14} />
              </Button>
            </div>
          )}
        </div>
      </Modal.Header>

      <Modal.Body>
        {error && (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error}
          </Alert>
        )}
        {aiResult && (
          <Alert variant="success" onClose={() => setAiResult(null)} dismissible>
            {aiResult}
          </Alert>
        )}

        <Row className="g-3">
          <Col lg={8}>
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
                      step="any"
                      inputMode="decimal"
                      value={editedStory.points}
                      onChange={(e) => handleInputChange('points', e.target.value)}
                    />
                  </Form.Group>
                </Col>
              </Row>

              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Progress</Form.Label>
                    <Form.Select
                      value={Number(editedStory.progressPct || 0)}
                      onChange={(e) => handleInputChange('progressPct', Number(e.target.value))}
                    >
                      <option value={0}>0% complete</option>
                      <option value={10}>10% complete</option>
                      <option value={25}>25% complete</option>
                      <option value={50}>50% complete</option>
                      <option value={75}>75% complete</option>
                      <option value={90}>90% complete</option>
                      <option value={100}>100% complete</option>
                    </Form.Select>
                    <div className="form-text">
                      {formatStoryProgressLabel(editedStory.points, editedStory.progressPct)}
                    </div>
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Points Remaining</Form.Label>
                    <Form.Control
                      type="number"
                      step="1"
                      min="0"
                      inputMode="numeric"
                      value={editedStory.pointsRemaining}
                      onChange={(e) => handleInputChange('pointsRemaining', e.target.value)}
                    />
                    <div className="form-text">
                      Enter the remaining effort directly when you know the exact points left.
                    </div>
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
                      {selectedSprint && isHiddenSprint(selectedSprint) && (
                        <option key={selectedSprint.id} value={selectedSprint.id} disabled>
                          {formatSprintLabel(selectedSprint, selectedSprintStatus || 'Inactive')}
                        </option>
                      )}
                      {visibleSprints.map((sprint) => (
                        <option key={sprint.id} value={sprint.id}>
                          {formatSprintLabel(sprint)}
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
                        const match = leafGoalOptions.find((g) => {
                          const displayPath = getGoalDisplayPath(g.id, goals);
                          return displayPath === val || g.id === val || g.title === val;
                        });
                        setGoalInput(match ? getGoalDisplayPath(match.id, goals) : val);
                        handleInputChange('goalId', match ? match.id : '');
                      }}
                      placeholder="Search leaf goals by title..."
                    />
                    <datalist id="edit-story-goal-options">
                      {leafGoalOptions.map(g => (
                        <option key={g.id} value={getGoalDisplayPath(g.id, goals)} />
                      ))}
                    </datalist>
                    {selectedGoalResolution.reason === 'auto_descendant' && selectedGoalResolution.leafGoal && (
                      <div className="form-text text-info">
                        Parent goal selection auto-resolved to {getGoalDisplayPath(selectedGoalResolution.leafGoal.id, goals)}.
                      </div>
                    )}
                    {selectedGoalResolution.reason === 'ambiguous_parent' && (
                      <div className="form-text text-warning">
                        This parent has multiple leaf goals. Choose the exact leaf goal this story should execute against.
                      </div>
                    )}
                    {editedStory.goalId ? (
                      <div className="form-text">
                        <Button
                          size="sm"
                          variant="link"
                          className="p-0"
                          onClick={() => navigate(`/goals/${(linkedGoal as any)?.ref || editedStory.goalId}`)}
                        >
                          View linked goal
                        </Button>
                      </div>
                    ) : null}
                  </Form.Group>
                </Col>

                {editedStory.sprintId && sprintAlignment.hasRule && !sprintAlignment.aligned && (
                  <Col md={12}>
                    <Alert variant={sprintAlignment.blocking ? 'danger' : 'warning'} className="mb-3">
                      {sprintAlignment.message}
                    </Alert>
                  </Col>
                )}

                <Col md={2}>
                  <Form.Group className="mb-3">
                    <Form.Label>Priority</Form.Label>
                    <Form.Select
                      value={editedStory.priority}
                      onChange={(e) => handleInputChange('priority', parseInt(e.target.value))}
                    >
                      <option value={4}>Critical</option>
                      <option value={3}>High</option>
                      <option value={2}>Medium</option>
                      <option value={1}>Low</option>
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
                      <option value={2}>In Progress</option>
                      <option value={4}>Done</option>
                    </Form.Select>
                  </Form.Group>
                </Col>

                <Col md={2}>
                  <Form.Group className="mb-3">
                    <Form.Label>&nbsp;</Form.Label>
                    <Form.Check
                      type="checkbox"
                      id="story-blocked-checkbox"
                      label="Blocked"
                      checked={!!editedStory.blocked}
                      onChange={(e) => handleInputChange('blocked', e.target.checked)}
                    />
                  </Form.Group>
                </Col>

                {/* Theme removed: stories inherit from linked goal */}
              </Row>

              <Row>
                <Col md={12}>
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
                </Col>
              </Row>

              <Row>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Due Date</Form.Label>
                    <Form.Control
                      type="date"
                      value={editedStory.dueDate}
                      onChange={(e) => handleInputChange('dueDate', e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Due Time</Form.Label>
                    <Form.Control
                      type="time"
                      value={editedStory.dueTime}
                      onChange={(e) => handleInputChange('dueTime', e.target.value)}
                    />
                  </Form.Group>
                </Col>
                <Col md={4}>
                  <Form.Group className="mb-3">
                    <Form.Label>Time of Day</Form.Label>
                    <Form.Select
                      value={editedStory.timeOfDay}
                      onChange={(e) => handleInputChange('timeOfDay', e.target.value as any)}
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
                <Form.Label>Source URL</Form.Label>
                <Form.Control
                  type="url"
                  value={editedStory.url}
                  onChange={(e) => handleInputChange('url', e.target.value)}
                  placeholder="https://..."
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Tags</Form.Label>
                <TagInput
                  value={editedStory.tags}
                  onChange={(tags) => handleInputChange('tags', tags)}
                  placeholder="Add tags..."
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Persona</Form.Label>
                <Form.Select
                  value={editedStory.persona}
                  onChange={(e) => handleInputChange('persona', e.target.value as 'personal' | 'work')}
                >
                  <option value="personal">Personal</option>
                  <option value="work">Work</option>
                </Form.Select>
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

          </Col>
          <Col lg={4}>
            <ActivityStreamPanel
              entityId={story?.id}
              entityType="story"
              referenceNumber={story?.ref || (story as any)?.referenceNumber}
            />
          </Col>
        </Row>

        <div className="mt-4">
          <h5 className="mb-2">Linked Tasks</h5>
          {tasksLoading ? (
            <div className="text-muted small">Loading tasks…</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <ModernTaskTable
                tasks={linkedTasks}
                stories={story ? [story] : []}
                goals={goals}
                sprints={sprints as any}
                compact
                defaultColumns={['ref', 'title', 'status', 'priority', 'dueDate', 'points']}
                onTaskCreate={handleTaskCreate}
                onTaskUpdate={handleTaskUpdate}
                onTaskDelete={handleTaskDelete}
                onTaskPriorityChange={handleTaskPriorityChange}
              />
            </div>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer>
        {story && (
          <Button variant="outline-danger" onClick={handleDelete} disabled={loading || deleting}>
            {deleting ? 'Deleting...' : 'Delete Story'}
          </Button>
        )}
        <Button variant="secondary" onClick={onHide} disabled={loading || deleting}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={loading || deleting}>
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </Modal.Footer>
      <NewCalendarEventModal
        show={showCalendarComposer}
        onHide={() => setShowCalendarComposer(false)}
        initialValues={calendarComposerInitialValues}
        stories={story ? [story] : []}
      />
      <DeferItemModal
        show={showDeferModal && !!story}
        onHide={() => setShowDeferModal(false)}
        itemType="story"
        itemId={story?.id || ''}
        itemTitle={story?.title || 'Story'}
        onApply={async ({ dateMs, rationale, source }) => {
          if (!story) return;
          await updateDoc(doc(db, 'stories', story.id), {
            deferredUntil: dateMs,
            deferredReason: rationale,
            deferredBy: source,
            deferredAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          } as any);
          setShowDeferModal(false);
          onStoryUpdated?.();
        }}
      />
    </Modal>
  );
};

export default EditStoryModal;
