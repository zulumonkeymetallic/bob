import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Form, InputGroup, ListGroup, Spinner, Badge, Button } from 'react-bootstrap';
import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { Goal, Story, Task } from '../types';
import EditTaskModal from './EditTaskModal';
import EditStoryModal from './EditStoryModal';
import EditGoalModal from './EditGoalModal';
import { generateRef } from '../utils/referenceGenerator';
// Soft-deleted records (merged-away duplicates) must not be listed — see utils/softDelete.
import { excludeSoftDeleted } from '../utils/softDelete';
// The corpus is fetched once per session and filtered in memory; see utils/searchIndex for why
// the per-keystroke Firestore queries this replaced were as slow as they were.
import {
  fetchSearchIndex,
  loadCachedIndex,
  rankSearchRows,
  visibleForPersona,
  type SearchRow,
} from '../utils/searchIndex';

type ResultType = 'task' | 'story' | 'goal';

type SearchResult = SearchRow;

/** More than fits the dropdown; ranking means the tail is never what you wanted anyway. */
const MAX_RESULTS = 25;

/**
 * The floating results panel.
 *
 * Two things were wrong with the previous inline style. It set no `background`, and a
 * `<ListGroup>` paints nothing itself — only its `.list-group-item` children carry a background —
 * so the scroll gutter, the rounded corners and the strip below the last row let the page show
 * straight through, which read as the whole panel being semi-transparent.
 *
 * And it set `overflowY: 'auto'` while leaving `overflowX` at its `visible` default. CSS resolves
 * that combination by promoting the visible axis to `auto`, so one long title put a horizontal
 * scrollbar across the bottom of the dropdown. Pinning `overflowX` to `hidden` and letting titles
 * wrap is what actually removes it.
 */
const dropdownPanelStyle: React.CSSProperties = {
  position: 'absolute',
  top: '36px',
  right: 0,
  left: 0,
  zIndex: 1100,
  maxHeight: '320px',
  overflowY: 'auto',
  overflowX: 'hidden',
  background: 'var(--bs-body-bg)',
  border: '1px solid var(--bs-border-color)',
  borderRadius: '8px',
  boxShadow: '0 8px 24px var(--glass-shadow-color, rgba(0, 0, 0, 0.18))',
  // Overlay scrollbars render as a heavy dark slab over an opaque panel on macOS; thin, tinted
  // to the border colour, reads as part of the panel.
  scrollbarWidth: 'thin',
  scrollbarColor: 'var(--bs-border-color) transparent',
};

