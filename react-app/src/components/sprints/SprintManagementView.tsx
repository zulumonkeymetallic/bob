import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Modal, Form, Table, Badge, ProgressBar, Alert } from 'react-bootstrap';
import { 
  Play, 
  Square, 
  RotateCcw, 
  Calendar, 
  Users, 
  Target,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  Plus,
  Edit,
  Trash2,
  BarChart3
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePersona } from '../../contexts/PersonaContext';

// BOB v3.5.2 - Sprint Management
// FTR-03 Implementation - Comprehensive sprint lifecycle management

interface Sprint {
  id: string;
  name: string;
  goal: string;
  startDate: Date;
  endDate: Date;
  status: 'Planning' | 'Active' | 'Review' | 'Retrospective' | 'Completed';
  capacity: number; // story points
  committed: number; // story points committed
  completed: number; // story points completed
  stories: Story[];
  retrospective?: {
    whatWentWell: string[];
    whatWentWrong: string[];
    actionItems: string[];
    sprintRating: number; // 1-5
  };
  metrics?: {
    velocity: number;
    burndownData: { date: Date; remaining: number }[];
    blockers: number;
    scopeChanges: number;
  };
}

interface Story {
  id: string;
  title: string;
  description?: string;
  storyPoints: number;
  status: 'Backlog' | 'In Progress' | 'Review' | 'Done';
  assignee?: string;
  goalId?: string;
  tasks: Task[];
  acceptance: string[];
  priority: 'Low' | 'Medium' | 'High' | 'Critical';
}

interface Task {
  id: string;
  title: string;
  status: 'Todo' | 'In Progress' | 'Done';
  assignee?: string;
  estimatedHours?: number;
  actualHours?: number;
}

interface Goal {
  id: string;
  title: string;
  theme: string;
}

