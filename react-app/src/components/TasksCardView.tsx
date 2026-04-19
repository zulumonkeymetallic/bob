import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { Card, Badge, Button, Form, Toast, ToastContainer } from 'react-bootstrap';
import { Edit3, Trash2, Target, Calendar, Activity, Clock, Clock3 } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Task, Story, Goal } from '../types';
import { themeVars } from '../utils/themeVars';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { GLOBAL_THEMES, migrateThemeValue, type GlobalTheme } from '../constants/globalThemes';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { priorityLabel, priorityPillClass, taskStatusText } from '../utils/storyCardFormatting';
import DeferItemModal from './DeferItemModal';
import NewCalendarEventModal, { type BlockFormState, buildCalendarComposerInitialValues } from './planner/NewCalendarEventModal';
import '../styles/KanbanCards.css';

interface TasksCardViewProps {
  tasks: Task[];
  stories: Story[];
  goals: Goal[];
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => void | Promise<void>;
  onTaskDelete: (taskId: string) => void;
  onTaskPriorityChange: (taskId: string, newPriority: number) => void;
  onEditTask: (task: Task) => void;
}

const TasksCardView: React.FC<TasksCardViewProps> = ({
  tasks,
  stories,
  goals,
  onTaskUpdate,
  onTaskDelete,
  onTaskPriorityChange,
  onEditTask
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const { themes: globalThemes } = useGlobalThemes();
  const [latestActivities, setLatestActivities] = useState<{ [taskId: string]: any }>({});
  const [nextBlocks, setNextBlocks] = useState<{ [taskId: string]: { start: number; end: number } | null }>({});
  const [showDescriptions, setShowDescriptions] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('bob_tasks_show_descriptions');
      if (stored === null || stored === undefined) return true;
      return stored === 'true';
    } catch {
      return true;
    }
  });
  const [showUpdates, setShowUpdates] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem('bob_tasks_show_updates');
      if (stored === null || stored === undefined) return true;
      return stored === 'true';
    } catch {
      return true;
    }
  });
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [deferTask, setDeferTask] = useState<Task | null>(null);
  const [scheduleTask, setScheduleTask] = useState<Task | null>(null);
  const [feedback, setFeedback] = useState<{ show: boolean; message: string; variant: 'success' | 'danger' | 'info' }>({
    show: false,
    message: '',
    variant: 'info',
  });

  useEffect(() => {
    try {
      localStorage.setItem('bob_tasks_show_descriptions', String(showDescriptions));
    } catch {
      // noop
    }
  }, [showDescriptions]);

  useEffect(() => {
    try {
      localStorage.setItem('bob_tasks_show_updates', String(showUpdates));
    } catch {
      // noop
    }
  }, [showUpdates]);

  const themePalette = useMemo(
    () => (globalThemes && globalThemes.length ? globalThemes : GLOBAL_THEMES),
    [globalThemes]
  );
  const themeMap = useMemo(() => {
    const map = new Map<number, GlobalTheme>();
    themePalette.forEach(theme => map.set(theme.id, theme));
    return map;
  }, [themePalette]);
  const defaultTheme = themePalette[0] || GLOBAL_THEMES[0];

  const resolveTheme = (value: any): GlobalTheme => {
    if (value == null) return defaultTheme;
    if (typeof value === 'number') {
      const direct = themeMap.get(value);
      if (direct) return direct;
      const legacy = themeMap.get(migrateThemeValue(value));
      return legacy || defaultTheme;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return defaultTheme;
      const normalize = (input: string) => input.toLowerCase().replace(/[^a-z0-9]+/g, '');
      const normalized = normalize(trimmed);
      const directMatch = themePalette.find((theme) => {
        const label = theme.label || '';
        const name = theme.name || '';
        return (
          normalize(label) === normalized ||
          normalize(name) === normalized ||
          normalize(String(theme.id)) === normalized
        );
      });
      if (directMatch) return directMatch;
      const numeric = Number.parseInt(trimmed, 10);
      if (Number.isFinite(numeric)) {
        const numericMatch = themeMap.get(numeric);
        if (numericMatch) return numericMatch;
        const legacyMatch = themeMap.get(migrateThemeValue(numeric));
        if (legacyMatch) return legacyMatch;
      }
      const legacyByName = themeMap.get(migrateThemeValue(trimmed));
      return legacyByName || defaultTheme;
    }
    return defaultTheme;
  };

  const withAlpha = (color: string, alpha: number) => {
    const pct = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
    if (pct <= 0) return 'transparent';
    if (pct >= 100) return color;
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  };

  const getStoryForTask = (task: Task): Story | undefined => {
    const storyId = task.storyId || (task.parentType === 'story' ? task.parentId : null);
    if (!storyId) return undefined;
    return stories.find(s => s.id === storyId);
  };

  const getGoalForTask = (task: Task): Goal | undefined => {
    const story = getStoryForTask(task);
    if (story?.goalId) return goals.find(g => g.id === story.goalId);
    const goalId = (task as any).goalId;
    return goalId ? goals.find(g => g.id === goalId) : undefined;
  };

  const loadLatestActivityForTask = useCallback(async (taskId: string) => {
    if (!currentUser) return;

    try {
      const q = query(
        collection(db, 'activity_stream'),
        where('ownerUid', '==', currentUser.uid),
        where('entityId', '==', taskId),
        where('entityType', '==', 'task'),
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      const querySnapshot = await getDocs(q);

      if (!querySnapshot.empty) {
        const latestActivity = querySnapshot.docs[0].data();
        setLatestActivities(prev => ({
          ...prev,
          [taskId]: latestActivity
        }));
      }
    } catch (error: any) {
      if (error?.code === 'permission-denied') {
        console.warn('activity_stream read blocked by rules for task', taskId);
        return;
      }
      console.error('Error loading latest activity for task:', taskId, error);
    }
  }, [currentUser]);

  const loadNextBlockForTask = useCallback(async (taskId: string) => {
    if (!currentUser) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'calendar_blocks'),
          where('ownerUid', '==', currentUser.uid),
          where('taskId', '==', taskId),
        )
      );
      const nowMs = Date.now();
      const upcoming = snap.docs
        .map((d) => d.data() as { start: number; end: number })
        .filter((b) => typeof b.start === 'number' && b.start >= nowMs)
        .sort((a, b) => a.start - b.start);
      setNextBlocks((prev) => ({ ...prev, [taskId]: upcoming[0] ?? null }));
    } catch {
      // ignore
    }
  }, [currentUser]);

  useEffect(() => {
    tasks.forEach(task => {
      loadLatestActivityForTask(task.id);
      loadNextBlockForTask(task.id);
    });
  }, [tasks, currentUser, loadLatestActivityForTask, loadNextBlockForTask]);

  useLayoutEffect(() => {
    const gridEl = gridRef.current;
    if (!gridEl || typeof ResizeObserver === 'undefined') return;

    const style = getComputedStyle(gridEl);
    const rowGap = parseFloat(style.rowGap || '0');
    const rowHeight = parseFloat(style.gridAutoRows || '0');
    if (!rowHeight) return;

    const updateSpans = (updates: Record<string, number>) => {
      if (!Object.keys(updates).length) return;
      setRowSpans((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const [id, span] of Object.entries(updates)) {
          if (next[id] !== span) {
            next[id] = span;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    };

    const observer = new ResizeObserver((entries) => {
      const updates: Record<string, number> = {};
      entries.forEach((entry) => {
        const tile = entry.target as HTMLElement;
        const id = tile.dataset.taskId;
        if (!id) return;
        const height = entry.contentRect.height;
        const span = Math.max(1, Math.ceil((height + rowGap) / (rowHeight + rowGap)));
        updates[id] = span;
      });
      updateSpans(updates);
    });

    const tiles = Array.from(gridEl.querySelectorAll<HTMLElement>('.goals-card-tile'));
    tiles.forEach((tile) => observer.observe(tile));

    return () => observer.disconnect();
  }, [tasks, showDescriptions, showUpdates]);

  const cycleTaskStatus = (task: Task) => {
    const sequence = [0, 1, 2, 3];
    const current = Number((task as any).status ?? 0);
    const currentIndex = sequence.indexOf(current);
    const nextValue = sequence[(currentIndex + 1) % sequence.length];
    onTaskUpdate(task.id, { status: nextValue as any });
  };

  const cycleTaskPriority = (task: Task) => {
    const sequence = [0, 1, 2, 3, 4];
    const current = Number((task as any).priority ?? 0);
    const currentIndex = sequence.indexOf(current);
    const nextValue = sequence[(currentIndex + 1) % sequence.length];
    onTaskPriorityChange(task.id, nextValue);
  };

  const showToast = (message: string, variant: 'success' | 'danger' | 'info' = 'info') => {
    setFeedback({ show: true, message, variant });
  };

  const linkedScheduleStories = useMemo(() => {
    if (!scheduleTask) return [] as Story[];
    const linkedStory = getStoryForTask(scheduleTask);
    return linkedStory ? [linkedStory] : [];
  }, [scheduleTask, stories]);

  const scheduleInitialValues = useMemo(() => {
    if (!scheduleTask) return undefined;
    const linkedStory = getStoryForTask(scheduleTask);
    const estimateMin = Number((scheduleTask as any).estimateMin || 0) || (Number((scheduleTask as any).points || 0) * 60);
    return buildCalendarComposerInitialValues({
      title: scheduleTask.title || 'Task block',
      rationale: 'Manual schedule from task card',
      persona: ((scheduleTask as any).persona || (linkedStory as any)?.persona || currentPersona || 'personal') as 'personal' | 'work',
      theme: String((linkedStory as any)?.theme || (scheduleTask as any)?.theme || 'General'),
      category: (((scheduleTask as any).persona || currentPersona) === 'work' ? 'Work (Main Gig)' : 'Wellbeing') as any,
      storyId: linkedStory?.id,
      taskId: scheduleTask.id,
      estimateMin,
      aiScore: Number.isFinite(Number((scheduleTask as any).aiCriticalityScore)) ? Number((scheduleTask as any).aiCriticalityScore) : null,
      aiReason: String((scheduleTask as any).aiReason || (scheduleTask as any).aiPriorityReason || '').trim() || null,
    }) as Partial<BlockFormState>;
  }, [currentPersona, scheduleTask, stories]);

  const toDate = (value: any) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const statusPillClass = (label: string) => {
    const normalized = String(label).toLowerCase();
    const base = 'kanban-card__meta-pill';
    if (normalized.includes('done')) return `${base} kanban-card__meta-pill--success`;
    if (normalized.includes('progress')) return `${base} kanban-card__meta-pill--orange`;
    if (normalized.includes('block')) return `${base} kanban-card__meta-pill--danger`;
    return base;
  };

  const formatDateChip = (value: any) => {
    const date = toDate(value);
    if (!date) return null;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };

  if (tasks.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 20px', color: themeVars.muted as string }}>
        <Target size={48} style={{ marginBottom: '16px', opacity: 0.5 }} />
        <h4>No Tasks Found</h4>
        <p>Create tasks or adjust filters to see results.</p>
      </div>
    );
  }

  return (
    <div className="goals-card-view" style={{ padding: '20px' }}>
      <div className="d-flex justify-content-end align-items-center gap-3 mb-2">
        <Form.Check
          type="switch"
          id="toggle-task-descriptions"
          label="Show task descriptions"
          checked={showDescriptions}
          onChange={(e) => setShowDescriptions(e.target.checked)}
          className="text-muted"
        />
        <Form.Check
          type="switch"
          id="toggle-task-updates"
          label="Show latest updates"
          checked={showUpdates}
          onChange={(e) => setShowUpdates(e.target.checked)}
          className="text-muted"
        />
      </div>
      <div className="goals-card-grid goals-card-grid--grid" ref={gridRef}>
        {tasks.map(task => {
          const linkedStory = getStoryForTask(task);
          const linkedGoal = getGoalForTask(task);
          const themeValue = (linkedGoal as any)?.theme ?? (linkedGoal as any)?.themeId ?? (linkedGoal as any)?.theme_id
            ?? (task as any).theme ?? (task as any).themeId ?? (task as any).theme_id;
          const themeDef = resolveTheme(themeValue);
          const themeColor = themeDef.color || (themeVars.brand as string);
          const themeTextColor = themeDef.textColor || (themeVars.onAccent as string);
          const textColor = themeVars.text as string;
          const mutedTextColor = themeVars.muted as string;
          const statusLabel = taskStatusText(task.status);
          const priorityText = priorityLabel(task.priority, `P${task.priority ?? 2}`);
          const latestActivity = latestActivities[task.id];
          const showActivity = showUpdates && !!latestActivity;
          const showTaskDescription = showDescriptions && !!task.description;
          const createdAt = toDate((task as any).createdAt);
          const updatedAt = toDate((task as any).updatedAt);
          const lastSyncedRaw = (task as any).macSyncedAt ?? (task as any).deviceUpdatedAt ?? (task as any).serverUpdatedAt ?? (task as any).updatedAt;
          const lastSyncedAt = toDate(lastSyncedRaw);
          const rowSpan = rowSpans[task.id];
          const nextBlock = nextBlocks[task.id];
          const aiScore = Number((task as any).aiCriticalityScore ?? NaN);
          const dueChip = formatDateChip(task.dueDate || (task as any).targetDate);
          const isTop3 = Boolean((task as any).aiTop3ForDay);
          const points = Number((task as any).points ?? 0);

          return (
            <div
              key={task.id}
              className="goals-card-tile"
              data-task-id={task.id}
              style={rowSpan ? { gridRowEnd: `span ${rowSpan}` } : undefined}
            >
              <Card
                className="goals-card"
                style={{
                  height: '100%',
                  minHeight: 220,
                  border: `1px solid ${withAlpha(themeColor, 0.25)}`,
                  boxShadow: '0 10px 24px var(--glass-shadow-color)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  transition: 'all 0.3s ease',
                  cursor: 'pointer',
                  background: 'var(--bs-body-bg, #fff)',
                  color: textColor,
                  display: 'flex',
                  flexDirection: 'column'
                }}
                onClick={() => {
                  onEditTask(task);
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-2px)';
                  e.currentTarget.style.boxShadow = '0 12px 18px var(--glass-shadow-color)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 6px 12px var(--glass-shadow-color)';
                }}
              >
                <Card.Body style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '10px', borderLeft: `4px solid ${themeColor}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {task.ref && (
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px', color: mutedTextColor }}>
                          {task.ref}
                        </div>
                      )}
                      <h5 className="kanban-card__title" style={{ margin: '4px 0 0 0', fontSize: '16px', fontWeight: 600, lineHeight: '1.3', color: textColor }}>
                        {task.title}
                      </h5>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ width: 24, height: 24, color: textColor }}
                        title="Schedule task"
                        onClick={(e) => {
                          e.stopPropagation();
                          setScheduleTask(task);
                        }}
                      >
                        <Calendar size={14} />
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ width: 24, height: 24, color: textColor }}
                        title="View activity stream"
                        onClick={(e) => {
                          e.stopPropagation();
                          showSidebar(task, 'task');
                        }}
                      >
                        <Activity size={14} />
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        className="p-0"
                        style={{ width: 24, height: 24, color: textColor }}
                        title="Edit task"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditTask(task);
                        }}
                      >
                        <Edit3 size={14} />
                      </Button>
                    </div>
                  </div>

                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <Badge bg="primary">Task</Badge>
                    <button
                      type="button"
                      className={statusPillClass(statusLabel)}
                      style={{ appearance: 'none', backgroundClip: 'padding-box', cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleTaskStatus(task);
                      }}
                      title="Tap to cycle status"
                    >
                      {statusLabel}
                    </button>
                    <button
                      type="button"
                      className={priorityPillClass(task.priority ?? null)}
                      style={{ appearance: 'none', backgroundClip: 'padding-box', cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        cycleTaskPriority(task);
                      }}
                      title="Tap to cycle priority"
                    >
                      {priorityText}
                    </button>
                    {dueChip && <Badge bg="light" text="dark">Due {dueChip}</Badge>}
                    {Number.isFinite(aiScore) && <Badge bg="secondary">AI {Math.round(aiScore)}/100</Badge>}
                    {points > 0 && <Badge bg="dark">Pts {points}</Badge>}
                    {isTop3 && <Badge bg="danger">Top 3</Badge>}
                  </div>

                  {(showTaskDescription || showActivity) && (
                    <div
                      style={{
                        padding: '10px',
                        backgroundColor: withAlpha(themeColor, 0.16),
                        border: `1px solid ${withAlpha(themeColor, 0.3)}`,
                        borderRadius: '12px',
                        color: textColor,
                      }}
                    >
                      {showTaskDescription && task.description && (
                        <p
                          style={{
                            margin: showActivity ? '0 0 8px 0' : 0,
                            color: mutedTextColor,
                            fontSize: '13px',
                            lineHeight: '1.5',
                            whiteSpace: 'normal',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word'
                          }}
                        >
                          {task.description}
                        </p>
                      )}
                      {showActivity && latestActivity && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: textColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            {latestActivity.activityType === 'note_added'
                              ? 'Latest Comment'
                              : latestActivity.activityType === 'status_changed'
                              ? 'Latest Status'
                              : latestActivity.activityType === 'updated'
                              ? 'Latest Update'
                              : 'Latest Activity'}
                          </div>
                          <div style={{ fontSize: '12px', color: textColor, fontStyle: 'italic', lineHeight: '1.4' }}>
                            {latestActivity.activityType === 'note_added'
                              ? `"${latestActivity.noteContent}"`
                              : latestActivity.activityType === 'status_changed'
                              ? `Status changed to: ${taskStatusText(parseInt(latestActivity.newValue) || latestActivity.newValue)}`
                              : latestActivity.activityType === 'updated' && latestActivity.fieldName
                              ? `${latestActivity.fieldName} changed to: ${latestActivity.newValue}`
                              : latestActivity.activityType === 'created'
                              ? 'Task created'
                              : latestActivity.description || 'Activity logged'}
                          </div>
                          <div style={{ fontSize: '10px', color: mutedTextColor, marginTop: '6px' }}>
                            {ActivityStreamService.formatTimestamp(latestActivity.timestamp)}
                            {latestActivity.userEmail && ` • ${latestActivity.userEmail.split('@')[0]}`}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(linkedGoal || linkedStory) && (
                    <div
                      style={{
                        padding: '10px',
                        backgroundColor: withAlpha(themeColor, 0.12),
                        border: `1px solid ${withAlpha(themeColor, 0.3)}`,
                        borderRadius: '12px',
                        color: textColor,
                        display: 'grid',
                        gap: '6px'
                      }}
                    >
                      {linkedStory && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: themeColor, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Linked Story
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: '1.3' }}>
                            {linkedStory.title}
                          </div>
                        </div>
                      )}
                      {linkedGoal && (
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: themeColor, textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Target size={10} />
                            Linked Goal
                          </div>
                          <div style={{ fontSize: '13px', fontWeight: 600, lineHeight: '1.3' }}>
                            {linkedGoal.title}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {nextBlock && (
                    <div
                      style={{
                        padding: '8px 10px',
                        backgroundColor: withAlpha(themeColor, 0.12),
                        border: `1px solid ${withAlpha(themeColor, 0.3)}`,
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '12px',
                        color: textColor,
                      }}
                    >
                      <Clock size={12} style={{ color: themeColor, flexShrink: 0 }} />
                      <span style={{ fontWeight: 600, color: themeColor }}>Next block:</span>
                      <span>
                        {new Date(nextBlock.start).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                        {' '}
                        {new Date(nextBlock.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        {' – '}
                        {new Date(nextBlock.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}

                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <Button
                      variant="outline-warning"
                      size="sm"
                      className="d-inline-flex align-items-center gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeferTask(task);
                      }}
                    >
                      <Clock3 size={14} /> Defer
                    </Button>
                    <Button
                      variant="outline-danger"
                      size="sm"
                      className="d-inline-flex align-items-center gap-1"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm('Delete this task? This cannot be undone.')) {
                          onTaskDelete(task.id);
                        }
                      }}
                    >
                      <Trash2 size={14} /> Delete
                    </Button>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      paddingTop: '8px',
                      borderTop: `1px solid ${withAlpha(themeColor, 0.25)}`,
                      fontSize: '12px',
                      color: mutedTextColor,
                      gap: '12px',
                      flexWrap: 'wrap'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {createdAt && (
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Calendar size={12} style={{ marginRight: '4px' }} />
                          Created: {createdAt.toLocaleDateString()}
                        </div>
                      )}
                      {updatedAt && (
                        <div style={{ display: 'flex', alignItems: 'center', color: textColor, fontWeight: 500 }}>
                          <Calendar size={12} style={{ marginRight: '4px' }} />
                          Updated: {updatedAt.toLocaleDateString()} at {updatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                      {lastSyncedAt && (
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <Clock size={12} style={{ marginRight: '4px' }} />
                          Last synced: {lastSyncedAt.toLocaleDateString()} {lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      )}
                    </div>
                    <div />
                  </div>
                </Card.Body>
              </Card>
            </div>
          );
        })}
      </div>
      <DeferItemModal
        show={Boolean(deferTask)}
        onHide={() => setDeferTask(null)}
        itemType="task"
        itemId={deferTask?.id || ''}
        itemTitle={deferTask?.title || ''}
        onApply={async ({ dateMs, rationale, source }) => {
          if (!deferTask) return;
          try {
            await Promise.resolve(onTaskUpdate(deferTask.id, {
              dueDate: dateMs,
              deferredUntil: dateMs,
              deferredReason: rationale,
              deferredBy: source,
            }));
            showToast(`${deferTask.title} deferred to ${new Date(dateMs).toLocaleDateString()}.`, 'success');
            setDeferTask(null);
          } catch (error) {
            console.error('TasksCardView: failed to defer task', error);
            showToast('Failed to defer task.', 'danger');
          }
        }}
      />
      <NewCalendarEventModal
        show={Boolean(scheduleTask)}
        onHide={() => setScheduleTask(null)}
        initialValues={scheduleInitialValues}
        stories={linkedScheduleStories}
        onSaved={() => {
          const title = scheduleTask?.title || 'Task';
          setScheduleTask(null);
          showToast(`${title} added to your calendar.`, 'success');
        }}
      />
      <ToastContainer position="bottom-end" className="p-3" style={{ zIndex: 1080 }}>
        <Toast
          bg={feedback.variant}
          onClose={() => setFeedback((prev) => ({ ...prev, show: false }))}
          show={feedback.show}
          delay={3500}
          autohide
        >
          <Toast.Body className={feedback.variant === 'info' ? '' : 'text-white'}>
            {feedback.message}
          </Toast.Body>
        </Toast>
      </ToastContainer>
    </div>
  );
};

export default TasksCardView;
