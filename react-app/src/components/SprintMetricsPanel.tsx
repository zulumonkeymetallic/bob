import React, { useMemo } from 'react';
import { Card, Row, Col, Badge, ProgressBar } from 'react-bootstrap';
import { Calendar, Target, Clock, TrendingUp, CheckCircle, AlertTriangle } from 'lucide-react';
import { Sprint, Story, Task } from '../types';
import { useTheme } from '../contexts/ModernThemeContext';

interface SprintMetricsPanelProps {
  sprint: Sprint;
  stories: Story[];
  tasks: Task[];
  goals: any[];
}

interface SprintMetrics {
  daysLeft: number;
  totalDays: number;
  progress: number;
  openStories: number;
  completedStories: number;
  openTasks: number;
  completedTasks: number;
  totalPoints: number;
  completedPoints: number;
  averageVelocity: number;
  burndownData: {
    planned: number;
    actual: number;
    trend: 'on-track' | 'ahead' | 'behind';
  };
}

const SprintMetricsPanel: React.FC<SprintMetricsPanelProps> = ({
  sprint,
  stories,
  tasks,
  goals
}) => {
  const { theme } = useTheme();
  const metrics = useMemo((): SprintMetrics => {
    const now = new Date();
    const startDate = new Date(sprint.startDate);
    const endDate = new Date(sprint.endDate);
    
    // Calculate days
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    const daysElapsed = Math.max(0, Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)));
    const daysLeft = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
    
    // Story metrics
    const sprintStories = stories.filter(story => story.sprintId === sprint.id);
    const openStories = sprintStories.filter(story => story.status !== 4).length; // Not Done
    const completedStories = sprintStories.filter(story => story.status === 4).length; // Done
    
    // Task metrics
    const sprintTasks = tasks.filter(task => {
      // Task is linked to a story in this sprint
      const parentStory = sprintStories.find(story => story.id === task.parentId && task.parentType === 'story');
      return !!parentStory;
    });
    const openTasks = sprintTasks.filter(task => task.status !== 2).length; // Not Done
    const completedTasks = sprintTasks.filter(task => task.status === 2).length; // Done
    
    // Points calculation
    const totalPoints = sprintStories.reduce((sum, story) => sum + (story.points || 0), 0);
    const completedPoints = sprintStories
      .filter(story => story.status === 4)
      .reduce((sum, story) => sum + (story.points || 0), 0);
    
    // Progress calculation
    const storyProgress = sprintStories.length > 0 ? (completedStories / sprintStories.length) * 100 : 0;
    const taskProgress = sprintTasks.length > 0 ? (completedTasks / sprintTasks.length) * 100 : 0;
    const pointsProgress = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
    const progress = Math.round((storyProgress + taskProgress + pointsProgress) / 3);
    
    // Burndown calculation
    const expectedProgress = totalDays > 0 ? (daysElapsed / totalDays) * 100 : 0;
    const actualProgress = progress;
    
    let trend: 'on-track' | 'ahead' | 'behind' = 'on-track';
    if (actualProgress > expectedProgress + 10) trend = 'ahead';
    else if (actualProgress < expectedProgress - 10) trend = 'behind';
    
    // Velocity (points per day)
    const averageVelocity = daysElapsed > 0 ? completedPoints / daysElapsed : 0;
    
    return {
      daysLeft,
      totalDays,
      progress,
      openStories,
      completedStories,
      openTasks,
      completedTasks,
      totalPoints,
      completedPoints,
      averageVelocity,
      burndownData: {
        planned: Math.round(expectedProgress),
        actual: Math.round(actualProgress),
        trend
      }
    };
  }, [sprint, stories, tasks]);

  const getStatusColor = (status: 'active' | 'planning' | 'complete' | 'cancelled') => {
    switch (status) {
      case 'active': return 'success';
      case 'planning': return 'warning';
      case 'complete': return 'primary';
      case 'cancelled': return 'danger';
      default: return 'secondary';
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'ahead': return 'success';
      case 'behind': return 'danger';
      default: return 'info';
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const sprintStatusName = (status: number) => {
    switch (status) {
      case 0: return 'Planning';
      case 1: return 'Active';
      case 2: return 'Complete';
      case 3: return 'Cancelled';
      default: return 'Unknown';
    }
  };

  return (
    <Card className="sprint-metrics-panel mb-4">
      <Card.Header>
        <div className="d-flex justify-content-between align-items-center">
          <div>
            <h5 className="mb-0 d-flex align-items-center gap-2">
              <Target size={20} />
              {sprint.name} - Sprint Metrics
            </h5>
            <small className="text-muted">
              {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}
            </small>
          </div>
          <Badge bg={getStatusColor(sprintStatusName(sprint.status).toLowerCase() as any)}>
            {sprintStatusName(sprint.status)}
          </Badge>
        </div>
      </Card.Header>
      <Card.Body>
        <Row className="g-3">
          {/* Time Metrics */}
          <Col md={6} lg={3}>
            <Card className="h-100 border-left-primary">
              <Card.Body className="text-center">
                <Clock size={24} className="text-primary mb-2" />
                <h3 className="mb-0 text-primary">{metrics.daysLeft}</h3>
                <small className="text-muted">Days Left</small>
                <div className="mt-2">
                  <ProgressBar 
                    now={metrics.totalDays > 0 ? ((metrics.totalDays - metrics.daysLeft) / metrics.totalDays) * 100 : 0}
                    variant="primary"
                    style={{ height: '6px' }}
                  />
                  <small className="text-muted">
                    {metrics.totalDays - metrics.daysLeft} / {metrics.totalDays} days
                  </small>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Story Metrics */}
          <Col md={6} lg={3}>
            <Card className="h-100 border-left-info">
              <Card.Body className="text-center">
                <CheckCircle size={24} className="text-info mb-2" />
                <h3 className="mb-0 text-info">{metrics.openStories}</h3>
                <small className="text-muted">Open Stories</small>
                <div className="mt-2">
                  <ProgressBar 
                    now={metrics.openStories + metrics.completedStories > 0 ? 
                      (metrics.completedStories / (metrics.openStories + metrics.completedStories)) * 100 : 0}
                    variant="info"
                    style={{ height: '6px' }}
                  />
                  <small className="text-muted">
                    {metrics.completedStories} / {metrics.openStories + metrics.completedStories} done
                  </small>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Task Metrics */}
          <Col md={6} lg={3}>
            <Card className="h-100 border-left-warning">
              <Card.Body className="text-center">
                <AlertTriangle size={24} className="text-warning mb-2" />
                <h3 className="mb-0 text-warning">{metrics.openTasks}</h3>
                <small className="text-muted">Open Tasks</small>
                <div className="mt-2">
                  <ProgressBar 
                    now={metrics.openTasks + metrics.completedTasks > 0 ? 
                      (metrics.completedTasks / (metrics.openTasks + metrics.completedTasks)) * 100 : 0}
                    variant="warning"
                    style={{ height: '6px' }}
                  />
                  <small className="text-muted">
                    {metrics.completedTasks} / {metrics.openTasks + metrics.completedTasks} done
                  </small>
                </div>
              </Card.Body>
            </Card>
          </Col>

          {/* Progress Metrics */}
          <Col md={6} lg={3}>
            <Card className="h-100 border-left-success">
              <Card.Body className="text-center">
                <TrendingUp size={24} className="text-success mb-2" />
                <h3 className="mb-0 text-success">{metrics.progress}%</h3>
                <small className="text-muted">Overall Progress</small>
                <div className="mt-2">
                  <ProgressBar 
                    now={metrics.progress}
                    variant="success"
                    style={{ height: '6px' }}
                  />
                  <small className="text-muted">
                    {metrics.completedPoints} / {metrics.totalPoints} points
                  </small>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Burndown Overview */}
        <Row className="mt-4">
          <Col>
            <Card className="bg-light">
              <Card.Body>
                <h6 className="mb-3 d-flex align-items-center gap-2">
                  <TrendingUp size={16} />
                  Sprint Burndown Analysis
                </h6>
                <Row className="text-center">
                  <Col md={4}>
                    <div>
                      <h5 className="mb-0">{metrics.burndownData.planned}%</h5>
                      <small className="text-muted">Expected Progress</small>
                    </div>
                  </Col>
                  <Col md={4}>
                    <div>
                      <h5 className="mb-0">{metrics.burndownData.actual}%</h5>
                      <small className="text-muted">Actual Progress</small>
                    </div>
                  </Col>
                  <Col md={4}>
                    <div>
                      <Badge bg={getTrendColor(metrics.burndownData.trend)} className="fs-6">
                        {metrics.burndownData.trend.toUpperCase()}
                      </Badge>
                      <small className="text-muted d-block">Sprint Trend</small>
                    </div>
                  </Col>
                </Row>
                
                {metrics.averageVelocity > 0 && (
                  <div className="mt-3 text-center">
                    <small className="text-muted">
                      Average Velocity: <strong>{metrics.averageVelocity.toFixed(1)} points/day</strong>
                    </small>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
};

export default SprintMetricsPanel;
