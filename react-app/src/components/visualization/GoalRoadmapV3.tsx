import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonGroup, Modal, Form, Badge } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, onSnapshot, query, where, updateDoc, doc, orderBy, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../firebase';
import { Goal, Sprint } from '../../types';
import { ActivityStreamService } from '../../services/ActivityStreamService';
import { Wand2, List as ListIcon, BookOpen, MessageSquareText, Edit3, ZoomIn, ZoomOut, Home } from 'lucide-react';
import './GoalRoadmapV3.css';

type Zoom = 'weeks' | 'months' | 'quarters' | 'years';

const THEMES = [
  { id: 1, name: 'Health & Fitness', color: 'var(--theme-health-primary)' },
  { id: 2, name: 'Growth & Learning', color: 'var(--theme-growth-primary)' },
  { id: 3, name: 'Finance & Wealth', color: 'var(--theme-wealth-primary)' },
  { id: 4, name: 'Tribe & Social', color: 'var(--theme-tribe-primary)' },
  { id: 5, name: 'Home & Lifestyle', color: 'var(--theme-home-primary)' },
];

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

const GoalRoadmapV3: React.FC = () => {
  const { currentUser } = useAuth();
  const { theme } = useTheme();

  const [zoom, setZoom] = useState<Zoom>('quarters');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activityGoalId, setActivityGoalId] = useState<string | null>(null);
  const [activityItems, setActivityItems] = useState<any[]>([]);
  const [noteGoalId, setNoteGoalId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [lastNotes, setLastNotes] = useState<Record<string, string>>({});
  const [storyCounts, setStoryCounts] = useState<Record<string, number>>({});
  const [showSprints, setShowSprints] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);

  // Viewport culling state
  const [viewport, setViewport] = useState<{ left: number; width: number }>({ left: 0, width: 1200 });

  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const timeRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() + 2, 11, 31);
    start.setHours(0,0,0,0); end.setHours(0,0,0,0);
    return { start, end };
  }, []);

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

  // Subscribe to stories to compute counts per goal (lightweight aggregate)
  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
    const unsub = onSnapshot(q, (snap) => {
      const counts: Record<string, number> = {};
      for (const d of snap.docs) {
        const story = d.data() as any;
        const gid = story.goalId as string | undefined;
        if (gid) counts[gid] = (counts[gid] || 0) + 1;
      }
      setStoryCounts(counts);
    });
    return () => unsub();
  }, [currentUser?.uid]);

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
      where('entityType', '==', 'goal'),
      where('activityType', '==', 'note_added'),
      orderBy('timestamp', 'desc'),
      limit(300)
    );
    const unsub = onSnapshot(q, (snap) => {
      const map: Record<string, string> = {};
      for (const d of snap.docs) {
        const data = d.data() as any;
        const gid = data.entityId as string;
        if (!map[gid] && data.noteContent) {
          map[gid] = String(data.noteContent);
        }
      }
      setLastNotes(map);
    });
    return () => unsub();
  }, [currentUser?.uid]);

  // Activity stream subscription per selected goal
  useEffect(() => {
    if (!activityGoalId) return;
    const unsub = ActivityStreamService.subscribeToActivityStream(activityGoalId, setActivityItems);
    return () => unsub();
  }, [activityGoalId]);

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

  // Drag+resize implementation
  const dragState = useRef<{ id: string|null; type: 'move'|'start'|'end'|null; startX: number; origStart: Date; origEnd: Date }>({ id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() });
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
  }, [pxPerDay, xFromDate]);

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
    finally { const tip = tooltipRef.current; if (tip) tip.style.display='none'; dragState.current = { id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() }; }
  }, [dateFromX, pointerMove, currentUser?.uid]);

  const startDrag = useCallback((ev: React.PointerEvent, goal: Goal, type: 'move'|'start'|'end') => {
    ev.preventDefault();
    const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
    const endDate = goal.endDate ? new Date(goal.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now()+86400000*90));
    dragState.current = { id: goal.id, type, startX: ev.clientX, origStart: startDate, origEnd: endDate };
    document.addEventListener('pointermove', pointerMove, { passive: false }); document.addEventListener('pointerup', pointerUp, { passive: false });
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

  const barStyle = (g: Goal): React.CSSProperties => {
    const start = g.startDate ? new Date(g.startDate) : (g.targetDate ? new Date(g.targetDate) : new Date());
    const end = g.endDate ? new Date(g.endDate) : (g.targetDate ? new Date(g.targetDate) : new Date(Date.now()+86400000*90));
    const left = xFromDate(start); const width = Math.max(14, xFromDate(end) - left);
    const themeDef = THEMES.find(t => t.id === g.theme);
    const baseColorVar = themeDef?.color || '#6c757d'; // e.g., var(--theme-health-primary)
    const overlay = theme === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)';
    // Inherit theme color via CSS var; apply subtle gradient that adapts to theme
    return {
      left,
      width,
      background: `linear-gradient(135deg, var(--goal-color, ${baseColorVar}) 0%, ${overlay} 100%)`,
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

  return (
    <div className={`grv3 ${zoomClass}`}>
      <div className="grv3-toolbar d-flex align-items-center justify-content-start p-2 gap-2">
        {/* Sticky zoom controls on the top-left */}
        <Button size="sm" variant="outline-secondary" onClick={() => setZoom(p => p==='years'?'years':(p==='quarters'?'months':(p==='months'?'weeks':'weeks')))} aria-label="Zoom In"><ZoomIn size={14} /></Button>
        <Button size="sm" variant="outline-secondary" onClick={() => setZoom(p => p==='weeks'?'weeks':(p==='months'?'quarters':(p==='quarters'?'years':'years')))} aria-label="Zoom Out"><ZoomOut size={14} /></Button>
        <Button size="sm" variant="outline-secondary" onClick={() => { const el = containerRef.current; if (!el) return; const left = 260 + xFromDate(new Date()) - el.clientWidth * .35; el.scrollLeft = clamp(left, 0, el.scrollWidth); }} aria-label="Jump to Today"><Home size={14} /></Button>
        <Button size="sm" variant="outline-secondary" onClick={() => containerRef.current?.requestFullscreen?.()}>Full Screen</Button>
        <Form.Check type="switch" id="toggle-sprints" label="Sprints" checked={showSprints} onChange={(e) => setShowSprints(e.currentTarget.checked)} className="ms-2" />
        <Form.Check type="switch" id="toggle-snap" label="Snap" checked={snapEnabled} onChange={(e) => setSnapEnabled(e.currentTarget.checked)} className="ms-1" />
        <div className="ms-2 d-flex align-items-center gap-2">
          <strong>Goal Roadmap V3</strong>
          {loading && <Badge bg="secondary">Loading…</Badge>}
        </div>
      </div>

      <div ref={containerRef} className="grv3-container" style={{ height: '72vh' }}>
        {/* Header months */}
        <div className="grv3-header">
          <div className="position-relative" style={{ height: 36 }}>
            <div className="grv3-months" style={{ width: 260 + totalWidth }}>
              <div style={{ width: 260 }} />
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
          {THEMES.map(t => (
            <div key={t.id} className="grv3-theme-row">
              <div className="grv3-label d-flex align-items-center gap-2">
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'currentColor', color: 'var(--bs-body-color)' }} />
                <span>{t.name}</span>
              </div>
              <div className="grv3-track" style={{ width: totalWidth }}>
                {goals.filter(g => g.theme === t.id).map(g => {
                  // Culling: only render bars near viewport
                  const start = g.startDate ? new Date(g.startDate) : new Date();
                  const end = g.endDate ? new Date(g.endDate) : new Date(Date.now()+86400000*90);
                  const left = xFromDate(start); const width = Math.max(14, xFromDate(end) - left);
                  const buffer = 800; const visLeft = viewport.left; const visRight = viewport.left + viewport.width;
                  const barLeft = left; const barRight = left + width;
                  if (barRight < visLeft - buffer || barLeft > visRight + buffer) return null;
                  return (
                  <div
                    key={g.id}
                    data-grv3-goal={g.id}
                    className="grv3-bar"
                    style={{ left, width, ...barStyle(g) }}
                    onPointerDown={(e) => startDrag(e, g, 'move')}
                    tabIndex={0}
                    onKeyDown={(e) => onKeyNudge(e, g)}
                  >
                    <div className="grv3-resize start" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, g, 'start'); }} />
                    <div className="grv3-resize end" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, g, 'end'); }} />

                    <div className="grv3-actions">
                      <button className="grv3-action" title="Generate stories" aria-label="Generate stories" onClick={(e) => { e.stopPropagation(); handleGenerateStories(g.id); }}><Wand2 size={14} /></button>
                      {/* Activity stream icon (matches V2 intent) */}
                      <button className="grv3-action" title="Activity stream" aria-label="Activity stream" onClick={(e) => { e.stopPropagation(); setActivityGoalId(g.id); }}><ListIcon size={14} /></button>
                      <button className="grv3-action" title="Add note" aria-label="Add note" onClick={(e) => { e.stopPropagation(); setNoteGoalId(g.id); setNoteDraft(''); }}><MessageSquareText size={14} /></button>
                    </div>

                    <div className="grv3-title">{g.title}</div>
                    <div className="grv3-meta">{g.startDate ? new Date(g.startDate).toLocaleDateString() : ''} – {g.endDate ? new Date(g.endDate).toLocaleDateString() : ''}{typeof storyCounts[g.id] === 'number' ? ` • ${storyCounts[g.id]} stories` : ''}</div>
                    {(zoom === 'weeks' || zoom === 'months') && (lastNotes[g.id] || (goals.find(x => x.id === g.id) as any)?.recentNote) && (
                      <div className="grv3-meta">📝 {lastNotes[g.id] || (goals.find(x => x.id === g.id) as any)?.recentNote}</div>
                    )}
                  </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tooltip for drag */}
      <div ref={tooltipRef} className="grv3-tooltip" style={{ display: 'none' }} />

      {/* Activity Modal */}
      {/* Activity modal header adopts the goal theme color */}
      <Modal show={!!activityGoalId} onHide={() => setActivityGoalId(null)} size="lg">
        {(() => {
          const g = goals.find(x => x.id === activityGoalId);
          const themeDef = THEMES.find(t => t.id === (g?.theme || 0));
          const colorVar = themeDef?.color || '#6c757d';
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
    </div>
  );
};

export default GoalRoadmapV3;
