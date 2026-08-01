/**
 * WeekPlanGrid — the roadmap's week detail level.
 *
 * A planning surface, not a diary. The existing calendar view (SprintWeekPlanner) renders a
 * react-big-calendar time grid, which is the right shape for "where exactly does this sit
 * today" and the wrong one for "does this week hold together". Here each day is a COLUMN OF
 * CARDS in the same format the rest of the roadmap uses, with the day's theme allocations
 * shown as coloured bands above them for context.
 *
 * What appears where:
 *  - Backlog column: sprint stories that have no calendar block yet — the pile you drag from.
 *  - Day columns: whatever the AI (or you) has scheduled, as cards, read from calendar_blocks
 *    joined back to their story/task.
 *  - Theme bands: the theme_allocations plan for that weekday, straight from the plan doc
 *    rather than from materialised blocks — the same fix applied to the calendar's overlay,
 *    since only Fitness and Work are ever materialised into real blocks.
 *
 * Dragging a card onto a day calls schedulePlannerItem, the same callable the calendar's
 * drag-from-backlog uses. That matters: it already honours planningMode, so in strict mode
 * the item is placed inside a matching theme allocation rather than any free gap, which is
 * exactly the behaviour the nightly orchestration applies.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { useSprint } from '../../contexts/SprintContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { useThemeAppearance } from '../../hooks/useThemeAppearance';
import { schedulePlannerItem, normalizePlannerSchedulingError } from '../../utils/plannerScheduling';
import { isDoneStatus } from '../../utils/workStatus';
import { compareTop3Stories, getEntityAiScore } from '../../utils/top3';
import { getManualPriorityRank } from '../../utils/manualPriority';
import { themeVars } from '../../utils/themeVars';
import type { Story, Task } from '../../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const VISIBLE_DAYS = 7;
const COL_W = 200;
const BACKLOG_W = 220;

type ThemeAllocationRow = {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  theme: string;
  subTheme?: string | null;
};

interface WeekPlanGridProps {
  /** Start of the displayed week (local midnight). */
  weekStart: Date;
  /** Matches the calendar surface's Smart/Strict control — passed through to the scheduler. */
  planningMode?: 'smart' | 'strict';
}

const startOfDayMs = (d: Date | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
};

