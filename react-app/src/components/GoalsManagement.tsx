import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup, ButtonGroup } from 'react-bootstrap';
import { Grid, List, Plus, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSidebar } from '../contexts/SidebarContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal, Story } from '../types';
import ModernGoalsTable from './ModernGoalsTable';
import GoalsCardView from './GoalsCardView';
import ModernStoriesTable from './ModernStoriesTable';
import AddGoalModal from './AddGoalModal';
import EditGoalModal from './EditGoalModal';
import ImportModal from './ImportModal';
import { isStatus, isTheme } from '../utils/statusHelpers';

const GoalsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { showSidebar } = useSidebar();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('active'); // Default to active (hide completed)
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [showAddGoalModal, setShowAddGoalModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState<Goal | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'card'>('card');

  // 📍 PAGE TRACKING
  useEffect(() => {
    console.log('🏠 PAGE NAVIGATION: Goals Management component mounted');
    console.log('🌐 Current URL:', window.location.href);
    console.log('📍 Current pathname:', window.location.pathname);
    console.log('👤 Current user:', currentUser?.email);
    console.log('🎭 Current persona:', currentPersona);
    console.log('👁️ Sidebar visible:', showSidebar);
    console.log('📊 View mode:', viewMode);
    
    return () => {
      console.log('🏠 PAGE NAVIGATION: Goals Management component unmounted');
    };
  }, []);

  // 🔧 FILTER TRACKING
  useEffect(() => {
    console.log('🔧 FILTER CHANGE - Goals Management:');
    console.log('📋 Filter Status:', filterStatus);
    console.log('🎨 Filter Theme:', filterTheme);
    console.log('🔍 Search Term:', searchTerm || '(empty)');
    console.log('📊 View Mode:', viewMode);
  }, [filterStatus, filterTheme, searchTerm, viewMode]);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null); // New state for goal selection

  useEffect(() => {
    if (!currentUser) return;
    loadGoalsData();
  }, [currentUser, currentPersona]);

  const loadGoalsData = async () => {
    if (!currentUser) return;
    
    console.log('🎯 Loading goals data for user:', currentUser.email);
    setLoading(true);
    setStoriesLoading(true);
    
    // Load goals data
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    // Load stories data
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    // Subscribe to real-time updates for goals
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      console.log('🎯 Goals data received:', snapshot.docs.length, 'goals');
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
      setLoading(false);
    }, (error) => {
      console.error('❌ Error loading goals:', error);
      setLoading(false);
    });

    // Subscribe to real-time updates for stories
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      console.log('📚 Stories data received:', snapshot.docs.length, 'stories');
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);
      setStoriesLoading(false);
    }, (error) => {
      console.error('❌ Error loading stories:', error);
      setStoriesLoading(false);
    });

    return () => {
      unsubscribeGoals();
      unsubscribeStories();
    };
  };

  // Handler functions for ModernGoalsTable
  const handleGoalSelect = (goalId: string) => {
    console.log('🎯 Goal selected:', goalId);
    console.log('🎯 Goal selected type:', typeof goalId);
    console.log('🎯 Previous selectedGoalId:', selectedGoalId);
    console.log('🎯 Previous selectedGoalId type:', typeof selectedGoalId);
    console.log('🎯 Are they equal?:', goalId === selectedGoalId);
    console.log('📊 Available stories for this goal:', stories.filter(s => s.goalId === goalId).length);
    
    setSelectedGoalId(goalId === selectedGoalId ? null : goalId); // Toggle selection
  };

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

  // Story handlers
  const handleStoryUpdate = async (storyId: string, updates: Partial<Story>) => {
    try {
      console.log(`🔄 Updating story ${storyId} with:`, updates);
      
      await updateDoc(doc(db, 'stories', storyId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
      
      console.log(`✅ Story ${storyId} updated successfully`);
    } catch (error) {
      console.error('❌ Error updating story:', error);
    }
  };

  const handleStoryDelete = async (storyId: string) => {
    try {
      await deleteDoc(doc(db, 'stories', storyId));
      console.log(`✅ Story ${storyId} deleted successfully`);
    } catch (error) {
      console.error('❌ Error deleting story:', error);
    }
  };

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
      console.log(`✅ Story ${storyId} priority updated to P${newPriority}`);
    } catch (error) {
      console.error('❌ Error updating story priority:', error);
    }
  };

  const handleStoryAdd = async (storyData: Omit<Story, 'id' | 'ref' | 'createdAt' | 'updatedAt'>) => {
    try {
      console.log('📚 Adding new story:', storyData);
      // This will be handled by the ModernStoriesTable component
    } catch (error) {
      console.error('❌ Error adding story:', error);
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
    // Handle 'active' filter to hide completed goals
    if (filterStatus === 'active' && isStatus(goal.status, 'Complete')) return false;
    if (filterStatus !== 'all' && filterStatus !== 'active' && !isStatus(goal.status, filterStatus)) return false;
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
              variant="outline-secondary" 
              onClick={() => setShowImportModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Upload size={16} />
              Import
            </Button>
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
                    <option value="active">Active (Hide Completed)</option>
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
                  onGoalSelect={handleGoalSelect}
                  selectedGoalId={selectedGoalId}
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
                <div style={{ height: '600px', overflow: 'auto' }} data-component="GoalsManagement">
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

        {/* Stories Table Section */}
        <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px', marginTop: '20px' }}>
          <Card.Header style={{ 
            backgroundColor: '#fff', 
            borderBottom: '1px solid #e5e7eb', 
            padding: '20px 24px' 
          }}>
            <div className="d-flex justify-content-between align-items-center">
              <div>
                <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
                  Stories Management ({selectedGoalId ? stories.filter(s => s.goalId === selectedGoalId).length : stories.length})
                </h5>
                <small className="text-muted">
                  {selectedGoalId 
                    ? `Showing stories for goal: ${goals.find(g => g.id === selectedGoalId)?.title || 'Unknown Goal'}`
                    : 'Manage all stories across your goals'
                  }
                </small>
              </div>
              {selectedGoalId && (
                <Button 
                  variant="outline-secondary" 
                  size="sm"
                  onClick={() => setSelectedGoalId(null)}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <span>×</span> Clear Filter
                </Button>
              )}
            </div>
          </Card.Header>
          <Card.Body style={{ padding: 0 }}>
            {storiesLoading ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '60px 20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <div className="spinner-border" style={{ marginBottom: '16px' }} />
                <p style={{ margin: 0, color: '#6b7280' }}>Loading stories...</p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }}>
                <ModernStoriesTable
                  stories={stories}
                  goals={goals}
                  onStoryUpdate={handleStoryUpdate}
                  onStoryDelete={handleStoryDelete}
                  onStoryPriorityChange={handleStoryPriorityChange}
                  onStoryAdd={handleStoryAdd}
                  goalId={selectedGoalId || undefined}
                />
              </div>
            )}
          </Card.Body>
        </Card>
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

      {/* Import Modal */}
      <ImportModal
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        entityType="goals"
        onImportComplete={() => {
          setShowImportModal(false);
          loadGoalsData(); // Refresh the data
        }}
      />
    </div>
  );
};

export default GoalsManagement;
