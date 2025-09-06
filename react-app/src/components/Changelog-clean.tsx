import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Alert, ProgressBar } from 'react-bootstrap';
import { fetchProjectStatus, ProjectStats } from '../services/dataService';
import { useTheme } from '../contexts/ModernThemeContext';

const Changelog: React.FC = () => {
  const { theme } = useTheme();
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    loadProjectStatus();
  }, []);

  const loadProjectStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const stats = await fetchProjectStatus();
      setProjectStats(stats);
    } catch (err) {
      setError('Failed to load project status');
      console.error('Error loading project status:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container className="mt-4">
        <div className="text-center">
          <div className="spinner-border" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-2">Loading project status...</p>
        </div>
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="mt-4">
        <Alert variant="danger">
          <Alert.Heading>Error Loading Data</Alert.Heading>
          <p>{error}</p>
          <Button variant="outline-danger" onClick={loadProjectStatus}>
            Retry
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="mt-4">
      {projectStats && (
        <>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>📈 Project Status & Changelog</h2>
            <Button variant="outline-primary" size="sm" onClick={loadProjectStatus}>
              🔄 Refresh
            </Button>
          </div>

          {/* Live Project Status Cards */}
          <Row className="mb-4">
            <Col md={6}>
              <Card className="h-100">
                <Card.Header className="bg-danger text-white">
                  <h5 className="mb-0">🔥 Critical Defects</h5>
                </Card.Header>
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <span className="h6">Progress</span>
                    <span className="h5 text-success mb-0">{projectStats.criticalCompletionRate.toFixed(1)}%</span>
                  </div>
                  <ProgressBar 
                    now={projectStats.criticalCompletionRate} 
                    variant={projectStats.criticalCompletionRate > 80 ? 'success' : 'warning'}
                    className="mb-3"
                  />
                  <p className="text-muted">
                    {projectStats.completedCriticalDefects} of {projectStats.totalCriticalDefects} critical defects resolved
                  </p>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={6}>
              <Card className="h-100">
                <Card.Header className="bg-info text-white">
                  <h5 className="mb-0">🚀 Weekend Sprint</h5>
                </Card.Header>
                <Card.Body>
                  <div className="d-flex justify-content-between align-items-center mb-3">
                    <span className="h6">Progress</span>
                    <span className="h5 text-info mb-0">{projectStats.weekendCompletionRate.toFixed(1)}%</span>
                  </div>
                  <ProgressBar 
                    now={projectStats.weekendCompletionRate} 
                    variant="info"
                    className="mb-3"
                  />
                  <p className="text-muted">
                    {projectStats.completedWeekendItems} of {projectStats.totalWeekendItems} weekend items completed
                  </p>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Recent Updates & Next Priorities */}
          <Row className="mb-4">
            <Col md={6}>
              <Card>
                <Card.Header className="bg-success text-white">
                  <h5 className="mb-0">✅ Recent Completions</h5>
                </Card.Header>
                <Card.Body>
                  {projectStats.recentUpdates.length > 0 ? (
                    <ul className="list-unstyled mb-0">
                      {projectStats.recentUpdates.map((update, index) => (
                        <li key={index} className="mb-2">
                          <i className="fas fa-check-circle text-success me-2"></i>
                          {update}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted mb-0">No recent completions</p>
                  )}
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={6}>
              <Card>
                <Card.Header className="bg-warning text-dark">
                  <h5 className="mb-0">⏳ Next Priorities</h5>
                </Card.Header>
                <Card.Body>
                  {projectStats.nextPriorities.length > 0 ? (
                    <ul className="list-unstyled mb-0">
                      {projectStats.nextPriorities.map((priority, index) => (
                        <li key={index} className="mb-2">
                          <i className="fas fa-clock text-warning me-2"></i>
                          {priority}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted mb-0">All priorities completed!</p>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* Version History */}
      <Card>
        <Card.Header>
          <h5 className="mb-0">📝 Version History & Recent Updates</h5>
        </Card.Header>
        <Card.Body>
          <div className="mb-4">
            <h6 className="text-primary">🚀 Version 2.1.0 - Major UX & Feature Enhancements - August 29, 2025</h6>
            <div className="row">
              <div className="col-md-6">
                <strong className="text-success">✅ New Features</strong>
                <ul>
                  <li>🎮 Personal Backlogs Manager (Games, Movies, Books)</li>
                  <li>📱 Mobile Priority Dashboard with touch optimization</li>
                  <li>🗺️ Visual Canvas for goal-story-task mapping</li>
                  <li>🎯 Smart device detection and adaptive UI</li>
                  <li>✅ Touch-friendly task completion</li>
                </ul>
              </div>
              <div className="col-md-6">
                <strong className="text-warning">🔧 Major Fixes</strong>
                <ul>
                  <li>🌙 Fixed dark mode table display issues</li>
                  <li>📱 Enhanced mobile drag & drop support</li>
                  <li>📊 Fixed live data display (87.5% vs 24%)</li>
                  <li>✨ Improved UI consistency and accessibility</li>
                  <li>🖱️ Better drag handles and visual feedback</li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className="mb-4">
            <h6>Version 2.0.2 - Enhanced Development Tracking - August 28, 2025</h6>
            <ul>
              <li>✅ Live PROJECT_STATUS.md Integration with real-time progress</li>
              <li>✅ Automated Dev Tracking Sync with dynamic completion percentages</li>
              <li>✅ Enhanced Live Metrics with auto-refresh functionality</li>
              <li>✅ Improved react-beautiful-dnd drag & drop implementation</li>
            </ul>
          </div>
          
          <div className="mb-4">
            <h6>Version 0.2.0 - Core Features - August 27, 2025</h6>
            <ul>
              <li>✅ Complete Firebase authentication and data management</li>
              <li>✅ Kanban board with story management</li>
              <li>✅ Goal and task tracking systems</li>
              <li>✅ Mobile-responsive design improvements</li>
            </ul>
          </div>
          
          <div>
            <h6>Version 0.1.0 - Initial Release - August 26, 2025</h6>
            <ul>
              <li>Initial React app structure with TypeScript</li>
              <li>Firebase authentication integration</li>
              <li>Basic routing and navigation</li>
              <li>Theme support (light/dark mode)</li>
            </ul>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Changelog;

export {};
