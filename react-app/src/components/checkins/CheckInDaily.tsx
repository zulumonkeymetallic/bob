import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';
import { format, startOfDay, endOfDay } from 'date-fns';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { schedulerCollections, type ScheduledInstanceModel } from '../../domain/scheduler/repository';

type CheckInItemType = 'block' | 'instance';

interface DailyCheckInItem {
  key: string;
  type: CheckInItemType;
  title: string;
  theme?: string | null;
  sourceType?: string | null;
  start?: number | null;
  end?: number | null;
  durationMin?: number | null;
  storyId?: string | null;
  storyRef?: string | null;
  taskId?: string | null;
  taskRef?: string | null;
  goalId?: string | null;
  completed: boolean;
}

interface DailyCheckInDoc {
  id: string;
  ownerUid: string;
  dateKey: string;
  dateMs: number;
  items: DailyCheckInItem[];
  completedCount: number;
  plannedCount: number;
  createdAt?: any;
  updatedAt?: any;
}

const DAY_FORMAT = 'yyyyMMdd';

const CheckInDaily: React.FC = () => {
  const { currentUser } = useAuth();
  const [date, setDate] = useState<Date>(new Date());
  const [items, setItems] = useState<DailyCheckInItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dateKey = useMemo(() => format(date, DAY_FORMAT), [date]);
  const dayStart = useMemo(() => startOfDay(date), [date]);
  const dayEnd = useMemo(() => endOfDay(date), [date]);

  const loadPlannedItems = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const ownerUid = currentUser.uid;
      const blockQuery = query(
        collection(db, 'calendar_blocks'),
        where('ownerUid', '==', ownerUid),
        where('start', '>=', dayStart.getTime()),
        where('start', '<=', dayEnd.getTime()),
      );
      const [blocksSnap, instancesSnap] = await Promise.all([
        getDocs(blockQuery),
        getDocs(schedulerCollections.userInstancesRange(db, ownerUid, dateKey, dateKey)),
      ]);

      const blocks = blocksSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
        .filter((block) => {
          const source = String(block.source || '').toLowerCase();
          const entryMethod = String(block.entry_method || '').toLowerCase();
          return source !== 'gcal' && entryMethod !== 'google_calendar';
        });

      const instances = instancesSnap.docs.map((docSnap) => docSnap.data() as ScheduledInstanceModel);

      const taskIds = new Set<string>();
      const storyIds = new Set<string>();
      blocks.forEach((block) => {
        if (block.taskId) taskIds.add(String(block.taskId));
        if (block.storyId) storyIds.add(String(block.storyId));
      });

      const taskRefs = new Map<string, string>();
      const storyRefs = new Map<string, string>();

      await Promise.all([
        ...Array.from(taskIds).map(async (id) => {
          const snap = await getDoc(doc(db, 'tasks', id));
          if (!snap.exists()) return;
          const data = snap.data() as any;
          const ref = data.ref || data.reference || data.referenceNumber || data.code || id.slice(-6).toUpperCase();
          taskRefs.set(id, String(ref));
        }),
        ...Array.from(storyIds).map(async (id) => {
          const snap = await getDoc(doc(db, 'stories', id));
          if (!snap.exists()) return;
          const data = snap.data() as any;
          const ref = data.ref || data.reference || data.referenceNumber || data.code || id.slice(-6).toUpperCase();
          storyRefs.set(id, String(ref));
        }),
      ]);

      const blockItems: DailyCheckInItem[] = blocks.map((block) => {
        const start = Number(block.start || 0);
        const end = Number(block.end || 0);
        const durationMin = start && end ? Math.round((end - start) / 60000) : null;
        const storyId = block.storyId ? String(block.storyId) : null;
        const taskId = block.taskId ? String(block.taskId) : null;
        return {
          key: `block:${block.id}`,
          type: 'block',
          title: block.title || block.category || 'Planned block',
          theme: block.theme || block.subTheme || null,
          sourceType: block.category || null,
          start,
          end,
          durationMin,
          storyId,
          storyRef: storyId ? storyRefs.get(storyId) || null : null,
          taskId,
          taskRef: taskId ? taskRefs.get(taskId) || null : null,
          goalId: block.goalId ? String(block.goalId) : null,
          completed: false,
        };
      });

      const instanceItems: DailyCheckInItem[] = instances.map((instance) => {
        const start = instance.plannedStart ? new Date(instance.plannedStart).getTime() : null;
        const end = instance.plannedEnd ? new Date(instance.plannedEnd).getTime() : null;
        const durationMin = start && end ? Math.round((end - start) / 60000) : null;
        return {
          key: `instance:${instance.id}`,
          type: 'instance',
          title: instance.title || instance.sourceId || 'Planned item',
          theme: (instance as any).theme || (instance as any).sourceTheme || null,
          sourceType: instance.sourceType || null,
          start,
          end,
          durationMin,
          completed: instance.status === 'completed',
        };
      });

      const plannedItems = [...blockItems, ...instanceItems].sort((a, b) => {
        const aTime = a.start || 0;
        const bTime = b.start || 0;
        return aTime - bTime;
      });

      const existingSnap = await getDoc(doc(db, 'daily_checkins', `${ownerUid}_${dateKey}`));
      if (existingSnap.exists()) {
        const existing = existingSnap.data() as DailyCheckInDoc;
        const existingMap = new Map(existing.items.map((item) => [item.key, item]));
        const merged = plannedItems.map((item) => {
          const prev = existingMap.get(item.key);
          return prev ? { ...item, completed: prev.completed } : item;
        });
        setItems(merged);
      } else {
        setItems(plannedItems);
      }
    } catch (err) {
      console.error('Failed to load daily check-in data', err);
      setError('Unable to load planned items.');
    } finally {
      setLoading(false);
    }
  }, [currentUser, dateKey, dayEnd, dayStart]);

  useEffect(() => {
    loadPlannedItems();
  }, [loadPlannedItems]);

  const handleToggle = useCallback(async (item: DailyCheckInItem) => {
    setItems((prev) =>
      prev.map((entry) => (entry.key === item.key ? { ...entry, completed: !entry.completed } : entry)),
    );
    if (item.type === 'instance') {
      try {
        await updateDoc(doc(db, 'scheduled_instances', item.key.replace('instance:', '')), {
          status: item.completed ? 'planned' : 'completed',
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.warn('Failed to update instance status', err);
      }
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!currentUser) return;
    setSaving(true);
    try {
      const plannedCount = items.length;
      const completedCount = items.filter((i) => i.completed).length;
      const payload: DailyCheckInDoc = {
        id: `${currentUser.uid}_${dateKey}`,
        ownerUid: currentUser.uid,
        dateKey,
        dateMs: dayStart.getTime(),
        items,
        plannedCount,
        completedCount,
      };
      await setDoc(doc(db, 'daily_checkins', payload.id), {
        ...payload,
        updatedAt: new Date(),
        createdAt: new Date(),
      }, { merge: true });
    } catch (err) {
      console.error('Failed to save daily check-in', err);
      setError('Failed to save daily check-in.');
    } finally {
      setSaving(false);
    }
  }, [currentUser, dateKey, dayStart, items]);

  const completedCount = items.filter((i) => i.completed).length;

  return (
    <div className="p-3">
      <h3 className="mb-3">Daily Check-in</h3>
      <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
        <Form.Control
          type="date"
          value={format(date, 'yyyy-MM-dd')}
          onChange={(e) => setDate(new Date(e.target.value))}
          style={{ maxWidth: 200 }}
        />
        <Badge bg={completedCount === items.length && items.length > 0 ? 'success' : 'secondary'}>
          {completedCount}/{items.length} done
        </Badge>
        <Button variant="primary" onClick={handleSave} disabled={saving || loading}>
          {saving ? 'Saving…' : 'Submit check-in'}
        </Button>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted">
          <Spinner size="sm" animation="border" /> Loading planned items…
        </div>
      ) : items.length === 0 ? (
        <div className="text-muted">No planned items for this day.</div>
      ) : (
        <Row className="g-3">
          {items.map((item) => (
            <Col key={item.key} lg={6}>
              <Card className="h-100 shadow-sm border-0">
                <Card.Body className="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <div className="fw-semibold">{item.title}</div>
                    <div className="text-muted small">
                      {item.theme ? <span>{item.theme}</span> : null}
                      {item.storyRef ? <span className="ms-2">Story {item.storyRef}</span> : null}
                      {item.taskRef ? <span className="ms-2">Task {item.taskRef}</span> : null}
                    </div>
                    {item.start && item.end && (
                      <div className="text-muted small">
                        {new Date(item.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} –{' '}
                        {new Date(item.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    )}
                  </div>
                  <Form.Check
                    type="checkbox"
                    label="Done"
                    checked={item.completed}
                    onChange={() => handleToggle(item)}
                  />
                </Card.Body>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </div>
  );
};

export default CheckInDaily;
