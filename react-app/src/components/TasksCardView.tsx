import React, { useState, useEffect, useCallback, useMemo, useLayoutEffect, useRef } from 'react';
import { Target } from 'lucide-react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Task, Story, Goal } from '../types';
import { themeVars } from '../utils/themeVars';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import { GLOBAL_THEMES } from '../constants/globalThemes';
import KanbanCardV2 from './KanbanCardV2';
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

type DetailLevel = 'minimal' | 'compact' | 'full';
const DETAIL_LEVELS: DetailLevel[] = ['minimal', 'compact', 'full'];

const TasksCardView: React.FC<TasksCardViewProps> = ({
  tasks,
  stories,
  goals,
  onTaskUpdate,
  onTaskDelete,
  onTaskPriorityChange,
  onEditTask,
}) => {
  const { currentUser } = useAuth();
  const { themes: globalThemes } = useGlobalThemes();

  const [latestActivities, setLatestActivities] = useState<Record<string, any>>({});
  const [nextBlocks, setNextBlocks] = useState<Record<string, any | null>>({});
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(() => {
    try {
      const stored = localStorage.getItem('bob_tasks_detail_level') as DetailLevel | null;
      return stored && DETAIL_LEVELS.includes(stored) ? stored : 'compact';
    } catch {
      return 'compact';
    }
  });
  const [rowSpans, setRowSpans] = useState<Record<string, number>>({});
  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try { localStorage.setItem('bob_tasks_detail_level', detailLevel); } catch { /* noop */ }
  }, [detailLevel]);

  const themePalette = useMemo(
    () => (globalThemes && globalThemes.length ? globalThemes : GLOBAL_THEMES),
    [globalThemes]
  );

  const getStoryForTask = (task: Task): Story | undefined => {
    const storyId = task.storyId || (task.parentType === 'story' ? task.parentId : null);
    if (!storyId) return undefined;
    return stories.find((s) => s.id === storyId);
  };

  const getGoalForTask = (task: Task): Goal | undefined => {
    const story = getStoryForTask(task);
    if (story?.goalId) return goals.find((g) => g.id === story.goalId);
    const goalId = (task as any).goalId;
    return goalId ? goals.find((g) => g.id === goalId) : undefined;
  };

  const loadLatestActivityForTask = useCallback(async (taskId: string) => {
    if (!currentUser) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, 'activity_stream'),
          where('ownerUid', '==', currentUser.uid),
          where('entityId', '==', taskId),
          where('entityType', '==', 'task'),
          orderBy('timestamp', 'desc'),
          limit(1)
        )
      );
      if (!snap.empty) {
        setLatestActivities((prev) => ({ ...prev, [taskId]: snap.docs[0].data() }));
      }
    } catch (error: any) {
      if (error?.code !== 'permission-denied') {
        console.error('[TasksCardView] activity load error', taskId, error);
      }
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
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((b) => typeof b.start === 'number' && b.start >= nowMs)
        .sort((a, b) => a.start - b.start);
      setNextBlocks((prev) => ({ ...prev, [taskId]: upcoming[0] ?? null }));
    } catch {
      // ignore calendar_blocks errors silently
    }
  }, [currentUser]);

  useEffect(() => {
    tasks.forEach((task) => {
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
          if (next[id] !== span) { next[id] = span; changed = true; }
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
        const span = Math.max(1, Math.ceil((entry.contentRect.height + rowGap) / (rowHeight + rowGap)));
        updates[id] = span;
      });
      updateSpans(updates);
    });

    const tiles = Array.from(gridEl.querySelectorAll<HTMLElement>('.goals-card-tile'));
    tiles.forEach((tile) => observer.observe(tile));
    return () => observer.disconnect();
  }, [tasks, detailLevel]);

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
      <div className="d-flex justify-content-end align-items-center gap-2 mb-3">
        <span style={{ fontSize: 12, color: themeVars.muted as string, fontWeight: 600 }}>Detail:</span>
        {DETAIL_LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => setDetailLevel(level)}
            style={{
              padding: '3px 11px',
              borderRadius: 999,
              border: `1px solid ${detailLevel === level ? 'var(--brand)' : 'var(--line)'}`,
              background: detailLevel === level ? 'var(--brand)' : 'transparent',
              color: detailLevel === level ? '#fff' : 'var(--muted)',
              fontSize: 11,
              fontWeight: 600,
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {level}
          </button>
        ))}
      </div>

      <div className="goals-card-grid goals-card-grid--grid" ref={gridRef}>
        {tasks.map((task) => {
          const parentStory = getStoryForTask(task);
          const parentGoal = getGoalForTask(task);
          const latestActivity = latestActivities[task.id];
          const latestNote = latestActivity
            ? String(latestActivity.noteContent || latestActivity.description || '').trim()
            : '';
          const nextBlock = nextBlocks[task.id] ?? undefined;
          const rowSpan = rowSpans[task.id];

          return (
            <div
              key={task.id}
              className="goals-card-tile"
              data-task-id={task.id}
              style={rowSpan ? { gridRowEnd: `span ${rowSpan}` } : undefined}
            >
              <KanbanCardV2
                item={task}
                type="task"
                goal={parentGoal}
                story={parentStory}
                themes={themePalette}
                latestNote={latestNote}
                showLatestNote={true}
                scheduledBlock={nextBlock}
                detailLevel={detailLevel}
                onEdit={(item) => onEditTask(item as Task)}
                onDelete={(item) => {
                  if (window.confirm('Delete this task? This cannot be undone.')) {
                    onTaskDelete(item.id);
                  }
                }}
                onItemSelect={(item) => onEditTask(item as Task)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TasksCardView;
