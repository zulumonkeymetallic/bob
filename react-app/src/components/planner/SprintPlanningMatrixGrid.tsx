import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Form, Toast, ToastContainer } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { collection, onSnapshot, orderBy, query, updateDoc, where, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase';
import type { Goal, Sprint, Story } from '../../types';
import { DndContext, DragEndEvent, DragOverlay, useDroppable } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { migrateThemeValue, getThemeById } from '../../constants/globalThemes';
import { useSidebar } from '../../contexts/SidebarContext';
import { useSprint } from '../../contexts/SprintContext';
import SprintSelector from '../../components/SprintSelector';
import EditStoryModal from '../../components/EditStoryModal';
import EditGoalModal from '../../components/EditGoalModal';
import { functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import { Edit3, Activity as ActivityIcon, Wand2, GripVertical, Trash2 } from 'lucide-react';
import ApprovalsPanel from './ApprovalsPanel';

type CellId = string; // `${sprintId||'backlog'}|${goalId}`

const toMillis = (value: any | undefined | null): number | null => {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try { return value.toDate().getTime(); } catch { return null; }
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
};

const goalTimeWindow = (goal: Goal) => {
  const start = toMillis((goal as any).startDate) ?? toMillis((goal as any).targetDate);
  const endCandidates = [toMillis((goal as any).endDate), toMillis((goal as any).targetDate), start];
  const end = endCandidates.find((v) => v != null) ?? start ?? null;
  return { start, end };
};

const sprintTimeWindow = (sprint: Sprint | undefined) => {
  if (!sprint) return { start: null, end: null };
  const start = toMillis((sprint as any).startDate);
  const end = toMillis((sprint as any).endDate);
  return { start, end };
};

const goalOverlapsSprint = (goal: Goal, sprint: Sprint | undefined) => {
  if (!sprint) return true;
  const { start: gsRaw, end: geRaw } = goalTimeWindow(goal);
  if (gsRaw == null && geRaw == null) return true;
  const { start: ss, end: se } = sprintTimeWindow(sprint);
  if (ss == null || se == null) return true;
  const gs = gsRaw ?? ss;
  const ge = geRaw ?? se;
  return gs <= se && ge >= ss;
};

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
  const [draggingStory, setDraggingStory] = useState<Story | null>(null);
  const { selectedSprintId, setSelectedSprintId } = useSprint();

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

  const visibleSprintIds = useMemo(() => {
    const windowSize = 4; // active + next 3, or selected + next 3
    const findActiveIndex = () => {
      const idxActive = sprints.findIndex((s:any) => (s.status === 1) || (String(s.status).toLowerCase() === 'active'));
      if (idxActive !== -1) return idxActive;
      const now = Date.now();
      const idxUpcoming = sprints.findIndex((s:any) => Number(s.startDate||0) >= now);
      return idxUpcoming !== -1 ? idxUpcoming : 0;
    };
    let startIdx = 0;
    if (selectedSprintId && selectedSprintId !== '') {
      const idx = sprints.findIndex(s => s.id === selectedSprintId);
      startIdx = idx === -1 ? 0 : idx;
    } else {
      startIdx = findActiveIndex();
    }
    return sprints.slice(startIdx, startIdx + windowSize).map(s => s.id);
  }, [sprints, selectedSprintId]);

  const sprintById = useMemo(() => {
    const m: Record<string, Sprint> = {};
    sprints.forEach((s) => { m[s.id] = s; });
    return m;
  }, [sprints]);

  const visibleSprints = useMemo(() => visibleSprintIds
    .map(id => sprintById[id])
    .filter(Boolean) as Sprint[], [visibleSprintIds, sprintById]);

  // Show Backlog + visible sprint window (keeps 4 sprints on screen)
  const columns = useMemo(() => {
    const sprintCols = visibleSprints.map(s => ({ id: s.id, name: s.name || s.id }));
    return [{ id: 'backlog', name: 'Backlog' }, ...sprintCols];
  }, [visibleSprints]);
  const goalsSorted = useMemo(() => {
    const sorted = [...goals].sort((a,b) => (a.orderIndex??0) - (b.orderIndex??0));
    let base = sorted.filter(g => (filterThemeId ? migrateThemeValue((g as any).theme) === filterThemeId : true) && (filterGoalId ? g.id === filterGoalId : true));
    if (visibleSprints.length > 0) {
      base = base.filter((g) => visibleSprints.some((sp) => goalOverlapsSprint(g, sp)));
    }
    if (selectedSprintId && selectedSprintId !== '') {
      const vis = new Set(visibleSprintIds);
      const goalHasStoryInVisible = new Set<string>();
      for (const st of stories as any[]) {
        if (!st.goalId || !st.sprintId) continue;
        if (vis.has(st.sprintId)) goalHasStoryInVisible.add(st.goalId);
      }
      base = base.filter(g => goalHasStoryInVisible.has(g.id));
    }
    return base;
  }, [goals, filterThemeId, filterGoalId, visibleSprints, selectedSprintId, visibleSprintIds, stories]);

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

  // Planned points per sprint (all stories)
  const usedPointsBySprint = useMemo(() => {
    const map: Record<string, number> = {};
    for (const st of stories as any[]) {
      const sid = st.sprintId; const pts = Number(st.points||0)||0;
      if (sid) map[sid] = (map[sid]||0)+pts;
    }
    return map;
  }, [stories]);

  // Calendar blocks (scheduled time) used per sprint
  const [calendarBlocks, setCalendarBlocks] = useState<Array<{ start: number; end: number; goalId?: string; theme?: any; entry_method?: string | null }>>([]);
  useEffect(() => {
    if (!currentUser?.uid) return;
    const unsub = onSnapshot(
      query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid), orderBy('start', 'asc')),
      (snap) => {
        const rows = snap.docs.map(d => d.data() as any);
        const mapped = rows.map((r:any) => ({ start: Number(r.start||0)||0, end: Number(r.end||0)||0, goalId: r.goalId, theme: r.theme, entry_method: r.entry_method || r.entryMethod || null }));
        setCalendarBlocks(mapped);
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  const usedMinutesBySprint = useMemo(() => {
    const map: Record<string, number> = {};
    if (!calendarBlocks.length || !sprints.length) return map;
    for (const b of calendarBlocks) {
      if (!b.start || !b.end) continue;
      // Count only non-AI theme blocks (user calendar events not created by planner AI)
      if (String(b.entry_method || '').toLowerCase().includes('calendar_ai')) continue;
      for (const s of sprints) {
        const startMs = Number((s as any).startDate || 0);
        const endMs = Number((s as any).endDate || 0);
        if (!startMs || !endMs) continue;
        // Count block if it starts within sprint window
        if (b.start >= startMs && b.start <= endMs) {
          const mins = Math.max(0, Math.round((b.end - b.start) / 60000));
          map[s.id] = (map[s.id] || 0) + mins;
          break;
        }
      }
    }
    return map;
  }, [calendarBlocks, sprints]);

  // Estimate free work time per sprint (assumes 8h workday)
  const freeMinutesBySprint = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sprints) {
      const sid = s.id;
      const startMs = Number((s as any).startDate || 0);
      const endMs = Number((s as any).endDate || 0);
      if (!startMs || !endMs) { map[sid] = 0; continue; }
      // Compute baseline non-negotiables: sleep (8h daily) + work (8h Mon-Fri)
      let nonneg = 0;
      const dayMs = 24 * 60 * 60 * 1000;
      for (let t = startMs; t <= endMs; t += dayMs) {
        const d = new Date(t);
        const weekday = d.getDay(); // 0=Sun..6=Sat
        // Sleep 8h daily
        nonneg += 8 * 60;
        // Work 8h Monday-Friday
        if (weekday >= 1 && weekday <= 5) nonneg += 8 * 60;
      }
      const sprintDays = Math.max(1, Math.round((endMs - startMs) / dayMs) + 1);
      const totalDayMinutes = sprintDays * 24 * 60;
      const externalBusy = usedMinutesBySprint[sid] || 0; // calendar events not created by AI
      const free = Math.max(0, totalDayMinutes - nonneg - externalBusy);
      map[sid] = free;
    }
    return map;
  }, [sprints, usedMinutesBySprint]);

  const themeColorForGoal = (goal?: Goal) => {
    if (!goal) return '#999';
    try {
      const id = migrateThemeValue((goal as any).theme);
      const t = getThemeById(Number(id));
      return t?.color || '#0ea5e9';
    } catch { return '#0ea5e9'; }
  };

  const [toast, setToast] = useState<{ show: boolean; message: string; variant: 'danger'|'info'|'success' }>(()=>({ show:false, message:'', variant:'info' }));
  const showToast = (message: string, variant: 'danger'|'info'|'success'='info') => setToast({ show: true, message, variant });

  const onDragEnd = async (ev: DragEndEvent) => {
    const activeId = String(ev.active.id || '');
    const overId = ev.over ? String(ev.over.id || '') : '';
    if (!activeId.startsWith('story:') || !overId.startsWith('cell:')) return;
    const storyId = activeId.slice('story:'.length);
    const [, payload] = overId.split(':');
    const [col, goalId] = payload.split('|');
    const sprintId = (col === 'backlog') ? null : col;
    try {
      // Capacity warning if moving into a sprint beyond capacity
      if (sprintId) {
        const cap = capacityBySprint[sprintId] || 0;
        const pts = Number((stories.find(s=>s.id===storyId) as any)?.points || 0) || 0;
        const curr = usedPointsBySprint[sprintId] || 0;
        if (cap > 0 && curr + pts > cap) {
          showToast(`Capacity exceeded in ${sprints.find(s=>s.id===sprintId)?.name || 'Sprint'}: ${curr + pts}/${cap} pts`, 'danger');
        }
        const goal = goals.find(g => g.id === goalId);
        const sprint = sprintById[sprintId] as Sprint | undefined;
        if (goal && sprint && !goalOverlapsSprint(goal, sprint)) {
          showToast('Goal is not scheduled for that sprint window.', 'danger');
          return;
        }
      }
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
    setDraggingStory(null);
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

  // AI-aided allocation: prioritize backlog via AI, then pack by sprint capacity
  const autoAssignByCapacity = async () => {
    try {
      // compute current used points per sprint
      const used: Record<string, number> = {};
      stories.forEach((s:any) => {
        const sid = s.sprintId; const pts = Number(s.points || 0) || 0;
        if (sid) used[sid] = (used[sid] || 0) + pts;
      });
      // backlog stories (no sprint)
      const backlog = stories.filter((s:any) => !s.sprintId);
      // Ask AI to prioritize backlog items if available
      let ordered: any[] = backlog;
      try {
        const callable = httpsCallable(functions, 'prioritizeBacklog');
        const payload = { tasks: backlog.map((s:any) => ({ id: s.id, title: s.title, points: Number(s.points||0)||0, priority: Number(s.priority||3)||3 })) };
        const res:any = await callable(payload);
        const orderMap = new Map<string, number>();
        if (res?.data?.items && Array.isArray(res.data.items)) {
          res.data.items.forEach((it:any, idx:number) => orderMap.set(String(it.id), idx));
          ordered = [...backlog].sort((a:any,b:any) => (orderMap.get(a.id) ?? 9999) - (orderMap.get(b.id) ?? 9999));
        }
      } catch (e) {
        console.warn('AI prioritizeBacklog failed; falling back to heuristic', e);
        ordered = [...backlog].sort((a:any,b:any) => (Number(a.priority||3) - Number(b.priority||3)) || (Number(b.points||0) - Number(a.points||0)));
      }
      // iterate sprints by start date order
      const sprintIds = sprints.map(s => s.id);
      const batch: Array<Promise<any>> = [];
      ordered.forEach((s:any) => {
        const pts = Number(s.points || 0) || 0;
        const goal = s.goalId ? goals.find(g => g.id === s.goalId) : null;
        for (const sid of sprintIds) {
          const cap = capacityBySprint[sid] || 0;
          const curr = used[sid] || 0;
          if (cap === 0) continue; // skip sprints without set capacity
          const sprint = sprintById[sid] as Sprint | undefined;
          if (goal && sprint && !goalOverlapsSprint(goal, sprint)) continue;
          if (curr + pts <= cap) {
            used[sid] = curr + pts;
            batch.push(updateDoc(doc(db, 'stories', s.id), { sprintId: sid, updatedAt: Date.now() }));
            break;
          }
        }
      });
      await Promise.all(batch);
      setPlanningMsg('AI prioritized and assigned backlog to sprints up to capacity.');
    } catch (e:any) {
      console.error('autoAssignByCapacity error', e);
      setPlanningMsg(e?.message || 'Auto-assign failed');
    }
  };

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div className="d-flex align-items-center gap-3">
          <h1 className="h5 mb-0">Sprint Planning Matrix</h1>
          <SprintSelector selectedSprintId={selectedSprintId} onSprintChange={setSelectedSprintId} />
        </div>
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
          <thead style={{ position: 'sticky', top: 0, zIndex: 7, background: 'var(--bs-body-bg)' }}>
            <tr>
              <th style={{ width: 260, position: 'sticky', left: 0, zIndex: 6, background: 'var(--bs-body-bg)', borderRight: '1px solid var(--bs-border-color)' }}>Goal</th>
              {columns.map((c) => {
                if (c.id === 'backlog') return (
                  <th key={c.id} style={{ minWidth: 240, background: 'var(--bs-body-bg)', borderBottom: '1px solid var(--bs-border-color)' }}>Backlog</th>
                );
                const cap = capacityBySprint[c.id] || 0;
                const used = usedPointsBySprint[c.id] || 0;
                const mins = usedMinutesBySprint[c.id] || 0;
                const over = cap > 0 && used > cap;
                const sprint = sprintById[c.id];
                const start = sprint?.startDate ? new Date(sprint.startDate) : null;
                const startLabel = start ? start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
                const avail = cap > 0 ? Math.max(0, cap - used) : null;
                const freeMin = freeMinutesBySprint[c.id] || 0;
                return (
                  <th key={c.id} style={{ minWidth: 240, background: 'var(--bs-body-bg)', borderBottom: '1px solid var(--bs-border-color)' }}>
                    <div className="d-flex align-items-center justify-content-between">
                      <span>{c.name}</span>
                      <div className="d-flex align-items-center gap-2">
                        {mins > 0 && (
                          <Badge bg="info" title={`Calendar scheduled: ${(mins/60).toFixed(1)}h`}>
                            {(mins/60).toFixed(1)}h
                          </Badge>
                        )}
                        {freeMin > 0 && (
                          <Badge bg="success" title={`Estimated free time (work hours): ${(freeMin/60).toFixed(1)}h`}>
                            Free {(freeMin/60).toFixed(1)}h
                          </Badge>
                        )}
                        {cap > 0 && (
                          <Badge bg={over ? 'danger' : 'secondary'} title={`Planned ${used} / Capacity ${cap}`}>
                            {used}/{cap} pts
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-muted" style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between' }}>
                      <span>{startLabel}</span>
                      {avail !== null && <span>Avail: {avail} pts</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <DndContext onDragEnd={onDragEnd} onDragStart={(e) => {
            const id = String(e.active?.id || '');
            if (id.startsWith('story:')) {
              const sId = id.slice('story:'.length);
              const st = stories.find(s => s.id === sId) || null;
              setDraggingStory(st);
            }
          }}>
            <tbody>
              {goalsSorted.map((g) => {
                const themeCol = themeColorForGoal(g);
                return (
                  <tr key={g.id}>
                    <td style={{ verticalAlign: 'top', position: 'sticky', left: 0, zIndex: 4, background: 'var(--bs-body-bg)', borderRight: '1px solid var(--bs-border-color)' }}>
                      <MiniGoalCard goal={g} themeColor={themeCol} onEdit={() => setEditGoal(g)} onGenerateStories={async () => {
                        try {
                          const callable = httpsCallable(functions, 'generateStoriesForGoal');
                          await callable({ goalId: g.id });
                          showToast('AI: generating stories for goal…', 'info');
                        } catch (e:any) {
                          showToast(e?.message || 'Failed to trigger story generation', 'danger');
                        }
                      }} />
                    </td>
                    {columns.map((c) => {
                      const cell = cellId(c.id==='backlog'?null:c.id, g.id);
                      const items = byCell.get(cell) || [];
                      return (
                        <td key={c.id} style={{ verticalAlign: 'top' }}>
                          <DroppableCell id={`cell:${cell}`}>
                            <SortableContext items={items.map(s => `story:${s.id}`)} strategy={verticalListSortingStrategy}>
                              {items.map((s) => (
                                <StoryCard
                                  key={s.id}
                                  story={s}
                                  goal={g}
                                  onEdit={() => setEditStory(s)}
                                  onActivity={() => showSidebar(s as any, 'story')}
                                  onAiTasks={async () => {
                                    try {
                                      const callable = httpsCallable(functions, 'generateTasksForStory');
                                      await callable({ storyId: (s as any).id });
                                      showToast('AI: generating tasks for story…', 'info');
                                    } catch (e:any) {
                                      showToast(e?.message || 'AI task generation not available yet', 'danger');
                                    }
                                  }}
                                  onDelete={async () => {
                                    try {
                                      if (!window.confirm('Delete this story? This cannot be undone.')) return;
                                      await deleteDoc(doc(db, 'stories', (s as any).id));
                                      showToast('Story deleted', 'success');
                                    } catch (e:any) {
                                      showToast(e?.message || 'Failed to delete story', 'danger');
                                    }
                                  }}
                                />
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
            <DragOverlay>
              {draggingStory ? (
                <Card style={{ marginBottom: 8 }}>
                  <Card.Body style={{ padding: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{(draggingStory as any).title}</div>
                  </Card.Body>
                </Card>
              ) : null}
            </DragOverlay>
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

      {/* Approvals panel for proposed plans */}
      <ApprovalsPanel />

      {/* Toasts */}
      <ToastContainer position="bottom-end" className="p-3">
        <Toast bg={toast.variant} onClose={() => setToast(prev=>({ ...prev, show:false }))} show={toast.show} delay={4000} autohide>
          <Toast.Body className={toast.variant === 'info' ? '' : 'text-white'}>{toast.message}</Toast.Body>
        </Toast>
      </ToastContainer>
    </div>
  );
};

const StoryCard: React.FC<{ story: Story; goal: Goal; onEdit: () => void; onActivity: () => void; onAiTasks: () => void; onDelete: () => void }> = ({ story, goal, onEdit, onActivity, onAiTasks, onDelete }) => {
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

  const lighten = (hex: string, amt: number) => {
    try {
      const v = hex.replace('#','');
      const full = v.length===3? v.split('').map(c=>c+c).join('') : v;
      const num = parseInt(full,16);
      let r=(num>>16)&255, g=(num>>8)&255, b=num&255;
      const A=Math.max(0,Math.min(1,amt));
      r = r + (255 - r) * A; g = g + (255 - g) * A; b = b + (255 - b) * A;
      const toHex=(n:number)=> Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
      return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch { return hex; }
  };
  const gradientStart = lighten(themeCol, 0.55);
  const gradientEnd = lighten(themeCol, 0.78);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <Card style={{ marginBottom: 8, borderLeft: `6px solid ${themeCol}`, background: `linear-gradient(165deg, ${gradientStart} 0%, ${gradientEnd} 100%)` }}>
        <Card.Body style={{ padding: 10 }}>
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <span title="Drag" aria-label="Drag" style={{ cursor: 'grab', display:'inline-flex', alignItems:'center' }} {...(listeners as any)}>
                <GripVertical size={14} />
              </span>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{(story as any).title}</div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Badge bg="light" text="dark" style={{ fontSize: 10 }}>{(story as any).points || 0} pts</Badge>
              <Button size="sm" variant="link" style={{ padding: 0 }} onClick={onAiTasks} title="AI: generate tasks" aria-label="AI: generate tasks">
                <Wand2 size={14} />
              </Button>
              <Button size="sm" variant="link" style={{ padding: 0 }} onClick={onActivity} title="Activity stream" aria-label="Activity stream">
                <ActivityIcon size={14} />
              </Button>
              <Button size="sm" variant="link" style={{ padding: 0 }} onClick={onEdit} title="Edit story" aria-label="Edit story">
                <Edit3 size={14} />
              </Button>
              <Button size="sm" variant="link" style={{ padding: 0 }} onClick={onDelete} title="Delete story" aria-label="Delete story">
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
          {(story as any).description && <div className="text-muted" style={{ fontSize: 11 }}>{String((story as any).description).slice(0, 80)}</div>}
        </Card.Body>
      </Card>
    </div>
  );
};

const MiniGoalCard: React.FC<{ goal: Goal; themeColor: string; onEdit: () => void; onGenerateStories: () => void }>
  = ({ goal, themeColor, onEdit, onGenerateStories }) => {
  const lighten = (hex: string, amt: number) => {
    try { const v = hex.replace('#',''); const full = v.length===3? v.split('').map(c=>c+c).join('') : v; const num = parseInt(full,16);
      let r=(num>>16)&255, g=(num>>8)&255, b=num&255; const A=Math.max(0,Math.min(1,amt));
      r = r + (255 - r) * A; g = g + (255 - g) * A; b = b + (255 - b) * A;
      const H=(n:number)=> Math.max(0,Math.min(255,Math.round(n))).toString(16).padStart(2,'0');
      return `#${H(r)}${H(g)}${H(b)}`; } catch { return hex; }
  };
  const gs = lighten(themeColor, 0.55), ge = lighten(themeColor, 0.78);
  return (
    <Card style={{ borderLeft: `6px solid ${themeColor}`, background: `linear-gradient(165deg, ${gs} 0%, ${ge} 100%)` }}>
      <Card.Body style={{ padding: 8 }}>
        <div className="d-flex align-items-center justify-content-between">
          <div className="d-flex align-items-center gap-2">
            <span style={{ width: 10, height: 10, borderRadius: 999, background: themeColor }} />
            <strong style={{ fontSize: 13 }}>{goal.title}</strong>
          </div>
          <div className="d-flex align-items-center gap-2">
            <Button size="sm" variant="link" style={{ padding: 0 }} title="AI: generate stories" aria-label="AI: generate stories" onClick={(e:any) => { e.stopPropagation(); onGenerateStories(); }}>
              <Wand2 size={14} />
            </Button>
            <Button size="sm" variant="link" style={{ padding: 0 }} onClick={(e:any)=>{ e.stopPropagation(); onEdit(); }} title="Edit goal" aria-label="Edit goal">
              <Edit3 size={14} />
            </Button>
          </div>
        </div>
      </Card.Body>
    </Card>
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
