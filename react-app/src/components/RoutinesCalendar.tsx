import React, { useEffect, useMemo, useState } from 'react';
import { Calendar as RBC, Views, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { Badge, Button, Card, Form, Toast, ToastContainer, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { collection, getDocs, query, where, doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { rrulestr } from 'rrule';
import { nextDueAt } from '../utils/recurrence';
import { Link } from 'react-router-dom';

const locales = { 'en-GB': enGB } as any;
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), getDay, locales });
const DnDCalendar = withDragAndDrop(RBC as any);

interface RbcEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'habit' | 'chore';
  theme?: number;
}

function toDateAtTime(date: Date, hhmm?: string): Date {
  const d = new Date(date);
  const [hh, mm] = String(hhmm || '07:00').split(':').map(x => Number(x));
  d.setHours(hh || 7, mm || 0, 0, 0);
  return d;
}

const THEME_COLORS: Record<number, string> = {
  1: '#22c55e', // Health
  2: '#3b82f6', // Growth
  3: '#eab308', // Wealth
  4: '#8b5cf6', // Tribe
  5: '#f97316', // Home
};

const legendColorFor = (type: 'habit' | 'chore') => (type === 'habit' ? '#16a34a' : '#3b82f6');
const bgColorForEvent = (ev: RbcEvent) => (ev.type === 'chore' && ev.theme && THEME_COLORS[ev.theme]) || legendColorFor(ev.type);

