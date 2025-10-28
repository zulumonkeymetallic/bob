import React, { useEffect, useMemo, useState } from 'react';
import { Card, Container, Row, Col, Form, Button, Badge } from 'react-bootstrap';
import { collection, onSnapshot, query, where, updateDoc, deleteDoc, doc, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import ModernTaskTable from '../ModernTaskTable';
import type { Task, Story, Goal, Sprint } from '../../types';
import { useSprint } from '../../contexts/SprintContext';

const TaskCleanupPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { sprints } = useSprint();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

  const [showDirty, setShowDirty] = useState(true);
  const [showDeleted, setShowDeleted] = useState(true);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!currentUser) return;
    const tq = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'));
    const unsubT = onSnapshot(tq, snap => setTasks(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Task[]));
    const unsubS = onSnapshot(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)), snap => setStories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[]));
    const unsubG = onSnapshot(query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid)), snap => setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[]));
    return () => { unsubT(); unsubS(); unsubG(); };
  }, [currentUser]);

  const duplicateIds = useMemo(() => {
    const byKey = new Map<string, string[]>();
    tasks.forEach(t => {
      const key = `${(t.title || '').trim().toLowerCase()}|${t.parentId || ''}`;
      const arr = byKey.get(key) || [];
      arr.push(t.id);
      byKey.set(key, arr);
    });
    const dups = new Set<string>();
    byKey.forEach(ids => { if (ids.length > 1) ids.slice(1).forEach(id => dups.add(id)); });
    return dups;
  }, [tasks]);

  const filtered = useMemo(() => {
    const syncDirty = new Set(['dirty', 'pending_push', 'awaiting_ack']);
    return tasks.filter((t: any) => {
      const isDirty = syncDirty.has(t.syncState);
      const isDeleted = Boolean(t.deleted);
      const isDup = duplicateIds.has(t.id);
      if (!showDirty && isDirty) return false;
      if (!showDeleted && isDeleted) return false;
      if (showDuplicates && !isDup) return false;
      if (sourceFilter !== 'all' && (t.source || 'unknown') !== sourceFilter) return false;
      if (search && !(String(t.title || '').toLowerCase().includes(search.toLowerCase()))) return false;
      return (showDirty && isDirty) || (showDeleted && isDeleted) || (showDuplicates ? isDup : true);
    });
  }, [tasks, showDirty, showDeleted, showDuplicates, sourceFilter, search, duplicateIds]);

  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${filtered.length} matching tasks?`)) return;
    await Promise.allSettled(filtered.map(t => deleteDoc(doc(db, 'tasks', t.id))));
  };

  const bulkUndelete = async () => {
    const toRestore = filtered.filter((t: any) => t.deleted);
    if (toRestore.length === 0) return;
    if (!window.confirm(`Clear deleted flag on ${toRestore.length} tasks?`)) return;
    await Promise.allSettled(toRestore.map(t => updateDoc(doc(db, 'tasks', t.id), { deleted: false })));
  };

  const sources = useMemo(() => {
    const set = new Set<string>();
    tasks.forEach((t: any) => set.add(t.source || 'unknown'));
    return Array.from(set);
  }, [tasks]);

  return (
    <Container fluid className="px-4 py-3">
      <Row className="mb-3">
        <Col>
          <h2 className="mb-0">Task Cleanup</h2>
          <small className="text-muted">Filter and mass delete/undelete based on state or duplicates</small>
        </Col>
      </Row>

      <Card className="mb-3">
        <Card.Body>
          <Row className="g-2 align-items-end">
            <Col md={2}><Form.Check type="switch" id="dirty" label="Dirty" checked={showDirty} onChange={e=>setShowDirty(e.target.checked)} /></Col>
            <Col md={2}><Form.Check type="switch" id="deleted" label="Deleted" checked={showDeleted} onChange={e=>setShowDeleted(e.target.checked)} /></Col>
            <Col md={2}><Form.Check type="switch" id="dups" label="Duplicates only" checked={showDuplicates} onChange={e=>setShowDuplicates(e.target.checked)} /></Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small">Source</Form.Label>
                <Form.Select value={sourceFilter} onChange={e=>setSourceFilter(e.target.value)}>
                  <option value="all">All</option>
                  {sources.map(s => (<option key={s} value={s}>{s}</option>))}
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label className="small">Search title</Form.Label>
                <Form.Control value={search} onChange={e=>setSearch(e.target.value)} placeholder="e.g., meeting" />
              </Form.Group>
            </Col>
          </Row>
          <div className="d-flex gap-2 mt-3">
            <Button variant="danger" onClick={bulkDelete} disabled={filtered.length===0}>Delete matching ({filtered.length})</Button>
            <Button variant="outline-secondary" onClick={bulkUndelete} disabled={filtered.filter((t:any)=>t.deleted).length===0}>Undelete matching</Button>
            <Badge bg="light" text="dark">Total tasks: {tasks.length}</Badge>
          </div>
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>Preview ({filtered.length})</Card.Header>
        <Card.Body style={{ padding: 0 }}>
          <div style={{ height: 600, overflow: 'auto' }}>
            <ModernTaskTable
              tasks={filtered}
              stories={stories}
              goals={goals}
              sprints={sprints}
              onTaskUpdate={async (id, updates) => updateDoc(doc(db, 'tasks', id), { ...updates })}
              onTaskDelete={async (id) => deleteDoc(doc(db, 'tasks', id))}
              onTaskPriorityChange={async (id, p) => updateDoc(doc(db, 'tasks', id), { priority: p })}
            />
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default TaskCleanupPage;

