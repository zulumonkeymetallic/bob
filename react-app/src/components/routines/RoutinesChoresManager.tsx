import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Button, Table, Modal, Form, Row, Col, Badge, Alert } from 'react-bootstrap';
import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { formatDistanceToNow, format } from 'date-fns';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { useUnifiedPlannerData } from '../../hooks/useUnifiedPlannerData';
import { nextDueAt } from '../../utils/recurrence';
import { schedulerCollections, type ChoreModel, type RoutineModel } from '../../domain/scheduler/repository';

type RecurrenceMode = 'daily' | 'weekly' | 'custom';

interface ChoreFormState {
  id?: string;
  title: string;
  description?: string;
  durationMinutes: number;
  priority: number;
  recurrenceMode: RecurrenceMode;
  weeklyDays: number[]; // 1..7 (Mon..Sun)
  rrule: string; // for custom
  timezone: string;
}

interface RoutineFormState extends ChoreFormState {
  type: 'boolean' | 'quantitative' | 'streak';
  unit?: string;
  dailyTarget?: number;
}

const defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';

const defaultChore: ChoreFormState = {
  title: '',
  description: '',
  durationMinutes: 15,
  priority: 3,
  recurrenceMode: 'daily',
  weeklyDays: [1,2,3,4,5,6,7],
  rrule: 'FREQ=DAILY',
  timezone: defaultTimezone,
};

const defaultRoutine: RoutineFormState = {
  ...defaultChore,
  type: 'boolean',
  unit: 'check',
  dailyTarget: 1,
};

function daysToByDay(days: number[]): string {
  const map: Record<number, string> = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 7: 'SU' };
  const ordered = [...new Set(days)].filter((d) => d>=1 && d<=7).sort((a,b)=>a-b);
  return ordered.map((d) => map[d]).join(',');
}

function makeRrule(mode: RecurrenceMode, weeklyDays: number[], custom: string): string {
  if (mode === 'custom') return custom || 'FREQ=DAILY';
  if (mode === 'weekly') {
    const byday = daysToByDay(weeklyDays);
    return byday ? `FREQ=WEEKLY;BYDAY=${byday}` : 'FREQ=WEEKLY';
  }
  return 'FREQ=DAILY';
}

const formatMs = (ms?: number | null) => (ms ? format(ms, 'EEE dd MMM, HH:mm') : '—');

