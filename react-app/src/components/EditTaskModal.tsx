import React, { useEffect, useState } from 'react';
import { Modal, Button, Form, Row, Col } from 'react-bootstrap';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useSprint } from '../contexts/SprintContext';
import { Task, Sprint } from '../types';
import { isStatus } from '../utils/statusHelpers';
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

const normalizeTaskPriority = (priority: any) => {
  if (typeof priority === 'number') return priority;
  const value = String(priority || '').toLowerCase();
  if (value.includes('high')) return 1;
  if (value.includes('low')) return 3;
  return 2;
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
  const { sprints } = useSprint();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: '',
    description: '',
    status: 0 as number | string,
    priority: 2 as number | string,
    sprintId: '' as string,
  });
  const visibleSprints = sprints.filter((sprint) => !isHiddenSprint(sprint));
  const selectedSprint = form.sprintId ? sprints.find((sprint) => sprint.id === form.sprintId) : null;
  const selectedSprintStatus = selectedSprint
    ? (isStatus(selectedSprint.status, 'closed') ? 'Completed' : (isStatus(selectedSprint.status, 'cancelled') ? 'Cancelled' : ''))
    : '';

  useEffect(() => {
    if (!task) return;
    setForm({
      title: task.title || '',
      description: (task as any).description || '',
      status: normalizeTaskStatus((task as any).status),
      priority: normalizeTaskPriority((task as any).priority),
      sprintId: (task as any).sprintId || '',
    });
  }, [task, show]);

  const handleSave = async () => {
    if (!task) return;
    setSaving(true);
    try {
      const updates: any = {
        title: form.title.trim() || task.title,
        description: form.description,
        status: typeof form.status === 'string' ? Number(form.status) || form.status : form.status,
        priority: typeof form.priority === 'string' ? Number(form.priority) || form.priority : form.priority,
        sprintId: form.sprintId || null,
        updatedAt: serverTimestamp(),
      };
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
                        <option value={1}>High</option>
                        <option value={2}>Medium</option>
                        <option value={3}>Low</option>
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
