import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonGroup, Modal, Form, Badge, Dropdown } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useSprint } from '../../contexts/SprintContext';
import { useSidebar } from '../../contexts/SidebarContext';
import { collection, onSnapshot, query, where, updateDoc, doc, orderBy, limit, deleteDoc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { Goal, Sprint, Story } from '../../types';
import { isStatus } from '../../utils/statusHelpers';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import { Wand2, List as ListIcon, BookOpen, MessageSquareText, Edit3, Trash2, ZoomIn, ZoomOut, Home, Maximize2, ChevronLeft, ChevronRight, MoreVertical, Activity } from 'lucide-react';
import EditGoalModal from '../../components/EditGoalModal';
import './GoalRoadmapV3.css';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import GLOBAL_THEMES, { migrateThemeValue, type GlobalTheme } from '../../constants/globalThemes';

type Zoom = 'weeks' | 'months' | 'quarters' | 'years';

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

const GoalRoadmapV3: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();
  const { selectedSprintId } = useSprint();
  const { showSidebar } = useSidebar();
  const { themes: globalThemes } = useGlobalThemes();

  const [zoom, setZoom] = useState<Zoom>('quarters');
  const [yearSpan, setYearSpan] = useState<1 | 3 | 5>(3);
  // Optional custom range (e.g., Fit All). When set, overrides preset ranges
  const [customRange, setCustomRange] = useState<{ start: Date; end: Date } | null>(null);

  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityGoalId, setActivityGoalId] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<any[]>([]);
  const [noteGoalId, setNoteGoalId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [lastNotes, setLastNotes] = useState<Record<string, string>>({});
  const [storyCounts, setStoryCounts] = useState<Record<string, number>>({});
  const [storyDoneCounts, setStoryDoneCounts] = useState<Record<string, number>>({});
  const [showGlobalActivity, setShowGlobalActivity] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [globalActivityItems, setGlobalActivityItems] = useState<any[]>([]);
  const [showSprints, setShowSprints] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [showEmptyThemes, setShowEmptyThemes] = useState(false);
  const [filterHasStories, setFilterHasStories] = useState(false);
  const [filterInSelectedSprint, setFilterInSelectedSprint] = useState(false);
  const [filterOverlapSelectedSprint, setFilterOverlapSelectedSprint] = useState(false);

  const themePalette = useMemo(() => (globalThemes && globalThemes.length ? globalThemes : GLOBAL_THEMES), [globalThemes]);
  const themeMap = useMemo(() => {
    const map = new Map<number, GlobalTheme>();
    themePalette.forEach((item) => map.set(item.id, item));
    return map;
  }, [themePalette]);
  const themesList = useMemo(() => themePalette.map(t => ({ id: t.id, name: t.name || t.label, color: t.color, textColor: t.textColor })), [themePalette]);
  const getThemeDefinition = useCallback((id: number) => themeMap.get(id) || themePalette[0] || GLOBAL_THEMES[0], [themeMap, themePalette]);

  // Viewport culling state
  const [viewport, setViewport] = useState<{ left: number; width: number }>({ left: 0, width: 1200 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [financeOnTrack, setFinanceOnTrack] = useState<boolean|null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const timeRange = useMemo(() => {
    if (customRange) {
      const start = new Date(customRange.start);
      const end = new Date(customRange.end);
      start.setHours(0,0,0,0); end.setHours(0,0,0,0);
      return { start, end };
    }
    const today = new Date();
    today.setHours(0,0,0,0);
    const startOfWeek = (d: Date) => { const c=new Date(d); const day=(c.getDay()+6)%7; c.setDate(c.getDate()-day); c.setHours(0,0,0,0); return c; };
    const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
    const startOfQuarter = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1);
    const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);
    let start = new Date(today); let end = new Date(today);
    if (zoom === 'weeks') {
      // Show 6 weeks forward from this week
      start = startOfWeek(today);
      end = new Date(start); end.setDate(start.getDate() + 7*6 - 1);
    } else if (zoom === 'months') {
      // Show 6 months forward from current month
      start = startOfMonth(today);
      end = new Date(start); end.setMonth(start.getMonth() + 6); end.setDate(end.getDate() - 1);
    } else if (zoom === 'quarters') {
      // Show 6 quarters (18 months) forward from current quarter
      start = startOfQuarter(today);
      end = new Date(start); end.setMonth(start.getMonth() + 3*6); end.setDate(end.getDate() - 1);
    } else {
      // Years view supports variable spans: 1y, 3y, 5y — forward from current year
      start = startOfYear(today);
      end = new Date(start.getFullYear() + yearSpan, 0, 1); end.setDate(end.getDate() - 1);
    }
    start.setHours(0,0,0,0); end.setHours(0,0,0,0);
    return { start, end };
  }, [zoom, yearSpan, customRange]);

  const pxPerDay = useMemo(() => {
    switch (zoom) {
      case 'weeks': return 12;
      case 'months': return 4;
      case 'quarters': return 1.8;
      case 'years': return 0.8;
      default: return 1.8;
    }
  }, [zoom]);

  const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
  const xFromDate = useCallback((date: Date) => daysBetween(timeRange.start, date) * pxPerDay, [timeRange.start, pxPerDay]);
  const dateFromX = useCallback((x: number) => { const d = new Date(timeRange.start); d.setDate(d.getDate() + Math.round(x / pxPerDay)); d.setHours(0,0,0,0); return d; }, [timeRange.start, pxPerDay]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'goals'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Goal));
      setGoals(data);
      setLoading(false);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Finance on-track badge derived from Monzo analytics + user budgets
  useEffect(() => {
    if (!currentUser?.uid) return;
    const load = async () => {
      try {
        const budgetsSnap = await getDoc(doc(db, 'finance_budgets', currentUser.uid));
        const summarySnap = await getDoc(doc(db, 'monzo_budget_summary', currentUser.uid));
        if (!budgetsSnap.exists() || !summarySnap.exists()) { setFinanceOnTrack(null); return; }
        const budgets: any = budgetsSnap.data();
        const categories: Array<any> = Array.isArray((summarySnap.data() as any)?.categories) ? (summarySnap.data() as any).categories : [];
        const byKey: Record<string, number> = {};
        for (const [k, v] of Object.entries(budgets.byCategory || {})) { byKey[String(k).toLowerCase()] = Number(v || 0); }
        const totalBudget = Object.values(byKey).reduce((a,b) => a + (Number(b)||0), 0);
        let actual = 0;
        for (const c of categories) {
          const key = String(c.label || '').toLowerCase();
          if (key && byKey[key] != null) { actual += Number(c.amount || 0); }
        }
        if (totalBudget > 0) setFinanceOnTrack(actual <= totalBudget); else setFinanceOnTrack(null);
      } catch {
        setFinanceOnTrack(null);
      }
    };
    load();
  }, [currentUser?.uid]);

  // Auto-fit on first load when goals arrive
  const didFitRef = useRef(false);
  useEffect(() => {
    if (didFitRef.current) return;
    if (!goals || goals.length === 0) return;
    didFitRef.current = true;
    // Compute fit-all domain across goals
    const mins: number[] = [];
    const maxs: number[] = [];
    goals.forEach(g => {
      const s = g.startDate ? new Date(g.startDate).getTime() : undefined;
      const e = g.endDate ? new Date(g.endDate).getTime() : (g.targetDate ? new Date(g.targetDate).getTime() : undefined);
      if (typeof s === 'number') mins.push(s);
      if (typeof e === 'number') maxs.push(e);
    });
    if (mins.length && maxs.length) {
      let min = Math.min(...mins);
      let max = Math.max(...maxs);
      if (min === max) max = min + 30*86400000; // ensure non-zero span
      const pad = Math.round((max - min) * 0.08);
      const start = new Date(min - pad);
      const end = new Date(max + pad);
      start.setHours(0,0,0,0); end.setHours(0,0,0,0);
      setCustomRange({ start, end });
      setZoom('years'); // compact single-line style for fit scale
    }
  }, [goals]);

  // Subscribe to stories to compute counts per goal (lightweight aggregate)
  const goalsInSprint = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const counts: Record<string, number> = {};
      const doneCounts: Record<string, number> = {};
      const inSprint = new Set<string>();
      for (const d of snap.docs) {
        const story = d.data() as Story;
        const gid = story.goalId as string | undefined;
        if (gid) {
          counts[gid] = (counts[gid] || 0) + 1;
          if (isStatus(story.status as any, 'done')) doneCounts[gid] = (doneCounts[gid] || 0) + 1;
        }
        if (selectedSprintId && story.sprintId === selectedSprintId && gid) inSprint.add(gid);
      }
      setStoryCounts(counts);
      setStoryDoneCounts(doneCounts);
      goalsInSprint.current = inSprint;
    });
    return () => unsub();
  }, [currentUser?.uid, selectedSprintId]);

  // Subscribe to sprints (for overlay labels & bands) – used on weeks/months views
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, snap => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Sprint));
      setSprints(data);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Subscribe to latest goal notes across the activity stream (for bar preview)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('timestamp', 'desc'),
      limit(300)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const map: Record<string, string> = {};
        for (const d of snap.docs) {
          const data = d.data() as any;
          if (data.entityType !== 'goal') continue;
          if (data.activityType !== 'note_added') continue;
          const gid = data.entityId as string;
          if (!gid || map[gid]) continue;
          if (data.noteContent) {
            map[gid] = String(data.noteContent);
          }
        }
        setLastNotes(map);
      },
      (error) => {
        console.error('GoalRoadmapV3 activity stream error:', error);
        setLastNotes({});
      }
    );
    return () => unsub();
  }, [currentUser?.uid]);

  // Activity stream subscription per selected goal
  useEffect(() => {
    if (!activityGoalId) return;
    const unsub = ActivityStreamService.subscribeToActivityStream(activityGoalId, setActivityItems);
    return () => unsub();
  }, [activityGoalId]);

  // Global activity stream subscription when modal open
  useEffect(() => {
    if (!showGlobalActivity || !currentUser?.uid) return;
    const q = query(
      collection(db, 'activity_stream'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('timestamp', 'desc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setGlobalActivityItems(list as any[]);
    });
    return () => unsub();
  }, [showGlobalActivity, currentUser?.uid]);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const today = new Date();
    const left = 260 + xFromDate(today) - el.clientWidth * 0.35;
    el.scrollLeft = clamp(left, 0, el.scrollWidth);
  }, [xFromDate, zoom, goals.length]);

  // Track viewport for culling
  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const update = () => setViewport({ left: Math.max(0, el.scrollLeft), width: el.clientWidth });
    update();
    el.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, []);

  const gridLines = useMemo(() => {
    const out: { label: string; x: number }[] = [];
    const cursor = new Date(timeRange.start); cursor.setDate(1);
    while (cursor <= timeRange.end) {
      let label = '';
      if (zoom === 'weeks' || zoom === 'months') label = `${cursor.toLocaleString('default',{month:'short'})} ${cursor.getFullYear()}`;
      else if (zoom === 'quarters') label = `Q${Math.floor(cursor.getMonth()/3)+1} ${cursor.getFullYear()}`;
      else label = `${cursor.getFullYear()}`;
      out.push({ label, x: xFromDate(new Date(cursor)) });
      if (zoom === 'weeks') cursor.setMonth(cursor.getMonth()+1);
      else if (zoom === 'months') cursor.setMonth(cursor.getMonth()+1);
      else if (zoom === 'quarters') cursor.setMonth(cursor.getMonth()+3);
      else cursor.setFullYear(cursor.getFullYear()+1);
    }
    return out;
  }, [timeRange, xFromDate, zoom]);

  // Sprint overlays (labels + bands) for weeks/months only
  const sprintOverlays = useMemo(() => {
    if (!(zoom === 'weeks' || zoom === 'months')) return [] as { left: number; width: number; name: string }[];
    return sprints.map(s => {
      const sStart = new Date(s.startDate);
      const sEnd = new Date(s.endDate);
      const left = xFromDate(sStart);
      const width = Math.max(8, xFromDate(sEnd) - left);
      return { left, width, name: s.name };
    });
  }, [sprints, zoom, xFromDate]);

  // Filters derived function
  const applyFilters = useCallback((g: Goal): boolean => {
    if (filterHasStories && !(storyCounts[g.id] > 0)) return false;
    if (filterInSelectedSprint && selectedSprintId) {
      if (!goalsInSprint.current.has(g.id)) return false;
    }
    if (filterOverlapSelectedSprint && selectedSprintId) {
      const s = sprints.find(x => x.id === selectedSprintId);
      if (s) {
        const gs = g.startDate ? new Date(g.startDate).getTime() : Date.now();
        const ge = g.endDate ? new Date(g.endDate).getTime() : gs + 86400000*90;
        const ss = new Date(s.startDate).getTime();
        const se = new Date(s.endDate).getTime();
        const overlaps = gs <= se && ge >= ss;
        if (!overlaps) return false;
      }
    }
    return true;
  }, [filterHasStories, filterInSelectedSprint, filterOverlapSelectedSprint, selectedSprintId, sprints, storyCounts]);

  // Drag+resize implementation
  const dragState = useRef<{ id: string|null; type: 'move'|'start'|'end'|null; startX: number; origStart: Date; origEnd: Date }>({ id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() });
  const [guideXs, setGuideXs] = useState<number[]>([]);
  const [activeGuideX, setActiveGuideX] = useState<number | null>(null);
  const pointerMove = useCallback((ev: PointerEvent) => {
    const s = dragState.current; if (!s.id || !s.type) return; ev.preventDefault();
    const dx = ev.clientX - s.startX; const deltaDays = Math.round(dx / pxPerDay);
    let ns = new Date(s.origStart), ne = new Date(s.origEnd);
    if (s.type === 'move') { ns.setDate(ns.getDate()+deltaDays); ne.setDate(ne.getDate()+deltaDays); }
    if (s.type === 'start') { ns.setDate(ns.getDate()+deltaDays); if (ns > ne) ns = new Date(ne); }
    if (s.type === 'end') { ne.setDate(ne.getDate()+deltaDays); if (ne < ns) ne = new Date(ns); }
    ns.setHours(0,0,0,0); ne.setHours(0,0,0,0);
    const el = document.querySelector(`[data-grv3-goal="${s.id}"]`) as HTMLElement | null;
    if (el) { const left = xFromDate(ns); const right = xFromDate(ne); el.style.left = `${left}px`; el.style.width = `${Math.max(14, right-left)}px`; }
    const tip = tooltipRef.current; if (tip) { tip.style.display = 'block'; tip.style.left = `${ev.clientX+8}px`; tip.style.top = `${ev.clientY+8}px`; tip.textContent = `${ns.toLocaleDateString()} → ${ne.toLocaleDateString()}`; }
    if (guideXs.length > 0) {
      const sx = xFromDate(ns);
      let best = guideXs[0]; let bd = Math.abs(best - sx);
      for (let i=1;i<guideXs.length;i++){ const d = Math.abs(guideXs[i]-sx); if (d < bd) { bd = d; best = guideXs[i]; } }
      setActiveGuideX(best);
    }
  }, [pxPerDay, xFromDate, guideXs]);

  const pointerUp = useCallback(async (ev: PointerEvent) => {
    const s = dragState.current; if (!s.id || !s.type) return; ev.preventDefault();
    document.removeEventListener('pointermove', pointerMove); document.removeEventListener('pointerup', pointerUp);
    const el = document.querySelector(`[data-grv3-goal="${s.id}"]`) as HTMLElement | null; if (!el) { dragState.current = { id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() }; return; }
    const left = parseFloat(el.style.left || '0'); const width = parseFloat(el.style.width || '0');
    let newStart = dateFromX(left); let newEnd = dateFromX(left+width);
    // Optional snapping strategy on drop
    if (snapEnabled) {
      const startOfWeek = (d: Date) => { const c = new Date(d); const day = (c.getDay()+6)%7; c.setDate(c.getDate()-day); c.setHours(0,0,0,0); return c; };
      const endOfWeek = (d: Date) => { const s = startOfWeek(d); const e = new Date(s); e.setDate(s.getDate()+6); e.setHours(0,0,0,0); return e; };
      const startOfMonth = (d: Date) => { const c = new Date(d.getFullYear(), d.getMonth(), 1); c.setHours(0,0,0,0); return c; };
      const endOfMonth = (d: Date) => { const c = new Date(d.getFullYear(), d.getMonth()+1, 0); c.setHours(0,0,0,0); return c; };
      const startOfQuarter = (d: Date) => { const q = Math.floor(d.getMonth()/3)*3; const c = new Date(d.getFullYear(), q, 1); c.setHours(0,0,0,0); return c; };
      const endOfQuarter = (d: Date) => { const q = Math.floor(d.getMonth()/3)*3+2; const c = new Date(d.getFullYear(), q+1, 0); c.setHours(0,0,0,0); return c; };
      if (zoom === 'weeks') { newStart = startOfWeek(newStart); newEnd = endOfWeek(newEnd); }
      else if (zoom === 'months') { newStart = startOfWeek(newStart); newEnd = endOfWeek(newEnd); }
      else if (zoom === 'quarters') { newStart = startOfQuarter(newStart); newEnd = endOfQuarter(newEnd); }
      else if (zoom === 'years') { newStart = startOfMonth(newStart); newEnd = endOfMonth(newEnd); }
    }
    try {
      await updateDoc(doc(db, 'goals', s.id), { startDate: newStart.getTime(), endDate: newEnd.getTime(), updatedAt: Date.now() });
      if (currentUser?.uid) {
        await ActivityStreamService.logFieldChange(s.id, 'goal', currentUser.uid, currentUser.email || '', 'date_range', `${s.origStart.toDateString()} – ${s.origEnd.toDateString()}`, `${newStart.toDateString()} – ${newEnd.toDateString()}`, 'personal', s.id, 'human');
      }
    } catch (e) { console.error('Failed to update goal dates', e); }
    finally { const tip = tooltipRef.current; if (tip) tip.style.display='none'; setGuideXs([]); setActiveGuideX(null); dragState.current = { id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() }; setDraggingId(null); }
  }, [dateFromX, pointerMove, currentUser?.uid]);

  const startDrag = useCallback((ev: React.PointerEvent, goal: Goal, type: 'move'|'start'|'end') => {
    ev.preventDefault();
    const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
    const endDate = goal.endDate ? new Date(goal.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now()+86400000*90));
    dragState.current = { id: goal.id, type, startX: ev.clientX, origStart: startDate, origEnd: endDate };
    setDraggingId(goal.id);
    document.addEventListener('pointermove', pointerMove, { passive: false }); document.addEventListener('pointerup', pointerUp, { passive: false });
    // Build snap guides for current zoom
    const guides: number[] = [];
    const start = new Date(timeRange.start);
    const end = new Date(timeRange.end);
    const startOfWeek = (d: Date) => { const c = new Date(d); const day=(c.getDay()+6)%7; c.setDate(c.getDate()-day); c.setHours(0,0,0,0); return c; };
    if (zoom === 'weeks' || zoom === 'months') {
      let c = startOfWeek(start);
      while (c <= end) { guides.push(xFromDate(new Date(c))); c.setDate(c.getDate()+7); }
    } else if (zoom === 'quarters') {
      for (let y=start.getFullYear(); y<=end.getFullYear(); y++) { [0,3,6,9].forEach(m => { const d=new Date(y,m,1); if(d>=start&&d<=end) guides.push(xFromDate(d)); }); }
    } else if (zoom === 'years') {
      for (let y=start.getFullYear(); y<=end.getFullYear(); y++) { const d=new Date(y,0,1); if(d>=start&&d<=end) guides.push(xFromDate(d)); }
    }
    setGuideXs(guides);
  }, [pointerMove, pointerUp]);

  // Keyboard nudges for accessibility and precision
  const onKeyNudge = useCallback(async (e: React.KeyboardEvent, g: Goal) => {
    const start = g.startDate ? new Date(g.startDate) : new Date();
    const end = g.endDate ? new Date(g.endDate) : new Date(Date.now()+86400000*90);
    let ds = 0, de = 0;
    const step = e.shiftKey ? 7 : 1;
    if (e.key === 'ArrowLeft') { ds -= step; de -= step; }
    if (e.key === 'ArrowRight') { ds += step; de += step; }
    if (e.key === 'ArrowUp') { de -= step; }
    if (e.key === 'ArrowDown') { de += step; }
    if (ds === 0 && de === 0) return;
    e.preventDefault();
    const ns = new Date(start); ns.setDate(ns.getDate()+ds); ns.setHours(0,0,0,0);
    const ne = new Date(end); ne.setDate(ne.getDate()+de); ne.setHours(0,0,0,0);
    try {
      await updateDoc(doc(db, 'goals', g.id), { startDate: ns.getTime(), endDate: ne.getTime(), updatedAt: Date.now() });
      if (currentUser?.uid) {
        await ActivityStreamService.logFieldChange(g.id, 'goal', currentUser.uid, currentUser.email || '', 'date_range', `${start.toDateString()} – ${end.toDateString()}`, `${ns.toDateString()} – ${ne.toDateString()}`, 'personal', g.id, 'human');
      }
    } catch (err) { console.error('Nudge failed', err); }
  }, [currentUser?.uid]);

  const hexToRgba = (hex: string, alpha: number) => {
    const value = hex.replace('#', '');
    const full = value.length === 3 ? value.split('').map(c => c + c).join('') : value;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const barStyle = (g: Goal): React.CSSProperties => {
    const start = g.startDate ? new Date(g.startDate) : (g.targetDate ? new Date(g.targetDate) : new Date());
    const end = g.endDate ? new Date(g.endDate) : (g.targetDate ? new Date(g.targetDate) : new Date(Date.now()+86400000*90));
    const left = xFromDate(start); const width = Math.max(14, xFromDate(end) - left);
    const themeId = migrateThemeValue(g.theme);
    const themeDef = getThemeDefinition(themeId);
    const themeColor = themeDef.color || '#6c757d';
    // V2-inspired subtle gradient using theme color
    const bgStart = hexToRgba(themeColor, theme === 'dark' ? 0.24 : 0.18);
    const bgEnd = hexToRgba(themeColor, theme === 'dark' ? 0.12 : 0.08);
    return {
      left,
      width,
      background: `linear-gradient(180deg, ${bgStart}, ${bgEnd})`,
      border: `2px solid ${themeColor}`,
      color: themeDef.textColor || '#fff'
    } as React.CSSProperties;
  };

  const zoomClass = useMemo(() => (zoom === 'years' ? 'ultra' : zoom === 'quarters' ? 'slim' : ''), [zoom]);
  const totalWidth = useMemo(() => Math.max(1400, Math.round(daysBetween(timeRange.start, timeRange.end) * pxPerDay)), [timeRange, pxPerDay]);

  const handleGenerateStories = useCallback(async (goalId: string) => {
    try { const callable = httpsCallable(functions, 'generateStoriesForGoal'); await callable({ goalId }); }
    catch (e:any) { alert('AI story generation failed: ' + (e?.message || 'unknown')); }
  }, []);

  const handleAddNote = useCallback(async () => {
    if (!noteGoalId || !currentUser?.uid || !noteDraft.trim()) return;
    await ActivityStreamService.addNote(noteGoalId, 'goal', noteDraft.trim(), currentUser.uid, currentUser.email || '', 'personal', noteGoalId, 'human');
    try { await updateDoc(doc(db, 'goals', noteGoalId), { recentNote: noteDraft.trim(), updatedAt: Date.now() }); } catch {}
    setNoteDraft(''); setNoteGoalId(null);
  }, [noteGoalId, noteDraft, currentUser?.uid]);

  // Compute stacking lanes per theme row to avoid visual overlap
  const getLaneHeight = useCallback(() => {
    if (zoom === 'weeks') return 92;
    if (zoom === 'months') return 84;
    if (zoom === 'quarters') return 64;
    return 48; // years
  }, [zoom]);

  type TimedGoal = { id: string; start: number; end: number; raw: Goal };
  const computeLanes = (items: TimedGoal[]): Map<string, number> => {
    // Greedy interval graph coloring by start time
    const sorted = [...items].sort((a,b) => a.start - b.start || a.end - b.end);
    const laneEnds: number[] = [];
    const assignment = new Map<string, number>();
    for (const it of sorted) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (it.start >= laneEnds[i]) { assignment.set(it.id, i); laneEnds[i] = it.end; placed = true; break; }
      }
      if (!placed) { assignment.set(it.id, laneEnds.length); laneEnds.push(it.end); }
    }
    return assignment;
  };

  return (
    <div className={`grv3 ${zoomClass}`}>
      <div className="grv3-toolbar d-flex align-items-center justify-content-start p-2 gap-2">
        {/* Sticky zoom controls on the top-left */}
        <Button size="sm" variant="outline-secondary" onClick={() => {
          // Step zoom in: 5y -> 3y -> 1y -> quarters -> months -> weeks
          const presets: { z: Zoom; y?: 1|3|5 }[] = [
            { z: 'weeks' }, { z: 'months' }, { z: 'quarters' }, { z: 'years', y: 1 }, { z: 'years', y: 3 }, { z: 'years', y: 5 }
          ];
          const idx = presets.findIndex(p => p.z === zoom && (p.z !== 'years' || p.y === yearSpan));
          const next = presets[Math.max(0, idx - 1)];
          setCustomRange(null);
          setZoom(next.z);
          if (next.z === 'years' && next.y) setYearSpan(next.y);
        }} aria-label="Zoom In"><ZoomIn size={14} /></Button>
        <Button size="sm" variant="outline-secondary" onClick={() => {
          // Step zoom out: weeks -> months -> quarters -> 1y -> 3y -> 5y
          const presets: { z: Zoom; y?: 1|3|5 }[] = [
            { z: 'weeks' }, { z: 'months' }, { z: 'quarters' }, { z: 'years', y: 1 }, { z: 'years', y: 3 }, { z: 'years', y: 5 }
          ];
          const idx = presets.findIndex(p => p.z === zoom && (p.z !== 'years' || p.y === yearSpan));
          const next = presets[Math.min(presets.length - 1, idx + 1)];
          setCustomRange(null);
          setZoom(next.z);
          if (next.z === 'years' && next.y) setYearSpan(next.y);
        }} aria-label="Zoom Out"><ZoomOut size={14} /></Button>
        <ButtonGroup size="sm" className="ms-1">
          <Button variant={zoom==='weeks' && !customRange ? 'primary' : 'outline-secondary'} onClick={() => { setCustomRange(null); setZoom('weeks'); }}>Week</Button>
          <Button variant={zoom==='months' && !customRange ? 'primary' : 'outline-secondary'} onClick={() => { setCustomRange(null); setZoom('months'); }}>Month</Button>
          <Button variant={zoom==='quarters' && !customRange ? 'primary' : 'outline-secondary'} onClick={() => { setCustomRange(null); setZoom('quarters'); }}>Quarter</Button>
          <Button variant={zoom==='years' && yearSpan===1 && !customRange ? 'primary' : 'outline-secondary'} onClick={() => { setCustomRange(null); setZoom('years'); setYearSpan(1); }}>1y</Button>
          <Button variant={zoom==='years' && yearSpan===3 && !customRange ? 'primary' : 'outline-secondary'} onClick={() => { setCustomRange(null); setZoom('years'); setYearSpan(3); }}>3y</Button>
          <Button variant={zoom==='years' && yearSpan===5 && !customRange ? 'primary' : 'outline-secondary'} onClick={() => { setCustomRange(null); setZoom('years'); setYearSpan(5); }}>5y</Button>
        </ButtonGroup>
        {/* Horizontal pan controls */}
        <ButtonGroup size="sm" className="ms-2">
          <Button variant="outline-secondary" aria-label="Scroll left" onClick={() => { const el = containerRef.current; if (el) el.scrollBy({ left: -Math.round(el.clientWidth*0.6), behavior: 'smooth' }); }}><ChevronLeft size={16} /></Button>
          <Button variant="outline-secondary" aria-label="Scroll right" onClick={() => { const el = containerRef.current; if (el) el.scrollBy({ left: Math.round(el.clientWidth*0.6), behavior: 'smooth' }); }}><ChevronRight size={16} /></Button>
        </ButtonGroup>
        <Button size="sm" variant={customRange ? 'primary' : 'outline-secondary'} onClick={() => {
          // Fit all goals into view
          const bounds: number[] = [];
          goals.forEach(g => {
            const s = g.startDate ? new Date(g.startDate).getTime() : undefined;
            const e = g.endDate ? new Date(g.endDate).getTime() : (g.targetDate ? new Date(g.targetDate).getTime() : undefined);
            if (typeof s === 'number') bounds.push(s);
            if (typeof e === 'number') bounds.push(e);
          });
          if (bounds.length >= 2) {
            let min = Math.min(...bounds);
            let max = Math.max(...bounds);
            if (min === max) max = min + 30*86400000;
            const pad = Math.round((max - min) * 0.08);
            const start = new Date(min - pad);
            const end = new Date(max + pad);
            start.setHours(0,0,0,0); end.setHours(0,0,0,0);
            setCustomRange({ start, end });
            setZoom('years');
          }
        }} aria-label="Fit All"><Maximize2 size={14} /></Button>
        <Button
          size="sm"
          variant="outline-secondary"
          className="ms-2"
          onClick={() => setShowGlobalActivity(true)}
        >
          <Activity size={14} className="me-1" />
          Activity Feed
        </Button>
        <Button size="sm" variant="outline-secondary" onClick={() => { 
          // Zoom to Month around today and filter to goals with stories in selected sprint
          setCustomRange(null);
          setZoom('months');
          setFilterHasStories(true);
          setFilterInSelectedSprint(true);
          const el = containerRef.current; if (!el) return; const left = 260 + xFromDate(new Date()) - el.clientWidth * .35; el.scrollLeft = clamp(left, 0, el.scrollWidth);
        }} aria-label="Today (Month)"><Home size={14} /></Button>
        <Button size="sm" variant="outline-secondary" onClick={() => containerRef.current?.requestFullscreen?.()}>Full Screen</Button>
        <Form.Check type="switch" id="toggle-sprints" label="Sprints" checked={showSprints} onChange={(e) => setShowSprints(e.currentTarget.checked)} className="ms-2" />
        <Form.Check type="switch" id="toggle-snap" label="Snap" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.currentTarget.checked)} className="ms-1" />
        <Form.Check type="switch" id="toggle-empty-themes" label="Empty themes" checked={showEmptyThemes} onChange={(e) => setShowEmptyThemes(e.currentTarget.checked)} className="ms-1" />
        {/* V2-like filters */}
        <Form.Check type="switch" id="toggle-has-stories" label="Has stories" checked={filterHasStories} onChange={(e) => setFilterHasStories(e.currentTarget.checked)} className="ms-2" />
        <Form.Check type="switch" id="toggle-in-sprint" label="In selected sprint" checked={filterInSelectedSprint} onChange={(e) => setFilterInSelectedSprint(e.currentTarget.checked)} className="ms-1" />
        <Form.Check type="switch" id="toggle-overlap-sprint" label="Overlaps sprint dates" checked={filterOverlapSelectedSprint} onChange={(e) => setFilterOverlapSelectedSprint(e.currentTarget.checked)} className="ms-1" />
        <div className="ms-2 d-flex align-items-center gap-2">
          <strong>Goals Roadmap</strong>
          {loading && <Badge bg="secondary">Loading…</Badge>}
          {financeOnTrack !== null && (
            <Badge bg={financeOnTrack ? 'success' : 'danger'}>{financeOnTrack ? 'Budget On Track' : 'Budget Over'}</Badge>
          )}
        </div>
      </div>

      <div
        ref={containerRef}
        className={`grv3-container ${isPanning ? 'panning' : ''}`}
        style={{ height: '72vh' }}
        onMouseDown={(e) => {
          // Enable background click-and-drag panning when not starting a bar drag
          const target = e.target as HTMLElement;
          const isBar = target.closest('.grv3-bar');
          const isHandle = target.closest('.grv3-resize');
          if (isBar || isHandle) return;
          const el = containerRef.current; if (!el) return;
          setIsPanning(true);
          const startX = e.clientX; const startLeft = el.scrollLeft;
          const onMove = (ev: MouseEvent) => { el.scrollLeft = startLeft - (ev.clientX - startX); };
          const onUp = () => { setIsPanning(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
          window.addEventListener('mousemove', onMove);
          window.addEventListener('mouseup', onUp);
        }}
      >
        {/* Header months + sticky left label */}
        <div className="grv3-header">
          <div className="position-relative" style={{ height: 36 }}>
            <div className="grv3-months" style={{ width: 260 + totalWidth }}>
              <div className="grv3-header-left">Themes</div>
              {gridLines.map((g, i) => (
                <div key={i} className="grv3-month" style={{ left: 260 + g.x }}>{g.label}</div>
              ))}
            </div>
          </div>
        </div>

        {/* Grid lines */}
        <div className="grv3-grid" style={{ width: totalWidth }}>
          {gridLines.map((g, i) => (<div key={i} className="grv3-grid-line" style={{ left: g.x }} />))}
        </div>

        {/* Today line */}
        <div className="grv3-today-line" style={{ left: 260 + xFromDate(new Date()) }} />

        {/* Snap guides during drag */}
        {guideXs.length > 0 && (
          <div className="grv3-guides" style={{ width: totalWidth }}>
            {guideXs.map((x, i) => (
              <div key={i} className={`grv3-guide ${activeGuideX === x ? 'active' : ''}`} style={{ left: x }} />
            ))}
          </div>
        )}

        {/* Sprint bands + labels on weeks/months */}
        {showSprints && (zoom === 'weeks' || zoom === 'months') && (
          <>
            {sprintOverlays.map((s, i) => (
              <div key={`band-${i}`} className="grv3-sprint-band" style={{ left: 260 + s.left, width: s.width }} />
            ))}
            <div className="grv3-sprints" style={{ width: totalWidth }}>
              {sprintOverlays.map((s, i) => (
                <div key={`label-${i}`} className="grv3-sprint-label" style={{ left: s.left, width: Math.max(54, s.width) }}>
                  {s.name}
                </div>
              ))}
            </div>
          </>
        )}

        {/* Theme rows */}
        <div style={{ position: 'relative', width: 260 + totalWidth }}>
          {themesList.map(t => {
            // Prepare timed goals for this theme
            const tg: { id: string; start: number; end: number; raw: Goal }[] = goals
              .filter(g => migrateThemeValue(g.theme) === t.id)
              .map(g => {
                const s = g.startDate ? new Date(g.startDate) : new Date();
                const e = g.endDate ? new Date(g.endDate) : new Date(Date.now()+86400000*90);
                s.setHours(0,0,0,0); e.setHours(0,0,0,0);
                return { id: g.id, start: s.getTime(), end: e.getTime(), raw: g };
              });
            if (!showEmptyThemes && tg.length === 0) return null;
            const laneAssign = computeLanes(tg);
            const laneCount = Math.max(0, ...Array.from(laneAssign.values()).map(v=>v)) + 1;
            const laneH = getLaneHeight();
            const rowMin = Math.max(laneH + 24, laneCount * (laneH + 8) + 16);
            return (
            <div key={t.id} className="grv3-theme-row" style={{ minHeight: rowMin }}>
              <div className="grv3-label d-flex align-items-center gap-2" style={{ color: t.color }}>
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'currentColor' }} />
                <span>{t.name}</span>
              </div>
              <div className="grv3-track" style={{ width: totalWidth, minHeight: rowMin }}>
                {goals.filter(g => migrateThemeValue(g.theme) === t.id).filter(applyFilters).map(g => {
                  // Culling: only render bars near viewport
                  const start = g.startDate ? new Date(g.startDate) : new Date();
                  const end = g.endDate ? new Date(g.endDate) : new Date(Date.now()+86400000*90);
                  const left = xFromDate(start); const width = Math.max(14, xFromDate(end) - left);
                  const buffer = 800; const visLeft = viewport.left; const visRight = viewport.left + viewport.width;
                  const barLeft = left; const barRight = left + width;
                  if (barRight < visLeft - buffer || barLeft > visRight + buffer) return null;
                  const lane = laneAssign.get(g.id) || 0;
                  const total = storyCounts[g.id] || 0;
                  const done = storyDoneCounts[g.id] || 0;
                  const pct = total ? Math.round((done/total)*100) : 0;
                  return (
                  <div
                    key={g.id}
                    data-grv3-goal={g.id}
                    className={`grv3-bar ${draggingId===g.id ? 'dragging' : ''}`}
                    style={{ left, width, height: laneH, top: 12 + lane*(laneH + 8), zIndex: hoveredId===g.id ? 1000 : undefined, ...barStyle(g) }}
                    title={`${g.title} — ${g.startDate ? new Date(g.startDate).toLocaleDateString() : ''} → ${g.endDate ? new Date(g.endDate).toLocaleDateString() : ''}${total ? ` • ${pct}%` : ''}`}
                    onPointerDown={(e) => startDrag(e, g, 'move')}
                    tabIndex={0}
                    onKeyDown={(e) => onKeyNudge(e, g)}
                    onMouseEnter={() => setHoveredId(g.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onDoubleClick={() => setShowGlobalActivity(true)}
                  >
                    <div className="grv3-resize start" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, g, 'start'); }} />
                    <div className="grv3-resize end" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, g, 'end'); }} />

                    <div className="grv3-actions">
                      <Dropdown align="end" onClick={(e) => e.stopPropagation()}>
                        <Dropdown.Toggle
                          size="sm"
                          variant="outline-light"
                          className="grv3-action-toggle"
                          aria-label="Open goal actions"
                        >
                          <MoreVertical size={16} />
                        </Dropdown.Toggle>
                        <Dropdown.Menu>
                          <Dropdown.Item onClick={(e) => { e.stopPropagation(); handleGenerateStories(g.id); }}>
                            <Wand2 size={14} className="me-2" />
                            Generate Stories
                          </Dropdown.Item>
                          <Dropdown.Item onClick={(e) => { e.stopPropagation(); showSidebar(g as any, 'goal'); }}>
                            <ListIcon size={14} className="me-2" />
                            Open Activity Stream
                          </Dropdown.Item>
                          <Dropdown.Item onClick={(e) => { e.stopPropagation(); setNoteGoalId(g.id); setNoteDraft(''); }}>
                            <MessageSquareText size={14} className="me-2" />
                            Add Note
                          </Dropdown.Item>
                          <Dropdown.Item onClick={(e) => { e.stopPropagation(); setEditGoal(g); }}>
                            <Edit3 size={14} className="me-2" />
                            Edit Goal
                          </Dropdown.Item>
                          <Dropdown.Divider />
                          <Dropdown.Item
                            className="text-danger"
                            onClick={async (e) => {
                              e.stopPropagation();
                              const ok = window.confirm(`Delete goal "${g.title}"? This cannot be undone.`);
                              if (ok) {
                                try {
                                  await deleteDoc(doc(db, 'goals', g.id));
                                } catch (err) {
                                  window.alert('Failed to delete goal: ' + (err as any)?.message);
                                }
                              }
                            }}
                          >
                            <Trash2 size={14} className="me-2" />
                            Delete Goal
                          </Dropdown.Item>
                        </Dropdown.Menu>
                      </Dropdown>
                    </div>

                    <div className="grv3-title">{g.title}</div>
                    <div className="grv3-meta">{g.startDate ? new Date(g.startDate).toLocaleDateString() : ''} – {g.endDate ? new Date(g.endDate).toLocaleDateString() : ''}{typeof storyCounts[g.id] === 'number' ? ` • ${storyCounts[g.id]} stories` : ''}</div>
                    {typeof storyCounts[g.id] === 'number' && storyCounts[g.id] > 0 && (
                      <div className="mt-1" style={{ width: '100%' }}>
                        <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,.3)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.round(((storyDoneCounts[g.id]||0) / storyCounts[g.id]) * 100)}%`, background: 'rgba(255,255,255,.9)' }} />
                        </div>
                        <div className="grv3-meta">{Math.round(((storyDoneCounts[g.id]||0) / storyCounts[g.id]) * 100)}%</div>
                      </div>
                    )}
                    {(zoom === 'weeks' || zoom === 'months') && (lastNotes[g.id] || (goals.find(x => x.id === g.id) as any)?.recentNote) && (
                      <div className="grv3-meta">📝 {lastNotes[g.id] || (goals.find(x => x.id === g.id) as any)?.recentNote}</div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip for drag */}
      <div ref={tooltipRef} className="grv3-tooltip" style={{ display: 'none' }} />

      {/* Activity Modal */}
      {/* Activity modal header adopts the goal theme color */}
      <Modal show={!!activityGoalId} onHide={() => setActivityGoalId(null)} size="lg">
        {(() => {
          const g = goals.find(x => x.id === activityGoalId);
          const themeId = migrateThemeValue(g?.theme ?? 0);
          const themeDef = getThemeDefinition(themeId);
          const colorVar = themeDef.color || '#6c757d';
          const overlay = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
          return (
            <Modal.Header closeButton style={{ ['--modal-color' as any]: String(colorVar), background: `linear-gradient(135deg, var(--modal-color) 0%, ${overlay} 100%)`, color: '#fff' }}>
              <Modal.Title>Activity Stream</Modal.Title>
            </Modal.Header>
          );
        })()}
        <Modal.Body>
          {activityItems.length === 0 ? (
            <div className="text-muted">No activity yet.</div>
          ) : (
            <ul className="list-group">
              {activityItems.map(a => (
                <li key={a.id} className="list-group-item">
                  <div className="small text-muted">{a.timestamp?.toDate?.().toLocaleString?.() || ''}</div>
                  <div>{a.description || a.activityType}</div>
                </li>
              ))}
            </ul>
          )}
        </Modal.Body>
      </Modal>

      {/* Add Note Modal */}
      <Modal show={!!noteGoalId} onHide={() => setNoteGoalId(null)}>
        <Modal.Header closeButton><Modal.Title>Add Note</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form.Group>
            <Form.Label>Note</Form.Label>
            <Form.Control as="textarea" rows={4} value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write a quick note for this goal" />
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setNoteGoalId(null)}>Cancel</Button>
          <Button variant="primary" onClick={handleAddNote} disabled={!noteDraft.trim()}>Save</Button>
        </Modal.Footer>
      </Modal>

      {/* Global Activity Modal */}
      <Modal show={showGlobalActivity} onHide={() => setShowGlobalActivity(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Global Activity</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {globalActivityItems.length === 0 ? (
            <div className="text-muted">No activity yet.</div>
          ) : (
            <ul className="list-group">
              {globalActivityItems.slice(0, 200).map(a => (
                <li key={a.id} className="list-group-item">
                  <div className="small text-muted">{a.timestamp?.toDate?.().toLocaleString?.() || ''}</div>
                  <div>{a.description || `${a.activityType} on ${a.entityType}`}</div>
                </li>
              ))}
            </ul>
          )}
        </Modal.Body>
      </Modal>

      {/* Edit Goal Modal */}
      {editGoal && (
        <EditGoalModal
          show={true}
          goal={editGoal as any}
          onClose={() => setEditGoal(null)}
          currentUserId={currentUser?.uid || ''}
        />
      )}
    </div>
  );
};

export default GoalRoadmapV3;
