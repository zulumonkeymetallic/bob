import React, { useEffect, useMemo, useState } from 'react';
import { Card, Form, Button, Row, Col, Table, Badge, Alert } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';

const HabitsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const [habits, setHabits] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ name: '', description: '', frequency: 'daily', targetValue: 1, unit: 'times', scheduleTime: '07:00', linkedGoalId: '', isActive: true, daysOfWeek: [] as number[], daysText: '' });
  const [goals, setGoals] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const dayKey = useMemo(() => {
    const d = new Date();
    const y = d.getFullYear(); const m = String(d.getMonth()+1).padStart(2,'0'); const dd = String(d.getDate()).padStart(2,'0');
    return `${y}${m}${dd}`;
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const qh = query(collection(db, 'habits'), where('ownerUid','==', currentUser.uid));
    const unsub = onSnapshot(qh, (snap) => {
      setHabits(snap.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    });
    (async ()=>{
      const gs = await getDocs(query(collection(db,'goals'), where('ownerUid','==', currentUser.uid)));
      setGoals(gs.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    })();
    return () => unsub();
  }, [currentUser]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !form.name) return;
    if (!form.linkedGoalId) {
      setError('Please link a goal for every habit.');
      return;
    }
    setError(null);
    const parseDays = (text: string) => {
      if (!text) return [] as number[];
      try {
        return text.split(',').map(s=>Number(s.trim())).filter(n=>!isNaN(n) && n>=0 && n<=6);
      } catch { return []; }
    };
    const payload = {
      name: form.name,
      description: form.description || '',
      frequency: form.frequency,
      targetValue: Number(form.targetValue)||1,
      unit: form.unit||'times',
      scheduleTime: form.scheduleTime||'07:00',
      linkedGoalId: form.linkedGoalId || null,
      linkedGoalName: goals.find(g=>g.id===form.linkedGoalId)?.title || null,
      daysOfWeek: Array.isArray(form.daysOfWeek) && form.daysOfWeek.length ? form.daysOfWeek : parseDays(form.daysText || ''),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isActive: !!form.isActive,
      ownerUid: currentUser.uid,
    };
    const ref = await addDoc(collection(db, 'habits'), payload);
    setForm({ name:'', description:'', frequency:'daily', targetValue:1, unit:'times', scheduleTime:'07:00', linkedGoalId:'', isActive:true, daysOfWeek: [], daysText: '' });
  };

  const toggleCompleteToday = async (habit: any) => {
    if (!currentUser) return;
    const entryId = dayKey; // use day key as entry id
    const ref = doc(db, `habits/${habit.id}/habitEntries/${entryId}`);
    await setDoc(ref, {
      id: entryId,
      habitId: habit.id,
      ownerUid: currentUser.uid,
      date: new Date().setHours(0,0,0,0),
      value: 1,
      isCompleted: true,
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }, { merge: true });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this habit?')) return;
    await deleteDoc(doc(db, 'habits', id));
  };

  return (
    <div className="container py-3" style={{ maxWidth: 980 }}>
      <h4 className="mb-3">Habits</h4>
      {error && (
        <Alert variant="warning" onClose={() => setError(null)} dismissible>
          {error}
        </Alert>
      )}
      <Card className="mb-3">
        <Card.Body>
          <Form onSubmit={handleAdd}>
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Name</Form.Label>
                <Form.Control value={form.name} onChange={e=>setForm({ ...form, name: e.target.value })} placeholder="e.g., Journal" />
              </Col>
              <Col md={4}>
                <Form.Label>Frequency</Form.Label>
                <Form.Select value={form.frequency} onChange={e=>setForm({ ...form, frequency: e.target.value })}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Time</Form.Label>
                <Form.Control type="time" value={form.scheduleTime} onChange={e=>setForm({ ...form, scheduleTime: e.target.value })} />
              </Col>
            </Row>
            <Row className="g-3 mt-1">
              <Col md={3}>
                <Form.Label>Target</Form.Label>
                <Form.Control type="number" value={form.targetValue} onChange={e=>setForm({ ...form, targetValue: Number(e.target.value) })} />
              </Col>
              <Col md={3}>
                <Form.Label>Unit</Form.Label>
                <Form.Control value={form.unit} onChange={e=>setForm({ ...form, unit: e.target.value })} />
              </Col>
              <Col md={3}>
                <Form.Label>Link Goal (required)</Form.Label>
                <Form.Select value={form.linkedGoalId} onChange={e=>setForm({ ...form, linkedGoalId: e.target.value })}>
                  <option value="">Select a goal...</option>
                  {goals.map(g => <option key={g.id} value={g.id}>{g.title}</option>)}
                </Form.Select>
              </Col>
              <Col md={3}>
                <Form.Label>Active</Form.Label>
                <Form.Check type="switch" checked={form.isActive} onChange={e=>setForm({ ...form, isActive: e.target.checked })} />
              </Col>
            </Row>
            {form.frequency === 'weekly' && (
              <Row className="g-3 mt-1">
                <Col md={12}>
                  <Form.Label>Days of Week</Form.Label>
                  <div className="d-flex flex-wrap gap-3">
                    {[
                      { label: 'Mon', val: 1 },
                      { label: 'Tue', val: 2 },
                      { label: 'Wed', val: 3 },
                      { label: 'Thu', val: 4 },
                      { label: 'Fri', val: 5 },
                      { label: 'Sat', val: 6 },
                      { label: 'Sun', val: 0 },
                    ].map(d => (
                      <Form.Check
                        key={d.val}
                        inline
                        type="checkbox"
                        id={`dow-${d.val}`}
                        label={d.label}
                        checked={form.daysOfWeek?.includes(d.val)}
                        onChange={(e) => {
                          const exists = form.daysOfWeek?.includes(d.val);
                          const next = exists
                            ? form.daysOfWeek.filter((x:number) => x!==d.val)
                            : [...(form.daysOfWeek||[]), d.val].sort((a:number,b:number)=>a-b);
                          setForm({ ...form, daysOfWeek: next });
                        }}
                      />
                    ))}
                  </div>
                  <div className="form-text">Optional: CSV fallback (0=Sun,…,6=Sat)</div>
                  <Form.Control
                    placeholder="e.g., 1,3,5"
                    value={form.daysText}
                    onChange={(e)=>setForm({ ...form, daysText: e.target.value })}
                  />
                </Col>
              </Row>
            )}
            <div className="mt-3">
              <Button type="submit" disabled={!form.linkedGoalId}>Add Habit</Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <Card>
        <Card.Body>
          <Table size="sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Frequency</th>
                <th>Time</th>
                <th>Goal</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {habits.map(h => (
                <tr key={h.id}>
                  <td>{h.name}</td>
                  <td>{h.frequency}</td>
                  <td>{h.scheduleTime || '—'}</td>
                  <td>{h.linkedGoalId ? (goals.find(g=>g.id===h.linkedGoalId)?.title || h.linkedGoalId) : <Badge bg="warning">Missing</Badge>}</td>
                  <td>{h.isActive ? <Badge bg="success">On</Badge> : <Badge bg="secondary">Off</Badge>}</td>
                  <td className="text-end">
                    <Button size="sm" className="me-2" variant="outline-success" onClick={()=>toggleCompleteToday(h)}>Mark Done Today</Button>
                    <Button size="sm" variant="outline-danger" onClick={()=>handleDelete(h.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {habits.length===0 && <tr><td colSpan={6} className="text-muted">No habits yet</td></tr>}
            </tbody>
          </Table>
        </Card.Body>
      </Card>
    </div>
  );
};

export default HabitsManagement;
