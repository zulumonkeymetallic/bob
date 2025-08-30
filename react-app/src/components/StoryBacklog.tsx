import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Badge, Table } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, updateDoc, doc } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Story, Goal } from '../types';

const StoryBacklog: React.FC = () => {
  const { currentUser } = useAuth();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

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

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
    };
  }, [currentUser]);

  const getGoalTitle = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.title : 'Unknown Goal';
  };

  const getGoalTheme = (goalId: string) => {
    const goal = goals.find(g => g.id === goalId);
    return goal ? goal.theme : 'Growth';
  };

  const getThemeColor = (theme: string) => {
    const colors = {
      'Health': 'success',
      'Growth': 'primary', 
      'Wealth': 'warning',
      'Tribe': 'info',
      'Home': 'secondary'
    };
    return colors[theme] || 'secondary';
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

  return (
    <Container fluid className="mt-4">
      {/* Header */}
      <Row>
        <Col md={12}>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Story Backlog</h2>
            <div>
              <Badge bg="primary" className="me-2">
                {stories.length} Total Stories
              </Badge>
              <Badge bg="secondary">
                {stories.filter(s => s.status === 'backlog').length} In Backlog
              </Badge>
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
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stories.map((story) => {
                      const goalTheme = getGoalTheme(story.goalId);
                      return (
                        <tr key={story.id}>
                          <td>
                            <div>
                              <strong>{story.title}</strong>
                              {story.description && (
                                <div className="text-muted small mt-1">{story.description}</div>
                              )}
                            </div>
                          </td>
                          <td>
                            <Badge bg={getThemeColor(goalTheme)} className="me-1">
                              {goalTheme}
                            </Badge>
                            <div className="small text-muted">{getGoalTitle(story.goalId)}</div>
                          </td>
                          <td>
                            <Badge bg={getPriorityColor(story.priority)}>
                              {story.priority}
                            </Badge>
                          </td>
                          <td>
                            <Badge bg="info">{story.points} pts</Badge>
                          </td>
                          <td>
                            <Badge 
                              bg={story.status === 'done' ? 'success' : 
                                  story.status === 'active' ? 'warning' : 'secondary'}
                            >
                              {story.status}
                            </Badge>
                          </td>
                          <td>
                            <div className="d-flex gap-1">
                              {story.status !== 'backlog' && (
                                <Button 
                                  size="sm" 
                                  variant="outline-secondary"
                                  onClick={() => updateStoryStatus(story.id, 'backlog')}
                                >
                                  → Backlog
                                </Button>
                              )}
                              {story.status !== 'active' && (
                                <Button 
                                  size="sm" 
                                  variant="outline-warning"
                                  onClick={() => updateStoryStatus(story.id, 'active')}
                                >
                                  → Active
                                </Button>
                              )}
                              {story.status !== 'done' && (
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
