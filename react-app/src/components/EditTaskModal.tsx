import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { doc, updateDoc, serverTimestamp, collection, query, where, orderBy, limit, onSnapshot, setDoc } from 'firebase/firestore';
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
    if (!task) return;
    const storyLabel = (s: Story) => {
      const ref = (s as any).ref || (s as any).referenceNumber || (s as any).reference || s.id.slice(-6).toUpperCase();
      return `${ref} — ${s.title}`;
    };
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
    setStoryInput(linkedStory ? storyLabel(linkedStory) : '');
  }, [task, show, stories]);

  const storyLabel = (s: Story) => {
    const ref = (s as any).ref || (s as any).referenceNumber || (s as any).reference || s.id.slice(-6).toUpperCase();
    return `${ref} — ${s.title}`;
  };

  const resolveStorySelection = (value: string, finalize = false) => {
    const match = stories.find((s) => {
      const ref = (s as any).ref || (s as any).referenceNumber || (s as any).reference || '';
      return s.id === value || s.title === value || ref === value || storyLabel(s) === value;
    });
    if (match) {
      setForm((prev) => ({ ...prev, storyId: match.id, goalId: match.goalId || prev.goalId }));
      setStoryInput(storyLabel(match));
    } else if (finalize) {
      setForm((prev) => ({ ...prev, storyId: '' }));
    }
  };

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    const linkedStory = form.storyId ? stories.find((s) => s.id === form.storyId) : null;
    const effectiveGoalId = form.goalId || linkedStory?.goalId || null;
    const requiresGoal = ['chore', 'routine', 'habit'].includes(form.type);
    if (requiresGoal && !effectiveGoalId) {
      alert('Please link this habit/chores/routine to a goal before saving.');
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
      const originalDueDateMs = resolveTimestampMs((task as any).dueDate || (task as any).dueDateMs || (task as any).targetDate);
      const dueDateMs = form.dueDate ? new Date(`${form.dueDate}T00:00:00`).getTime() : null;
      const dueDateChanged = (originalDueDateMs ?? null) !== (dueDateMs ?? null);
      let nextSprintId = form.sprintId || null;
      if (dueDateChanged) {
        const matched = findSprintForDate(sprints, dueDateMs);
        nextSprintId = matched?.id ?? null;
      }
      const updates: any = {
        title: form.title.trim() || task.title,
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
        updatedAt: serverTimestamp(),
      };
      if (dueDateChanged) {
        updates.dueDateLocked = true;
        updates.dueDateReason = 'user';
      }
      if (form.storyId) {
        const linked = stories.find((s) => s.id === form.storyId);
        if (linked?.goalId) updates.goalId = linked.goalId;
        if ((linked as any)?.sprintId) updates.sprintId = (linked as any).sprintId;
      }
      const storySprintId = linkedStory?.sprintId || (linkedStory as any)?.sprintId || null;
      const resolvedGoalId = updates.goalId || linkedStory?.goalId || null;
      const resolvedGoal = resolvedGoalId ? goals.find((g) => g.id === resolvedGoalId) : null;
      const sprintForTag = (updates.sprintId || storySprintId)
        ? sprints.find((sprint) => sprint.id === (updates.sprintId || storySprintId))
        : null;
      const themeValue = (resolvedGoal as any)?.theme
        ?? (linkedStory as any)?.theme
        ?? (task as any)?.theme
        ?? (task as any)?.themeId
        ?? (task as any)?.theme_id
        ?? null;
      updates.tags = normalizeTaskTags({
        tags: updates.tags || [],
        type: updates.type,
        persona: updates.persona,
        sprint: sprintForTag || null,
        themeValue,
        goalRef: (resolvedGoal as any)?.ref || null,
        storyRef: (linkedStory as any)?.ref || null,
        themes: globalThemes,
      });
      await updateDoc(doc(db, 'tasks', task.id), updates);
      if (currentUser?.uid) {
        const sprintKey = (updates.sprintId || storySprintId || '') || '__none__';
        const statusValue = updates.status;
        const isDone = typeof statusValue === 'number'
          ? statusValue >= 2
          : String(statusValue || '').toLowerCase().includes('done') || String(statusValue || '').toLowerCase().includes('complete');
        const indexPayload: any = {
          id: task.id,
          ownerUid: currentUser.uid,
          persona: updates.persona || (task as any).persona || 'personal',
          sprintId: sprintKey,
          status: updates.status,
          isOpen: !isDone,
          dueDate: updates.dueDate ?? null,
          priority: updates.priority ?? null,
          title: updates.title,
          description: updates.description || null,
          goalId: updates.goalId || null,
          storyId: updates.storyId || null,
          parentType: updates.parentType || null,
          parentId: updates.parentId || null,
          tags: updates.tags || [],
          ref: (task as any).ref || (task as any).reference || null,
          updatedAt: Date.now(),
        };
        await setDoc(doc(db, 'sprint_task_index', task.id), indexPayload, { merge: true });
      }
      const prevPersona = (((task as any).persona) || 'personal') as 'personal' | 'work';
      const nextPersona = (updates.persona || prevPersona) as 'personal' | 'work';
      if (prevPersona !== nextPersona && currentUser?.uid) {
        try {
          await cascadeTaskPersona(currentUser.uid, task.id, nextPersona);
        } catch (err) {
          console.warn('Failed to cascade persona for task', err);
        }
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
        <Modal.Title>Edit Task</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {task ? (
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
                      <Form.Select
                        value={form.goalId || ''}
                        onChange={(e) => setForm({ ...form, goalId: e.target.value })}
                      >
                        <option value="">No goal</option>
                        {goals.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.title || g.id.slice(-6).toUpperCase()}
                          </option>
                        ))}
                      </Form.Select>
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
                        <div className="form-text">Habits, chores, and routines must be linked to a goal.</div>
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
                        placeholder="Search story by ref or title..."
                        value={storyInput}
                        onChange={(e) => {
                          const value = e.target.value;
                          setStoryInput(value);
                          resolveStorySelection(value);
                        }}
                        onBlur={(e) => resolveStorySelection(e.target.value, true)}
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
                {(task as Task).aiCriticalityScore != null && (
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
            <Col lg={4}>
              <ActivityStreamPanel
                entityId={task?.id}
                entityType="task"
                referenceNumber={(task as any)?.ref || (task as any)?.reference || (task as any)?.referenceNumber}
              />
            </Col>
          </Row>
        ) : null}
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
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default EditTaskModal;
