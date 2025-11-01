import React, { useEffect, useMemo, useState } from 'react';
import { Container, Card, Button, Badge, ListGroup, Form, Modal, Spinner } from 'react-bootstrap';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Story, Task, Sprint as SprintType } from '../types';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { ChoiceHelper, StoryStatus } from '../config/choices';
import { getBadgeVariant, getPriorityBadge, getStatusName } from '../utils/statusHelpers';

type TabKey = 'tasks' | 'stories' | 'goals';

const MobileHome: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();

  const [activeTab, setActiveTab] = useState<TabKey>('tasks');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteModal, setNoteModal] = useState<{ type: 'task'|'story'|'goal'; id: string; show: boolean } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  // Subscribe to Daily Summary (AI) - latest for user
  useEffect(() => {
    if (!currentUser?.uid) { setSummary(null); return; }
    const q = query(
      collection(db, 'daily_summaries'),
      where('userId', '==', currentUser.uid),
      orderBy('generatedAt', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0]?.data() as any;
      setSummary(doc0?.summary || null);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to Goals
  useEffect(() => {
    if (!currentUser?.uid) { setGoals([]); return; }
    const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[]));
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to Stories (optionally filter by sprint)
  useEffect(() => {
    if (!currentUser?.uid) { setStories([]); return; }
    const base = [collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)] as any[];
    if (selectedSprintId) base.push(where('sprintId', '==', selectedSprintId));
    const q = query.apply(null, base as any);
    const unsub = onSnapshot(q, (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Story[]));
    return () => unsub();
  }, [currentUser?.uid, selectedSprintId]);

  // Subscribe to Tasks (optionally filter by sprint)
  useEffect(() => {
    if (!currentUser?.uid) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    const base = [collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid)] as any[];
    if (selectedSprintId) base.push(where('sprintId', '==', selectedSprintId));
    const q = query.apply(null, base as any);
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Task[];
      setTasks(data);
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser?.uid, selectedSprintId]);

  const storiesById = useMemo(() => new Map(stories.map(s => [s.id, s])), [stories]);
  const goalsById = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);

  const openNoteModal = (type: 'task'|'story'|'goal', id: string) => {
    setNoteText('');
    setNoteModal({ type, id, show: true });
  };

  const saveNote = async () => {
    if (!currentUser || !noteModal || !noteText.trim()) return;
    setSavingNote(true);
    try {
      await ActivityStreamService.addNote(
        noteModal.id,
        noteModal.type,
        noteText.trim(),
        currentUser.uid,
        currentUser.email || undefined,
        'personal',
        undefined
      );
      setNoteModal(null);
    } catch (e) {
      alert('Failed to save note');
    } finally {
      setSavingNote(false);
    }
  };

  const updateTaskField = async (task: Task, updates: Partial<Task>) => {
    try {
      await updateDoc(doc(db, 'tasks', task.id), { ...updates, updatedAt: serverTimestamp() });
      if (updates.status != null) {
        await ActivityStreamService.logStatusChange(
          task.id, 'task', currentUser!.uid, currentUser!.email || undefined,
          String(task.status), String(updates.status), 'personal', task.ref || task.id
        );
      }
    } catch (e) {
      alert('Failed to update task');
    }
  };

  const updateStoryField = async (story: Story, updates: Partial<Story>) => {
    try {
      await updateDoc(doc(db, 'stories', story.id), { ...updates, updatedAt: serverTimestamp() });
      if (updates.status != null) {
        await ActivityStreamService.logStatusChange(
          story.id, 'story', currentUser!.uid, currentUser!.email || undefined,
          String(story.status), String(updates.status), 'personal', story.ref || story.id
        );
      }
    } catch (e) {
      alert('Failed to update story');
    }
  };

  const updateGoalField = async (goal: Goal, updates: Partial<Goal>) => {
    try {
      await updateDoc(doc(db, 'goals', goal.id), { ...updates, updatedAt: serverTimestamp() });
      if (updates.status != null) {
        await ActivityStreamService.logStatusChange(
          goal.id, 'goal', currentUser!.uid, currentUser!.email || undefined,
          String(goal.status), String(updates.status), 'personal', (goal as any).ref || goal.id
        );
      }
    } catch (e) {
      alert('Failed to update goal');
    }
  };

  const pendingTasks = useMemo(() => tasks.filter(t => t.status !== 2), [tasks]);

  return (
    <Container fluid className="p-2" style={{ maxWidth: 720 }}>
      {/* Header + Sprint Selector */}
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">Home</h5>
        <Form.Select
          size="sm"
          value={selectedSprintId || ''}
          onChange={(e) => setSelectedSprintId(e.target.value)}
          style={{ width: 200 }}
        >
          <option value="">All Sprints</option>
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Form.Select>
      </div>

      {/* AI Daily Summary */}
      {summary && (
        <Card className="mb-3" style={{ background: '#f3f4ff' }}>
          <Card.Body>
            {summary.dailyBriefing?.headline && (
              <div className="fw-semibold mb-1">{summary.dailyBriefing.headline}</div>
            )}
            {summary.dailyBriefing?.body && (
              <div style={{ fontSize: 14 }} className="mb-1">{summary.dailyBriefing.body}</div>
            )}
            {summary.dailyBriefing?.checklist && (
              <div className="text-muted" style={{ fontSize: 13 }}>{summary.dailyBriefing.checklist}</div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Tabs: Tasks | Stories | Goals */}
      <div className="mobile-filter-tabs mb-3">
        <div className="btn-group w-100" role="group">
          {(['tasks','stories','goals'] as TabKey[]).map(key => (
            <Button
              key={key}
              variant={activeTab === key ? 'primary' : 'outline-primary'}
              size="sm"
              onClick={() => setActiveTab(key)}
            >
              {key === 'tasks' ? 'Tasks' : key === 'stories' ? 'Stories' : 'Goals'}
            </Button>
          ))}
        </div>
      </div>

      {/* Content */}
      {activeTab === 'tasks' && (
        <div>
          {loading ? (
            <div className="text-center p-4"><Spinner animation="border" size="sm" /></div>
          ) : pendingTasks.length === 0 ? (
            <Card className="text-center p-4">
              <Card.Body>
                <div className="text-muted">No tasks pending.</div>
              </Card.Body>
            </Card>
          ) : (
            <ListGroup>
              {pendingTasks.map(task => {
                const story = task.parentType === 'story' ? storiesById.get(task.parentId) : undefined;
                const goal = story?.goalId ? goalsById.get(story.goalId) : undefined;
                const pr = getPriorityBadge(task.priority);
                return (
                  <ListGroup.Item key={task.id} className="mobile-task-item d-flex align-items-start">
                    <div className="me-3 mt-1">
                      <Form.Check
                        type="checkbox"
                        checked={task.status === 2}
                        onChange={(e) => updateTaskField(task, { status: e.target.checked ? 2 : 0 })}
                      />
                    </div>
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="fw-semibold" style={{ lineHeight: 1.2 }}>{task.title}</div>
                        <Badge bg={pr.bg}>{pr.text}</Badge>
                      </div>
                      {(story || goal) && (
                        <div className="text-muted small mb-1">
                          {story?.title}{goal ? ` → ${goal.title}` : ''}
                        </div>
                      )}
                      <div className="d-flex align-items-center gap-2">
                        <Form.Select
                          size="sm"
                          value={Number(task.status)}
                          onChange={(e) => updateTaskField(task, { status: Number(e.target.value) as any })}
                          style={{ width: 160 }}
                        >
                          {ChoiceHelper.getOptions('task','status').map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </Form.Select>
                        <Form.Control
                          size="sm"
                          type="date"
                          value={task.dueDate ? new Date(task.dueDate).toISOString().slice(0,10) : ''}
                          onChange={(e) => {
                            const val = e.target.value ? new Date(e.target.value + 'T00:00:00').getTime() : undefined;
                            updateTaskField(task, { dueDate: val as any });
                          }}
                          style={{ maxWidth: 160 }}
                        />
                        <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('task', task.id)}>Note</Button>
                      </div>
                    </div>
                  </ListGroup.Item>
                );
              })}
            </ListGroup>
          )}
        </div>
      )}

      {activeTab === 'stories' && (
        <ListGroup>
          {stories.map(story => (
            <ListGroup.Item key={story.id} className="d-flex align-items-start">
              <div className="flex-grow-1">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="fw-semibold">{story.title}</div>
                  <Badge bg={getBadgeVariant(story.status)}>{getStatusName(story.status)}</Badge>
                </div>
                <div className="text-muted small mb-2">{goalsById.get(story.goalId)?.title || '—'}</div>
                <div className="d-flex align-items-center gap-2">
                  <Form.Select
                    size="sm"
                    value={Number(story.status)}
                    onChange={(e) => updateStoryField(story, { status: Number(e.target.value) as any })}
                    style={{ width: 180 }}
                  >
                    {ChoiceHelper.getOptions('story','status').map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Form.Select>
                  <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('story', story.id)}>Add Note</Button>
                </div>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}

      {activeTab === 'goals' && (
        <ListGroup>
          {goals.map(goal => (
            <ListGroup.Item key={goal.id} className="d-flex align-items-start">
              <div className="flex-grow-1">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="fw-semibold">{goal.title}</div>
                  <Badge bg={getBadgeVariant(goal.status)}>{getStatusName(goal.status)}</Badge>
                </div>
                <div className="d-flex align-items-center gap-2 mt-1">
                  <Form.Select
                    size="sm"
                    value={Number(goal.status)}
                    onChange={(e) => updateGoalField(goal, { status: Number(e.target.value) as any })}
                    style={{ width: 200 }}
                  >
                    {ChoiceHelper.getOptions('goal','status').map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </Form.Select>
                  <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('goal', goal.id)}>Add Note</Button>
                </div>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      )}

      <Modal show={!!noteModal?.show} onHide={() => setNoteModal(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Add Note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control as="textarea" rows={4} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Write a quick update..." />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setNoteModal(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveNote} disabled={savingNote || !noteText.trim()}>
            {savingNote ? <Spinner animation="border" size="sm" /> : 'Save Note'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default MobileHome;

