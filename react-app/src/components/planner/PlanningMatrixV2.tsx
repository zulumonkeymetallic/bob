import React, { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, Form, Alert, Spinner, Modal, ListGroup } from 'react-bootstrap';
import { addDays, eachDayOfInterval, format } from 'date-fns';
import { useAuth } from '../../contexts/AuthContext';
import { useSprint } from '../../contexts/SprintContext';
import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { db } from '../../firebase';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { usePersona } from '../../contexts/PersonaContext';
import type { Sprint, Story } from '../../types';
import ApprovalsPanel from './ApprovalsPanel';

type IsoDate = string; // YYYY-MM-DD

function toDayKey(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

function effortToPoints(eff?: any): number {
  switch (String(eff || '').toUpperCase()) {
    case 'S': return 1;
    case 'M': return 2;
    case 'L': return 3;
    default: return 1;
  }
}

// Minimal read-only scaffold for Matrix v2
const PlanningMatrixV2: React.FC = () => {
  const { currentUser } = useAuth();
  const { selectedSprintId } = useSprint();
  const [view, setView] = useState<'matrix'|'kanban'>('matrix');
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [days, setDays] = useState<Date[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [capacity, setCapacity] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [instancesByDay, setInstancesByDay] = useState<Record<IsoDate, Array<{ id: string; sourceType: 'task'|'story'; sourceId: string; durationMinutes: number }>>>({});
  const [taskPointsById, setTaskPointsById] = useState<Record<string, number>>({});
  const [taskGoalById, setTaskGoalById] = useState<Record<string, string | undefined>>({});
  const [taskThemeById, setTaskThemeById] = useState<Record<string, number | undefined>>({});
  const [storyPointsById, setStoryPointsById] = useState<Record<string, number>>({});
  const [storyGoalById, setStoryGoalById] = useState<Record<string, string | undefined>>({});
  const [storyThemeById, setStoryThemeById] = useState<Record<string, number | undefined>>({});
  const [loadingInstances, setLoadingInstances] = useState<boolean>(false);
  const [breakdown, setBreakdown] = useState<'none'|'theme'|'goal'>('none');
  const [unscheduledList, setUnscheduledList] = useState<Array<{ id: string; title?: string; sourceType: 'task'|'story'; sourceId: string; day: IsoDate; reason?: string }>>([]);
  const [includeBlocks, setIncludeBlocks] = useState<boolean>(true);
  const [blocksByDay, setBlocksByDay] = useState<Record<IsoDate, Array<{ id: string; storyId?: string; taskId?: string; theme?: number }>>>({});
  const [goalTitleById, setGoalTitleById] = useState<Record<string, string>>({});
  const [goalThemeById, setGoalThemeById] = useState<Record<string, number | undefined>>({});
  const [activeDay, setActiveDay] = useState<IsoDate | null>(null);

  // Theme label map and goal title map for display
  const { themes: globalThemes } = useGlobalThemes();
  const themeLabelById = useMemo(() => {
    const m = new Map<number, string>();
    globalThemes.forEach(t => { if (typeof t.id === 'number') m.set(t.id, t.label || t.name || String(t.id)); });
    return m;
  }, [globalThemes]);

  const themeColorById = useMemo(() => {
    const m = new Map<number, { bg: string; text: string }>();
    // Default fallback palette
    const fallback: Record<number, { bg: string; text: string }> = {
      1: { bg: '#22c55e', text: '#ffffff' }, // Health
      2: { bg: '#3b82f6', text: '#ffffff' }, // Growth
      3: { bg: '#eab308', text: '#111827' }, // Wealth
      4: { bg: '#8b5cf6', text: '#ffffff' }, // Tribe
      5: { bg: '#f97316', text: '#111827' }, // Home
    };
    globalThemes.forEach(t => {
      const id = (t as any).id;
      if (typeof id === 'number') {
        const bg = (t as any).color || (fallback[id]?.bg) || '#0ea5e9';
        const text = (t as any).textColor || '#ffffff';
        m.set(id, { bg, text });
      }
    });
    // Ensure fallbacks present
    Object.entries(fallback).forEach(([k,v]) => { const id = Number(k); if (!m.has(id)) m.set(id, v); });
    return m;
  }, [globalThemes]);

  const { currentPersona } = usePersona();
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid), where('persona', '==', currentPersona));
    const unsub = onSnapshot(q, (snap) => {
      const titleMap: Record<string, string> = {};
      const themeMap: Record<string, number | undefined> = {};
      snap.docs.forEach(d => { const g:any = d.data(); titleMap[d.id] = g.title || d.id; themeMap[d.id] = typeof g.theme === 'number' ? g.theme : undefined; });
      setGoalTitleById(titleMap);
      setGoalThemeById(themeMap);
    });
    return () => unsub();
  }, [currentUser?.uid, currentPersona]);

  // Load selected sprint (or pick active if none selected)
  useEffect(() => {
    if (!currentUser?.uid) return;
    let unsub: (() => void) | null = null;
    setLoading(true);
    setError(null);

    async function load() {
      try {
        if (selectedSprintId) {
          const ref = doc(collection(db, 'sprints'), selectedSprintId);
          const snap = await getDoc(ref);
          if (snap.exists()) {
            const s = { id: snap.id, ...(snap.data() as any) } as Sprint;
            setSprint(s);
          } else {
            setSprint(null);
          }
        } else {
          // Pick active sprint for user (status 1)
          const q = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid), where('status', '==', 1));
          unsub = onSnapshot(q, (snap) => {
            const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[];
            setSprint(rows?.[0] || null);
          });
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load sprint');
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { if (unsub) unsub(); };
  }, [currentUser?.uid, selectedSprintId]);

  // Build days for the sprint window
  useEffect(() => {
    if (!sprint?.startDate || !sprint?.endDate) { setDays([]); return; }
    const start = new Date(Number(sprint.startDate));
    const end = new Date(Number(sprint.endDate));
    const rng = eachDayOfInterval({ start, end });
    setDays(rng);
  }, [sprint?.startDate, sprint?.endDate]);

  // Load stories in sprint (for points rollup)
  useEffect(() => {
    if (!currentUser?.uid || !sprint?.id) { setStories([]); return; }
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('sprintId', '==', sprint.id),
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Story[];
      setStories(rows);
    });
    return () => unsub();
  }, [currentUser?.uid, sprint?.id]);

  // Track story points in map for quick lookup
  useEffect(() => {
    const mapping: Record<string, number> = {};
    const themeMap: Record<string, number | undefined> = {};
    const goalMap: Record<string, string | undefined> = {};
    for (const s of stories) {
      const pts = Number((s as any).points || 0);
      if (pts > 0) mapping[s.id] = pts;
      themeMap[s.id] = (s as any).theme;
      goalMap[s.id] = (s as any).goalId;
    }
    setStoryPointsById(mapping);
    setStoryThemeById(themeMap);
    setStoryGoalById(goalMap);
  }, [stories]);

  // Capacity storage (per sprint, per user)
  useEffect(() => {
    if (!currentUser?.uid || !sprint?.id) return;
    const capId = `${currentUser.uid}__${sprint.id}`;
    const ref = doc(collection(db, 'sprint_capacity'), capId);
    getDoc(ref).then((snap) => {
      const v = (snap.exists() && (snap.data() as any)?.pointsCapacity) || 0;
      setCapacity(Number(v) || 0);
    }).catch(() => {});
  }, [currentUser?.uid, sprint?.id]);

  const totalPoints = useMemo(() => {
    return stories.reduce((sum, s) => sum + (Number((s as any).points) || 0), 0);
  }, [stories]);

  const capacityPerDay = useMemo(() => {
    const n = days.length || 1;
    return capacity > 0 ? Math.round((capacity / n) * 10) / 10 : 0;
  }, [capacity, days.length]);

  const overBy = useMemo(() => {
    return capacity > 0 ? Math.max(0, totalPoints - capacity) : 0;
  }, [capacity, totalPoints]);

  // Subscribe to scheduled instances in sprint window and compute per-day planned points
  useEffect(() => {
    if (!currentUser?.uid || days.length === 0) { setInstancesByDay({}); return; }
    const startKey = toDayKey(days[0]);
    const endKey = toDayKey(days[days.length - 1]);
    setLoadingInstances(true);
    const unsub = onSnapshot(
      query(
        collection(db, 'scheduled_instances'),
        where('ownerUid', '==', currentUser.uid),
        where('occurrenceDate', '>=', startKey),
        where('occurrenceDate', '<=', endKey),
        orderBy('occurrenceDate', 'asc'),
        orderBy('plannedStart', 'asc'),
      ),
      async (snap) => {
        const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
        const byDay: Record<IsoDate, Array<{ id: string; sourceType: 'task'|'story'; sourceId: string; durationMinutes: number }>> = {};
        const unscheduled: Array<{ id: string; title?: string; sourceType: 'task'|'story'; sourceId: string; day: IsoDate; reason?: string }> = [];
        const taskIds = new Set<string>();
        const storyIds = new Set<string>();
        for (const r of rows) {
          const day = String(r.occurrenceDate);
          if (!byDay[day]) byDay[day] = [];
          const srcType = String(r.sourceType || 'task');
          const srcId = String(r.sourceId || '');
          const src: 'task'|'story' = srcType === 'story' ? 'story' : 'task';
          if (String(r.status || '').toLowerCase() === 'unscheduled') {
            unscheduled.push({ id: r.id, title: r.title, sourceType: src, sourceId: srcId, day, reason: r.statusReason });
          } else {
            byDay[day].push({ id: r.id, sourceType: src, sourceId: srcId, durationMinutes: Number(r.durationMinutes || 0) });
          }
          if (srcType === 'story') storyIds.add(srcId); else taskIds.add(srcId);
        }
        setInstancesByDay(byDay);
        setUnscheduledList(unscheduled);
        // Fetch points for tasks not seen yet
        const missingTaskIds = Array.from(taskIds).filter(id => !(id in taskPointsById));
        if (missingTaskIds.length > 0) {
          const updates: Record<string, number> = {};
          const goalUpd: Record<string, string | undefined> = {};
          const themeUpd: Record<string, number | undefined> = {};
          await Promise.all(missingTaskIds.map(async (id) => {
            try {
              const snap = await getDoc(doc(collection(db, 'tasks'), id));
              if (snap.exists()) {
                const t = snap.data() as any;
                const pts = Number(t.points || 0) || effortToPoints(t.effort);
                updates[id] = pts;
                goalUpd[id] = t.goalId;
                themeUpd[id] = t.theme;
              }
            } catch {}
          }));
          if (Object.keys(updates).length > 0) setTaskPointsById(prev => ({ ...prev, ...updates }));
          if (Object.keys(goalUpd).length > 0) setTaskGoalById(prev => ({ ...prev, ...goalUpd }));
          if (Object.keys(themeUpd).length > 0) setTaskThemeById(prev => ({ ...prev, ...themeUpd }));
        }
        // Story points mapping already tracked from sprint subscribe; nothing extra needed here
        setLoadingInstances(false);
      }
    );
    return () => unsub();
  }, [currentUser?.uid, days.map(d => d.getTime()).join('|')]);

  // Optionally include calendar_blocks during sprint window
  useEffect(() => {
    if (!currentUser?.uid || days.length === 0) { setBlocksByDay({}); return; }
    const startMs = days[0].setHours(0,0,0,0);
    const endMs = (() => { const d = new Date(days[days.length - 1]); d.setHours(23,59,59,999); return d.getTime(); })();
    const unsub = onSnapshot(
      query(
        collection(db, 'calendar_blocks'),
        where('ownerUid', '==', currentUser.uid),
        where('start', '>=', startMs),
        where('start', '<=', endMs),
        orderBy('start', 'asc')
      ),
      (snap) => {
        const by: Record<IsoDate, Array<{ id: string; storyId?: string; taskId?: string; theme?: number }>> = {};
        const missingTasks = new Set<string>();
        const missingStories = new Set<string>();
        snap.docs.forEach(d => {
          const b: any = d.data();
          const dayKey = toDayKey(new Date(Number(b.start)));
          if (!by[dayKey]) by[dayKey] = [];
          const row = { id: d.id, storyId: b.storyId, taskId: b.taskId, theme: typeof b.theme === 'number' ? b.theme : undefined };
          by[dayKey].push(row);
          if (row.taskId && !(row.taskId in taskPointsById)) missingTasks.add(row.taskId);
          if (row.storyId && !(row.storyId in storyPointsById)) missingStories.add(row.storyId);
        });
        setBlocksByDay(by);
        // hydrate missing ids
        Promise.all([
          ...Array.from(missingTasks).map(async (id) => {
            try { const s = await getDoc(doc(collection(db, 'tasks'), id)); if (s.exists()) { const t:any = s.data(); const pts = Number(t.points||0) || effortToPoints(t.effort); setTaskPointsById(prev => ({...prev, [id]: pts})); if (t.goalId) setTaskGoalById(prev=>({...prev, [id]: t.goalId})); if (typeof t.theme==='number') setTaskThemeById(prev=>({...prev, [id]: t.theme})); } } catch {}
          }),
          ...Array.from(missingStories).map(async (id) => {
            try { const s = await getDoc(doc(collection(db, 'stories'), id)); if (s.exists()) { const st:any = s.data(); const pts = Number(st.points||0); if (pts>0) setStoryPointsById(prev=>({...prev, [id]: pts})); if (st.goalId) setStoryGoalById(prev=>({...prev, [id]: st.goalId})); if (typeof st.theme==='number') setStoryThemeById(prev=>({...prev, [id]: st.theme})); } } catch {}
          })
        ]).then(()=>{});
      }
    );
    return () => unsub();
  }, [currentUser?.uid, days.map(d => d.getTime()).join('|'), storyPointsById, taskPointsById]);

  const plannedPointsByDay = useMemo(() => {
    // Distribute points proportionally by instances per source across the range
    const result: Record<IsoDate, number> = {};
    // Build per-source counts to split story/task points across days
    const counts: Record<string, number> = {};
    for (const [day, list] of Object.entries(instancesByDay)) {
      for (const inst of list) {
        const key = `${inst.sourceType}:${inst.sourceId}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    for (const [day, list] of Object.entries(instancesByDay)) {
      let sum = 0;
      for (const inst of list) {
        const key = `${inst.sourceType}:${inst.sourceId}`;
        const splits = counts[key] || 1;
        if (inst.sourceType === 'story') {
          const pts = storyPointsById[inst.sourceId] || 0;
          sum += pts > 0 ? (pts / splits) : 0;
        } else {
          const pts = taskPointsById[inst.sourceId] || 0;
          sum += pts > 0 ? (pts / splits) : 0;
        }
      }
      // Include blocks if enabled (only those linked to story/task contribute points)
      if (includeBlocks) {
        const blocks = blocksByDay[day] || [];
        for (const b of blocks) {
          if (b.storyId) sum += storyPointsById[b.storyId] || 0; else if (b.taskId) sum += taskPointsById[b.taskId] || 0;
        }
      }
      result[day] = Math.round(sum * 10) / 10;
    }
    return result;
  }, [instancesByDay, storyPointsById, taskPointsById, includeBlocks, blocksByDay]);

  const plannedPointsByDayAndTheme = useMemo(() => {
    const result: Record<IsoDate, Record<number, number>> = {};
    const counts: Record<string, number> = {};
    for (const list of Object.values(instancesByDay)) {
      for (const inst of list) {
        const key = `${inst.sourceType}:${inst.sourceId}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    for (const [day, list] of Object.entries(instancesByDay)) {
      const m: Record<number, number> = {};
      for (const inst of list) {
        const splits = counts[`${inst.sourceType}:${inst.sourceId}`] || 1;
        if (inst.sourceType === 'story') {
          const pts = storyPointsById[inst.sourceId] || 0;
          const theme = storyThemeById[inst.sourceId];
          if (typeof theme === 'number' && pts > 0) m[theme] = (m[theme] || 0) + (pts / splits);
        } else {
          const pts = taskPointsById[inst.sourceId] || 0;
          const theme = taskThemeById[inst.sourceId];
          if (typeof theme === 'number' && pts > 0) m[theme] = (m[theme] || 0) + (pts / splits);
        }
      }
      if (includeBlocks) {
        const blocks = blocksByDay[day] || [];
        for (const b of blocks) {
          const theme = b.theme;
          if (b.storyId) {
            const pts = storyPointsById[b.storyId] || 0;
            if (theme && pts>0) m[theme] = (m[theme] || 0) + pts;
          } else if (b.taskId) {
            const pts = taskPointsById[b.taskId] || 0;
            if (theme && pts>0) m[theme] = (m[theme] || 0) + pts;
          }
        }
      }
      Object.keys(m).forEach((k) => { m[Number(k)] = Math.round(m[Number(k)] * 10) / 10; });
      result[day] = m;
    }
    return result;
  }, [instancesByDay, storyPointsById, taskPointsById, storyThemeById, taskThemeById, includeBlocks, blocksByDay]);

  const plannedPointsByDayAndGoal = useMemo(() => {
    const result: Record<IsoDate, Record<string, number>> = {};
    const counts: Record<string, number> = {};
    for (const list of Object.values(instancesByDay)) {
      for (const inst of list) {
        const key = `${inst.sourceType}:${inst.sourceId}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    for (const [day, list] of Object.entries(instancesByDay)) {
      const m: Record<string, number> = {};
      for (const inst of list) {
        const splits = counts[`${inst.sourceType}:${inst.sourceId}`] || 1;
        if (inst.sourceType === 'story') {
          const pts = storyPointsById[inst.sourceId] || 0;
          const goal = storyGoalById[inst.sourceId];
          if (goal && pts > 0) m[goal] = (m[goal] || 0) + (pts / splits);
        } else {
          const pts = taskPointsById[inst.sourceId] || 0;
          const goal = taskGoalById[inst.sourceId];
          if (goal && pts > 0) m[goal] = (m[goal] || 0) + (pts / splits);
        }
      }
      if (includeBlocks) {
        const blocks = blocksByDay[day] || [];
        for (const b of blocks) {
          const goal = b.storyId ? storyGoalById[b.storyId] : (b.taskId ? taskGoalById[b.taskId] : undefined);
          if (goal) {
            const pts = b.storyId ? (storyPointsById[b.storyId] || 0) : (b.taskId ? (taskPointsById[b.taskId] || 0) : 0);
            if (pts>0) m[goal] = (m[goal] || 0) + pts;
          }
        }
      }
      Object.keys(m).forEach((k) => { m[k] = Math.round(m[k] * 10) / 10; });
      result[day] = m;
    }
    return result;
  }, [instancesByDay, storyPointsById, taskPointsById, storyGoalById, taskGoalById, includeBlocks, blocksByDay]);

  // Precompute occurrence counts across sprint window for fair split in details modal
  const occurrenceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const list of Object.values(instancesByDay)) {
      for (const inst of list) {
        const key = `${inst.sourceType}:${inst.sourceId}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }, [instancesByDay]);

  const dayDetails = useMemo(() => {
    if (!activeDay) return [] as Array<{ key: string; label: string; title: string; pts: number; goal?: string; themeLabel?: string; href?: string }>;
    const rows: Array<{ key: string; label: string; title: string; pts: number; goal?: string; themeLabel?: string; href?: string }> = [];
    const list = instancesByDay[activeDay] || [];
    for (const inst of list) {
      const key = `${inst.sourceType}:${inst.sourceId}`;
      const splits = occurrenceCounts[key] || 1;
      let pts = 0;
      let title = inst.sourceId;
      let goal: string | undefined;
      let themeLabel: string | undefined;
      if (inst.sourceType === 'story') {
        pts = (storyPointsById[inst.sourceId] || 0) / splits;
        const story = stories.find(s => s.id === inst.sourceId) as any;
        if (story) {
          title = story.title || title;
          if (story.goalId) goal = goalTitleById[story.goalId] || story.goalId;
          if (typeof story.theme === 'number') themeLabel = themeLabelById.get(story.theme) || String(story.theme);
        }
      } else {
        pts = (taskPointsById[inst.sourceId] || 0) / splits;
        // lazy load task title omitted; keep id
        const goalId = taskGoalById[inst.sourceId];
        if (goalId) goal = goalTitleById[goalId] || goalId;
        const th = taskThemeById[inst.sourceId];
        if (typeof th === 'number') themeLabel = themeLabelById.get(th) || String(th);
      }
      rows.push({ key, label: inst.sourceType === 'story' ? 'Story' : 'Task', title, pts: Math.round(pts * 10) / 10, goal, themeLabel, href: inst.sourceType === 'story' ? `/stories/${inst.sourceId}` : undefined });
    }
    if (includeBlocks) {
      const blocks = blocksByDay[activeDay] || [];
      for (const b of blocks) {
        let pts = 0;
        let title = b.storyId || b.taskId || b.id;
        let goal: string | undefined;
        let themeLabel: string | undefined;
        if (b.storyId) {
          pts = storyPointsById[b.storyId] || 0;
          const story = stories.find(s => s.id === b.storyId) as any;
          if (story) {
            title = story.title || title;
            if (story.goalId) goal = goalTitleById[story.goalId] || story.goalId;
            if (typeof story.theme === 'number') themeLabel = themeLabelById.get(story.theme) || String(story.theme);
          }
          rows.push({ key: `block:story:${b.storyId}`, label: 'Block', title, pts, goal, themeLabel, href: `/stories/${b.storyId}` });
        } else if (b.taskId) {
          pts = taskPointsById[b.taskId] || 0;
          const gid = taskGoalById[b.taskId];
          if (gid) goal = goalTitleById[gid] || gid;
          const th = taskThemeById[b.taskId];
          if (typeof th === 'number') themeLabel = themeLabelById.get(th) || String(th);
          rows.push({ key: `block:task:${b.taskId}`, label: 'Block', title, pts, goal, themeLabel });
        }
      }
    }
    return rows.sort((a,b) => b.pts - a.pts);
  }, [activeDay, instancesByDay, blocksByDay, includeBlocks, occurrenceCounts, storyPointsById, taskPointsById, stories, goalTitleById, themeLabelById, taskGoalById, taskThemeById]);

  

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 mb-0">Planning Matrix v2</h1>
        <div className="d-flex align-items-center gap-2">
          <Badge bg="secondary">Sprint: {selectedSprintId || 'none'}</Badge>
          <Badge bg="secondary">User: {currentUser?.email?.split('@')[0] || 'anon'}</Badge>
          <Button size="sm" variant="outline-primary" onClick={() => setView(v => v==='matrix'?'kanban':'matrix')}>
            Switch to {view === 'matrix' ? 'Kanban' : 'Matrix'}
          </Button>
        </div>
      </div>

      <Card>
        <Card.Body>
          {/* Header row with sprint and capacity */}
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div>
              <div className="fw-semibold">{sprint ? (sprint.name || sprint.ref) : 'No sprint selected'}</div>
              {sprint && (
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {format(new Date(Number(sprint.startDate)), 'EEE dd MMM')} → {format(new Date(Number(sprint.endDate)), 'EEE dd MMM')}
                </div>
              )}
            </div>
              <div className="d-flex align-items-center gap-2">
                <Badge bg={overBy > 0 ? 'danger' : 'success'}>
                  Planned: {totalPoints} pts
                </Badge>
                <Badge bg="secondary">Days: {days.length || 0}</Badge>
                <Badge bg="info">Per‑day: {capacityPerDay || 0} pts</Badge>
                <Form.Check
                  type="switch"
                  id="include-blocks-switch"
                  label="Include Calendar Blocks"
                  checked={includeBlocks}
                  onChange={(e) => setIncludeBlocks(e.currentTarget.checked)}
                />
                <div className="d-flex align-items-center gap-1">
                  <Button size="sm" variant={breakdown==='none'?'primary':'outline-primary'} onClick={() => setBreakdown('none')}>No Breakdown</Button>
                  <Button size="sm" variant={breakdown==='theme'?'primary':'outline-primary'} onClick={() => setBreakdown('theme')}>By Theme</Button>
                  <Button size="sm" variant={breakdown==='goal'?'primary':'outline-primary'} onClick={() => setBreakdown('goal')}>By Goal</Button>
                </div>
              <Form className="d-flex align-items-center gap-1">
                <Form.Label className="mb-0" style={{ fontSize: 12 }}>Capacity</Form.Label>
                <Form.Control
                  style={{ width: 90 }}
                  size="sm"
                  type="number"
                  value={capacity || ''}
                  placeholder="pts"
                  onChange={(e) => setCapacity(Number(e.target.value) || 0)}
                  onBlur={async () => {
                    if (!currentUser?.uid || !sprint?.id) return;
                    const capId = `${currentUser.uid}__${sprint.id}`;
                    await setDoc(doc(collection(db, 'sprint_capacity'), capId), {
                      ownerUid: currentUser.uid,
                      sprintId: sprint.id,
                      pointsCapacity: Number(capacity) || 0,
                      updatedAt: Date.now(),
                    }, { merge: true });
                  }}
                />
                <Badge bg="primary">{capacity || 0} pts</Badge>
              </Form>
            </div>
          </div>

          {error && <Alert variant="danger" className="mb-2">{error}</Alert>}

          {/* Day columns */}
          <div className="d-flex" style={{ gap: 12, overflowX: 'auto' }}>
            {days.map((d) => {
              const dayKey = toDayKey(d);
              const planned = plannedPointsByDay[dayKey] || 0;
              const warn = capacityPerDay > 0 && planned > capacityPerDay;
              const colStyle: React.CSSProperties = warn ? { background: 'rgba(220,53,69,0.06)', borderRadius: 6, padding: 4 } : {};
              return (
              <div key={d.toISOString()} style={{ minWidth: 140, ...colStyle }}>
                <div className="mb-2" style={{ fontWeight: 600 }}>
                  {format(d, 'EEE dd MMM')}
                </div>
                <Card className="mb-2">
                  <Card.Body className="p-2" style={{ cursor: 'pointer' }} onClick={() => setActiveDay(dayKey)}>
                    <div className="d-flex align-items-center justify-content-between">
                      <span className="text-muted" style={{ fontSize: 12 }}>Planned</span>
                      <Badge bg={warn ? 'danger' : 'secondary'}>{planned} pts</Badge>
                    </div>
                    {breakdown !== 'none' && (
                      <div className="mt-2" style={{ fontSize: 12 }}>
                        {breakdown === 'theme' && (
                          <div className="d-flex flex-column" style={{ gap: 6 }}>
                            {Object.entries(plannedPointsByDayAndTheme[dayKey] || {}).map(([themeId, pts]) => {
                              const idNum = Number(themeId);
                              const label = themeLabelById.get(idNum) || `Theme ${themeId}`;
                              const colors = themeColorById.get(idNum) || { bg: '#0ea5e9', text: '#ffffff' };
                              return (
                                <div key={themeId} className="d-flex align-items-center justify-content-between">
                                  <span style={{ background: colors.bg, color: colors.text, borderRadius: 8, padding: '2px 8px', fontSize: 12 }}>{label}</span>
                                  <Badge bg="light" text="dark">{pts} pts</Badge>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {breakdown === 'goal' && (
                          <div className="d-flex flex-column" style={{ gap: 4 }}>
                            {Object.entries(plannedPointsByDayAndGoal[dayKey] || {}).map(([goalId, pts]) => {
                              const themeId = goalThemeById[goalId];
                              const colors = (typeof themeId === 'number' && themeColorById.get(themeId)) || { bg: '#0ea5e9', text: '#ffffff' };
                              return (
                                <div key={goalId} className="d-flex align-items-center justify-content-between">
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ width: 10, height: 10, background: colors.bg, borderRadius: 999 }} />
                                    <span>{goalTitleById[goalId] || `Goal ${goalId.slice(0,6)}…`}</span>
                                  </span>
                                  <Badge bg="light" text="dark">{pts} pts</Badge>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </Card.Body>
                </Card>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Capacity: {capacityPerDay || 0} pts
                </div>
              </div>
            );})}
          </div>

          {/* Sprint totals row & actions */}
          <div className="mt-3 d-flex align-items-center gap-2">
            <Badge bg={overBy > 0 ? 'danger' : 'success'}>
              {overBy > 0 ? `Over by ${overBy} pts` : 'Within capacity'}
            </Badge>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Stories in sprint: {stories.length}
            </div>
            <div className="ms-auto d-flex align-items-center gap-2">
              <Button size="sm" variant="outline-secondary" onClick={async () => {
                try {
                  // Generate proposal for sprint window
                  const callable = (await import('firebase/functions')).httpsCallable;
                  const getFns = (await import('firebase/functions')).getFunctions;
                  const fns = getFns();
                  const horizonDays = Math.max(1, days.length || 1);
                  await callable(fns, 'planCalendar')({ persona: 'personal', horizonDays });
                  alert('Planner triggered. Check Approvals for proposals.');
                } catch (e: any) {
                  alert(e?.message || 'Failed to trigger planner');
                }
              }}>Generate Sprint Proposal</Button>
              <Button size="sm" variant="outline-primary" onClick={() => window.location.assign('/sprints/kanban')}>Open Kanban</Button>
            </div>
          </div>
        </Card.Body>
      </Card>

      {/* Approvals panel */}
      <ApprovalsPanel />

      {/* Day details modal */}
      <Modal show={!!activeDay} onHide={() => setActiveDay(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Planned on {activeDay}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {dayDetails.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>No planned items for this day.</div>
          ) : (
            <ListGroup>
              {dayDetails.map((r, idx) => (
                <ListGroup.Item key={r.key + idx} className="d-flex align-items-center justify-content-between"
                  style={{ borderLeft: r.themeLabel ? '4px solid var(--bs-border-color)' : undefined }}>
                  <div>
                    <div className="fw-semibold" style={{ fontSize: 13 }}>{r.title}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{r.label}{r.goal ? ` · ${r.goal}` : ''}{r.themeLabel ? ` · ${r.themeLabel}` : ''}</div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <Badge bg="light" text="dark">{r.pts} pts</Badge>
                    {r.href && (
                      <Button size="sm" variant="outline-secondary" onClick={() => window.location.assign(r.href!)}>Open</Button>
                    )}
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setActiveDay(null)}>Close</Button>
          <Button variant="primary" onClick={() => window.location.assign('/calendar')}>Open Planner</Button>
        </Modal.Footer>
      </Modal>

      {/* Quick Points Editor for stories missing points */}
      <Card className="mt-3">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="fw-semibold">Story Points — Quick Editor</div>
          </div>
          {stories.filter(s => !(Number((s as any).points) > 0)).length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>All sprint stories have points.</div>
          ) : (
            <div className="d-flex flex-column" style={{ gap: 6 }}>
              {stories.filter(s => !(Number((s as any).points) > 0)).map((s) => (
                <div key={s.id} className="d-flex align-items-center justify-content-between border rounded p-2">
                  <div style={{ maxWidth: '70%' }}>
                    <div className="fw-semibold" style={{ fontSize: 13 }}>{(s as any).title}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>Goal {(s as any).goalId || '—'}</div>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <Form.Control size="sm" type="number" min={0} placeholder="pts"
                      style={{ width: 80 }}
                      onBlur={async (e) => {
                        const val = Number(e.currentTarget.value || 0);
                        if (!(val > 0)) return;
                        try {
                          await updateDoc(doc(collection(db, 'stories'), s.id), { points: val, updatedAt: Date.now() });
                          e.currentTarget.value = '';
                        } catch (err) {
                          alert('Failed to update points');
                        }
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Carryover Forecast — unscheduled instances in window */}
      <Card className="mt-3">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between mb-2">
            <div className="fw-semibold">Carryover Forecast</div>
            <Badge bg={unscheduledList.length > 0 ? 'warning' : 'secondary'}>{unscheduledList.length} unscheduled</Badge>
          </div>
          {unscheduledList.length === 0 ? (
            <div className="text-muted" style={{ fontSize: 13 }}>No unscheduled items in the sprint window.</div>
          ) : (
            <div className="d-flex flex-column" style={{ gap: 6 }}>
              {unscheduledList.slice(0, 20).map((u) => (
                <div key={u.id} className="d-flex align-items-center justify-content-between border rounded p-2">
                  <div>
                    <div className="fw-semibold" style={{ fontSize: 13 }}>{u.title || (u.sourceType === 'story' ? 'Story' : 'Task')}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>{u.day} · {u.reason || 'No window'}</div>
                  </div>
                  <Badge bg="secondary">{u.sourceType}</Badge>
                </div>
              ))}
              {unscheduledList.length > 20 && (
                <div className="text-muted" style={{ fontSize: 12 }}>+{unscheduledList.length - 20} more…</div>
              )}
            </div>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default PlanningMatrixV2;
