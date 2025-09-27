import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, Container, Row, Col, Button, Form, Badge, Modal } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { collection, onSnapshot, query, updateDoc, where, doc } from 'firebase/firestore';
import { db, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { Activity, Edit3, MessageSquareText, Wand2, BookOpen } from 'lucide-react';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import ModernStoriesTable from '../../components/ModernStoriesTable';
import EditGoalModal from '../../components/EditGoalModal';
import { Goal, Sprint, Story, Task } from '../../types';
import './ThemeRoadmap.css';
import logger from '../../utils/logger';
import GLOBAL_THEMES, { getThemeById, migrateThemeValue } from '../../constants/globalThemes';
import { useSidebar } from '../../contexts/SidebarContext';

type RoadmapCard = Goal & { storyCount?: number; openTaskCount?: number };

interface ThemeRoadmapProps { onBackToTimeline?: () => void }

const ThemeRoadmap: React.FC<ThemeRoadmapProps> = ({ onBackToTimeline }) => {
  const { currentUser } = useAuth();

  // Data
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  // UI
  const [searchTerm, setSearchTerm] = useState('');
  const [noteGoalId, setNoteGoalId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [showActivityStream, setShowActivityStream] = useState(false);
  const [activityGoalId, setActivityGoalId] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<any[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) return;

    const unsubs: (() => void)[] = [];

    const qGoals = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    unsubs.push(onSnapshot(qGoals, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Goal[];
      setGoals(data);
      logger.debug('roadmap', 'Goals snapshot', { count: data.length });
    }));

    const qStories = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    unsubs.push(onSnapshot(qStories, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Story[];
      setStories(data);
    }));

    const qTasks = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
    unsubs.push(onSnapshot(qTasks, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Task[];
      setTasks(data);
    }));

    setLoading(false);
    return () => unsubs.forEach(u => u());
  }, [currentUser?.uid]);

  // Themes from Settings (no hard-coded list)
  const themes = GLOBAL_THEMES.map(t => ({ id: t.id, name: t.name || t.label, color: t.color }));
  const { showSidebar } = useSidebar();

  // Derived counts
  const storiesByGoal = useMemo(() => {
    const counts: Record<string, number> = {};
    stories.forEach(s => {
      counts[s.goalId] = (counts[s.goalId] || 0) + 1;
    });
    return counts;
  }, [stories]);

  const doneStoriesByGoal = useMemo(() => {
    const done: Record<string, number> = {};
    stories.forEach(s => {
      if (s.status === 4) {
        done[s.goalId] = (done[s.goalId] || 0) + 1;
      }
    });
    return done;
  }, [stories]);

  const openTasksByGoal = useMemo(() => {
    const storyById = new Map(stories.map(s => [s.id, s]));
    const goalMap: Record<string, number> = {};
    tasks.forEach(t => {
      let gid = t.goalId;
      if (!gid && t.parentType === 'story') {
        const st = storyById.get(t.parentId);
        gid = st?.goalId;
      }
      if (!gid) return;
      if (t.status !== 2) goalMap[gid] = (goalMap[gid] || 0) + 1;
    });
    return goalMap;
  }, [tasks, stories]);

  const filteredGoals = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return goals
      .filter(g => !term || g.title.toLowerCase().includes(term))
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));
  }, [goals, searchTerm]);

  const goalsByTheme = useMemo(() => {
    const grouped: Record<number, RoadmapCard[]> = {};
    filteredGoals.forEach(g => {
      const themeId = migrateThemeValue(g.theme || 0);
      grouped[themeId] = grouped[themeId] || [];
      grouped[themeId].push({
        ...g,
        storyCount: storiesByGoal[g.id] || 0,
        openTaskCount: openTasksByGoal[g.id] || 0
      });
    });
    return grouped;
  }, [filteredGoals, storiesByGoal, openTasksByGoal]);

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, goal: Goal) => {
    e.dataTransfer.setData('text/plain', goal.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDropOnTheme = async (e: React.DragEvent, themeId: number) => {
    e.preventDefault();
    const goalId = e.dataTransfer.getData('text/plain');
    if (!goalId) return;

    const goal = goals.find(g => g.id === goalId);
    if (!goal || goal.theme === themeId) return;

    try {
      await updateDoc(doc(db, 'goals', goalId), { theme: themeId, updatedAt: Date.now() });
      if (currentUser) {
        await ActivityStreamService.logFieldChange(
          goalId,
          'goal',
          currentUser.uid,
          currentUser.email || '',
          'theme',
          goal.theme,
          themeId,
          'personal',
          (goal as any).ref || '',
          'human'
        );
      }
    } catch (err) {
      console.error('Theme change failed', err);
    }
  };

  const handleAllowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleGenerateStories = useCallback(async (goal: Goal) => {
    try {
      if (!currentUser) return;
      const callable = httpsCallable(functions, 'generateStoriesForGoal');
      await callable({ goalId: goal.id });
    } catch (e: any) {
      console.error('generateStoriesForGoal failed', e);
      alert('Failed to trigger AI story generation: ' + (e?.message || 'unknown'));
    }
  }, [currentUser]);

  useEffect(() => {
    if (!activityGoalId) return;
    const unsub = ActivityStreamService.subscribeToActivityStream(activityGoalId, setActivityItems);
    return () => unsub();
  }, [activityGoalId]);

  const computeStoryProgress = (g: Goal) => {
    const total = storiesByGoal[g.id] || 0;
    const done = doneStoriesByGoal[g.id] || 0;
    if (!total) return 0;
    return Math.round((done / total) * 100);
  };

  if (loading) {
    return (
      <Container fluid className="p-4">
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading roadmap...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container fluid className="theme-roadmap p-0">
      <Card className="border-0 shadow-sm">
        <Card.Header style={{ backgroundColor: 'var(--card)', borderBottom: '1px solid var(--line)' }}>
          <Row className="align-items-center">
            <Col md={6}>
              <h4 className="mb-0 d-flex align-items-center">
                Roadmap by Theme
              </h4>
            </Col>
            <Col md={6} className="text-end">
              <div className="d-inline-flex gap-2 align-items-center justify-content-end">
                <Form.Control
                  size="sm"
                  style={{ maxWidth: 280 }}
                  type="text"
                  placeholder="Search goals..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {onBackToTimeline && (
                  <Button size="sm" variant="outline-secondary" onClick={onBackToTimeline} title="Switch to Timeline">
                    Timeline
                  </Button>
                )}
              </div>
            </Col>
          </Row>
        </Card.Header>
      </Card>

      <div className="theme-roadmap-board">
        {themes.map(theme => (
          <div
            key={theme.id}
            className="theme-column"
            onDragOver={handleAllowDrop}
            onDrop={(e) => handleDropOnTheme(e, theme.id)}
          >
            <div className="theme-column-header" style={{ borderBottomColor: theme.color }}>
              <div className="d-flex align-items-center justify-content-between">
                <div className="d-flex align-items-center">
                  <div className="theme-dot me-2" style={{ backgroundColor: theme.color }} />
                  <strong>{theme.name}</strong>
                </div>
                <Badge bg="secondary">
                  {(goalsByTheme[theme.id]?.length || 0)}
                </Badge>
              </div>
            </div>

            <div className="theme-column-body">
              {(goalsByTheme[theme.id] || []).map(goal => (
                <Card
                  key={goal.id}
                  className="goal-card border shadow-sm"
                  style={{ borderColor: theme.color, borderWidth: 2, background: `linear-gradient(180deg, ${theme.color}22, ${theme.color}10)` }}
                  draggable
                  onClick={() => { /* no-op to avoid hijacking drag */ }}
                  onDragStart={(e) => handleDragStart(e, goal)}
                >
                  <Card.Body className="p-2">
                    <div className="d-flex align-items-start justify-content-between">
                      <div className="me-2" style={{ minWidth: 0 }}>
                        <div className="fw-semibold text-truncate" title={goal.title}>{goal.title}</div>
                        <div className="small text-muted">
                          {goal.startDate ? new Date(Number(goal.startDate)).toLocaleDateString() : '—'}
                          {' '}–{' '}
                          {(goal.endDate ? new Date(Number(goal.endDate)) : goal.targetDate ? new Date(goal.targetDate) : null)?.toLocaleDateString() || '—'}
                        </div>
                      </div>
                      <Button
                        className="btn btn-light btn-sm py-0 px-1"
                        title="Edit Goal"
                        onMouseDown={(e: any) => e.stopPropagation()}
                        onClick={(e: any) => { e.stopPropagation(); setEditGoal(goal); }}
                      >
                        <Edit3 size={14} />
                      </Button>
                    </div>

                    <div className="mt-2 d-flex align-items-center gap-2 flex-wrap">
                      <Badge bg={goal.status === 2 ? 'success' : goal.status === 3 ? 'danger' : 'primary'}>
                        {goal.status === 2 ? 'Complete' : goal.status === 3 ? 'Blocked' : 'Active'}
                      </Badge>
                      {typeof goal.priority !== 'undefined' && (
                        <Badge bg="outline-secondary" text="dark">P{goal.priority}</Badge>
                      )}
                      <Badge bg="outline-secondary" text="dark">{goal.storyCount || 0} stories</Badge>
                      {!!goal.openTaskCount && <Badge bg="outline-secondary" text="dark">{goal.openTaskCount} open</Badge>}
                    </div>

                    {/* Time progress */}
                    <div className="mt-2" title={`Progress: ${doneStoriesByGoal[goal.id] || 0}/${storiesByGoal[goal.id] || 0} stories`}>
                      <div className="progress" style={{ height: 6, backgroundColor: 'var(--line)' }}>
                        <div
                          className="progress-bar"
                          role="progressbar"
                          style={{ width: `${computeStoryProgress(goal)}%`, backgroundColor: theme.color }}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        />
                      </div>
                    </div>

                    <div className="mt-2 d-flex align-items-center gap-1">
                      <button className="btn btn-light btn-sm py-0 px-1" title="Generate stories with AI" onClick={(e) => { e.stopPropagation(); handleGenerateStories(goal); }}>
                        <Wand2 size={14} />
                      </button>
                      <button
                        className="btn btn-light btn-sm py-0 px-1"
                        title="View activity"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActivityGoalId(goal.id);
                          setShowActivityStream(true);
                        }}
                      >
                        <Activity size={14} />
                      </button>
                      <button className="btn btn-light btn-sm py-0 px-1" title="View stories" onClick={(e) => { e.stopPropagation(); setSelectedGoalId(goal.id); }}>
                        <BookOpen size={14} />
                      </button>
                      <button className="btn btn-light btn-sm py-0 px-1" title="Add note" onClick={(e) => { e.stopPropagation(); setNoteGoalId(goal.id); setNoteDraft(''); }}>
                        <MessageSquareText size={14} />
                      </button>
                    </div>
                  </Card.Body>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Activity Stream Sidebar */}
      {showActivityStream && (
        <div className="activity-stream-sidebar position-fixed end-0 top-0 h-100 shadow-lg border-start" style={{ width: '400px', zIndex: 1000, backgroundColor: 'var(--panel)', borderLeft: '1px solid var(--line)' }}>
          <div className="p-3 border-bottom d-flex justify-content-between align-items-center">
            <h5 className="mb-0 d-flex align-items-center">Activity Stream</h5>
            <Button variant="outline-secondary" size="sm" onClick={() => setShowActivityStream(false)}>×</Button>
          </div>
          <div className="p-3" style={{ height: 'calc(100% - 70px)', overflow: 'auto' }}>
            {activityItems.length === 0 ? (
              <p className="text-muted">No recent activity.</p>
            ) : (
              <div className="space-y-3">
                {activityItems.map((a) => (
                  <Card key={a.id} className="border">
                    <Card.Body className="p-3">
                      <div className="d-flex align-items-center gap-2 py-1">
                        <span>{ActivityStreamService.formatActivityIcon(a.activityType)}</span>
                        <div className="flex-grow-1">
                          <div className="small">{a.description}</div>
                          <div className="text-muted" style={{ fontSize: 12 }}>{a.userEmail || a.userId}</div>
                        </div>
                      </div>
                    </Card.Body>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Selected Goal Stories Panel */}
      {selectedGoalId && (
        <Card className="border-top rounded-0 mt-3" style={{ maxHeight: '40vh', overflow: 'auto' }}>
          <Card.Header className="d-flex justify-content-between align-items-center">
            <div>
              <strong>Stories for goal</strong>
              <span className="ms-2 text-muted">{goals.find(g => g.id === selectedGoalId)?.title}</span>
            </div>
            <Button size="sm" variant="outline-secondary" onClick={() => setSelectedGoalId(null)}>Close</Button>
          </Card.Header>
          <Card.Body>
            <ModernStoriesTable
              stories={stories}
              goals={goals}
              goalId={selectedGoalId}
              onStoryUpdate={async () => {}}
              onStoryDelete={async () => {}}
              onStoryPriorityChange={async () => {}}
              onStoryAdd={() => Promise.resolve()}
            />
          </Card.Body>
        </Card>
      )}

      {/* Add Note Modal */}
      <Modal show={!!noteGoalId} onHide={() => setNoteGoalId(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Add Note</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control as="textarea" rows={4} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write a quick note about this goal..." />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setNoteGoalId(null)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!noteGoalId || !currentUser) return;
            try {
              await updateDoc(doc(db, 'goals', noteGoalId), { recentNote: noteDraft, recentNoteAt: Date.now() });
              await ActivityStreamService.addNote(noteGoalId, 'goal', noteDraft, currentUser.uid, currentUser.email || undefined, 'personal', '', 'human');
              setNoteGoalId(null);
              setNoteDraft('');
            } catch (e) {
              console.error('Add note failed', e);
            }
          }}>Save Note</Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Goal Modal */}
      <EditGoalModal
        goal={editGoal}
        show={!!editGoal}
        onClose={() => setEditGoal(null)}
        currentUserId={currentUser?.uid || ''}
      />
    </Container>
  );
};

export default ThemeRoadmap;
