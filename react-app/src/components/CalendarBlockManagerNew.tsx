import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { CalendarBlock, Story, Task, IHabit } from '../types';
import { Container, Row, Col, Card, Button, Modal, Form, Alert, ButtonGroup, ToggleButton } from 'react-bootstrap';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock } from 'lucide-react';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { httpsCallable } from 'firebase/functions';

interface CalendarEvent {
    id: string;
    title: string;
    start: Date;
    end: Date;
    backgroundColor: string;
    extendedProps: {
        block: CalendarBlock;
        entity?: Story | Task | IHabit;
    };
}

const CalendarBlockManager: React.FC = () => {
    const { currentUser } = useAuth();
    const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
    const [stories, setStories] = useState<Story[]>([]);
    const [tasks, setTasks] = useState<Task[]>([]);
    const [habits, setHabits] = useState<IHabit[]>([]);
    const [showBlockModal, setShowBlockModal] = useState(false);
    const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [aiScheduling, setAiScheduling] = useState(false);
    const [aiMessage, setAiMessage] = useState<string | null>(null);
    const [aiVariant, setAiVariant] = useState<'info' | 'success' | 'warning' | 'danger'>('info');
    const [calendarView, setCalendarView] = useState<'list' | 'week'>('week');
    const [selectedDate, setSelectedDate] = useState<Date>(() => { const d=new Date(); d.setHours(0,0,0,0); return d; });
    const [formError, setFormError] = useState<string | null>(null);

    const [newBlock, setNewBlock] = useState({
        theme: 'Health' as 'Health' | 'Growth' | 'Wealth' | 'Tribe' | 'Home',
        subTheme: '',
        category: 'Fitness' as 'Tribe' | 'Chores' | 'Gaming' | 'Fitness' | 'Wellbeing' | 'Sauna' | 'Sleep',
        start: '',
        end: '',
        flexibility: 'soft' as 'hard' | 'soft',
        status: 'proposed' as 'proposed' | 'applied',
        storyId: '',
        taskId: '',
        habitId: ''
    });

    const themeColors = {
        'Health': '#22c55e',
        'Growth': '#3b82f6', 
        'Wealth': '#eab308',
        'Tribe': '#8b5cf6',
        'Home': '#f97316'
    };

    useEffect(() => {
        if (!currentUser) return;

        const blocksQuery = query(collection(db, 'calendar_blocks'), where('ownerUid', '==', currentUser.uid));
        const storiesQuery = query(collection(db, 'stories'), where('ownerUid', '==', currentUser.uid));
        const tasksQuery = query(collection(db, 'tasks'), where('ownerUid', '==', currentUser.uid));
        const habitsQuery = query(collection(db, 'habits'), where('ownerUid', '==', currentUser.uid));

        const unsubscribeBlocks = onSnapshot(blocksQuery, snapshot => {
            const blocksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as CalendarBlock));
            setBlocks(blocksData);
            setLoading(false);
        });

        const unsubscribeStories = onSnapshot(storiesQuery, snapshot => {
            const storiesData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Story));
            setStories(storiesData);
        });

        const unsubscribeTasks = onSnapshot(tasksQuery, snapshot => {
            const tasksData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
            setTasks(tasksData);
        });

        const unsubscribeHabits = onSnapshot(habitsQuery, snapshot => {
            const habitsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as IHabit));
            setHabits(habitsData);
        });

        return () => {
            unsubscribeBlocks();
            unsubscribeStories();
            unsubscribeTasks();
            unsubscribeHabits();
        };
    }, [currentUser]);

    const handleCreateBlock = async () => {
        if (!currentUser || !newBlock.start || !newBlock.end) return;

        try {
            const startTime = new Date(newBlock.start).getTime();
            const endTime = new Date(newBlock.end).getTime();

            if (Number.isNaN(startTime) || Number.isNaN(endTime)) {
                setFormError('Please provide valid start and end times.');
                return;
            }
            if (endTime <= startTime) {
                setFormError('End time must be after start time.');
                return;
            }

            // Overlap detection: prevent conflicts with hard/applied blocks
            const overlapAny = blocks
              .filter(b => b.ownerUid === currentUser.uid)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime));
            const overlapHard = blocks
              .filter(b => b.ownerUid === currentUser.uid)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime) && (b.flexibility === 'hard' || b.status === 'applied'));
            if (overlapHard && (newBlock.flexibility === 'hard' || newBlock.status === 'applied')) {
                setFormError('Time window conflicts with an existing applied/hard block. Switch to Soft/Proposed or adjust times.');
                return;
            }
            if (overlapAny && !(newBlock.flexibility === 'hard' || newBlock.status === 'applied')) {
                setAiMessage('⚠️ Overlaps existing block(s). Saved as proposed/soft.');
                setAiVariant('warning');
                setTimeout(() => setAiMessage(null), 4500);
            }

            await addDoc(collection(db, 'calendar_blocks'), {
                googleEventId: null,
                taskId: newBlock.taskId || null,
                goalId: null,
                storyId: newBlock.storyId || null,
                habitId: newBlock.habitId || null,
                subTheme: newBlock.subTheme || null,
                persona: 'personal',
                theme: newBlock.theme,
                category: newBlock.category,
                start: startTime,
                end: endTime,
                flexibility: newBlock.flexibility,
                status: newBlock.status,
                colorId: null,
                visibility: 'default',
                createdBy: 'user',
                rationale: 'Manual block creation',
                version: 1,
                supersededBy: null,
                ownerUid: currentUser.uid,
                createdAt: Date.now(),
                updatedAt: Date.now()
            });

            setNewBlock({
                theme: 'Health',
                subTheme: '',
                category: 'Fitness',
                start: '',
                end: '',
                flexibility: 'soft',
                status: 'proposed',
                storyId: '',
                taskId: '',
                habitId: ''
            });
            setFormError(null);
            setShowBlockModal(false);
        } catch (error) {
            console.error('Error creating calendar block:', error);
        }
    };

    const openEditModal = (block: CalendarBlock) => {
        setEditingBlockId(block.id);
        setNewBlock({
            theme: block.theme,
            subTheme: block.subTheme || '',
            category: block.category,
            start: new Date(block.start).toISOString().slice(0,16),
            end: new Date(block.end).toISOString().slice(0,16),
            flexibility: block.flexibility,
            status: (block.status === 'proposed' || block.status === 'applied') ? block.status : 'proposed',
            storyId: block.storyId || '',
            taskId: block.taskId || '',
            habitId: block.habitId || ''
        });
        setFormError(null);
        setShowBlockModal(true);
    };

    const handleUpdateBlock = async () => {
        if (!currentUser || !editingBlockId || !newBlock.start || !newBlock.end) return;
        try {
            const startTime = new Date(newBlock.start).getTime();
            const endTime = new Date(newBlock.end).getTime();
            if (Number.isNaN(startTime) || Number.isNaN(endTime)) { setFormError('Please provide valid start and end times.'); return; }
            if (endTime <= startTime) { setFormError('End time must be after start time.'); return; }
            const overlapAny = blocks
              .filter(b => b.ownerUid === currentUser.uid && b.id !== editingBlockId)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime));
            const overlapHard = blocks
              .filter(b => b.ownerUid === currentUser.uid && b.id !== editingBlockId)
              .some(b => Math.max(b.start, startTime) < Math.min(b.end, endTime) && (b.flexibility === 'hard' || b.status === 'applied'));
            if (overlapHard && (newBlock.flexibility === 'hard' || newBlock.status === 'applied')) { setFormError('Time window conflicts with an existing applied/hard block.'); return; }
            if (overlapAny && !(newBlock.flexibility === 'hard' || newBlock.status === 'applied')) {
              setAiMessage('⚠️ Overlaps existing block(s). Saved as proposed/soft.');
              setAiVariant('warning');
              setTimeout(() => setAiMessage(null), 4500);
            }

            await updateDoc(doc(db, 'calendar_blocks', editingBlockId), {
                theme: newBlock.theme,
                subTheme: newBlock.subTheme || null,
                category: newBlock.category,
                start: startTime,
                end: endTime,
                flexibility: newBlock.flexibility,
                status: newBlock.status,
                storyId: newBlock.storyId || null,
                habitId: newBlock.habitId || null,
                updatedAt: Date.now()
            });

            setEditingBlockId(null);
            setShowBlockModal(false);
        } catch (e) {
            console.error('Failed to update block', e);
        }
    };

    const handleDeleteBlock = async (blockId: string) => {
        if (!blockId) return;
        const ok = window.confirm('Delete this time block? This cannot be undone.');
        if (!ok) return;
        try {
            await deleteDoc(doc(db, 'calendar_blocks', blockId));
        } catch (e) {
            console.error('Failed to delete block', e);
            alert('Failed to delete block.');
        }
    };

    const triggerAiScheduling = async () => {
        setAiScheduling(true);
        try {
            const planCalendar = httpsCallable(functions, 'planCalendar');
            const startDate = new Date().toISOString().split('T')[0];
            const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            setAiMessage('🤖 Planning your calendar for the next 7 days...');
            setAiVariant('info');
            const result = await planCalendar({ startDate, endDate, persona: 'personal' });
            const data = result.data as any;
            const created = Number((data && (data.blocksCreated ?? data.created ?? 0)) || 0);
            if (created > 0) {
                setAiMessage(`✅ Scheduled ${created} new time block${created===1?'':'s'}.`);
                setAiVariant('success');
            } else {
                setAiMessage('⚠️ No open slots found to schedule.');
                setAiVariant('warning');
            }
        } catch (error: any) {
            console.error('Error triggering AI scheduling:', error);
            setAiMessage('❌ Failed to trigger AI scheduling: ' + (error?.message || 'unknown'));
            setAiVariant('danger');
        } finally {
            setAiScheduling(false);
            // Auto-dismiss after a few seconds
            setTimeout(() => setAiMessage(null), 5500);
        }
    };

    if (loading) {
        return <div className="d-flex justify-content-center p-5"><div className="spinner-border" role="status"></div></div>;
    }

    // Week grid helpers
    const startOfWeek = (d: Date) => { const c=new Date(d); const day=(c.getDay()+6)%7; c.setDate(c.getDate()-day); c.setHours(0,0,0,0); return c; };
    const endOfWeek = (d: Date) => { const s=startOfWeek(d); const e=new Date(s); e.setDate(s.getDate()+7); return e; };
    const weekStart = startOfWeek(selectedDate);
    const weekEnd = endOfWeek(selectedDate);
    const pxPerMin = 0.6; // 60 minutes = 36px; 24h ~ 864px
    const hourMarks = Array.from({ length: 24 }, (_, i) => i);
    const days: Date[] = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
    const minsFromStart = (ms: number) => { const d=new Date(ms); return d.getHours()*60 + d.getMinutes(); };
    const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
    const splitIntoDays = (b: CalendarBlock) => {
        const parts: Array<{ dayIndex: number; startMin: number; endMin: number; block: CalendarBlock }>=[];
        for (let i=0;i<7;i++) {
            const d0 = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()+i, 0,0,0,0).getTime();
            const d1 = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate()+i, 23,59,59,999).getTime();
            const s = Math.max(b.start, d0);
            const e = Math.min(b.end, d1);
            if (s < e) {
                parts.push({ dayIndex: i, startMin: minsFromStart(s), endMin: Math.max(minsFromStart(e), minsFromStart(s)+15), block: b });
            }
        }
        return parts;
    };

    return (
        <Container fluid className="p-3">
            <div className="d-flex justify-content-between align-items-center mb-4">
                <h1 className="h3 mb-0">Calendar & Time Blocking</h1>
                <div>
                    <Button 
                        variant="outline-primary" 
                        className="me-2"
                        onClick={triggerAiScheduling}
                        disabled={aiScheduling}
                    >
                        {aiScheduling ? 'AI Scheduling...' : 'Trigger AI Scheduling'}
                    </Button>
                    <Button variant="primary" onClick={() => setShowBlockModal(true)}>
                        Create Time Block
                    </Button>
                </div>
            </div>

            <Row>
                <Col md={8}>
                    <Card>
                        <Card.Header className="d-flex justify-content-between align-items-center">
                          <div>Calendar Blocks</div>
                          <div className="d-flex align-items-center gap-2">
                            <ButtonGroup>
                              <ToggleButton
                                id="cb-view-week"
                                type="radio"
                                variant={calendarView==='week'?'primary':'outline-primary'}
                                name="view"
                                value="week"
                                checked={calendarView==='week'}
                                onChange={()=>setCalendarView('week')}
                                size="sm"
                              >Week</ToggleButton>
                              <ToggleButton
                                id="cb-view-list"
                                type="radio"
                                variant={calendarView==='list'?'primary':'outline-primary'}
                                name="view"
                                value="list"
                                checked={calendarView==='list'}
                                onChange={()=>setCalendarView('list')}
                                size="sm"
                              >List</ToggleButton>
                            </ButtonGroup>
                            {calendarView==='week' && (
                              <div className="d-flex align-items-center gap-2">
                                <Button size="sm" variant="outline-secondary" onClick={()=> setSelectedDate(new Date())}><CalendarIcon size={14}/></Button>
                                <Button size="sm" variant="outline-secondary" onClick={()=> { const d=new Date(weekStart); d.setDate(d.getDate()-7); setSelectedDate(d); }}><ChevronLeft size={14}/></Button>
                                <div className="small text-muted" style={{minWidth: 180, textAlign: 'center'}}>
                                  {weekStart.toLocaleDateString()} – {new Date(weekEnd.getTime()-1).toLocaleDateString()}
                                </div>
                                <Button size="sm" variant="outline-secondary" onClick={()=> { const d=new Date(weekStart); d.setDate(d.getDate()+7); setSelectedDate(d); }}><ChevronRight size={14}/></Button>
                              </div>
                            )}
                          </div>
                        </Card.Header>
                        <Card.Body>
                            {aiMessage && (
                                <Alert variant={aiVariant} className="mb-3" onClose={() => setAiMessage(null)} dismissible>
                                    {aiMessage}
                                </Alert>
                            )}
                            {calendarView==='week' ? (
                              <div>
                                {/* Week Grid */}
                                <div className="mb-2 d-flex align-items-center gap-2 text-muted">
                                  <Clock size={14}/> <span style={{fontSize:12}}>All times local</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '70px repeat(7, 1fr)', border: '1px solid var(--bs-border-color)', borderRadius: 8, overflow: 'hidden' }}>
                                  {/* Header row */}
                                  <div style={{ background: 'var(--bs-body-bg)', borderRight: '1px solid var(--bs-border-color)' }} />
                                  {days.map((d, i) => (
                                    <div key={i} style={{ background: 'var(--bs-body-bg)', borderRight: i<6?'1px solid var(--bs-border-color)':'none', textAlign: 'center', fontWeight: 600, padding: '6px 0' }}>
                                      {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                                    </div>
                                  ))}
                                  {/* Body rows */}
                                  {/* Hours column */}
                                  <div style={{ position: 'relative', borderTop: '1px solid var(--bs-border-color)', borderRight: '1px solid var(--bs-border-color)' }}>
                                    <div style={{ position: 'relative', height: `${24*60*pxPerMin}px` }}>
                                      {hourMarks.map(h => (
                                        <div key={h} style={{ position: 'absolute', top: `${h*60*pxPerMin}px`, left: 0, right: 0, height: 1 }}>
                                          <div style={{ position: 'absolute', top: -8, right: 4, fontSize: 10, color: 'var(--bs-secondary-color)' }}>{String(h).padStart(2,'0')}:00</div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                  {/* Day columns */}
                                  {days.map((d, di) => {
                                    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
                                    const dayEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999).getTime();
                                    const dayBlocks = blocks.filter(b => (b.start < dayEnd && b.end > dayStart));
                                    return (
                                      <div key={di} style={{ position: 'relative', borderTop: '1px solid var(--bs-border-color)', borderRight: di<6?'1px solid var(--bs-border-color)':'none', background: 'var(--bs-body-bg)' }}>
                                        <div style={{ position: 'relative', height: `${24*60*pxPerMin}px` }}>
                                          {/* hour lines */}
                                          {hourMarks.map(h => (
                                            <div key={h} style={{ position: 'absolute', top: `${h*60*pxPerMin}px`, left: 0, right: 0, height: 1, borderTop: '1px dashed rgba(0,0,0,0.06)' }} />
                                          ))}
                                          {/* blocks */}
                                          {dayBlocks.flatMap(b => splitIntoDays(b).filter(p=>p.dayIndex===di)).map((p, idx) => {
                                            const top = p.startMin * pxPerMin;
                                            const height = clamp((p.endMin - p.startMin) * pxPerMin, 14, 24*60*pxPerMin - top);
                                            const isHard = p.block.flexibility === 'hard' || p.block.status === 'applied';
                                            return (
                                              <div key={`${p.block.id}-${idx}`} className="calendar-block" data-theme={p.block.theme}
                                                   style={{ position: 'absolute', left: 6, right: 6, top, height, border: '1px solid', borderStyle: isHard ? 'solid' : 'dashed', borderRadius: 8, padding: '6px 8px', overflow: 'hidden', boxShadow: '0 2px 10px rgba(0,0,0,0.06)' }}
                                                   title={`${p.block.theme} - ${p.block.category}\n${new Date(p.block.start).toLocaleString()} – ${new Date(p.block.end).toLocaleString()}`}
                                                   onDoubleClick={() => openEditModal(p.block)}
                                              >
                                                <div className="d-flex justify-content-between align-items-start" style={{ fontSize: 12, fontWeight: 700 }}>
                                                  <div>{p.block.category}{p.block.subTheme ? ` · ${p.block.subTheme}` : ''}</div>
                                                  <span className="badge" style={{ background: 'rgba(0,0,0,0.35)' }}>{isHard ? 'Hard' : 'Soft'}</span>
                                                </div>
                                                <div style={{ fontSize: 11 }} className="text-muted">
                                                  {new Date(p.block.start).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})} – {new Date(p.block.end).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : blocks.length === 0 ? (
                                <div className="text-center text-muted py-4">
                                    <p>No calendar blocks created yet.</p>
                                    <Button variant="primary" onClick={() => setShowBlockModal(true)}>
                                        Create First Block
                                    </Button>
                                </div>
                            ) : (
                                <div className="calendar-blocks">
                                    {blocks.map(block => (
                                        <Card key={block.id} className="mb-2">
                                            <Card.Body>
                                                <div className="d-flex justify-content-between align-items-start">
                                                    <div className="calendar-block" data-theme={block.theme} style={{ border: '1px solid transparent', borderRadius: 8, padding: '6px 8px' }}>
                                                        <h6 className="mb-1">
                                                            {block.theme} - {block.category}
                                                            {block.subTheme && ` (${block.subTheme})`}
                                                        </h6>
                                                        <small className="text-muted">
                                                            {new Date(block.start).toLocaleString()} - {new Date(block.end).toLocaleString()}
                                                        </small>
                                                        <br />
                                                        <small className="text-muted">
                                                            {block.flexibility} • {block.status} • by {block.createdBy}
                                                        </small>
                                                    </div>
                                                    <span 
                                                        className="badge"
                                                        style={{ 
                                                            backgroundColor: themeColors[block.theme],
                                                            color: 'white'
                                                        }}
                                                    >
                                                        {block.theme}
                                                    </span>
                                                </div>
                                                {block.rationale && (
                                                    <p className="mt-2 mb-0 text-muted" style={{ fontSize: '0.85rem' }}>
                                                        {block.rationale}
                                                    </p>
                                                )}
                                                <div className="d-flex gap-2 mt-2">
                                                    <Button size="sm" variant="outline-secondary" onClick={() => openEditModal(block)}>
                                                        Edit
                                                    </Button>
                                                    <Button size="sm" variant="outline-danger" onClick={() => handleDeleteBlock(block.id!)}>
                                                        Delete
                                                    </Button>
                                                </div>
                                            </Card.Body>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </Card.Body>
                    </Card>
                </Col>
                <Col md={4}>
                    <Card className="mb-3">
                        <Card.Header>Quick Stats</Card.Header>
                        <Card.Body>
                            <div className="mb-2">
                                <strong>Total Blocks:</strong> {blocks.length}
                            </div>
                            <div className="mb-2">
                                <strong>Active Blocks:</strong> {blocks.filter(b => b.status === 'applied').length}
                            </div>
                            <div className="mb-2">
                                <strong>Proposed Blocks:</strong> {blocks.filter(b => b.status === 'proposed').length}
                            </div>
                        </Card.Body>
                    </Card>

                    <Alert variant="info">
                        <Alert.Heading>AI Scheduling</Alert.Heading>
                        <p>
                            AI will automatically fill unblocked time based on task importance, 
                            due dates, and your weekly theme targets.
                        </p>
                        <Button variant="outline-info" size="sm" onClick={triggerAiScheduling}>
                            Learn More
                        </Button>
                    </Alert>
                </Col>
            </Row>

            {/* Create Block Modal */}
            <Modal show={showBlockModal} onHide={() => { setShowBlockModal(false); setEditingBlockId(null); }} size="lg">
                <Modal.Header closeButton>
                    <Modal.Title>{editingBlockId ? 'Edit Calendar Block' : 'Create Calendar Block'}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form>
                        {formError && <Alert variant="danger">{formError}</Alert>}
                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Theme *</Form.Label>
                                    <Form.Select
                                        value={newBlock.theme}
                                        onChange={(e) => setNewBlock({...newBlock, theme: e.target.value as any})}
                                    >
                                        {Object.keys(themeColors).map(theme => (
                                            <option key={theme} value={theme}>{theme}</option>
                                        ))}
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Category *</Form.Label>
                                    <Form.Select
                                        value={newBlock.category}
                                        onChange={(e) => setNewBlock({...newBlock, category: e.target.value as any})}
                                    >
                                        <option value="Fitness">Fitness</option>
                                        <option value="Wellbeing">Wellbeing</option>
                                        <option value="Tribe">Tribe</option>
                                        <option value="Chores">Chores</option>
                                        <option value="Gaming">Gaming</option>
                                        <option value="Sauna">Sauna</option>
                                        <option value="Sleep">Sleep</option>
                                    </Form.Select>
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Group className="mb-3">
                            <Form.Label>Sub-theme</Form.Label>
                            <Form.Control
                                type="text"
                                value={newBlock.subTheme}
                                onChange={(e) => setNewBlock({...newBlock, subTheme: e.target.value})}
                                placeholder="e.g., Cardio, Reading, Cooking"
                            />
                        </Form.Group>

                        <Row>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>Start Time *</Form.Label>
                                    <Form.Control
                                        type="datetime-local"
                                        value={newBlock.start}
                                        onChange={(e) => setNewBlock({...newBlock, start: e.target.value})}
                                    />
                                </Form.Group>
                            </Col>
                            <Col md={6}>
                                <Form.Group className="mb-3">
                                    <Form.Label>End Time *</Form.Label>
                                    <Form.Control
                                        type="datetime-local"
                                        value={newBlock.end}
                                        onChange={(e) => setNewBlock({...newBlock, end: e.target.value})}
                                    />
                                </Form.Group>
                            </Col>
                        </Row>

                        <Form.Group className="mb-3">
                            <Form.Label>Flexibility</Form.Label>
                            <Form.Select
                                value={newBlock.flexibility}
                                onChange={(e) => setNewBlock({...newBlock, flexibility: e.target.value as any})}
                            >
                                <option value="soft">Soft (moveable)</option>
                                <option value="hard">Hard (fixed)</option>
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Status</Form.Label>
                            <Form.Select
                                value={newBlock.status}
                                onChange={(e) => setNewBlock({...newBlock, status: e.target.value as any})}
                            >
                                <option value="proposed">Proposed</option>
                                <option value="applied">Applied</option>
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Link to Story</Form.Label>
                            <Form.Select
                                value={newBlock.storyId}
                                onChange={(e) => setNewBlock({...newBlock, storyId: e.target.value})}
                            >
                                <option value="">No story</option>
                                {stories.map(story => (
                                    <option key={story.id} value={story.id}>{story.title}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group className="mb-3">
                            <Form.Label>Link to Habit</Form.Label>
                            <Form.Select
                                value={newBlock.habitId}
                                onChange={(e) => setNewBlock({...newBlock, habitId: e.target.value})}
                            >
                                <option value="">No habit</option>
                                {habits.map(habit => (
                                    <option key={habit.id} value={habit.id}>{habit.name}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>
                    </Form>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={() => setShowBlockModal(false)}>
                        Cancel
                    </Button>
                    {editingBlockId ? (
                        <Button 
                            variant="primary" 
                            onClick={handleUpdateBlock}
                            disabled={!newBlock.start || !newBlock.end}
                        >
                            Save Changes
                        </Button>
                    ) : (
                        <Button 
                            variant="primary" 
                            onClick={handleCreateBlock}
                            disabled={!newBlock.start || !newBlock.end}
                        >
                            Create Block
                        </Button>
                    )}
                </Modal.Footer>
            </Modal>
        </Container>
    );
};

export default CalendarBlockManager;
