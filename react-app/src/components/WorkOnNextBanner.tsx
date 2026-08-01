/**
 * "Work on next" section for the NotificationStream popover.
 *
 * Answers the one question the stream never did: of everything in the active sprint, what
 * should I pick up right now? Ordering is not invented here — it delegates to
 * compareTop3Stories/compareTop3Tasks, which already encode the app's priority contract
 * (human pin rank first, then AI focus rank, then aiCriticalityScore descending). Anything
 * that changes that contract should change it there, so the Kanban's "Priority stack" sort
 * and this list can never disagree.
 *
 * Done-ness goes through workStatus' isDoneStatus rather than a local comparison: stories and
 * tasks use different status scales (story 4 = done, task 2 = done) and hand-rolling that test
 * is exactly how completed work ends up presented as outstanding.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { useSidebar } from '../contexts/SidebarContext';
import { Story, Task } from '../types';
import { compareTop3Stories, compareTop3Tasks, getEntityAiScore } from '../utils/top3';
import { getManualPriorityRank } from '../utils/manualPriority';
import { isDoneStatus, storyLane, taskLane, LANE_LABELS, LANE_COLORS } from '../utils/workStatus';

const MAX_ROWS = 5;

/** Chores/habits/routines are recurring upkeep, not "what to work on" — same exclusion the
 *  Kanban board applies (EXCLUDED_TASK_TYPES in KanbanBoardV2). */
const EXCLUDED_TASK_TYPES = new Set(['chore', 'routine', 'habit', 'core', 'read', 'watch']);

type Row = {
  id: string;
  kind: 'story' | 'task';
  ref: string;
  title: string;
  laneLabel: string;
  laneColor: string;
  score: number;
  pinRank: number | null;
  raw: Story | Task;
};

const WorkOnNextBanner: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { selectedSprintId } = useSprint();
  const { showSidebar } = useSidebar();

  const [stories, setStories] = useState<Story[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) { setStories([]); setTasks([]); return; }
    const unsubs = [
      onSnapshot(
        query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
        (snap) => setStories(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Story))),
        () => setStories([]),
      ),
      onSnapshot(
        query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
        (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Task))),
        () => setTasks([]),
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [currentUser?.uid, currentPersona]);

  const rows = useMemo<Row[]>(() => {
    if (!selectedSprintId) return [];

    const storyRows = stories
      .filter((s) => String((s as any).sprintId || '') === selectedSprintId)
      .filter((s) => !isDoneStatus((s as any).status, 'story'))
      .sort(compareTop3Stories)
      .map((s) => ({
        id: s.id,
        kind: 'story' as const,
        ref: String((s as any).ref || 'ST-?'),
        title: String(s.title || 'Untitled story'),
        laneLabel: LANE_LABELS[storyLane((s as any).status)],
        laneColor: LANE_COLORS[storyLane((s as any).status)],
        score: getEntityAiScore(s),
        pinRank: getManualPriorityRank(s),
        raw: s,
      }));

    const taskRows = tasks
      .filter((t) => String((t as any).sprintId || '') === selectedSprintId)
      .filter((t) => !EXCLUDED_TASK_TYPES.has(String((t as any).type || '').toLowerCase()))
      .filter((t) => !isDoneStatus((t as any).status, 'task'))
      .sort((a, b) => compareTop3Tasks(a, b))
      .map((t) => ({
        id: t.id,
        kind: 'task' as const,
        ref: String((t as any).ref || 'TK-?'),
        title: String(t.title || 'Untitled task'),
        laneLabel: LANE_LABELS[taskLane((t as any).status)],
        laneColor: LANE_COLORS[taskLane((t as any).status)],
        score: getEntityAiScore(t),
        pinRank: getManualPriorityRank(t),
        raw: t,
      }));

    // Merge on the same terms the two comparators already agree on: pinned first by rank,
    // then by AI score. Interleaving stories and tasks this way keeps a pinned task above an
    // unpinned story rather than always front-loading one entity type.
    return [...storyRows, ...taskRows]
      .sort((a, b) => {
        const pinA = a.pinRank || 99;
        const pinB = b.pinRank || 99;
        if (pinA !== pinB) return pinA - pinB;
        return b.score - a.score;
      })
      .slice(0, MAX_ROWS);
  }, [stories, tasks, selectedSprintId]);

  if (rows.length === 0) return null;

  return (
    <div style={{ minWidth: 260 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted, #6b7280)' }}>
          Work on next
        </span>
        <a
          href="/sprints/kanban"
          style={{ fontSize: 10, color: 'var(--brand, #5f77dc)', textDecoration: 'underline' }}
        >
          View board
        </a>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row) => (
          <button
            key={`${row.kind}-${row.id}`}
            onClick={() => showSidebar(row.raw as any, row.kind)}
            title={`${row.ref} — ${row.title}`}
            style={{
              display: 'block', width: '100%',
              background: 'var(--notion-hover, rgba(0,0,0,0.04))',
              border: '1px solid var(--border, #e5e7eb)', borderRadius: 6,
              padding: '5px 8px', textAlign: 'left', cursor: 'pointer',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {row.pinRank && (
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brand, #5f77dc)', flexShrink: 0 }}>
                  P{row.pinRank}
                </span>
              )}
              <span style={{ fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                {row.title}
              </span>
              {Number.isFinite(row.score) && row.score > 0 && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted, #6b7280)', flexShrink: 0 }}>
                  {Math.round(row.score)}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--muted, #9ca3af)' }}>{row.ref}</span>
              <span style={{ fontSize: 9, color: row.laneColor }}>{row.laneLabel}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default WorkOnNextBanner;
