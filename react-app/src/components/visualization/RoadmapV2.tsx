import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button, ButtonGroup, Badge } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { collection, onSnapshot, query, where, updateDoc, doc } from 'firebase/firestore';
import { db } from '../../firebase';
import { Goal } from '../../types';
import './RoadmapV2.css';

type Zoom = 'weeks' | 'months' | 'quarters' | 'years';

const THEMES = [
  { id: 1, name: 'Health & Fitness', color: 'var(--theme-health-primary)', bg: 'var(--theme-health-primary)' },
  { id: 2, name: 'Growth & Learning', color: 'var(--theme-growth-primary)', bg: 'var(--theme-growth-primary)' },
  { id: 3, name: 'Finance & Wealth', color: 'var(--theme-wealth-primary)', bg: 'var(--theme-wealth-primary)' },
  { id: 4, name: 'Tribe & Social', color: 'var(--theme-tribe-primary)', bg: 'var(--theme-tribe-primary)' },
  { id: 5, name: 'Home & Lifestyle', color: 'var(--theme-home-primary)', bg: 'var(--theme-home-primary)' },
];

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }

export default function RoadmapV2() {
  const { currentUser } = useAuth();
  const { theme } = useTheme();

  const [zoom, setZoom] = useState<Zoom>('quarters');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  // Time window: one year back, two years forward
  const timeRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear() - 1, 0, 1);
    const end = new Date(now.getFullYear() + 2, 11, 31);
    start.setHours(0,0,0,0); end.setHours(0,0,0,0);
    return { start, end };
  }, []);

  // Scale mapping
  const pxPerDay = useMemo(() => {
    switch (zoom) {
      case 'weeks': return 12;     // detailed
      case 'months': return 4;     // medium
      case 'quarters': return 1.8; // default
      case 'years': return 0.8;    // overview
      default: return 1.8;
    }
  }, [zoom]);

  const containerRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Subscribe to goals for current user
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

  // Helpers to convert date <-> x position
  const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);
  const xFromDate = (date: Date) => daysBetween(timeRange.start, date) * pxPerDay;
  const dateFromX = (x: number) => {
    const d = new Date(timeRange.start);
    d.setDate(d.getDate() + Math.round(x / pxPerDay));
    d.setHours(0,0,0,0);
    return d;
  };

  // Scroll to near today on mount/zoom change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const today = new Date();
    const left = 250 + xFromDate(today) - el.clientWidth * 0.35;
    el.scrollLeft = clamp(left, 0, el.scrollWidth);
  }, [zoom, goals.length]);

  // Draw lightweight grid lines for months/quarters/years
  const gridLines = useMemo(() => {
    const out: { label: string; x: number }[] = [];
    const { start, end } = timeRange;
    const cursor = new Date(start);
    cursor.setDate(1);
    while (cursor <= end) {
      let label = '';
      if (zoom === 'weeks' || zoom === 'months') {
        label = `${cursor.toLocaleString('default', { month: 'short' })} ${cursor.getFullYear()}`;
      } else if (zoom === 'quarters') {
        const q = Math.floor(cursor.getMonth() / 3) + 1;
        label = `Q${q} ${cursor.getFullYear()}`;
      } else {
        label = `${cursor.getFullYear()}`;
      }

      const x = xFromDate(new Date(cursor));
      out.push({ label, x });

      // Advance cursor
      if (zoom === 'weeks') cursor.setMonth(cursor.getMonth() + 1);
      else if (zoom === 'months') cursor.setMonth(cursor.getMonth() + 1);
      else if (zoom === 'quarters') cursor.setMonth(cursor.getMonth() + 3);
      else cursor.setFullYear(cursor.getFullYear() + 1);
    }
    return out;
  }, [timeRange, pxPerDay, zoom]);

  // Drag/Resize state
  const dragState = useRef<{
    id: string | null;
    type: 'move' | 'start' | 'end' | null;
    startX: number;
    origStart: Date;
    origEnd: Date;
  }>({ id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() });

  const pointerMove = useCallback((ev: PointerEvent) => {
    const s = dragState.current;
    if (!s.id || !s.type) return;
    ev.preventDefault();
    const dx = ev.clientX - s.startX;
    const deltaDays = Math.round(dx / pxPerDay);
    let newStart = new Date(s.origStart);
    let newEnd = new Date(s.origEnd);
    if (s.type === 'move') {
      newStart.setDate(newStart.getDate() + deltaDays);
      newEnd.setDate(newEnd.getDate() + deltaDays);
    } else if (s.type === 'start') {
      newStart.setDate(newStart.getDate() + deltaDays);
      if (newStart > newEnd) newStart = new Date(newEnd);
    } else if (s.type === 'end') {
      newEnd.setDate(newEnd.getDate() + deltaDays);
      if (newEnd < newStart) newEnd = new Date(newStart);
    }

    // Snap to days
    newStart.setHours(0,0,0,0); newEnd.setHours(0,0,0,0);

    // Update DOM position directly for perf
    const el = document.querySelector(`[data-rmv2-goal="${s.id}"]`) as HTMLElement | null;
    if (el) {
      const left = xFromDate(newStart);
      const right = xFromDate(newEnd);
      el.style.left = `${left}px`;
      el.style.width = `${Math.max(14, right - left)}px`;
    }
    // Tooltip
    const tip = tooltipRef.current;
    if (tip) {
      tip.style.display = 'block';
      tip.style.left = `${ev.clientX + 8}px`;
      tip.style.top = `${ev.clientY + 8}px`;
      tip.textContent = `${newStart.toLocaleDateString()} → ${newEnd.toLocaleDateString()}`;
    }
  }, [pxPerDay, xFromDate]);

  const pointerUp = useCallback(async (ev: PointerEvent) => {
    const s = dragState.current;
    if (!s.id || !s.type) return;
    ev.preventDefault();
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('pointerup', pointerUp);

    const el = document.querySelector(`[data-rmv2-goal="${s.id}"]`) as HTMLElement | null;
    if (!el) { dragState.current = { id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() }; return; }
    const left = parseFloat(el.style.left || '0');
    const width = parseFloat(el.style.width || '0');
    let newStart = dateFromX(left);
    let newEnd = dateFromX(left + width);
    newStart.setHours(0,0,0,0); newEnd.setHours(0,0,0,0);

    try {
      await updateDoc(doc(db, 'goals', s.id), {
        startDate: newStart.getTime(),
        endDate: newEnd.getTime(),
        updatedAt: Date.now()
      });
    } catch (e) {
      console.error('Failed to update goal dates', e);
    } finally {
      const tip = tooltipRef.current; if (tip) tip.style.display = 'none';
      dragState.current = { id: null, type: null, startX: 0, origStart: new Date(), origEnd: new Date() };
    }
  }, [dateFromX, pointerMove]);

  const startDrag = useCallback((ev: React.PointerEvent, goal: Goal, type: 'move'|'start'|'end') => {
    ev.preventDefault();
    const startDate = goal.startDate ? new Date(goal.startDate) : new Date();
    const endDate = goal.endDate ? new Date(goal.endDate) : (goal.targetDate ? new Date(goal.targetDate) : new Date(Date.now()+86400000*90));
    dragState.current = { id: goal.id, type, startX: ev.clientX, origStart: startDate, origEnd: endDate };
    document.addEventListener('pointermove', pointerMove, { passive: false });
    document.addEventListener('pointerup', pointerUp, { passive: false });
  }, [pointerMove, pointerUp]);

  // Render helpers
  const barStyle = (g: Goal): React.CSSProperties => {
    const start = g.startDate ? new Date(g.startDate) : (g.targetDate ? new Date(g.targetDate) : new Date());
    const end = g.endDate ? new Date(g.endDate) : (g.targetDate ? new Date(g.targetDate) : new Date(Date.now()+86400000*90));
    const left = xFromDate(start);
    const width = Math.max(14, xFromDate(end) - left);
    const theme = THEMES.find(t => t.id === g.theme);
    const color = theme?.color || '#6c757d';
    const grad = `linear-gradient(135deg, var(--goal-color, ${color}) 0%, rgba(0,0,0,0.12) 100%)`;
    return {
      left, width,
      background: grad,
      borderColor: 'rgba(0,0,0,0.12)'
    } as React.CSSProperties;
  };

  const zoomClass = useMemo(() => {
    if (zoom === 'years') return 'rmv2-zoom-ultra';
    if (zoom === 'quarters') return 'rmv2-zoom-slim';
    return '';
  }, [zoom]);

  // Derived layout width
  const totalWidth = useMemo(() => {
    const days = daysBetween(timeRange.start, timeRange.end);
    return Math.max(1200, Math.round(days * pxPerDay));
  }, [timeRange, pxPerDay]);

  const themes = THEMES;

  return (
    <div className={`roadmapv2 ${zoomClass}`}>
      <div className="rmv2-toolbar d-flex align-items-center justify-content-between p-2">
        <div className="d-flex align-items-center gap-2">
          <strong>Roadmap Timeline</strong>
          {loading && <Badge bg="secondary">Loading…</Badge>}
        </div>
        <ButtonGroup size="sm">
          <Button variant={zoom==='weeks'? 'primary':'outline-primary'} onClick={() => setZoom('weeks')}>Weeks</Button>
          <Button variant={zoom==='months'? 'primary':'outline-primary'} onClick={() => setZoom('months')}>Months</Button>
          <Button variant={zoom==='quarters'? 'primary':'outline-primary'} onClick={() => setZoom('quarters')}>Quarters</Button>
          <Button variant={zoom==='years'? 'primary':'outline-primary'} onClick={() => setZoom('years')}>Years</Button>
        </ButtonGroup>
      </div>

      <div ref={containerRef} className="rmv2-container" style={{ height: '70vh' }}>
        {/* Header */}
        <div className="rmv2-header">
          <div className="position-relative" style={{ height: 40 }}>
            <div className="rmv2-months" style={{ width: 250 + totalWidth }}>
              {/* labels column spacer */}
              <div style={{ width: 250 }} />
              {/* month/quarter/year labels */}
              {gridLines.map((g, idx) => (
                <div key={idx} className="rmv2-month" style={{ left: 250 + g.x }}>
                  {g.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Grid lines below header */}
        <div ref={gridRef} className="rmv2-grid" style={{ width: totalWidth }}>
          {gridLines.map((g, idx) => (
            <div key={idx} className="rmv2-grid-line" style={{ left: g.x }} />
          ))}
        </div>

        {/* Rows per theme */}
        <div style={{ position: 'relative', width: 250 + totalWidth }}>
          {themes.map(t => (
            <div key={t.id} className="rmv2-theme-row">
              <div className="rmv2-label d-flex align-items-center gap-2">
                <span style={{ width: 10, height: 10, borderRadius: 9999, background: 'currentColor', color: 'var(--panel-text)' }} />
                <span>{t.name}</span>
              </div>
              <div className="rmv2-track" style={{ width: totalWidth }}>
                {goals.filter(g => g.theme === t.id).map(g => (
                  <div
                    key={g.id}
                    data-rmv2-goal={g.id}
                    className="rmv2-bar"
                    style={barStyle(g)}
                    onPointerDown={(e) => startDrag(e, g, 'move')}
                  >
                    <div className="rmv2-resize start" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, g, 'start'); }} />
                    <div className="rmv2-resize end" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, g, 'end'); }} />
                    <div className="rmv2-bar-title">{g.title}</div>
                    <div className="rmv2-bar-meta">
                      {g.startDate ? new Date(g.startDate).toLocaleDateString() : ''} – {g.endDate ? new Date(g.endDate).toLocaleDateString() : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Drag tooltip */}
      <div ref={tooltipRef} className="rmv2-tooltip" style={{ display: 'none' }} />
    </div>
  );
}

