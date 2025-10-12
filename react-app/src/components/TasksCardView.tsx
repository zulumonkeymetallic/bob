import React, { useEffect, useMemo, useState } from 'react';
import { Card, Row, Col, Badge, Button, Dropdown } from 'react-bootstrap';
import { collection, onSnapshot, orderBy, query, where, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import type { Task, Story, Goal, Sprint } from '../types';
import { Edit3, Trash2, ChevronDown, Target, BookOpen, Wand2, Activity } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';

const TasksCardView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [nextThreeSprints, setNextThreeSprints] = useState<Sprint[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsubTasks = onSnapshot(
      query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), orderBy('serverUpdatedAt', 'desc')),
      (snap) => setTasks(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Task[])
    );
    const unsubGoals = onSnapshot(
      query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[])
    );
    const unsubStories = onSnapshot(
      query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => setStories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[])
    );
    const unsubSprints = onSnapshot(
      query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid), orderBy('startDate', 'asc')),
      (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[];
        setSprints(rows);
        const now = Date.now();
        const upcoming = rows.filter(s => Number((s as any).endDate || 0) >= now);
        setNextThreeSprints(upcoming.slice(0,3));
      }
    );
    return () => { unsubTasks(); unsubGoals(); unsubStories(); unsubSprints(); };
  }, [currentUser?.uid, currentPersona]);

  const goalById = useMemo(() => {
    const m: Record<string, Goal> = {};
    goals.forEach(g => { m[g.id] = g; });
    return m;
  }, [goals]);
  const storyById = useMemo(() => {
    const m: Record<string, Story> = {};
    stories.forEach(s => { m[s.id] = s; });
    return m;
  }, [stories]);

  const handleDelete = async (taskId: string) => {
    if (!window.confirm('Delete this task?')) return;
    await deleteDoc(doc(db, 'tasks', taskId));
  };

  const handleEnhance = async (task: Task) => {
    try {
      const callable = httpsCallable(functions, 'enhanceTaskDescription');
      await callable({ taskId: (task as any).id });
      alert('AI: enhancing task description…');
    } catch (e: any) {
      alert(e?.message || 'AI enhancement not available');
    }
  };

  const handleConvertToStory = async (task: Task) => {
    try {
      const suggestCallable = httpsCallable(functions, 'suggestTaskStoryConversions');
      const convertCallable = httpsCallable(functions, 'convertTasksToStories');
      const resp: any = await suggestCallable({ taskIds: [(task as any).id], limit: 1 });
      const suggestion = Array.isArray(resp?.data?.suggestions) ? resp.data.suggestions[0] : null;
      const storyTitle = suggestion?.storyTitle || task.title || 'New Story';
      const storyDescription = suggestion?.storyDescription || task.description || '';
      await convertCallable({ conversions: [{ taskId: (task as any).id, storyTitle, storyDescription, goalId: (task as any).goalId || suggestion?.goalId || null }] });
      alert('Converted to story');
    } catch (e: any) {
      alert(e?.message || 'Conversion failed');
    }
  };

  const handleMoveToSprint = async (task: Task, sprintId: string) => {
    await updateDoc(doc(db, 'tasks', (task as any).id), { sprintId, updatedAt: Date.now() });
  };

  return (
    <div style={{ padding: 20 }}>
      <Row>
        {tasks.map((t) => {
          const parentStory = t.parentType === 'story' && t.parentId ? storyById[t.parentId] : null;
          const parentGoal = t.goalId ? goalById[t.goalId] : (parentStory ? goalById[parentStory.goalId as string] : null);
          const themeColor = parentGoal && (parentGoal as any).theme ? '#'+Number((parentGoal as any).theme).toString(16) : 'var(--muted)';
          return (
            <Col md={6} lg={3} xl={3} key={(t as any).id} className="mb-4">
              <Card style={{ minHeight: 260, border: '1px solid var(--line)' }}>
                <div style={{ height: 6, background: themeColor }} />
                <Card.Body style={{ padding: 16 }}>
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{(t as any).ref || (t as any).id.slice(-6).toUpperCase()}</div>
                      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3 }}>{t.title}</div>
                      {parentStory && (
                        <div className="d-flex align-items-center gap-1 mt-1" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          <BookOpen size={12} /> {parentStory.title}
                        </div>
                      )}
                      {parentGoal && (
                        <div className="d-flex align-items-center gap-1" style={{ fontSize: 11, color: 'var(--muted)' }}>
                          <Target size={12} /> {parentGoal.title}
                        </div>
                      )}
                    </div>
                    <Dropdown onClick={(e)=>e.stopPropagation()}>
                      <Dropdown.Toggle variant="outline-secondary" size="sm" style={{ border: 'none', padding: '2px 6px' }}>
                        <ChevronDown size={14} />
                      </Dropdown.Toggle>
                      <Dropdown.Menu style={{ zIndex: 2000 }}>
                        <Dropdown.Item onClick={() => showSidebar(t as any, 'task')}>
                          <Activity size={14} className="me-2" /> Activity
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleEnhance(t)}>
                          <Wand2 size={14} className="me-2" /> Enhance with AI
                        </Dropdown.Item>
                        <Dropdown.Item onClick={() => handleConvertToStory(t)}>
                          <BookOpen size={14} className="me-2" /> Convert to Story
                        </Dropdown.Item>
                        <Dropdown.Divider />
                        <Dropdown.Header>Move to Sprint</Dropdown.Header>
                        {nextThreeSprints.length === 0 && <Dropdown.Item disabled>No upcoming sprints</Dropdown.Item>}
                        {nextThreeSprints.map(sp => (
                          <Dropdown.Item key={sp.id} onClick={() => handleMoveToSprint(t, sp.id)}>
                            {sp.name || sp.id}
                          </Dropdown.Item>
                        ))}
                        <Dropdown.Divider />
                        <Dropdown.Item className="text-danger" onClick={() => handleDelete((t as any).id)}>
                          <Trash2 size={14} className="me-2" /> Delete Task
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    </Dropdown>
                  </div>
                  {t.description && (
                    <div className="text-muted" style={{ fontSize: 12 }}>{String(t.description).slice(0, 120)}</div>
                  )}
                  <div className="d-flex align-items-center gap-2 mt-2">
                    <Badge bg="light" text="dark" style={{ fontSize: 10 }}>{(t as any).effort || (t as any).points || '—'}</Badge>
                    <Badge bg="secondary" style={{ fontSize: 10 }}>P{(t as any).priority ?? 2}</Badge>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>
    </div>
  );
};

export default TasksCardView;

