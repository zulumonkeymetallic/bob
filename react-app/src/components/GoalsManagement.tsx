import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, Button, Form, Modal, Table, Badge } from 'react-bootstrap';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../contexts/AuthContext';
import { Goal } from '../types';

const GoalsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [showAddGoal, setShowAddGoal] = useState(false);
  const [newGoal, setNewGoal] = useState({
    title: '',
    description: '',
    theme: 'Growth' as const,
    size: 'M' as const,
    confidence: 0.5,
    targetDate: ''
  });

  useEffect(() => {
    if (!currentUser) return;

    const q = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Goal));
      setGoals(goalsData);
    });

    return unsubscribe;
  }, [currentUser]);

  const handleAddGoal = async () => {
    if (!currentUser || !newGoal.title.trim()) return;

    try {
      await addDoc(collection(db, 'goals'), {
        title: newGoal.title,
        description: newGoal.description,
        theme: newGoal.theme,
        size: newGoal.size,
        confidence: newGoal.confidence,
        targetDate: newGoal.targetDate || null,
        ownerUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      // Reset form
      setNewGoal({
        title: '',
        description: '',
        theme: 'Growth',
        size: 'M',
        confidence: 0.5,
        targetDate: ''
      });
      setShowAddGoal(false);
    } catch (error) {
      console.error('Error adding goal:', error);
    }
  };

  const getThemeBadge = (theme: string) => {
    const themeColors = {
      Health: 'danger',
      Growth: 'primary', 
      Wealth: 'success',
      Tribe: 'info',
      Home: 'warning'
    };
    return <Badge bg={themeColors[theme] || 'secondary'}>{theme}</Badge>;
  };

  const getSizeBadge = (size: string) => {
    return <Badge bg="outline-secondary">{size}</Badge>;
  };

  return (
    <Container className="mt-4">
      <Row>
        <Col md={12}>
          <div className="d-flex justify-content-between align-items-center mb-4">
            <h2>Goals Management</h2>
            <Button variant="primary" onClick={() => setShowAddGoal(true)}>
              Add Goal
            </Button>
          </div>
        </Col>
      </Row>

      <Row>
        <Col md={12}>
          <Card>
            <Card.Header>
              <h4 className="mb-0">Your Goals ({goals.length})</h4>
            </Card.Header>
            <Card.Body>
              {goals.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-muted">No goals yet. Create your first goal to get started!</p>
                  <Button variant="outline-primary" onClick={() => setShowAddGoal(true)}>
                    Create First Goal
                  </Button>
                </div>
              ) : (
                <Table responsive>
                  <thead>
                    <tr>
                      <th>Title</th>
                      <th>Theme</th>
                      <th>Size</th>
                      <th>Confidence</th>
                      <th>Target Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {goals.map((goal) => (
                      <tr key={goal.id}>
                        <td>
                          <div>
                            <strong>{goal.title}</strong>
                            {goal.description && (
                              <div className="text-muted small">{goal.description}</div>
                            )}
                          </div>
                        </td>
                        <td>{getThemeBadge(goal.theme)}</td>
                        <td>{getSizeBadge(goal.size)}</td>
                        <td>{Math.round(goal.confidence * 100)}%</td>
                        <td>
                          {goal.targetDate 
                            ? new Date(goal.targetDate).toLocaleDateString() 
                            : 'No date set'
                          }
                        </td>
                        <td>
                          <Button variant="outline-primary" size="sm" className="me-2">
                            Edit
                          </Button>
                          <Button variant="outline-success" size="sm">
                            Add Story
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Add Goal Modal */}
      <Modal show={showAddGoal} onHide={() => setShowAddGoal(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Add New Goal</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Row>
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label>Goal Title *</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="e.g., Run a marathon in under 4 hours"
                    value={newGoal.title}
                    onChange={(e) => setNewGoal({...newGoal, title: e.target.value})}
                  />
                </Form.Group>
              </Col>
            </Row>
            
            <Row>
              <Col md={12}>
                <Form.Group className="mb-3">
                  <Form.Label>Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    placeholder="Describe your goal in more detail..."
                    value={newGoal.description}
                    onChange={(e) => setNewGoal({...newGoal, description: e.target.value})}
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Theme</Form.Label>
                  <Form.Select
                    value={newGoal.theme}
                    onChange={(e) => setNewGoal({...newGoal, theme: e.target.value as any})}
                  >
                    <option value="Health">Health</option>
                    <option value="Growth">Growth</option>
                    <option value="Wealth">Wealth</option>
                    <option value="Tribe">Tribe</option>
                    <option value="Home">Home</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              
              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Size</Form.Label>
                  <Form.Select
                    value={newGoal.size}
                    onChange={(e) => setNewGoal({...newGoal, size: e.target.value as any})}
                  >
                    <option value="XS">XS - Quick win</option>
                    <option value="S">S - Small goal</option>
                    <option value="M">M - Medium goal</option>
                    <option value="L">L - Large goal</option>
                    <option value="XL">XL - Major goal</option>
                  </Form.Select>
                </Form.Group>
              </Col>

              <Col md={4}>
                <Form.Group className="mb-3">
                  <Form.Label>Confidence: {Math.round(newGoal.confidence * 100)}%</Form.Label>
                  <Form.Range
                    min={0}
                    max={1}
                    step={0.1}
                    value={newGoal.confidence}
                    onChange={(e) => setNewGoal({...newGoal, confidence: parseFloat(e.target.value)})}
                  />
                </Form.Group>
              </Col>
            </Row>

            <Row>
              <Col md={6}>
                <Form.Group className="mb-3">
                  <Form.Label>Target Date (optional)</Form.Label>
                  <Form.Control
                    type="date"
                    value={newGoal.targetDate}
                    onChange={(e) => setNewGoal({...newGoal, targetDate: e.target.value})}
                  />
                </Form.Group>
              </Col>
            </Row>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAddGoal(false)}>
            Cancel
          </Button>
          <Button 
            variant="primary" 
            onClick={handleAddGoal}
            disabled={!newGoal.title.trim()}
          >
            Create Goal
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default GoalsManagement;