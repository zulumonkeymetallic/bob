import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where, doc, updateDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { startOfDay, endOfDay } from 'date-fns';
import { httpsCallable } from 'firebase/functions';
import { nextDueAt } from '../utils/recurrence';
import { schedulerCollections, ScheduledInstanceModel } from '../domain/scheduler/repository';

export interface ChecklistPanelProps {
  title?: string;
  compact?: boolean;
}

interface ChecklistItem {
  id: string;
  title: string;
  start?: number;
  end?: number;
  source: 'scheduled' | 'unscheduled' | 'task' | 'chore' | 'habit';
  raw?: any;
  status?: string;
  subtitle?: string;
}

const ChecklistPanel: React.FC<ChecklistPanelProps> = ({ title = "Today's Checklist", compact }) => {
  const { currentUser } = useAuth();
  const [loadingScheduled, setLoadingScheduled] = useState(true);
  const [loadingLoose, setLoadingLoose] = useState(true);
  const [scheduled, setScheduled] = useState<ScheduledInstanceModel[]>([]);
  const [looseItems, setLooseItems] = useState<ChecklistItem[]>([]);

  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London', []);

  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const todayKey = useMemo(() => todayIso.replace(/-/g, ''), [todayIso]);

  useEffect(() => {
    if (!currentUser) {
      setScheduled([]);
      setLoadingScheduled(false);
      return; 
    }
    setLoadingScheduled(true);
    const unsubscribe = onSnapshot(
      schedulerCollections.userInstances(db, currentUser.uid, todayKey),
      (snapshot) => {
        const docs = snapshot.docs.map((docSnap) => docSnap.data());
        setScheduled(docs);
        setLoadingScheduled(false);
      },
      () => setLoadingScheduled(false),
    );
    return () => unsubscribe();
  }, [currentUser, todayKey, todayIso]);

  useEffect(() => {
    if (!currentUser) {
      setLooseItems([]);
      setLoadingLoose(false);
      return;
    }
    const loadLoose = async () => {
      setLoadingLoose(true);
      try {
        const list: ChecklistItem[] = [];
    const start = startOfDay(new Date(todayIso)).getTime();
    const end = endOfDay(new Date(todayIso)).getTime();

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
          list.push({ id: `task-${d.id}`, title: t.title, start: t.dueDate, end: t.dueDate, source: 'task', raw: { id: d.id, ...t } });
        });

        const choresRef = collection(db, 'chores');
        const cq = query(choresRef, where('ownerUid', '==', currentUser.uid));
        const cs = await getDocs(cq);
        cs.forEach((d) => {
          const c = d.data() as any;
          const dtstart = c.dtstart || c.createdAt || undefined;
          const next = nextDueAt(c.rrule, typeof dtstart === 'number' ? dtstart : undefined, start);
          const due = next || c.nextDueAt;
          if (due && due >= start && due <= end) {
            list.push({ id: `chore-${d.id}`, title: c.title || 'Chore', start: due, end: due, source: 'chore', raw: { id: d.id, ...c, computedNext: due } });
          }
        });

        const habitsSnap = await getDocs(query(collection(db, 'habits'), where('userId', '==', currentUser.uid), where('isActive', '==', true)));
        for (const hDoc of habitsSnap.docs) {
          const h: any = hDoc.data();
          if (h.frequency === 'daily') {
            list.push({ id: `habit-${hDoc.id}`, title: h.name, source: 'habit', raw: { id: hDoc.id, ...h } });
          }
        }

        setLooseItems(list);
      } finally {
        setLoadingLoose(false);
      }
    };
    loadLoose();
  }, [currentUser, todayKey]);

  useEffect(() => {
    if (!currentUser) return;
    const key = `planBuilt-${todayKey}-${currentUser.uid}`;
    if (!localStorage.getItem(key)) {
      (async () => {
        try {
          const call = httpsCallable(functions, 'planBlocksV2');
        await call({ startDate: todayIso, days: 1, timezone });
        } catch (err) {
          console.warn('Failed to build schedule preview', err);
        }
        localStorage.setItem(key, '1');
      })();
    }
  }, [currentUser, todayKey, todayIso, timezone]);

  const scheduledItems: ChecklistItem[] = useMemo(() => {
    const now = Date.now();
    return scheduled
      .filter((inst) => ['planned', 'committed', 'in_progress', 'unscheduled'].includes(inst.status))
      .map((inst) => {
        const startMs = inst.plannedStart ? Date.parse(inst.plannedStart) : undefined;
        const endMs = inst.plannedEnd ? Date.parse(inst.plannedEnd) : undefined;
        const overdue = inst.status === 'unscheduled' || (!startMs && !endMs);
        const label = inst.title || (inst.sourceType === 'chore' ? 'Chore' : 'Routine');
        const subtitlePieces: string[] = [];
        if (inst.blockId) subtitlePieces.push(`Block ${inst.blockId}`);
        if (inst.status === 'unscheduled') {
          subtitlePieces.push(inst.statusReason || 'Waiting for block');
        }
        return {
          id: inst.id,
          title: label,
          start: startMs ?? (overdue ? now + 12 * 60 * 60 * 1000 : undefined),
          end: endMs,
          source: inst.status === 'unscheduled' ? 'unscheduled' : 'scheduled',
          raw: inst,
          status: inst.status,
          subtitle: subtitlePieces.join(' · ') || undefined,
        } as ChecklistItem;
      });
  }, [scheduled]);

  const items = useMemo(() => {
    return [...scheduledItems, ...looseItems];
  }, [scheduledItems, looseItems]);

  const loading = loadingScheduled || loadingLoose;

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
      if (item.source === 'scheduled' || item.source === 'unscheduled') {
        const ref = doc(db, `scheduled_instances/${item.id}`);
        await updateDoc(ref, { status: 'completed', statusUpdatedAt: Date.now(), updatedAt: Date.now() });
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
      if (item.source === 'scheduled' || item.source === 'unscheduled') {
        setScheduled(prev => prev.filter(inst => inst.id !== item.id));
      } else {
        setLooseItems(prev => prev.filter(i => i.id !== item.id));
      }
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
                <small className="text-muted">{i.subtitle || (i.source === 'scheduled' ? 'Scheduled' : i.source === 'unscheduled' ? 'Needs block' : i.source === 'task' ? 'Task' : i.source === 'chore' ? 'Chore' : 'Habit')}</small>
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
                  <small className="text-muted">{i.subtitle || (i.source === 'scheduled' ? 'Scheduled' : i.source === 'unscheduled' ? 'Needs block' : i.source === 'task' ? 'Task' : i.source === 'chore' ? 'Chore' : 'Habit')}</small>
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
