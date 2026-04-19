import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Form, InputGroup, ListGroup, Spinner, Badge, Button } from 'react-bootstrap';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, startAfter, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Story, Task } from '../types';
import EditTaskModal from './EditTaskModal';
import EditStoryModal from './EditStoryModal';
import EditGoalModal from './EditGoalModal';
import { generateRef } from '../utils/referenceGenerator';

type ResultType = 'task' | 'story' | 'goal';

interface SearchResult {
  id: string;
  ref?: string;
  title: string;
  type: ResultType;
}

const GlobalSearchBar: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant?: 'warning' | 'danger' } | null>(null);
  const [creatingType, setCreatingType] = useState<ResultType | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [supportingGoals, setSupportingGoals] = useState<Goal[]>([]);
  const [activeModal, setActiveModal] = useState<ResultType | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const normalizedQuery = useMemo(() => queryText.trim().toLowerCase(), [queryText]);
  const hasExactMatch = useMemo(
    () => results.some((result) => {
      const title = String(result.title || '').trim().toLowerCase();
      const ref = String(result.ref || '').trim().toLowerCase();
      return title === normalizedQuery || ref === normalizedQuery;
    }),
    [results, normalizedQuery],
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!currentUser || !currentPersona) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (normalizedQuery.length < 2) {
      setResults([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const owner = currentUser.uid;
        const matchesQuery = (row: any) => {
          const title = String(row.title || '').toLowerCase();
          const description = String(row.description || '').toLowerCase();
          const ref = String(row.ref || row.reference || row.referenceNumber || row.displayId || '').toLowerCase();
          return title.includes(normalizedQuery) || ref.includes(normalizedQuery) || description.includes(normalizedQuery);
        };
        const toResult = (row: any, type: ResultType): SearchResult => {
          const ref = row.ref || row.reference || row.referenceNumber || row.displayId || null;
          return {
            id: row.id,
            ref,
            title: row.title || row.id,
            type,
          };
        };
        const fetchSet = async (col: 'tasks' | 'stories' | 'goals', type: ResultType): Promise<SearchResult[]> => {
          console.log('[global-search] query start', { col, owner, persona: currentPersona, q: normalizedQuery });
          const baseConstraints = [
            collection(db, col),
            where('ownerUid', '==', owner),
            where('persona', '==', currentPersona),
            orderBy('updatedAt', 'desc'),
          ] as const;
          const firstPageSize = 30;
          const deepPageSize = 120;
          const maxDeepScanDocs = normalizedQuery.length >= 4 ? 600 : 360;
          const maxResultsPerType = 12;

          const firstSnap = await getDocs(query(...baseConstraints, limit(firstPageSize)));
          let scannedDocs = firstSnap.size;
          let lastDoc: any = firstSnap.docs[firstSnap.docs.length - 1] || null;
          const rows = firstSnap.docs.map((item) => ({ id: item.id, ...(item.data() as any) }));
          let matches = rows.filter(matchesQuery).map((row) => toResult(row, type));

          // If the recent window has no hits, scan older pages so stale-but-relevant items are still discoverable.
          while (
            matches.length === 0 &&
            normalizedQuery.length >= 3 &&
            lastDoc &&
            scannedDocs < maxDeepScanDocs
          ) {
            const nextSnap = await getDocs(query(
              ...baseConstraints,
              startAfter(lastDoc),
              limit(deepPageSize),
            ));
            if (nextSnap.empty) break;
            scannedDocs += nextSnap.size;
            lastDoc = nextSnap.docs[nextSnap.docs.length - 1] || null;
            const nextRows = nextSnap.docs.map((item) => ({ id: item.id, ...(item.data() as any) }));
            matches = nextRows.filter(matchesQuery).map((row) => toResult(row, type));
            if (nextSnap.size < deepPageSize) break;
          }

          const limited = matches.slice(0, maxResultsPerType);
          console.log('[global-search] fetched', {
            col,
            scannedDocs,
            firstPageSize,
            deepScanEnabled: normalizedQuery.length >= 3,
            matches: limited.length,
          });
          return limited;
        };

        const [taskResults, storyResults, goalResults] = await Promise.all([
          fetchSet('tasks', 'task'),
          fetchSet('stories', 'story'),
          fetchSet('goals', 'goal'),
        ]);

        const merged = [...taskResults, ...storyResults, ...goalResults].slice(0, 25);
        console.log('[global-search] results merged', { q: normalizedQuery, tasks: taskResults.length, stories: storyResults.length, goals: goalResults.length, merged: merged.length });
        setResults(merged);
        setOpen(true);
      } catch (err: any) {
        console.warn('[global-search] failed', err);
        const msg = err?.message || '';
        if (msg.includes('indexes?create_composite') || msg.toLowerCase().includes('failed-precondition')) {
          setToast({ message: 'Search index is still building. Try again in a minute.', variant: 'warning' });
        } else if (msg.toLowerCase().includes('permission-denied')) {
          setToast({ message: 'Search unavailable: permission denied.', variant: 'danger' });
        } else {
          setToast({ message: 'Search failed. Please try again.', variant: 'warning' });
        }
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
  }, [currentPersona, currentUser, normalizedQuery]);

  const closeModal = () => {
    setActiveModal(null);
    setSelectedTask(null);
    setSelectedStory(null);
    setSelectedGoal(null);
  };

  const loadGoalsForModal = async (): Promise<Goal[]> => {
    if (!currentUser?.uid) return [];
    const goalsSnap = await getDocs(query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('updatedAt', 'desc'),
      limit(300),
    ));
    const goals = goalsSnap.docs.map((item) => ({ id: item.id, ...(item.data() as any) })) as Goal[];
    if (!currentPersona) return goals;
    return goals.filter((goal) => !goal.persona || goal.persona === currentPersona);
  };

  const handleSelect = async (result: SearchResult) => {
    setOpen(false);
    setQueryText('');
    setResults([]);
    try {
      const collectionName = result.type === 'task' ? 'tasks' : result.type === 'story' ? 'stories' : 'goals';
      const selectedSnap = await getDoc(doc(db, collectionName, result.id));
      if (!selectedSnap.exists()) {
        setToast({ message: 'This item no longer exists.', variant: 'warning' });
        return;
      }
      const selected = { id: selectedSnap.id, ...(selectedSnap.data() as any) } as any;

      if (result.type === 'task') {
        setSelectedTask(selected as Task);
        setActiveModal('task');
        return;
      }

      const goals = await loadGoalsForModal();
      setSupportingGoals(goals);
      if (result.type === 'story') {
        setSelectedStory(selected as Story);
        setActiveModal('story');
        return;
      }
      setSelectedGoal(selected as Goal);
      setActiveModal('goal');
    } catch (err) {
      console.warn('[global-search] select failed', err);
      setToast({ message: 'Could not open the selected item.', variant: 'warning' });
    }
  };

  const handleQuickCreateStory = async () => {
    if (!currentUser?.uid || !currentPersona || !normalizedQuery) return;
    setLoading(true);
    setOpen(false);
    try {
      const storiesSnap = await getDocs(query(
        collection(db, 'stories'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        limit(500),
      ));
      const sprintsSnap = await getDocs(query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        limit(200),
      ));
      const existingRefs = storiesSnap.docs
        .map((item) => String((item.data() as any)?.ref || '').trim())
        .filter(Boolean);

      const now = new Date();
      const dueDateMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime();
      const todaySprint = sprintsSnap.docs
        .map((item) => ({ id: item.id, ...(item.data() as any) }))
        .find((sprint: any) => {
          const startRaw = sprint.startDate || sprint.start || null;
          const endRaw = sprint.endDate || sprint.end || null;
          const startMs = typeof startRaw === 'number'
            ? startRaw
            : (typeof startRaw?.toMillis === 'function' ? startRaw.toMillis() : Date.parse(String(startRaw || '')));
          const endMs = typeof endRaw === 'number'
            ? endRaw
            : (typeof endRaw?.toMillis === 'function' ? endRaw.toMillis() : Date.parse(String(endRaw || '')));
          return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= dueDateMs && endMs >= dueDateMs;
        })?.id || null;

      const payload: any = {
        title: queryText.trim(),
        description: '',
        goalId: null,
        priority: 4,
        status: 2,
        persona: currentPersona,
        ownerUid: currentUser.uid,
        dueDate: dueDateMs,
        targetDate: dueDateMs,
        dueDateLocked: true,
        dueDateReason: 'user',
        timeOfDay: 'morning',
        sprintId: todaySprint || null,
        focusGoalOverride: true,
        ref: generateRef('story', existingRefs),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const storyRef = await addDoc(collection(db, 'stories'), payload);
      const createdStory = { id: storyRef.id, ...(payload as any) } as Story;
      setSelectedStory(createdStory);
      const goals = await loadGoalsForModal();
      setSupportingGoals(goals);
      setActiveModal('story');
      setQueryText('');
      setResults([]);
      setToast(null);
    } catch (err) {
      console.warn('[global-search] quick create story failed', err);
      setToast({ message: 'Could not create the story.', variant: 'warning' });
    } finally {
      setLoading(false);
    }
  };

  const handleQuickCreateTask = async () => {
    if (!currentUser?.uid || !currentPersona || !normalizedQuery) return;
    setCreatingType('task');
    setLoading(true);
    setOpen(false);
    try {
      const tasksSnap = await getDocs(query(
        collection(db, 'tasks'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        limit(500),
      ));
      const existingRefs = tasksSnap.docs
        .map((item) => String((item.data() as any)?.ref || '').trim())
        .filter(Boolean);
      const now = new Date();
      const dueDateMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0).getTime();
      const taskRef = generateRef('task', existingRefs);
      const payload: any = {
        title: queryText.trim(),
        description: '',
        parentType: 'story',
        parentId: '',
        sprintId: null,
        points: 1,
        estimateMin: 60,
        estimatedHours: 1,
        effort: 'M',
        priority: 4,
        status: 1,
        persona: currentPersona,
        ownerUid: currentUser.uid,
        dueDate: dueDateMs,
        dueDateLocked: true,
        dueDateReason: 'user',
        timeOfDay: 'morning',
        focusGoalOverride: true,
        ref: taskRef,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const taskDoc = await addDoc(collection(db, 'tasks'), payload);
      const createdTask = { id: taskDoc.id, ...(payload as any) } as Task;
      setSelectedTask(createdTask);
      setActiveModal('task');
      setQueryText('');
      setResults([]);
      setToast({ message: `Created task ${taskRef}` });
    } catch (err) {
      console.warn('[global-search] quick create task failed', err);
      setToast({ message: 'Could not create the task.', variant: 'warning' });
    } finally {
      setCreatingType(null);
      setLoading(false);
    }
  };

  const handleQuickCreateGoal = async () => {
    if (!currentUser?.uid || !currentPersona || !normalizedQuery) return;
    setCreatingType('goal');
    setLoading(true);
    setOpen(false);
    try {
      const goalsSnap = await getDocs(query(
        collection(db, 'goals'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona),
        limit(500),
      ));
      const existingRefs = goalsSnap.docs
        .map((item) => String((item.data() as any)?.ref || '').trim())
        .filter(Boolean);
      const goalRef = generateRef('goal', existingRefs);
      const payload: any = {
        title: queryText.trim(),
        description: '',
        ref: goalRef,
        theme: 1,
        status: 'active',
        priority: 4,
        persona: currentPersona,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const goalDoc = await addDoc(collection(db, 'goals'), payload);
      const createdGoal = { id: goalDoc.id, ...(payload as any) } as Goal;
      const goals = await loadGoalsForModal();
      setSupportingGoals(goals);
      setSelectedGoal(createdGoal);
      setActiveModal('goal');
      setQueryText('');
      setResults([]);
      setToast({ message: `Created goal ${goalRef}` });
    } catch (err) {
      console.warn('[global-search] quick create goal failed', err);
      setToast({ message: 'Could not create the goal.', variant: 'warning' });
    } finally {
      setCreatingType(null);
      setLoading(false);
    }
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', minWidth: '260px' }}>
      <InputGroup size="sm">
        <Form.Control
          placeholder="Search goals, stories, tasks"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          onFocus={() => normalizedQuery.length >= 2 && setOpen(true)}
        />
        {loading && (
          <InputGroup.Text>
            <Spinner animation="border" size="sm" />
          </InputGroup.Text>
        )}
      </InputGroup>
      {open && results.length > 0 && (
        <ListGroup
          style={{
            position: 'absolute',
            top: '36px',
            right: 0,
            left: 0,
            zIndex: 1100,
            maxHeight: '320px',
            overflowY: 'auto',
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
          }}
        >
          {results.map((r) => (
            <ListGroup.Item
              action
              key={`${r.type}-${r.id}`}
              onClick={() => handleSelect(r)}
              className="d-flex justify-content-between align-items-start"
            >
              <div>
                <div className="fw-semibold">{r.title}</div>
                <div className="text-muted small">
                  {(r.ref || r.id)} · {r.type}
                </div>
              </div>
              <Badge bg={r.type === 'goal' ? 'success' : r.type === 'story' ? 'primary' : 'secondary'}>
                {r.type}
              </Badge>
            </ListGroup.Item>
          ))}
          {!hasExactMatch && normalizedQuery.length >= 2 && (
            <ListGroup.Item className="d-flex justify-content-between align-items-center">
              <div>
                <div className="fw-semibold">Create “{queryText.trim()}”</div>
                <div className="text-muted small">
                  Default is story. You can also create a task or goal directly.
                </div>
              </div>
              <div className="d-flex gap-1">
                <Button
                  size="sm"
                  variant="outline-primary"
                  onClick={handleQuickCreateStory}
                  disabled={creatingType != null}
                >
                  {creatingType === 'story' ? '...' : 'Story'}
                </Button>
                <Button
                  size="sm"
                  variant="outline-secondary"
                  onClick={handleQuickCreateTask}
                  disabled={creatingType != null}
                >
                  {creatingType === 'task' ? '...' : 'Task'}
                </Button>
                <Button
                  size="sm"
                  variant="outline-success"
                  onClick={handleQuickCreateGoal}
                  disabled={creatingType != null}
                >
                  {creatingType === 'goal' ? '...' : 'Goal'}
                </Button>
              </div>
            </ListGroup.Item>
          )}
        </ListGroup>
      )}
      {open && !loading && results.length === 0 && normalizedQuery.length >= 2 && (
        <div
          style={{
            position: 'absolute',
            top: '36px',
            right: 0,
            left: 0,
            zIndex: 1100,
            background: 'var(--bs-body-bg)',
            border: '1px solid var(--bs-border-color)',
            padding: '8px',
            fontSize: '12px',
          }}
        >
          <div className="d-flex align-items-center justify-content-between gap-2">
            <span>No matches.</span>
            <div className="d-flex gap-1">
              <Button size="sm" variant="outline-primary" onClick={handleQuickCreateStory} disabled={creatingType != null}>
                {creatingType === 'story' ? '...' : 'Story'}
              </Button>
              <Button size="sm" variant="outline-secondary" onClick={handleQuickCreateTask} disabled={creatingType != null}>
                {creatingType === 'task' ? '...' : 'Task'}
              </Button>
              <Button size="sm" variant="outline-success" onClick={handleQuickCreateGoal} disabled={creatingType != null}>
                {creatingType === 'goal' ? '...' : 'Goal'}
              </Button>
            </div>
          </div>
        </div>
      )}
      {toast && (
        <div
          style={{
            position: 'absolute',
            top: '4px',
            right: '-4px',
            zIndex: 1200,
            fontSize: '12px',
            padding: '6px 10px',
            borderRadius: '6px',
            background: toast.variant === 'danger' ? '#f8d7da' : '#fff3cd',
            color: toast.variant === 'danger' ? '#842029' : '#664d03',
            border: `1px solid ${toast.variant === 'danger' ? '#f5c2c7' : '#ffe69c'}`,
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {toast.message}
        </div>
      )}
      <EditTaskModal
        show={activeModal === 'task' && !!selectedTask}
        task={selectedTask}
        onHide={closeModal}
        onUpdated={closeModal}
      />
      <EditStoryModal
        show={activeModal === 'story' && !!selectedStory}
        onHide={closeModal}
        story={selectedStory}
        goals={supportingGoals}
        onStoryUpdated={closeModal}
      />
      <EditGoalModal
        show={activeModal === 'goal' && !!selectedGoal}
        onClose={closeModal}
        goal={selectedGoal}
        currentUserId={currentUser?.uid || ''}
        allGoals={supportingGoals}
      />
    </div>
  );
};

export default GlobalSearchBar;