const GlobalSearchBar: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [queryText, setQueryText] = useState('');
  const [index, setIndex] = useState<SearchRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; variant?: 'warning' | 'danger' } | null>(null);
  const [creatingType, setCreatingType] = useState<ResultType | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [supportingGoals, setSupportingGoals] = useState<Goal[]>([]);
  const [activeModal, setActiveModal] = useState<ResultType | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const warmedRef = useRef(false);

  const normalizedQuery = useMemo(() => queryText.trim().toLowerCase(), [queryText]);

  const results = useMemo(() => {
    if (normalizedQuery.length < 2 || !index) return [];
    return rankSearchRows(visibleForPersona(index, currentPersona), normalizedQuery)
      .slice(0, MAX_RESULTS);
  }, [index, normalizedQuery, currentPersona]);

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

  /**
   * Warm the corpus. Cached copy first so a repeat visit is instant, then a background refresh
   * so anything created since arrives. Called on focus rather than on mount: this component is
   * in the toolbar of every page, and most page loads never touch search.
   */
  const warmIndex = useCallback(async () => {
    const uid = currentUser?.uid;
    if (!uid || warmedRef.current) return;
    warmedRef.current = true;

    const cached = loadCachedIndex(uid);
    if (cached) setIndex(cached);
    else setLoading(true);

    try {
      setIndex(await fetchSearchIndex(uid));
    } catch (err: any) {
      console.warn('[global-search] index load failed', err);
      // A cached corpus is still perfectly usable, so only surface a failure that left us with
      // nothing at all to search.
      if (!cached) {
        warmedRef.current = false;
        const msg = String(err?.message || '').toLowerCase();
        setToast({
          message: msg.includes('permission-denied')
            ? 'Search unavailable: permission denied.'
            : 'Could not load search. Please try again.',
          variant: msg.includes('permission-denied') ? 'danger' : 'warning',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  /**
   * Drop the corpus when the account changes. The cache is keyed by uid, so nothing leaks
   * across users on disk — but this component does not remount on a sign-out/sign-in, and
   * without this the previous user's rows would stay in state and keep being searched. Easy to
   * hit in practice: the demo and agent test accounts are signed into on the same browser.
   *
   * Declared above the warm-up so that on a uid change it is the reset that runs first and the
   * warm-up that runs second, rather than the other way round.
   */
  useEffect(() => {
    warmedRef.current = false;
    setIndex(null);
  }, [currentUser?.uid]);

  // Sign-in lands after first render on a cold load, so warm on whichever comes second.
  useEffect(() => {
    if (currentUser?.uid && queryText) void warmIndex();
  }, [currentUser, queryText, warmIndex]);

  /**
   * Refs already in use, for `generateRef`'s collision check. The quick-create handlers each
   * used to read 500 documents purely to build this list — the index already holds every ref
   * the user owns, and holds them for all three types rather than one persona's worth.
   */
  const existingRefs = useMemo(
    () => (index || []).map((row) => String(row.ref || '').trim()).filter(Boolean),
    [index],
  );

  /** Keep a just-created item searchable without paying for a full refetch. */
  const addToIndex = useCallback((row: SearchRow) => {
    setIndex((current) => [row, ...(current || [])]);
  }, []);

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
    const goals = excludeSoftDeleted(goalsSnap.docs.map((item) => ({ id: item.id, ...(item.data() as any) }))) as Goal[];
    if (!currentPersona) return goals;
    return goals.filter((goal) => !goal.persona || goal.persona === currentPersona);
  };

  const handleSelect = async (result: SearchResult) => {
    setOpen(false);
    setQueryText('');
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
      const sprintsSnap = await getDocs(query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        limit(200),
      ));

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
      addToIndex({
        id: storyRef.id,
        type: 'story',
        title: payload.title,
        ref: payload.ref,
        persona: currentPersona,
        updatedAt: Date.now(),
      });
      setSelectedStory(createdStory);
      const goals = await loadGoalsForModal();
      setSupportingGoals(goals);
      setActiveModal('story');
      setQueryText('');
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
      addToIndex({
        id: taskDoc.id,
        type: 'task',
        title: payload.title,
        ref: taskRef,
        persona: currentPersona,
        updatedAt: Date.now(),
      });
      setSelectedTask(createdTask);
      setActiveModal('task');
      setQueryText('');
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
      addToIndex({
        id: goalDoc.id,
        type: 'goal',
        title: payload.title,
        ref: goalRef,
        persona: currentPersona,
        updatedAt: Date.now(),
      });
      const goals = await loadGoalsForModal();
      setSupportingGoals(goals);
      setSelectedGoal(createdGoal);
      setActiveModal('goal');
      setQueryText('');
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
          onChange={(e) => {
            setQueryText(e.target.value);
            setOpen(e.target.value.trim().length >= 2);
          }}
          onFocus={() => {
            void warmIndex();
            if (normalizedQuery.length >= 2) setOpen(true);
          }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}
        />
        {loading && (
          <InputGroup.Text>
            <Spinner animation="border" size="sm" />
          </InputGroup.Text>
        )}
      </InputGroup>
      {open && results.length > 0 && (
        <ListGroup style={dropdownPanelStyle}>
          {results.map((r) => (
            <ListGroup.Item
              action
              key={`${r.type}-${r.id}`}
              onClick={() => handleSelect(r)}
              className="d-flex justify-content-between align-items-start gap-2"
            >
              {/* minWidth:0 is what lets a flex child actually shrink; without it a long title
                  pushes the row wider than the panel instead of wrapping inside it. */}
              <div style={{ minWidth: 0 }}>
                <div className="fw-semibold" style={{ overflowWrap: 'anywhere' }}>{r.title}</div>
                <div className="text-muted small">
                  {(r.ref || r.id)} · {r.type}
                </div>
              </div>
              <Badge
                bg={r.type === 'goal' ? 'success' : r.type === 'story' ? 'primary' : 'secondary'}
                style={{ flexShrink: 0 }}
              >
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
      {/* `index &&` matters: without it this panel flashes "No matches" for a frame between the
          first keystroke and the corpus arriving, offering to create something that exists. */}
      {open && !loading && index && results.length === 0 && normalizedQuery.length >= 2 && (
        <div
          style={{ ...dropdownPanelStyle, padding: '8px', fontSize: '12px' }}
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
