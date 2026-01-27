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
import { extractWeatherSummary, extractWeatherTemp, formatWeatherLine } from '../utils/weatherFormat';

type TabKey = 'overview' | 'tasks' | 'stories' | 'goals';

const MobileHome: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [prioritySource, setPrioritySource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [noteModal, setNoteModal] = useState<{ type: 'task'|'story'|'goal'; id: string; show: boolean } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const briefWeatherSummary = extractWeatherSummary(summary?.dailyBrief?.weather);
  const briefWeatherTemp = extractWeatherTemp(summary?.dailyBrief?.weather);
  const worldWeatherLine = formatWeatherLine(summary?.worldSummary?.weather);
  const renderBriefText = (value: any): string => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (!value || typeof value !== 'object') return '';
    return (
      value.title ||
      value.headline ||
      value.summary ||
      value.text ||
      ''
    );
  };

  // Mobile override: if no explicit sprint is selected, prefer the active sprint
  useEffect(() => {
    if (!sprints || !sprints.length) return;
    if (selectedSprintId !== undefined && selectedSprintId !== null && selectedSprintId !== '') return;
    const hasSavedPreference = (() => {
      try {
        const saved = localStorage.getItem('bob_selected_sprint');
        return saved !== null && saved !== undefined;
      } catch {
        return false;
      }
    })();
    if (hasSavedPreference) return;
    const active = sprints.find(s => (s.status ?? 0) === 1) || sprints[0];
    if (active?.id) setSelectedSprintId(active.id);
  }, [sprints, selectedSprintId, setSelectedSprintId]);

  // Subscribe to Daily Summary (AI) - latest for user
  useEffect(() => {
    if (!currentUser?.uid) { setSummary(null); return; }
    const q = query(
      collection(db, 'daily_summaries'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('generatedAt', 'desc'),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      const doc0 = snap.docs[0]?.data() as any;
      const sum = doc0?.summary || null;
      setSummary(sum);
      if (sum?.aiFocus) {
        const mode = sum.aiFocus.mode === 'fallback' ? 'Heuristic focus (AI unavailable)' : `Model: ${sum.aiFocus.model || 'AI'}`;
        setPrioritySource(mode);
      } else {
        setPrioritySource(null);
      }
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
          style={{ width: 200, WebkitAppearance: 'none', appearance: 'none', backgroundImage: 'none' as any }}
        >
          {sprints.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Form.Select>
      </div>

      {/* AI Daily Summary + Focus */}
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
            {!summary.dailyBriefing && summary.dailyBrief && (
              <>
                {Array.isArray(summary.dailyBrief.lines) && summary.dailyBrief.lines.length > 0 && (
                  <ul className="mb-2 small">
                    {summary.dailyBrief.lines.slice(0, 4).map((line: any, idx: number) => {
                      const text = renderBriefText(line);
                      if (!text) return null;
                      return <li key={idx}>{text}</li>;
                    })}
                  </ul>
                )}
                {briefWeatherSummary && (
                  <div className="text-muted small mb-1">
                    Weather: {briefWeatherSummary}
                    {briefWeatherTemp ? ` (${briefWeatherTemp})` : ''}
                  </div>
                )}
                {Array.isArray(summary.dailyBrief.news) && summary.dailyBrief.news.length > 0 && (
                  <div className="mt-2">
                    <div className="fw-semibold" style={{ fontSize: 14 }}>News</div>
                    <ul className="mb-0 small">
                      {summary.dailyBrief.news.slice(0, 3).map((item: any, idx: number) => {
                        const text = renderBriefText(item);
                        if (!text) return null;
                        return <li key={idx}>{text}</li>;
                      })}
                    </ul>
                  </div>
                )}
              </>
            )}
            {Array.isArray(summary?.aiFocus?.items) && summary.aiFocus.items.length > 0 && (
              <div className="mt-2">
                <div className="fw-semibold" style={{ fontSize: 14 }}>AI focus</div>
                {prioritySource && <div className="text-muted small mb-1">Source: {prioritySource}</div>}
                <ul className="mb-0 small">
                  {summary.aiFocus.items.slice(0, 3).map((it: any, idx: number) => (
                    <li key={idx}>
                      {[it.ref, it.title || it.summary].filter(Boolean).join(' — ') || 'Focus'}{it.rationale || it.nextStep ? ` — ${it.rationale || it.nextStep}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card.Body>
        </Card>
      )}

      {/* Tabs: Overview | Tasks | Stories | Goals */}
      <div className="mobile-filter-tabs mb-3">
        <div className="btn-group w-100" role="group">
          {(['overview','tasks','stories','goals'] as TabKey[]).map(key => (
            <Button
              key={key}
              variant={activeTab === key ? 'primary' : 'outline-primary'}
              size="sm"
              onClick={() => setActiveTab(key)}
            >
              {key === 'overview' ? 'Overview' : key === 'tasks' ? 'Tasks' : key === 'stories' ? 'Stories' : 'Goals'}
            </Button>
          ))}
        </div>
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div>
          {summary && (
            <Card className="mb-3" style={{ background: 'linear-gradient(90deg,#eef2ff,#fdf2f8)' }}>
              <Card.Body>
                {summary.dailyBriefing?.headline && (
                  <div className="fw-semibold mb-1" style={{ fontSize: 16 }}>{summary.dailyBriefing.headline}</div>
                )}
                {summary.dailyBriefing?.body && (
                  <div style={{ fontSize: 14 }} className="mb-2">{summary.dailyBriefing.body}</div>
                )}
                {summary.dailyBriefing?.checklist && (
                  <div className="text-muted" style={{ fontSize: 13 }}>{summary.dailyBriefing.checklist}</div>
                )}
              </Card.Body>
            </Card>
          )}

          <div className="d-grid gap-2 mb-3" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <Card style={{ background: '#ecfeff' }}><Card.Body>
              <div className="small text-muted">Tasks today</div>
              <div className="fs-5 fw-semibold">{tasks.filter(t => t.status !== 2 && t.dueDate && new Date(t.dueDate).toDateString() === new Date().toDateString()).length}</div>
            </Card.Body></Card>
            <Card style={{ background: '#fef3c7' }}><Card.Body>
              <div className="small text-muted">Overdue</div>
              <div className="fs-5 fw-semibold">{tasks.filter(t => t.status !== 2 && t.dueDate && t.dueDate < Date.now() - 86400000).length}</div>
            </Card.Body></Card>
            <Card style={{ background: '#dcfce7' }}><Card.Body>
              <div className="small text-muted">Stories done</div>
              <div className="fs-5 fw-semibold">{stories.filter(s => s.status === 4).length}</div>
            </Card.Body></Card>
            <Card style={{ background: '#fee2e2' }}><Card.Body>
              <div className="small text-muted">Chores/Routines</div>
              <div className="fs-6">{(summary?.choresDue?.length || 0) + (summary?.routinesDue?.length || 0)} due</div>
            </Card.Body></Card>
          </div>

          {summary?.priorities?.items?.length > 0 && (
            <Card className="mb-3" style={{ background: '#f0f9ff' }}>
              <Card.Header className="py-2" style={{ background: 'transparent', border: 'none' }}>
                <strong>Today’s Priorities</strong>
              </Card.Header>
              <ListGroup variant="flush">
                {summary.priorities.items.slice(0, 5).map((it: any, idx: number) => (
                  <ListGroup.Item key={idx} className="d-flex justify-content-between align-items-center" style={{ fontSize: 14 }}>
                    <span>{it.title || it.id || it.ref || 'Task'}</span>
                    <Badge bg={idx < 2 ? 'danger' : idx < 4 ? 'warning' : 'secondary'}>{Math.round(it.score || 0)}</Badge>
                  </ListGroup.Item>
                ))}
              </ListGroup>
            </Card>
          )}

          {summary?.worldSummary && (
            <Card className="mb-3" style={{ background: '#fff7ed' }}>
              <Card.Header className="py-2" style={{ background: 'transparent', border: 'none' }}>
                <strong>World & Weather</strong>
              </Card.Header>
              <Card.Body>
                {renderBriefText(summary.worldSummary.summary) && (
                  <div className="mb-2" style={{ fontSize: 14 }}>{renderBriefText(summary.worldSummary.summary)}</div>
                )}
                {worldWeatherLine && (
                  <div className="text-muted" style={{ fontSize: 13 }}>{worldWeatherLine}</div>
                )}
              </Card.Body>
            </Card>
          )}
        </div>
      )}

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