const RoutinesCalendar: React.FC = () => {
  const { currentUser } = useAuth();
  const [range, setRange] = useState<{ start: Date; end: Date }>({
    start: new Date(new Date().setDate(1)),
    end: new Date(new Date(new Date().setDate(1)).setMonth(new Date().getMonth() + 1))
  });
  const [showHabits, setShowHabits] = useState(true);
  const [showChores, setShowChores] = useState(true);
  const [events, setEvents] = useState<RbcEvent[]>([]);
  const [habitsById, setHabitsById] = useState<Record<string, any>>({});
  const [choresById, setChoresById] = useState<Record<string, any>>({});
  const [toast, setToast] = useState<{ show: boolean; msg: string; variant?: 'success' | 'info' | 'warning' | 'danger' }>({ show: false, msg: '' });

  useEffect(() => {
    if (!currentUser) return;
    const load = async () => {
      const evs: RbcEvent[] = [];

      // Load habits
      if (showHabits) {
        const hs = await getDocs(query(collection(db, 'habits'), where('userId', '==', currentUser.uid), where('isActive', '==', true)));
        const hmap: Record<string, any> = {};
        for (const d of hs.docs) {
          const h: any = { id: d.id, ...(d.data() || {}) };
          hmap[h.id] = h;
          const minutes = 15;
          const day = new Date(range.start);
          while (day <= range.end) {
            const dow = day.getDay(); // 0=Sun
            const include = (h.frequency || 'daily') === 'daily' || ((h.frequency || '') === 'weekly' && Array.isArray(h.daysOfWeek) && h.daysOfWeek.includes(dow));
            if (include) {
              const startAt = toDateAtTime(day, h.scheduleTime);
              const endAt = new Date(startAt.getTime() + minutes * 60000);
              if (startAt >= range.start && startAt <= range.end) {
                evs.push({ id: `H-${h.id}-${startAt.getTime()}`, title: h.name || 'Habit', start: startAt, end: endAt, type: 'habit' });
              }
            }
            day.setDate(day.getDate() + 1);
          }
        }
        setHabitsById(hmap);
      }

      // Load chores and expand occurrences
      if (showChores) {
        const cs = await getDocs(query(collection(db, 'chores'), where('ownerUid', '==', currentUser.uid)));
        const cmap: Record<string, any> = {};
        for (const d of cs.docs) {
          const c: any = { id: d.id, ...(d.data() || {}) };
          cmap[c.id] = c;
          if (!c.rrule) continue;
          try {
            const hasDt = /DTSTART/i.test(String(c.rrule || ''));
            const text = !hasDt && c.dtstart
              ? `DTSTART:${new Date(c.dtstart).toISOString().replace(/[-:]/g, '').split('.')[0]}Z\n${c.rrule}`
              : c.rrule;
            const rule = rrulestr(text);
            const between = rule.between(range.start, range.end, true) || [];
            const minutes = Number(c.estimatedMinutes) || 15;
            for (const occ of between) {
              const startAt = new Date(occ.getTime());
              const endAt = new Date(startAt.getTime() + minutes * 60000);
              evs.push({ id: `C-${c.id}-${startAt.getTime()}`, title: c.title || 'Chore', start: startAt, end: endAt, type: 'chore', theme: Number(c.theme) || undefined });
            }
          } catch {}
        }
        setChoresById(cmap);
      }

      // Sort and set
      evs.sort((a, b) => a.start.getTime() - b.start.getTime());
      setEvents(evs);
    };
    load();
  }, [currentUser, range.start.getTime(), range.end.getTime(), showHabits, showChores]);

  const onNavigate = (date: Date) => {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    const end = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    setRange({ start, end });
  };

  const onRangeChange = (r: any) => {
    if (Array.isArray(r) && r.length) {
      // week/day views provide array of dates
      const start = new Date(r[0]);
      const end = new Date(r[r.length - 1]);
      end.setHours(23, 59, 59, 999);
      setRange({ start, end });
    } else if (r && r.start && r.end) {
      setRange({ start: new Date(r.start), end: new Date(r.end) });
    }
  };

  const toDayKey = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${dd}`;
  };

  const onSelectEvent = async (ev: RbcEvent) => {
    if (!currentUser) return;
    try {
      if (ev.type === 'habit') {
        // Mark habit as completed for that day
        const habit = habitsById[ev.id.split('-')[1]] || null; // ev.id like H-<id>-<time>
        const parts = ev.id.split('-');
        const habitId = habit?.id || (parts[0] === 'H' ? parts[1] : undefined);
        if (!habitId) return;
        const dayKey = toDayKey(ev.start);
        const ref = doc(db, `habits/${habitId}/habitEntries/${dayKey}`);
        await setDoc(ref, {
          id: dayKey,
          habitId,
          date: new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate()).getTime(),
          value: 1,
          isCompleted: true,
          notes: '',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }, { merge: true });
        setToast({ show: true, msg: 'Habit marked done for the day', variant: 'success' });
      } else if (ev.type === 'chore') {
        // Advance chore nextDueAt from this occurrence
        const parts = ev.id.split('-');
        const choreId = parts[0] === 'C' ? parts[1] : undefined;
        if (!choreId) return;
        const chore = choresById[choreId];
        if (!chore) return;
        const newNext = nextDueAt(chore.rrule, chore.dtstart || chore.createdAt || undefined, ev.start.getTime() + 1000);
        await updateDoc(doc(db, 'chores', choreId), {
          nextDueAt: newNext || null,
          updatedAt: serverTimestamp(),
        });
        setToast({ show: true, msg: 'Chore occurrence completed', variant: 'success' });
      }
    } catch (e) {
      console.warn('RoutinesCalendar onSelectEvent failed:', (e as any)?.message);
    }
  };

  const onEventDrop = async ({ event, start, end }: any) => {
    if (!currentUser) return;
    try {
      if (event.type === 'habit') {
        const parts = event.id.split('-');
        const habitId = parts[0] === 'H' ? parts[1] : undefined;
        if (!habitId) return;
        const hh = String(new Date(start).getHours()).padStart(2, '0');
        const mm = String(new Date(start).getMinutes()).padStart(2, '0');
        await updateDoc(doc(db, 'habits', habitId), { scheduleTime: `${hh}:${mm}`, updatedAt: serverTimestamp() });
        // reflect immediately
        setEvents(prev => prev.map(ev => ev.id === event.id ? { ...ev, start: new Date(start), end: new Date(end) } : ev));
        setToast({ show: true, msg: `Habit time set to ${hh}:${mm}`, variant: 'info' });
      } else if (event.type === 'chore') {
        const parts = event.id.split('-');
        const choreId = parts[0] === 'C' ? parts[1] : undefined;
        if (!choreId) return;
        const newDtstart = new Date(start).getTime();
        const chore = choresById[choreId];
        const newNext = nextDueAt(chore.rrule, newDtstart, Date.now());
        await updateDoc(doc(db, 'chores', choreId), { dtstart: newDtstart, nextDueAt: newNext || null, updatedAt: serverTimestamp() });
        setEvents(prev => prev.map(ev => ev.id === event.id ? { ...ev, start: new Date(start), end: new Date(end) } : ev));
        setToast({ show: true, msg: 'Chore recurrence re-anchored', variant: 'info' });
      }
    } catch (e) {
      console.warn('RoutinesCalendar onEventDrop failed:', (e as any)?.message);
    }
  };

  return (
    <div className="container py-3" style={{ maxWidth: 1100 }}>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Routines Calendar</h4>
        <div className="d-flex align-items-center gap-2">
          <Link to="/habits" className="btn btn-outline-secondary btn-sm">Manage Habits</Link>
          <Link to="/chores" className="btn btn-outline-secondary btn-sm">Manage Chores</Link>
        </div>
      </div>

      <Card className="mb-2" style={{ border: '1px solid var(--notion-border)' }}>
        <Card.Body className="d-flex align-items-center gap-3">
          <Form.Check
            type="switch"
            id="toggle-habits"
            label="Show Habits"
            checked={showHabits}
            onChange={(e) => setShowHabits(e.target.checked)}
          />
          <Form.Check
            type="switch"
            id="toggle-chores"
            label="Show Chores"
            checked={showChores}
            onChange={(e) => setShowChores(e.target.checked)}
          />
          <div className="ms-auto d-flex align-items-center gap-3">
            <span className="d-inline-flex align-items-center gap-1"><span style={{ width: 10, height: 10, background: legendColorFor('habit'), display: 'inline-block', borderRadius: 2 }} /> Habits</span>
            <span className="d-inline-flex align-items-center gap-1"><span style={{ width: 10, height: 10, background: legendColorFor('chore'), display: 'inline-block', borderRadius: 2 }} /> Chores</span>
          </div>
        </Card.Body>
      </Card>

      <div className="bg-white" style={{ border: '1px solid var(--notion-border)', borderRadius: 6 }}>
        <DnDCalendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          defaultView={Views.MONTH}
          views={[Views.MONTH, Views.WEEK, Views.DAY]}
          style={{ height: 650 }}
          onNavigate={onNavigate}
          onRangeChange={onRangeChange}
          onSelectEvent={onSelectEvent}
          onEventDrop={onEventDrop}
          resizable
          onEventResize={onEventDrop as any}
          components={{
            event: ({ event }: any) => (
              <OverlayTrigger placement="top" overlay={<Tooltip>{event.type === 'habit' ? 'Click to mark done · Drag to change time' : 'Click to complete occurrence · Drag to re-anchor'}</Tooltip>}>
                <div style={{ color: 'white' }}>{event.title}</div>
              </OverlayTrigger>
            )
          }}
          eventPropGetter={(ev: any) => ({ style: { backgroundColor: bgColorForEvent(ev as RbcEvent), borderRadius: 6, border: 'none' } })}
        />
      </div>
      <ToastContainer position="bottom-end" className="p-3">
        <Toast bg={toast.variant || 'light'} onClose={() => setToast({ ...toast, show: false })} show={toast.show} delay={1800} autohide>
          <Toast.Body className={toast.variant === 'warning' || toast.variant === 'danger' ? 'text-white' : ''}>{toast.msg}</Toast.Body>
        </Toast>
      </ToastContainer>
    </div>
  );
};

export default RoutinesCalendar;
