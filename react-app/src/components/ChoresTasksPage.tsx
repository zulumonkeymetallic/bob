import React, { useEffect, useMemo, useState } from 'react';
import { Card, Button, Table, Modal, Form, Row, Col, Badge, Alert } from 'react-bootstrap';
import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { format, formatDistanceToNow } from 'date-fns';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';

type TaskType = 'chore' | 'routine';

interface TaskRow {
  id: string;
  ownerUid: string;
  persona?: 'personal' | 'work';
  title: string;
  status?: number;
  type?: TaskType | string;
  repeatFrequency?: string | null;
  repeatInterval?: number | null;
  daysOfWeek?: string[] | null;
  lastDoneAt?: any;
  tags?: string[];
  createdAt?: any;
  updatedAt?: any;
}

const typeOptions: TaskType[] = ['chore', 'routine'];
const freqOptions = ['daily','weekly','monthly','yearly'];

const prettyFreq = (t: TaskRow) => {
  const f = (t.repeatFrequency || '').toString();
  const i = Number(t.repeatInterval || 1) || 1;
  if (!f) return '—';
  if (f === 'weekly') {
    const d = Array.isArray(t.daysOfWeek) ? t.daysOfWeek : [];
    return `Weekly (${d.join(', ') || '—'})${i>1?` x${i}`:''}`;
  }
  return `${f}${i>1?` x${i}`:''}`;
};

const ChoresTasksPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'danger' | 'info'; message: string } | null>(null);

  // Form state
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TaskRow | null>(null);
  const [form, setForm] = useState<{ title: string; type: TaskType; repeatFrequency: string; repeatInterval: number; daysOfWeek: string; tags: string }>(
    { title: '', type: 'chore', repeatFrequency: 'weekly', repeatInterval: 1, daysOfWeek: 'mon,tue,wed,thu,fri', tags: '' }
  );

  useEffect(() => {
    if (!currentUser) { setRows([]); return; }
    setLoading(true);
    // status!=2 filter handled client-side to avoid compound index overhead here
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('type', 'in', ['chore','routine'] as any),
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as TaskRow[];
      const filtered = list.filter((r) => Number(r.status || 0) !== 2)
        .filter((r) => !currentPersona || !r.persona || r.persona === currentPersona);
      filtered.sort((a, b) => {
        const au = (a.updatedAt && (a.updatedAt as any).toDate ? (a.updatedAt as any).toDate().getTime() : (a.updatedAt as any)) || 0;
        const bu = (b.updatedAt && (b.updatedAt as any).toDate ? (b.updatedAt as any).toDate().getTime() : (b.updatedAt as any)) || 0;
        return bu - au;
      });
      setRows(filtered);
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, [currentUser, currentPersona]);

  const openCreate = () => {
    setEditing(null);
    setForm({ title: '', type: 'chore', repeatFrequency: 'weekly', repeatInterval: 1, daysOfWeek: 'mon,tue,wed,thu,fri', tags: '' });
    setShowModal(true);
  };
  const openEdit = (row: TaskRow) => {
    setEditing(row);
    const days = Array.isArray(row.daysOfWeek) ? row.daysOfWeek.join(',') : '';
    setForm({
      title: row.title || '',
      type: (row.type as TaskType) || 'chore',
      repeatFrequency: row.repeatFrequency || 'weekly',
      repeatInterval: Number(row.repeatInterval || 1) || 1,
      daysOfWeek: days,
      tags: Array.isArray(row.tags) ? row.tags.join(',') : ''
    });
    setShowModal(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    try {
      const days = form.daysOfWeek
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const payload: Partial<TaskRow> = {
        ownerUid: currentUser.uid,
        persona: currentPersona || 'personal',
        title: form.title.trim(),
        type: form.type,
        status: 0,
        repeatFrequency: form.repeatFrequency,
        repeatInterval: Math.max(1, Math.min(365, Number(form.repeatInterval) || 1)),
        daysOfWeek: form.repeatFrequency === 'weekly' ? days : null,
        tags: form.tags ? form.tags.split(',').map((s)=>s.trim()).filter(Boolean) : [],
        updatedAt: serverTimestamp() as any,
        createdAt: serverTimestamp() as any,
      };
      if (editing) {
        await setDoc(doc(db, 'tasks', editing.id), payload, { merge: true });
      } else {
        await addDoc(collection(db, 'tasks'), payload);
      }
      setShowModal(false);
      setEditing(null);
      setFeedback({ variant: 'success', message: 'Saved' });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Failed to save' });
    }
  };

  const markDone = async (row: TaskRow) => {
    try {
      const callable = httpsCallable(functions, 'completeChoreTask');
      await callable({ taskId: row.id });
      setFeedback({ variant: 'success', message: 'Marked done' });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Failed to mark done' });
    }
  };

  const snooze = async (row: TaskRow, days = 1) => {
    try {
      const callable = httpsCallable(functions, 'snoozeChoreTask');
      await callable({ taskId: row.id, days });
      setFeedback({ variant: 'info', message: `Snoozed ${days} day(s)` });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Failed to snooze' });
    }
  };

  return (
    <div className="container py-3" style={{ maxWidth: 1100 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0">Chores & Recurring Tasks</h4>
        <div className="d-flex gap-2">
          <Button variant="primary" onClick={openCreate}>Add</Button>
        </div>
      </div>
      {feedback && (
        <Alert variant={feedback.variant} onClose={()=>setFeedback(null)} dismissible>
          {feedback.message}
        </Alert>
      )}
      <Card>
        <Card.Body>
          <Table hover responsive size="sm">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Frequency</th>
                <th>Last Done</th>
                <th>Tags</th>
                <th style={{width: 240}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const last = r.lastDoneAt ? new Date((r.lastDoneAt as any).toDate ? (r.lastDoneAt as any).toDate() : (r.lastDoneAt as any)).getTime() : null;
                const lastLabel = last ? formatDistanceToNow(new Date(last), { addSuffix: true }) : '—';
                return (
                  <tr key={r.id}>
                    <td>{r.title || '—'}</td>
                    <td><Badge bg={String(r.type||'').toLowerCase()==='routine'?'info':'secondary'}>{r.type||'—'}</Badge></td>
                    <td title={Array.isArray(r.daysOfWeek)?r.daysOfWeek.join(', '):undefined}>{prettyFreq(r)}</td>
                    <td>{lastLabel}</td>
                    <td>{Array.isArray(r.tags) ? r.tags.join(', ') : '—'}</td>
                    <td>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-success" onClick={()=>markDone(r)}>Done</Button>
                        <Button size="sm" variant="outline-warning" onClick={()=>snooze(r, 1)}>Snooze</Button>
                        <Button size="sm" variant="outline-secondary" onClick={()=>openEdit(r)}>Edit</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-muted">No chores or routines yet</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Modal show={showModal} onHide={()=>setShowModal(false)}>
        <Form onSubmit={save}>
          <Modal.Header closeButton>
            <Modal.Title>{editing ? 'Edit' : 'Add'} Recurring Task</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>Title</Form.Label>
                <Form.Control value={form.title} onChange={(e)=>setForm({ ...form, title: e.target.value })} required />
              </Col>
              <Col md={4}>
                <Form.Label>Type</Form.Label>
                <Form.Select value={form.type} onChange={(e)=>setForm({ ...form, type: e.target.value as TaskType })}>
                  {typeOptions.map((t)=> <option key={t} value={t}>{t}</option>)}
                </Form.Select>
              </Col>
              <Col md={5}>
                <Form.Label>Frequency</Form.Label>
                <Form.Select value={form.repeatFrequency} onChange={(e)=>setForm({ ...form, repeatFrequency: e.target.value })}>
                  {freqOptions.map((f)=> <option key={f} value={f}>{f}</option>)}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label>Interval</Form.Label>
                <Form.Control type="number" min={1} max={365} value={form.repeatInterval} onChange={(e)=>setForm({ ...form, repeatInterval: Number(e.target.value) })} />
              </Col>
              <Col md={12}>
                <Form.Label>Days (weekly: mon,tue,…)</Form.Label>
                <Form.Control placeholder="mon,tue,wed" value={form.daysOfWeek} onChange={(e)=>setForm({ ...form, daysOfWeek: e.target.value })} />
              </Col>
              <Col md={12}>
                <Form.Label>Tags</Form.Label>
                <Form.Control placeholder="kitchen, cleanup" value={form.tags} onChange={(e)=>setForm({ ...form, tags: e.target.value })} />
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">{editing ? 'Save' : 'Create'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

    </div>
  );
};

export default ChoresTasksPage;
