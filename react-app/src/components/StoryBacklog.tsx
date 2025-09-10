import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, Table, Dropdown, Form } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Story, Goal, Sprint } from '../types';
import { isStatus, isTheme, isPriority, getThemeClass, getPriorityColor, getBadgeVariant, getThemeName, getStatusName, getPriorityName, getPriorityIcon } from '../utils/statusHelpers';
import { domainThemePrimaryVar, themeVars } from '../utils/themeVars';

const StoryBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [filters, setFilters] = useState({
    status: '',
    goal: '',
    priority: '',
    sprint: ''
  });

  useEffect(() => {
    if (!currentUser) return;

    // Subscribe to goals
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Goal));
      setGoals(goalsData);
    });

    // Subscribe to stories
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Story));
      setStories(storiesData.sort((a, b) => a.orderIndex - b.orderIndex));
    });

    // Subscribe to sprints
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );
    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Sprint));
      setSprints(sprintsData);
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
      unsubscribeSprints();
    };
  }, [currentUser]);

  const getGoalTitle = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.title : 'Unknown Goal';
  };

  const getGoalTheme = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? getThemeName(goal.theme) : 'Growth';
  };

  const getThemeColorVar = (theme: string): string => {
    if (!theme) return themeVars.muted as string;
    return domainThemePrimaryVar(theme);
  };

  const updateStoryStatus = async (storyId: string, newStatus: string) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        status: newStatus,
        updatedAt: new Date()
      });
    } catch (error) {
      console.error('Error updating story status:', error);
    }
  };

  const getPriorityColor = (priority: string) => {
    const colors = {
      'P1': 'danger',
      'P2': 'warning', 
      'P3': 'secondary'
    };
    return colors[priority] || 'secondary';
  };

  // Filter stories based on current filters
  const filteredStories = stories.filter(story => {
    if (filters.status && !isStatus(story.status, filters.status)) return false;
    if (filters.goal && story.goalId !== filters.goal) return false;
    if (filters.priority && !isPriority(story.priority, filters.priority)) return false;
    if (filters.sprint) {
      if (filters.sprint === 'no-sprint' && story.sprintId) return false;
      if (filters.sprint !== 'no-sprint' && story.sprintId !== filters.sprint) return false;
    }
    return true;
  });

  return (
    <Container fluid className="mt-4">
      {/* Header */}
      <Row>
        <Col md={12}>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Story Backlog</h2>
            <div>
              <Badge bg="primary" className="me-2">
                {filteredStories.length} Total Stories
              </Badge>
              <Badge bg="secondary">
                {filteredStories.filter(s => isStatus(s.status, 'backlog')).length} In Backlog
              </Badge>
            </div>
          </div>

          {/* Filter Controls */}
          <div className="row mb-3">
            <div className="col-md-3">
              <Form.Select
                size="sm"
                value={filters.status}
                onChange={(e) => setFilters({...filters, status: e.target.value})}
              >
                <option value="">All Statuses</option>
                <option value="backlog">Backlog</option>
                <option value="active">Active</option>
                <option value="done">Done</option>
              </Form.Select>
            </div>
            <div className="col-md-3">
              <Form.Select
                size="sm"
                value={filters.goal}
                onChange={(e) => setFilters({...filters, goal: e.target.value})}
              >
                <option value="">All Goals</option>
                {goals.map(goal => (
                  <option key={goal.id} value={goal.id}>{goal.title}</option>
                ))}
              </Form.Select>
            </div>
            <div className="col-md-3">
              <Form.Select
                size="sm"
                value={filters.priority}
                onChange={(e) => setFilters({...filters, priority: e.target.value})}
              >
                <option value="">All Priorities</option>
                <option value="P1">P1</option>
                <option value="P2">P2</option>
                <option value="P3">P3</option>
              </Form.Select>
            </div>
            <div className="col-md-3">
              <Form.Select
                size="sm"
                value={filters.sprint}
                onChange={(e) => setFilters({...filters, sprint: e.target.value})}
              >
                <option value="">All Sprints</option>
                {sprints.map(sprint => (
                  <option key={sprint.id} value={sprint.id}>{sprint.name}</option>
                ))}
                <option value="no-sprint">No Sprint</option>
              </Form.Select>
            </div>
          </div>
          <div className="row mb-3">
            <div className="col-md-3">
              <Button 
                variant="outline-secondary" 
                size="sm" 
                onClick={() => setFilters({status: '', goal: '', priority: '', sprint: ''})}
              >
                Clear Filters
              </Button>
            </div>
          </div>
        </Col>
      </Row>

      {/* Stories Table */}
      <Row>
        <Col md={12}>
          <Card>
            <Card.Header>
              <h5 className="mb-0">All Stories</h5>
            </Card.Header>
            <Card.Body>
              {stories.length === 0 ? (
                <div className="text-center text-muted py-4">
                  <h6>No Stories Found</h6>
                  <p>Create your first story using the + button or go to the Kanban board.</p>
                </div>
              ) : (
                <Table responsive hover>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Goal</th>
                      <th>Priority</th>
                      <th>Points</th>
                      <th>Sprint</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStories.map((story) => {
                      const goalTheme = getGoalTheme(story.goalId);
                      const themeColor = getThemeColorVar(goalTheme);
                      return (
                        <tr key={story.id} style={{ borderLeft: `4px solid ${themeColor}` }}>
                          <td>
                            <div>
                              <strong>{story.title}</strong>
                              {story.description && (
                                <div className="text-muted small mt-1">{story.description}</div>
                              )}
                            </div>
                          </td>
                          <td>
                            <Badge className="me-1" style={{ backgroundColor: themeColor, color: 'var(--on-accent)' }}>
                              {goalTheme}
                            </Badge>
                            <div className="small text-muted">{getGoalTitle(story.goalId)}</div>
                          </td>
                          <td>
                            <Badge bg={getPriorityColor(getPriorityName(story.priority))}>
                              {story.priority}
                            </Badge>
                          </td>
                          <td>
                            <Badge bg="info">{story.points} pts</Badge>
                          </td>
                          <td>
                            {story.sprintId ? (
                              <Badge bg="warning">
                                {sprints.find(s => s.id === story.sprintId)?.name || 'Unknown Sprint'}
                              </Badge>
                            ) : (
                              <span className="text-muted">No Sprint</span>
                            )}
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <Dropdown>
                              <Dropdown.Toggle as={Badge} bg={isStatus(story.status, 'done') ? 'success' : 
                                  isStatus(story.status, 'active') ? 'warning' : 'secondary'} style={{ cursor: 'pointer' }}>
                                {getStatusName(story.status).replace('_', ' ').toUpperCase()}
                              </Dropdown.Toggle>
                              <Dropdown.Menu>
                                <Dropdown.Item onClick={() => updateStoryStatus(story.id, 'backlog')}>
                                  Backlog
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateStoryStatus(story.id, 'active')}>
                                  Active
                                </Dropdown.Item>
                                <Dropdown.Item onClick={() => updateStoryStatus(story.id, 'done')}>
                                  Done
                                </Dropdown.Item>
                              </Dropdown.Menu>
                            </Dropdown>
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              <Button 
                                size="sm" 
                                variant="outline-primary"
                                onClick={() => {/* TODO: Add edit functionality */}}
                                title="Edit Story"
                              >
                                <i className="fas fa-edit"></i>
                              </Button>
                              {!isStatus(story.status, 'backlog') && (
                                <Button 
                                  size="sm" 
                                  variant="outline-secondary"
                                  onClick={() => updateStoryStatus(story.id, 'backlog')}
                                >
                                  → Backlog
                                </Button>
                              )}
                              {!isStatus(story.status, 'active') && (
                                <Button 
                                  size="sm" 
                                  variant="outline-warning"
                                  onClick={() => updateStoryStatus(story.id, 'active')}
                                >
                                  → Active
                                </Button>
                              )}
                              {!isStatus(story.status, 'done') && (
                                <Button 
                                  size="sm" 
                                  variant="outline-success"
                                  onClick={() => updateStoryStatus(story.id, 'done')}
                                >
                                  → Done
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default StoryBacklog;

export {};
