import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { doc, updateDoc, serverTimestamp, collection, query, where, orderBy, limit, onSnapshot, setDoc, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { db, functions } from '../firebase';
import { useSprint } from '../contexts/SprintContext';
import { Task, Sprint, Story, Goal } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { isStatus } from '../utils/statusHelpers';
import { normalizePriorityValue } from '../utils/priorityUtils';
import ActivityStreamPanel from './common/ActivityStreamPanel';
import TagInput from './common/TagInput';
import { cascadeTaskPersona } from '../utils/personaCascade';
import { formatTaskTagLabel } from '../utils/tagDisplay';
import { normalizeTaskTags } from '../utils/taskTagging';
import { findSprintForDate } from '../utils/taskSprintHelpers';

interface EditTaskModalProps {
  show: boolean;
  task: Task | null;
  onHide: () => void;
  onUpdated?: () => void;
  container?: HTMLElement | null;
}

const normalizeTaskStatus = (status: any) => {
  if (typeof status === 'number') return status;
  const value = String(status || '').toLowerCase();
  if (value.includes('done') || value.includes('complete')) return 2;
  if (value.includes('progress') || value.includes('active')) return 1;
  if (value.includes('block')) return 3;
  return 0;
};

const resolveTimestampMs = (value: any): number | null => {
  if (!value) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') {
    const dateValue = value.toDate();
    return dateValue instanceof Date ? dateValue.getTime() : null;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value.seconds != null) {
    return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1e6);
  }
  return null;
};

const isHiddenSprint = (sprint: Sprint) => isStatus(sprint.status, 'closed') || isStatus(sprint.status, 'cancelled');
const formatSprintLabel = (sprint: Sprint, statusOverride?: string) => {
  const name = sprint.name || sprint.ref || `Sprint ${sprint.id.slice(-4)}`;
  const statusLabel = statusOverride
    ? ` (${statusOverride})`
    : (isStatus(sprint.status, 'active') ? ' (Active)' : '');
  return `${name}${statusLabel}`;
};

