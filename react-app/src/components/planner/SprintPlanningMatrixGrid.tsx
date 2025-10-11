import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Form } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, onSnapshot, orderBy, query, updateDoc, where, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Goal, Sprint, Story } from '../../types';
import { DndContext, DragEndEvent, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { migrateThemeValue, getThemeById } from '../../constants/globalThemes';
import { useSidebar } from '../../contexts/SidebarContext';
import EditStoryModal from '../../components/EditStoryModal';
import EditGoalModal from '../../components/EditGoalModal';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';

type CellId = string; // `${sprintId||'backlog'}|${goalId}`

const SprintPlanningMatrixGrid: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [capacityBySprint, setCapacityBySprint] = useState<Record<string, number>>({});
  const [editStory, setEditStory] = useState<Story | null>(null);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [filterThemeId, setFilterThemeId] = useState<number | ''>('');
  const [filterGoalId, setFilterGoalId] = useState<string | ''>('');
  const [planningMsg, setPlanningMsg] = useState<string | null>(null);
  const { showSidebar } = useSidebar();

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
    const unsubCaps = onSnapshot(
      query(collection(db, 'sprint_capacity'), where('ownerUid', '==', currentUser.uid)),
      (snap) => {
        const map: Record<string, number> = {};
        snap.docs.forEach(d => { const v = d.data() as any; if (v && v.sprintId) map[v.sprintId] = Number(v.pointsCapacity || 0) || 0; });
        setCapacityBySprint(map);
      }
    );
    return () => { unsubSprints(); unsubGoals(); unsubStories(); unsubCaps(); };
  }, [currentUser?.uid, currentPersona]);

  const columns = useMemo(() => [{ id: 'backlog', name: 'Backlog' }, ...sprints.map(s => ({ id: s.id, name: s.name || s.id }))], [sprints]);
  const goalsSorted = useMemo(() => {
    const sorted = [...goals].sort((a,b) => (a.orderIndex??0) - (b.orderIndex??0));
    return sorted.filter(g => (filterThemeId ? migrateThemeValue((g as any).theme) === filterThemeId : true) && (filterGoalId ? g.id === filterGoalId : true));
  }, [goals, filterThemeId, filterGoalId]);

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
      // Apply filters to stories
      const th = (goals.find(x => x.id === gid) as any)?.theme;
      if (filterThemeId && migrateThemeValue(th) !== filterThemeId) continue;
      if (filterGoalId && gid !== filterGoalId) continue;
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

  const themeOptions = useMemo(() => {
    const ids = new Set<number>();
    goals.forEach(g => { const id = migrateThemeValue((g as any).theme); if (id) ids.add(id); });
    return Array.from(ids).sort((a,b)=>a-b).map(id => ({ id, label: getThemeById(Number(id)).label || getThemeById(Number(id)).name || String(id) }));
  }, [goals]);

  const planSprintWindow = async () => {
    try {
      setPlanningMsg(null);
      await httpsCallable(functions, 'planCalendar')({ persona: 'personal', horizonDays: 14 });
      setPlanningMsg('Planner triggered. Check Approvals to apply.');
    } catch (e: any) {
      console.error('planCalendar error', e);
      setPlanningMsg(e?.message || 'Failed to trigger planner');
    }
  };

  const autoAssignByCapacity = async () => {
    try {
      // compute current used points per sprint
      const used: Record<string, number> = {};
      stories.forEach((s:any) => {
        const sid = s.sprintId; const pts = Number(s.points || 0) || 0;
        if (sid) used[sid] = (used[sid] || 0) + pts;
      });
      // backlog stories (no sprint), sorted by priority then points desc
      const backlog = stories
        .filter((s:any) => !s.sprintId)
        .sort((a:any,b:any) => (Number(a.priority||3) - Number(b.priority||3)) || (Number(b.points||0) - Number(a.points||0)));
      // iterate sprints by start date order
      const sprintIds = sprints.map(s => s.id);
      const batch: Array<Promise<any>> = [];
      backlog.forEach((s:any) => {
        const pts = Number(s.points || 0) || 0;
        for (const sid of sprintIds) {
          const cap = capacityBySprint[sid] || 0;
          const curr = used[sid] || 0;
          if (cap === 0) continue; // skip sprints without set capacity
          if (curr + pts <= cap) {
            used[sid] = curr + pts;
            batch.push(updateDoc(doc(db, 'stories', s.id), { sprintId: sid, updatedAt: Date.now() }));
            break;
          }
        }
      });
      await Promise.all(batch);
      setPlanningMsg('Auto-assigned stories to sprints up to capacity.');
    } catch (e:any) {
      console.error('autoAssignByCapacity error', e);
      setPlanningMsg(e?.message || 'Auto-assign failed');
    }
  };

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h5 mb-0">Sprint Planning Matrix</h1>
        <div className="d-flex align-items-center gap-2">
          <Form.Select value={filterThemeId} onChange={(e) => setFilterThemeId(e.currentTarget.value ? Number(e.currentTarget.value) : '')} size="sm" style={{ width: 200 }}>
            <option value="">All Themes</option>
            {themeOptions.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </Form.Select>
          <Form.Select value={filterGoalId} onChange={(e) => setFilterGoalId(e.currentTarget.value)} size="sm" style={{ width: 240 }}>
            <option value="">All Goals</option>
            {goals.map(g => (<option key={g.id} value={g.id}>{g.title}</option>))}
          </Form.Select>
          <Button size="sm" variant="outline-secondary" onClick={() => { setFilterThemeId(''); setFilterGoalId(''); }}>Clear</Button>
          <Button size="sm" variant="outline-primary" onClick={planSprintWindow}>Generate Sprint Proposal</Button>
          <Button size="sm" variant="primary" onClick={autoAssignByCapacity}>Auto-Assign by Capacity</Button>
        </div>
      </div>
      {planningMsg && <div className="mb-2"><Badge bg="info">{planningMsg}</Badge></div>}

      <div className="mb-2" style={{ overflowX: 'auto' }}>
        <table className="table table-sm" style={{ minWidth: Math.max(860, columns.length * 260), position: 'relative' }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 5, background: 'var(--bs-body-bg)' }}>
            <tr>
              <th style={{ width: 260, position: 'sticky', left: 0, zIndex: 6, background: 'var(--bs-body-bg)', borderRight: '1px solid var(--bs-border-color)' }}>Goal</th>
              {columns.map((c) => (
                <th key={c.id} style={{ minWidth: 240, background: 'var(--bs-body-bg)', borderBottom: '1px solid var(--bs-border-color)' }}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <DndContext onDragEnd={onDragEnd}>
            <tbody>
              {goalsSorted.map((g) => {
                const themeCol = themeColorForGoal(g);
                return (
                  <tr key={g.id}>
                    <td style={{ verticalAlign: 'top', position: 'sticky', left: 0, zIndex: 4, background: 'var(--bs-body-bg)', borderRight: '1px solid var(--bs-border-color)' }}>
                      <div className="d-flex align-items-center gap-2">
                        <span style={{ width: 10, height: 10, borderRadius: 999, background: themeCol }} />
                        <strong>{g.title}</strong>
                        <Button size="sm" variant="link" style={{ padding: 0 }} onClick={() => setEditGoal(g)}>Edit</Button>
                      </div>
                    </td>
                    {columns.map((c) => {
                      const cell = cellId(c.id==='backlog'?null:c.id, g.id);
                      const items = byCell.get(cell) || [];
                      return (
                        <td key={c.id} style={{ verticalAlign: 'top' }}>
                          <DroppableCell id={`cell:${cell}`}>
                            <SortableContext items={items.map(s => `story:${s.id}`)} strategy={verticalListSortingStrategy}>
                              {items.map((s) => (
                                <StoryCard key={s.id} story={s} goal={g} onEdit={() => setEditStory(s)} onActivity={() => showSidebar(s as any, 'story')} />
                              ))}
                            </SortableContext>
                          </DroppableCell>
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

      {/* Edit modals */}
      {editStory && (
        <EditStoryModal show={!!editStory} onHide={() => setEditStory(null)} story={editStory as any} goals={goals} onStoryUpdated={() => setEditStory(null)} />
      )}
      {editGoal && (
        <EditGoalModal show={!!editGoal} onClose={() => setEditGoal(null)} goal={editGoal as any} currentUserId={currentUser?.uid || ''} />
      )}
    </div>
  );
};

const StoryCard: React.FC<{ story: Story; goal: Goal; onEdit: () => void; onActivity: () => void }> = ({ story, goal, onEdit, onActivity }) => {
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
            <div className="d-flex align-items-center gap-2">
              <Badge bg="light" text="dark" style={{ fontSize: 10 }}>{(story as any).points || 0} pts</Badge>
              <Button size="sm" variant="link" style={{ padding: 0 }} onClick={onActivity} title="Activity">🛈</Button>
              <Button size="sm" variant="link" style={{ padding: 0 }} onClick={onEdit} title="Edit">✎</Button>
            </div>
          </div>
          {(story as any).description && <div className="text-muted" style={{ fontSize: 11 }}>{String((story as any).description).slice(0, 80)}</div>}
        </Card.Body>
      </Card>
    </div>
  );
};

const DroppableCell: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} style={{ minHeight: 120, border: `1px dashed ${isOver ? 'var(--bs-primary)' : 'var(--bs-border-color)'}`, borderRadius: 8, padding: 8, background: isOver ? 'rgba(13,110,253,0.04)' : undefined }}>
      {children}
    </div>
  );
};

export default SprintPlanningMatrixGrid;
