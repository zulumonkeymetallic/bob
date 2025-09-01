import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Goal } from '../types';
import ModernStoriesTable from './ModernStoriesTable';
import AddStoryModal from './AddStoryModal';
import { isStatus, isTheme } from '../utils/statusHelpers';

const StoriesManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterGoal, setFilterGoal] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [showAddStoryModal, setShowAddStoryModal] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    loadStoriesData();
  }, [currentUser, currentPersona]);

  const loadStoriesData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load stories data
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('createdAt', 'desc')
    );
    
    // Load goals data for relationships
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    // Subscribe to real-time updates
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      const storiesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Story[];
      setStories(storiesData);
    });
    
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      const goalsData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Goal[];
      setGoals(goalsData);
    });

    setLoading(false);

    return () => {
      unsubscribeStories();
      unsubscribeGoals();
    };
  };

  // Handler functions for ModernStoriesTable
  const handleStoryUpdate = async (storyId: string, updates: Partial<Story>) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        ...updates,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story:', error);
    }
  };

  const handleStoryDelete = async (storyId: string) => {
    try {
      await deleteDoc(doc(db, 'stories', storyId));
    } catch (error) {
      console.error('Error deleting story:', error);
    }
  };

  const handleStoryPriorityChange = async (storyId: string, newPriority: number) => {
    try {
      await updateDoc(doc(db, 'stories', storyId), {
        priority: newPriority,
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error('Error updating story priority:', error);
    }
  };

  const handleStoryAdd = async (storyData: Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>) => {
    try {
      // Add story logic would go here - for now just log
      console.log('Adding story:', storyData);
    } catch (error) {
      console.error('Error adding story:', error);
    }
  };

  // Apply filters to stories
  const filteredStories = stories.filter(story => {
    if (filterStatus !== 'all' && !isStatus(story.status, filterStatus)) return false;
    if (filterGoal !== 'all' && story.goalId !== filterGoal) return false;
    if (searchTerm && !story.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Get counts for dashboard cards
  const storyCounts = {
    total: filteredStories.length,
    backlog: filteredStories.filter(s => isStatus(s.status, 'backlog')).length,
    active: filteredStories.filter(s => isStatus(s.status, 'active')).length,
    done: filteredStories.filter(s => isStatus(s.status, 'done')).length
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
              Stories Management
            </h2>
            <p style={{ margin: 0, color: '#6b7280', fontSize: '16px' }}>
              Manage user stories and their relationships to goals
            </p>
          </div>
          <Button variant="primary" onClick={() => setShowAddStoryModal(true)}>
            Add Story
          </Button>
        </div>

        {/* Dashboard Cards */}
        <Row className="mb-4">
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#1f2937' }}>
                  {storyCounts.total}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Total Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#6b7280' }}>
                  {storyCounts.backlog}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Backlog
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#2563eb' }}>
                  {storyCounts.active}
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
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: '#059669' }}>
                  {storyCounts.done}
                </h3>
                <p style={{ margin: 0, color: '#6b7280', fontSize: '14px', fontWeight: '500' }}>
                  Done
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
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Search Stories</Form.Label>
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
                    <option value="backlog">Backlog</option>
                    <option value="active">Active</option>
                    <option value="done">Done</option>
                    <option value="archived">Archived</option>
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={4}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Goal</Form.Label>
                  <Form.Select
                    value={filterGoal}
                    onChange={(e) => setFilterGoal(e.target.value)}
                    style={{ border: '1px solid #d1d5db' }}
                  >
                    <option value="all">All Goals</option>
                    {goals.map(goal => (
                      <option key={goal.id} value={goal.id}>{goal.title}</option>
                    ))}
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
                    setFilterGoal('all');
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

        {/* Modern Stories Table - Full Width */}
        <Card style={{ border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)', minHeight: '600px' }}>
          <Card.Header style={{ 
            backgroundColor: '#fff', 
            borderBottom: '1px solid #e5e7eb', 
            padding: '20px 24px' 
          }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              Stories ({filteredStories.length})
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
                <p style={{ margin: 0, color: '#6b7280' }}>Loading stories...</p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }}>
                <ModernStoriesTable
                  stories={filteredStories}
                  goals={goals}
                  onStoryUpdate={handleStoryUpdate}
                  onStoryDelete={handleStoryDelete}
                  onStoryPriorityChange={handleStoryPriorityChange}
                  onStoryAdd={handleStoryAdd}
                  goalId="all"
                />
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Add Story Modal */}
      <AddStoryModal 
        show={showAddStoryModal} 
        onClose={() => {
          setShowAddStoryModal(false);
          // Refresh stories data when modal closes
          loadStoriesData();
        }} 
      />
    </div>
  );
};

export default StoriesManagement;
