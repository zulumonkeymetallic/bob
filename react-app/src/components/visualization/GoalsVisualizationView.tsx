import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Modal, Form, Table } from 'react-bootstrap';
import { 
  Calendar, 
  Share, 
  Printer, 
  Download, 
  ZoomIn, 
  ZoomOut,
  Settings,
  Filter,
  Search,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';

// BOB v3.5.2 - Goals Visualization (Roadmap Timeline)
// FTR-03 Implementation - Scaffold with dummy data

interface Goal {
  id: string;
  title: string;
  theme: string;
  startDate: Date;
  endDate: Date;
  status: string;
  progress: number;
  stories: Story[];
}

interface Story {
  id: string;
  title: string;
  sprintId?: string;
  status: string;
  tasks: Task[];
}

interface Task {
  id: string;
  title: string;
  status: string;
  assignee?: string;
}

interface Sprint {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
}

const GoalsVisualizationView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  // State management
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [visibleThemes, setVisibleThemes] = useState<string[]>(['Health', 'Growth', 'Wealth', 'Tribe', 'Home']);
  const [collapsedGoals, setCollapsedGoals] = useState<string[]>([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [dragOperation, setDragOperation] = useState<any>(null);
  
  // Timeline configuration
  const [timelineStart, setTimelineStart] = useState(new Date());
  const [timelineEnd, setTimelineEnd] = useState(new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)); // 90 days
  
  // Load dummy data
  useEffect(() => {
    loadDummyData();
  }, []);
  
  const loadDummyData = () => {
    // Dummy goals data
    const dummyGoals: Goal[] = [
      {
        id: 'goal-1',
        title: 'Complete Marathon Training',
        theme: 'Health',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2025-12-15'),
        status: 'Work in Progress',
        progress: 35,
        stories: [
          {
            id: 'story-1',
            title: 'Build base mileage',
            sprintId: 'sprint-1',
            status: 'In Progress',
            tasks: [
              { id: 'task-1', title: 'Run 3x per week', status: 'In Progress' },
              { id: 'task-2', title: 'Track weekly mileage', status: 'Done' }
            ]
          },
          {
            id: 'story-2', 
            title: 'Peak training phase',
            sprintId: 'sprint-2',
            status: 'Not Started',
            tasks: [
              { id: 'task-3', title: 'Long runs 18+ miles', status: 'Not Started' },
              { id: 'task-4', title: 'Speed work sessions', status: 'Not Started' }
            ]
          }
        ]
      },
      {
        id: 'goal-2',
        title: 'Launch Side Business',
        theme: 'Wealth',
        startDate: new Date('2025-09-15'),
        endDate: new Date('2025-11-30'),
        status: 'New',
        progress: 10,
        stories: [
          {
            id: 'story-3',
            title: 'Market research',
            sprintId: 'sprint-1',
            status: 'Done',
            tasks: [
              { id: 'task-5', title: 'Competitor analysis', status: 'Done' },
              { id: 'task-6', title: 'Customer interviews', status: 'Done' }
            ]
          }
        ]
      }
    ];
    
    // Dummy sprints data
    const dummySprints: Sprint[] = [
      {
        id: 'sprint-1',
        name: 'Sprint 1',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2025-09-14')
      },
      {
        id: 'sprint-2', 
        name: 'Sprint 2',
        startDate: new Date('2025-09-15'),
        endDate: new Date('2025-09-28')
      },
      {
        id: 'sprint-3',
        name: 'Sprint 3', 
        startDate: new Date('2025-09-29'),
        endDate: new Date('2025-10-12')
      }
    ];
    
    setGoals(dummyGoals);
    setSprints(dummySprints);
  };
  
  // Theme colors
  const themeColors = {
    Health: '#ef4444',
    Growth: '#10b981', 
    Wealth: '#f59e0b',
    Tribe: '#8b5cf6',
    Home: '#06b6d4'
  };
  
  // Handle goal drag (mock)
  const handleGoalDrag = (goalId: string, newStartDate: Date, newEndDate: Date) => {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;
    
    // Check if >= 3 stories would change sprint
    const affectedStories = goal.stories.filter(story => {
      // Mock logic: stories planned for sprints that would shift
      return story.sprintId && Math.random() > 0.5;
    });
    
    if (affectedStories.length >= 3) {
      setDragOperation({ goalId, newStartDate, newEndDate, affectedStories });
      setShowConfirmModal(true);
    } else {
      // Direct update
      executeGoalDateChange(goalId, newStartDate, newEndDate);
    }
  };
  
  const executeGoalDateChange = (goalId: string, newStartDate: Date, newEndDate: Date) => {
    setGoals(prev => prev.map(goal => 
      goal.id === goalId 
        ? { ...goal, startDate: newStartDate, endDate: newEndDate }
        : goal
    ));
    
    // Log activity
    console.log('📅 Goal dates changed:', { goalId, newStartDate, newEndDate });
  };
  
  // Share functionality
  const generateShareLink = () => {
    const shareData = {
      goals: goals.filter(g => visibleThemes.includes(g.theme)),
      sprints,
      filters: { themes: visibleThemes, collapsed: collapsedGoals },
      timestamp: new Date().toISOString()
    };
    
    // Mock share link generation
    const shareToken = btoa(JSON.stringify(shareData));
    return `${window.location.origin}/goals/visualization/shared/${shareToken}`;
  };
  
  // Print functionality  
  const handlePrint = () => {
    window.print();
  };
  
  // Generate calendar dates for timeline
  const generateTimelineDates = () => {
    const dates = [];
    const current = new Date(timelineStart);
    
    while (current <= timelineEnd) {
      dates.push(new Date(current));
      current.setDate(current.getDate() + 7); // Weekly intervals
    }
    
    return dates;
  };
  
  return (
    <Container fluid className="goals-visualization">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Goals Roadmap Timeline</h2>
            <div className="d-flex gap-2">
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setZoomLevel(prev => Math.max(0.5, prev - 0.1))}
              >
                <ZoomOut size={16} />
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setZoomLevel(prev => Math.min(2, prev + 0.1))}
              >
                <ZoomIn size={16} />
              </Button>
              <Button variant="outline-secondary" size="sm">
                <Filter size={16} />
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setShowShareModal(true)}
              >
                <Share size={16} />
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={handlePrint}
              >
                <Printer size={16} />
              </Button>
            </div>
          </div>
        </Col>
      </Row>
      
      <Row>
        <Col>
          <Card>
            <Card.Header>
              <div className="d-flex justify-content-between align-items-center">
                <div className="d-flex align-items-center gap-3">
                  <Button variant="outline-secondary" size="sm">
                    <ChevronLeft size={16} />
                  </Button>
                  <span>
                    {timelineStart.toLocaleDateString()} - {timelineEnd.toLocaleDateString()}
                  </span>
                  <Button variant="outline-secondary" size="sm">
                    <ChevronRight size={16} />
                  </Button>
                </div>
                <div className="d-flex gap-2">
                  {Object.entries(themeColors).map(([theme, color]) => (
                    <div 
                      key={theme}
                      className="d-flex align-items-center gap-1"
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        if (visibleThemes.includes(theme)) {
                          setVisibleThemes(prev => prev.filter(t => t !== theme));
                        } else {
                          setVisibleThemes(prev => [...prev, theme]);
                        }
                      }}
                    >
                      <div 
                        style={{
                          width: 12,
                          height: 12,
                          backgroundColor: visibleThemes.includes(theme) ? color : '#ccc',
                          borderRadius: 2
                        }}
                      />
                      <small>{theme}</small>
                    </div>
                  ))}
                </div>
              </div>
            </Card.Header>
            
            <Card.Body style={{ padding: 0, overflowX: 'auto' }}>
              {/* Timeline Header with Sprint Markers */}
              <div style={{ display: 'flex', borderBottom: '2px solid #e5e7eb', minWidth: '1200px' }}>
                <div style={{ width: '200px', padding: '10px', backgroundColor: '#f9fafb', borderRight: '1px solid #e5e7eb' }}>
                  <strong>Goals</strong>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                  {/* Date Headers */}
                  <div style={{ display: 'flex', height: '40px' }}>
                    {generateTimelineDates().map((date, index) => (
                      <div 
                        key={index}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRight: '1px solid #e5e7eb',
                          fontSize: '12px',
                          textAlign: 'center'
                        }}
                      >
                        {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                    ))}
                  </div>
                  
                  {/* Sprint Markers */}
                  <div style={{ display: 'flex', height: '30px', backgroundColor: '#f0f9ff' }}>
                    {sprints.map(sprint => (
                      <div
                        key={sprint.id}
                        style={{
                          position: 'absolute',
                          top: '40px',
                          left: '10%', // Mock positioning
                          width: '15%', // Mock width
                          height: '30px',
                          backgroundColor: '#0ea5e9',
                          color: 'white',
                          fontSize: '11px',
                          padding: '4px 8px',
                          borderRadius: '4px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        {sprint.name}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Goal Bars */}
              <div style={{ minWidth: '1200px' }}>
                {goals
                  .filter(goal => visibleThemes.includes(goal.theme))
                  .map((goal, index) => (
                  <div key={goal.id} style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
                    {/* Goal Info Column */}
                    <div 
                      style={{ 
                        width: '200px', 
                        padding: '15px 10px', 
                        borderRight: '1px solid #e5e7eb',
                        cursor: 'pointer'
                      }}
                      onClick={() => {
                        setSelectedGoal(goal);
                        setShowSidebar(true);
                      }}
                    >
                      <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px' }}>
                        {goal.title}
                      </div>
                      <div style={{ fontSize: '12px', color: '#6b7280' }}>
                        {goal.theme} • {goal.status}
                      </div>
                      <div style={{ 
                        marginTop: '6px',
                        height: '4px',
                        backgroundColor: '#e5e7eb',
                        borderRadius: '2px',
                        overflow: 'hidden'
                      }}>
                        <div 
                          style={{
                            width: `${goal.progress}%`,
                            height: '100%',
                            backgroundColor: themeColors[goal.theme as keyof typeof themeColors],
                            transition: 'width 0.3s ease'
                          }}
                        />
                      </div>
                    </div>
                    
                    {/* Goal Timeline Bar */}
                    <div style={{ flex: 1, position: 'relative', padding: '15px 0' }}>
                      <div
                        style={{
                          position: 'absolute',
                          left: '15%', // Mock positioning based on dates
                          width: '40%', // Mock width based on duration
                          height: '20px',
                          backgroundColor: themeColors[goal.theme as keyof typeof themeColors],
                          borderRadius: '10px',
                          opacity: 0.8,
                          cursor: 'move',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          fontSize: '11px',
                          fontWeight: '600'
                        }}
                        onClick={() => {
                          setSelectedGoal(goal);
                          setShowSidebar(true);
                        }}
                      >
                        {goal.progress}%
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Expanded Goal Details */}
              {selectedGoal && !collapsedGoals.includes(selectedGoal.id) && (
                <div style={{ backgroundColor: '#f9fafb', borderTop: '2px solid #e5e7eb' }}>
                  <div style={{ padding: '20px' }}>
                    <h5>Stories for "{selectedGoal.title}"</h5>
                    <Table striped bordered hover size="sm">
                      <thead>
                        <tr>
                          <th>Story</th>
                          <th>Sprint</th>
                          <th>Status</th>
                          <th>Tasks</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGoal.stories.map(story => (
                          <tr key={story.id}>
                            <td>{story.title}</td>
                            <td>
                              <Form.Select size="sm" defaultValue={story.sprintId || ''}>
                                <option value="">No Sprint</option>
                                {sprints.map(sprint => (
                                  <option key={sprint.id} value={sprint.id}>
                                    {sprint.name}
                                  </option>
                                ))}
                              </Form.Select>
                            </td>
                            <td>
                              <span className={`badge ${story.status === 'Done' ? 'bg-success' : story.status === 'In Progress' ? 'bg-warning' : 'bg-secondary'}`}>
                                {story.status}
                              </span>
                            </td>
                            <td>{story.tasks.length} tasks</td>
                            <td>
                              <Button variant="outline-secondary" size="sm">Edit</Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                    
                    <h6 className="mt-4">Tasks</h6>
                    <Table striped bordered hover size="sm">
                      <thead>
                        <tr>
                          <th>Task</th>
                          <th>Story</th>
                          <th>Status</th>
                          <th>Assignee</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedGoal.stories.flatMap(story => 
                          story.tasks.map(task => (
                            <tr key={task.id}>
                              <td>{task.title}</td>
                              <td>{story.title}</td>
                              <td>
                                <span className={`badge ${task.status === 'Done' ? 'bg-success' : task.status === 'In Progress' ? 'bg-warning' : 'bg-secondary'}`}>
                                  {task.status}
                                </span>
                              </td>
                              <td>{task.assignee || 'Unassigned'}</td>
                              <td>
                                <Button variant="outline-secondary" size="sm">Edit</Button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </Table>
                  </div>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
      
      {/* Confirmation Modal for Bulk Changes */}
      <Modal show={showConfirmModal} onHide={() => setShowConfirmModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Goal Date Change</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {dragOperation && (
            <>
              <p>Changing this goal's dates will affect <strong>{dragOperation.affectedStories.length}</strong> stories:</p>
              <ul>
                {dragOperation.affectedStories.map((story: any) => (
                  <li key={story.id}>{story.title}</li>
                ))}
              </ul>
              <p>These stories will be reassigned to different sprints. Continue?</p>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowConfirmModal(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={() => {
              if (dragOperation) {
                executeGoalDateChange(
                  dragOperation.goalId, 
                  dragOperation.newStartDate, 
                  dragOperation.newEndDate
                );
              }
              setShowConfirmModal(false);
              setDragOperation(null);
            }}
          >
            Confirm Changes
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* Share Modal */}
      <Modal show={showShareModal} onHide={() => setShowShareModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Share Roadmap</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Group className="mb-3">
            <Form.Label>Share Link (Read-only)</Form.Label>
            <Form.Control 
              type="text" 
              value={generateShareLink()}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
          </Form.Group>
          <div className="d-flex gap-2">
            <Button 
              variant="outline-secondary"
              onClick={() => navigator.clipboard.writeText(generateShareLink())}
            >
              Copy Link
            </Button>
            <Button variant="outline-secondary">
              <Download size={16} className="me-2" />
              Download PDF
            </Button>
          </div>
        </Modal.Body>
      </Modal>
    </Container>
  );
};

export default GoalsVisualizationView;
