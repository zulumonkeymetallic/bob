import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, Table, Modal, Form } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, deleteDoc, doc, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { CalendarBlock } from '../types';

const Calendar: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [showCreateEvent, setShowCreateEvent] = useState(false);
  const [showCreateRoutine, setShowCreateRoutine] = useState(false);
  const [newEvent, setNewEvent] = useState({
    title: '',
    start: '',
    duration: 60,
    theme: 'Health' as 'Health'|'Growth'|'Wealth'|'Tribe'|'Home',
    subtheme: '',
    repeatWeekly: false,
    repeatDays: { SU:false, MO:false, TU:false, WE:false, TH:false, FR:false, SA:false } as Record<'SU'|'MO'|'TU'|'WE'|'TH'|'FR'|'SA', boolean>,
    repeatUntil: ''
  });
  const [googleEvents, setGoogleEvents] = useState<any[]>([]);
  const [loadingGoogle, setLoadingGoogle] = useState(false);
  const [editBlock, setEditBlock] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({
    start: '',
    end: '',
    category: '',
    theme: '',
    flexibility: 'soft',
    rationale: ''
  });

  // Recurring routine form
  const [routineForm, setRoutineForm] = useState({
    title: '',
    theme: 'Health' as 'Health'|'Growth'|'Wealth'|'Tribe'|'Home',
    subtheme: '',
    duration: 60,
    start: '', // datetime-local for first occurrence
    repeatDays: { SU:false, MO:false, TU:false, WE:false, TH:false, FR:false, SA:false } as Record<'SU'|'MO'|'TU'|'WE'|'TH'|'FR'|'SA', boolean>,
    repeatUntil: '' // YYYY-MM-DD
  });

  // Load calendar blocks from Firebase
  useEffect(() => {
    if (!currentUser) return;

    const blocksQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('status', '==', 'applied')
    );

    const unsubscribe = onSnapshot(blocksQuery, (snapshot) => {
      const blocksData: CalendarBlock[] = [];
      snapshot.forEach((doc) => {
        blocksData.push({ id: doc.id, ...doc.data() } as CalendarBlock);
      });
      setBlocks(blocksData);
    });

    return () => unsubscribe();
  }, [currentUser]);

  // Load Google Calendar events for the visible week (overlay)
  useEffect(() => {
    const load = async () => {
      if (!currentUser) return;
      try {
        setLoadingGoogle(true);
        const callable = httpsCallable(functions, 'listUpcomingEvents');
        const startOfWeek = new Date(currentWeek);
        startOfWeek.setDate(currentWeek.getDate() - currentWeek.getDay());
        startOfWeek.setHours(0,0,0,0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23,59,59,999);
        const res: any = await callable({ maxResults: 250, timeMin: startOfWeek.toISOString(), timeMax: endOfWeek.toISOString() });
        const items = (res?.data?.items || []).map((e: any) => ({
          id: e.id,
          summary: e.summary || 'Untitled',
          start: new Date(e.start?.dateTime || e.start?.date),
          end: new Date(e.end?.dateTime || e.end?.date)
        }));
        setGoogleEvents(items);
      } catch (e) {
        console.warn('Failed to load Google events (overlay):', (e as any)?.message);
      } finally {
        setLoadingGoogle(false);
      }
    };
    load();
  }, [currentUser, currentWeek]);

  // Get week dates
  const getWeekDates = () => {
    const startOfWeek = new Date(currentWeek);
    startOfWeek.setDate(currentWeek.getDate() - currentWeek.getDay());
    
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + i);
      weekDates.push(date);
    }
    return weekDates;
  };

  // Navigate weeks
  const navigateWeek = (direction: number) => {
    const newWeek = new Date(currentWeek);
    newWeek.setDate(currentWeek.getDate() + (direction * 7));
    setCurrentWeek(newWeek);
  };

  // Get blocks for a specific day
  const getBlocksForDay = (date: Date) => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    return blocks.filter(block => {
      const blockStart = new Date(block.start);
      return blockStart >= dayStart && blockStart <= dayEnd;
    }).sort((a, b) => a.start - b.start);
  };

  const getGoogleEventsForDay = (date: Date) => {
    const dayStart = new Date(date); dayStart.setHours(0,0,0,0);
    const dayEnd = new Date(date); dayEnd.setHours(23,59,59,999);
    return googleEvents.filter(ev => ev.start >= dayStart && ev.start <= dayEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  };

  // Create quick calendar event
  const handleCreateEvent = async () => {
    if (!currentUser || !newEvent.title.trim() || !newEvent.start) return;

    try {
      const createEvent = httpsCallable(functions, 'createCalendarEvent');
      const startDate = new Date(newEvent.start);
      const endDate = new Date(startDate.getTime() + (newEvent.duration * 60 * 1000));

      const summary = `[${newEvent.theme}] – ${newEvent.subtheme ? newEvent.subtheme + ' · ' : ''}${newEvent.title}`;
      let recurrence: string[] = [];
      if (newEvent.repeatWeekly) {
        const selected = Object.entries(newEvent.repeatDays).filter(([,v])=>v).map(([k])=>k).join(',');
        if (selected) {
          let rule = `RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${selected}`;
          if (newEvent.repeatUntil) {
            const untilDate = new Date(newEvent.repeatUntil);
            untilDate.setHours(23,59,59,999);
            const untilStr = untilDate.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
            rule += `;UNTIL=${untilStr}`;
          }
          recurrence = [rule];
        }
      }
      await createEvent({
        summary,
        start: startDate.toISOString(),
        end: endDate.toISOString(),
        description: newEvent.subtheme ? `Activity: ${newEvent.subtheme}` : undefined,
        recurrence,
        extendedProperties: { private: { 'bob-theme': newEvent.theme, 'bob-subtheme': newEvent.subtheme || '' } }
      });

      setNewEvent({
        title: '', start: '', duration: 60, theme: 'Health', subtheme: '', repeatWeekly: false,
        repeatDays: { SU:false, MO:false, TU:false, WE:false, TH:false, FR:false, SA:false }, repeatUntil: ''
      });
      setShowCreateEvent(false);
      alert('Event created successfully!');
    } catch (error: any) {
      console.error('Error creating event:', error);
      let errorMessage = 'Failed to create event';
      
      if (error.code === 'unauthenticated') {
        errorMessage = 'Please sign in to create calendar events';
      } else if (error.code === 'permission-denied') {
        errorMessage = 'Please connect your Google Calendar first';
      } else if (error.message?.includes('No token') || error.message?.includes('No refresh token')) {
        errorMessage = 'Please connect your Google Calendar in Settings first';
      } else if (error.code === 'internal') {
        errorMessage = 'Calendar service unavailable. Please connect your Google Calendar in Settings.';
      }
      
      alert(errorMessage);
    }
  };

  // Create recurring block as a Routine (scheduled by planner)
  const handleCreateRoutine = async () => {
    if (!currentUser || !routineForm.title.trim() || !routineForm.start) return;
    try {
      const startDate = new Date(routineForm.start);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const byday = Object.entries(routineForm.repeatDays).filter(([,v])=>v).map(([k])=>k).join(',');
      if (!byday) {
        alert('Select at least one day for weekly recurrence');
        return;
      }
      let rrule = `RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=${byday}`;
      if (routineForm.repeatUntil) {
        const untilDate = new Date(routineForm.repeatUntil);
        untilDate.setHours(23,59,59,999);
        const untilStr = untilDate.toISOString().replace(/[-:]/g,'').split('.')[0] + 'Z';
        rrule += `;UNTIL=${untilStr}`;
      }

      const title = `[${routineForm.theme}] – ${routineForm.subtheme ? routineForm.subtheme + ' · ' : ''}${routineForm.title.trim()}`;
      const now = Date.now();
      await addDoc(collection(db, 'routines'), {
        ownerUid: currentUser.uid,
        title,
        description: routineForm.subtheme ? `Activity: ${routineForm.subtheme}` : null,
        recurrence: {
          rrule,
          dtstart: startDate.toISOString(),
          timezone: tz,
          source: 'rrule'
        },
        durationMinutes: Number(routineForm.duration) || 60,
        priority: 3,
        policy: { mode: 'roll_forward' },
        tags: [`theme-${routineForm.theme}`, routineForm.subtheme ? `activity-${routineForm.subtheme}` : null].filter(Boolean),
        createdAt: now,
        updatedAt: now
      });

      setShowCreateRoutine(false);
      setRoutineForm({
        title: '', theme: 'Health', subtheme: '', duration: 60, start: '',
        repeatDays: { SU:false, MO:false, TU:false, WE:false, TH:false, FR:false, SA:false }, repeatUntil: ''
      });
      alert('Recurring block created. Run Planning to schedule instances.');
    } catch (e:any) {
      console.error('Failed to create routine', e);
      alert(e?.message || 'Failed to create recurring block');
    }
  };

  const openEditBlock = (block: any) => {
    setEditBlock(block);
    setEditForm({
      start: new Date(block.start).toISOString().slice(0,16),
      end: new Date(block.end).toISOString().slice(0,16),
      category: block.category || '',
      theme: block.theme || 'Health',
      flexibility: block.flexibility || 'soft',
      rationale: block.rationale || ''
    });
  };

  const submitEditBlock = async () => {
    if (!editBlock) return;
    try {
      await updateDoc(doc(db, 'calendar_blocks', editBlock.id), {
        start: new Date(editForm.start).getTime(),
        end: new Date(editForm.end).getTime(),
        category: editForm.category,
        theme: editForm.theme,
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

  const deleteBlock = async (blockId: string) => {
    if (!window.confirm('Delete this calendar block?')) return;
    try {
      await deleteDoc(doc(db, 'calendar_blocks', blockId));
    } catch (e) {
      console.error('Failed to delete block', e);
      alert('Failed to delete block');
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit',
      hour12: true 
    });
  };

  const getThemeBadge = (theme: string) => {
    const colors = {
      Health: 'danger',
      Growth: 'primary',
      Wealth: 'success',
      Tribe: 'info',
      Home: 'warning'
    };
    return <Badge bg={colors[theme] || 'secondary'}>{theme}</Badge>;
  };

  if (!currentUser) {
    return <div>Please sign in to view your calendar.</div>;
  }

  const weekDates = getWeekDates();

  return (
    <Container fluid className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>Calendar View</h2>
        <div>
          <Button variant="outline-primary" className="me-2" onClick={() => setShowCreateEvent(true)}>
            + Quick Event
          </Button>
          <Button variant="outline-success" className="me-2" onClick={() => setShowCreateRoutine(true)}>
            + Recurring Block
          </Button>
          <Button variant="outline-secondary" className="me-2" onClick={() => window.location.reload()} disabled={loadingGoogle}>
            {loadingGoogle ? 'Loading Google…' : 'Reload Google Events'}
          </Button>
          <Button variant="link" href="/ai-planner">
            Go to AI Planner
          </Button>
        </div>
      </div>

      {/* Week Navigation */}
      <div className="d-flex justify-content-between align-items-center mb-3">
        <Button variant="outline-secondary" onClick={() => navigateWeek(-1)}>
          Previous Week
        </Button>
        <h4>
          {weekDates[0].toLocaleDateString()} - {weekDates[6].toLocaleDateString()}
        </h4>
        <Button variant="outline-secondary" onClick={() => navigateWeek(1)}>
          Next Week
        </Button>
      </div>

      {/* Calendar Grid */}
      <Row>
        {weekDates.map((date, index) => {
          const dayBlocks = getBlocksForDay(date);
          const isToday = date.toDateString() === new Date().toDateString();
          
          return (
            <Col key={index} className="mb-3">
              <Card className={`h-100 ${isToday ? 'border-primary' : ''}`}>
                <Card.Header className={isToday ? 'bg-primary text-white' : ''}>
                  <div className="text-center">
                    <div className="fw-bold">
                      {date.toLocaleDateString('en-US', { weekday: 'short' })}
                    </div>
                    <div>{date.getDate()}</div>
                  </div>
                </Card.Header>
                <Card.Body style={{ minHeight: '300px', fontSize: '0.85rem' }}>
                  {(() => {
                    const gEvents = getGoogleEventsForDay(date);
                    return (
                      <>
                        {gEvents.length > 0 && (
                          <div className="mb-2">
                            {gEvents.map(ev => (
                              <div key={ev.id} className="mb-2 p-2 border rounded small" style={{ background: '#f0f9ff' }}>
                                <div className="fw-bold text-primary">{ev.summary}</div>
                                <div className="text-muted">{ev.start.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                <Badge bg="info">Google</Badge>
                              </div>
                            ))}
                          </div>
                        )}
                        {dayBlocks.length === 0 ? (
                          <p className="text-muted text-center small">No blocks</p>
                        ) : (
                          dayBlocks.map(block => (
                            <div key={block.id} className="mb-2 p-2 border rounded small">
                              <div className="d-flex justify-content-between align-items-start">
                                <div>
                                  <div className="fw-bold">{formatTime(block.start)}</div>
                                  <div>{block.category}</div>
                                  <div>{getThemeBadge(block.theme)}</div>
                                  {block.rationale && (
                                    <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                                      {block.rationale}
                                    </div>
                                  )}
                                </div>
                                <div className="ms-2 d-flex gap-1">
                                  <Button size="sm" variant="outline-primary" onClick={() => openEditBlock(block)}>Edit</Button>
                                  <Button size="sm" variant="outline-danger" onClick={() => deleteBlock(block.id)}>Delete</Button>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </>
                    );
                  })()}
                </Card.Body>
              </Card>
            </Col>
          );
        })}
      </Row>

      {/* Today's Schedule Summary */}
      <Row className="mt-4">
        <Col md={12}>
          <Card>
            <Card.Header>
              <h5 className="mb-0">Today's Schedule</h5>
            </Card.Header>
            <Card.Body>
              {getBlocksForDay(new Date()).length === 0 ? (
                <p className="text-muted">No scheduled blocks for today. Consider using the AI Planner to generate your schedule!</p>
              ) : (
                <Table size="sm" striped>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Activity</th>
                      <th>Theme</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {getBlocksForDay(new Date()).map(block => (
                      <tr key={block.id}>
                        <td>{formatTime(block.start)}</td>
                        <td>{block.category}</td>
                        <td>{getThemeBadge(block.theme)}</td>
                        <td>
                          <small className="text-muted">{block.rationale}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Quick Event Creation Modal */}
      <Modal show={showCreateEvent} onHide={() => setShowCreateEvent(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create Quick Event</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Event Title</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Team Meeting"
                value={newEvent.title}
                onChange={(e) => setNewEvent({...newEvent, title: e.target.value})}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={newEvent.theme} onChange={(e)=>setNewEvent({ ...newEvent, theme: e.target.value as any })}>
                <option value="Health">Health</option>
                <option value="Growth">Growth</option>
                <option value="Wealth">Wealth</option>
                <option value="Tribe">Tribe</option>
                <option value="Home">Home</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Sub‑theme / Activity</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Fitness, Triathlon training"
                value={newEvent.subtheme}
                onChange={(e)=>setNewEvent({ ...newEvent, subtheme: e.target.value })}
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Start Time</Form.Label>
              <Form.Control
                type="datetime-local"
                value={newEvent.start}
                onChange={(e) => setNewEvent({...newEvent, start: e.target.value})}
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Duration (minutes)</Form.Label>
              <Form.Select
                value={newEvent.duration}
                onChange={(e) => setNewEvent({...newEvent, duration: parseInt(e.target.value)})}
              >
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                id="repeat-weekly"
                label="Repeat weekly"
                checked={newEvent.repeatWeekly}
                onChange={(e)=>setNewEvent({ ...newEvent, repeatWeekly: e.target.checked })}
              />
              {newEvent.repeatWeekly && (
                <div className="mt-2">
                  <div className="d-flex flex-wrap gap-3 mb-2">
                    {(['SU','MO','TU','WE','TH','FR','SA'] as const).map(d => (
                      <Form.Check
                        key={d}
                        inline
                        label={d}
                        type="checkbox"
                        checked={newEvent.repeatDays[d]}
                        onChange={(e)=>setNewEvent({ ...newEvent, repeatDays: { ...newEvent.repeatDays, [d]: e.target.checked } })}
                      />
                    ))}
                  </div>
                  <Form.Label>Repeat until (optional)</Form.Label>
                  <Form.Control
                    type="date"
                    value={newEvent.repeatUntil}
                    onChange={(e)=>setNewEvent({ ...newEvent, repeatUntil: e.target.value })}
                  />
                </div>
              )}
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowCreateEvent(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleCreateEvent}
            disabled={!newEvent.title.trim() || !newEvent.start}
          >
            Create Event
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Block Modal */}
      <Modal show={!!editBlock} onHide={() => setEditBlock(null)}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Calendar Block</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Start</Form.Label>
              <Form.Control type="datetime-local" value={editForm.start} onChange={(e)=>setEditForm({...editForm, start: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>End</Form.Label>
              <Form.Control type="datetime-local" value={editForm.end} onChange={(e)=>setEditForm({...editForm, end: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Category</Form.Label>
              <Form.Control type="text" value={editForm.category} onChange={(e)=>setEditForm({...editForm, category: e.target.value})} />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={editForm.theme} onChange={(e)=>setEditForm({...editForm, theme: e.target.value})}>
                <option>Health</option>
                <option>Growth</option>
                <option>Wealth</option>
                <option>Tribe</option>
                <option>Home</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
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
          <Button variant="secondary" onClick={()=>setEditBlock(null)}>Cancel</Button>
          <Button variant="primary" onClick={submitEditBlock}>Save Changes</Button>
        </Modal.Footer>
      </Modal>

      {/* Create Recurring Block (Routine) */}
      <Modal show={showCreateRoutine} onHide={() => setShowCreateRoutine(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Create Recurring Block</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Triathlon training"
                value={routineForm.title}
                onChange={(e)=>setRoutineForm({ ...routineForm, title: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Theme</Form.Label>
              <Form.Select value={routineForm.theme} onChange={(e)=>setRoutineForm({ ...routineForm, theme: e.target.value as any })}>
                <option value="Health">Health</option>
                <option value="Growth">Growth</option>
                <option value="Wealth">Wealth</option>
                <option value="Tribe">Tribe</option>
                <option value="Home">Home</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Activity / Sub‑theme</Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g., Fitness, Swim/Bike/Run"
                value={routineForm.subtheme}
                onChange={(e)=>setRoutineForm({ ...routineForm, subtheme: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>First Start</Form.Label>
              <Form.Control
                type="datetime-local"
                value={routineForm.start}
                onChange={(e)=>setRoutineForm({ ...routineForm, start: e.target.value })}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Duration (minutes)</Form.Label>
              <Form.Select value={routineForm.duration} onChange={(e)=>setRoutineForm({ ...routineForm, duration: parseInt(e.target.value) })}>
                <option value={30}>30 minutes</option>
                <option value={45}>45 minutes</option>
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Weekly on</Form.Label>
              <div className="d-flex flex-wrap gap-3 mb-2">
                {(['SU','MO','TU','WE','TH','FR','SA'] as const).map(d => (
                  <Form.Check
                    key={d}
                    inline
                    label={d}
                    type="checkbox"
                    checked={routineForm.repeatDays[d]}
                    onChange={(e)=>setRoutineForm({ ...routineForm, repeatDays: { ...routineForm.repeatDays, [d]: e.target.checked } })}
                  />
                ))}
              </div>
              <Form.Label>Repeat until (optional)</Form.Label>
              <Form.Control
                type="date"
                value={routineForm.repeatUntil}
                onChange={(e)=>setRoutineForm({ ...routineForm, repeatUntil: e.target.value })}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={()=>setShowCreateRoutine(false)}>Cancel</Button>
          <Button variant="success" onClick={handleCreateRoutine} disabled={!routineForm.title.trim() || !routineForm.start}>Create</Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default Calendar;

export {};
