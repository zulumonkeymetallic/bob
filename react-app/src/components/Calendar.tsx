import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, Modal, Form } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { CalendarBlock } from '../types';
import StoryBlock from './StoryBlock';
import { DndContext, useDraggable, useDroppable, DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

// Draggable Block Wrapper
const DraggableBlock = ({ block, children }: { block: any, children: React.ReactNode }) => {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: block.id,
    data: block
  });
  const style = {
    transform: CSS.Translate.toString(transform),
    zIndex: transform ? 999 : 'auto',
    cursor: 'grab',
    touchAction: 'none'
  };
  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      {children}
    </div>
  );
};

// Droppable Slot Wrapper
const DroppableSlot = ({ date, hour, children }: { date: Date, hour: number, children: React.ReactNode }) => {
  const slotId = `${date.toISOString().split('T')[0]}:${hour}`;
  const { setNodeRef, isOver } = useDroppable({
    id: slotId,
    data: { date, hour }
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        minHeight: '60px',
        borderBottom: '1px solid #eee',
        backgroundColor: isOver ? '#f0f9ff' : 'transparent',
        position: 'relative',
        padding: '2px'
      }}
    >
      <div style={{ position: 'absolute', top: 0, left: 0, fontSize: '0.6rem', color: '#ccc', padding: '2px' }}>
        {hour}:00
      </div>
      {children}
    </div>
  );
};

