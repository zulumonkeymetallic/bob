import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, Table, Modal, Form } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
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
  const [newEvent, setNewEvent] = useState({
    title: '',
    start: '',
    duration: 60
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

  // Create quick calendar event
  const handleCreateEvent = async () => {
    if (!currentUser || !newEvent.title.trim() || !newEvent.start) return;

    try {
      const createEvent = httpsCallable(functions, 'createCalendarEvent');
      const startDate = new Date(newEvent.start);
      const endDate = new Date(startDate.getTime() + (newEvent.duration * 60 * 1000));

      await createEvent({
        summary: newEvent.title,
        start: startDate.toISOString(),
        end: endDate.toISOString()
      });

      setNewEvent({ title: '', start: '', duration: 60 });
      setShowCreateEvent(false);
    } catch (error) {
      console.error('Error creating event:', error);
      alert('Failed to create event: ' + error.message);
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
                  {dayBlocks.length === 0 ? (
                    <p className="text-muted text-center small">No events</p>
                  ) : (
                    dayBlocks.map(block => (
                      <div key={block.id} className="mb-2 p-2 border rounded small">
                        <div className="fw-bold">{formatTime(block.start)}</div>
                        <div>{block.category}</div>
                        <div>{getThemeBadge(block.theme)}</div>
                        {block.rationale && (
                          <div className="text-muted" style={{ fontSize: '0.75rem' }}>
                            {block.rationale}
                          </div>
                        )}
                      </div>
                    ))
                  )}
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
    </Container>
  );
};

export default Calendar;

export {};
