import React, { useEffect, useMemo, useState } from 'react';
import { Toast } from 'react-bootstrap';
import { collection, getDocs, query, where, doc, updateDoc, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { PlanAssignment } from '../types/scheduler';
import { startOfDay, endOfDay } from 'date-fns';
import { httpsCallable } from 'firebase/functions';
import { nextDueAt } from '../utils/recurrence';

export interface ChecklistPanelProps {
  title?: string;
  compact?: boolean;
}

interface ChecklistItem {
  id: string;
  title: string;
  start?: number;
  end?: number;
  source: 'assignment' | 'task' | 'chore' | 'habit';
  raw?: any;
}

const ChecklistPanel: React.FC<ChecklistPanelProps> = ({ title = "Today's Checklist", compact }) => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [toast, setToast] = useState<{ show: boolean; title: string; body: string; variant: 'success'|'danger'|'warning' }>({ show: false, title: '', body: '', variant: 'success' });

  const todayKey = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = `${now.getMonth() + 1}`.padStart(2, '0');
    const d = `${now.getDate()}`.padStart(2, '0');
    return `${y}${m}${d}`;
  }, []);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      setLoading(true);
      try {
        const list: ChecklistItem[] = [];

        // Assignments for today, if any
        const assignmentsRef = collection(db, `plans/${todayKey}/assignments`);
        const aq = query(assignmentsRef, where('ownerUid', '==', currentUser.uid));
        const as = await getDocs(aq);
        as.forEach((d) => {
          const a = d.data() as any as PlanAssignment;
          list.push({ id: d.id, title: a.title, start: a.start, end: a.end, source: 'assignment', raw: a });
        });

        // Also include tasks due today as loose items
        const start = startOfDay(new Date()).getTime();
        const end = endOfDay(new Date()).getTime();
        const tasksRef = collection(db, 'tasks');
        const tq = query(
          tasksRef,
          where('ownerUid', '==', currentUser.uid),
          where('dueDate', '>=', start),
          where('dueDate', '<=', end),
        );
        const ts = await getDocs(tq);
        ts.forEach((d) => {
          const t = d.data() as any;
          list.push({ id: `task-${d.id}` , title: t.title, start: t.dueDate, end: t.dueDate, source: 'task', raw: { id: d.id, ...t } });
        });

        // Chores due today (using RRULE)
        const choresRef = collection(db, 'chores');
        const cq = query(choresRef, where('ownerUid', '==', currentUser.uid));
        const cs = await getDocs(cq);
        cs.forEach((d) => {
          const c = d.data() as any;
          const dtstart = c.dtstart || c.createdAt || undefined;
          // Compute next due based on rrule; fall back to existing nextDueAt
          const next = nextDueAt(c.rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
          const due = next || c.nextDueAt;
          if (due && due >= start && due <= end) {
            list.push({ id: `chore-${d.id}`, title: c.title || 'Chore', start: due, end: due, source: 'chore', raw: { id: d.id, ...c, computedNext: due } });
          }
        });

        // Habits due today (daily & active)
        const habitsSnap = await getDocs(query(collection(db, 'habits'), where('userId','==', currentUser.uid), where('isActive','==', true)));
        const now = new Date();
        const todayStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
        for (const hDoc of habitsSnap.docs) {
          const h: any = hDoc.data();
          if (h.frequency === 'daily') {
            // check entry
            list.push({ id: `habit-${hDoc.id}`, title: h.name, start: undefined, end: undefined, source: 'habit', raw: { id: hDoc.id, ...h } });
          }
        }

        setItems(list);
      } finally {
        setLoading(false);
      }
    };
    // Ensure today's plan is built once per user/day
    const ensurePlan = async () => {
      if (!currentUser) return;
      const key = `planBuilt-${todayKey}-${currentUser.uid}`;
      if (localStorage.getItem(key)) return;
      try {
        // Force-refresh ID token to avoid unauthenticated preflight edge cases
        try { await currentUser.getIdToken(true); } catch {}
        const call = httpsCallable(functions, 'buildPlan');
        await call({ day: `${new Date().toISOString().slice(0,10)}` });
        setToast({ show: true, title: "Plan built", body: "Today's plan has been created.", variant: 'success' });
        // Attempt to sync assignments to Google Calendar as well (best-effort)
        try {
          const sync = httpsCallable(functions, 'syncPlanToGoogleCalendar');
          await sync({ day: `${new Date().toISOString().slice(0,10)}` });
        } catch (e) {
          console.warn('syncPlanToGoogleCalendar failed', e);
        }
      } catch (e) {
        console.error('buildPlan failed', e);
        const msg = (e as any)?.message || 'Unknown error';
        // setToast({ show: true, title: 'Planner failed', body: msg, variant: 'danger' });
      } finally {
        localStorage.setItem(key, '1');
      }
    };
    ensurePlan().finally(load);
  }, [currentUser, todayKey]);

  const now = Date.now();
  const nowNext = items
    .filter((i) => (i.start ?? now) <= now + 60 * 60 * 1000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const later = items
    .filter((i) => (i.start ?? now) > now + 60 * 60 * 1000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  if (!currentUser) return null;

  const markDone = async (item: ChecklistItem) => {
    try {
      if (item.source === 'assignment') {
        const dayKey = todayKey;
        const ref = doc(db, `plans/${dayKey}/assignments/${item.id}`);
        await updateDoc(ref, { status: 'done', updatedAt: Date.now() });
      } else if (item.source === 'task') {
        const id = item.raw?.id || item.id.replace('task-', '');
        await updateDoc(doc(db, 'tasks', id), { status: 2, updatedAt: Date.now() });
      } else if (item.source === 'chore') {
        const chore = item.raw || {};
        const id = chore.id || item.id.replace('chore-', '');
        const now = Date.now();
        const next = nextDueAt(chore.rrule, chore.dtstart, now + 60000);
        await updateDoc(doc(db, 'chores', id), { lastCompletedAt: now, nextDueAt: next || null, updatedAt: now });
      } else if (item.source === 'habit') {
        const h = item.raw || {};
        const entryId = todayKey;
        await updateDoc(doc(db, `habits/${h.id}/habitEntries/${entryId}`), { isCompleted: true, updatedAt: Date.now() }).catch(async () => {
          await setDoc(doc(db, `habits/${h.id}/habitEntries/${entryId}`), {
            id: entryId, habitId: h.id, date: new Date().setHours(0,0,0,0), value: 1, isCompleted: true, createdAt: Date.now(), updatedAt: Date.now()
          });
        });
      }
      // Optimistic remove from UI
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) {
      console.error('Failed to mark done', e);
      alert('Failed to mark done');
    }
  };

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h5 className="mb-0">{title}</h5>
      </div>
      {loading ? (
        <div className="text-muted small">Loading…</div>
      ) : (
        <div className={`row ${compact ? '' : 'g-3'}`}>
          <div className="col-12 col-md-6">
            <h6 className="text-muted">Now / Next</h6>
            {nowNext.length === 0 && <div className="text-muted small">Nothing pending</div>}
            {nowNext.map(i => (
              <div key={i.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
              <div className="d-flex flex-column">
                <span className="fw-semibold">{i.title}</span>
                <small className="text-muted">{i.source === 'assignment' ? 'Planned' : i.source === 'task' ? 'Task' : 'Chore'}</small>
              </div>
              <button className="btn btn-sm btn-outline-success" onClick={() => markDone(i)}>Done</button>
              </div>
            ))}
          </div>
          <div className="col-12 col-md-6">
            <h6 className="text-muted">Later Today</h6>
            {later.length === 0 && <div className="text-muted small">Nothing later</div>}
            {later.map(i => (
              <div key={i.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
                <div className="d-flex flex-column">
                  <span className="fw-semibold">{i.title}</span>
                  <small className="text-muted">{i.source === 'assignment' ? 'Planned' : i.source === 'task' ? 'Task' : 'Chore'}</small>
                </div>
                <button className="btn btn-sm btn-outline-success" onClick={() => markDone(i)}>Done</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toast notifications */}
      <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 1060, minWidth: 280 }}>
        <Toast
          bg={toast.variant === 'success' ? 'success' : toast.variant === 'danger' ? 'danger' : 'warning'}
          onClose={() => setToast(t => ({ ...t, show: false }))}
          show={toast.show}
          delay={4500}
          autohide
        >
          <Toast.Header closeButton>
            <strong className="me-auto">{toast.title}</strong>
          </Toast.Header>
          <Toast.Body className="text-white">{toast.body}</Toast.Body>
        </Toast>
      </div>
    </div>
  );
};

export default ChecklistPanel;
