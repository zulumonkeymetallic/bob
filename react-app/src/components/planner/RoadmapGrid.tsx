/**
 * RoadmapGrid — themes × quarters, drag a goal to reschedule it.
 *
 * Extracted from VisualCanvas so the roadmap can be a real planner level
 * (/planner?level=roadmap) instead of a layout mode buried in a 1,500-line canvas component.
 * VisualCanvas renders this same component for ?layout=roadmap, so there is one implementation
 * and the two entry points cannot drift.
 *
 * It owns its own goals subscription and filters. That is the whole point of the extraction:
 * the grid previously depended on VisualCanvas's Firestore listeners, zoom, link-mode and
 * filter state, none of which a planner level has or wants.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Form } from 'react-bootstrap';
import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { Filter } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import type { Goal } from '../../types';
import { GLOBAL_THEMES } from '../../constants/globalThemes';
import { goalThemeColor as resolveGoalThemeColor } from '../../utils/storyCardFormatting';
import {
  rescheduleGoalToQuarter as computeGoalDates,
  roadmapColumnOrder,
  UNSCHEDULED_COLUMN,
} from '../../utils/roadmapSchedule';
import EditGoalModal from '../EditGoalModal';

const GOAL_KIND_ICON: Record<string, string> = {
  focus: '◆', umbrella: '◈', phase: '◉', leaf: '○',
};

export function computeQuarterKey(ts: number | null | undefined): string | null {
  if (!ts || !Number.isFinite(ts)) return null;
  const d = new Date(ts);
  return `${d.getFullYear()}-Q${Math.ceil((d.getMonth() + 1) / 3)}`;
}

export function quarterLabel(key: string): string {
  if (key === UNSCHEDULED_COLUMN) return 'Unscheduled';
  const [year, q] = key.split('-');
  return `${q} ${year}`;
}

const COL_W = 210;
const THEME_COL_W = 168;

const RoadmapChip: React.FC<{
  goal: Goal;
  themeColor: string;
  onEdit: (goal: Goal) => void;
  onDragStartGoal: (goalId: string) => void;
  onDragEndGoal: () => void;
}> = ({ goal, themeColor, onEdit, onDragStartGoal, onDragEndGoal }) => {
  const g = goal as any;
  const plannedStartKey = computeQuarterKey(typeof g.plannedStartDate === 'number' ? g.plannedStartDate : null);
  const isDone = Number(g.status) === 4;
  const isActive = Number(g.status) === 1;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', goal.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartGoal(goal.id);
      }}
      onDragEnd={onDragEndGoal}
      onClick={() => onEdit(goal)}
      title={`${goal.title} — click to edit, drag to reschedule`}
      style={{
        borderLeft: `3px solid ${themeColor}`,
        // Theme variables throughout: fixed light greys here left white blocks glowing in dark mode.
        background: isDone ? 'var(--panel, #f3f4f6)' : isActive ? 'var(--card, #fff)' : 'var(--panel, #fafafa)',
        color: 'var(--text, #1a1a1a)',
        borderRadius: '0 6px 6px 0',
        padding: '4px 7px',
        cursor: 'grab',
        boxShadow: '0 1px 2px rgba(0,0,0,0.07)',
        fontSize: 11,
        opacity: isDone ? 0.55 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: themeColor, fontSize: 9, flexShrink: 0 }}>{GOAL_KIND_ICON[g.goalKind] ?? '○'}</span>
        <span style={{ fontWeight: 600, whiteSpace: 'normal', wordBreak: 'break-word' }}>{goal.title}</span>
      </div>
      <div style={{ color: 'var(--muted, #9ca3af)', fontSize: 9, marginTop: 1, display: 'flex', gap: 6 }}>
        {g.ref && <span>{g.ref}</span>}
        {plannedStartKey && <span>Start {quarterLabel(plannedStartKey)}</span>}
      </div>
    </div>
  );
};

interface RoadmapGridProps {
  /** Hide the built-in filter row when the host already provides one (VisualCanvas does). */
  showFilters?: boolean;
  /** Goals to render. Omit to let this component load and filter them itself. */
  goals?: Goal[];
}

