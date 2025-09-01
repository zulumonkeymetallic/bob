import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup, ButtonGroup } from 'react-bootstrap';
import { Grid, List, Plus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal } from '../types';
import ModernGoalsTable from './ModernGoalsTable';
import GoalsCardView from './GoalsCardView';
import AddGoalModal from './AddGoalModal';
import EditGoalModal from './EditGoalModal';
import { isStatus, isTheme } from '../utils/statusHelpers';

const GoalsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddGoalModal, setShowAddGoalModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Goal | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('card');

  useEffect(() => {
    if (!currentUser) return;
    loadGoalsData();
  }, [currentUser, currentPersona]);

  const loadGoalsData = async () => {
    if (!currentUser) return;
    
    console.log('🎯 Loading goals data for user:', currentUser.email);
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
      console.log('🎯 Goals data received:', snapshot.docs.length, 'goals');
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
      setLoading(false); // Set loading false when data arrives
    }, (error) => {
      console.error('❌ Error loading goals:', error);
      setLoading(false); // Set loading false on error too
    });

    return () => {
      unsubscribeGoals();
    };
  };

  // Handler functions for ModernGoalsTable
  const handleGoalUpdate = async (goalId: string, updates: Partial<Goal>) => {
    try {
      console.log(`🔄 Updating goal ${goalId} with:`, updates);
      
      await updateDoc(doc(db, 'goals', goalId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Goal ${goalId} updated successfully`);
    } catch (error) {
      console.error('❌ Error updating goal:', error);
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

  const handleEditModal = (goal: Goal) => {
    console.log('✏️ GoalsManagement: Edit modal triggered');
    console.log('✏️ Goal:', goal.id, goal.title);
    console.log('✏️ Current user:', currentUser?.email);
    setShowEditModal(goal);
  };

  // Apply filters to goals
  const filteredGoals = goals.filter(goal => {
    if (filterStatus !== 'all' && !isStatus(goal.status, filterStatus)) return false;
    if (filterTheme !== 'all' && !isTheme(goal.theme, filterTheme)) return false;
    if (searchTerm && !goal.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Get counts for dashboard cards
  const goalCounts = {
    total: goals.length,
    active: goals.filter(g => isStatus(g.status, 'Work in Progress')).length,
    done: goals.filter(g => isStatus(g.status, 'Complete')).length,
    blocked: goals.filter(g => isStatus(g.status, 'Blocked')).length,
    deferred: goals.filter(g => isStatus(g.status, 'Deferred')).length
  };

  return (
    <div style={{ 
      padding: '24px', 
      backgroundColor: '#f8f9fa',
      minHeight: '100vh',
      width: '100%'
    }}>
      <div style={{ maxWidth: '100%', margin: '0' }}>
        {/* Header with View Toggle */}
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
              Manage your life goals across different themes - Click any goal to view activity stream
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <ButtonGroup>
              <Button
                variant={viewMode === 'list' ? 'primary' : 'outline-primary'}
                onClick={() => setViewMode('list')}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <List size={16} />
                List
              </Button>
              <Button
                variant={viewMode === 'card' ? 'primary' : 'outline-primary'}
                onClick={() => setViewMode('card')}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Grid size={16} />
                Cards
              </Button>
            </ButtonGroup>
            <Button 
              variant="primary" 
              onClick={() => setShowAddGoalModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              Add Goal
            </Button>
          </div>
        </div>

        {/* Dashboard Cards */}
        <Row className="mb-4">
          <Col lg={2} md={4} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#1f2937' }}>
                  {goalCounts.total}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '12px', fontWeight: '500' }}>
                  Total Goals
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={2} md={4} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#059669' }}>
                  {goalCounts.active}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '12px', fontWeight: '500' }}>
                  Active
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={2} md={4} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#2563eb' }}>
                  {goalCounts.done}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '12px', fontWeight: '500' }}>
                  Complete
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={2} md={4} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#ef4444' }}>
                  {goalCounts.blocked}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '12px', fontWeight: '500' }}>
                  Blocked
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={2} md={4} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '20px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>
                  {goalCounts.deferred}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '12px', fontWeight: '500' }}>
                  Deferred
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
                    <option value="New">New</option>
                    <option value="Work in Progress">Work in Progress</option>
                    <option value="Complete">Complete</option>
                    <option value="Blocked">Blocked</option>
                    <option value="Deferred">Deferred</option>
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

        {/* Goals Content - Switch between List and Card View */}
        {viewMode === 'card' ? (
          <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px' }}>
            <Card.Header style={{ 
              backgroundColor: '#fff', 
              borderBottom: '1px solid #e5e7eb', 
              padding: '20px 24px' 
            }}>
              <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                Goals - Card View ({filteredGoals.length})
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
                <GoalsCardView
                  goals={filteredGoals}
                  onGoalUpdate={handleGoalUpdate}
                  onGoalDelete={handleGoalDelete}
                  onGoalPriorityChange={handleGoalPriorityChange}
                />
              )}
            </Card.Body>
          </Card>
        ) : (
          <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px' }}>
            <Card.Header style={{ 
              backgroundColor: '#fff', 
              borderBottom: '1px solid #e5e7eb', 
              padding: '20px 24px' 
            }}>
              <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                Goals - List View ({filteredGoals.length})
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
                    onEditModal={handleEditModal}
                  />
                </div>
              )}
            </Card.Body>
          </Card>
        )}
      </div>

      {/* Add Goal Modal */}
      <AddGoalModal
        show={showAddGoalModal}
        onClose={() => setShowAddGoalModal(false)}
      />

      {/* Edit Goal Modal */}
      {showEditModal && (
        <EditGoalModal
          goal={showEditModal}
          show={true}
          onClose={() => setShowEditModal(null)}
          currentUserId={currentUser?.uid || ''}
        />
      )}
    </div>
  );
};

export default GoalsManagement;
