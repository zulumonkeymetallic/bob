import React, { useEffect, useMemo, useState } from 'react';
import { Card, Form, Button, Row, Col, Table, Badge, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { db } from '../firebase';
import { addDoc, collection, deleteDoc, doc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { nextDueAt } from '../utils/recurrence';

interface ChoreForm {
  title: string;
  rrule: string;
  dtstart: string; // datetime-local
  estimatedMinutes: number;
  priority: number;
  theme?: number;
  goalId?: string;
  requiredBlock?: string;
}

const ChoresManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const [chores, setChores] = useState<any[]>([]);
  const [goals, setGoals] = useState<any[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  // Filters & search
  const [search, setSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState<'all'|1|2|3>('all');
  const [filterTheme, setFilterTheme] = useState<'all'|1|2|3|4|5>('all');
  const [filterDue, setFilterDue] = useState<'today'|'week'|'all'>('all');
  const [form, setForm] = useState<ChoreForm>({ title: '', rrule: 'RRULE:FREQ=WEEKLY;INTERVAL=1', dtstart: '', estimatedMinutes: 60, priority: 2, theme: 2, goalId: '', requiredBlock: '' });
  const [rrulePreview, setRrulePreview] = useState<string>('RRULE:FREQ=WEEKLY;INTERVAL=1');
  const [nextPreview, setNextPreview] = useState<number | null>(null);
  const [planning, setPlanning] = useState(false);
  const [planMsg, setPlanMsg] = useState<string>('');
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
      const bq = query(collection(db, 'blocks'), where('ownerUid','==', currentUser.uid));
      const bs = await getDocs(bq);
      setBlocks(bs.docs.map(d => ({ id: d.id, ...(d.data()||{}) })));
    };
    load();
  }, [currentUser]);

  // Live next due preview when editing RRULE/DTSTART
  useEffect(() => {
    const dtstartMs = form.dtstart ? new Date(form.dtstart).getTime() : undefined;
    const n = nextDueAt(form.rrule, dtstartMs, Date.now());
    setNextPreview(n);
  }, [form.rrule, form.dtstart]);

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
      requiredBlock: (form.requiredBlock || '').trim() || null,
      nextDueAt: computed || null,
      ownerUid: currentUser.uid,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const ref = await addDoc(collection(db, 'chores'), payload);
    setChores([{ id: ref.id, ...payload }, ...chores]);
    setForm({ title: '', rrule: form.rrule, dtstart: '', estimatedMinutes: 60, priority: 2, theme: form.theme, goalId: '', requiredBlock: form.requiredBlock });
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this chore?')) return;
    await deleteDoc(doc(db, 'chores', id));
    setChores(chores.filter(c => c.id !== id));
  };

  const markDone = async (c: any) => {
    const from = Math.max(Date.now(), (c.nextDueAt || Date.now()) + 1);
    const next = nextDueAt(c.rrule, c.dtstart, from);
    await updateDoc(doc(db, 'chores', c.id), { nextDueAt: next || null, lastDoneAt: Date.now(), updatedAt: Date.now() });
    setChores(prev => prev.map(x => x.id === c.id ? { ...x, nextDueAt: next || null, lastDoneAt: Date.now(), updatedAt: Date.now() } : x));
  };

  const formatTime = (ms?: number) => (ms ? new Date(ms).toLocaleString() : '—');
  // Compute filtered view with due window
  const sod = useMemo(()=>{ const d=new Date(); d.setHours(0,0,0,0); return d.getTime(); },[]);
  const eod = useMemo(()=>{ const d=new Date(); d.setHours(23,59,59,999); return d.getTime(); },[]);
  const sow = useMemo(()=>{ const d=new Date(); const day=d.getDay(); const diff=d.getDate()-day+(day===0?-6:1); d.setDate(diff); d.setHours(0,0,0,0); return d.getTime(); },[]);
  const eow = useMemo(()=> sow + 7*24*60*60*1000 - 1, [sow]);
  const filtered = useMemo(()=>{
    const now = Date.now();
    return chores.filter(c => {
      if (search && !(c.title||'').toLowerCase().includes(search.toLowerCase())) return false;
      if (filterPriority !== 'all' && Number(c.priority)!==Number(filterPriority)) return false;
      if (filterTheme !== 'all' && Number(c.theme)!==Number(filterTheme)) return false;
      if (filterDue !== 'all') {
        const due = nextDueAt(c.rrule, c.dtstart, now);
        if (!due) return false;
        if (filterDue==='today' && !(due>=sod && due<=eod)) return false;
        if (filterDue==='week' && !(due>=sow && due<=eow)) return false;
      }
      return true;
    });
  }, [chores, search, filterPriority, filterTheme, filterDue, sod, eod, sow, eow]);

  // Counts
  const counts = useMemo(()=>{
   const total = chores.length;
   const dueToday = chores.filter(c => { const due = nextDueAt(c.rrule, c.dtstart, Date.now()); return !!due && due>=sod && due<=eod; }).length;
   const high = chores.filter(c => Number(c.priority)===3).length;
   return { total, dueToday, high };
  }, [chores, sod, eod]);

  const runRoutinesPlanner = async () => {
    if (!currentUser) return;
    try {
      setPlanning(true);
      setPlanMsg('');
      const callable = httpsCallable(functions, 'planRoutines');
      const today = new Date();
      const day = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const res: any = await callable({ day, includeHabits: true, includeChores: true, apply: true, persona: 'personal' });
      setPlanMsg(`Planned ${res?.data?.created || 0} routine blocks for ${res?.data?.day}.`);
    } catch (e:any) {
      setPlanMsg(`Planner failed: ${e?.message || 'unknown error'}`);
    } finally {
      setPlanning(false);
      setTimeout(()=>setPlanMsg(''), 5000);
    }
  };

  return (
    <div className="container py-3" style={{ maxWidth: 1100 }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h2 className="mb-1">Chores</h2>
          <p className="text-muted mb-0">Recurring routines with RRULE scheduling and calendar integration</p>
        </div>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" onClick={runRoutinesPlanner} disabled={planning}>{planning ? 'Planning…' : "Plan Today's Routines"}</Button>
        </div>
      </div>

      {/* Dashboard Cards */}
      <Row className="mb-3">
        <Col lg={4} md={6} className="mb-3"><Card className="h-100"><Card.Body className="text-center"><h3 className="mb-0">{counts.total}</h3><div className="text-muted">Total Chores</div></Card.Body></Card></Col>
        <Col lg={4} md={6} className="mb-3"><Card className="h-100"><Card.Body className="text-center"><h3 className="mb-0">{counts.dueToday}</h3><div className="text-muted">Due Today</div></Card.Body></Card></Col>
        <Col lg={4} md={6} className="mb-3"><Card className="h-100"><Card.Body className="text-center"><h3 className="mb-0">{counts.high}</h3><div className="text-muted">High Priority</div></Card.Body></Card></Col>
      </Row>

      {/* Filters */}
      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3">
            <Col md={4}>
              <Form.Label>Search</Form.Label>
              <InputGroup>
                <Form.Control value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search chores by title" />
                {search && <Button variant="outline-secondary" onClick={()=>setSearch('')}>Clear</Button>}
              </InputGroup>
            </Col>
            <Col md={3}>
              <Form.Label>Due</Form.Label>
              <Form.Select value={filterDue} onChange={(e)=>setFilterDue(e.target.value as any)}>
                <option value="all">All</option>
                <option value="today">Today</option>
                <option value="week">This Week</option>
              </Form.Select>
            </Col>
            <Col md={3}>
              <Form.Label>Priority</Form.Label>
              <Form.Select value={String(filterPriority)} onChange={(e)=> setFilterPriority((e.target.value==='all'?'all': Number(e.target.value)) as any)}>
                <option value="all">All</option>
                <option value="3">High (3)</option>
                <option value="2">Medium (2)</option>
                <option value="1">Low (1)</option>
              </Form.Select>
            </Col>
            <Col md={2}>
              <Form.Label>Theme</Form.Label>
              <Form.Select value={String(filterTheme)} onChange={(e)=> setFilterTheme((e.target.value==='all'?'all': Number(e.target.value)) as any)}>
                <option value="all">All</option>
                <option value="1">Health</option>
                <option value="2">Growth</option>
                <option value="3">Wealth</option>
                <option value="4">Tribe</option>
                <option value="5">Home</option>
              </Form.Select>
            </Col>
          </Row>
        </Card.Body>
      </Card>
      <Card className="mb-3">
        <Card.Header>AI Routine Planner</Card.Header>
        <Card.Body>
          <div className="d-flex align-items-center gap-2">
            <Button onClick={runRoutinesPlanner} disabled={planning}>{planning ? 'Planning…' : 'Plan Today\'s Routines'}</Button>
            {planMsg && <span className="text-muted">{planMsg}</span>}
          </div>
          <small className="text-muted d-block mt-2">Creates proposed calendar blocks for today\'s due chores and scheduled habits.</small>
        </Card.Body>
      </Card>

      <Card className="mb-3">
        <Card.Header><strong>Add Chore</strong></Card.Header>
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
                <div className="form-text">Next due: {nextPreview ? new Date(nextPreview).toLocaleString() : '—'}</div>
              </Col>
              <Col md={4}>
                <Form.Label>DTSTART</Form.Label>
                <Form.Control type="datetime-local" value={form.dtstart} onChange={e=>setForm({ ...form, dtstart: e.target.value })} />
              </Col>
            </Row>
            <Row className="g-3 mt-1">
              <Col md={4}>
                <Form.Label>Required Block</Form.Label>
                <Form.Select value={form.requiredBlock || ''} onChange={e=>setForm({ ...form, requiredBlock: e.target.value })}>
                  <option value="">Any eligible block</option>
                  {blocks.map(b => <option key={b.id} value={b.name}>{b.name}</option>)}
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Duration (min)</Form.Label>
                <Form.Control type="number" value={form.estimatedMinutes} onChange={e=>setForm({ ...form, estimatedMinutes: Number(e.target.value)||60 })} />
              </Col>
            </Row>
            <Row className="g-3 mt-1">
              <Col md={4}>
                <Form.Label>Frequency</Form.Label>
                <Form.Select
                  value={/FREQ=([^;]+)/.exec(form.rrule)?.[1] || 'WEEKLY'}
                  onChange={(e)=>{
                    const freq = e.target.value.toUpperCase();
                    const replaced = form.rrule.replace(/FREQ=([^;]+)/, `FREQ=${freq}`);
                    const next = /FREQ=/.test(replaced) ? replaced : `RRULE:FREQ=${freq};INTERVAL=1`;
                    setForm({ ...form, rrule: next });
                  }}
                >
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Interval</Form.Label>
                <Form.Control
                  type="number"
                  min={1}
                  value={Number(/INTERVAL=([0-9]+)/.exec(form.rrule)?.[1] || 1)}
                  onChange={(e)=>{
                    const val = Math.max(1, Number(e.target.value)||1);
                    if (/INTERVAL=/.test(form.rrule)) {
                      setForm({ ...form, rrule: form.rrule.replace(/INTERVAL=([0-9]+)/, `INTERVAL=${val}`) });
                    } else {
                      setForm({ ...form, rrule: `${form.rrule};INTERVAL=${val}` });
                    }
                  }}
                />
              </Col>
              {(/FREQ=WEEKLY/.test(form.rrule)) && (
                <Col md={4}>
                  <Form.Label>By weekday</Form.Label>
                  <div className="d-flex flex-wrap gap-2">
                    {[
                      { label: 'MO', token: 'MO' },
                      { label: 'TU', token: 'TU' },
                      { label: 'WE', token: 'WE' },
                      { label: 'TH', token: 'TH' },
                      { label: 'FR', token: 'FR' },
                      { label: 'SA', token: 'SA' },
                      { label: 'SU', token: 'SU' },
                    ].map(d => {
                      const bym = /BYDAY=([^;]+)/.exec(form.rrule)?.[1] || '';
                      const parts = bym ? bym.split(',') : [];
                      const active = parts.includes(d.token);
                      return (
                        <Button
                          key={d.token}
                          size="sm"
                          variant={active ? 'primary' : 'outline-secondary'}
                          onClick={() => {
                            const next = active ? parts.filter(p => p!==d.token) : [...parts, d.token];
                            const nextStr = next.join(',');
                            if (/BYDAY=/.test(form.rrule)) {
                              const replaced = form.rrule.replace(/BYDAY=([^;]+)/, `BYDAY=${nextStr}`);
                              setForm({ ...form, rrule: replaced });
                            } else {
                              setForm({ ...form, rrule: `${form.rrule};BYDAY=${nextStr}` });
                            }
                          }}
                        >{d.label}</Button>
                      );
                    })}
                  </div>
                </Col>
              )}
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
                <th>Block</th>
                <th>Priority</th>
                <th>Theme</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td className="text-muted small" style={{maxWidth:320, overflow:'hidden', textOverflow:'ellipsis'}}>{c.rrule}</td>
                  <td>{formatTime(c.nextDueAt)}</td>
                  <td>{c.estimatedMinutes} min</td>
                  <td className="text-muted">{c.requiredBlock || '—'}</td>
                  <td><Badge bg={c.priority>=3?'danger':c.priority===2?'warning':'secondary'}>{c.priority}</Badge></td>
                  <td><Badge bg="light" text="dark">{c.theme}</Badge></td>
                  <td className="text-end">
                    <Button size="sm" className="me-2" variant="outline-success" onClick={()=>markDone(c)}>Mark Done</Button>
                    <Button size="sm" variant="outline-danger" onClick={()=>handleDelete(c.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
              {filtered.length===0 && (
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
