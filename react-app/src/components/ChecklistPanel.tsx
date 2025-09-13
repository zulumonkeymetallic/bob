import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
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
  source: 'assignment' | 'task' | 'chore';
  raw?: any;
}

const ChecklistPanel: React.FC<ChecklistPanelProps> = ({ title = "Today's Checklist", compact }) => {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChecklistItem[]>([]);

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

        setItems(list);
      } finally {
        setLoading(false);
      }
    };
    // Ensure today's plan is built once per user/day
    const ensurePlan = async () => {
      if (!currentUser) return;
      const key = `planBuilt-${todayKey}-${currentUser.uid}`;
      if (!localStorage.getItem(key)) {
        try {
          const call = httpsCallable(functions, 'buildPlan');
          await call({ day: `${new Date().toISOString().slice(0,10)}` });
        } catch {}
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
    </div>
  );
};

export default ChecklistPanel;
