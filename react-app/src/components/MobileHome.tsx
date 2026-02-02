import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Container, Card, Button, Badge, ListGroup, Form, Modal, Spinner } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, orderBy, limit, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSprint } from '../contexts/SprintContext';
import { Goal, Story, Task, Sprint as SprintType } from '../types';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { ChoiceHelper, StoryStatus } from '../config/choices';
import { getBadgeVariant, getPriorityBadge, getStatusName } from '../utils/statusHelpers';
import { storyStatusText, taskStatusText } from '../utils/storyCardFormatting';
import { extractWeatherSummary, extractWeatherTemp, formatWeatherLine } from '../utils/weatherFormat';

type TabKey = 'overview' | 'tasks' | 'stories' | 'goals';

const THEME_COLORS: Record<number, string> = {
  1: '#22c55e', // Health
  2: '#6366f1', // Growth
  3: '#facc15', // Wealth
  4: '#ec4899', // Tribe
  5: '#fb923c', // Home
};

const formatShortDate = (value?: number) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const getStoryBadgeVariant = (status: any): string => {
  const label = storyStatusText(status);
  if (label === 'Done') return 'success';
  if (label === 'In Progress') return 'primary';
  if (label === 'Blocked') return 'danger';
  return 'secondary';
};

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
  const [plannerStats, setPlannerStats] = useState<any | null>(null);
  const [noteModal, setNoteModal] = useState<{ type: 'task'|'story'|'goal'; id: string; show: boolean } | null>(null);
  const [noteText, setNoteText] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [aiFocusOnly, setAiFocusOnly] = useState(true);
  const [aiThreshold, setAiThreshold] = useState(90);
  const [showCompleted, setShowCompleted] = useState(false);
  const [isSmallScreen, setIsSmallScreen] = useState<boolean>(typeof window !== 'undefined' ? window.innerWidth <= 768 : false);
  const [replanLoading, setReplanLoading] = useState(false);
  const [replanFeedback, setReplanFeedback] = useState<string | null>(null);
  const activePlanningSprints = useMemo(
    () => sprints.filter((s) => s.status === 0 || s.status === 1),
    [sprints]
  );
  const briefWeatherSummary = extractWeatherSummary(summary?.dailyBrief?.weather);
  const briefWeatherTemp = extractWeatherTemp(summary?.dailyBrief?.weather);
  const worldWeatherLine = formatWeatherLine(summary?.worldSummary?.weather);
  const formatPlannerLine = (ps: any) => {
    if (!ps) return 'Not yet run';
    const when = ps.lastRunAt
      ? new Date(ps.lastRunAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })
      : 'Unknown time';
    return `${when} · +${ps.created || 0} created · ${ps.replaced || 0} replaced · ${ps.blocked || 0} blocked`;
  };
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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handler = () => setIsSmallScreen(window.innerWidth <= 768);
    handler();
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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
    const pool = activePlanningSprints.length ? activePlanningSprints : sprints;
    const active = pool.find(s => (s.status ?? 0) === 1) || pool.find(s => (s.status ?? 0) === 0) || pool[0];
    if (active?.id) setSelectedSprintId(active.id);
  }, [sprints, activePlanningSprints, selectedSprintId, setSelectedSprintId]);

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

  // Subscribe to planner stats (replan/nightly)
  useEffect(() => {
    if (!currentUser?.uid) { setPlannerStats(null); return; }
    const ref = doc(db, 'planner_stats', currentUser.uid);
    const unsub = onSnapshot(ref, (snap) => {
      setPlannerStats(snap.exists() ? snap.data() : null);
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
  const storiesByRef = useMemo(() => new Map(stories.map(s => [(s.ref || s.id || '').toUpperCase(), s])), [stories]);
  const tasksByRef = useMemo(() => new Map(tasks.map(t => [(t.ref || t.id || '').toUpperCase(), t])), [tasks]);
  const goalsById = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals]);
  const currentSprint = useMemo(() => {
    const source = activePlanningSprints.length ? activePlanningSprints : sprints;
    if (!source || !source.length) return undefined;
    if (selectedSprintId) return source.find((s) => s.id === selectedSprintId);
    return source.find((s) => (s.status ?? 0) === 1) || source[0];
  }, [sprints, activePlanningSprints, selectedSprintId]);
  const resolveTimestamp = (value: any) => {
    if (value == null) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate().getTime();
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const normalizeAiScore = useCallback((raw: any) => {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
  }, []);

  const getTaskAiScore = useCallback((task: Task) => {
    return normalizeAiScore((task as any).aiCriticalityScore ?? (task as any).metadata?.aiScore ?? (task as any).metadata?.aiCriticalityScore ?? null);
  }, [normalizeAiScore]);

  const getStoryAiScore = useCallback((story: Story) => {
    return normalizeAiScore((story.metadata?.aiScore ?? story.metadata?.aiCriticalityScore ?? (story as any).aiCriticalityScore ?? null));
  }, [normalizeAiScore]);

  const sprintDaysLeft = useMemo(() => {
    if (!currentSprint) return null;
    const endDateMs = resolveTimestamp(currentSprint.endDate);
    if (endDateMs == null) return null;
    const remainingMs = endDateMs - Date.now();
    return remainingMs <= 0 ? 0 : Math.ceil(remainingMs / 86400000);
  }, [currentSprint]);
  const storiesByGoal = useMemo(() => {
    const map = new Map<string, Story[]>();
    stories.forEach((story) => {
      const list = map.get(story.goalId) || [];
      list.push(story);
      map.set(story.goalId, list);
    });
    return map;
  }, [stories]);

  const sprintStories = useMemo(() => {
    if (!selectedSprintId) return stories;
    return stories.filter((story) => story.sprintId === selectedSprintId);
  }, [stories, selectedSprintId]);

  const sprintTasks = useMemo(() => {
    if (!selectedSprintId) return tasks;
    return tasks.filter((task) => task.sprintId === selectedSprintId);
  }, [tasks, selectedSprintId]);

  const sprintMetricsSummary = useMemo(() => {
    const totalStories = sprintStories.length;
    const doneStories = sprintStories.filter((story) => (typeof story.status === 'number' ? story.status >= 4 : String(story.status).toLowerCase().includes('done'))).length;
    const progressPercent = totalStories ? Math.round((doneStories / totalStories) * 100) : 0;

    const sprintStartMs = resolveTimestamp(currentSprint?.startDate);
    const sprintEndMs = resolveTimestamp(currentSprint?.endDate);

    let expectedProgress = 0;
    if (sprintStartMs && sprintEndMs && sprintEndMs > sprintStartMs) {
      const now = Date.now();
      const elapsed = Math.max(0, Math.min(now - sprintStartMs, sprintEndMs - sprintStartMs));
      expectedProgress = Math.min(100, Math.round((elapsed / (sprintEndMs - sprintStartMs)) * 100));
    }

    const totalOpenPoints = sprintTasks
      .filter((task) => task.status !== 2)
      .reduce((sum, task) => sum + (Number.isFinite(Number(task.points)) ? Number(task.points) : 1), 0);

    const behind = progressPercent < expectedProgress;
    return {
      totalStories,
      progressPercent,
      expectedProgress,
      totalOpenPoints,
      behind,
    };
  }, [sprintStories, sprintTasks, currentSprint]);

  const openNoteModal = (type: 'task'|'story'|'goal', id: string) => {
    setNoteText('');
    setNoteModal({ type, id, show: true });
  };

  const openDeepLink = (task: Task) => {
    const href = task.ref ? `/tasks/${task.ref}` : `/tasks/${task.id}`;
    window.open(href, '_blank');
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

  const handleReplan = useCallback(async () => {
    if (!currentUser) {
      setReplanFeedback('Please sign in to replan calendar.');
      return;
    }
    
    setReplanLoading(true);
    setReplanFeedback(null);
    try {
      const callable = httpsCallable(functions, 'replanCalendarNow');
      const response = await callable({ days: 7 });
      const payload = response.data as { rescheduled?: number; blocked?: number; created?: number };
      const parts: string[] = [];
      if (payload?.created) parts.push(`${payload.created} calendar entries created`);
      if (payload?.rescheduled) parts.push(`${payload.rescheduled} moved`);
      if (payload?.blocked) parts.push(`${payload.blocked} blocked`);
      setReplanFeedback(parts.length ? `Replan complete: ${parts.join(', ')}` : 'Replan complete. No entries needed moving.');
    } catch (err) {
      console.error('Calendar replan failed', err);
      setReplanFeedback('Replan failed. Please retry in a moment.');
    } finally {
      setReplanLoading(false);
    }
  }, [currentUser]);

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

  const resolveDateValue = (candidate: any): number | null => {
    if (!candidate) return null;
    if (typeof candidate === 'number') return candidate;
    if (typeof candidate === 'object' && typeof candidate.toDate === 'function') {
      return candidate.toDate().getTime();
    }
    const parsed = Date.parse(String(candidate));
    return Number.isNaN(parsed) ? null : parsed;
  };

  const getTaskDueValue = (task: Task) => {
    const candidate = task.dueDate || task.dueDateMs || task.targetDate || null;
    return resolveDateValue(candidate) ?? Infinity;
  };

  const pendingTasks = useMemo(() => {
    let base = showCompleted ? tasks : tasks.filter(t => t.status !== 2);
    if (aiFocusOnly) {
      base = base.filter((task) => {
        const aiScore = getTaskAiScore(task);
        return aiScore != null && aiScore >= aiThreshold;
      });
    }
    return base;
  }, [tasks, showCompleted, aiFocusOnly, aiThreshold, getTaskAiScore]);
  const sortedPendingTasks = useMemo(() => {
    return [...pendingTasks].sort((a, b) => {
      const aiA = getTaskAiScore(a) ?? 0;
      const aiB = getTaskAiScore(b) ?? 0;
      if (aiA !== aiB) return aiB - aiA;
      const dueA = getTaskDueValue(a);
      const dueB = getTaskDueValue(b);
      if (dueA !== dueB) return dueA - dueB;
      return (b.priority || 0) - (a.priority || 0);
    });
  }, [pendingTasks, getTaskAiScore]);

  const getStoryDueValue = (story: Story) => {
    const candidate = story.dueDate || story.targetDate || story.plannedStartDate || null;
    return resolveDateValue(candidate) ?? Infinity;
  };

  const filteredStories = useMemo(() => {
    let base = showCompleted ? stories : stories.filter(s => s.status !== 4);
    if (aiFocusOnly) {
      base = base.filter((story) => {
        const aiScore = getStoryAiScore(story);
        return aiScore != null && aiScore >= aiThreshold;
      });
    }
    return base;
  }, [stories, showCompleted, aiFocusOnly, aiThreshold, getStoryAiScore]);

  const sortedStories = useMemo(() => {
    return [...filteredStories].sort((a, b) => {
      const aiA = getStoryAiScore(a) ?? 0;
      const aiB = getStoryAiScore(b) ?? 0;
      if (aiA !== aiB) return aiB - aiA;
      const dueA = getStoryDueValue(a);
      const dueB = getStoryDueValue(b);
      if (dueA !== dueB) return dueA - dueB;
      return (b.priority || 0) - (a.priority || 0);
    });
  }, [filteredStories, getStoryAiScore]);

  return (
    <Container fluid className="p-2" style={{ maxWidth: 480, width: '100%', overflowX: 'hidden' }}>
      {/* Header + Sprint/Actions */}
      <div className="d-flex justify-content-between align-items-start mb-2 gap-2">
        <div>
          <h5 className="mb-0">Home</h5>
          {currentSprint && (
            <div className="text-muted small">
              {currentSprint.name} · {sprintDaysLeft != null ? `${sprintDaysLeft}d left` : 'No sprint assigned'}
            </div>
          )}
        </div>
        <div className="d-flex align-items-center gap-2 flex-wrap justify-content-end" style={{ minWidth: 0 }}>
          <Form.Select
            size="sm"
            value={selectedSprintId || ''}
            onChange={(e) => setSelectedSprintId(e.target.value)}
            style={{ width: isSmallScreen ? 150 : 200, WebkitAppearance: 'none', appearance: 'none', backgroundImage: 'none' as any }}
          >
            {(activePlanningSprints.length ? activePlanningSprints : sprints).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Form.Select>
          <Button size="sm" variant="outline-primary" disabled={replanLoading} onClick={handleReplan}>
            {replanLoading && <Spinner animation="border" size="sm" className="me-1" role="status" />}
            {replanLoading ? 'Replanning…' : 'Replan'}
          </Button>
        </div>
      </div>

      {/* Key metrics condensed into a single horizontal row */}
      <div
        className="d-flex gap-2 mb-2 flex-wrap"
        style={{ paddingBottom: 4 }}
      >
        <div
          style={{
            backgroundColor: 'rgba(59,130,246,0.08)',
            color: '#0b152c',
            padding: '6px 10px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 90,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Sprint days</div>
          <div>{sprintDaysLeft != null ? `${sprintDaysLeft}d` : '—'}</div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(14,116,144,0.08)',
            color: '#0c4a5a',
            padding: '6px 10px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 90,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Progress</div>
          <div>{sprintMetricsSummary.progressPercent}%</div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(16,185,129,0.08)',
            color: '#065f46',
            padding: '6px 10px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 100,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Expected</div>
          <div>{sprintMetricsSummary.expectedProgress}%</div>
        </div>
        <div
          style={{
            backgroundColor: 'rgba(237,100,166,0.08)',
            color: '#831843',
            padding: '6px 10px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 100,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Open pts</div>
          <div>{sprintMetricsSummary.totalOpenPoints}</div>
        </div>
        <div
          style={{
            backgroundColor: sprintMetricsSummary.behind ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
            color: sprintMetricsSummary.behind ? '#991b1b' : '#065f46',
            padding: '6px 10px',
            borderRadius: 10,
            fontWeight: 600,
            minWidth: 100,
            display: 'inline-block'
          }}
        >
          <div style={{ fontSize: 10, textTransform: 'uppercase' }}>Status</div>
          <div>{sprintMetricsSummary.behind ? 'Behind' : 'On track'}</div>
        </div>
      </div>
      {replanFeedback && (
        <div className="text-muted small mb-2">
          {replanFeedback}
        </div>
      )}
      {replanLoading && (
        <div className="mb-2 small d-flex align-items-center text-primary" role="status" aria-live="polite">
          <Spinner animation="border" size="sm" className="me-2" />
          Replan is in progress—calendar blocks are being created/updated for the chosen tasks.
        </div>
      )}

      {/* AI Daily Summary + Focus */}
      {/* Tabs: Overview | Tasks | Stories | Goals */}
      <div className="mobile-filter-tabs mb-3">
        <div className="btn-group w-100 flex-wrap" role="group">
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

      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <Form.Check
          type="switch"
          id="mobile-ai-focus"
          label={`AI score ≥ ${aiThreshold}`}
          checked={aiFocusOnly}
          onChange={(e) => setAiFocusOnly(e.target.checked)}
        />
        <Form.Group className="d-flex align-items-center gap-1 mb-0" style={{ minWidth: 120 }}>
          <Form.Label className="mb-0 small text-muted">AI threshold</Form.Label>
          <Form.Control
            type="number"
            min={0}
            max={100}
            value={aiThreshold}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (Number.isNaN(val)) {
                setAiThreshold(0);
                return;
              }
              setAiThreshold(Math.min(100, Math.max(0, val)));
            }}
            size="sm"
            style={{ width: 72 }}
          />
        </Form.Group>
        <Form.Check
          type="switch"
          id="mobile-show-completed"
          label="Show completed"
          checked={showCompleted}
          onChange={(e) => setShowCompleted(e.target.checked)}
        />
      </div>

      {/* Overview */}
      {activeTab === 'overview' && (
        <div>
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
                          {(() => {
                            const refKey = (it.ref || '').toUpperCase();
                            const matchedTask = refKey ? tasksByRef.get(refKey) : undefined;
                            const matchedStory = !matchedTask && refKey ? storiesByRef.get(refKey) : undefined;
                            const href = matchedTask
                              ? `/tasks/${matchedTask.id}`
                              : matchedStory
                                ? `/stories/${matchedStory.id}`
                                : undefined;
                            const label = [it.ref, it.title || it.summary].filter(Boolean).join(' — ') || 'Focus';
                            const rationale = it.rationale || it.nextStep ? ` — ${it.rationale || it.nextStep}` : '';
                            return href ? (
                              <>
                                <a href={href} className="text-decoration-none">{label}</a>{rationale}
                              </>
                            ) : (
                              <>
                                {label}{rationale}
                              </>
                            );
                          })()}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card.Body>
            </Card>
          )}

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

          <Card className="mb-3" style={{ background: '#eef2ff' }}>
            <Card.Body>
              <div className="d-flex justify-content-between align-items-center">
                <div>
                  <div className="small text-muted">AI Planning summary</div>
                  <div className="fw-semibold" style={{ fontSize: 14 }}>{formatPlannerLine(plannerStats)}</div>
                </div>
                <Badge bg="secondary" pill>
                  {plannerStats?.source || 'replan'}
                </Badge>
              </div>
            </Card.Body>
          </Card>

          {summary?.priorities?.items?.length > 0 && (
            <Card className="mb-3" style={{ background: '#f0f9ff' }}>
              <Card.Header className="py-2" style={{ background: 'transparent', border: 'none' }}>
                <strong>Today’s Priorities</strong>
              </Card.Header>
              <ListGroup variant="flush">
                {summary.priorities.items.slice(0, 5).map((it: any, idx: number) => (
                  <ListGroup.Item key={idx} className="d-flex justify-content-between align-items-center" style={{ fontSize: 14 }}>
                    <span>
                      {(() => {
                        const refKey = (it.ref || '').toUpperCase();
                        const matchedTask = refKey ? tasksByRef.get(refKey) : undefined;
                        const matchedStory = !matchedTask && refKey ? storiesByRef.get(refKey) : undefined;
                        const href = matchedTask
                          ? `/tasks/${matchedTask.id}`
                          : matchedStory
                            ? `/stories/${matchedStory.id}`
                            : undefined;
                        const label = it.title || it.id || it.ref || 'Task';
                        return href ? (
                          <a href={href} className="text-decoration-none">{label}</a>
                        ) : (
                          label
                        );
                      })()}
                    </span>
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
              {sortedPendingTasks.map(task => {
                const story = task.parentType === 'story' ? storiesById.get(task.parentId) : undefined;
                const goal = story?.goalId ? goalsById.get(story.goalId) : undefined;
                const pr = getPriorityBadge(task.priority);
                const themeColor = THEME_COLORS[goal?.theme || story?.theme || 0];
                const storyLabel = story ? `${story.ref} · ${story.title}` : task.ref;
                const goalLabel = goal ? `Goal: ${goal.title}` : 'Unlinked goal';
                const aiScore = getTaskAiScore(task);
                const isCriticalTask = (task.priority || 0) >= 4;
                return (
                  <ListGroup.Item
                    key={task.id}
                    className="mobile-task-item d-flex align-items-start"
                    style={themeColor ? { borderLeft: `4px solid ${themeColor}` } : undefined}
                  >
                    <div className="me-3 mt-1">
                      <Form.Check
                        type="checkbox"
                        checked={task.status === 2}
                        onChange={(e) => updateTaskField(task, { status: e.target.checked ? 2 : 0 })}
                      />
                    </div>
                    <div className="flex-grow-1">
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <div className="fw-semibold" style={{ lineHeight: 1.2 }}>{task.title}</div>
                          <div className="text-muted small">{storyLabel}</div>
                          <div className="text-muted small">{goalLabel}</div>
                        </div>
                        <div className="d-flex flex-column align-items-end gap-1">
                          <Badge bg={pr.bg}>{pr.text}</Badge>
                          {isCriticalTask && (
                            <Badge pill bg="warning" text="dark">Critical</Badge>
                          )}
                          {aiScore != null && (
                            <Badge pill bg="secondary">AI {Math.round(aiScore)}/100</Badge>
                          )}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2 mt-2 flex-nowrap" style={{ minWidth: 0 }}>
                        <Form.Select
                          size="sm"
                          value={Number(task.status)}
                          onChange={(e) => updateTaskField(task, { status: Number(e.target.value) as any })}
                          style={{ flex: 1, minWidth: 0 }}
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
                          style={{ flex: 1, minWidth: 0 }}
                        />
                      </div>
                      <div className="d-flex flex-wrap gap-2 mt-1 align-items-center small text-muted">
                        <span>Status: {taskStatusText(task.status)}</span>
                        <span>Due: {formatShortDate(task.dueDate)}</span>
                      </div>
                      <div className="d-flex flex-wrap gap-2 mt-2 align-items-center">
                        <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('task', task.id)}>Note</Button>
                        <Button variant="outline-primary" size="sm" onClick={() => openDeepLink(task)}>Open</Button>
                        {task.points != null && (
                          <Badge pill bg="dark">Pts {task.points}</Badge>
                        )}
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
          {sortedStories.map(story => {
            const goal = goalsById.get(story.goalId);
            const themeColor = THEME_COLORS[goal?.theme || story.theme || 0];
            const acceptance = story.acceptanceCriteria?.slice(0, 2).join(' · ');
            const isCriticalStory = (story.priority || 0) >= 4;
            const aiScore = getStoryAiScore(story);
            return (
              <ListGroup.Item
                key={story.id}
                className="mobile-task-item d-flex align-items-start"
                style={themeColor ? { borderLeft: `4px solid ${themeColor}` } : undefined}
              >
                <div className="flex-grow-1">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-semibold">{story.title}</div>
                      <div className="text-muted small">
                        {story.ref} · {goal ? `Goal: ${goal.title}` : 'No goal linked'}
                      </div>
                      {acceptance && (
                        <div className="text-muted small">{acceptance}</div>
                      )}
                    </div>
                    <div className="d-flex flex-column align-items-end gap-1">
                      <Badge bg={getStoryBadgeVariant(story.status)}>{storyStatusText(story.status)}</Badge>
                      {isCriticalStory && (
                        <Badge pill bg="warning" text="dark">Critical</Badge>
                      )}
                      {aiScore != null && (
                        <Badge pill bg="secondary">AI {Math.round(aiScore)}/100</Badge>
                      )}
                    </div>
                  </div>
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                    <Form.Select
                      size="sm"
                      value={Number(story.status)}
                      onChange={(e) => updateStoryField(story, { status: Number(e.target.value) as any })}
                      style={{ minWidth: 160 }}
                    >
                      {ChoiceHelper.getOptions('story','status').map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Form.Select>
                    <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('story', story.id)}>Add Note</Button>
                    <a
                      href={`https://bob.jc1.tech/stories/${story.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="small text-decoration-none text-muted"
                    >
                      Open story
                    </a>
                  </div>
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <Badge pill bg="dark">Pts {story.points || 0}</Badge>
                    {sprintDaysLeft != null && (
                      <Badge
                        pill
                        style={{
                          backgroundColor: themeColor || '#1f2937',
                          color: '#fff',
                          fontWeight: 500,
                        }}
                      >
                        {sprintDaysLeft}d sprint
                      </Badge>
                    )}
                  </div>
                </div>
              </ListGroup.Item>
            );
          })}
        </ListGroup>
      )}

      {activeTab === 'goals' && (
        <ListGroup>
          {goals.map(goal => {
            const themeColor = THEME_COLORS[goal.theme];
            const relatedStories = storiesByGoal.get(goal.id) || [];
            const doneStories = relatedStories.filter((s) => s.status === 4).length;
            const progressPercent = relatedStories.length ? Math.round((doneStories / relatedStories.length) * 100) : 0;
            return (
              <ListGroup.Item
                key={goal.id}
                className="mobile-task-item d-flex align-items-start"
                style={themeColor ? { borderLeft: `4px solid ${themeColor}` } : undefined}
              >
                <div className="flex-grow-1">
                  <div className="d-flex justify-content-between align-items-start">
                    <div>
                      <div className="fw-semibold">{goal.title}</div>
                      <div className="text-muted small">{goal.description || 'No description yet'}</div>
                      <div className="text-muted small">
                        Theme {goal.theme} · Target Year {goal.targetYear || 'N/A'}
                      </div>
                    </div>
                    <Badge bg={getBadgeVariant(goal.status)}>{getStatusName(goal.status)}</Badge>
                  </div>
                  <div className="d-flex flex-wrap gap-2 align-items-center mt-2">
                    <Form.Select
                      size="sm"
                      value={Number(goal.status)}
                      onChange={(e) => updateGoalField(goal, { status: Number(e.target.value) as any })}
                      style={{ minWidth: 180 }}
                    >
                      {ChoiceHelper.getOptions('goal','status').map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </Form.Select>
                    <Button variant="outline-secondary" size="sm" onClick={() => openNoteModal('goal', goal.id)}>Add Note</Button>
                    <a
                      href={`https://bob.jc1.tech/goals/${goal.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="small text-decoration-none text-muted"
                    >
                      Open goal
                    </a>
                  </div>
                  <div className="d-flex flex-wrap gap-2 mt-2">
                    <Badge pill bg="dark">{progressPercent}% stories done</Badge>
                    <Badge pill bg="secondary">{relatedStories.length} stories</Badge>
                    {sprintDaysLeft != null && (
                      <Badge
                        pill
                        style={{
                          backgroundColor: themeColor || '#1f2937',
                          color: '#fff',
                          fontWeight: 500,
                        }}
                      >
                        {sprintDaysLeft}d sprint
                      </Badge>
                    )}
                  </div>
                </div>
              </ListGroup.Item>
            );
          })}
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
