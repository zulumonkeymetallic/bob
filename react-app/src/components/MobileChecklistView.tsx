import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { PlanAssignment } from '../types/scheduler';
import { startOfDay, endOfDay } from 'date-fns';

interface ChecklistItem {
  id: string;
  title: string;
  start?: number;
  end?: number;
  source: 'assignment' | 'task';
}

const MobileChecklistView: React.FC = () => {
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
        const items: ChecklistItem[] = [];

        // Assignments for today, if any
        const assignmentsRef = collection(db, `plans/${todayKey}/assignments`);
        const aq = query(assignmentsRef, where('ownerUid', '==', currentUser.uid));
        const as = await getDocs(aq);
        as.forEach((doc) => {
          const a = doc.data() as any as PlanAssignment;
          items.push({ id: doc.id, title: a.title, start: a.start, end: a.end, source: 'assignment' });
        });

        // Also include tasks due today as loose items
        const start = startOfDay(new Date()).getTime();
        const end = endOfDay(new Date()).getTime();
        const tasksRef = collection(db, 'tasks');
        // Note: dueDate may be missing; we only pull those within today
        const tq = query(
          tasksRef,
          where('ownerUid', '==', currentUser.uid),
          where('dueDate', '>=', start),
          where('dueDate', '<=', end),
        );
        const ts = await getDocs(tq);
        ts.forEach((doc) => {
          const t = doc.data() as any;
          items.push({ id: `task-${doc.id}` , title: t.title, start: t.dueDate, end: t.dueDate, source: 'task' });
        });

        setItems(items);
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

  if (!currentUser) {
    return <div className="p-3">Please sign in to view your checklist.</div>;
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ height: '60vh' }}>
        <div className="text-center">
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading today&apos;s items…</p>
        </div>
      </div>
    );
  }

  const Section: React.FC<{ title: string; data: ChecklistItem[] }> = ({ title, data }) => (
    <div className="mb-4">
      <h5 className="mb-3">{title}</h5>
      {data.length === 0 && <div className="text-muted">Nothing here</div>}
      {data.map((i) => (
        <div key={i.id} className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
          <div className="d-flex flex-column">
            <span className="fw-semibold">{i.title}</span>
            <small className="text-muted">{i.source === 'assignment' ? 'Planned' : 'Task'}</small>
          </div>
          <button className="btn btn-sm btn-outline-success">Done</button>
        </div>
      ))}
    </div>
  );

  return (
    <div className="container py-3" style={{ maxWidth: 720 }}>
      <h4 className="mb-3">Today</h4>
      <div className="row">
        <div className="col-12 col-md-6">
          <Section title="Now / Next" data={nowNext} />
        </div>
        <div className="col-12 col-md-6">
          <Section title="Later Today" data={later} />
        </div>
      </div>
    </div>
  );
};

export default MobileChecklistView;

