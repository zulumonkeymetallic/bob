import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, getDay, parse, startOfWeek } from 'date-fns';
import { enGB } from 'date-fns/locale';
import {
  Alert, Badge, Button, ButtonGroup, Card, Form, Spinner,
} from 'react-bootstrap';
import {
  CheckCircle, Clock3, CornerUpLeft, Eye, EyeOff, ExternalLink, RefreshCw, Sparkles, Trash2, X,
} from 'lucide-react';
import { Calendar as RBC, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import {
  collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, updateDoc, where,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useNavigate } from 'react-router-dom';
import { db, functions } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useFocusGoals } from '../../hooks/useFocusGoals';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { useThemeAppearance } from '../../hooks/useThemeAppearance';
import { usePlannerCalendarEvents, type PlannerCalendarEvent, type PlannerFeedback } from '../../hooks/usePlannerCalendarEvents';
import { useUnifiedPlannerData } from '../../hooks/useUnifiedPlannerData';
import {
  buildPlannerItems,
  type PlannerCalendarBlockRow,
  type PlannerItem,
  type PlannerScheduledInstanceRow,
} from '../../utils/plannerItems';
import { getActiveFocusLeafGoalIds } from '../../utils/goalHierarchy';
import { getPriorityBadge } from '../../utils/statusHelpers';
import { getEntityAiScore } from '../../utils/top3';
import { schedulePlannerItem, normalizePlannerSchedulingError } from '../../utils/plannerScheduling';
import { applyPlannerDefer } from '../../utils/plannerDeferral';
import { goalThemeColor } from '../../utils/storyCardFormatting';
import DeferItemModal from '../DeferItemModal';
import FiveDayView from './FiveDayView';
import type { Goal, Story, Task } from '../../types';

type ItemTarget = {
  itemType: 'story' | 'task';
  itemId: string;
  title: string;
  scheduledBlockId?: string | null;
  scheduledInstanceId?: string | null;
  durationMinutes?: number | null;
};

const resolveEventTarget = (event: PlannerCalendarEvent): ItemTarget | null => {
  const storyId = event.block?.storyId || event.instance?.storyId;
  const taskId = event.block?.taskId;
  const durationMinutes = Math.max(15, Math.round((event.end.getTime() - event.start.getTime()) / 60000));
  if (storyId) {
    return {
      itemType: 'story', itemId: storyId, title: event.title,
      scheduledBlockId: event.block?.id || null, scheduledInstanceId: event.instance?.id || null, durationMinutes,
    };
  }
  if (taskId) {
    return {
      itemType: 'task', itemId: taskId, title: event.title,
      scheduledBlockId: event.block?.id || null, scheduledInstanceId: event.instance?.id || null, durationMinutes,
    };
  }
  return null;
};

const eventIconBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', color: '#fff', padding: 0,
  width: 14, height: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
};

interface PlannerEventContentProps {
  event: PlannerCalendarEvent;
  onBackToBacklog: (target: ItemTarget) => void;
  onDefer: (target: ItemTarget) => void;
  onComplete: (target: ItemTarget) => void;
  onDelete: (target: ItemTarget) => void;
}

const PlannerEventContent: React.FC<PlannerEventContentProps> = ({ event, onBackToBacklog, onDefer, onComplete, onDelete }) => {
  const [hovered, setHovered] = useState(false);
  const target = resolveEventTarget(event);
  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', height: '100%', overflow: 'hidden' }}
    >
      <div className="text-truncate" style={{ fontSize: 11, lineHeight: 1.2, paddingRight: target ? 58 : 0 }}>{event.title}</div>
      {target && hovered && (
        <div
          className="d-flex align-items-center gap-1"
          style={{ position: 'absolute', top: 0, right: 0, background: 'rgba(0,0,0,0.4)', borderRadius: 3, padding: '1px 3px' }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" title="Send back to backlog" onClick={(e) => { e.stopPropagation(); onBackToBacklog(target); }} style={eventIconBtnStyle}><CornerUpLeft size={10} /></button>
          <button type="button" title="Defer to another sprint" onClick={(e) => { e.stopPropagation(); onDefer(target); }} style={eventIconBtnStyle}><Clock3 size={10} /></button>
          <button type="button" title="Mark complete" onClick={(e) => { e.stopPropagation(); onComplete(target); }} style={eventIconBtnStyle}><CheckCircle size={10} /></button>
          <button type="button" title="Delete" onClick={(e) => { e.stopPropagation(); onDelete(target); }} style={eventIconBtnStyle}><Trash2 size={10} /></button>
        </div>
      )}
    </div>
  );
};

