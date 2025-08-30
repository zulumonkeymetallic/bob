import React, { useState, useEffect } from 'react';
import { Container, Card, Button, Alert, Row, Col, Form, Badge, ListGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { httpsCallable } from 'firebase/functions';
import { functions, db } from '../firebase';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';

interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
  status: string;
}

interface CalendarBlock {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  theme: string;
  status: string;
  googleEventId?: string;
}

const CalendarSyncManager: React.FC = () => {
  const { currentUser } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const [upcomingEvents, setUpcomingEvents] = useState<CalendarEvent[]>([]);
  const [calendarBlocks, setCalendarBlocks] = useState<CalendarBlock[]>([]);
  const [lastSync, setLastSync] = useState<string>('');

  // Check connection status on load and fetch calendar blocks
  useEffect(() => {
    if (currentUser) {
      checkConnectionStatus();
      fetchCalendarBlocks();
    }
  }, [currentUser]);

  const checkConnectionStatus = async () => {
    if (!currentUser) return;

    try {
      const calendarStatus = httpsCallable(functions, 'calendarStatus');
      const result = await calendarStatus();
      const status = result.data as any;
      
      setIsConnected(status.connected || false);
      setLastSync(status.lastSync || '');
    } catch (error) {
      console.error('Failed to check connection status:', error);
      setIsConnected(false);
    }
  };

  const initiateGoogleCalendarConnection = async () => {
    if (!currentUser) return;

    try {
      setIsLoading(true);
      const nonce = Math.random().toString(36).substring(2);
      
      // Start OAuth flow
      const authUrl = `https://europe-west2-bob20250810.cloudfunctions.net/oauthStart?uid=${currentUser.uid}&nonce=${nonce}`;
      
      // Open OAuth in new window
      const popup = window.open(authUrl, 'google-oauth', 'width=500,height=600');
      
      // Poll for completion
      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          // Wait a moment then check connection status
          setTimeout(() => {
            checkConnectionStatus();
            setIsLoading(false);
          }, 2000);
        }
      }, 1000);

    } catch (error) {
      console.error('OAuth initiation failed:', error);
      setIsLoading(false);
    }
  };

  const fetchUpcomingEvents = async () => {
    if (!currentUser || !isConnected) return;

    try {
      setIsLoading(true);
      const listUpcomingEvents = httpsCallable(functions, 'listUpcomingEvents');
      const result = await listUpcomingEvents({ days: 7 });
      const events = result.data as any;
      
      setUpcomingEvents(events.items || []);
      setSyncStatus('✅ Events fetched successfully');
    } catch (error) {
      console.error('Failed to fetch events:', error);
      setSyncStatus('❌ Error fetching events: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const runCalendarPlanning = async () => {
    if (!currentUser) return;

    try {
      setIsLoading(true);
      setSyncStatus('🤖 AI is analyzing your schedule and creating time blocks...');
      
      const planCalendar = httpsCallable(functions, 'planCalendar');
      const result = await planCalendar({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        persona: 'personal'
      });
      
      const planResult = result.data as any;
      setSyncStatus(`✅ AI created ${planResult.blocksCreated || 0} time blocks for your goals and tasks`);
    } catch (error) {
      console.error('AI planning failed:', error);
      setSyncStatus('❌ AI planning error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchCalendarBlocks = async () => {
    if (!currentUser) return;

    try {
      // Query calendar blocks from Firestore
      const blocksQuery = query(
        collection(db, 'calendar_blocks'),
        where('ownerUid', '==', currentUser.uid),
        where('startTime', '>=', new Date().toISOString()), // Only future blocks
        orderBy('startTime', 'asc'),
        limit(20)
      );

      // Set up real-time listener
      const unsubscribe = onSnapshot(blocksQuery, (snapshot) => {
        const blocks = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as CalendarBlock[];
        
        setCalendarBlocks(blocks);
      });

      // Return unsubscribe function for cleanup
      return unsubscribe;
    } catch (error) {
      console.error('Failed to fetch calendar blocks:', error);
    }
  };

  const createTestEvent = async () => {
    if (!currentUser || !isConnected) return;

    try {
      setIsLoading(true);
      
      const startTime = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      const endTime = new Date(startTime.getTime() + 30 * 60 * 1000); // 30 minutes later

      const eventData = {
        summary: 'BOB Test Event - Calendar Sync Working! 🎉',
        description: 'This test event was created by the BOB productivity platform to verify calendar sync is working correctly.',
        start: {
          dateTime: startTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      };

      const createCalendarEvent = httpsCallable(functions, 'createCalendarEvent');
      const result = await createCalendarEvent(eventData);
      
      setSyncStatus('✅ Test event created successfully in Google Calendar!');
      await fetchUpcomingEvents(); // Refresh events list
    } catch (error) {
      console.error('Failed to create test event:', error);
      setSyncStatus('❌ Test event creation error: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDateTime = (dateTime: string) => {
    return new Date(dateTime).toLocaleString();
  };

  const getThemeColor = (theme: string) => {
    const colors = {
      Health: '#e53e3e',
      Growth: '#3182ce',
      Wealth: '#38a169',
      Tribe: '#805ad5',
      Home: '#d69e2e'
    };
    return colors[theme as keyof typeof colors] || '#6c757d';
  };

  if (!currentUser) {
    return (
      <Container>
        <Alert variant="warning">Please sign in to manage calendar sync.</Alert>
      </Container>
    );
  }

  return (
    <Container fluid className="mt-4">
      <Row>
        <Col md={6}>
          <Card>
            <Card.Header>
              <h5 className="mb-0">Google Calendar Integration</h5>
            </Card.Header>
            <Card.Body>
              <div className="d-flex align-items-center mb-3">
                <span className="me-2">Status:</span>
                <Badge bg={isConnected ? 'success' : 'secondary'}>
                  {isConnected ? '✅ Connected' : '❌ Not Connected'}
                </Badge>
                {lastSync && (
                  <small className="text-muted ms-2">
                    Last sync: {formatDateTime(lastSync)}
                  </small>
                )}
              </div>

              {!isConnected ? (
                <div>
                  <p className="text-muted mb-3">
                    Connect your Google Calendar to enable bi-directional sync between BOB and Google Calendar.
                  </p>
                  <Button 
                    variant="primary" 
                    onClick={initiateGoogleCalendarConnection}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Connecting...' : 'Connect Google Calendar'}
                  </Button>
                </div>
              ) : (
                <div>
                  <p className="text-success mb-3">
                    ✅ Google Calendar is connected! You can now sync your BOB time blocks and goals.
                  </p>
                  
                  <div className="d-flex flex-wrap gap-2 mb-3">
                    <Button 
                      variant="outline-primary" 
                      onClick={fetchUpcomingEvents}
                      disabled={isLoading}
                    >
                      📅 Fetch Events
                    </Button>
                    <Button 
                      variant="outline-info" 
                      onClick={runCalendarPlanning}
                      disabled={isLoading}
                    >
                      🤖 AI Planning
                    </Button>
                    <Button 
                      variant="outline-warning" 
                      onClick={createTestEvent}
                      disabled={isLoading}
                    >
                      🧪 Create Test Event
                    </Button>
                  </div>

                  {syncStatus && (
                    <Alert variant={syncStatus.includes('❌') ? 'danger' : 'info'} className="mb-3">
                      {syncStatus}
                    </Alert>
                  )}
                </div>
              )}
            </Card.Body>
          </Card>

          {/* Calendar Blocks */}
          {calendarBlocks.length > 0 && (
            <Card className="mt-4">
              <Card.Header>
                <h6 className="mb-0">BOB Time Blocks ({calendarBlocks.length})</h6>
              </Card.Header>
              <Card.Body style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <ListGroup variant="flush">
                  {calendarBlocks.map((block) => (
                    <ListGroup.Item key={block.id} className="d-flex justify-content-between align-items-start">
                      <div className="flex-grow-1">
                        <div className="d-flex align-items-center mb-1">
                          <strong className="me-2">{block.title}</strong>
                          <Badge 
                            style={{ backgroundColor: getThemeColor(block.theme), color: 'white' }}
                          >
                            {block.theme}
                          </Badge>
                        </div>
                        <small className="text-muted">
                          {formatDateTime(block.startTime)} - {formatDateTime(block.endTime)}
                        </small>
                        {block.description && (
                          <div className="mt-1">
                            <small>{block.description}</small>
                          </div>
                        )}
                      </div>
                      {block.googleEventId && (
                        <Badge bg="success" className="ms-2">Synced</Badge>
                      )}
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              </Card.Body>
            </Card>
          )}
        </Col>

        <Col md={6}>
          {/* Upcoming Events */}
          <Card>
            <Card.Header>
              <h6 className="mb-0">Upcoming Google Calendar Events ({upcomingEvents.length})</h6>
            </Card.Header>
            <Card.Body style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {upcomingEvents.length === 0 ? (
                <p className="text-muted">No upcoming events found. Click "Fetch Events" to load from Google Calendar.</p>
              ) : (
                <ListGroup variant="flush">
                  {upcomingEvents.map((event) => (
                    <ListGroup.Item key={event.id}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div className="flex-grow-1">
                          <strong>{event.summary}</strong>
                          <div className="text-muted small">
                            {event.start.dateTime ? 
                              formatDateTime(event.start.dateTime) : 
                              `All day: ${event.start.date}`
                            }
                          </div>
                          {event.location && (
                            <div className="text-muted small">📍 {event.location}</div>
                          )}
                          {event.description && (
                            <div className="small mt-1" style={{ maxHeight: '40px', overflow: 'hidden' }}>
                              {event.description}
                            </div>
                          )}
                        </div>
                        <Badge bg={event.status === 'confirmed' ? 'success' : 'secondary'}>
                          {event.status}
                        </Badge>
                      </div>
                    </ListGroup.Item>
                  ))}
                </ListGroup>
              )}
            </Card.Body>
          </Card>

          {/* AI Calendar Planning Info */}
          <Card className="mt-4">
            <Card.Header>
              <h6 className="mb-0">🤖 AI Calendar Planning</h6>
            </Card.Header>
            <Card.Body>
              <p className="small text-muted mb-2">
                The AI Planner analyzes your goals, stories, and tasks to create optimized time blocks:
              </p>
              <ul className="small text-muted">
                <li><strong>Context Assembly:</strong> Gathers your goals, tasks, and existing calendar</li>
                <li><strong>LLM Planning:</strong> GPT-4 creates intelligent time blocks</li>
                <li><strong>Validation:</strong> Checks for conflicts and realistic scheduling</li>
                <li><strong>Auto-Apply:</strong> Creates time blocks in BOB's calendar system</li>
                <li><strong>Review Pane:</strong> Allows you to approve before syncing to Google</li>
              </ul>
              <div className="mt-2">
                <Badge bg="primary" className="me-1">Theme-based</Badge>
                <Badge bg="info" className="me-1">Conflict Detection</Badge>
                <Badge bg="success">Bi-directional Sync</Badge>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default CalendarSyncManager;
