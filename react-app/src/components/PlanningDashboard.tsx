import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Alert, Badge, ProgressBar, Table, Modal } from 'react-bootstrap';
import { db, functions } from '../firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { CalendarBlock, Task } from '../types';
import { isStatus, isTheme, isPriority, getStatusName, getThemeName, getPriorityName } from '../utils/statusHelpers';

const PlanningDashboard: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planningResult, setPlanningResult] = useState<any>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);

  // Load tasks and calendar blocks
  useEffect(() => {
    if (!currentUser) return;

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', 'in', ['planned', 'in_progress'])
    );

    const blocksQuery = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData: Task[] = [];
      snapshot.forEach((doc) => {
        tasksData.push({ id: doc.id, ...doc.data() } as Task);
      });
      setTasks(tasksData);
    });

    const unsubscribeBlocks = onSnapshot(blocksQuery, (snapshot) => {
      const blocksData: CalendarBlock[] = [];
      snapshot.forEach((doc) => {
        blocksData.push({ id: doc.id, ...doc.data() } as CalendarBlock);
      });
      setBlocks(blocksData);
    });

    return () => {
      unsubscribeTasks();
      unsubscribeBlocks();
    };
  }, [currentUser, currentPersona]);

  const handleGeneratePlan = async () => {
    if (!currentUser) return;

    setIsPlanning(true);
    try {
      const runPlanner = httpsCallable(functions, 'runPlanner');
      const startDate = new Date().toISOString().slice(0,10);
      const result = await runPlanner({ persona: currentPersona, startDate, days: 7 });
      setPlanningResult(result.data);
      setShowPlanModal(true);
    } catch (error) {
      console.error('Planning error:', error);
      alert('Failed to generate plan: ' + error.message);
    }
    setIsPlanning(false);
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

  const formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  const getScoreColor = (score: number) => {
    if (score >= 0.8) return 'success';
    if (score >= 0.6) return 'warning';
    return 'danger';
  };

  return (
    <Container fluid className="mt-4">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <h2>AI Planning Dashboard - {currentPersona === 'personal' ? 'Personal' : 'Work'}</h2>
        <Button 
          variant="primary" 
          onClick={handleGeneratePlan}
          disabled={isPlanning || tasks.length === 0}
        >
          {isPlanning ? 'Planning...' : 'Generate AI Plan'}
        </Button>
      </div>

      <Row>
        {/* Tasks Ready for Planning */}
        <Col md={6}>
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">Tasks Ready for Planning ({tasks.length})</h5>
            </Card.Header>
            <Card.Body>
              {tasks.length === 0 ? (
                <Alert variant="info">
                  No tasks available for planning. Add some tasks first!
                </Alert>
              ) : (
                <Table size="sm" striped>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Effort</th>
                      <th>Priority</th>
                      <th>Theme</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.slice(0, 10).map(task => (
                      <tr key={task.id}>
                        <td>{task.title}</td>
                        <td>
                          <Badge bg="outline-secondary">{task.effort}</Badge>
                        </td>
                        <td>
                          <Badge bg={isPriority(task.priority, 'high') ? 'orange' : isPriority(task.priority, 'med') ? 'warning' : 'info'}>
                            {task.priority}
                          </Badge>
                        </td>
                        <td>
                          {task.theme && getThemeBadge(getThemeName(task.theme))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
              {tasks.length > 10 && (
                <small className="text-muted">... and {tasks.length - 10} more tasks</small>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Current Calendar Blocks */}
        <Col md={6}>
          <Card className="mb-4">
            <Card.Header>
              <h5 className="mb-0">Scheduled Blocks ({blocks.length})</h5>
            </Card.Header>
            <Card.Body>
              {blocks.length === 0 ? (
                <Alert variant="info">
                  No calendar blocks scheduled yet. Generate a plan to get started!
                </Alert>
              ) : (
                <Table size="sm" striped>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Category</th>
                      <th>Theme</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {blocks
                      .sort((a, b) => a.start - b.start)
                      .slice(0, 10)
                      .map(block => (
                        <tr key={block.id}>
                          <td>
                            <small>{formatDateTime(block.start)}</small>
                          </td>
                          <td>{block.category}</td>
                          <td>{getThemeBadge(block.theme)}</td>
                          <td>
                            <Badge bg={block.status === 'applied' ? 'success' : 'warning'}>
                              {block.status}
                            </Badge>
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

      {/* Planning Result Modal */}
      <Modal show={showPlanModal} onHide={() => setShowPlanModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>AI Planning Result</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {planningResult && (
            <>
              <Alert variant={planningResult.applied ? 'success' : 'info'}>
                <strong>Plan Status:</strong> {planningResult.applied ? 'Applied automatically' : 'Needs review'}
                <br />
                <strong>Score:</strong> 
                <ProgressBar 
                  now={planningResult.score * 100} 
                  variant={getScoreColor(planningResult.score)}
                  className="mt-2"
                  label={`${Math.round(planningResult.score * 100)}%`}
                />
              </Alert>

              {planningResult.rationale && (
                <Card className="mb-3">
                  <Card.Header>
                    <strong>AI Rationale</strong>
                  </Card.Header>
                  <Card.Body>
                    <p>{planningResult.rationale}</p>
                  </Card.Body>
                </Card>
              )}

              {planningResult.validator?.errors?.length > 0 && (
                <Alert variant="danger">
                  <strong>Validation Errors:</strong>
                  <ul className="mb-0 mt-2">
                    {planningResult.validator.errors.map((error, idx) => (
                      <li key={idx}>{error}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              {planningResult.validator?.warnings?.length > 0 && (
                <Alert variant="warning">
                  <strong>Warnings:</strong>
                  <ul className="mb-0 mt-2">
                    {planningResult.validator.warnings.map((warning, idx) => (
                      <li key={idx}>{warning}</li>
                    ))}
                  </ul>
                </Alert>
              )}

              <Card>
                <Card.Header>
                  <strong>Proposed Blocks ({planningResult.proposedBlocks?.length || 0})</strong>
                </Card.Header>
                <Card.Body>
                  {planningResult.proposedBlocks?.length === 0 ? (
                    <p className="text-muted">No blocks proposed.</p>
                  ) : (
                    <Table size="sm" striped>
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Theme</th>
                          <th>Category</th>
                          <th>Rationale</th>
                        </tr>
                      </thead>
                      <tbody>
                        {planningResult.proposedBlocks.map((block, idx) => (
                          <tr key={idx}>
                            <td>
                              <small>
                                {formatDateTime(block.start)} - {formatDateTime(block.end)}
                              </small>
                            </td>
                            <td>{getThemeBadge(block.theme)}</td>
                            <td>{block.category}</td>
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
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowPlanModal(false)}>
            Close
          </Button>
          {planningResult && !planningResult.applied && planningResult.score > 0.6 && (
            <Button variant="primary">
              Apply Plan
            </Button>
          )}
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default PlanningDashboard;

export {};
