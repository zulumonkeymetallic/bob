import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, query, where } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Block } from '../types';
import { Button, Card, Col, Container, Form, Modal, Row, Table, Alert, Badge, ButtonGroup } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';

type DraftBlock = Omit<Block, 'id' | 'ownerUid'> & { id?: string };

const defaultDraft = (): DraftBlock => ({
  name: '',
  color: '#0ea5e9',
  description: '',
  rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  windows: [{ start: '09:00', end: '12:00' }],
  minDuration: 15,
  maxDuration: 120,
  dailyCapacity: 180,
  priority: 5,
  buffers: { beforeMin: 5, afterMin: 5 },
  enabled: true,
  constraints: { location: 'any', quietHours: [] },
  disabledDates: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

function overlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

function hhmmToMin(s: string) {
  const [h, m] = String(s || '00:00').split(':').map(n => Number(n));
  return (isFinite(h) ? h : 0) * 60 + (isFinite(m) ? m : 0);
}

const WeeklyOverlay: React.FC<{ block: DraftBlock }> = ({ block }) => {
  const hourMarks = Array.from({ length: 24 }, (_, i) => i);
  const pxPerMin = 0.5; // 60 min = 30px
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <div className="border rounded p-2" style={{ overflowX: 'auto' }}>
      <div className="d-flex" style={{ minWidth: 720 }}>
        {Array.from({ length: 7 }, (_, i) => i).map((day) => (
          <div key={day} className="flex-grow-1 border-end px-2" style={{ position: 'relative', width: 140 }}>
            <div className="text-center small text-muted mb-1">{dayNames[day]}</div>
            <div style={{ position: 'relative', height: 24 * 60 * pxPerMin }}>
              {hourMarks.map(h => (
                <div key={h} style={{ position: 'absolute', top: h * 60 * pxPerMin, left: 0, right: 0, borderTop: '1px dashed #eee' }} />
              ))}
              {block.windows.map((w, idx) => {
                const days = w.days && w.days.length ? w.days : undefined;
                if (days && !days.includes(day)) return null;
                const s = hhmmToMin(w.start) * pxPerMin;
                const e = hhmmToMin(w.end) * pxPerMin;
                const height = Math.max(e - s, 6);
                return (
                  <div key={idx} title={`${w.start} - ${w.end}`}
                    style={{ position: 'absolute', top: s, left: 4, right: 4, height, background: block.color || '#0ea5e9', opacity: 0.25, borderRadius: 6 }} />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const BlocksManager: React.FC = () => {
  const { currentUser } = useAuth();
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState<DraftBlock>(defaultDraft());
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [schedulePreview, setSchedulePreview] = useState<any | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(collection(db, 'blocks'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Block[];
      setBlocks(list.sort((a,b) => (b.priority||0) - (a.priority||0)));
    });
    return () => unsub();
  }, [currentUser]);

  const hasWindowConflicts = useMemo(() => {
    const mins = draft.windows.map(w => ({ s: hhmmToMin(w.start), e: hhmmToMin(w.end), days: w.days?.slice().sort() || ['*'] }));
    for (let i = 0; i < mins.length; i++) {
      for (let j = i + 1; j < mins.length; j++) {
        const a = mins[i]; const b = mins[j];
        const dayOverlap = (a.days === b.days) || (Array.isArray(a.days) && Array.isArray(b.days) && a.days.some(d => (b.days as any).includes(d))) || (a.days === ['*'] || b.days === ['*']);
        if (dayOverlap && overlap(a.s, a.e, b.s, b.e)) return true;
      }
    }
    return false;
  }, [draft.windows]);

  const openCreate = () => {
    setDraft(defaultDraft());
    setError(null);
    setSuccess(null);
    setShowModal(true);
  };
  const openEdit = (b: Block) => {
    setDraft({ ...b });
    setError(null);
    setSuccess(null);
    setShowModal(true);
  };

  const save = async () => {
    if (!currentUser) return;
    if (!draft.name.trim()) { setError('Name is required'); return; }
    if (!draft.windows || draft.windows.length === 0) { setError('At least one time window is required'); return; }
    setSaving(true);
    try {
      const payload: Omit<Block, 'id'> = {
        ownerUid: currentUser.uid,
        name: draft.name.trim(),
        color: draft.color || '#0ea5e9',
        description: draft.description || '',
        rrule: draft.rrule || '',
        windows: draft.windows.map(w => ({ start: w.start, end: w.end, days: w.days && w.days.length ? w.days : undefined })),
        minDuration: draft.minDuration || 0,
        maxDuration: draft.maxDuration || 0,
        dailyCapacity: draft.dailyCapacity || 0,
        priority: draft.priority || 0,
        buffers: draft.buffers || {},
        enabled: !!draft.enabled,
        constraints: draft.constraints || { location: 'any' },
        disabledDates: draft.disabledDates || [],
        createdAt: draft.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      if (draft.id) {
        await updateDoc(doc(db, 'blocks', draft.id), payload as any);
        setSuccess('Block updated');
      } else {
        await addDoc(collection(db, 'blocks'), payload as any);
        setSuccess('Block created');
      }
      setShowModal(false);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this block?')) return;
    try { await deleteDoc(doc(db, 'blocks', id)); } catch (e) { console.error(e); }
  };

  const addWindow = () => {
    setDraft({ ...draft, windows: [...draft.windows, { start: '13:00', end: '15:00' }] });
  };
  const updateWindow = (idx: number, upd: Partial<{ start: string; end: string; days?: number[] }>) => {
    const windows = draft.windows.slice();
    const w = { ...windows[idx], ...upd } as any;
    windows[idx] = w;
    setDraft({ ...draft, windows });
  };
  const removeWindow = (idx: number) => {
    const windows = draft.windows.slice();
    windows.splice(idx, 1);
    setDraft({ ...draft, windows });
  };

  const runPreview = async () => {
    setScheduling(true); setSchedulePreview(null); setError(null);
    try {
      const fn = httpsCallable(functions, 'scheduleIntoBlocks');
      const startDate = new Date().toISOString().slice(0,10);
      const endDate = new Date(Date.now() + 3*24*60*60*1000).toISOString().slice(0,10);
      const res = await fn({ startDate, endDate, apply: false });
      setSchedulePreview(res.data);
    } catch (e: any) {
      setError(e?.message || 'Scheduling preview failed');
    } finally { setScheduling(false); }
  };
  const applySchedule = async () => {
    setScheduling(true); setError(null);
    try {
      const fn = httpsCallable(functions, 'scheduleIntoBlocks');
      const startDate = new Date().toISOString().slice(0,10);
      const endDate = new Date(Date.now() + 3*24*60*60*1000).toISOString().slice(0,10);
      const res = await fn({ startDate, endDate, apply: true });
      setSchedulePreview(res.data);
      setSuccess('Scheduling applied');
    } catch (e: any) {
      setError(e?.message || 'Scheduling failed');
    } finally { setScheduling(false); }
  };

  return (
    <Container className="py-3">
      <Row className="align-items-center mb-3">
        <Col><h3>Blocks</h3></Col>
        <Col className="text-end">
          <Button variant="outline-primary" className="me-2" onClick={runPreview} disabled={scheduling}>Preview Auto-Schedule</Button>
          <Button variant="primary" onClick={applySchedule} disabled={scheduling}>Apply Auto-Schedule</Button>
          <Button variant="success" className="ms-2" onClick={openCreate}>New Block</Button>
        </Col>
      </Row>

      {error && <Alert variant="danger" onClose={()=>setError(null)} dismissible>{error}</Alert>}
      {success && <Alert variant="success" onClose={()=>setSuccess(null)} dismissible>{success}</Alert>}

      {schedulePreview && (
        <Card className="mb-3">
          <Card.Body>
            <Card.Title>Schedule Preview</Card.Title>
            <div className="small text-muted">{JSON.stringify(schedulePreview)}</div>
          </Card.Body>
        </Card>
      )}

      <Card className="mb-3">
        <Card.Body>
          <Card.Title>Block List</Card.Title>
          <Table hover size="sm" className="align-middle">
            <thead>
              <tr>
                <th>Name</th>
                <th>Priority</th>
                <th>Capacity</th>
                <th>Windows</th>
                <th>Enabled</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {blocks.map(b => (
                <tr key={b.id}>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <span style={{ display: 'inline-block', width: 12, height: 12, background: b.color || '#999', borderRadius: 2 }} />
                      <div>
                        <div>{b.name} {b.description ? <small className="text-muted">— {b.description}</small> : null}</div>
                        {b.rrule && <div className="small text-muted">RRULE: {b.rrule}</div>}
                      </div>
                    </div>
                  </td>
                  <td>{b.priority ?? 0}</td>
                  <td>{b.dailyCapacity ?? 0} min</td>
                  <td>
                    <div className="small text-muted">
                      {b.windows.map((w, i) => (
                        <Badge key={i} bg="secondary" className="me-1">{(w.days && w.days.length ? w.days.map(d=>['Su','Mo','Tu','We','Th','Fr','Sa'][d]).join('') : 'Daily')} {w.start}-{w.end}</Badge>
                      ))}
                      {/* Cross-block overlap heuristic */}
                      {(() => {
                        const thisIdx = blocks.findIndex(x=>x.id===b.id);
                        let conflict = false;
                        for (let i=0;i<blocks.length;i++) {
                          if (i===thisIdx) continue;
                          for (const w1 of b.windows) {
                            for (const w2 of blocks[i].windows) {
                              const days1 = w1.days && w1.days.length ? w1.days : [0,1,2,3,4,5,6];
                              const days2 = w2.days && w2.days.length ? w2.days : [0,1,2,3,4,5,6];
                              if (days1.some(d=>days2.includes(d))) {
                                if (overlap(hhmmToMin(w1.start), hhmmToMin(w1.end), hhmmToMin(w2.start), hhmmToMin(w2.end))) { conflict = true; break; }
                              }
                            }
                            if (conflict) break;
                          }
                          if (conflict) break;
                        }
                        return conflict ? <Badge bg="warning" className="ms-1">Conflict</Badge> : null;
                      })()}
                    </div>
                  </td>
                  <td>{b.enabled ? 'Yes' : 'No'}</td>
                  <td className="text-end">
                    <Button size="sm" variant="outline-primary" className="me-2" onClick={()=>openEdit(b)}>Edit</Button>
                    <Button size="sm" variant="outline-danger" onClick={()=>remove(b.id)}>Delete</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Modal show={showModal} onHide={()=>setShowModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{draft.id ? 'Edit Block' : 'New Block'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {hasWindowConflicts && <Alert variant="warning">Time windows overlap on at least one day.</Alert>}
          <Row>
            <Col md={6}>
              <Form.Group className="mb-3">
                <Form.Label>Name</Form.Label>
                <Form.Control value={draft.name} onChange={e=>setDraft({ ...draft, name: e.target.value })} placeholder="Chores" />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>Description</Form.Label>
                <Form.Control value={draft.description || ''} onChange={e=>setDraft({ ...draft, description: e.target.value })} />
              </Form.Group>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Color</Form.Label>
                    <Form.Control type="color" value={draft.color || '#0ea5e9'} onChange={e=>setDraft({ ...draft, color: e.target.value })} />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Priority</Form.Label>
                    <Form.Control type="number" value={draft.priority || 0} onChange={e=>setDraft({ ...draft, priority: Number(e.target.value) })} />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3">
                <Form.Label>RRULE</Form.Label>
                <Form.Control value={draft.rrule || ''} onChange={e=>setDraft({ ...draft, rrule: e.target.value })} placeholder="FREQ=WEEKLY;BYDAY=SA" />
                <Form.Text className="text-muted">Advanced recurrence; leave blank to treat as always-on with windows</Form.Text>
              </Form.Group>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Daily Capacity (min)</Form.Label>
                    <Form.Control type="number" value={draft.dailyCapacity || 0} onChange={e=>setDraft({ ...draft, dailyCapacity: Number(e.target.value) })} />
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Min (min)</Form.Label>
                    <Form.Control type="number" value={draft.minDuration || 0} onChange={e=>setDraft({ ...draft, minDuration: Number(e.target.value) })} />
                  </Form.Group>
                </Col>
                <Col md={3}>
                  <Form.Group className="mb-3">
                    <Form.Label>Max (min)</Form.Label>
                    <Form.Control type="number" value={draft.maxDuration || 0} onChange={e=>setDraft({ ...draft, maxDuration: Number(e.target.value) })} />
                  </Form.Group>
                </Col>
              </Row>
              <Row>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Buffer Before (min)</Form.Label>
                    <Form.Control type="number" value={draft.buffers?.beforeMin || 0} onChange={e=>setDraft({ ...draft, buffers: { ...(draft.buffers||{}), beforeMin: Number(e.target.value) } })} />
                  </Form.Group>
                </Col>
                <Col md={6}>
                  <Form.Group className="mb-3">
                    <Form.Label>Buffer After (min)</Form.Label>
                    <Form.Control type="number" value={draft.buffers?.afterMin || 0} onChange={e=>setDraft({ ...draft, buffers: { ...(draft.buffers||{}), afterMin: Number(e.target.value) } })} />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Group className="mb-3">
                <Form.Check type="switch" id="enabled" label="Enabled" checked={!!draft.enabled} onChange={e=>setDraft({ ...draft, enabled: e.target.checked })} />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Constraints</Form.Label>
                <Row>
                  <Col md={6}>
                    <Form.Select value={draft.constraints?.location || 'any'} onChange={e=>setDraft({ ...draft, constraints: { ...(draft.constraints||{}), location: e.target.value as any } })}>
                      <option value="any">Any location</option>
                      <option value="home">Home</option>
                      <option value="office">Office</option>
                    </Form.Select>
                  </Col>
                </Row>
                <Form.Text className="text-muted">Quiet hours excluded below.</Form.Text>
                {(draft.constraints?.quietHours || []).map((q, i) => (
                  <Row key={i} className="mt-2">
                    <Col><Form.Control type="time" value={q.start} onChange={e=>{
                      const list = [...(draft.constraints?.quietHours || [])];
                      list[i] = { ...list[i], start: e.target.value };
                      setDraft({ ...draft, constraints: { ...(draft.constraints||{}), quietHours: list } });
                    }} /></Col>
                    <Col><Form.Control type="time" value={q.end} onChange={e=>{
                      const list = [...(draft.constraints?.quietHours || [])];
                      list[i] = { ...list[i], end: e.target.value };
                      setDraft({ ...draft, constraints: { ...(draft.constraints||{}), quietHours: list } });
                    }} /></Col>
                  </Row>
                ))}
                <Button variant="outline-secondary" size="sm" className="mt-2" onClick={()=>{
                  const list = [...(draft.constraints?.quietHours || [])];
                  list.push({ start: '22:00', end: '07:00' });
                  setDraft({ ...draft, constraints: { ...(draft.constraints||{}), quietHours: list } });
                }}>Add Quiet Hours</Button>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>Disabled Dates</Form.Label>
                <Row className="g-2 align-items-end">
                  <Col md={7}>
                    <Form.Control type="date" onChange={(e)=>{
                      const v = e.target.value;
                      if (!v) return;
                      if (draft.disabledDates?.includes(v)) return;
                      const dd = [...(draft.disabledDates||[]), v].sort();
                      setDraft({ ...draft, disabledDates: dd });
                    }} />
                  </Col>
                  <Col md={5}>
                    <div className="d-flex gap-2">
                      <Button size="sm" variant="outline-secondary" onClick={()=>{
                        const d = new Date();
                        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        if (!(draft.disabledDates||[]).includes(key)) setDraft({ ...draft, disabledDates: [...(draft.disabledDates||[]), key] });
                      }}>Disable Today</Button>
                      <Button size="sm" variant="outline-secondary" onClick={()=>{
                        const d = new Date(); d.setDate(d.getDate()+1);
                        const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                        if (!(draft.disabledDates||[]).includes(key)) setDraft({ ...draft, disabledDates: [...(draft.disabledDates||[]), key] });
                      }}>Disable Tomorrow</Button>
                    </div>
                  </Col>
                </Row>
                <div className="mt-2">
                  {(draft.disabledDates||[]).map((d, i) => (
                    <Badge key={i} bg="light" text="dark" className="me-2 mb-2" style={{cursor:'pointer'}} onClick={()=>{
                      const list = (draft.disabledDates||[]).filter(x=>x!==d);
                      setDraft({ ...draft, disabledDates: list });
                    }}>{d} ×</Badge>
                  ))}
                  {(!draft.disabledDates || draft.disabledDates.length===0) && <div className="text-muted small">No disabled dates</div>}
                </div>
                <Form.Text className="text-muted">Planner will skip these dates for this block</Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <div className="d-flex align-items-center mb-2">
                <h6 className="mb-0">Windows</h6>
                <Button size="sm" className="ms-auto" onClick={addWindow}>Add Window</Button>
              </div>
              {draft.windows.map((w, i) => (
                <Card key={i} className="mb-2">
                  <Card.Body>
                    <Row className="g-2 align-items-end">
                      <Col md={4}>
                        <Form.Label>Start</Form.Label>
                        <Form.Control type="time" value={w.start} onChange={e=>updateWindow(i, { start: e.target.value })} />
                      </Col>
                      <Col md={4}>
                        <Form.Label>End</Form.Label>
                        <Form.Control type="time" value={w.end} onChange={e=>updateWindow(i, { end: e.target.value })} />
                      </Col>
                      <Col md={4}>
                        <Form.Label>Days</Form.Label>
                        <Form.Select multiple value={(w.days || []).map(String)} onChange={e=>{
                          const opts = Array.from(e.target.selectedOptions).map(o=>Number(o.value));
                          updateWindow(i, { days: opts });
                        }}>
                          {[{i:0,n:'Sun'},{i:1,n:'Mon'},{i:2,n:'Tue'},{i:3,n:'Wed'},{i:4,n:'Thu'},{i:5,n:'Fri'},{i:6,n:'Sat'}].map(d => (
                            <option key={d.i} value={d.i}>{d.n}</option>
                          ))}
                        </Form.Select>
                        <Form.Text className="text-muted">Empty = daily</Form.Text>
                      </Col>
                    </Row>
                    <div className="text-end mt-2">
                      <Button size="sm" variant="outline-danger" onClick={()=>removeWindow(i)}>Remove</Button>
                    </div>
                  </Card.Body>
                </Card>
              ))}
              <WeeklyOverlay block={draft} />
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={saving || !draft.name || !draft.windows.length}>Save</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default BlocksManager;