const Calendar: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [currentStart, setCurrentStart] = useState(new Date()); // Start of rolling window
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    start: '',
    duration: 60,
    theme: 'Health' as 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home',
    subtheme: '',
    repeatWeekly: false,
    repeatDays: { SU: false, MO: false, TU: false, WE: false, TH: false, FR: false, SA: false } as Record<'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA', boolean>,
    repeatUntil: ''
  });

  // Load calendar blocks
  useEffect(() => {
    if (!currentUser) return;
    const windowEnd = new Date(currentStart);
    windowEnd.setDate(currentStart.getDate() + 8); // Fetch a bit more

    const blocksQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('start', '>=', currentStart.getTime()),
      where('start', '<=', windowEnd.getTime())
    );

    const unsubscribe = onSnapshot(blocksQuery, (snapshot) => {
      const blocksData: CalendarBlock[] = [];
      snapshot.forEach((doc) => {
        blocksData.push({ id: doc.id, ...doc.data() } as CalendarBlock);
      });
      setBlocks(blocksData);
    });
    return () => unsubscribe();
  }, [currentUser, currentStart]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const blockId = active.id as string;
    const block = active.data.current as any;
    const slotData = over.data.current as { date: Date, hour: number };

    if (block && slotData) {
      const newStart = new Date(slotData.date);
      newStart.setHours(slotData.hour, 0, 0, 0);
      const duration = block.end - block.start;
      const newEnd = new Date(newStart.getTime() + duration);

      // Optimistic update
      setBlocks(prev => prev.map(b => b.id === blockId ? { ...b, start: newStart.getTime(), end: newEnd.getTime() } : b));

      try {
        await updateDoc(doc(db, 'calendar_blocks', blockId), {
          start: newStart.getTime(),
          end: newEnd.getTime(),
          updatedAt: Date.now()
        });

        // Trigger rebalance/sync if needed (backend handles sync on write)
      } catch (e) {
        console.error("Failed to move block", e);
        // Revert on failure (could reload from db)
      }
    }
  };

  const getRollingDates = () => {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(currentStart);
      d.setDate(currentStart.getDate() + i);
      dates.push(d);
    }
    return dates;
  };

  const rollingDates = getRollingDates();
  const hours = Array.from({ length: 16 }, (_, i) => i + 6); // 6am to 10pm

  const navigate = (days: number) => {
    const newStart = new Date(currentStart);
    newStart.setDate(currentStart.getDate() + days);
    setCurrentStart(newStart);
  };

  if (!currentUser) return <div>Please sign in.</div>;

  return (
    <Container fluid className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Rolling Calendar</h2>
        <div>
          <Button variant="outline-secondary" onClick={() => navigate(-1)} className="me-2">Prev</Button>
          <Button variant="outline-secondary" onClick={() => setCurrentStart(new Date())} className="me-2">Today</Button>
          <Button variant="outline-secondary" onClick={() => navigate(1)} className="me-2">Next</Button>
          <Button variant="primary" onClick={() => setShowCreateEvent(true)}>+ Event</Button>
        </div>
      </div>

      <DndContext onDragEnd={handleDragEnd}>
        <div style={{ display: 'flex', overflowX: 'auto', minWidth: '100%' }}>
          {/* Time Column */}
          <div style={{ width: '50px', flexShrink: 0, paddingTop: '40px' }}>
            {hours.map(h => (
              <div key={h} style={{ height: '60px', textAlign: 'right', paddingRight: '5px', fontSize: '0.7rem', color: '#888' }}>
                {h}:00
              </div>
            ))}
          </div>

          {/* Days Columns */}
          {rollingDates.map((date, i) => {
            const isToday = date.toDateString() === new Date().toDateString();
            return (
              <div key={i} style={{ flex: 1, minWidth: '140px', borderLeft: '1px solid #eee' }}>
                <div className={`text-center p-2 ${isToday ? 'bg-primary text-white' : 'bg-light'}`} style={{ borderBottom: '1px solid #ddd' }}>
                  <div style={{ fontWeight: 'bold' }}>{date.toLocaleDateString('en-US', { weekday: 'short' })}</div>
                  <div>{date.getDate()}</div>
                </div>

                {hours.map(hour => {
                  const slotStart = new Date(date);
                  slotStart.setHours(hour, 0, 0, 0);
                  const slotEnd = new Date(slotStart);
                  slotEnd.setHours(hour + 1, 0, 0, 0);

                  // Find blocks that start in this hour
                  // Note: This is a simplified view. Real calendar needs to handle overlaps and sub-hour precision.
                  // For MVP, we just show blocks starting in this hour.
                  const slotBlocks = blocks.filter(b => {
                    const bStart = new Date(b.start);
                    return bStart >= slotStart && bStart < slotEnd;
                  });

                  return (
                    <DroppableSlot key={hour} date={date} hour={hour}>
                      {slotBlocks.map(block => (
                        <DraggableBlock key={block.id} block={block}>
                          <StoryBlock event={{ ...block, title: block.title || 'Untitled' }} />
                        </DraggableBlock>
                      ))}
                    </DroppableSlot>
                  );
                })}
              </div>
            );
          })}
        </div>
      </DndContext>

      {/* Create Event Modal (Simplified) */}
      <Modal show={showCreateEvent} onHide={() => setShowCreateEvent(false)}>
        <Modal.Header closeButton><Modal.Title>New Event</Modal.Title></Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control type="text" value={newEvent.title} onChange={e => setNewEvent({ ...newEvent, title: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Start</Form.Label>
              <Form.Control type="datetime-local" value={newEvent.start} onChange={e => setNewEvent({ ...newEvent, start: e.target.value })} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={newEvent.theme} onChange={e => setNewEvent({ ...newEvent, theme: e.target.value as any })}>
                <option>Health</option><option>Growth</option><option>Wealth</option><option>Tribe</option><option>Home</option>
              </Form.Select>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCreateEvent(false)}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            if (!currentUser) return;
            const start = new Date(newEvent.start);
            const end = new Date(start.getTime() + 60 * 60000);
            await addDoc(collection(db, 'calendar_blocks'), {
              ownerUid: currentUser.uid,
              title: newEvent.title,
              start: start.getTime(),
              end: end.getTime(),
              theme: newEvent.theme,
              status: 'applied',
              updatedAt: Date.now()
            });
            setShowCreateEvent(false);
          }}>Create</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Calendar;

export { };
