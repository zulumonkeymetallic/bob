/**
 * AddToCalendarWidget — quick-schedule panel for the Overview dashboard.
 * Shows today's unscheduled top-priority items with a "schedule" button,
 * plus a quick-add form to create manual calendar_block entries.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Form, Spinner } from 'react-bootstrap';
import {
  addDoc,
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  limit,
} from 'firebase/firestore';
import { CalendarPlus, Clock, Plus } from 'lucide-react';
import { db } from '../../firebase';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';

const pad = (n: number) => String(n).padStart(2, '0');

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTimeStr() {
  const d = new Date();
  const h = d.getHours();
  const m = Math.ceil(d.getMinutes() / 15) * 15;
  return `${pad(h)}:${pad(m >= 60 ? 0 : m)}`;
}

function addHour(time: string) {
  const [h, m] = time.split(':').map(Number);
  const endH = h + 1 >= 24 ? 23 : h + 1;
  return `${pad(endH)}:${pad(m)}`;
}

function toMs(dateStr: string, timeStr: string) {
  return new Date(`${dateStr}T${timeStr}`).getTime();
}

const AddToCalendarWidget: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const [stories, setStories] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [todayBlocks, setTodayBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayDateStr());
  const [startTime, setStartTime] = useState(nowTimeStr());
  const [endTime, setEndTime] = useState(addHour(nowTimeStr()));
  const titleRef = useRef<HTMLInputElement>(null);

  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime();
  }, []);
  const todayEnd = useMemo(() => {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime();
  }, []);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) return;
    const q = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', 'in', [0, 1, '0', '1', 'backlog', 'in-progress', 'in_progress']),
      limit(100),
    );
    return onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a: any, b: any) => (b.aiCriticalityScore ?? 0) - (a.aiCriticalityScore ?? 0));
      setStories(rows);
      setLoading(false);
    }, () => { setStories([]); setLoading(false); });
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) return;
    const q = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', 'in', [0, 1, '0', '1', 'backlog', 'in-progress']),
      limit(100),
    );
    return onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      rows.sort((a: any, b: any) => (b.aiCriticalityScore ?? 0) - (a.aiCriticalityScore ?? 0));
      setTasks(rows);
    }, () => setTasks([]));
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', todayStart),
      where('start', '<=', todayEnd),
    );
    return onSnapshot(q, snap => setTodayBlocks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), () => setTodayBlocks([]));
  }, [currentUser?.uid, todayStart, todayEnd]);

  const scheduledStoryIds = useMemo(() => new Set(todayBlocks.map(b => b.storyId).filter(Boolean)), [todayBlocks]);
  const scheduledTaskIds  = useMemo(() => new Set(todayBlocks.map(b => b.taskId).filter(Boolean)),  [todayBlocks]);

  const unscheduledItems = useMemo(() => {
    const items: Array<{ id: string; kind: 'story' | 'task'; title: string; ref?: string; score?: number }> = [];
    for (const s of stories.slice(0, 10)) {
      if (!scheduledStoryIds.has(s.id)) {
        items.push({ id: s.id, kind: 'story', title: s.title || 'Untitled', ref: s.ref, score: s.aiCriticalityScore });
      }
    }
    for (const t of tasks.slice(0, 5)) {
      if (!scheduledTaskIds.has(t.id)) {
        items.push({ id: t.id, kind: 'task', title: t.title || 'Untitled', ref: t.ref, score: t.aiCriticalityScore });
      }
    }
    return items.slice(0, 8);
  }, [stories, tasks, scheduledStoryIds, scheduledTaskIds]);

  const handleScheduleItem = async (item: typeof unscheduledItems[0]) => {
    if (!currentUser?.uid) return;
    const now = new Date();
    const startMs = toMs(todayDateStr(), nowTimeStr());
    const endMs   = startMs + 60 * 60 * 1000;
    await addDoc(collection(db, 'calendar_blocks'), {
      ownerUid: currentUser.uid,
      title: item.title,
      start: startMs,
      end: endMs,
      source: 'manual',
      entry_method: 'manual',
      persona: currentPersona,
      ...(item.kind === 'story' ? { storyId: item.id } : { taskId: item.id }),
      createdAt: serverTimestamp(),
    });
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !currentUser?.uid) return;
    setSaving(true);
    try {
      await addDoc(collection(db, 'calendar_blocks'), {
        ownerUid: currentUser.uid,
        title: title.trim(),
        start: toMs(date, startTime),
        end: toMs(date, endTime),
        source: 'manual',
        entry_method: 'manual',
        persona: currentPersona,
        createdAt: serverTimestamp(),
      });
      setTitle('');
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm border-0 h-100">
      <Card.Header className="d-flex align-items-center justify-content-between">
        <div className="fw-semibold d-flex align-items-center gap-2">
          <CalendarPlus size={15} />
          Add to Calendar
        </div>
        <Button
          size="sm"
          variant={showForm ? 'secondary' : 'outline-primary'}
          style={{ padding: '2px 8px', fontSize: '0.75rem' }}
          onClick={() => {
            setShowForm(v => !v);
            if (!showForm) setTimeout(() => titleRef.current?.focus(), 50);
          }}
        >
          <Plus size={12} className="me-1" />
          Quick add
        </Button>
      </Card.Header>
      <Card.Body className="p-2">
        {showForm && (
          <Form onSubmit={handleQuickAdd} className="mb-3 p-2 rounded" style={{ background: 'var(--bs-light-bg-subtle, #f8f9fa)' }}>
            <Form.Control
              ref={titleRef}
              size="sm"
              placeholder="Event title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="mb-2"
            />
            <div className="d-flex gap-2 mb-2">
              <Form.Control
                size="sm"
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
            <div className="d-flex gap-2 align-items-center mb-2">
              <Form.Control
                size="sm"
                type="time"
                value={startTime}
                onChange={e => { setStartTime(e.target.value); setEndTime(addHour(e.target.value)); }}
              />
              <span className="text-muted small">→</span>
              <Form.Control
                size="sm"
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
              />
            </div>
            <Button type="submit" size="sm" variant="primary" disabled={saving || !title.trim()} className="w-100">
              {saving ? <Spinner size="sm" animation="border" /> : 'Add block'}
            </Button>
          </Form>
        )}

        {/* Today's schedule count */}
        {todayBlocks.length > 0 && (
          <div className="d-flex align-items-center gap-2 mb-2 px-1">
            <Clock size={12} className="text-muted" />
            <span className="small text-muted">{todayBlocks.length} block{todayBlocks.length !== 1 ? 's' : ''} scheduled today</span>
          </div>
        )}

        {/* Unscheduled priority items */}
        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small p-1">
            <Spinner size="sm" animation="border" /> Loading…
          </div>
        ) : unscheduledItems.length === 0 ? (
          <div className="text-muted small p-1">All priority items are scheduled for today.</div>
        ) : (
          <div>
            <div
              className="text-muted fw-semibold text-uppercase mb-1 px-1"
              style={{ fontSize: '0.65rem', letterSpacing: '0.04em' }}
            >
              Unscheduled priorities
            </div>
            <div className="d-flex flex-column gap-1">
              {unscheduledItems.map(item => (
                <div
                  key={item.id}
                  className="d-flex align-items-center gap-2 px-1 py-1 rounded"
                  style={{ minWidth: 0 }}
                >
                  <Badge
                    bg={item.kind === 'story' ? 'primary' : 'secondary'}
                    pill
                    style={{ fontSize: '0.6rem', flexShrink: 0 }}
                  >
                    {item.kind === 'story' ? 'ST' : 'TK'}
                  </Badge>
                  <span className="small text-truncate flex-grow-1" title={item.title}>
                    {item.ref ? <span className="text-muted me-1">{item.ref}</span> : null}
                    {item.title}
                  </span>
                  <Button
                    size="sm"
                    variant="outline-primary"
                    style={{ padding: '1px 6px', fontSize: '0.7rem', flexShrink: 0 }}
                    onClick={() => handleScheduleItem(item)}
                  >
                    + Now
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card.Body>
    </Card>
  );
};

export default AddToCalendarWidget;
