import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup, Badge } from 'react-bootstrap';
import { Plus, Upload, List, Grid } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Goal } from '../types';
import ModernStoriesTable from './ModernStoriesTable';
import AddStoryModal from './AddStoryModal';
import EditStoryModal from './EditStoryModal';
import ImportModal from './ImportModal';
import StoryTasksPanel from './StoryTasksPanel';
import StoriesCardView from './StoriesCardView';
import { isStatus, isTheme } from '../utils/statusHelpers';
import CompactSprintMetrics from './CompactSprintMetrics';

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
  const [showEditStoryModal, setShowEditStoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');

  // 📍 PAGE TRACKING
  useEffect(() => {
    console.log('🏠 PAGE NAVIGATION: Stories Management component mounted');
    console.log('🌐 Current URL:', window.location.href);
    console.log('📍 Current pathname:', window.location.pathname);
    console.log('👤 Current user:', currentUser?.email);
    console.log('🎭 Current persona:', currentPersona);
    
    return () => {
      console.log('🏠 PAGE NAVIGATION: Stories Management component unmounted');
    };
  }, []);

  // 🔧 FILTER TRACKING
  useEffect(() => {
    console.log('🔧 FILTER CHANGE - Stories Management:');
    console.log('📋 Filter Status:', filterStatus);
    console.log('🎯 Filter Goal:', filterGoal);
    console.log('🔍 Search Term:', searchTerm || '(empty)');
  }, [filterStatus, filterGoal, searchTerm]);

  useEffect(() => {
    if (!currentUser) return;
    loadStoriesData();
  }, [currentUser, currentPersona]);

  const loadStoriesData = async () => {
    if (!currentUser) return;
    
    setLoading(true);
    
    // Load stories data - simplified query to avoid index requirements
    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    // Load goals data for relationships
    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    // Subscribe to real-time updates
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      console.log('🔄 Stories snapshot received, docs count:', snapshot.docs.length);
      const storiesData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        };
      }) as Story[];
      
      // Sort by createdAt in memory to avoid index requirements
      storiesData.sort((a, b) => {
        const aDate = a.createdAt instanceof Date ? a.createdAt : new Date(0);
        const bDate = b.createdAt instanceof Date ? b.createdAt : new Date(0);
        return bDate.getTime() - aDate.getTime(); // Desc order (newest first)
      });
      
      console.log('📊 Setting stories state with:', storiesData.length, 'stories');
      setStories(storiesData);
    });
    
    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      console.log('🎯 Goals snapshot received, docs count:', snapshot.docs.length);
      const goalsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        };
      }) as Goal[];
      console.log('📊 Setting goals state with:', goalsData.length, 'goals');
      console.log('🎯 Goals details:', goalsData.map(g => ({ id: g.id, title: g.title })));
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
      console.log('📚 Adding new story:', storyData);
      console.log('👤 Current user:', currentUser?.email);
      console.log('🎭 Current persona:', currentPersona);
      
      // Generate reference number
      const refNumber = `STY-${Date.now()}`;
      
      // Create the story document
      const newStory = {
        ...storyData,
        ref: refNumber,
        ownerUid: currentUser!.uid,
        persona: 'personal' as const, // Explicitly set to 'personal' to match Story type
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // Default values if not provided
        status: storyData.status || 0, // 0=Backlog
        priority: storyData.priority || 3, // 3=P3
        theme: storyData.theme || 1, // 1=Health
        points: storyData.points || 1,
        wipLimit: storyData.wipLimit || 3,
        orderIndex: storyData.orderIndex || 0
      };

      console.log('💾 Story data being saved:', newStory);

      // Add to Firestore
      const docRef = await addDoc(collection(db, 'stories'), newStory);
      
      console.log('✅ Story created successfully with ID:', docRef.id);
      console.log('🔄 Real-time listener should pick this up automatically...');
      
      // Small delay to ensure Firestore processes the write
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('❌ Error adding story:', error);
      throw error;
    }
  };

  // Edit story function
  const openEditStory = (story: Story) => {
    console.log('📝 Opening edit modal for story:', story);
    setSelectedStory(story);
    setShowEditStoryModal(true);
  };

  const handleStoryUpdated = () => {
    console.log('✅ Story updated successfully');
    setShowEditStoryModal(false);
    setSelectedStory(null);
    // The real-time listener will automatically update the stories list
  };

  // Apply filters to stories
  const filteredStories = stories.filter(story => {
    if (filterStatus !== 'all' && !isStatus(story.status, filterStatus)) return false;
    if (filterGoal !== 'all' && story.goalId !== filterGoal) return false;
    if (searchTerm && !story.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Debug filtering
  console.log('🔍 FILTER DEBUG:');
  console.log('📊 Total stories:', stories.length);
  console.log('🎯 Filter goal:', filterGoal);
  console.log('📋 Filter status:', filterStatus);
  console.log('🔍 Search term:', searchTerm);
  console.log('✅ Filtered stories:', filteredStories.length);
  console.log('📝 Stories being passed to table:', filteredStories.map(s => ({ id: s.id, title: s.title, goalId: s.goalId })));

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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* View Mode Toggle */}
            <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: '6px', overflow: 'hidden' }}>
              <Button
                variant={viewMode === 'list' ? 'primary' : 'outline-secondary'}
                size="sm"
                onClick={() => setViewMode('list')}
                style={{ 
                  borderRadius: '0',
                  borderRight: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <List size={14} />
                List
              </Button>
              <Button
                variant={viewMode === 'cards' ? 'primary' : 'outline-secondary'}
                size="sm"
                onClick={() => setViewMode('cards')}
                style={{ 
                  borderRadius: '0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Grid size={14} />
                Cards
              </Button>
            </div>
            
            <CompactSprintMetrics />
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
              onClick={() => setShowAddStoryModal(true)}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={16} />
              Add Story
            </Button>
          </div>
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
              <div style={{ height: '600px', overflow: 'auto' }} data-component="StoriesManagement">
                {viewMode === 'list' ? (
                  <ModernStoriesTable
                    stories={filteredStories}
                    goals={goals}
                    onStoryUpdate={handleStoryUpdate}
                    onStoryDelete={handleStoryDelete}
                    onStoryPriorityChange={handleStoryPriorityChange}
                    onStoryAdd={handleStoryAdd}
                    onStorySelect={setSelectedStory}
                    onEditStory={openEditStory}
                    goalId="all"
                  />
                ) : (
                  <StoriesCardView 
                    stories={filteredStories}
                    goals={goals}
                    onStoryUpdate={handleStoryUpdate}
                    onStoryDelete={handleStoryDelete}
                    onStorySelect={setSelectedStory}
                    onEditStory={openEditStory}
                    selectedStoryId={selectedStory?.id || null}
                  />
                )}
              </div>
            )}
          </Card.Body>
        </Card>
      </div>

      {/* Story Tasks Panel */}
      {selectedStory && (
        <StoryTasksPanel
          story={selectedStory}
          onClose={() => setSelectedStory(null)}
        />
      )}

      {/* Add Story Modal */}
      <AddStoryModal 
        show={showAddStoryModal} 
        onClose={() => {
          setShowAddStoryModal(false);
          // Refresh stories data when modal closes
          loadStoriesData();
        }} 
      />

      {/* Edit Story Modal */}
      <EditStoryModal
        show={showEditStoryModal}
        onHide={() => setShowEditStoryModal(false)}
        story={selectedStory}
        goals={goals}
        onStoryUpdated={handleStoryUpdated}
      />

      {/* Import Stories Modal */}
      <ImportModal
        entityType="stories"
        show={showImportModal}
        onHide={() => setShowImportModal(false)}
        onImportComplete={() => {
          setShowImportModal(false);
          loadStoriesData(); // Refresh stories after import
        }}
      />
    </div>
  );
};

export default StoriesManagement;