const WeekPlanGrid: React.FC<WeekPlanGridProps> = ({ weekStart, planningMode = 'smart' }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();
  const { showSidebar } = useSidebar();
  const { resolveThemeAppearance } = useThemeAppearance();

  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [allocations, setAllocations] = useState<{
    allocations: ThemeAllocationRow[];
    weeklyOverrides: Record<string, ThemeAllocationRow[]>;
  }>({ allocations: [], weeklyOverrides: {} });
  const [dragItem, setDragItem] = useState<{ type: 'story' | 'task'; id: string; title: string } | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const days = useMemo(
    () => Array.from({ length: VISIBLE_DAYS }, (_, i) => new Date(startOfDayMs(weekStart) + i * DAY_MS)),
    [weekStart],
  );
  const rangeStart = startOfDayMs(weekStart);
  const rangeEnd = rangeStart + VISIBLE_DAYS * DAY_MS;

  useEffect(() => {
    if (!currentUser?.uid) return;
    const personaMatch = (row: any) =>
      currentPersona === 'work' ? row.persona === 'work' : row.persona == null || row.persona === 'personal';
    const unsubs = [
      onSnapshot(query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid)),
        (s) => setStories(s.docs.map((d) => ({ id: d.id, ...d.data() } as Story)).filter(personaMatch)),
        () => setStories([])),
      onSnapshot(query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid)),
        (s) => setTasks(s.docs.map((d) => ({ id: d.id, ...d.data() } as Task)).filter(personaMatch)),
        () => setTasks([])),
      onSnapshot(query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid)),
        (s) => setBlocks(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        () => setBlocks([])),
      onSnapshot(doc(db, 'theme_allocations', currentUser.uid),
        (snap) => {
          const data = snap.exists() ? (snap.data() as any) : null;
          setAllocations({
            allocations: Array.isArray(data?.allocations) ? data.allocations : [],
            weeklyOverrides: (data?.weeklyOverrides && typeof data.weeklyOverrides === 'object') ? data.weeklyOverrides : {},
          });
        },
        () => setAllocations({ allocations: [], weeklyOverrides: {} })),
    ];
    return () => unsubs.forEach((u) => u());
  }, [currentUser?.uid, currentPersona]);

  const storyById = useMemo(() => new Map(stories.map((s) => [s.id, s])), [stories]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  /** Scheduled work per day — calendar blocks in range that point at a story or task. */
  const scheduledByDay = useMemo(() => {
    const map = new Map<number, Array<{ block: any; entity: Story | Task; type: 'story' | 'task' }>>();
    days.forEach((d) => map.set(startOfDayMs(d), []));
    for (const b of blocks) {
      const start = Number(b.start || 0);
      if (!Number.isFinite(start) || start < rangeStart || start >= rangeEnd) continue;
      const storyId = b.storyId ? String(b.storyId) : '';
      const taskId = b.taskId ? String(b.taskId) : '';
      const entity = storyId ? storyById.get(storyId) : taskId ? taskById.get(taskId) : undefined;
      if (!entity) continue;
      const key = startOfDayMs(start);
      if (!map.has(key)) continue;
      map.get(key)!.push({ block: b, entity, type: storyId ? 'story' : 'task' });
    }
    // Highest priority first, mirroring how the AI is meant to schedule.
    map.forEach((list) => list.sort((a, b) => Number(a.block.start || 0) - Number(b.block.start || 0)));
    return map;
  }, [blocks, days, rangeStart, rangeEnd, storyById, taskById]);

  const scheduledEntityIds = useMemo(() => {
    const ids = new Set<string>();
    scheduledByDay.forEach((list) => list.forEach((x) => ids.add(x.entity.id)));
    return ids;
  }, [scheduledByDay]);

  /**
   * The pile you drag from: sprint stories that are open and not already on the calendar
   * anywhere in this week. Ordered by the same comparator the Kanban's priority stack uses,
   * so the top of the backlog is what should be scheduled first.
   */
  const backlog = useMemo(() => {
    if (!selectedSprintId) return [];
    return stories
      .filter((s) => String((s as any).sprintId || '') === selectedSprintId)
      .filter((s) => !isDoneStatus((s as any).status, 'story'))
      .filter((s) => !scheduledEntityIds.has(s.id))
      .sort(compareTop3Stories);
  }, [stories, selectedSprintId, scheduledEntityIds]);

  /** Theme bands for a given weekday, from the plan doc (week override wins). */
  const allocationsForDay = useCallback((day: Date): ThemeAllocationRow[] => {
    const weekKey = new Date(rangeStart).toISOString().slice(0, 10);
    const rows = Array.isArray(allocations.weeklyOverrides[weekKey])
      ? allocations.weeklyOverrides[weekKey]
      : allocations.allocations;
    return rows.filter((r) => Number(r.dayOfWeek) === day.getDay());
  }, [allocations, rangeStart]);

  const handleDrop = useCallback(async (day: Date) => {
    const item = dragItem;
    setDragItem(null);
    setDragOverDay(null);
    if (!item) return;
    setBusyId(item.id);
    setFeedback(null);
    try {
      await schedulePlannerItem({
        itemType: item.type,
        itemId: item.id,
        targetDateMs: startOfDayMs(day),
        intent: 'move',
        source: 'roadmap_week_grid',
        targetSprintId: selectedSprintId || null,
        // Passed through so strict mode confines placement to a matching theme allocation,
        // the same rule the nightly orchestration applies.
        planningMode,
      });
      setFeedback({ tone: 'ok', text: `Scheduled "${item.title}"` });
    } catch (err) {
      setFeedback({ tone: 'error', text: normalizePlannerSchedulingError(err).message });
    } finally {
      setBusyId(null);
    }
  }, [dragItem, selectedSprintId, planningMode]);

  const cardStyle = (accent: string): React.CSSProperties => ({
    borderLeft: `3px solid ${accent}`,
    background: 'var(--card, #fff)',
    color: themeVars.text as string,
    borderRadius: '0 6px 6px 0',
    padding: '5px 7px',
    marginBottom: 4,
    fontSize: 11,
    boxShadow: '0 1px 2px rgba(0,0,0,0.07)',
    cursor: 'grab',
  });

  const entityAccent = (entity: Story | Task): string =>
    resolveThemeAppearance((entity as any).theme)?.color || 'var(--brand, #5f77dc)';

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg, #f8f9fa)', padding: '0 16px 12px' }}>
      {feedback && (
        <div className={`small mb-2 ${feedback.tone === 'ok' ? 'text-success' : 'text-danger'}`}>{feedback.text}</div>
      )}
      <div style={{ display: 'flex', minWidth: 'max-content' }}>
        {/* Backlog */}
        <div style={{ width: BACKLOG_W, flexShrink: 0, paddingRight: 8, position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg, #f8f9fa)' }}>
          <div style={{ padding: '8px 4px', fontSize: 11, fontWeight: 700, color: themeVars.text as string }}>
            Backlog <span style={{ color: themeVars.muted as string }}>({backlog.length})</span>
          </div>
          {backlog.length === 0 && (
            <div style={{ fontSize: 10, color: themeVars.muted as string, padding: '4px' }}>
              {selectedSprintId ? 'Everything in this sprint is scheduled.' : 'No active sprint selected.'}
            </div>
          )}
          {backlog.map((s) => (
            <div
              key={s.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', s.id);
                e.dataTransfer.effectAllowed = 'move';
                setDragItem({ type: 'story', id: s.id, title: s.title || 'Story' });
              }}
              onDragEnd={() => { setDragItem(null); setDragOverDay(null); }}
              onClick={() => showSidebar(s as any, 'story')}
              title={`${s.title} — drag onto a day to schedule, click for detail`}
              style={{ ...cardStyle(entityAccent(s)), opacity: busyId === s.id ? 0.5 : 1 }}
            >
              <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{s.title}</div>
              <div style={{ color: themeVars.muted as string, fontSize: 9, marginTop: 2, display: 'flex', gap: 6 }}>
                <span>{(s as any).ref}</span>
                {getManualPriorityRank(s) && <span style={{ color: 'var(--bs-danger)', fontWeight: 700 }}>P{getManualPriorityRank(s)}</span>}
                {Number.isFinite(getEntityAiScore(s)) && getEntityAiScore(s) > 0 && <span>AI {Math.round(getEntityAiScore(s))}</span>}
              </div>
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((day) => {
          const dayKey = startOfDayMs(day);
          const scheduled = scheduledByDay.get(dayKey) || [];
          const bands = allocationsForDay(day);
          const isToday = dayKey === startOfDayMs(new Date());
          const isDropTarget = dragItem != null && dragOverDay === dayKey;
          return (
            <div
              key={dayKey}
              onDragOver={(e) => { if (dragItem) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverDay(dayKey); } }}
              onDragLeave={() => setDragOverDay((p) => (p === dayKey ? null : p))}
              onDrop={(e) => { e.preventDefault(); handleDrop(day); }}
              style={{
                width: COL_W, flexShrink: 0, minHeight: 220, padding: '0 6px 8px',
                borderLeft: '1px solid var(--line, #e5e7eb)',
                background: isDropTarget ? 'var(--accent-soft, #dbeafe)' : 'transparent',
              }}
            >
              <div style={{
                position: 'sticky', top: 0, zIndex: 1, padding: '8px 2px 6px',
                background: isToday ? 'var(--accent-soft, #dbeafe)' : 'var(--bg, #f8f9fa)',
                fontSize: 11, fontWeight: 700, color: themeVars.text as string,
              }}>
                {day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
                {isToday && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--brand, #3b82f6)' }}>▶ today</span>}
              </div>

              {/* Theme allocations — context for what this day is FOR, read from the plan doc
                  rather than materialised blocks (only Fitness and Work ever materialise). */}
              {bands.map((b, i) => {
                const appearance = resolveThemeAppearance(b.subTheme || b.theme);
                return (
                  <div
                    key={`${dayKey}-band-${i}`}
                    title={`${b.subTheme || b.theme} · ${b.startTime}–${b.endTime}`}
                    style={{
                      background: `color-mix(in srgb, ${appearance?.color || '#94a3b8'} 22%, transparent)`,
                      borderLeft: `3px solid ${appearance?.color || '#94a3b8'}`,
                      borderRadius: '0 4px 4px 0', padding: '2px 6px', marginBottom: 3,
                      fontSize: 9, color: themeVars.text as string,
                      display: 'flex', justifyContent: 'space-between', gap: 4,
                    }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.subTheme || b.theme}</span>
                    <span style={{ color: themeVars.muted as string, flexShrink: 0 }}>{b.startTime}</span>
                  </div>
                );
              })}

              {bands.length > 0 && scheduled.length > 0 && (
                <div style={{ height: 1, background: 'var(--line, #e5e7eb)', margin: '6px 0' }} />
              )}

              {/* Scheduled work, as cards in the roadmap's format. */}
              {scheduled.map(({ block, entity, type }) => (
                <div
                  key={block.id}
                  onClick={() => showSidebar(entity as any, type)}
                  title={`${entity.title} — click for detail`}
                  style={{ ...cardStyle(entityAccent(entity)), cursor: 'pointer' }}
                >
                  <div style={{ fontWeight: 600, wordBreak: 'break-word' }}>{entity.title}</div>
                  <div style={{ color: themeVars.muted as string, fontSize: 9, marginTop: 2, display: 'flex', gap: 6 }}>
                    <span>{(entity as any).ref}</span>
                    <span>{new Date(Number(block.start)).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              ))}

              {scheduled.length === 0 && bands.length === 0 && (
                <div style={{ fontSize: 10, color: themeVars.muted as string, padding: '6px 2px' }}>Drop here</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default WeekPlanGrid;
