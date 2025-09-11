import React, { useEffect, useMemo, useState } from 'react';
import { Calendar as RBC, Views, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enGB } from 'date-fns/locale';
import { Container, Button, Modal, Form, Badge } from 'react-bootstrap';
import { httpsCallable } from 'firebase/functions';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, orderBy, getDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CalendarBlock } from '../types';
import { GlobalTheme, GLOBAL_THEMES } from '../constants/globalThemes';
import { getContrastTextColor } from '../hooks/useThemeAwareColors';

const locales = { 'en-GB': enGB } as any;
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), getDay, locales });
const DnDCalendar = withDragAndDrop(RBC as any);

interface RbcEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  source?: 'block' | 'google';
  block?: CalendarBlock;
}

const DEFAULT_THEME_COLORS: Record<string, string> = {
  Health: '#22c55e',
  Growth: '#3b82f6',
  Wealth: '#eab308',
  Tribe: '#8b5cf6',
  Home: '#f97316'
};

const CalendarDnDView: React.FC = () => {
  const { currentUser } = useAuth();
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [googleEvents, setGoogleEvents] = useState<RbcEvent[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createRange, setCreateRange] = useState<{ start: Date; end: Date } | null>(null);
  const [createForm, setCreateForm] = useState({
    title: 'Block',
    theme: 'Health',
    category: 'Fitness',
    flexibility: 'soft' as CalendarBlock['flexibility'],
    rationale: ''
  });
  const [editBlock, setEditBlock] = useState<CalendarBlock | null>(null);
  const [editForm, setEditForm] = useState({
    title: 'Block',
    theme: 'Health',
    category: 'Fitness',
    flexibility: 'soft' as CalendarBlock['flexibility'],
    rationale: '',
    start: '',
    end: ''
  });
  const [globalThemes, setGlobalThemes] = useState<GlobalTheme[]>(GLOBAL_THEMES);

  // Load user-defined global themes (for colors + labels)
  useEffect(() => {
    const loadThemes = async () => {
      if (!currentUser) return;
      try {
        const ref = doc(db, 'global_themes', currentUser.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data() as any;
          if (Array.isArray(data.themes) && data.themes.length) {
            setGlobalThemes(data.themes as GlobalTheme[]);
          }
        }
      } catch (e) {
        console.warn('CalendarDnDView: failed to load global themes', (e as any)?.message);
      }
    };
    loadThemes();
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      orderBy('start', 'asc')
    );
    const unsub = onSnapshot(q, (snap) => {
      const rows = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as CalendarBlock[];
      setBlocks(rows);
    });
    return unsub;
  }, [currentUser]);

  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        setLoadingGoogle(true);
        const callable = httpsCallable(functions, 'listUpcomingEvents');
        const res: any = await callable({ maxResults: 50 });
        const items: RbcEvent[] = (res?.data?.items || []).map((e: any) => ({
          id: e.id,
          title: e.summary || 'Untitled',
          start: new Date(e.start?.dateTime || e.start?.date),
          end: new Date(e.end?.dateTime || e.end?.date),
          source: 'google'
        }));
        setGoogleEvents(items);
      } catch (e) {
        console.warn('Google events load failed', (e as any)?.message);
      } finally {
        setLoadingGoogle(false);
      }
    };
    load();
  }, [currentUser]);

  const events: RbcEvent[] = useMemo(() => {
    const blockEvents: RbcEvent[] = blocks.map((b) => ({
      id: b.id,
      title: `${b.category || 'Block'} (${b.theme})`,
      start: new Date(b.start),
      end: new Date(b.end),
      source: 'block',
      block: b
    }));
    return [...googleEvents, ...blockEvents];
  }, [blocks, googleEvents]);

  const handleSelectSlot = ({ start, end }: { start: Date; end: Date }) => {
    setCreateRange({ start, end });
    // Default theme to user's first configured theme, else Health
    const defaultTheme = globalThemes?.[0]?.label || 'Health';
    setCreateForm({ title: 'Block', theme: defaultTheme, category: 'Fitness', flexibility: 'soft', rationale: '' });
    setShowCreate(true);
  };

  const createBlock = async () => {
    if (!currentUser || !createRange) return;
    const payload: Partial<CalendarBlock> = {
      persona: 'personal',
      theme: createForm.theme as any,
      category: createForm.category as any,
      start: createRange.start.getTime(),
      end: createRange.end.getTime(),
      flexibility: createForm.flexibility,
      status: 'applied',
      createdBy: 'user',
      rationale: createForm.rationale,
      version: 1,
      ownerUid: currentUser.uid,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    await addDoc(collection(db, 'calendar_blocks'), payload);
    setShowCreate(false);
  };

  const handleEventDrop = async ({ event, start, end }: any) => {
    // Only allow moving our blocks
    if (event.source !== 'block') return;
    try {
      await updateDoc(doc(db, 'calendar_blocks', event.id), {
        start: start.getTime(),
        end: end.getTime(),
        updatedAt: Date.now()
      });
    } catch (e) {
      console.error('Failed to move block', e);
      alert('Failed to move block');
    }
  };

  const handleEventResize = async ({ event, start, end }: any) => {
    if (event.source !== 'block') return;
    try {
      await updateDoc(doc(db, 'calendar_blocks', event.id), {
        start: start.getTime(),
        end: end.getTime(),
        updatedAt: Date.now()
      });
    } catch (e) {
      console.error('Failed to resize block', e);
      alert('Failed to resize block');
    }
  };

  const handleSelectEvent = (evt: RbcEvent) => {
    if (evt.source === 'google') return; // read-only overlay
    const b = evt.block!;
    setEditBlock(b);
    setEditForm({
      title: `${b.category || 'Block'} (${b.theme})`,
      theme: b.theme,
      category: b.category || '',
      flexibility: b.flexibility,
      rationale: b.rationale || '',
      start: new Date(b.start).toISOString().slice(0, 16),
      end: new Date(b.end).toISOString().slice(0, 16)
    });
  };

  const saveEditBlock = async () => {
    if (!editBlock) return;
    try {
      await updateDoc(doc(db, 'calendar_blocks', editBlock.id), {
        start: new Date(editForm.start).getTime(),
        end: new Date(editForm.end).getTime(),
        category: editForm.category,
        theme: editForm.theme as any,
        flexibility: editForm.flexibility,
        rationale: editForm.rationale,
        updatedAt: Date.now()
      });
      setEditBlock(null);
    } catch (e) {
      console.error('Failed to update block', e);
      alert('Failed to update block');
    }
  };

  const deleteBlock = async () => {
    if (!editBlock) return;
    if (!window.confirm('Delete this calendar block?')) return;
    try {
      await deleteDoc(doc(db, 'calendar_blocks', editBlock.id));
      setEditBlock(null);
    } catch (e) {
      console.error('Failed to delete block', e);
      alert('Failed to delete block');
    }
  };

  const eventPropGetter = (evt: RbcEvent) => {
    if (evt.source === 'google') {
      return { style: { backgroundColor: '#cfe6ff', color: '#0b3b74', border: '1px solid #84b6f4' } };
    }
    const themeLabel = evt.block?.theme || 'Health';
    const themeMatch = globalThemes.find(t => t.label === themeLabel || t.name === themeLabel);
    const bg = themeMatch?.color || DEFAULT_THEME_COLORS[themeLabel] || '#64748b';
    const tx = getContrastTextColor(bg);
    return { style: { backgroundColor: bg, color: tx, border: 'none' } };
  };

  if (!currentUser) {
    return <div className="p-4">Please sign in to view your calendar.</div>;
  }

  return (
    <Container fluid className="p-3">
      <div className="d-flex justify-content-between align-items-center mb-2">
        <h2 className="mb-0">Calendar</h2>
        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => window.location.reload()} disabled={loadingGoogle}>
            {loadingGoogle ? 'Loading Google…' : 'Reload Google Events'}
          </Button>
        </div>
      </div>
      <DnDCalendar
        localizer={localizer}
        events={events}
        defaultView={Views.WEEK}
        views={[Views.DAY, Views.WEEK, Views.MONTH]}
        step={30}
        timeslots={2}
        selectable
        resizable
        onSelectSlot={handleSelectSlot as any}
        onEventDrop={handleEventDrop as any}
        onEventResize={handleEventResize as any}
        onSelectEvent={handleSelectEvent as any}
        style={{ height: 'calc(100vh - 160px)' }}
        eventPropGetter={eventPropGetter as any}
      />

      {/* Create Block Modal */}
      <Modal show={showCreate} onHide={() => setShowCreate(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create Block</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {createRange && (
            <div className="mb-2">
              <Badge bg="secondary">{createRange.start.toLocaleString()} → {createRange.end.toLocaleString()}</Badge>
            </div>
          )}
          <Form>
            <Form.Group className="mb-2">
              <Form.Label>Title (category)</Form.Label>
              <Form.Control value={createForm.category} onChange={(e)=>setCreateForm({...createForm, category: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={createForm.theme} onChange={(e)=>setCreateForm({...createForm, theme: e.target.value})}>
                {globalThemes.map(t => (
                  <option key={t.id} value={t.label}>{t.label}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Flexibility</Form.Label>
              <Form.Select value={createForm.flexibility} onChange={(e)=>setCreateForm({...createForm, flexibility: e.target.value as any})}>
                <option value="soft">Soft</option>
                <option value="hard">Hard</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Rationale</Form.Label>
              <Form.Control as="textarea" rows={3} value={createForm.rationale} onChange={(e)=>setCreateForm({...createForm, rationale: e.target.value})} />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setShowCreate(false)}>Cancel</Button>
          <Button variant="primary" onClick={createBlock}>Create</Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Block Modal */}
      <Modal show={!!editBlock} onHide={()=>setEditBlock(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Block</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-2">
              <Form.Label>Start</Form.Label>
              <Form.Control type="datetime-local" value={editForm.start} onChange={(e)=>setEditForm({...editForm, start: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>End</Form.Label>
              <Form.Control type="datetime-local" value={editForm.end} onChange={(e)=>setEditForm({...editForm, end: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Category</Form.Label>
              <Form.Control value={editForm.category} onChange={(e)=>setEditForm({...editForm, category: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={editForm.theme} onChange={(e)=>setEditForm({...editForm, theme: e.target.value})}>
                {globalThemes.map(t => (
                  <option key={t.id} value={t.label}>{t.label}</option>
                ))}
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-2">
              <Form.Label>Flexibility</Form.Label>
              <Form.Select value={editForm.flexibility} onChange={(e)=>setEditForm({...editForm, flexibility: e.target.value as any})}>
                <option value="soft">Soft</option>
                <option value="hard">Hard</option>
              </Form.Select>
            </Form.Group>
            <Form.Group>
              <Form.Label>Rationale</Form.Label>
              <Form.Control as="textarea" rows={3} value={editForm.rationale} onChange={(e)=>setEditForm({...editForm, rationale: e.target.value})} />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-danger" onClick={deleteBlock}>Delete</Button>
          <Button variant="secondary" onClick={()=>setEditBlock(null)}>Cancel</Button>
          <Button variant="primary" onClick={saveEditBlock}>Save</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default CalendarDnDView;
