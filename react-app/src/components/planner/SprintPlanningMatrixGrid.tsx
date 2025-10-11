import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, onSnapshot, orderBy, query, updateDoc, where, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Goal, Sprint, Story } from '../../types';
import { DndContext, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { migrateThemeValue, getThemeById } from '../../constants/globalThemes';

type CellId = string; // `${sprintId||'backlog'}|${goalId}`

const SprintPlanningMatrixGrid: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsubSprints = onSnapshot(
      query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid), orderBy('startDate', 'asc')),
      (snap) => setSprints(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[])
    );
    const unsubGoals = onSnapshot(
      query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => setGoals(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Goal[])
    );
    const unsubStories = onSnapshot(
      query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona)),
      (snap) => setStories(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[])
    );
    return () => { unsubSprints(); unsubGoals(); unsubStories(); };
  }, [currentUser?.uid, currentPersona]);

  const columns = useMemo(() => [{ id: 'backlog', name: 'Backlog' }, ...sprints.map(s => ({ id: s.id, name: s.name || s.id }))], [sprints]);
  const goalsSorted = useMemo(() => [...goals].sort((a,b) => (a.orderIndex??0) - (b.orderIndex??0)), [goals]);

  const cellId = (sprintId: string | null, goalId: string): CellId => `${sprintId || 'backlog'}|${goalId}`;

  const byCell = useMemo(() => {
    const map = new Map<CellId, Story[]>();
    for (const g of goalsSorted) {
      for (const col of columns) map.set(cellId(col.id==='backlog'?null:col.id, g.id), []);
    }
    for (const st of stories) {
      const sid = (st as any).sprintId || null;
      const gid = (st as any).goalId || null;
      if (!gid) continue; // only show stories linked to a goal
      const id = cellId(sid, gid);
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(st);
    }
    return map;
  }, [stories, columns, goalsSorted]);

  const themeColorForGoal = (goal?: Goal) => {
    if (!goal) return '#999';
    try {
      const id = migrateThemeValue((goal as any).theme);
      const t = getThemeById(Number(id));
      return t?.color || '#0ea5e9';
    } catch { return '#0ea5e9'; }
  };

  const onDragEnd = async (ev: DragEndEvent) => {
    const activeId = String(ev.active.id || '');
    const overId = ev.over ? String(ev.over.id || '') : '';
    if (!activeId.startsWith('story:') || !overId.startsWith('cell:')) return;
    const storyId = activeId.slice('story:'.length);
    const [, payload] = overId.split(':');
    const [col, goalId] = payload.split('|');
    const sprintId = (col === 'backlog') ? null : col;
    try {
      const ref = doc(db, 'stories', storyId);
      const updates: any = { sprintId: sprintId || null, updatedAt: Date.now() };
      // If dropped into a different goal row, update goal
      const story = stories.find(s => s.id === storyId) as any;
      if (story && story.goalId !== goalId) {
        updates.goalId = goalId;
        // Optionally align story.theme from goal.theme
        const g = goals.find(x => x.id === goalId) as any;
        if (g && typeof g.theme === 'number') updates.theme = g.theme;
      }
      await updateDoc(ref, updates);
    } catch (e) {
      console.error('Failed to move story', e);
      alert('Failed to move story');
    }
  };

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h5 mb-0">Sprint Planning Matrix</h1>
        <div className="text-muted" style={{ fontSize: 12 }}>Drag stories across sprints and goals</div>
      </div>

      <div className="mb-2" style={{ overflowX: 'auto' }}>
        <table className="table table-sm" style={{ minWidth: Math.max(860, columns.length * 260) }}>
          <thead>
            <tr>
              <th style={{ width: 260 }}>Goal</th>
              {columns.map((c) => (
                <th key={c.id} style={{ minWidth: 240 }}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <DndContext onDragEnd={onDragEnd}>
            <tbody>
              {goalsSorted.map((g) => {
                const themeCol = themeColorForGoal(g);
                return (
                  <tr key={g.id}>
                    <td style={{ verticalAlign: 'top' }}>
                      <div className="d-flex align-items-center gap-2">
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: themeCol }} />
                        <strong>{g.title}</strong>
                      </div>
                    </td>
                    {columns.map((c) => {
                      const cell = cellId(c.id==='backlog'?null:c.id, g.id);
                      const items = byCell.get(cell) || [];
                      return (
                        <td key={c.id} style={{ verticalAlign: 'top' }}>
                          <div
                            id={`cell-${cell}`}
                            data-droppable
                            style={{ minHeight: 120, border: '1px dashed var(--bs-border-color)', borderRadius: 8, padding: 8 }}
                          >
                            <SortableContext items={items.map(s => `story:${s.id}`)} strategy={verticalListSortingStrategy}>
                              {items.map((s) => (
                                <StoryCard key={s.id} story={s} goal={g} />
                              ))}
                            </SortableContext>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </DndContext>
        </table>
      </div>
    </div>
  );
};

const StoryCard: React.FC<{ story: Story; goal: Goal }> = ({ story, goal }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `story:${story.id}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  } as React.CSSProperties;

  const themeCol = (() => { try { const id = migrateThemeValue((goal as any).theme); const t = getThemeById(Number(id)); return t?.color || '#0ea5e9'; } catch { return '#0ea5e9'; } })();

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Card style={{ marginBottom: 8, borderLeft: `6px solid ${themeCol}` }}>
        <Card.Body style={{ padding: 10 }}>
          <div className="d-flex align-items-center justify-content-between">
            <div style={{ fontWeight: 600, fontSize: 13 }}>{(story as any).title}</div>
            <Badge bg="light" text="dark" style={{ fontSize: 10 }}>{(story as any).points || 0} pts</Badge>
          </div>
          {(story as any).description && <div className="text-muted" style={{ fontSize: 11 }}>{String((story as any).description).slice(0, 80)}</div>}
        </Card.Body>
      </Card>
    </div>
  );
};

export default SprintPlanningMatrixGrid;