const RoutinesChoresManager: React.FC = () => {
  const { currentUser } = useAuth();

  const planner = useUnifiedPlannerData(null);
  const [chores, setChores] = useState<ChoreModel[]>([]);
  const [routines, setRoutines] = useState<RoutineModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'danger' | 'info'; message: string } | null>(null);

  // Forms
  const [showChoreModal, setShowChoreModal] = useState(false);
  const [showRoutineModal, setShowRoutineModal] = useState(false);
  const [choreForm, setChoreForm] = useState<ChoreFormState>({ ...defaultChore });
  const [routineForm, setRoutineForm] = useState<RoutineFormState>({ ...defaultRoutine });

  useEffect(() => {
    if (!currentUser) {
      setChores([]);
      setRoutines([]);
      return;
    }
    setChores(planner.chores);
    setRoutines(planner.routines);
  }, [currentUser, planner.chores, planner.routines]);

  const computeNext = useCallback((recurrence: any): number | null => {
    if (!recurrence?.rrule) return null;
    const dtstart = recurrence?.dtstart ? Date.parse(recurrence.dtstart) : undefined;
    return nextDueAt(recurrence.rrule, dtstart || undefined) || null;
  }, []);

  const handlePlan = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const solverRunId = await planner.requestPlanningRun({ days: 3, includeBusy: true });
      setFeedback({ variant: 'success', message: solverRunId ? `Auto-planning queued (${solverRunId.slice(0,8)}…).` : 'Auto-planning triggered.' });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Failed to trigger planner' });
    } finally {
      setLoading(false);
    }
  }, [planner]);

  const openNewChore = () => {
    setChoreForm({ ...defaultChore });
    setShowChoreModal(true);
  };
  const openEditChore = (row: ChoreModel) => {
    const recurrenceMode: RecurrenceMode = row.recurrence?.rrule?.includes('WEEKLY') ? 'weekly' : row.recurrence?.rrule?.includes('FREQ=DAILY') ? 'daily' : 'custom';
    const weeklyDays = (() => {
      if (recurrenceMode !== 'weekly') return [1,2,3,4,5,6,7];
      const m = row.recurrence.rrule.match(/BYDAY=([^;]+)/);
      if (!m) return [1,2,3,4,5,6,7];
      const map: Record<string, number> = { MO:1, TU:2, WE:3, TH:4, FR:5, SA:6, SU:7 };
      return m[1].split(',').map((s)=>map[s]).filter(Boolean);
    })();
    setChoreForm({
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      durationMinutes: Number(row.durationMinutes || 15),
      priority: Number(row.priority || 3),
      recurrenceMode,
      weeklyDays,
      rrule: row.recurrence?.rrule || 'FREQ=DAILY',
      timezone: row.recurrence?.timezone || defaultTimezone,
    });
    setShowChoreModal(true);
  };

  const openNewRoutine = () => {
    setRoutineForm({ ...defaultRoutine });
    setShowRoutineModal(true);
  };
  const openEditRoutine = (row: RoutineModel) => {
    const recurrenceMode: RecurrenceMode = row.recurrence?.rrule?.includes('WEEKLY') ? 'weekly' : row.recurrence?.rrule?.includes('FREQ=DAILY') ? 'daily' : 'custom';
    const weeklyDays = (() => {
      if (recurrenceMode !== 'weekly') return [1,2,3,4,5,6,7];
      const m = row.recurrence.rrule.match(/BYDAY=([^;]+)/);
      if (!m) return [1,2,3,4,5,6,7];
      const map: Record<string, number> = { MO:1, TU:2, WE:3, TH:4, FR:5, SA:6, SU:7 };
      return m[1].split(',').map((s)=>map[s]).filter(Boolean);
    })();
    setRoutineForm({
      id: row.id,
      title: row.title || '',
      description: row.description || '',
      durationMinutes: Number(row.durationMinutes || 15),
      priority: Number(row.priority || 3),
      recurrenceMode,
      weeklyDays,
      rrule: row.recurrence?.rrule || 'FREQ=DAILY',
      timezone: row.recurrence?.timezone || defaultTimezone,
      type: (row.type as any) || 'boolean',
      unit: (row as any).unit || 'check',
      dailyTarget: Number((row as any).dailyTarget || 1),
    });
    setShowRoutineModal(true);
  };

  const saveChore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const rrule = makeRrule(choreForm.recurrenceMode, choreForm.weeklyDays, choreForm.rrule);
    const base = {
      title: choreForm.title.trim(),
      description: choreForm.description || '',
      ownerUid: currentUser.uid,
      durationMinutes: Math.max(5, Math.min(240, Number(choreForm.durationMinutes) || 15)),
      priority: Math.max(1, Math.min(5, Number(choreForm.priority) || 3)),
      recurrence: {
        rrule,
        dtstart: new Date().toISOString(),
        timezone: choreForm.timezone || defaultTimezone,
        source: 'rrule',
      },
      policy: { mode: 'roll_forward', graceWindowMinutes: 120 },
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Partial<ChoreModel>;
    try {
      if (choreForm.id) {
        await updateDoc(doc(db, 'chores', choreForm.id), { ...base, updatedAt: Date.now() });
      } else {
        await addDoc(collection(db, 'chores'), base);
      }
      setShowChoreModal(false);
      setChoreForm({ ...defaultChore });
    } catch (err) {
      setFeedback({ variant: 'danger', message: (err as any)?.message || 'Failed to save chore' });
    }
  };

  const saveRoutine = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    const rrule = makeRrule(routineForm.recurrenceMode, routineForm.weeklyDays, routineForm.rrule);
    const base = {
      title: routineForm.title.trim(),
      description: routineForm.description || '',
      ownerUid: currentUser.uid,
      durationMinutes: Math.max(5, Math.min(240, Number(routineForm.durationMinutes) || 15)),
      priority: Math.max(1, Math.min(5, Number(routineForm.priority) || 3)),
      recurrence: {
        rrule,
        dtstart: new Date().toISOString(),
        timezone: routineForm.timezone || defaultTimezone,
        source: 'rrule',
      },
      type: routineForm.type,
      unit: routineForm.unit || 'check',
      dailyTarget: Number(routineForm.dailyTarget || 1),
      policy: { mode: 'roll_forward', graceWindowMinutes: 120 },
      tags: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Partial<RoutineModel>;
    try {
      if (routineForm.id) {
        await updateDoc(doc(db, 'routines', routineForm.id), { ...base, updatedAt: Date.now() });
      } else {
        await addDoc(collection(db, 'routines'), base);
      }
      setShowRoutineModal(false);
      setRoutineForm({ ...defaultRoutine });
    } catch (err) {
      setFeedback({ variant: 'danger', message: (err as any)?.message || 'Failed to save routine' });
    }
  };

  const deleteChore = async (row: ChoreModel) => {
    if (!window.confirm(`Delete chore "${row.title}"?`)) return;
    await deleteDoc(doc(db, 'chores', row.id));
  };
  const deleteRoutine = async (row: RoutineModel) => {
    if (!window.confirm(`Delete routine "${row.title}"?`)) return;
    await deleteDoc(doc(db, 'routines', row.id));
  };

  const completeChore = async (row: ChoreModel) => {
    try {
      const callable = httpsCallable(functions, 'completeChore');
      await callable({ choreId: row.id });
      setFeedback({ variant: 'success', message: 'Chore marked done' });
    } catch (err) {
      setFeedback({ variant: 'danger', message: (err as any)?.message || 'Failed to complete chore' });
    }
  };
  const completeRoutine = async (row: RoutineModel) => {
    try {
      const callable = httpsCallable(functions, 'completeRoutine');
      await callable({ routineId: row.id });
      setFeedback({ variant: 'success', message: 'Routine marked done' });
    } catch (err) {
      setFeedback({ variant: 'danger', message: (err as any)?.message || 'Failed to complete routine' });
    }
  };
  const skipRoutine = async (row: RoutineModel) => {
    try {
      const callable = httpsCallable(functions, 'skipRoutine');
      await callable({ routineId: row.id });
      setFeedback({ variant: 'info', message: 'Routine skipped for today' });
    } catch (err) {
      setFeedback({ variant: 'danger', message: (err as any)?.message || 'Failed to skip routine' });
    }
  };

  const renderRecurrenceControls = (
    mode: RecurrenceMode,
    setMode: (v: RecurrenceMode) => void,
    weeklyDays: number[],
    setWeeklyDays: (v: number[]) => void,
    rrule: string,
    setRrule: (v: string) => void,
  ) => (
    <>
      <Form.Select value={mode} onChange={(e)=>setMode(e.target.value as RecurrenceMode)}>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="custom">Custom RRULE</option>
      </Form.Select>
      {mode === 'weekly' && (
        <div className="mt-2 d-flex flex-wrap gap-3">
          {[
            { label: 'Mon', v: 1 },{ label: 'Tue', v: 2 },{ label: 'Wed', v: 3 },{ label: 'Thu', v: 4 },{ label: 'Fri', v: 5 },{ label: 'Sat', v: 6 },{ label: 'Sun', v: 7 },
          ].map((d) => (
            <Form.Check
              key={d.v}
              inline
              type="checkbox"
              id={`dow-${d.v}`}
              label={d.label}
              checked={weeklyDays.includes(d.v)}
              onChange={(e) => {
                const exists = weeklyDays.includes(d.v);
                const next = exists ? weeklyDays.filter((x) => x !== d.v) : [...weeklyDays, d.v];
                setWeeklyDays(next.sort((a,b)=>a-b));
              }}
            />
          ))}
        </div>
      )}
      {mode === 'custom' && (
        <Form.Control className="mt-2" placeholder="RRULE=…" value={rrule} onChange={(e)=>setRrule(e.target.value)} />
      )}
    </>
  );

  const infoNote = (
    <div className="text-muted small">
      Chores & routines are scheduled into calendar blocks by the AI planner and appear in the mobile checklist and daily email. They do not sync to iOS Reminders unless explicitly pushed from Tasks.
    </div>
  );

  return (
    <div className="container py-3" style={{ maxWidth: 1100 }}>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0">Routines & Chores</h4>
        <div className="d-flex gap-2">
          <Button variant="outline-primary" onClick={handlePlan} disabled={loading}>
            Auto‑plan next 3 days
          </Button>
          <Button variant="primary" onClick={openNewChore}>New Chore</Button>
          <Button variant="primary" onClick={openNewRoutine}>New Routine</Button>
        </div>
      </div>
      {feedback && (
        <Alert variant={feedback.variant} onClose={()=>setFeedback(null)} dismissible>{feedback.message}</Alert>
      )}
      {infoNote}

      <Card className="mt-3">
        <Card.Header>
          <div className="d-flex align-items-center justify-content-between">
            <div className="fw-semibold">Chores</div>
            <Badge bg="secondary">{chores.length}</Badge>
          </div>
        </Card.Header>
        <Card.Body>
          <Table size="sm" responsive className="align-middle">
            <thead>
              <tr>
                <th>Title</th>
                <th>Cadence</th>
                <th>Next Due</th>
                <th>Duration</th>
                <th>Priority</th>
                <th>Last Done</th>
                <th style={{ width: 180 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {chores.map((c) => {
                const next = computeNext(c.recurrence);
                const nextLabel = next ? `${formatDistanceToNow(next, { addSuffix: true })}` : '—';
                return (
                  <tr key={c.id}>
                    <td className="fw-semibold">{c.title || 'Chore'}</td>
                    <td><code className="small">{c.recurrence?.rrule || '—'}</code></td>
                    <td title={next ? new Date(next).toLocaleString() : undefined}>{nextLabel}</td>
                    <td>{c.durationMinutes || 15} min</td>
                    <td>{c.priority || 3}</td>
                    <td>{c.lastCompletedAt ? formatDistanceToNow(new Date(c.lastCompletedAt as any), { addSuffix: true }) : '—'}</td>
                    <td>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-success" onClick={()=>completeChore(c)}>Done</Button>
                        <Button size="sm" variant="outline-secondary" onClick={()=>openEditChore(c)}>Edit</Button>
                        <Button size="sm" variant="outline-danger" onClick={()=>deleteChore(c)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {chores.length === 0 && (
                <tr><td colSpan={7} className="text-muted">No chores yet</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      <Card className="mt-4">
        <Card.Header>
          <div className="d-flex align-items-center justify-content-between">
            <div className="fw-semibold">Routines</div>
            <Badge bg="secondary">{routines.length}</Badge>
          </div>
        </Card.Header>
        <Card.Body>
          <Table size="sm" responsive className="align-middle">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Cadence</th>
                <th>Next Due</th>
                <th>Duration</th>
                <th>Priority</th>
                <th>Last Done</th>
                <th style={{ width: 220 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {routines.map((r) => {
                const next = computeNext(r.recurrence);
                const nextLabel = next ? `${formatDistanceToNow(next, { addSuffix: true })}` : '—';
                const typeLabel = (r as any).type || 'boolean';
                return (
                  <tr key={r.id}>
                    <td className="fw-semibold">{r.title || 'Routine'}</td>
                    <td>{typeLabel}</td>
                    <td><code className="small">{r.recurrence?.rrule || '—'}</code></td>
                    <td title={next ? new Date(next).toLocaleString() : undefined}>{nextLabel}</td>
                    <td>{r.durationMinutes || 15} min</td>
                    <td>{r.priority || 3}</td>
                    <td>{(r as any).lastCompletedAt ? formatDistanceToNow(new Date((r as any).lastCompletedAt as any), { addSuffix: true }) : '—'}</td>
                    <td>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-success" onClick={()=>completeRoutine(r)}>Done</Button>
                        <Button size="sm" variant="outline-warning" onClick={()=>skipRoutine(r)}>Skip</Button>
                        <Button size="sm" variant="outline-secondary" onClick={()=>openEditRoutine(r)}>Edit</Button>
                        <Button size="sm" variant="outline-danger" onClick={()=>deleteRoutine(r)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {routines.length === 0 && (
                <tr><td colSpan={8} className="text-muted">No routines yet</td></tr>
              )}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* Chore Modal */}
      <Modal show={showChoreModal} onHide={()=>setShowChoreModal(false)}>
        <Form onSubmit={saveChore}>
          <Modal.Header closeButton>
            <Modal.Title>{choreForm.id ? 'Edit Chore' : 'New Chore'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>Title</Form.Label>
                <Form.Control value={choreForm.title} onChange={(e)=>setChoreForm({ ...choreForm, title: e.target.value })} required />
              </Col>
              <Col md={4}>
                <Form.Label>Priority</Form.Label>
                <Form.Select value={choreForm.priority} onChange={(e)=>setChoreForm({ ...choreForm, priority: Number(e.target.value) })}>
                  {[1,2,3,4,5].map((p)=> <option key={p} value={p}>{p}</option>)}
                </Form.Select>
              </Col>
              <Col md={12}>
                <Form.Label>Description</Form.Label>
                <Form.Control as="textarea" rows={2} value={choreForm.description} onChange={(e)=>setChoreForm({ ...choreForm, description: e.target.value })} />
              </Col>
              <Col md={4}>
                <Form.Label>Duration (min)</Form.Label>
                <Form.Control type="number" min={5} max={240} value={choreForm.durationMinutes} onChange={(e)=>setChoreForm({ ...choreForm, durationMinutes: Number(e.target.value) })} />
              </Col>
              <Col md={8}>
                <Form.Label>Timezone</Form.Label>
                <Form.Control value={choreForm.timezone} onChange={(e)=>setChoreForm({ ...choreForm, timezone: e.target.value })} />
              </Col>
              <Col md={12}>
                <Form.Label>Recurrence</Form.Label>
                {renderRecurrenceControls(
                  choreForm.recurrenceMode,
                  (v)=>setChoreForm({ ...choreForm, recurrenceMode: v }),
                  choreForm.weeklyDays,
                  (v)=>setChoreForm({ ...choreForm, weeklyDays: v }),
                  choreForm.rrule,
                  (v)=>setChoreForm({ ...choreForm, rrule: v }),
                )}
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={()=>setShowChoreModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">{choreForm.id ? 'Save' : 'Create'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

      {/* Routine Modal */}
      <Modal show={showRoutineModal} onHide={()=>setShowRoutineModal(false)}>
        <Form onSubmit={saveRoutine}>
          <Modal.Header closeButton>
            <Modal.Title>{routineForm.id ? 'Edit Routine' : 'New Routine'}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Row className="g-3">
              <Col md={8}>
                <Form.Label>Title</Form.Label>
                <Form.Control value={routineForm.title} onChange={(e)=>setRoutineForm({ ...routineForm, title: e.target.value })} required />
              </Col>
              <Col md={4}>
                <Form.Label>Priority</Form.Label>
                <Form.Select value={routineForm.priority} onChange={(e)=>setRoutineForm({ ...routineForm, priority: Number(e.target.value) })}>
                  {[1,2,3,4,5].map((p)=> <option key={p} value={p}>{p}</option>)}
                </Form.Select>
              </Col>
              <Col md={12}>
                <Form.Label>Description</Form.Label>
                <Form.Control as="textarea" rows={2} value={routineForm.description} onChange={(e)=>setRoutineForm({ ...routineForm, description: e.target.value })} />
              </Col>
              <Col md={4}>
                <Form.Label>Duration (min)</Form.Label>
                <Form.Control type="number" min={5} max={240} value={routineForm.durationMinutes} onChange={(e)=>setRoutineForm({ ...routineForm, durationMinutes: Number(e.target.value) })} />
              </Col>
              <Col md={4}>
                <Form.Label>Type</Form.Label>
                <Form.Select value={routineForm.type} onChange={(e)=>setRoutineForm({ ...routineForm, type: e.target.value as any })}>
                  <option value="boolean">Boolean</option>
                  <option value="quantitative">Quantitative</option>
                  <option value="streak">Streak</option>
                </Form.Select>
              </Col>
              <Col md={4}>
                <Form.Label>Target</Form.Label>
                <div className="d-flex gap-2">
                  <Form.Control type="number" min={1} value={routineForm.dailyTarget} onChange={(e)=>setRoutineForm({ ...routineForm, dailyTarget: Number(e.target.value) })} />
                  <Form.Control value={routineForm.unit} onChange={(e)=>setRoutineForm({ ...routineForm, unit: e.target.value })} />
                </div>
              </Col>
              <Col md={12}>
                <Form.Label>Timezone</Form.Label>
                <Form.Control value={routineForm.timezone} onChange={(e)=>setRoutineForm({ ...routineForm, timezone: e.target.value })} />
              </Col>
              <Col md={12}>
                <Form.Label>Recurrence</Form.Label>
                {renderRecurrenceControls(
                  routineForm.recurrenceMode,
                  (v)=>setRoutineForm({ ...routineForm, recurrenceMode: v }),
                  routineForm.weeklyDays,
                  (v)=>setRoutineForm({ ...routineForm, weeklyDays: v }),
                  routineForm.rrule,
                  (v)=>setRoutineForm({ ...routineForm, rrule: v }),
                )}
              </Col>
            </Row>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={()=>setShowRoutineModal(false)}>Cancel</Button>
            <Button type="submit" variant="primary">{routineForm.id ? 'Save' : 'Create'}</Button>
          </Modal.Footer>
        </Form>
      </Modal>

    </div>
  );
};

export default RoutinesChoresManager;
