import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { doc, updateDoc, serverTimestamp, collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useSprint } from '../contexts/SprintContext';
import { Task, Sprint, Story } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { isStatus } from '../utils/statusHelpers';
import { normalizePriorityValue } from '../utils/priorityUtils';
import ActivityStreamPanel from './common/ActivityStreamPanel';

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
  const { currentUser } = useAuth();
  const { sprints } = useSprint();
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
  });
  const [storyInput, setStoryInput] = useState('');
  const [stories, setStories] = useState<Story[]>([]);
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

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsub = onSnapshot(q, (snap) => {
      setStories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[]);
    });
    return () => unsub();
  }, [currentUser?.uid]);

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
      setForm((prev) => ({ ...prev, storyId: match.id }));
      setStoryInput(storyLabel(match));
    } else if (finalize) {
      setForm((prev) => ({ ...prev, storyId: '' }));
    }
  };

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    try {
      const dueDateMs = form.dueDate ? new Date(`${form.dueDate}T00:00:00`).getTime() : null;
      const updates: any = {
        title: form.title.trim() || task.title,
        description: form.description,
        status: typeof form.status === 'string' ? Number(form.status) || form.status : form.status,
        priority: typeof form.priority === 'string' ? Number(form.priority) || form.priority : form.priority,
        points: Number(form.points) || 1,
        sprintId: form.sprintId || null,
        dueDate: dueDateMs,
        storyId: form.storyId || null,
        parentType: form.storyId ? 'story' : null,
        parentId: form.storyId || null,
        updatedAt: serverTimestamp(),
      };
      if (form.storyId) {
        const linked = stories.find((s) => s.id === form.storyId);
        if (linked?.goalId) updates.goalId = linked.goalId;
        if (!updates.sprintId && (linked as any)?.sprintId) updates.sprintId = (linked as any).sprintId;
      }
      await updateDoc(doc(db, 'tasks', task.id), updates);
      onUpdated?.();
      onHide();
    } catch (error) {
      console.error('Failed to update task', error);
      alert('Failed to update task. Please try again.');
    } finally {
      setSaving(false);
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
                  <Col md={8}>
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
                    {(task as Task).aiCriticalityReason && (
                      <div className="small text-muted">{(task as Task).aiCriticalityReason}</div>
                    )}
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