const locales = { 'en-GB': enGB } as const;
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date: Date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales,
});
const DragAndDropCalendar = withDragAndDrop(RBC as any);

const VISIBLE_DAYS = 5;
const THEME_OVERLAY_STORAGE_KEY = 'bob-sprint-week-planner-show-theme-allocations';

const dayStartMs = (date: Date | number) => {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
};

const estimateDurationMinutes = (item: PlannerItem): number => {
  const existing = item.scheduledBlockEnd && item.scheduledBlockStart
    ? Math.round((item.scheduledBlockEnd - item.scheduledBlockStart) / 60000)
    : null;
  if (existing) return existing;
  if (item.rawStory) return Math.max(30, Number((item.rawStory as any)?.estimateMin || 0) || 60);
  if (item.rawTask) return Math.max(15, Number((item.rawTask as any)?.estimateMin || 0) || 30);
  return 30;
};

interface SprintWeekPlannerProps {
  anchorDate: Date;
}

const SprintWeekPlanner: React.FC<SprintWeekPlannerProps> = ({ anchorDate }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId, sprintsById } = useSprint();
  const { activeFocusGoals } = useFocusGoals(currentUser?.uid);
  const { resolveThemeAppearance } = useThemeAppearance();
  const { themes: globalThemes } = useGlobalThemes();
  const navigate = useNavigate();

  const weekStart = useMemo(() => new Date(dayStartMs(anchorDate)), [anchorDate]);
  const weekStartMs = useMemo(() => dayStartMs(weekStart), [weekStart]);
  const weekEndMs = useMemo(
    () => dayStartMs(addDays(weekStart, VISIBLE_DAYS - 1)) + (24 * 60 * 60 * 1000) - 1,
    [weekStart],
  );
  const plannerRange = useMemo(
    () => ({ start: weekStart, end: addDays(weekStart, VISIBLE_DAYS - 1) }),
    [weekStart],
  );

  const planner = useUnifiedPlannerData(plannerRange);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [feedback, setFeedback] = useState<PlannerFeedback | null>(null);
  const [showThemeAllocations, setShowThemeAllocations] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const stored = window.localStorage.getItem(THEME_OVERLAY_STORAGE_KEY);
    return stored == null ? true : stored === '1';
  });
  const [deltaReplanLoading, setDeltaReplanLoading] = useState(false);
  const [fullReplanLoading, setFullReplanLoading] = useState(false);
  const [planningMode, setPlanningMode] = useState<'smart' | 'strict'>('smart');
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<PlannerCalendarEvent | null>(null);
  const [deferTarget, setDeferTarget] = useState<ItemTarget | null>(null);
  const dragItemRef = useRef<PlannerItem | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(THEME_OVERLAY_STORAGE_KEY, showThemeAllocations ? '1' : '0');
  }, [showThemeAllocations]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setTasks([]);
      setStories([]);
      setGoals([]);
      return;
    }
    const taskQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(400));
    const storyQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), orderBy('updatedAt', 'desc'), limit(400));
    const goalQuery = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));

    const unsubTasks = onSnapshot(taskQuery, (snap) => {
      let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Task[];
      rows = rows.filter((task: any) => (currentPersona === 'work' ? task.persona === 'work' : task.persona == null || task.persona === 'personal'));
      setTasks(rows);
    }, (err) => { console.error('Failed to load tasks for sprint week planner', err); setTasks([]); });
    const unsubStories = onSnapshot(storyQuery, (snap) => {
      let rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Story[];
      rows = rows.filter((story: any) => (currentPersona === 'work' ? story.persona === 'work' : story.persona == null || story.persona === 'personal'));
      setStories(rows);
    }, (err) => { console.error('Failed to load stories for sprint week planner', err); setStories([]); });
    const unsubGoals = onSnapshot(
      goalQuery,
      (snap) => setGoals(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Goal[]),
      (err) => { console.error('Failed to load goals for sprint week planner', err); setGoals([]); },
    );

    return () => {
      unsubTasks();
      unsubStories();
      unsubGoals();
    };
  }, [currentUser?.uid, currentPersona]);

  const activeFocusGoalIds = useMemo(() => getActiveFocusLeafGoalIds(activeFocusGoals), [activeFocusGoals]);

  const calendarBlockRows: PlannerCalendarBlockRow[] = useMemo(() => planner.blocks.map((b) => ({
    id: b.id,
    title: b.title,
    start: b.start,
    end: b.end,
    googleEventId: b.googleEventId || null,
    taskId: b.taskId || null,
    storyId: b.storyId || null,
    source: (b as any).source || null,
  })), [planner.blocks]);

  const scheduledInstanceRows: PlannerScheduledInstanceRow[] = useMemo(() => planner.instances.map((i) => ({
    id: i.id,
    ownerUid: i.ownerUid,
    sourceType: i.sourceType,
    sourceId: i.sourceId,
    occurrenceDate: i.occurrenceDate,
    status: i.status,
    blockId: i.blockId || null,
    plannedStart: i.plannedStart || null,
    plannedEnd: i.plannedEnd || null,
    durationMinutes: i.durationMinutes,
    title: i.title || null,
    storyId: i.storyId || null,
  })), [planner.instances]);

  const backlogItems = useMemo(() => {
    if (!selectedSprintId) return [];
    const items = buildPlannerItems({
      tasks,
      stories,
      goals,
      calendarBlocks: calendarBlockRows,
      scheduledInstances: scheduledInstanceRows,
      activeFocusGoalIds,
      rangeStartMs: weekStartMs,
      rangeEndMs: weekEndMs,
      selectedSprintId,
      includeUnscheduledTasks: true,
    });
    return items
      .filter((item) => {
        if (item.kind === 'event') return false;
        if (item.scheduledBlockId || item.scheduledInstanceId) return false;
        if (item.dueAt != null) return false;
        const itemSprintId = item.rawTask?.sprintId || item.rawStory?.sprintId;
        return itemSprintId === selectedSprintId;
      })
      .sort((a, b) => {
        const scoreA = getEntityAiScore((a.rawStory || a.rawTask) as Story | Task);
        const scoreB = getEntityAiScore((b.rawStory || b.rawTask) as Story | Task);
        return scoreB - scoreA;
      });
  }, [tasks, stories, goals, calendarBlockRows, scheduledInstanceRows, activeFocusGoalIds, weekStartMs, weekEndMs, selectedSprintId]);

  const { events: allEvents, eventStyleGetter, handleEventMove, handleEventResize } = usePlannerCalendarEvents({
    blocks: planner.blocks,
    instances: planner.instances,
    externalEvents: planner.externalEvents,
    resolveThemeAppearance,
    onFeedback: setFeedback,
    refreshExternalEvents: planner.refreshExternalEvents,
    syncEntityDate: true,
  });

  const visibleEvents = useMemo(
    () => (showThemeAllocations ? allEvents : allEvents.filter((e) => String(e.source || '').toLowerCase() !== 'theme_allocation')),
    [allEvents, showThemeAllocations],
  );

  const storyById = useMemo(() => new Map(stories.map((s) => [s.id, s])), [stories]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const goalById = useMemo(() => new Map(goals.map((g) => [g.id, g])), [goals]);

  // Mirrors KanbanCardV2's colour resolution: item's own theme first, falling back to the parent goal's colour.
  const resolveEntityColor = useCallback((storyId?: string | null, taskId?: string | null): string | undefined => {
    const entity: any = storyId ? storyById.get(storyId) : taskId ? taskById.get(taskId) : null;
    if (!entity) return undefined;
    const goal = entity.goalId ? goalById.get(entity.goalId) : undefined;
    const themeValue = entity.theme ?? entity.themeId ?? entity.theme_id ?? goal?.theme;
    const resolved = resolveThemeAppearance(themeValue);
    return resolved?.color || (goal ? goalThemeColor(goal, globalThemes) : undefined);
  }, [storyById, taskById, goalById, resolveThemeAppearance, globalThemes]);

  const events = useMemo(() => visibleEvents.map((e) => {
    if (e.type !== 'block' && e.type !== 'instance') return e;
    const storyId = e.block?.storyId || e.instance?.storyId;
    const taskId = e.block?.taskId;
    const color = resolveEntityColor(storyId, taskId);
    return color ? { ...e, color } : e;
  }), [visibleEvents, resolveEntityColor]);

  const handleSelectEvent = useCallback((event: PlannerCalendarEvent) => {
    setSelectedEvent(event);
  }, []);

  const openItem = useCallback((target: ItemTarget) => {
    navigate(target.itemType === 'story' ? `/stories/${target.itemId}` : `/tasks/${target.itemId}`);
  }, [navigate]);

  const completeItem = useCallback(async (target: ItemTarget) => {
    try {
      await updateDoc(doc(db, target.itemType === 'story' ? 'stories' : 'tasks', target.itemId), {
        status: target.itemType === 'story' ? 4 : 2,
        updatedAt: Date.now(),
      });
      setFeedback({ variant: 'success', message: `${target.title} marked complete.` });
      setSelectedEvent(null);
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Could not mark complete.' });
    }
  }, []);

  const deleteItem = useCallback(async (target: ItemTarget) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete "${target.title}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, target.itemType === 'story' ? 'stories' : 'tasks', target.itemId));
      setFeedback({ variant: 'success', message: `${target.title} deleted.` });
      setSelectedEvent(null);
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Could not delete.' });
    }
  }, []);

  const sendEventBackToBacklog = useCallback(async (target: ItemTarget) => {
    try {
      if (target.scheduledBlockId) await deleteDoc(doc(db, 'calendar_blocks', target.scheduledBlockId));
      if (target.scheduledInstanceId) await deleteDoc(doc(db, 'scheduled_instances', target.scheduledInstanceId));
      const patch = target.itemType === 'story'
        ? { dueDate: null, targetDate: null, plannedStartDate: null, plannedWeekKey: null, plannedWeekStart: null, updatedAt: Date.now() }
        : { dueDate: null, dueDateMs: null, plannedWeekKey: null, plannedWeekStart: null, updatedAt: Date.now() };
      await updateDoc(doc(db, target.itemType === 'story' ? 'stories' : 'tasks', target.itemId), patch);
      setFeedback({ variant: 'success', message: `${target.title} moved back to the backlog.` });
      setSelectedEvent(null);
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Could not move back to backlog.' });
    }
  }, []);

  const runDeltaReplan = useCallback(async () => {
    if (!currentUser) return;
    setDeltaReplanLoading(true);
    setFeedback(null);
    try {
      const replanCalendarNowFn = httpsCallable(functions, 'replanCalendarNow', { timeout: 180000 });
      const res: any = await replanCalendarNowFn({ days: VISIBLE_DAYS, startDate: format(weekStart, 'yyyy-MM-dd'), planningMode });
      const data = res?.data || {};
      const parts: string[] = [];
      if (data.created) parts.push(`${data.created} created`);
      if (data.rescheduled) parts.push(`${data.rescheduled} moved`);
      if (data.blocked) parts.push(`${data.blocked} blocked`);
      setFeedback({ variant: 'success', message: parts.length ? `Delta replan complete: ${parts.join(', ')}.` : 'Delta replan complete.' });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Delta replan failed. Please retry in a moment.' });
    } finally {
      setDeltaReplanLoading(false);
    }
  }, [currentUser, weekStart, planningMode]);

  const runFullReplan = useCallback(async () => {
    if (!currentUser) return;
    setFullReplanLoading(true);
    setFeedback(null);
    try {
      const runNightlyChainFn = httpsCallable(functions, 'runNightlyChainNow', { timeout: 540000 });
      await runNightlyChainFn({ startDate: format(weekStart, 'yyyy-MM-dd'), days: VISIBLE_DAYS, planningMode });
      setFeedback({ variant: 'success', message: 'Full replan complete.' });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: err?.message || 'Full replan failed. Please retry in a moment.' });
    } finally {
      setFullReplanLoading(false);
    }
  }, [currentUser, weekStart, planningMode]);

  const handleDropFromOutside = useCallback(async ({ start, end }: { start: Date; end: Date }) => {
    const item = dragItemRef.current;
    dragItemRef.current = null;
    setDraggingItemId(null);
    if (!item) return;
    const itemType: 'story' | 'task' | null = item.rawStory ? 'story' : item.rawTask ? 'task' : null;
    const itemId = item.rawStory?.id || item.rawTask?.id;
    if (!itemType || !itemId) return;
    try {
      await schedulePlannerItem({
        itemType,
        itemId,
        targetDateMs: start.getTime(),
        intent: 'move',
        source: 'weekly_planner',
        exactTargetStartMs: start.getTime(),
        exactTargetEndMs: end.getTime(),
        durationMinutes: Math.max(15, Math.round((end.getTime() - start.getTime()) / 60000)),
      });
      setFeedback({ variant: 'success', message: `${item.title} scheduled.` });
    } catch (err: any) {
      setFeedback({ variant: 'danger', message: normalizePlannerSchedulingError(err).message });
    }
  }, []);

  const dragFromOutsideItem = useCallback(() => {
    const item = dragItemRef.current;
    if (!item) return undefined as any;
    const start = new Date();
    const end = new Date(start.getTime() + estimateDurationMinutes(item) * 60000);
    return { title: item.title, start, end };
  }, []);

  const eventComponents = useMemo(() => ({
    event: (props: { event: PlannerCalendarEvent }) => (
      <PlannerEventContent
        event={props.event}
        onBackToBacklog={sendEventBackToBacklog}
        onDefer={setDeferTarget}
        onComplete={completeItem}
        onDelete={deleteItem}
      />
    ),
  }), [sendEventBackToBacklog, completeItem, deleteItem]);

  const sprintName = selectedSprintId ? sprintsById?.[selectedSprintId]?.name : null;

  return (
    <div className="d-flex gap-3" style={{ alignItems: 'stretch' }}>
      <Card className="shadow-sm border-0" style={{ width: 280, flexShrink: 0 }}>
        <Card.Header className="fw-semibold d-flex justify-content-between align-items-center">
          <span>Backlog{sprintName ? ` · ${sprintName}` : ''}</span>
          <Badge bg="secondary">{backlogItems.length}</Badge>
        </Card.Header>
        <Card.Body className="p-2" style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 260px)' }}>
          {!selectedSprintId && (
            <div className="text-muted small p-2">No active sprint selected — nothing to plan.</div>
          )}
          {selectedSprintId && backlogItems.length === 0 && (
            <div className="text-muted small p-2">Everything in this sprint is planned.</div>
          )}
          {backlogItems.map((item) => {
            const priority = getPriorityBadge((item.rawStory as any)?.priority ?? (item.rawTask as any)?.priority);
            const score = getEntityAiScore((item.rawStory || item.rawTask) as Story | Task);
            const target: ItemTarget | null = item.rawStory
              ? { itemType: 'story', itemId: item.rawStory.id, title: item.title, durationMinutes: estimateDurationMinutes(item) }
              : item.rawTask
                ? { itemType: 'task', itemId: item.rawTask.id, title: item.title, durationMinutes: estimateDurationMinutes(item) }
                : null;
            return (
              <div
                key={item.id}
                draggable
                onDragStart={(event) => {
                  dragItemRef.current = item;
                  setDraggingItemId(item.id);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', item.id);
                }}
                onDragEnd={() => {
                  dragItemRef.current = null;
                  setDraggingItemId(null);
                }}
                className="border rounded p-2 mb-2 bg-body"
                style={{
                  cursor: 'grab',
                  opacity: draggingItemId === item.id ? 0.4 : 1,
                  borderColor: 'var(--bs-border-color)',
                }}
              >
                <div className="d-flex justify-content-between align-items-start gap-2">
                  <div className="small text-muted">{item.ref}</div>
                  {score > 0 && <Badge bg="info" pill title="AI criticality score">{score}</Badge>}
                </div>
                <div className="fw-medium" style={{ fontSize: '0.9rem', lineHeight: 1.2 }}>{item.title}</div>
                <div className="d-flex justify-content-between align-items-center mt-1 flex-wrap">
                  <div className="d-flex gap-1 flex-wrap">
                    <Badge bg={priority.bg}>{priority.text}</Badge>
                    {item.goalTheme && <Badge bg="light" text="dark">{item.goalTheme}</Badge>}
                  </div>
                  {target && (
                    <div className="d-flex gap-1">
                      <Button variant="link" size="sm" className="p-0 text-muted" style={{ width: 20, height: 20 }} title="Defer to another sprint" onClick={(e) => { e.stopPropagation(); setDeferTarget(target); }} onPointerDown={(e) => e.stopPropagation()}>
                        <Clock3 size={12} />
                      </Button>
                      <Button variant="link" size="sm" className="p-0 text-muted" style={{ width: 20, height: 20 }} title="Mark complete" onClick={(e) => { e.stopPropagation(); completeItem(target); }} onPointerDown={(e) => e.stopPropagation()}>
                        <CheckCircle size={12} />
                      </Button>
                      <Button variant="link" size="sm" className="p-0" style={{ width: 20, height: 20, color: 'var(--red)' }} title="Delete" onClick={(e) => { e.stopPropagation(); deleteItem(target); }} onPointerDown={(e) => e.stopPropagation()}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </Card.Body>
      </Card>

      <Card className="shadow-sm border-0 flex-grow-1">
        <Card.Header className="d-flex justify-content-between align-items-center flex-wrap gap-2">
          <Form.Check
            type="switch"
            id="sprint-week-theme-overlay"
            label={(
              <span className="d-inline-flex align-items-center gap-1">
                {showThemeAllocations ? <Eye size={14} /> : <EyeOff size={14} />} Show theme allocations
              </span>
            )}
            checked={showThemeAllocations}
            onChange={(e) => setShowThemeAllocations(e.target.checked)}
          />
          <div className="d-flex gap-2 align-items-center">
            <ButtonGroup size="sm">
              <Button
                variant={planningMode === 'smart' ? 'secondary' : 'outline-secondary'}
                title="Smart: fill free slots flexibly"
                onClick={() => setPlanningMode('smart')}
              >
                Smart
              </Button>
              <Button
                variant={planningMode === 'strict' ? 'secondary' : 'outline-secondary'}
                title="Strict: only honour explicit theme windows"
                onClick={() => setPlanningMode('strict')}
              >
                Strict
              </Button>
            </ButtonGroup>
            <Button size="sm" variant="outline-secondary" disabled={deltaReplanLoading || fullReplanLoading} onClick={runDeltaReplan}>
              {deltaReplanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <RefreshCw size={14} className="me-1" />}
              Delta replan
            </Button>
            <Button size="sm" variant="outline-primary" disabled={deltaReplanLoading || fullReplanLoading} onClick={runFullReplan}>
              {fullReplanLoading ? <Spinner size="sm" animation="border" className="me-1" /> : <Sparkles size={14} className="me-1" />}
              Full replan
            </Button>
          </div>
        </Card.Header>
        {feedback && (
          <Alert variant={feedback.variant} className="m-2 mb-0 py-2" dismissible onClose={() => setFeedback(null)}>
            {feedback.message}
          </Alert>
        )}
        {selectedEvent && (() => {
          const target = resolveEventTarget(selectedEvent);
          if (!target) return null;
          return (
            <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap px-2 py-2 border-bottom bg-body-tertiary">
              <div className="fw-medium small text-truncate" style={{ maxWidth: 260 }}>{target.title}</div>
              <div className="d-flex gap-1">
                <Button size="sm" variant="outline-secondary" title="Open" onClick={() => openItem(target)}>
                  <ExternalLink size={13} />
                </Button>
                <Button size="sm" variant="outline-secondary" title="Send back to backlog" onClick={() => sendEventBackToBacklog(target)}>
                  <CornerUpLeft size={13} />
                </Button>
                <Button size="sm" variant="outline-secondary" title="Defer to another sprint" onClick={() => setDeferTarget(target)}>
                  <Clock3 size={13} />
                </Button>
                <Button size="sm" variant="outline-secondary" title="Mark complete" onClick={() => completeItem(target)}>
                  <CheckCircle size={13} />
                </Button>
                <Button size="sm" variant="outline-danger" title="Delete" onClick={() => deleteItem(target)}>
                  <Trash2 size={13} />
                </Button>
                <Button size="sm" variant="link" className="text-muted" title="Close" onClick={() => setSelectedEvent(null)}>
                  <X size={14} />
                </Button>
              </div>
            </div>
          );
        })()}
        <Card.Body className="p-0">
          {planner.loading && events.length === 0 ? (
            <div className="d-flex align-items-center justify-content-center text-muted flex-column py-5">
              <Spinner animation="border" size="sm" className="mb-2" />
              <div>Loading planner data…</div>
            </div>
          ) : (
            <div className="planner-calendar-wrapper">
              <DragAndDropCalendar
                localizer={localizer}
                events={events}
                view="fiveDay"
                views={{ fiveDay: FiveDayView }}
                toolbar={false}
                date={weekStart}
                onNavigate={() => { /* navigation is driven by the anchor date from the parent route */ }}
                onView={() => { /* single fixed view — no switcher */ }}
                selectable
                resizable
                step={30}
                popup
                onEventDrop={handleEventMove}
                onEventResize={handleEventResize}
                onSelectEvent={handleSelectEvent}
                onDropFromOutside={handleDropFromOutside}
                dragFromOutsideItem={dragFromOutsideItem}
                eventPropGetter={eventStyleGetter}
                components={eventComponents}
                tooltipAccessor={(event: any) => `${event.title} — Planned Date: ${format(event.start, 'd MMM, HH:mm')}`}
                getNow={() => new Date()}
                style={{ height: 'calc(100vh - 260px)' }}
                min={new Date(1970, 1, 1, 5, 0)}
                max={new Date(1970, 1, 1, 23, 30)}
                formats={{
                  timeGutterFormat: (date: Date) => format(date, 'HH:mm'),
                  eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) => `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`,
                }}
              />
            </div>
          )}
        </Card.Body>
      </Card>

      {deferTarget && (
        <DeferItemModal
          show
          onHide={() => setDeferTarget(null)}
          itemType={deferTarget.itemType}
          itemId={deferTarget.itemId}
          itemTitle={deferTarget.title}
          allowAdvancedSearch
          onApply={async (payload) => {
            const rawItem = deferTarget.itemType === 'story'
              ? stories.find((s) => s.id === deferTarget.itemId)
              : tasks.find((t) => t.id === deferTarget.itemId);
            await applyPlannerDefer({
              itemType: deferTarget.itemType,
              item: (rawItem || { id: deferTarget.itemId, title: deferTarget.title }) as any,
              payload,
              sourceFallback: 'sprint_week_planner',
              linkedBlockId: deferTarget.scheduledBlockId || null,
              durationMinutes: deferTarget.durationMinutes || null,
            });
            setFeedback({ variant: 'success', message: `${deferTarget.title} deferred.` });
            setDeferTarget(null);
            setSelectedEvent(null);
          }}
        />
      )}
    </div>
  );
};

export default SprintWeekPlanner;
