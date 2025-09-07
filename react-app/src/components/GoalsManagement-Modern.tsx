import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
console.log('🟢 GoalsManagement-Modern.tsx loaded', { timestamp: new Date().toISOString() });
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal } from '../types';
import ModernGoalsTable from './ModernGoalsTable';
import { useTheme } from '../contexts/ModernThemeContext';
import ErrorBoundary from './ErrorBoundary';

const GoalsManagement: React.FC = () => {
  const { theme } = useTheme();
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  // LOGGING: Component load and theme info
  console.log('🎯 GoalsManagement-Modern Component Loading', {
    component: 'GoalsManagement-Modern',
    theme: theme,
    currentPersona: currentPersona,
    currentUser: currentUser?.email,
    timestamp: new Date().toISOString()
  });

  useEffect(() => {
    if (!currentUser) return;
    loadGoalsData();
  }, [currentUser, currentPersona]);

  const loadGoalsData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load goals data
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    // Subscribe to real-time updates
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      console.log('🔥 GoalsManagement Firebase onSnapshot triggered', {
        component: 'GoalsManagement-Modern',
        docsCount: snapshot.docs.length,
        timestamp: new Date().toISOString()
      });
      
      const { sanitizeFirestoreData } = require('../utils/firestoreUtils');
      console.log('🟡 About to sanitize all goals', { count: snapshot.docs.length, timestamp: new Date().toISOString() });
      const goalsData = snapshot.docs.map(doc => {
        const data = doc.data();
        console.log('🟠 Raw goal data before sanitizeFirestoreData', { goalId: doc.id, data });
        const sanitizedGoal = sanitizeFirestoreData({ id: doc.id, ...data });
        console.log('🧹 Goal Data After sanitizeFirestoreData', {
          goalId: doc.id,
          sanitizedGoal,
        });
        return sanitizedGoal;
      }) as Goal[];
      console.log('📋 Final Goals Data Set (after sanitization)', {
        component: 'GoalsManagement-Modern',
        goalsCount: goalsData.length,
        goalIds: goalsData.map(g => g.id),
        allGoalsData: goalsData,
        timestamp: new Date().toISOString()
      });
      setGoals(goalsData);
    });

    setLoading(false);

    return () => {
      unsubscribeGoals();
    };
  };

  // Handler functions for ModernGoalsTable
  const handleGoalUpdate = async (goalId: string, updates: Partial<Goal>) => {
    try {
      await updateDoc(doc(db, 'goals', goalId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating goal:', error);
    }
  };

  const handleGoalDelete = async (goalId: string) => {
    try {
      await deleteDoc(doc(db, 'goals', goalId));
    } catch (error) {
      console.error('Error deleting goal:', error);
    }
  };

  const handleGoalPriorityChange = async (goalId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'goals', goalId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating goal priority:', error);
    }
  };

  // Apply filters to goals
  const filteredGoals = goals.filter(goal => {
    if (filterStatus !== 'all' && goal.status !== parseInt(filterStatus)) return false;
    if (filterTheme !== 'all' && goal.theme !== parseInt(filterTheme)) return false;
    if (searchTerm && !goal.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Get counts for dashboard cards
  const goalCounts = {
    total: filteredGoals.length,
    active: filteredGoals.filter(g => g.status === 1).length, // Work in Progress
    done: filteredGoals.filter(g => g.status === 2).length, // Complete
    paused: filteredGoals.filter(g => g.status === 3).length // Blocked
  };

  return (
  <Container fluid className="py-4" style={{ background: theme.colors.background, color: theme.colors.onBackground, minHeight: '100vh' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="mb-1">Goals Management</h2>
          <p className="text-muted mb-0">Manage your life goals across different themes</p>
        </div>
        <Button variant="primary" onClick={() => alert('Add new goal - coming soon')}>
          Add Goal
        </Button>
      </div>

      {/* Dashboard Cards */}
      <Row className="mb-4">
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center">
              <h3 className="mb-1">{goalCounts.total}</h3>
              <p className="text-muted mb-0">Total Goals</p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center">
              <h3 className="mb-1">{goalCounts.active}</h3>
              <p className="text-muted mb-0">Active</p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center">
              <h3 className="mb-1">{goalCounts.done}</h3>
              <p className="text-muted mb-0">Done</p>
            </Card.Body>
          </Card>
        </Col>
        <Col lg={3} md={6} className="mb-3">
          <Card className="h-100">
            <Card.Body className="text-center">
              <h3 className="mb-1">{goalCounts.paused}</h3>
              <p className="text-muted mb-0">Paused</p>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Filters */}
      <Card className="mb-4" style={{ background: theme.colors.surface, color: theme.colors.onSurface }}>
        <Card.Body>
          <Row>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Search Goals</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="text"
                    placeholder="Search by title..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </InputGroup>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Status</Form.Label>
                <Form.Select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="new">New</option>
                  <option value="active">Active</option>
                  <option value="done">Done</option>
                  <option value="paused">Paused</option>
                  <option value="dropped">Dropped</option>
                </Form.Select>
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>Theme</Form.Label>
                <Form.Select
                  value={filterTheme}
                  onChange={(e) => setFilterTheme(e.target.value)}
                >
                  <option value="all">All Themes</option>
                  <option value="Health">Health</option>
                  <option value="Growth">Growth</option>
                  <option value="Wealth">Wealth</option>
                  <option value="Tribe">Tribe</option>
                  <option value="Home">Home</option>
                </Form.Select>
              </Form.Group>
            </Col>
          </Row>
          <Row className="mt-3">
            <Col>
              <Button 
                variant="outline-secondary" 
                onClick={() => {
                  setFilterStatus('all');
                  setFilterTheme('all');
                  setSearchTerm('');
                }}
              >
                Clear Filters
              </Button>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {/* Modern Goals Table */}
      <Card style={{ background: theme.colors.surface, color: theme.colors.onSurface }}>
        <Card.Header style={{ background: theme.colors.surface, color: theme.colors.onSurface }}>
          <h5 className="mb-0">Goals ({filteredGoals.length})</h5>
        </Card.Header>
        <Card.Body className="p-0" style={{ background: theme.colors.surface, color: theme.colors.onSurface }}>
          {loading ? (
            <div className="text-center p-4">
              <div className="spinner-border" />
              <p className="mt-2">Loading goals...</p>
            </div>
          ) : (
            <ErrorBoundary>
              <ModernGoalsTable
                goals={filteredGoals}
                onGoalUpdate={handleGoalUpdate}
                onGoalDelete={handleGoalDelete}
                onGoalPriorityChange={handleGoalPriorityChange}
              />
            </ErrorBoundary>
          )}
        </Card.Body>
      </Card>
    </Container>
  );
};

export default GoalsManagement;
