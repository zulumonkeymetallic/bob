import React, { useEffect, useMemo, useState } from 'react';
import { Card, Form, Button, Row, Col, Table, Badge } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { nextDueAt } from '../utils/recurrence';

interface ChoreForm {
  title: string;
  rrule: string;
  dtstart: string; // datetime-local
  estimatedMinutes: number;
  priority: number;
  theme?: number;
  goalId?: string;
}

const ChoresManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const [chores, setChores] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [form, setForm] = useState<ChoreForm>({ title: '', rrule: 'RRULE:FREQ=WEEKLY;INTERVAL=1', dtstart: '', estimatedMinutes: 15, priority: 2, theme: 2, goalId: '' });
  const todayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
    return `${y}${m}${dd}`;
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      const gq = query(collection(db, 'goals'), where('ownerUid','==', currentUser.uid));
      const gs = await getDocs(gq);
      setGoals(gs.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));

      const cq = query(collection(db, 'chores'), where('ownerUid','==', currentUser.uid));
      const cs = await getDocs(cq);
      setChores(cs.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    };
    load();
  }, [currentUser]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !form.title || !form.rrule) return;
    const dtstartMs = form.dtstart ? new Date(form.dtstart).getTime() : Date.now();
    const computed = nextDueAt(form.rrule, dtstartMs, Date.now());
    const payload = {
      title: form.title,
      rrule: form.rrule,
      dtstart: dtstartMs,
      estimatedMinutes: Number(form.estimatedMinutes) || 15,
      priority: Number(form.priority) || 2,
      theme: form.theme || 2,
      goalId: form.goalId || null,
      nextDueAt: computed || null,
      ownerUid: currentUser.uid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const ref = await addDoc(collection(db, 'chores'), payload);
    setChores([{ id: ref.id, ...payload }, ...chores]);
    setForm({ title: '', rrule: form.rrule, dtstart: '', estimatedMinutes: 15, priority: 2, theme: form.theme, goalId: '' });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this chore?')) return;
    await deleteDoc(doc(db, 'chores', id));
    setChores(chores.filter(c => c.id !== id));
  };

  const formatTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '—');

  return (
    <div className="container py-3" style={{ maxWidth: 980 }}>
      <h4 className="mb-3">Chores</h4>
      <Card className="mb-3">
        <Card.Body>
          <Form onSubmit={handleAdd}>
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Title</Form.Label>
                <Form.Control value={form.title} onChange={e=>setForm({ ...form, title: e.target.value })} placeholder="e.g., Wash car" />
              </Col>
              <Col md={4}>
                <Form.Label>RRULE</Form.Label>
                <Form.Control value={form.rrule} onChange={e=>setForm({ ...form, rrule: e.target.value })} placeholder="RRULE:FREQ=DAILY;INTERVAL=1" />
              </Col>
              <Col md={4}>
                <Form.Label>DTSTART</Form.Label>
                <Form.Control type="datetime-local" value={form.dtstart} onChange={e=>setForm({ ...form, dtstart: e.target.value })} />
              </Col>
            </Row>
            <Row className="g-3 mt-1">
              <Col md={3}>
                <Form.Label>Estimate (min)</Form.Label>
                <Form.Control type="number" value={form.estimatedMinutes} onChange={e=>setForm({ ...form, estimatedMinutes: Number(e.target.value) })} />
              </Col>
              <Col md={3}>
                <Form.Label>Priority</Form.Label>
                <Form.Select value={form.priority} onChange={e=>setForm({ ...form, priority: Number(e.target.value) })}>
                  <option value={1}>Low</option>
                  <option value={2}>Medium</option>
                  <option value={3}>High</option>
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label>Theme</Form.Label>
                <Form.Select value={form.theme} onChange={e=>setForm({ ...form, theme: Number(e.target.value) })}>
                  <option value={1}>Health</option>
                  <option value={2}>Growth</option>
                  <option value={3}>Wealth</option>
                  <option value={4}>Tribe</option>
                  <option value={5}>Home</option>
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label>Link Goal</Form.Label>
                <Form.Select value={form.goalId} onChange={e=>setForm({ ...form, goalId: e.target.value })}>
                  <option value="">(none)</option>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </Form.Select>
              </Col>
            </Row>
            <div className="mt-3">
              <Button type="submit">Add Chore</Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Table size="sm">
            <thead>
              <tr>
                <th>Title</th>
                <th>RRULE</th>
                <th>Next Due</th>
                <th>Estimate</th>
                <th>Priority</th>
                <th>Theme</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {chores.map(c => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td className="text-muted small" style={{maxWidth:320, overflow:'hidden', textOverflow:'ellipsis'}}>{c.rrule}</td>
                  <td>{formatTime(c.nextDueAt)}</td>
                  <td>{c.estimatedMinutes} min</td>
                  <td><Badge bg={c.priority>=3?'danger':c.priority===2?'warning':'secondary'}>{c.priority}</Badge></td>
                  <td><Badge bg="light" text="dark">{c.theme}</Badge></td>
                  <td className="text-end"><Button size="sm" variant="outline-danger" onClick={()=>handleDelete(c.id)}>Delete</Button></td>
                </tr>
              ))}
              {chores.length===0 && (
                <tr><td colSpan={7} className="text-muted">No chores yet</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default ChoresManagement;

