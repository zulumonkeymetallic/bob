import React, { useState } from 'react';
import { Container, Card, Button, Alert, Row, Col, Form } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';

const CalendarAPITest: React.FC = () => {
  const { currentUser } = useAuth();
  const [testResults, setTestResults] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [testEventData, setTestEventData] = useState({
    title: 'Test Event from BOB',
    description: 'This is a test event created by the BOB app to verify calendar integration',
    startTime: new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16), // 1 hour from now
    duration: 60 // minutes
  });

  const addTestResult = (test: string, success: boolean, data?: any, error?: any) => {
    const result = {
      test,
      success,
      data,
      error: error?.message || error,
      timestamp: new Date().toISOString()
    };
    setTestResults(prev => [result, ...prev]);
    return result;
  };

  const testCalendarPermissions = async () => {
    setIsLoading(true);
    try {
      // Check if user is signed in
      if (!currentUser) {
        addTestResult('Authentication Check', false, null, 'User not signed in');
        return;
      }

      addTestResult('Authentication Check', true, { uid: currentUser.uid, email: currentUser.email });

      // Get access token
      const token = await currentUser.getIdToken();
      addTestResult('Firebase Token', true, { tokenExists: !!token });

      // Test calendar list endpoint
      const response = await fetch('/api/calendar/list', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const calendars = await response.json();
        addTestResult('Calendar List', true, calendars);
      } else {
        const error = await response.text();
        addTestResult('Calendar List', false, null, `HTTP ${response.status}: ${error}`);
      }

    } catch (error) {
      addTestResult('Calendar Permissions Test', false, null, error);
    } finally {
      setIsLoading(false);
    }
  };

  const testEventCreation = async () => {
    setIsLoading(true);
    try {
      if (!currentUser) {
        addTestResult('Event Creation', false, null, 'User not signed in');
        return;
      }

      const token = await currentUser.getIdToken();
      
      // Create test event
      const startDateTime = new Date(testEventData.startTime);
      const endDateTime = new Date(startDateTime.getTime() + testEventData.duration * 60 * 1000);

      const eventData = {
        summary: testEventData.title,
        description: testEventData.description,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
        }
      };

      const response = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(eventData)
      });

      if (response.ok) {
        const event = await response.json();
        addTestResult('Event Creation', true, event);
      } else {
        const error = await response.text();
        addTestResult('Event Creation', false, null, `HTTP ${response.status}: ${error}`);
      }

    } catch (error) {
      addTestResult('Event Creation', false, null, error);
    } finally {
      setIsLoading(false);
    }
  };

  const testUpcomingEvents = async () => {
    setIsLoading(true);
    try {
      if (!currentUser) {
        addTestResult('Upcoming Events', false, null, 'User not signed in');
        return;
      }

      const token = await currentUser.getIdToken();
      
      // Get events for next 7 days
      const timeMin = new Date().toISOString();
      const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const response = await fetch(`/api/calendar/events?timeMin=${timeMin}&timeMax=${timeMax}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const events = await response.json();
        addTestResult('Upcoming Events', true, events);
      } else {
        const error = await response.text();
        addTestResult('Upcoming Events', false, null, `HTTP ${response.status}: ${error}`);
      }

    } catch (error) {
      addTestResult('Upcoming Events', false, null, error);
    } finally {
      setIsLoading(false);
    }
  };

  const runAllTests = async () => {
    setTestResults([]);
    await testCalendarPermissions();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    await testUpcomingEvents();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    await testEventCreation();
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <Container fluid className="mt-4">
      <Row>
        <Col md={6}>
          <Card>
            <Card.Header>
              <h5 className="mb-0">Google Calendar API Integration Test</h5>
            </Card.Header>
            <Card.Body>
              <p className="text-muted">
                Test the Google Calendar API integration to ensure all endpoints are working correctly.
              </p>

              <div className="d-flex gap-2 mb-4">
                <Button 
                  variant="primary" 
                  onClick={runAllTests}
                  disabled={isLoading}
                >
                  {isLoading ? 'Running Tests...' : 'Run All Tests'}
                </Button>
                <Button 
                  variant="outline-secondary" 
                  onClick={testCalendarPermissions}
                  disabled={isLoading}
                >
                  Test Permissions
                </Button>
                <Button 
                  variant="outline-secondary" 
                  onClick={testUpcomingEvents}
                  disabled={isLoading}
                >
                  Test Events List
                </Button>
              </div>

              {/* Test Event Creation Form */}
              <Card className="mb-3">
                <Card.Header>
                  <h6 className="mb-0">Test Event Creation</h6>
                </Card.Header>
                <Card.Body>
                  <Form>
                    <Row>
                      <Col md={6}>
                        <Form.Group className="mb-2">
                          <Form.Label>Title</Form.Label>
                          <Form.Control
                            type="text"
                            value={testEventData.title}
                            onChange={(e) => setTestEventData(prev => ({...prev, title: e.target.value}))}
                          />
                        </Form.Group>
                      </Col>
                      <Col md={6}>
                        <Form.Group className="mb-2">
                          <Form.Label>Duration (minutes)</Form.Label>
                          <Form.Control
                            type="number"
                            value={testEventData.duration}
                            onChange={(e) => setTestEventData(prev => ({...prev, duration: parseInt(e.target.value)}))}
                          />
                        </Form.Group>
                      </Col>
                    </Row>
                    <Form.Group className="mb-2">
                      <Form.Label>Start Time</Form.Label>
                      <Form.Control
                        type="datetime-local"
                        value={testEventData.startTime}
                        onChange={(e) => setTestEventData(prev => ({...prev, startTime: e.target.value}))}
                      />
                    </Form.Group>
                    <Form.Group className="mb-2">
                      <Form.Label>Description</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={2}
                        value={testEventData.description}
                        onChange={(e) => setTestEventData(prev => ({...prev, description: e.target.value}))}
                      />
                    </Form.Group>
                    <Button 
                      variant="success" 
                      onClick={testEventCreation}
                      disabled={isLoading}
                    >
                      Create Test Event
                    </Button>
                  </Form>
                </Card.Body>
              </Card>

              {testResults.length > 0 && (
                <div className="d-flex justify-content-end">
                  <Button variant="outline-danger" size="sm" onClick={clearResults}>
                    Clear Results
                  </Button>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        <Col md={6}>
          <Card>
            <Card.Header>
              <h5 className="mb-0">Test Results</h5>
            </Card.Header>
            <Card.Body style={{ maxHeight: '600px', overflowY: 'auto' }}>
              {testResults.length === 0 ? (
                <p className="text-muted">No tests run yet. Click "Run All Tests" to start.</p>
              ) : (
                testResults.map((result, index) => (
                  <Alert 
                    key={index} 
                    variant={result.success ? 'success' : 'danger'}
                    className="mb-2"
                  >
                    <div className="d-flex justify-content-between align-items-start">
                      <strong>{result.test}</strong>
                      <small className="text-muted">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </small>
                    </div>
                    
                    {result.success ? (
                      <div className="mt-2">
                        <small className="text-success">✓ Success</small>
                        {result.data && (
                          <details className="mt-1">
                            <summary className="text-muted" style={{ cursor: 'pointer' }}>
                              View data
                            </summary>
                            <pre className="mt-1 p-2 bg-light rounded">
                              <code>{JSON.stringify(result.data, null, 2)}</code>
                            </pre>
                          </details>
                        )}
                      </div>
                    ) : (
                      <div className="mt-2">
                        <small className="text-danger">✗ Failed</small>
                        {result.error && (
                          <div className="mt-1">
                            <strong>Error:</strong> {result.error}
                          </div>
                        )}
                      </div>
                    )}
                  </Alert>
                ))
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default CalendarAPITest;

export {};
