import React from 'react';
import { Container, Row, Col, Card, ProgressBar, Badge } from 'react-bootstrap';

interface FeatureStatus {
  category: string;
  features: {
    name: string;
    status: 'complete' | 'partial' | 'missing';
    description?: string;
  }[];
}

const DevelopmentTracking: React.FC = () => {
  const roadmapStatus: FeatureStatus[] = [
    {
      category: "Core Features",
      features: [
        { name: "Google Authentication", status: "complete" },
        { name: "Dark/Light/System theme support", status: "complete" },
        { name: "Mobile responsive design", status: "partial", description: "Basic responsive, needs refinement" },
        { name: "Version tracking and changelog", status: "complete" }
      ]
    },
    {
      category: "Goal Management", 
      features: [
        { name: "Goal creation and management", status: "missing", description: "UI needed" },
        { name: "Goal categorization", status: "partial", description: "Backend exists" },
        { name: "Story linking to goals", status: "missing", description: "UI needed" },
        { name: "Goal progress tracking", status: "missing" }
      ]
    },
    {
      category: "Story Management",
      features: [
        { name: "Story creation and editing", status: "missing", description: "UI needed" },
        { name: "Story backlog view", status: "missing", description: "UI needed" },
        { name: "Story-to-Goal associations", status: "missing", description: "UI needed" },
        { name: "Story task panel", status: "missing", description: "UI needed" }
      ]
    },
    {
      category: "Task Management",
      features: [
        { name: "Comprehensive task creation form", status: "missing", description: "UI needed" },
        { name: "Task fields (ID, Title, Effort, Start/Due, Status)", status: "partial", description: "Backend schema exists" },
        { name: "Task-to-Story associations", status: "missing", description: "UI needed" },
        { name: "Kanban board with drag-and-drop", status: "missing", description: "UI needed" },
        { name: "Sprint-based filtering", status: "missing" }
      ]
    },
    {
      category: "Sprint Management",
      features: [
        { name: "Sprint administration", status: "missing" },
        { name: "Automatic date calculations", status: "missing" },
        { name: "Sprint planning integration", status: "missing" },
        { name: "Sprint retro scheduling", status: "missing" }
      ]
    },
    {
      category: "AI Integration",
      features: [
        { name: "OpenAI integration for task planning", status: "complete" },
        { name: "Calendar optimization", status: "missing" },
        { name: "AI-powered scheduling suggestions", status: "missing" }
      ]
    },
    {
      category: "Calendar Integration",
      features: [
        { name: "Google Calendar integration", status: "complete" },
        { name: "Event synchronization", status: "complete" },
        { name: "Upcoming events view", status: "partial", description: "Backend works, UI basic" }
      ]
    },
    {
      category: "Future Features (Not Started)",
      features: [
        { name: "iOS App & Reminders Sync", status: "missing" },
        { name: "HealthKit Integration", status: "missing" },
        { name: "Smart Calendar AI Scheduling", status: "missing" },
        { name: "Habit Tracking", status: "missing" },
        { name: "AI Chat Interface", status: "missing" },
        { name: "Unlinked Tasks Report", status: "missing" }
      ]
    }
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'complete':
        return <Badge bg="success">Complete</Badge>;
      case 'partial':
        return <Badge bg="warning">Partial</Badge>;
      case 'missing':
        return <Badge bg="danger">Missing</Badge>;
      default:
        return <Badge bg="secondary">Unknown</Badge>;
    }
  };

  const getOverallProgress = () => {
    const allFeatures = roadmapStatus.flatMap(category => category.features);
    const completed = allFeatures.filter(f => f.status === 'complete').length;
    const partial = allFeatures.filter(f => f.status === 'partial').length;
    const total = allFeatures.length;
    
    return {
      percentage: Math.round(((completed + partial * 0.5) / total) * 100),
      completed,
      partial,
      missing: total - completed - partial,
      total
    };
  };

  const progress = getOverallProgress();

  return (
    <Container className="mt-4">
      <Row>
        <Col md={12}>
          <Card className="mb-4">
            <Card.Header>
              <h2 className="mb-0">Development Roadmap - BOB Productivity Tool</h2>
            </Card.Header>
            <Card.Body>
              <Row className="mb-3">
                <Col md={6}>
                  <h5>Overall Progress: {progress.percentage}%</h5>
                  <ProgressBar>
                    <ProgressBar variant="success" now={(progress.completed / progress.total) * 100} key={1} />
                    <ProgressBar variant="warning" now={(progress.partial / progress.total) * 100} key={2} />
                  </ProgressBar>
                </Col>
                <Col md={6}>
                  <div className="d-flex gap-3">
                    <span><Badge bg="success">{progress.completed}</Badge> Complete</span>
                    <span><Badge bg="warning">{progress.partial}</Badge> Partial</span>
                    <span><Badge bg="danger">{progress.missing}</Badge> Missing</span>
                  </div>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row>
        {roadmapStatus.map((category, idx) => (
          <Col md={6} key={idx} className="mb-4">
            <Card>
              <Card.Header>
                <h4 className="mb-0">{category.category}</h4>
              </Card.Header>
              <Card.Body>
                {category.features.map((feature, featureIdx) => (
                  <div key={featureIdx} className="d-flex justify-content-between align-items-start mb-2">
                    <div className="flex-grow-1">
                      <div className="fw-bold">{feature.name}</div>
                      {feature.description && (
                        <small className="text-muted">{feature.description}</small>
                      )}
                    </div>
                    <div className="ms-2">
                      {getStatusBadge(feature.status)}
                    </div>
                  </div>
                ))}
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      <Row>
        <Col md={12}>
          <Card className="mt-4">
            <Card.Header>
              <h4>Next Priorities</h4>
            </Card.Header>
            <Card.Body>
              <ol>
                <li><strong>Goal Management UI</strong> - Create goals with theme categorization</li>
                <li><strong>Story Creation</strong> - Link stories to goals</li>
                <li><strong>Task Management</strong> - Link tasks to stories with full kanban</li>
                <li><strong>Kanban Board</strong> - Drag & drop stories with nested tasks</li>
                <li><strong>Calendar Integration Debug</strong> - Fix connection issues</li>
              </ol>
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default DevelopmentTracking;
