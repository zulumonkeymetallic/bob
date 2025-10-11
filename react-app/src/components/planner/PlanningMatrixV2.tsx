import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Form, Alert } from 'react-bootstrap';
import { addDays, eachDayOfInterval, format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useSprint } from '../../contexts/SprintContext';
import { collection, doc, getDoc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Sprint, Story } from '../../types';

// Minimal read-only scaffold for Matrix v2
const PlanningMatrixV2: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId } = useSprint();
  const [view, setView] = useState<'matrix'|'kanban'>('matrix');
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [days, setDays] = useState<Date[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [capacity, setCapacity] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Load selected sprint (or pick active if none selected)
  useEffect(() => {
    if (!currentUser?.uid) return;
    let unsub: (() => void) | null = null;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        if (selectedSprintId) {
          const ref = doc(collection(db, 'sprints'), selectedSprintId);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const s = { id: snap.id, ...(snap.data() as any) } as Sprint;
            setSprint(s);
          } else {
            setSprint(null);
          }
        } else {
          // Pick active sprint for user (status 1)
          const q = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid), where('status', '==', 1));
          unsub = onSnapshot(q, (snap) => {
            const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[];
            setSprint(rows?.[0] || null);
          });
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load sprint');
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { if (unsub) unsub(); };
  }, [currentUser?.uid, selectedSprintId]);

  // Build days for the sprint window
  useEffect(() => {
    if (!sprint?.startDate || !sprint?.endDate) { setDays([]); return; }
    const start = new Date(Number(sprint.startDate));
    const end = new Date(Number(sprint.endDate));
    const rng = eachDayOfInterval({ start, end });
    setDays(rng);
  }, [sprint?.startDate, sprint?.endDate]);

  // Load stories in sprint (for points rollup)
  useEffect(() => {
    if (!currentUser?.uid || !sprint?.id) { setStories([]); return; }
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('sprintId', '==', sprint.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
      setStories(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, sprint?.id]);

  // Capacity storage (per sprint, per user)
  useEffect(() => {
    if (!currentUser?.uid || !sprint?.id) return;
    const capId = `${currentUser.uid}__${sprint.id}`;
    const ref = doc(collection(db, 'sprint_capacity'), capId);
    getDoc(ref).then((snap) => {
      const v = (snap.exists() && (snap.data() as any)?.pointsCapacity) || 0;
      setCapacity(Number(v) || 0);
    }).catch(() => {});
  }, [currentUser?.uid, sprint?.id]);

  const totalPoints = useMemo(() => {
    return stories.reduce((sum, s) => sum + (Number((s as any).points) || 0), 0);
  }, [stories]);

  const capacityPerDay = useMemo(() => {
    const n = days.length || 1;
    return capacity > 0 ? Math.round((capacity / n) * 10) / 10 : 0;
  }, [capacity, days.length]);

  const overBy = useMemo(() => {
    return capacity > 0 ? Math.max(0, totalPoints - capacity) : 0;
  }, [capacity, totalPoints]);

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 mb-0">Planning Matrix v2</h1>
        <div className="d-flex align-items-center gap-2">
          <Badge bg="secondary">Sprint: {selectedSprintId || 'none'}</Badge>
          <Badge bg="secondary">User: {currentUser?.email?.split('@')[0] || 'anon'}</Badge>
          <Button size="sm" variant="outline-primary" onClick={() => setView(v => v==='matrix'?'kanban':'matrix')}>
            Switch to {view === 'matrix' ? 'Kanban' : 'Matrix'}
          </Button>
        </div>
      </div>

      <Card>
        <Card.Body>
          {/* Header row with sprint and capacity */}
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div>
              <div className="fw-semibold">{sprint ? (sprint.name || sprint.ref) : 'No sprint selected'}</div>
              {sprint && (
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {format(new Date(Number(sprint.startDate)), 'EEE dd MMM')} → {format(new Date(Number(sprint.endDate)), 'EEE dd MMM')}
                </div>
              )}
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg={overBy > 0 ? 'danger' : 'success'}>
                Planned: {totalPoints} pts
              </Badge>
              <Badge bg="secondary">Days: {days.length || 0}</Badge>
              <Badge bg="info">Per‑day: {capacityPerDay || 0} pts</Badge>
              <Form className="d-flex align-items-center gap-1">
                <Form.Label className="mb-0" style={{ fontSize: 12 }}>Capacity</Form.Label>
                <Form.Control
                  style={{ width: 90 }}
                  size="sm"
                  type="number"
                  value={capacity || ''}
                  placeholder="pts"
                  onChange={(e) => setCapacity(Number(e.target.value) || 0)}
                  onBlur={async () => {
                    if (!currentUser?.uid || !sprint?.id) return;
                    const capId = `${currentUser.uid}__${sprint.id}`;
                    await setDoc(doc(collection(db, 'sprint_capacity'), capId), {
                      ownerUid: currentUser.uid,
                      sprintId: sprint.id,
                      pointsCapacity: Number(capacity) || 0,
                      updatedAt: Date.now(),
                    }, { merge: true });
                  }}
                />
                <Badge bg="primary">{capacity || 0} pts</Badge>
              </Form>
            </div>
          </div>

          {error && <Alert variant="danger" className="mb-2">{error}</Alert>}

          {/* Day columns */}
          <div className="d-flex" style={{ gap: 12, overflowX: 'auto' }}>
            {days.map((d) => (
              <div key={d.toISOString()} style={{ minWidth: 140 }}>
                <div className="mb-2" style={{ fontWeight: 600 }}>
                  {format(d, 'EEE dd MMM')}
                </div>
                <Card className="mb-2">
                  <Card.Body className="p-2">
                    <div className="d-flex align-items-center justify-content-between">
                      <span className="text-muted" style={{ fontSize: 12 }}>Planned</span>
                      <Badge bg="secondary">0 pts</Badge>
                    </div>
                  </Card.Body>
                </Card>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Capacity: {capacityPerDay || 0} pts
                </div>
              </div>
            ))}
          </div>

          {/* Sprint totals row */}
          <div className="mt-3 d-flex align-items-center gap-2">
            <Badge bg={overBy > 0 ? 'danger' : 'success'}>
              {overBy > 0 ? `Over by ${overBy} pts` : 'Within capacity'}
            </Badge>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Stories in sprint: {stories.length}
            </div>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default PlanningMatrixV2;
