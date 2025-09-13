import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { PlanAssignment } from '../types/scheduler';
import { startOfDay, endOfDay } from 'date-fns';

export interface ChecklistPanelProps {
  title?: string;
  compact?: boolean;
}

interface ChecklistItem {
  id: string;
  title: string;
  start?: number;
  end?: number;
  source: 'assignment' | 'task';
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
        as.forEach((doc) => {
          const a = doc.data() as any as PlanAssignment;
          list.push({ id: doc.id, title: a.title, start: a.start, end: a.end, source: 'assignment' });
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
        ts.forEach((doc) => {
          const t = doc.data() as any;
          list.push({ id: `task-${doc.id}` , title: t.title, start: t.dueDate, end: t.dueDate, source: 'task' });
        });

        setItems(list);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [currentUser, todayKey]);

  const now = Date.now();
  const nowNext = items
    .filter((i) => (i.start ?? now) <= now + 60 * 60 * 1000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  const later = items
    .filter((i) => (i.start ?? now) > now + 60 * 60 * 1000)
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  if (!currentUser) return null;

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
                  <small className="text-muted">{i.source === 'assignment' ? 'Planned' : 'Task'}</small>
                </div>
                <button className="btn btn-sm btn-outline-success">Done</button>
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
                  <small className="text-muted">{i.source === 'assignment' ? 'Planned' : 'Task'}</small>
                </div>
                <button className="btn btn-sm btn-outline-success">Done</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ChecklistPanel;