const RoadmapGrid: React.FC<RoadmapGridProps> = ({ showFilters = true, goals: providedGoals }) => {
  const { currentUser } = useAuth();
  const [ownGoals, setOwnGoals] = useState<Goal[]>([]);
  const [search, setSearch] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const selfLoading = providedGoals === undefined;

  useEffect(() => {
    if (!selfLoading || !currentUser?.uid) return;
    const unsub = onSnapshot(
      query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid)),
      (snap) => setOwnGoals(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Goal))),
    );
    return () => unsub();
  }, [selfLoading, currentUser]);

  const sourceGoals = providedGoals ?? ownGoals;

  const goals = useMemo(() => {
    if (!selfLoading) return sourceGoals;   // host has already filtered
    const s = search.trim().toLowerCase();
    return sourceGoals.filter((g) => {
      if (activeOnly && Number(g.status) !== 1) return false;
      if (s && !g.title?.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [sourceGoals, selfLoading, search, activeOnly]);

  const currentQuarterKey = useMemo(() => computeQuarterKey(Date.now()), []);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    if (currentQuarterKey) keys.add(currentQuarterKey);
    for (const g of goals) {
      const k1 = computeQuarterKey((g as any).endDate || (g as any).dueDate);
      const k2 = computeQuarterKey((g as any).plannedStartDate);
      if (k1) keys.add(k1);
      if (k2) keys.add(k2);
    }
    return roadmapColumnOrder([...keys], currentQuarterKey);
  }, [goals, currentQuarterKey]);

  const themes = useMemo(
    () => GLOBAL_THEMES.filter((t) => goals.some((g) => Number((g as any).theme ?? 0) === t.id)),
    [goals],
  );

  const grid = useMemo(() => {
    const m = new Map<number, Map<string, Goal[]>>();
    for (const g of goals) {
      const themeId = Number((g as any).theme ?? 0);
      const cell = computeQuarterKey((g as any).endDate || (g as any).dueDate) ?? UNSCHEDULED_COLUMN;
      if (!m.has(themeId)) m.set(themeId, new Map());
      const row = m.get(themeId)!;
      if (!row.has(cell)) row.set(cell, []);
      row.get(cell)!.push(g);
    }
    return m;
  }, [goals]);

  /**
   * A drop writes BOTH goal dates. Only endDate used to be written, which left startDate stale
   * and made the overnight story realignment behave differently here than on the Gantt.
   */
  const reschedule = useCallback(async (goalId: string, qKey: string) => {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    try {
      if (qKey === UNSCHEDULED_COLUMN) {
        await updateDoc(doc(db, 'goals', goalId), { endDate: null, dueDate: null, updatedAt: serverTimestamp() } as any);
        return;
      }
      const next = computeGoalDates(qKey, (goal as any).startDate, (goal as any).endDate ?? (goal as any).dueDate);
      if (!next) return;
      await updateDoc(doc(db, 'goals', goalId), {
        startDate: next.startDate, endDate: next.endDate, updatedAt: serverTimestamp(),
      } as any);
    } catch (err) {
      console.error('Failed to reschedule goal', goalId, err);
    }
  }, [goals]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {showFilters && (
        <div className="d-flex align-items-center gap-2 flex-nowrap px-3 pt-2" style={{ overflowX: 'auto', flexShrink: 0 }}>
          <Form.Control
            size="sm" placeholder="Search goals…" value={search}
            onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 220 }}
          />
          <Form.Check
            type="switch" id="roadmap-active-only" label="Active only" checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)} className="text-nowrap small"
          />
          <span className="text-muted small text-nowrap ms-auto">{goals.length} goals</span>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', background: 'var(--bg, #f8f9fa)', padding: '12px 16px' }}>
        {goals.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted, #6b7280)' }}>
            <Filter size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
            <div className="fw-medium">No goals match current filters</div>
          </div>
        ) : (
          <div style={{ minWidth: 'max-content' }}>
            <div style={{ display: 'flex', marginBottom: 2 }}>
              <div style={{ width: THEME_COL_W, flexShrink: 0 }} />
              {columns.map((qKey) => (
                <div key={qKey} style={{
                  width: COL_W, flexShrink: 0, padding: '5px 10px',
                  fontSize: 11, fontWeight: 700, color: 'var(--text, #374151)',
                  borderLeft: '1px solid var(--line, #e5e7eb)',
                  background: qKey === currentQuarterKey ? 'var(--accent-soft, #dbeafe)' : 'var(--panel, #f1f5f9)',
                }}>
                  {quarterLabel(qKey)}
                  {qKey === currentQuarterKey && <span style={{ marginLeft: 5, fontSize: 9, color: 'var(--brand, #3b82f6)' }}>▶ now</span>}
                </div>
              ))}
            </div>

            {themes.map((theme) => {
              const themeGoals = grid.get(theme.id);
              return (
                <div key={theme.id} style={{ display: 'flex', marginBottom: 1 }}>
                  <div style={{
                    width: THEME_COL_W, flexShrink: 0, padding: '8px 10px',
                    borderTop: `3px solid ${theme.color}`, background: `${theme.color}18`,
                    fontSize: 11, fontWeight: 700, color: theme.color,
                  }}>
                    {theme.name}
                  </div>
                  {columns.map((qKey) => {
                    const cellGoals = themeGoals?.get(qKey) || [];
                    const cellId = `${theme.id}:${qKey}`;
                    const isDropTarget = dragId != null && dragOverCell === cellId;
                    return (
                      <div
                        key={qKey}
                        onDragOver={(e) => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverCell(cellId); } }}
                        onDragLeave={() => setDragOverCell((p) => (p === cellId ? null : p))}
                        onDrop={(e) => {
                          e.preventDefault();
                          const id = e.dataTransfer.getData('text/plain') || dragId;
                          setDragOverCell(null);
                          if (id) reschedule(id, qKey);
                        }}
                        style={{
                          width: COL_W, flexShrink: 0, padding: '6px 8px', minHeight: 72,
                          borderLeft: '1px solid var(--line, #e5e7eb)', borderTop: '1px solid var(--line, #e5e7eb)',
                          background: isDropTarget ? 'var(--accent-soft, #dbeafe)' : 'var(--card, #fff)',
                          boxShadow: isDropTarget ? `inset 0 0 0 2px ${theme.color}` : undefined,
                          display: 'flex', flexDirection: 'column', gap: 4,
                        }}
                      >
                        {cellGoals.map((g) => (
                          <RoadmapChip
                            key={g.id} goal={g}
                            themeColor={resolveGoalThemeColor(g, GLOBAL_THEMES) || theme.color}
                            onEdit={setEditingGoal}
                            onDragStartGoal={setDragId}
                            onDragEndGoal={() => { setDragId(null); setDragOverCell(null); }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editingGoal && (
        <EditGoalModal
          goal={editingGoal}
          show={!!editingGoal}
          onClose={() => setEditingGoal(null)}
          currentUserId={currentUser?.uid || ''}
          allGoals={sourceGoals}
        />
      )}
    </div>
  );
};

export default RoadmapGrid;