const EditTaskModal: React.FC<EditTaskModalProps> = ({ show, task, onHide, onUpdated, container }) => {
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();
  const { themes: globalThemes } = useGlobalThemes();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 0 as number | string,
    priority: 2 as number | string,
    sprintId: '' as string,
    points: 1 as number,
    dueDate: '' as string,
    storyId: '' as string,
    goalId: '' as string,
    tags: [] as string[],
    type: 'task' as 'task' | 'chore' | 'routine' | 'habit',
    repeatFrequency: '' as '' | 'daily' | 'weekly' | 'monthly' | 'yearly',
    repeatInterval: 1 as number,
    daysOfWeek: [] as string[],
    persona: 'personal' as 'personal' | 'work',
  });
  const [storyInput, setStoryInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [converting, setConverting] = useState(false);
  const visibleSprints = sprints.filter((sprint) => !isHiddenSprint(sprint));
  const selectedSprint = form.sprintId ? sprints.find((sprint) => sprint.id === form.sprintId) : null;
  const selectedSprintStatus = selectedSprint
    ? (isStatus(selectedSprint.status, 'closed') ? 'Completed' : (isStatus(selectedSprint.status, 'cancelled') ? 'Cancelled' : ''))
    : '';
  const macSyncedAtMs = task ? resolveTimestampMs((task as any).macSyncedAt) : null;
  const showMacSync = !!task && (
    (task as any).macSyncedAt != null
    || (task as any).source === 'MacApp'
    || (task as any).createdBy === 'mac_app'
  );

  const linkedStory = useMemo(
    () => (form.storyId ? stories.find((s) => s.id === form.storyId) : null),
    [form.storyId, stories],
  );
  const linkedGoalId = form.goalId || linkedStory?.goalId || '';
  const linkedGoal = useMemo(
    () => (linkedGoalId ? goals.find((g) => g.id === linkedGoalId) : null),
    [linkedGoalId, goals],
  );

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
      const persona = (task as any)?.persona || currentPersona;
      const filtered = persona ? rows.filter((s) => !s.persona || s.persona === persona) : rows;
      setStories(filtered);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona, task]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(500)
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[];
      const persona = (task as any)?.persona || currentPersona;
      const filtered = persona ? rows.filter((g) => !g.persona || g.persona === persona) : rows;
      setGoals(filtered);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona, task]);

  useEffect(() => {
    if (!show) return;
    if (!task) {
      setForm({
        title: '',
        description: '',
        status: 0,
        priority: 2,
        sprintId: '',
        points: 1,
        dueDate: '',
        storyId: '',
        goalId: '',
        tags: [],
        type: 'task',
        repeatFrequency: '',
        repeatInterval: 1,
        daysOfWeek: [],
        persona: ((currentPersona || 'personal') as 'personal' | 'work'),
      });
      setStoryInput('');
      setGoalInput('');
      return;
    }
    const resolveDue = (value: any) => {
      if (!value) return '';
      const dateMs = typeof value === 'number'
        ? value
        : (value?.toMillis ? value.toMillis() : (value?.toDate ? value.toDate().getTime() : Date.parse(value)));
      if (!Number.isFinite(dateMs)) return '';
      return new Date(dateMs).toISOString().slice(0, 10);
    };
    const linkedStoryId = (task as any).storyId || (task as any).parentId || '';
    const linkedStory = linkedStoryId ? stories.find((s) => s.id === linkedStoryId) : undefined;
    setForm({
      title: task.title || '',
      description: (task as any).description || '',
      status: normalizeTaskStatus((task as any).status),
      priority: normalizePriorityValue((task as any).priority),
      sprintId: (task as any).sprintId || '',
      points: (task as any).points ?? 1,
      dueDate: resolveDue((task as any).dueDate || (task as any).dueDateMs || (task as any).targetDate),
      storyId: linkedStoryId,
      goalId: (task as any).goalId || linkedStory?.goalId || '',
      tags: Array.isArray((task as any).tags) ? (task as any).tags : [],
      type: ((task as any).type || 'task') as 'task' | 'chore' | 'routine' | 'habit',
      repeatFrequency: ((task as any).repeatFrequency || '') as '' | 'daily' | 'weekly' | 'monthly' | 'yearly',
      repeatInterval: Number((task as any).repeatInterval || 1) || 1,
      daysOfWeek: Array.isArray((task as any).daysOfWeek) ? (task as any).daysOfWeek : [],
      persona: ((task as any).persona || 'personal') as 'personal' | 'work',
    });
    setStoryInput(linkedStory ? (linkedStory.title || '') : '');
    const resolvedGoalId = (task as any)?.goalId || linkedStory?.goalId || '';
    const linkedGoalInit = resolvedGoalId ? goals.find((g) => g.id === resolvedGoalId) : undefined;
    setGoalInput(linkedGoalInit ? (linkedGoalInit.title || '') : '');
  }, [task, show, stories, goals, currentPersona]);

  const storyLabel = (s: Story) => s.title || '(untitled)';

  const resolveStorySelection = (value: string) => {
    const val = value.trim();
    if (!val) {
      setForm((prev) => ({ ...prev, storyId: '' }));
      return;
    }
    const match = stories.find((s) => s.title === val || s.id === val);
    if (match) {
      setForm((prev) => ({ ...prev, storyId: match.id, goalId: match.goalId || prev.goalId }));
      setStoryInput(match.title || '');
    } else {
      setForm((prev) => ({ ...prev, storyId: '' }));
    }
  };

  const goalLabel = (g: Goal) => g.title || '(untitled)';

  const resolveGoalSelection = (value: string) => {
    const val = value.trim();
    if (!val) {
      setForm((prev) => ({ ...prev, goalId: '' }));
      return;
    }
    const match = goals.find((g) => g.title === val || g.id === val);
    if (match) {
      setForm((prev) => ({ ...prev, goalId: match.id }));
      setGoalInput(match.title || '');
    } else {
      setForm((prev) => ({ ...prev, goalId: '' }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const linkedStory = form.storyId ? stories.find((s) => s.id === form.storyId) : null;
    if (!form.title.trim()) {
      alert('Please add a task title.');
      setSaving(false);
      return;
    }
    try {
      const isRecurringType = form.type === 'chore' || form.type === 'routine' || form.type === 'habit';
      const normalizedFrequency = isRecurringType ? (form.repeatFrequency || null) : null;
      const normalizedInterval = isRecurringType ? Math.max(1, Number(form.repeatInterval) || 1) : null;
      const normalizedDays = isRecurringType && form.repeatFrequency === 'weekly'
        ? Array.isArray(form.daysOfWeek) ? form.daysOfWeek : []
        : [];
      const dueDateMs = form.dueDate ? new Date(`${form.dueDate}T00:00:00`).getTime() : null;
      let nextSprintId = form.sprintId || null;
      let dueDateChanged = false;
      if (task) {
        const originalDueDateMs = resolveTimestampMs((task as any).dueDate || (task as any).dueDateMs || (task as any).targetDate);
        dueDateChanged = (originalDueDateMs ?? null) !== (dueDateMs ?? null);
      }
      if (dueDateChanged || (!task && dueDateMs && !nextSprintId)) {
        const matched = findSprintForDate(sprints, dueDateMs);
        nextSprintId = matched?.id ?? null;
      }
      const basePayload: any = {
        title: form.title.trim(),
        description: form.description,
        status: typeof form.status === 'string' ? Number(form.status) || form.status : form.status,
        priority: typeof form.priority === 'string' ? Number(form.priority) || form.priority : form.priority,
        points: Number(form.points) || 1,
        sprintId: nextSprintId,
        dueDate: dueDateMs,
        storyId: form.storyId || null,
        parentType: form.storyId ? 'story' : null,
        parentId: form.storyId || null,
        goalId: form.goalId || null,
        tags: Array.isArray(form.tags) ? form.tags.map((tag) => tag.trim()).filter(Boolean) : [],
        type: form.type || 'task',
        repeatFrequency: normalizedFrequency,
        repeatInterval: normalizedInterval,
        daysOfWeek: normalizedDays,
        persona: form.persona || 'personal',
      };
      if (form.storyId) {
        const linked = stories.find((s) => s.id === form.storyId);
        if (linked?.goalId) basePayload.goalId = linked.goalId;
        if ((linked as any)?.sprintId) basePayload.sprintId = (linked as any).sprintId;
      }
      const storySprintId = linkedStory?.sprintId || (linkedStory as any)?.sprintId || null;
      const resolvedGoalId = basePayload.goalId || linkedStory?.goalId || null;
      const resolvedGoal = resolvedGoalId ? goals.find((g) => g.id === resolvedGoalId) : null;
      const sprintForTag = (basePayload.sprintId || storySprintId)
        ? sprints.find((sprint) => sprint.id === (basePayload.sprintId || storySprintId))
        : null;
      const themeValue = (resolvedGoal as any)?.theme
        ?? (linkedStory as any)?.theme
        ?? (task as any)?.theme
        ?? (task as any)?.themeId
        ?? (task as any)?.theme_id
        ?? null;
      basePayload.tags = normalizeTaskTags({
        tags: basePayload.tags || [],
        type: basePayload.type,
        persona: basePayload.persona,
        sprint: sprintForTag || null,
        themeValue,
        goalRef: (resolvedGoal as any)?.ref || null,
        storyRef: (linkedStory as any)?.ref || null,
        themes: globalThemes,
      });

      let savedTaskId = task?.id || null;
      const existingRef = (task as any)?.ref || (task as any)?.reference || null;
      const prevPersona = (((task as any)?.persona) || 'personal') as 'personal' | 'work';
      if (task) {
        const updates: any = {
          ...basePayload,
          title: basePayload.title || task.title,
          updatedAt: serverTimestamp(),
        };
        if (dueDateChanged) {
          updates.dueDateLocked = true;
          updates.dueDateReason = 'user';
        }
        await updateDoc(doc(db, 'tasks', task.id), updates);
      } else {
        if (!currentUser?.uid) {
          throw new Error('You must be signed in to create tasks.');
        }
        const createPayload: any = {
          ...basePayload,
          ownerUid: currentUser.uid,
          persona: basePayload.persona || (currentPersona || 'personal'),
          deleted: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          dueDateLocked: dueDateMs != null,
          dueDateReason: dueDateMs != null ? 'user' : null,
        };
        const createdRef = await addDoc(collection(db, 'tasks'), createPayload);
        savedTaskId = createdRef.id;
      }

      if (currentUser?.uid && savedTaskId) {
        const sprintKey = (basePayload.sprintId || storySprintId || '') || '__none__';
        const statusValue = basePayload.status;
        const isDone = typeof statusValue === 'number'
          ? statusValue >= 2
          : String(statusValue || '').toLowerCase().includes('done') || String(statusValue || '').toLowerCase().includes('complete');
        const indexPayload: any = {
          id: savedTaskId,
          ownerUid: currentUser.uid,
          persona: basePayload.persona || prevPersona,
          sprintId: sprintKey,
          status: basePayload.status,
          isOpen: !isDone,
          dueDate: basePayload.dueDate ?? null,
          priority: basePayload.priority ?? null,
          title: basePayload.title,
          description: basePayload.description || null,
          goalId: basePayload.goalId || null,
          storyId: basePayload.storyId || null,
          parentType: basePayload.parentType || null,
          parentId: basePayload.parentId || null,
          tags: basePayload.tags || [],
          ref: existingRef,
          updatedAt: Date.now(),
        };
        try {
          await setDoc(doc(db, 'sprint_task_index', savedTaskId), indexPayload, { merge: true });
        } catch (indexErr) {
          // sprint_task_index is server-managed; client writes may be denied by rules
          console.warn('sprint_task_index update skipped (server-managed)', indexErr);
        }
      }
      const nextPersona = (basePayload.persona || prevPersona) as 'personal' | 'work';
      if (task?.id && prevPersona !== nextPersona && currentUser?.uid) {
        try {
          await cascadeTaskPersona(currentUser.uid, task.id, nextPersona);
        } catch (err) {
          console.warn('Failed to cascade persona for task', err);
        }
      }
      // Fire-and-forget delta rescore for priority/top3 recalculation
      if (savedTaskId) {
        httpsCallable(functions, 'deltaPriorityRescore')({ entityId: savedTaskId, entityType: 'task' })
          .catch((err) => console.warn('Delta rescore failed (non-blocking)', err));
      }
      onUpdated?.();
      onHide();
    } catch (error) {
      console.error('Failed to update task', error);
      alert('Failed to update task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToStory = async () => {
    if (!task || converting) return;
    const linkedStory = (form.storyId || (task as any).storyId || (task as any).parentId) ? true : false;
    if (linkedStory) {
      alert('This task is already linked to a story.');
      return;
    }
    const confirmed = window.confirm('Convert this task to a story? The task will be marked complete and removed from tasks.');
    if (!confirmed) return;
    setConverting(true);
    try {
      const suggestCallable = httpsCallable(functions, 'suggestTaskStoryConversions');
      const convertCallable = httpsCallable(functions, 'convertTasksToStories');
      const response: any = await suggestCallable({
        persona: form.persona || (task as any).persona || 'personal',
        taskIds: [task.id],
        limit: 1,
      });
      const suggestions: any[] = Array.isArray(response?.data?.suggestions) ? response.data.suggestions : [];
      const suggestion = suggestions.find(item => item.taskId === task.id) || suggestions[0] || null;
      const storyTitle = (suggestion?.storyTitle || form.title || task.title || 'New Story').slice(0, 140);
      const storyDescription = (suggestion?.storyDescription || form.description || (task as any).description || '').slice(0, 1200);
      const goalId = suggestion?.goalId || (task as any).goalId || null;
      const sprintId = suggestion?.sprintId || (task as any).sprintId || null;

      await convertCallable({
        conversions: [{
          taskId: task.id,
          storyTitle,
          storyDescription,
          goalId,
          sprintId,
        }],
      });
      onUpdated?.();
      onHide();
    } catch (error) {
      console.error('Error converting task to story:', error);
      alert('Could not convert this task to a story. Please try again.');
    } finally {
      setConverting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" container={container || undefined}>
      <Modal.Header closeButton>
        <Modal.Title>{task ? 'Edit Task' : 'Add Task'}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Row className="g-3">
            <Col lg={8}>
              <Form>
                <Form.Group className="mb-3">
                  <Form.Label>Title</Form.Label>
                  <Form.Control
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Tags</Form.Label>
                  <TagInput
                    value={form.tags}
                    onChange={(tags) => setForm({ ...form, tags })}
                    placeholder="Add tags..."
                    formatTag={(tag) => formatTaskTagLabel(tag, goals, sprints)}
                  />
                </Form.Group>
                <Form.Group className="mb-3">
                  <Form.Label>Task type</Form.Label>
                  <Form.Select
                    value={form.type}
                    onChange={(e) => setForm({ ...form, type: e.target.value as 'task' | 'chore' | 'routine' | 'habit' })}
                  >
                    <option value="task">Task</option>
                    <option value="chore">Chore</option>
                    <option value="routine">Routine</option>
                    <option value="habit">Habit</option>
                  </Form.Select>
                </Form.Group>
                {(form.type === 'chore' || form.type === 'routine' || form.type === 'habit') && (
                  <div className="mb-3">
                    <Row className="g-3 align-items-end">
                      <Col md={4}>
                        <Form.Label>Frequency</Form.Label>
                        <Form.Select
                          value={form.repeatFrequency || ''}
                          onChange={(e) => setForm({ ...form, repeatFrequency: e.target.value as any })}
                        >
                          <option value="">None</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                          <option value="yearly">Yearly</option>
                        </Form.Select>
                      </Col>
                      <Col md={4}>
                        <Form.Label>Interval</Form.Label>
                        <Form.Control
                          type="number"
                          min={1}
                          max={365}
                          value={form.repeatInterval || 1}
                          onChange={(e) => setForm({ ...form, repeatInterval: Number(e.target.value) || 1 })}
                        />
                      </Col>
                    </Row>
                    {form.repeatFrequency === 'weekly' && (
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
                          ].map((day) => (
                            <Form.Check
                              key={day.value}
                              inline
                              type="checkbox"
                              id={`task-${day.value}`}
                              label={day.label}
                              checked={form.daysOfWeek.includes(day.value)}
                              onChange={(e) => {
                                const exists = form.daysOfWeek.includes(day.value);
                                const next = exists
                                  ? form.daysOfWeek.filter((d) => d !== day.value)
                                  : [...form.daysOfWeek, day.value];
                                setForm({ ...form, daysOfWeek: next });
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <Form.Group className="mb-3">
                  <Form.Label>Persona</Form.Label>
                  <Form.Select
                    value={form.persona}
                    onChange={(e) => setForm({ ...form, persona: e.target.value as 'personal' | 'work' })}
                  >
                    <option value="personal">Personal</option>
                    <option value="work">Work</option>
                  </Form.Select>
                </Form.Group>
                <Row>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Status</Form.Label>
                      <Form.Select
                        value={String(form.status)}
                        onChange={(e) => setForm({ ...form, status: Number(e.target.value) })}
                      >
                        <option value={0}>Backlog</option>
                        <option value={1}>In Progress</option>
                        <option value={2}>Done</option>
                        <option value={3}>Blocked</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Priority</Form.Label>
                      <Form.Select
                        value={String(form.priority)}
                        onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                      >
                        <option value={4}>Critical</option>
                        <option value={3}>High</option>
                        <option value={2}>Medium</option>
                        <option value={1}>Low</option>
                      </Form.Select>
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Sprint</Form.Label>
                      <Form.Select
                        value={form.sprintId || ''}
                        onChange={(e) => setForm({ ...form, sprintId: e.target.value })}
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
                </Row>
                <Row>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Due date</Form.Label>
                      <Form.Control
                        type="date"
                        value={form.dueDate}
                        onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Points</Form.Label>
                      <Form.Control
                        type="number"
                        min={0}
                        step={1}
                        value={form.points || 0}
                        onChange={(e) => setForm({ ...form, points: Number(e.target.value) || 0 })}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={4}>
                    <Form.Group className="mb-3">
                      <Form.Label>Link to goal</Form.Label>
                      <Form.Control
                        list="task-goal-options"
                        placeholder="Search goal by title..."
                        value={goalInput}
                        onChange={(e) => {
                          setGoalInput(e.target.value);
                        }}
                        onBlur={(e) => resolveGoalSelection(e.target.value)}
                      />
                      <datalist id="task-goal-options">
                        {goals.map((g) => (
                          <option key={g.id} value={goalLabel(g)} />
                        ))}
                      </datalist>
                      {linkedGoalId ? (
                        <div className="form-text">
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0"
                            onClick={() => navigate(`/goals/${(linkedGoal as any)?.ref || linkedGoalId}`)}
                          >
                            View linked goal
                          </Button>
                        </div>
                      ) : null}
                      {(form.type === 'habit' || form.type === 'chore' || form.type === 'routine') && (
                        <div className="form-text">Linking a goal is recommended for better planner/theme placement.</div>
                      )}
                    </Form.Group>
                  </Col>
                </Row>
                <Row>
                  <Col md={12}>
                    <Form.Group className="mb-3">
                      <Form.Label>Link to story</Form.Label>
                      <Form.Control
                        list="task-story-options"
                        placeholder="Search story by title..."
                        value={storyInput}
                        onChange={(e) => {
                          setStoryInput(e.target.value);
                        }}
                        onBlur={(e) => resolveStorySelection(e.target.value)}
                      />
                      <datalist id="task-story-options">
                        {stories.map((s) => (
                          <option key={s.id} value={storyLabel(s)} />
                        ))}
                      </datalist>
                      {linkedStory ? (
                        <div className="form-text">
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0"
                            onClick={() => navigate(`/stories/${(linkedStory as any).ref || linkedStory.id}`)}
                          >
                            View linked story
                          </Button>
                        </div>
                      ) : null}
                      <div className="form-text">
                        Selecting a story will also inherit its goal and sprint when available.
                      </div>
                    </Form.Group>
                  </Col>
                </Row>
                {task && (task as Task).aiCriticalityScore != null && (
                  <div className="mb-3">
                    <strong>AI Score:</strong>{' '}
                    {Number.isFinite(Number((task as Task).aiCriticalityScore))
                      ? Math.round(Number((task as Task).aiCriticalityScore))
                      : (task as Task).aiCriticalityScore}
                    {(() => {
                      const t = task as Task;
                      const top3Reason = (t as any).aiTop3ForDay ? (t as any).aiTop3Reason : null;
                      const reason = top3Reason || (t as any).aiCriticalityReason || null;
                      return reason ? <div className="small text-muted">{reason}</div> : null;
                    })()}
                  </div>
                )}
                {showMacSync && (
                  <div className="mb-3">
                    <strong>Last Mac sync:</strong>{' '}
                    {macSyncedAtMs ? format(new Date(macSyncedAtMs), 'MMM d, yyyy • HH:mm') : '—'}
                  </div>
                )}
              </Form>
            </Col>
            {task && (
              <Col lg={4}>
                <ActivityStreamPanel
                  entityId={task?.id}
                  entityType="task"
                  referenceNumber={(task as any)?.ref || (task as any)?.reference || (task as any)?.referenceNumber}
                />
              </Col>
            )}
          </Row>
      </Modal.Body>
      <Modal.Footer>
        <Button
          variant="outline-danger"
          onClick={handleConvertToStory}
          disabled={
            converting
            || saving
            || !task
            || !!(task as any)?.convertedToStoryId
            || !!(task as any)?.deleted
            || !!form.storyId
          }
        >
          {converting ? 'Converting...' : 'Convert to Story'}
        </Button>
        <Button variant="secondary" onClick={onHide}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : task ? 'Save' : 'Create task'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EditTaskModal;
