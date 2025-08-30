import React, { useState, useEffect } from 'react';
import { Modal, Button, Alert, Table, Card, Row, Col, ProgressBar } from 'react-bootstrap';
import { VERSION, BUILD_TIME } from '../version';
import { fetchProjectStatus, ProjectStats } from '../services/dataService';

interface DevToolsProps {
  show: boolean;
  onHide: () => void;
}

const DevTools: React.FC<DevToolsProps> = ({ show, onHide }) => {
  const [cacheInfo, setCacheInfo] = useState<any[]>([]);
  const [message, setMessage] = useState<string>('');
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    if (show) {
      loadProjectStats();
    }
  }, [show]);

  const loadProjectStats = async () => {
    setLoadingStats(true);
    try {
      const stats = await fetchProjectStatus();
      setProjectStats(stats);
    } catch (error) {
      console.error('Error loading project stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  const getCacheInfo = async () => {
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      const info = [];
      
      for (const name of cacheNames) {
        const cache = await caches.open(name);
        const keys = await cache.keys();
        info.push({
          name,
          entries: keys.length,
          urls: keys.map(req => req.url).slice(0, 5) // First 5 URLs
        });
      }
      
      setCacheInfo(info);
    }
  };

  const clearAllCaches = async () => {
    try {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        setMessage('✅ All caches cleared successfully');
        setCacheInfo([]);
      }
      
      // Clear localStorage
      localStorage.clear();
      
      // Clear sessionStorage  
      sessionStorage.clear();
      
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      setMessage('❌ Failed to clear caches: ' + error.message);
    }
  };

  const forceReload = () => {
    // Clear everything and reload
    localStorage.clear();
    sessionStorage.clear();
    
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(registrations => {
        registrations.forEach(registration => registration.unregister());
      });
    }
    
    window.location.href = window.location.href + '?_bust=' + Date.now();
  };

  const showAppInfo = () => {
    const info = {
      version: VERSION,
      buildTime: BUILD_TIME,
      userAgent: navigator.userAgent,
      localStorage: Object.keys(localStorage).length + ' items',
      sessionStorage: Object.keys(sessionStorage).length + ' items',
      currentUrl: window.location.href,
      timestamp: new Date().toISOString()
    };
    
    console.table(info);
    setMessage('📋 App info logged to console');
  };

  React.useEffect(() => {
    if (show) {
      getCacheInfo();
    }
  }, [show]);

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>🔧 Developer Tools</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {/* Project Status Section */}
        <div className="mb-4">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <h6>📊 Project Status</h6>
            <Button size="sm" variant="outline-primary" onClick={loadProjectStats} disabled={loadingStats}>
              {loadingStats ? 'Loading...' : 'Refresh'}
            </Button>
          </div>
          
          {projectStats && (
            <Row>
              <Col md={6}>
                <Card className="mb-3">
                  <Card.Body className="p-3">
                    <h6 className="mb-2">🔥 Critical Defects</h6>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span>{projectStats.completedCriticalDefects} of {projectStats.totalCriticalDefects} Complete</span>
                      <span className="text-success fw-bold">{projectStats.criticalCompletionRate.toFixed(1)}%</span>
                    </div>
                    <ProgressBar 
                      now={projectStats.criticalCompletionRate} 
                      variant={projectStats.criticalCompletionRate > 80 ? 'success' : 'warning'}
                    />
                  </Card.Body>
                </Card>
              </Col>
              
              <Col md={6}>
                <Card className="mb-3">
                  <Card.Body className="p-3">
                    <h6 className="mb-2">🚀 Weekend Progress</h6>
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <span>{projectStats.completedWeekendItems} of {projectStats.totalWeekendItems} Complete</span>
                      <span className="text-info fw-bold">{projectStats.weekendCompletionRate.toFixed(1)}%</span>
                    </div>
                    <ProgressBar 
                      now={projectStats.weekendCompletionRate} 
                      variant="info"
                    />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          )}
          
          {projectStats && (
            <Row>
              <Col md={6}>
                <div className="mb-3">
                  <h6 className="text-success">✅ Recent Completions</h6>
                  <ul className="small mb-0">
                    {projectStats.recentUpdates.slice(0, 3).map((update, index) => (
                      <li key={index} className="text-muted">{update}</li>
                    ))}
                  </ul>
                </div>
              </Col>
              
              <Col md={6}>
                <div className="mb-3">
                  <h6 className="text-warning">⏳ Next Priorities</h6>
                  <ul className="small mb-0">
                    {projectStats.nextPriorities.slice(0, 3).map((priority, index) => (
                      <li key={index} className="text-muted">{priority}</li>
                    ))}
                  </ul>
                </div>
              </Col>
            </Row>
          )}
        </div>

        <div className="mb-4">
          <h6>App Information</h6>
          <Table size="sm">
            <tbody>
              <tr>
                <td><strong>Version:</strong></td>
                <td>{VERSION}</td>
              </tr>
              <tr>
                <td><strong>Build Time:</strong></td>
                <td>{new Date(BUILD_TIME).toLocaleString()}</td>
              </tr>
              <tr>
                <td><strong>Current URL:</strong></td>
                <td>{window.location.href}</td>
              </tr>
            </tbody>
          </Table>
        </div>

        <div className="mb-4">
          <h6>Cache Management</h6>
          <div className="d-flex gap-2 mb-3">
            <Button size="sm" variant="outline-primary" onClick={getCacheInfo}>
              Refresh Cache Info
            </Button>
            <Button size="sm" variant="outline-warning" onClick={clearAllCaches}>
              Clear All Caches
            </Button>
            <Button size="sm" variant="outline-danger" onClick={forceReload}>
              Nuclear Reload
            </Button>
            <Button size="sm" variant="outline-info" onClick={showAppInfo}>
              Log App Info
            </Button>
          </div>

          {cacheInfo.length > 0 && (
            <div>
              <small className="text-muted">Active Caches:</small>
              {cacheInfo.map((cache, index) => (
                <div key={index} className="border rounded p-2 mt-2">
                  <strong>{cache.name}</strong> ({cache.entries} entries)
                  <div className="small text-muted">
                    {cache.urls.slice(0, 3).map((url: string, i: number) => (
                      <div key={i}>{url}</div>
                    ))}
                    {cache.urls.length > 3 && <div>... and {cache.urls.length - 3} more</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="mb-3">
          <h6>Keyboard Shortcuts</h6>
          <ul className="small">
            <li><kbd>Ctrl/Cmd + Shift + R</kbd> - Force refresh with cache clear</li>
            <li><kbd>F12</kbd> - Open browser dev tools</li>
            <li><kbd>Ctrl/Cmd + F5</kbd> - Hard refresh</li>
          </ul>
        </div>

        {message && (
          <Alert variant={message.includes('✅') ? 'success' : message.includes('❌') ? 'danger' : 'info'}>
            {message}
          </Alert>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          Close
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DevTools;

export {};
