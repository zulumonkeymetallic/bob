import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { Card, Badge, Button, Dropdown, Form } from 'react-bootstrap';
import { Edit3, Trash2, ChevronDown, Target, Calendar, Activity, Clock } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Task, Story, Goal } from '../types';
import { getPriorityColor } from '../utils/statusHelpers';
import { themeVars } from '../utils/themeVars';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { GLOBAL_THEMES, migrateThemeValue, type GlobalTheme } from '../constants/globalThemes';
import { ActivityStreamService } from '../services/ActivityStreamService';
import { priorityLabel, taskStatusText } from '../utils/storyCardFormatting';

interface TasksCardViewProps {
  tasks: Task[];
  stories: Story[];
  goals: Goal[];
  onTaskUpdate: (taskId: string, updates: Partial<Task>) => void;
  onTaskDelete: (taskId: string) => void;
  onTaskPriorityChange: (taskId: string, newPriority: number) => void;
}

const TasksCardView: React.FC<TasksCardViewProps> = ({
  tasks,
  stories,
  goals,
  onTaskUpdate,
  onTaskDelete,
  onTaskPriorityChange
}) => {
  const { currentUser } = useAuth();
  const { showSidebar } = useSidebar();
  const { themes: globalThemes } = useGlobalThemes();
  const [latestActivities, setLatestActivities] = useState<{ [taskId: string]: any }>({});
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

  const hexToRgb = (hex: string) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  };

  const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b]
    .map(v => {
      const clamped = Math.max(0, Math.min(255, Math.round(v)));
      return clamped.toString(16).padStart(2, '0');
    })
    .join('')}`;

  const withAlpha = (color: string, alpha: number) => {
    const pct = Math.round(Math.max(0, Math.min(1, alpha)) * 100);
    if (pct <= 0) return 'transparent';
    if (pct >= 100) return color;
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  };

  const lightenColor = (hex: string, amount: number) => {
    const { r, g, b } = hexToRgb(hex);
    const factor = Math.max(0, Math.min(1, amount));
    const nr = r + (255 - r) * factor;
    const ng = g + (255 - g) * factor;
    const nb = b + (255 - b) * factor;
    return rgbToHex(nr, ng, nb);
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

  useEffect(() => {
    tasks.forEach(task => {
      loadLatestActivityForTask(task.id);
    });
  }, [tasks, currentUser, loadLatestActivityForTask]);

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

  const handleStatusChange = (taskId: string, newStatus: 'Backlog' | 'In Progress' | 'Done' | 'Blocked') => {
    const numericStatus = newStatus === 'Backlog' ? 0 : newStatus === 'In Progress' ? 1 : newStatus === 'Done' ? 2 : 3;
    onTaskUpdate(taskId, { status: numericStatus as any });
  };

  const toDate = (value: any) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };

  const statusColors = {
    Backlog: 'var(--muted)',
    'In Progress': 'var(--green)',
    Done: 'var(--brand)',
    Blocked: 'var(--red)'
  } as const;

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
          const gradientStart = lightenColor(themeColor, 0.45);
          const gradientEnd = lightenColor(themeColor, 0.78);
          const cardBackground = `linear-gradient(165deg, ${gradientStart} 0%, ${gradientEnd} 100%)`;
          const textColor = themeVars.text as string;
          const mutedTextColor = themeVars.muted as string;
          const statusLabel = taskStatusText(task.status);
          const priorityText = priorityLabel(task.priority, `P${task.priority ?? 2}`);
          const priorityVariant = getPriorityColor(task.priority);
          const latestActivity = latestActivities[task.id];
          const showActivity = showUpdates && !!latestActivity;
          const showTaskDescription = showDescriptions && !!task.description;
          const createdAt = toDate((task as any).createdAt);
          const updatedAt = toDate((task as any).updatedAt);
          const lastSyncedRaw = (task as any).macSyncedAt ?? (task as any).deviceUpdatedAt ?? (task as any).serverUpdatedAt ?? (task as any).updatedAt;
          const lastSyncedAt = toDate(lastSyncedRaw);
          const rowSpan = rowSpans[task.id];

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
                  background: cardBackground,
                  color: textColor,
                  display: 'flex',
                  flexDirection: 'column'
                }}
                onClick={() => {
                  try { showSidebar(task, 'task'); } catch { }
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
                <div style={{ height: '6px', backgroundColor: themeColor }} />
                <Card.Body style={{ padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {task.ref && (
                        <div style={{ fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.4px', color: mutedTextColor }}>
                          {task.ref}
                        </div>
                      )}
                      <h5 style={{ margin: '4px 0 0 0', fontSize: '16px', fontWeight: 600, lineHeight: '1.3', color: textColor }}>
                        {task.title}
                      </h5>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
                          showSidebar(task, 'task');
                        }}
                      >
                        <Edit3 size={14} />
                      </Button>
                      <Dropdown onClick={(e) => e.stopPropagation()}>
                        <Dropdown.Toggle
                          variant="outline-secondary"
                          size="sm"
                          style={{ border: 'none', padding: '4px 6px', color: textColor }}
                        >
                          <ChevronDown size={16} />
                        </Dropdown.Toggle>
                        <Dropdown.Menu style={{ zIndex: 2000 }} popperConfig={{ strategy: 'fixed' }}>
                          <Dropdown.Header>Change Status</Dropdown.Header>
                          <Dropdown.Item onClick={() => handleStatusChange(task.id, 'Backlog')}>Backlog</Dropdown.Item>
                          <Dropdown.Item onClick={() => handleStatusChange(task.id, 'In Progress')}>In Progress</Dropdown.Item>
                          <Dropdown.Item onClick={() => handleStatusChange(task.id, 'Done')}>Done</Dropdown.Item>
                          <Dropdown.Item onClick={() => handleStatusChange(task.id, 'Blocked')}>Blocked</Dropdown.Item>
                          <Dropdown.Divider />
                          <Dropdown.Header>Change Priority</Dropdown.Header>
                          <Dropdown.Item onClick={() => onTaskPriorityChange(task.id, 4)}>Critical (4)</Dropdown.Item>
                          <Dropdown.Item onClick={() => onTaskPriorityChange(task.id, 3)}>High (3)</Dropdown.Item>
                          <Dropdown.Item onClick={() => onTaskPriorityChange(task.id, 2)}>Medium (2)</Dropdown.Item>
                          <Dropdown.Item onClick={() => onTaskPriorityChange(task.id, 1)}>Low (1)</Dropdown.Item>
                          <Dropdown.Divider />
                          <Dropdown.Item
                            className="text-danger"
                            onClick={() => {
                              if (window.confirm('Delete this task? This cannot be undone.')) {
                                onTaskDelete(task.id);
                              }
                            }}
                          >
                            <Trash2 size={14} className="me-2" />
                            Delete Task
                          </Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown>
                    </div>
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
                            display: '-webkit-box',
                            WebkitLineClamp: 3,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden'
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

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <Badge style={{ backgroundColor: themeColor, color: themeTextColor, fontSize: '11px' }}>
                      {themeDef.label}
                    </Badge>
                    <Badge
                      style={{
                        backgroundColor: statusColors[statusLabel as keyof typeof statusColors] || 'var(--muted)',
                        color: 'var(--on-accent)',
                        fontSize: '11px'
                      }}
                    >
                      {statusLabel}
                    </Badge>
                    <Badge bg={priorityVariant} style={{ fontSize: '11px' }}>
                      {priorityText}
                    </Badge>
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
    </div>
  );
};

export default TasksCardView;
