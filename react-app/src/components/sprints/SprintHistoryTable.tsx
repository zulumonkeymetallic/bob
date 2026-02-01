import React, { useState, useEffect } from 'react';
import { Card, Table, Badge, Row, Col, Spinner, Button, ButtonGroup } from 'react-bootstrap';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';
import { db } from '../../firebase';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { TrendingUp, Calendar, Target, Users, BarChart3, Eye } from 'lucide-react';

interface SprintMetricsSnapshot {
  id: string;
  sprintId: string;
  sprintName: string;
  completionDate: number;
  storyProgress: number;
  taskProgress: number;
  totalStories: number;
  completedStories: number;
  totalTasks: number;
  completedTasks: number;
  totalPoints: number;
  completedPoints: number;
  totalCapacityHours: number;
  usedCapacityHours: number;
  capacityUtilization: number;
  daysTotal: number;
  daysUsed: number;
  goalsCovered: number;
  openStoriesCount: number;
  openTasksCount: number;
  retrospective?: {
    wentWell: string;
    toImprove: string;
    blockers: string;
    learnings: string;
    nextSprintFocus: string;
  };
}

interface SprintHistoryTableProps {
  className?: string;
}

const SprintHistoryTable: React.FC<SprintHistoryTableProps> = ({ className = '' }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  const [sprintClosures, setSprintClosures] = useState<SprintMetricsSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClosure, setSelectedClosure] = useState<SprintMetricsSnapshot | null>(null);
  const [viewMode, setViewMode] = useState<'table' | 'details'>('table');

  useEffect(() => {
    if (!currentUser || !currentPersona) {
      setLoading(false);
      return;
    }

    const closuresQuery = query(
      collection(db, 'sprint_closures'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('completionDate', 'desc')
    );

    const unsubscribe = onSnapshot(closuresQuery, (snapshot) => {
      const closures = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as SprintMetricsSnapshot[];
      
      setSprintClosures(closures);
      setLoading(false);
    });

    return unsubscribe;
  }, [currentUser, currentPersona]);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getProgressColor = (percentage: number) => {
    if (percentage >= 80) return 'success';
    if (percentage >= 60) return 'warning';
    return 'danger';
  };

  const calculateVelocity = (closure: SprintMetricsSnapshot) => {
    if (closure.daysUsed === 0) return 0;
    return Math.round((closure.completedPoints / closure.daysUsed) * 10) / 10;
  };

  const getEfficiencyScore = (closure: SprintMetricsSnapshot) => {
    const storyEfficiency = closure.storyProgress;
    const capacityEfficiency = closure.capacityUtilization;
    const timeEfficiency = closure.daysUsed <= closure.daysTotal ? 100 : Math.max(0, 100 - ((closure.daysUsed - closure.daysTotal) / closure.daysTotal) * 50);
    
    return Math.round((storyEfficiency + capacityEfficiency + timeEfficiency) / 3);
  };

  if (loading) {
    return (
      <Card className={className}>
        <Card.Body className="text-center py-5">
          <Spinner animation="border" />
          <p className="mt-2 text-muted">Loading sprint history...</p>
        </Card.Body>
      </Card>
    );
  }

  if (sprintClosures.length === 0) {
    return (
      <Card className={className}>
        <Card.Header>
          <h5 className="mb-0">📊 Sprint History & Metrics</h5>
        </Card.Header>
        <Card.Body className="text-center py-5">
          <BarChart3 size={48} className="text-muted mb-3" />
          <h6 className="text-muted">No Sprint History Available</h6>
          <p className="text-muted small">
            Sprint metrics will appear here after you close your first sprint with the new closure feature.
          </p>
        </Card.Body>
      </Card>
    );
  }

  const latestClosure = sprintClosures[0];
  const averageStoryCompletion = Math.round(
    sprintClosures.reduce((sum, c) => sum + c.storyProgress, 0) / sprintClosures.length
  );
  const averageVelocity = Math.round(
    sprintClosures.reduce((sum, c) => sum + calculateVelocity(c), 0) / sprintClosures.length * 10
  ) / 10;

  return (
    <div className={className}>
      {/* Summary Cards */}
      <Row className="mb-4">
        <Col md={3}>
          <Card className="border-primary">
            <Card.Body className="text-center p-3">
              <TrendingUp size={24} className="text-primary mb-2" />
              <h5 className="mb-1">{averageStoryCompletion}%</h5>
              <small className="text-muted">Avg Completion</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-success">
            <Card.Body className="text-center p-3">
              <Target size={24} className="text-success mb-2" />
              <h5 className="mb-1">{averageVelocity}</h5>
              <small className="text-muted">Avg Velocity</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-warning">
            <Card.Body className="text-center p-3">
              <Calendar size={24} className="text-warning mb-2" />
              <h5 className="mb-1">{sprintClosures.length}</h5>
              <small className="text-muted">Sprints Closed</small>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="border-info">
            <Card.Body className="text-center p-3">
              <Users size={24} className="text-info mb-2" />
              <h5 className="mb-1">{latestClosure.storyProgress}%</h5>
              <small className="text-muted">Latest Sprint</small>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Main Content */}
      <Card>
        <Card.Header>
          <div className="d-flex justify-content-between align-items-center">
            <h5 className="mb-0">📊 Sprint History & Metrics</h5>
            <ButtonGroup size="sm">
              <Button 
                variant={viewMode === 'table' ? 'primary' : 'outline-primary'}
                onClick={() => setViewMode('table')}
              >
                <BarChart3 size={16} className="me-1" />
                Table View
              </Button>
              <Button 
                variant={viewMode === 'details' ? 'primary' : 'outline-primary'}
                onClick={() => setViewMode('details')}
                disabled={!selectedClosure}
              >
                <Eye size={16} className="me-1" />
                Details
              </Button>
            </ButtonGroup>
          </div>
        </Card.Header>
        <Card.Body>
          {viewMode === 'table' ? (
            <div className="table-responsive">
              <Table hover size="sm">
                <thead>
                  <tr>
                    <th>Sprint</th>
                    <th>Closed</th>
                    <th>Stories</th>
                    <th>Tasks</th>
                    <th>Points</th>
                    <th>Velocity</th>
                    <th>Capacity</th>
                    <th>Efficiency</th>
                    <th>Duration</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sprintClosures.map((closure) => (
                    <tr key={closure.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedClosure(closure)}>
                      <td>
                        <strong>{closure.sprintName}</strong>
                      </td>
                      <td>{formatDate(closure.completionDate)}</td>
                      <td>
                        <Badge bg={getProgressColor(closure.storyProgress)}>
                          {closure.storyProgress}%
                        </Badge>
                        <br />
                        <small className="text-muted">
                          {closure.completedStories}/{closure.totalStories}
                        </small>
                      </td>
                      <td>
                        <Badge bg={getProgressColor(closure.taskProgress)}>
                          {closure.taskProgress}%
                        </Badge>
                        <br />
                        <small className="text-muted">
                          {closure.completedTasks}/{closure.totalTasks}
                        </small>
                      </td>
                      <td>
                        <strong>{closure.completedPoints}/{closure.totalPoints}</strong>
                        <br />
                        <small className="text-muted">
                          {Math.round((closure.completedPoints / closure.totalPoints) * 100) || 0}%
                        </small>
                      </td>
                      <td>
                        <strong>{calculateVelocity(closure)}</strong>
                        <br />
                        <small className="text-muted">pts/day</small>
                      </td>
                      <td>
                        <Badge bg={getProgressColor(closure.capacityUtilization)}>
                          {closure.capacityUtilization}%
                        </Badge>
                        <br />
                        <small className="text-muted">
                          {closure.usedCapacityHours}h/{closure.totalCapacityHours}h
                        </small>
                      </td>
                      <td>
                        <Badge bg={getProgressColor(getEfficiencyScore(closure))}>
                          {getEfficiencyScore(closure)}%
                        </Badge>
                      </td>
                      <td>
                        <strong>{closure.daysUsed}/{closure.daysTotal}</strong>
                        <br />
                        <small className="text-muted">days</small>
                      </td>
                      <td>
                        <Button 
                          size="sm" 
                          variant="outline-primary"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedClosure(closure);
                            setViewMode('details');
                          }}
                        >
                          <Eye size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          ) : (
            selectedClosure && (
              <div>
                <h6 className="mb-3">📋 {selectedClosure.sprintName} - Details</h6>
                <p className="text-muted">Closed on {formatDate(selectedClosure.completionDate)}</p>

                <Row>
                  <Col md={6}>
                    <h6 className="text-success">✅ What went well</h6>
                    <p className="small">{selectedClosure.retrospective?.wentWell || 'No notes provided'}</p>

                    <h6 className="text-warning">🔄 What to improve</h6>
                    <p className="small">{selectedClosure.retrospective?.toImprove || 'No notes provided'}</p>

                    <h6 className="text-danger">🚧 Blockers</h6>
                    <p className="small">{selectedClosure.retrospective?.blockers || 'No notes provided'}</p>
                  </Col>
                  <Col md={6}>
                    <h6 className="text-info">💡 Key learnings</h6>
                    <p className="small">{selectedClosure.retrospective?.learnings || 'No notes provided'}</p>

                    <h6 className="text-primary">🎯 Next sprint focus</h6>
                    <p className="small">{selectedClosure.retrospective?.nextSprintFocus || 'No notes provided'}</p>

                    <div className="mt-4 p-3 bg-light rounded">
                      <h6>📊 Key Metrics Summary</h6>
                      <ul className="list-unstyled small">
                        <li><strong>Goals covered:</strong> {selectedClosure.goalsCovered}</li>
                        <li><strong>Open work migrated:</strong> {selectedClosure.openStoriesCount} stories, {selectedClosure.openTasksCount} tasks</li>
                        <li><strong>Efficiency score:</strong> {getEfficiencyScore(selectedClosure)}%</li>
                        <li><strong>Velocity:</strong> {calculateVelocity(selectedClosure)} points/day</li>
                      </ul>
                    </div>
                  </Col>
                </Row>
              </div>
            )
          )}
        </Card.Body>
      </Card>
    </div>
  );
};

export default SprintHistoryTable;