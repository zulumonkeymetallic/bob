import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Alert, ProgressBar } from 'react-bootstrap';
import { fetchProjectStatus, ProjectStats } from '../services/dataService';

const Changelog: React.FC = () => {
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
          {/* Current Version Alert */}
          <Alert variant="success" className="mb-4">
            <Alert.Heading>� Version 2.1.4 - Phase 1 Critical Fixes Complete!</Alert.Heading>
            <p>
              <strong>DEPLOYED:</strong> Phase 1 critical fixes addressing immediate usability issues:
            </p>
            <ul className="mb-3">
              <li><strong>C41:</strong> ✅ Theme color save functionality restored (Firebase rules fixed)</li>
              <li><strong>C42:</strong> ✅ Developer Status menu item restored to navigation</li>
              <li><strong>C43:</strong> ✅ Admin menu item removed and renamed to Developer Status</li>
              <li><strong>Navigation:</strong> ✅ Clean Notion AI inspired interface with proper hover effects</li>
            </ul>
            <hr />
            <p className="mb-0">
              <strong>Next Phase:</strong> Sprint Modal Fix (C35), Comments System (C39), Reference Numbers (C40)
            </p>
          </Alert>

          {/* Previous Critical Defects Alert */}
          <Alert variant="warning" className="mb-4">
            <Alert.Heading>⚠️ Version 2.1.3 - Navigation & Task Editing Complete</Alert.Heading>
            <p>
              Previous deployment successfully resolved core navigation and kanban functionality:
            </p>
            <ul className="mb-3">
              <li><strong>C36:</strong> ✅ White menu text visibility fixed (Notion AI styling)</li>
              <li><strong>C37:</strong> ✅ Task editing functionality on kanban board</li>
              <li><strong>C38:</strong> ✅ Status dropdown implementation with proper validation</li>
              <li><strong>Git Backup:</strong> ✅ Automated backup and versioning strategy</li>
            </ul>
          </Alert>
          
          <div className="mb-4">
            <h6 className="text-primary">🚀 Version 2.1.0 - MAJOR RELEASE: Personal Backlogs, Mobile UX & Visual Canvas - August 29, 2025</h6>
            <div className="row">
              <div className="col-md-6">
                <strong className="text-success">✅ NEW FEATURES</strong>
                <ul>
                  <li>🎮 <strong>Personal Backlogs Manager</strong> - Steam games, Trakt movies/shows, books collections</li>
                  <li>📱 <strong>Mobile Priority Dashboard</strong> - Touch-optimized daily task management</li>
                  <li>🗺️ <strong>Visual Canvas</strong> - Interactive goal-story-task mind mapping with zoom/pan</li>
                  <li>🎯 <strong>Device Detection System</strong> - Auto-responsive UI for mobile/tablet/desktop</li>
                  <li>✅ <strong>Enhanced Mobile UX</strong> - Touch-friendly interfaces throughout</li>
                  <li>🌙 <strong>Dark Mode Accessibility</strong> - Fixed white tables, proper contrast ratios</li>
                  <li>📱 <strong>Improved Drag & Drop</strong> - Mobile touch support with enhanced handles</li>
                </ul>
              </div>
              <div className="col-md-6">
                <strong className="text-warning">🔧 CRITICAL FIXES & ENHANCEMENTS</strong>
                <ul>
                  <li>🌙 <strong>Dark Mode Tables</strong> - Fixed white backgrounds with gray text (unreadable)</li>
                  <li>📱 <strong>Mobile Drag & Drop</strong> - Touch events and enhanced handles</li>
                  <li>📊 <strong>Accessibility</strong> - Proper contrast ratios and readability</li>
                  <li>✨ <strong>UI Consistency</strong> - Responsive design across all devices</li>
                  <li>🖱️ <strong>Enhanced Interactions</strong> - Better visual feedback and usability</li>
                  <li>🎯 <strong>Device-Aware Navigation</strong> - Context-sensitive menu and interfaces</li>
                </ul>
              </div>
            </div>
            <div className="mt-3">
              <Alert variant="success">
                <strong>🎉 Major Milestone Achieved!</strong> Version 2.1.0 addresses all user-reported accessibility issues 
                and adds comprehensive personal collection management, mobile optimization, and visual project mapping capabilities.
                <br/><br/>
                <strong>Live at:</strong> <a href="https://bob20250810.web.app" target="_blank" rel="noopener noreferrer">
                  https://bob20250810.web.app
                </a>
              </Alert>
              
              <Alert variant="info" className="mt-3">
                <strong>🔄 Version 2.1.5 - Modern UI Restoration - August 31, 2025</strong>
                <br/>
                Successfully restored modern UI components from backup branch after deployment reversion. 
                All modern table views, inline editing functionality, and comprehensive testing framework restored.
                <br/><br/>
                <strong>✅ Restored Features:</strong>
                <ul className="mb-0 mt-2">
                  <li>Modern table views with inline editing for Goals, Stories, and Tasks</li>
                  <li>Comprehensive CoreFunctionalityTest suite with 40+ individual tests</li>
                  <li>Dynamic sidebar resizing and activity stream integration</li>
                  <li>Advanced drag & drop functionality with @dnd-kit integration</li>
                  <li>Professional icon sets (Lucide React & React Bootstrap Icons)</li>
                  <li>Real-time data synchronization and responsive design verification</li>
                </ul>
              </Alert>
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