const SprintManagementView: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  
  // State management
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null);
  const [showSprintModal, setShowSprintModal] = useState(false);
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [showRetrospectiveModal, setShowRetrospectiveModal] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'board' | 'burndown' | 'retrospective'>('overview');
  
  // Load dummy data
  useEffect(() => {
    loadDummyData();
  }, []);
  
  const loadDummyData = () => {
    const dummyGoals: Goal[] = [
      { id: 'goal-1', title: 'Complete Marathon Training', theme: 'Health' },
      { id: 'goal-2', title: 'Launch Side Business', theme: 'Wealth' },
      { id: 'goal-3', title: 'Learn React Development', theme: 'Growth' }
    ];
    
    const dummySprints: Sprint[] = [
      {
        id: 'sprint-1',
        name: 'Sprint 1 - Foundation Building',
        goal: 'Establish basic training routine and market research foundation',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2025-09-14'),
        status: 'Completed',
        capacity: 21,
        committed: 18,
        completed: 16,
        stories: [
          {
            id: 'story-1',
            title: 'Build base mileage routine',
            description: 'Establish consistent 3x weekly running schedule',
            storyPoints: 5,
            status: 'Done',
            assignee: currentUser?.email || 'user@example.com',
            goalId: 'goal-1',
            priority: 'High',
            acceptance: ['Run 3x per week', 'Track distance and time', 'No injuries'],
            tasks: [
              { id: 'task-1', title: 'Plan weekly schedule', status: 'Done', estimatedHours: 1, actualHours: 1.5 },
              { id: 'task-2', title: 'First week runs', status: 'Done', estimatedHours: 4, actualHours: 4.2 },
              { id: 'task-3', title: 'Track progress', status: 'Done', estimatedHours: 1, actualHours: 0.8 }
            ]
          },
          {
            id: 'story-2',
            title: 'Market research - competitive analysis',
            description: 'Research top 5 competitors in target market',
            storyPoints: 8,
            status: 'Done',
            assignee: currentUser?.email || 'user@example.com',
            goalId: 'goal-2',
            priority: 'Critical',
            acceptance: ['5 competitors analyzed', 'SWOT analysis completed', 'Pricing research done'],
            tasks: [
              { id: 'task-4', title: 'Identify competitors', status: 'Done', estimatedHours: 2, actualHours: 2.5 },
              { id: 'task-5', title: 'Analyze features', status: 'Done', estimatedHours: 6, actualHours: 7.2 },
              { id: 'task-6', title: 'Document findings', status: 'Done', estimatedHours: 3, actualHours: 2.8 }
            ]
          },
          {
            id: 'story-3',
            title: 'React tutorial completion',
            description: 'Complete official React tutorial and build sample app',
            storyPoints: 5,
            status: 'Review',
            assignee: currentUser?.email || 'user@example.com',
            goalId: 'goal-3',
            priority: 'Medium',
            acceptance: ['Tutorial completed', 'Sample app deployed', 'Code reviewed'],
            tasks: [
              { id: 'task-7', title: 'Tutorial modules 1-5', status: 'Done', estimatedHours: 8, actualHours: 9.5 },
              { id: 'task-8', title: 'Build sample app', status: 'In Progress', estimatedHours: 6, actualHours: 4 },
              { id: 'task-9', title: 'Deploy and document', status: 'Todo', estimatedHours: 2 }
            ]
          }
        ],
        retrospective: {
          whatWentWell: [
            'Consistent running schedule established',
            'Thorough competitive analysis completed',
            'Good team communication'
          ],
          whatWentWrong: [
            'React tutorial took longer than expected',
            'Underestimated research complexity',
            'Some scope creep in week 2'
          ],
          actionItems: [
            'Better time estimation for technical tasks',
            'Set firmer boundaries on scope changes',
            'Schedule buffer time for learning tasks'
          ],
          sprintRating: 4
        },
        metrics: {
          velocity: 16,
          burndownData: [
            { date: new Date('2025-09-01'), remaining: 18 },
            { date: new Date('2025-09-03'), remaining: 15 },
            { date: new Date('2025-09-05'), remaining: 12 },
            { date: new Date('2025-09-08'), remaining: 8 },
            { date: new Date('2025-09-10'), remaining: 5 },
            { date: new Date('2025-09-12'), remaining: 3 },
            { date: new Date('2025-09-14'), remaining: 2 }
          ],
          blockers: 2,
          scopeChanges: 1
        }
      },
      {
        id: 'sprint-2',
        name: 'Sprint 2 - Skill Development',
        goal: 'Advance training intensity and develop core business skills',
        startDate: new Date('2025-09-15'),
        endDate: new Date('2025-09-28'),
        status: 'Active',
        capacity: 24,
        committed: 20,
        completed: 8,
        stories: [
          {
            id: 'story-4',
            title: 'Increase weekly mileage',
            description: 'Build up to 25+ miles per week safely',
            storyPoints: 8,
            status: 'In Progress',
            assignee: currentUser?.email || 'user@example.com',
            goalId: 'goal-1',
            priority: 'High',
            acceptance: ['25+ miles weekly', 'No injury symptoms', 'Progressive increase'],
            tasks: [
              { id: 'task-10', title: 'Week 1: 20 miles', status: 'Done', estimatedHours: 5, actualHours: 5.2 },
              { id: 'task-11', title: 'Week 2: 25 miles', status: 'In Progress', estimatedHours: 6 },
              { id: 'task-12', title: 'Recovery planning', status: 'Todo', estimatedHours: 2 }
            ]
          },
          {
            id: 'story-5',
            title: 'Customer interview program',
            description: 'Conduct 5 customer interviews to validate market fit',
            storyPoints: 12,
            status: 'In Progress',
            assignee: currentUser?.email || 'user@example.com',
            goalId: 'goal-2',
            priority: 'Critical',
            acceptance: ['5 interviews completed', 'Interview notes analyzed', 'Insights documented'],
            tasks: [
              { id: 'task-13', title: 'Recruit interview candidates', status: 'Done', estimatedHours: 4, actualHours: 3.5 },
              { id: 'task-14', title: 'Conduct interviews 1-3', status: 'In Progress', estimatedHours: 6 },
              { id: 'task-15', title: 'Conduct interviews 4-5', status: 'Todo', estimatedHours: 4 },
              { id: 'task-16', title: 'Analyze and document', status: 'Todo', estimatedHours: 6 }
            ]
          }
        ],
        metrics: {
          velocity: 0, // Current sprint
          burndownData: [
            { date: new Date('2025-09-15'), remaining: 20 },
            { date: new Date('2025-09-17'), remaining: 18 },
            { date: new Date('2025-09-19'), remaining: 15 },
            { date: new Date('2025-09-21'), remaining: 12 }
          ],
          blockers: 1,
          scopeChanges: 0
        }
      },
      {
        id: 'sprint-3',
        name: 'Sprint 3 - Integration & Testing',
        goal: 'Integrate learnings and test market hypotheses',
        startDate: new Date('2025-09-29'),
        endDate: new Date('2025-10-12'),
        status: 'Planning',
        capacity: 25,
        committed: 0,
        completed: 0,
        stories: [],
        metrics: {
          velocity: 0,
          burndownData: [],
          blockers: 0,
          scopeChanges: 0
        }
      }
    ];
    
    setGoals(dummyGoals);
    setSprints(dummySprints);
    setSelectedSprint(dummySprints[1]); // Set active sprint as default
  };
  
  // Sprint management functions
  const startSprint = (sprintId: string) => {
    setSprints(prev => prev.map(sprint => 
      sprint.id === sprintId 
        ? { ...sprint, status: 'Active', startDate: new Date() }
        : sprint.status === 'Active' 
          ? { ...sprint, status: 'Completed' }
          : sprint
    ));
    
    console.log('🏃‍♂️ Sprint started:', sprintId);
  };
  
  const completeSprint = (sprintId: string) => {
    setSprints(prev => prev.map(sprint => 
      sprint.id === sprintId 
        ? { ...sprint, status: 'Review', endDate: new Date() }
        : sprint
    ));
    
    console.log('🏁 Sprint completed:', sprintId);
  };
  
  const updateStoryStatus = (sprintId: string, storyId: string, newStatus: Story['status']) => {
    setSprints(prev => prev.map(sprint => 
      sprint.id === sprintId 
        ? {
            ...sprint,
            stories: sprint.stories.map(story => 
              story.id === storyId ? { ...story, status: newStatus } : story
            )
          }
        : sprint
    ));
    
    // Recalculate completed story points
    const sprint = sprints.find(s => s.id === sprintId);
    if (sprint) {
      const completedPoints = sprint.stories
        .filter(story => story.status === 'Done')
        .reduce((sum, story) => sum + story.storyPoints, 0);
      
      setSprints(prev => prev.map(s => 
        s.id === sprintId ? { ...s, completed: completedPoints } : s
      ));
    }
  };
  
  const addStoryToSprint = (sprintId: string, story: Omit<Story, 'id'>) => {
    const newStory: Story = {
      id: `story-${Date.now()}`,
      ...story
    };
    
    setSprints(prev => prev.map(sprint => 
      sprint.id === sprintId 
        ? { 
            ...sprint, 
            stories: [...sprint.stories, newStory],
            committed: sprint.committed + story.storyPoints
          }
        : sprint
    ));
  };
  
  // Calculate sprint health metrics
  const calculateSprintHealth = (sprint: Sprint) => {
    const now = new Date();
    const duration = sprint.endDate.getTime() - sprint.startDate.getTime();
    const elapsed = now.getTime() - sprint.startDate.getTime();
    const progress = Math.min(elapsed / duration, 1);
    
    const completionRate = sprint.committed > 0 ? sprint.completed / sprint.committed : 0;
    const expectedCompletion = progress;
    
    const health = completionRate >= expectedCompletion ? 'good' : 
                   completionRate >= expectedCompletion * 0.8 ? 'warning' : 'danger';
    
    return { health, progress, completionRate, expectedCompletion };
  };
  
  // Theme colors
  const themeColors = {
    Health: '#ef4444',
    Growth: '#10b981', 
    Wealth: '#f59e0b',
    Tribe: '#8b5cf6',
    Home: '#06b6d4'
  };
  
  const statusColors = {
    'Planning': 'secondary',
    'Active': 'primary',
    'Review': 'warning',
    'Retrospective': 'info',
    'Completed': 'success'
  };
  
  return (
    <Container fluid className="sprint-management">
      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-between align-items-center">
            <h2>Sprint Management</h2>
            <div className="d-flex gap-2">
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setActiveTab('overview')}
                className={activeTab === 'overview' ? 'active' : ''}
              >
                Overview
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setActiveTab('board')}
                className={activeTab === 'board' ? 'active' : ''}
              >
                Sprint Board
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setActiveTab('burndown')}
                className={activeTab === 'burndown' ? 'active' : ''}
              >
                Burndown
              </Button>
              <Button 
                variant="outline-secondary" 
                size="sm"
                onClick={() => setActiveTab('retrospective')}
                className={activeTab === 'retrospective' ? 'active' : ''}
              >
                Retrospective
              </Button>
              <Button 
                variant="primary" 
                size="sm"
                onClick={() => {
                  setSelectedSprint(null);
                  setShowSprintModal(true);
                }}
              >
                <Plus size={16} />
                New Sprint
              </Button>
            </div>
          </div>
        </Col>
      </Row>
      
      {/* Sprint Overview Tab */}
      {activeTab === 'overview' && (
        <Row>
          {sprints.map(sprint => {
            const health = calculateSprintHealth(sprint);
            
            return (
              <Col md={4} key={sprint.id} className="mb-3">
                <Card 
                  className={`h-100 ${selectedSprint?.id === sprint.id ? 'border-primary' : ''}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedSprint(sprint)}
                >
                  <Card.Header>
                    <div className="d-flex justify-content-between align-items-center">
                      <h6 className="mb-0">{sprint.name}</h6>
                      <Badge bg={statusColors[sprint.status]}>
                        {sprint.status}
                      </Badge>
                    </div>
                  </Card.Header>
                  <Card.Body>
                    <p className="text-muted small mb-3">{sprint.goal}</p>
                    
                    <div className="d-flex justify-content-between text-small mb-2">
                      <span>Progress</span>
                      <span>{sprint.completed}/{sprint.committed} pts</span>
                    </div>
                    <ProgressBar 
                      now={sprint.committed > 0 ? (sprint.completed / sprint.committed) * 100 : 0}
                      variant={health.health === 'good' ? 'success' : health.health === 'warning' ? 'warning' : 'danger'}
                      className="mb-3"
                    />
                    
                    <div className="d-flex justify-content-between text-small mb-1">
                      <span><Calendar size={12} className="me-1" />Start:</span>
                      <span>{sprint.startDate.toLocaleDateString()}</span>
                    </div>
                    <div className="d-flex justify-content-between text-small mb-3">
                      <span><Calendar size={12} className="me-1" />End:</span>
                      <span>{sprint.endDate.toLocaleDateString()}</span>
                    </div>
                    
                    <div className="d-flex justify-content-between text-small">
                      <span>Stories: {sprint.stories.length}</span>
                      <span>Capacity: {sprint.capacity} pts</span>
                    </div>
                    
                    {sprint.metrics && sprint.metrics.blockers > 0 && (
                      <Alert variant="warning" className="mt-2 py-1">
                        <AlertTriangle size={12} className="me-1" />
                        {sprint.metrics.blockers} active blockers
                      </Alert>
                    )}
                  </Card.Body>
                  <Card.Footer>
                    <div className="d-flex gap-2">
                      {sprint.status === 'Planning' && (
                        <Button 
                          size="sm" 
                          variant="success"
                          onClick={(e) => {
                            e.stopPropagation();
                            startSprint(sprint.id);
                          }}
                        >
                          <Play size={12} className="me-1" />
                          Start
                        </Button>
                      )}
                      
                      {sprint.status === 'Active' && (
                        <Button 
                          size="sm" 
                          variant="warning"
                          onClick={(e) => {
                            e.stopPropagation();
                            completeSprint(sprint.id);
                          }}
                        >
                          <Square size={12} className="me-1" />
                          Complete
                        </Button>
                      )}
                      
                      {sprint.status === 'Review' && (
                        <Button 
                          size="sm" 
                          variant="info"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSprint(sprint);
                            setShowRetrospectiveModal(true);
                          }}
                        >
                          <RotateCcw size={12} className="me-1" />
                          Retrospective
                        </Button>
                      )}
                      
                      <Button 
                        size="sm" 
                        variant="outline-secondary"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedSprint(sprint);
                          setShowSprintModal(true);
                        }}
                      >
                        <Edit size={12} />
                      </Button>
                    </div>
                  </Card.Footer>
                </Card>
              </Col>
            );
          })}
        </Row>
      )}
      
      {/* Sprint Board Tab */}
      {activeTab === 'board' && selectedSprint && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <h5>{selectedSprint.name} - Sprint Board</h5>
              </Card.Header>
              <Card.Body>
                <Row>
                  {['Backlog', 'In Progress', 'Review', 'Done'].map(status => (
                    <Col key={status} md={3}>
                      <Card className="h-100">
                        <Card.Header>
                          <h6 className="mb-0">{status}</h6>
                          <small className="text-muted">
                            {selectedSprint.stories.filter(s => s.status === status).length} stories
                          </small>
                        </Card.Header>
                        <Card.Body style={{ minHeight: '400px', padding: '10px' }}>
                          {selectedSprint.stories
                            .filter(story => story.status === status)
                            .map(story => {
                              const linkedGoal = goals.find(g => g.id === story.goalId);
                              
                              return (
                                <Card key={story.id} className="mb-2" style={{ fontSize: '14px' }}>
                                  <Card.Body style={{ padding: '10px' }}>
                                    <div className="d-flex justify-content-between align-items-start mb-2">
                                      <strong className="text-truncate">{story.title}</strong>
                                      <Badge bg="secondary">{story.storyPoints} pts</Badge>
                                    </div>
                                    
                                    {linkedGoal && (
                                      <Badge 
                                        style={{ 
                                          backgroundColor: themeColors[linkedGoal.theme as keyof typeof themeColors],
                                          fontSize: '10px'
                                        }}
                                        className="mb-2"
                                      >
                                        {linkedGoal.title}
                                      </Badge>
                                    )}
                                    
                                    <div className="d-flex justify-content-between align-items-center">
                                      <Badge bg={
                                        story.priority === 'Critical' ? 'danger' :
                                        story.priority === 'High' ? 'warning' :
                                        story.priority === 'Medium' ? 'info' : 'secondary'
                                      }>
                                        {story.priority}
                                      </Badge>
                                      
                                      <div className="d-flex gap-1">
                                        {status !== 'Done' && (
                                          <Button 
                                            size="sm" 
                                            variant="outline-primary"
                                            onClick={() => {
                                              const nextStatus = status === 'Backlog' ? 'In Progress' :
                                                               status === 'In Progress' ? 'Review' : 'Done';
                                              updateStoryStatus(selectedSprint.id, story.id, nextStatus as Story['status']);
                                            }}
                                          >
                                            →
                                          </Button>
                                        )}
                                        
                                        <Button 
                                          size="sm" 
                                          variant="outline-secondary"
                                          onClick={() => {
                                            setSelectedStory(story);
                                            setShowStoryModal(true);
                                          }}
                                        >
                                          <Edit size={12} />
                                        </Button>
                                      </div>
                                    </div>
                                    
                                    <div className="mt-2">
                                      <small className="text-muted">
                                        Tasks: {story.tasks.filter(t => t.status === 'Done').length}/{story.tasks.length}
                                      </small>
                                      <ProgressBar 
                                        now={story.tasks.length > 0 ? (story.tasks.filter(t => t.status === 'Done').length / story.tasks.length) * 100 : 0}
                                        variant="info"
                                        style={{ height: '4px' }}
                                      />
                                    </div>
                                  </Card.Body>
                                </Card>
                              );
                            })}
                          
                          {status === 'Backlog' && (
                            <Button 
                              variant="outline-primary" 
                              size="sm" 
                              className="w-100"
                              onClick={() => {
                                setSelectedStory(null);
                                setShowStoryModal(true);
                              }}
                            >
                              <Plus size={12} className="me-1" />
                              Add Story
                            </Button>
                          )}
                        </Card.Body>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
      
      {/* Burndown Chart Tab */}
      {activeTab === 'burndown' && selectedSprint && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <h5>{selectedSprint.name} - Burndown Chart</h5>
              </Card.Header>
              <Card.Body>
                <div style={{ height: '400px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div className="text-center">
                    <BarChart3 size={64} className="text-muted mb-3" />
                    <h5>Burndown Chart</h5>
                    <p className="text-muted">
                      Burndown chart visualization would be implemented here.<br/>
                      Shows remaining story points over time vs. ideal burndown line.
                    </p>
                    
                    {selectedSprint.metrics && (
                      <div className="mt-4">
                        <h6>Sprint Metrics</h6>
                        <Table size="sm" className="w-auto mx-auto">
                          <tbody>
                            <tr>
                              <td>Velocity:</td>
                              <td><strong>{selectedSprint.metrics.velocity} pts</strong></td>
                            </tr>
                            <tr>
                              <td>Blockers:</td>
                              <td><strong>{selectedSprint.metrics.blockers}</strong></td>
                            </tr>
                            <tr>
                              <td>Scope Changes:</td>
                              <td><strong>{selectedSprint.metrics.scopeChanges}</strong></td>
                            </tr>
                          </tbody>
                        </Table>
                      </div>
                    )}
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
      
      {/* Retrospective Tab */}
      {activeTab === 'retrospective' && selectedSprint && (
        <Row>
          <Col>
            <Card>
              <Card.Header>
                <div className="d-flex justify-content-between align-items-center">
                  <h5>{selectedSprint.name} - Retrospective</h5>
                  {selectedSprint.status === 'Review' && (
                    <Button 
                      variant="primary" 
                      size="sm"
                      onClick={() => setShowRetrospectiveModal(true)}
                    >
                      Conduct Retrospective
                    </Button>
                  )}
                </div>
              </Card.Header>
              <Card.Body>
                {selectedSprint.retrospective ? (
                  <Row>
                    <Col md={4}>
                      <Card className="h-100">
                        <Card.Header className="bg-success text-white">
                          <h6 className="mb-0">
                            <CheckCircle size={16} className="me-2" />
                            What Went Well
                          </h6>
                        </Card.Header>
                        <Card.Body>
                          <ul className="mb-0">
                            {selectedSprint.retrospective.whatWentWell.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </Card.Body>
                      </Card>
                    </Col>
                    
                    <Col md={4}>
                      <Card className="h-100">
                        <Card.Header className="bg-warning text-white">
                          <h6 className="mb-0">
                            <AlertTriangle size={16} className="me-2" />
                            What Went Wrong
                          </h6>
                        </Card.Header>
                        <Card.Body>
                          <ul className="mb-0">
                            {selectedSprint.retrospective.whatWentWrong.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                        </Card.Body>
                      </Card>
                    </Col>
                    
                    <Col md={4}>
                      <Card className="h-100">
                        <Card.Header className="bg-primary text-white">
                          <h6 className="mb-0">
                            <Target size={16} className="me-2" />
                            Action Items
                          </h6>
                        </Card.Header>
                        <Card.Body>
                          <ul className="mb-3">
                            {selectedSprint.retrospective.actionItems.map((item, index) => (
                              <li key={index}>{item}</li>
                            ))}
                          </ul>
                          
                          <div className="text-center">
                            <h6>Sprint Rating</h6>
                            <div className="d-flex justify-content-center">
                              {[1, 2, 3, 4, 5].map(star => (
                                <span 
                                  key={star}
                                  style={{ 
                                    color: star <= selectedSprint.retrospective!.sprintRating ? '#ffc107' : '#dee2e6',
                                    fontSize: '20px'
                                  }}
                                >
                                  ★
                                </span>
                              ))}
                            </div>
                            <small className="text-muted">
                              {selectedSprint.retrospective.sprintRating}/5 stars
                            </small>
                          </div>
                        </Card.Body>
                      </Card>
                    </Col>
                  </Row>
                ) : (
                  <div className="text-center py-5">
                    <Clock size={64} className="text-muted mb-3" />
                    <h5>No Retrospective Yet</h5>
                    <p className="text-muted">
                      Complete this sprint and conduct a retrospective to capture learnings.
                    </p>
                  </div>
                )}
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}
      
      {/* Sprint Modal */}
      <Modal show={showSprintModal} onHide={() => setShowSprintModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedSprint ? 'Edit Sprint' : 'Create New Sprint'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Sprint Name</Form.Label>
                  <Form.Control 
                    type="text" 
                    defaultValue={selectedSprint?.name || ''}
                    placeholder="e.g., Sprint 4 - Feature Development"
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Capacity (Story Points)</Form.Label>
                  <Form.Control 
                    type="number" 
                    defaultValue={selectedSprint?.capacity || 20}
                    min={1}
                    max={50}
                  />
                </Form.Group>
              </Col>
            </Row>
            
            <Form.Group className="mb-3">
              <Form.Label>Sprint Goal</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={2}
                defaultValue={selectedSprint?.goal || ''}
                placeholder="What is the main objective for this sprint?"
              />
            </Form.Group>
            
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Start Date</Form.Label>
                  <Form.Control 
                    type="date" 
                    defaultValue={selectedSprint?.startDate.toISOString().split('T')[0] || ''}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>End Date</Form.Label>
                  <Form.Control 
                    type="date" 
                    defaultValue={selectedSprint?.endDate.toISOString().split('T')[0] || ''}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSprintModal(false)}>
            Cancel
          </Button>
          <Button variant="primary">
            {selectedSprint ? 'Update Sprint' : 'Create Sprint'}
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* Story Modal */}
      <Modal show={showStoryModal} onHide={() => setShowStoryModal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>
            {selectedStory ? 'Edit Story' : 'Add New Story'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Story Title</Form.Label>
              <Form.Control 
                type="text" 
                defaultValue={selectedStory?.title || ''}
                placeholder="As a user, I want to..."
              />
            </Form.Group>
            
            <Form.Group className="mb-3">
              <Form.Label>Description</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={3}
                defaultValue={selectedStory?.description || ''}
                placeholder="Detailed description of the story"
              />
            </Form.Group>
            
            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Story Points</Form.Label>
                  <Form.Select defaultValue={selectedStory?.storyPoints || 1}>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={5}>5</option>
                    <option value={8}>8</option>
                    <option value={13}>13</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Priority</Form.Label>
                  <Form.Select defaultValue={selectedStory?.priority || 'Medium'}>
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Linked Goal</Form.Label>
                  <Form.Select defaultValue={selectedStory?.goalId || ''}>
                    <option value="">No Goal</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>
                        {goal.title} ({goal.theme})
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            
            <Form.Group className="mb-3">
              <Form.Label>Acceptance Criteria</Form.Label>
              <Form.Control 
                as="textarea" 
                rows={4}
                defaultValue={selectedStory?.acceptance.join('\n') || ''}
                placeholder="Enter each acceptance criteria on a new line"
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowStoryModal(false)}>
            Cancel
          </Button>
          <Button variant="primary">
            {selectedStory ? 'Update Story' : 'Add Story'}
          </Button>
        </Modal.Footer>
      </Modal>
      
      {/* Retrospective Modal */}
      <Modal show={showRetrospectiveModal} onHide={() => setShowRetrospectiveModal(false)} size="xl">
        <Modal.Header closeButton>
          <Modal.Title>Sprint Retrospective</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Row>
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label className="text-success">
                  <CheckCircle size={16} className="me-2" />
                  What Went Well?
                </Form.Label>
                <Form.Control 
                  as="textarea" 
                  rows={6}
                  placeholder="List the positive outcomes from this sprint..."
                />
              </Form.Group>
            </Col>
            
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label className="text-warning">
                  <AlertTriangle size={16} className="me-2" />
                  What Went Wrong?
                </Form.Label>
                <Form.Control 
                  as="textarea" 
                  rows={6}
                  placeholder="Identify challenges and problems encountered..."
                />
              </Form.Group>
            </Col>
            
            <Col md={4}>
              <Form.Group className="mb-3">
                <Form.Label className="text-primary">
                  <Target size={16} className="me-2" />
                  Action Items
                </Form.Label>
                <Form.Control 
                  as="textarea" 
                  rows={6}
                  placeholder="What will you do differently next sprint?"
                />
              </Form.Group>
            </Col>
          </Row>
          
          <Form.Group className="text-center">
            <Form.Label>Overall Sprint Rating</Form.Label>
            <div className="d-flex justify-content-center gap-2 mb-3">
              {[1, 2, 3, 4, 5].map(rating => (
                <Button 
                  key={rating}
                  variant="outline-warning" 
                  size="sm"
                  style={{ width: '40px' }}
                >
                  {rating}★
                </Button>
              ))}
            </div>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowRetrospectiveModal(false)}>
            Cancel
          </Button>
          <Button variant="success">
            Save Retrospective
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default SprintManagementView;
