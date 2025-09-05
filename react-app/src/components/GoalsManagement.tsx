import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal } from '../types';
import ModernGoalsTable from './ModernGoalsTable';

const GoalsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

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
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
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
    <div style={{ 
      padding: '24px', 
      backgroundColor: '#f8f9fa',
      minHeight: '100vh',
      width: '100%'
    }}>
      <div style={{ maxWidth: '100%', margin: '0' }}>
        {/* Header */}
        <div style={{ 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center', 
          marginBottom: '24px' 
        }}>
          <div>
            <h2 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '600' }}>
              Goals Management
            </h2>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '16px' }}>
              Manage your life goals across different themes
            </p>
          </div>
          <Button variant="primary" onClick={() => alert('Add new goal - coming soon')}>
            Add Goal
          </Button>
        </div>

        {/* Dashboard Cards */}
        <Row className="mb-4">
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#1f2937' }}>
                  {goalCounts.total}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Total Goals
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#059669' }}>
                  {goalCounts.active}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Active
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#2563eb' }}>
                  {goalCounts.done}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Done
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#f59e0b' }}>
                  {goalCounts.paused}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Paused
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Filters */}
        <Card style={{ marginBottom: '24px', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
          <Card.Body style={{ padding: '24px' }}>
            <Row>
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Search Goals</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="text"
                      placeholder="Search by title..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ border: '1px solid #d1d5db' }}
                    />
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Status</Form.Label>
                  <Form.Select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ border: '1px solid #d1d5db' }}
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Theme</Form.Label>
                  <Form.Select
                    value={filterTheme}
                    onChange={(e) => setFilterTheme(e.target.value)}
                    style={{ border: '1px solid #d1d5db' }}
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
            <Row style={{ marginTop: '16px' }}>
              <Col>
                <Button 
                  variant="outline-secondary" 
                  onClick={() => {
                    setFilterStatus('all');
                    setFilterTheme('all');
                    setSearchTerm('');
                  }}
                  style={{ borderColor: '#d1d5db' }}
                >
                  Clear Filters
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Modern Goals Table - Full Width */}
        <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px' }}>
          <Card.Header style={{ 
            backgroundColor: '#fff', 
            borderBottom: '1px solid #e5e7eb', 
            padding: '20px 24px' 
          }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              Goals ({filteredGoals.length})
            </h5>
          </Card.Header>
          <Card.Body style={{ padding: 0 }}>
            {loading ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div className="spinner-border" style={{ marginBottom: '16px' }} />
                <p style={{ margin: 0, color: '#6b7280' }}>Loading goals...</p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }}>
                <ModernGoalsTable
                  goals={filteredGoals}
                  onGoalUpdate={handleGoalUpdate}
                  onGoalDelete={handleGoalDelete}
                  onGoalPriorityChange={handleGoalPriorityChange}
                />
              </div>
            )}
          </Card.Body>
        </Card>
      </div>
    </div>
  );
};

export default GoalsManagement;
