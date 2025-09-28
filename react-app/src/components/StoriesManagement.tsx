import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup, Badge } from 'react-bootstrap';
import { Plus, Upload, List, Grid } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, addDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Story, Goal, Task, Sprint } from '../types';
import ModernStoriesTable from './ModernStoriesTable';
import AddStoryModal from './AddStoryModal';
import EditStoryModal from './EditStoryModal';
import ImportModal from './ImportModal';
import ModernTaskTable from './ModernTaskTable';
import StoriesCardView from './StoriesCardView';
import { isStatus, isTheme } from '../utils/statusHelpers';
import { generateRef } from '../utils/referenceGenerator';
import CompactSprintMetrics from './CompactSprintMetrics';
import { themeVars } from '../utils/themeVars';
import ConfirmDialog from './ConfirmDialog';
import { arrayMove } from '@dnd-kit/sortable';

const StoriesManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterGoal, setFilterGoal] = useState<string>('all');
  const [filterGoalInput, setFilterGoalInput] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showAddStoryModal, setShowAddStoryModal] = useState(false);
  const [showEditStoryModal, setShowEditStoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [activeSprintId, setActiveSprintId] = useState<string | null>(null);
  const [applyActiveSprintFilter, setApplyActiveSprintFilter] = useState(true); // default on

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

    // Load tasks for selected story panels and consistency
    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    
    // Subscribe to real-time updates
    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      console.log('🔄 Stories snapshot received, docs count:', snapshot.docs.length);
      const rawStories = snapshot.docs.map(doc => {
        const data = doc.data();
        const baseStory = {
          id: doc.id,
          ...data,
          // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        } as Story;
        if (typeof (baseStory as any).orderIndex !== 'number') {
          (baseStory as any).orderIndex = data.orderIndex ?? data.rank ?? 0;
        }
        return baseStory;
      }) as Story[];

      const normalizedStories = rawStories
        .map((story, index) => ({
          ...story,
          orderIndex:
            typeof story.orderIndex === 'number'
              ? story.orderIndex
              : (typeof story.priority === 'number' ? story.priority * 1000 : index * 1000),
        }))
        .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      
      console.log('📊 Setting stories state with:', normalizedStories.length, 'stories');
      setStories(normalizedStories);
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

    const unsubscribeTasks = onSnapshot(tasksQuery, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => {
        const data = doc.data() as any;
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        } as Task;
      });
      setTasks(tasksData);
    });

    // Load sprints to determine the active sprint (status === 1)
    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid)
    );

    const unsubscribeSprints = onSnapshot(sprintsQuery, (snapshot) => {
      const sprintsData = snapshot.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as Sprint[];
      const active = sprintsData.find(s => s.status === 1);
      setActiveSprintId(active?.id || null);
    });

    setLoading(false);

    return () => {
      unsubscribeStories();
      unsubscribeGoals();
      unsubscribeTasks();
      unsubscribeSprints();
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
    const s = stories.find(st => st.id === storyId);
    setConfirmDelete({ id: storyId, title: s?.title || storyId });
  };

  const performStoryDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteDoc(doc(db, 'stories', confirmDelete.id));
    } catch (error) {
      console.error('Error deleting story:', error);
    } finally {
      setConfirmDelete(null);
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

  const handleStoryReorder = async (activeId: string, overId: string) => {
    try {
      const ordered = [...stories].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      const ids = ordered.map(story => story.id);
      const activeIndex = ids.indexOf(activeId);
      const overIndex = ids.indexOf(overId);

      if (activeIndex === -1 || overIndex === -1) return;

      const newOrder = arrayMove(ids, activeIndex, overIndex);
      const batch = writeBatch(db);

      newOrder.forEach((id, index) => {
        batch.update(doc(db, 'stories', id), {
          orderIndex: index * 1000,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
    } catch (error) {
      console.error('Error reordering stories:', error);
    }
  };

  const handleStoryAdd = async (storyData: Omit<Story, 'ref' | 'id' | 'updatedAt' | 'createdAt'>) => {
    try {
      console.log('📚 Adding new story:', storyData);
      console.log('👤 Current user:', currentUser?.email);
      console.log('🎭 Current persona:', currentPersona);
      
      // Generate short reference like ST-3FUCOB, ensure uniqueness across current refs
      const existingRefs = stories.map(s => s.ref).filter(Boolean) as string[];
      const refNumber = generateRef('story', existingRefs);
      
      const maxOrderIndex = stories.length > 0
        ? Math.max(...stories.map(s => (typeof s.orderIndex === 'number' ? s.orderIndex : 0)))
        : 0;

      // Create the story document
      const newStory = {
        ...storyData,
        ref: refNumber,
        referenceNumber: refNumber,
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
        orderIndex: storyData.orderIndex ?? (maxOrderIndex + 1000)
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
    if (applyActiveSprintFilter && activeSprintId && story.sprintId !== activeSprintId) return false;
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

  const orderedFilteredStories = [...filteredStories].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  // Get counts for dashboard cards
  const storyCounts = {
    total: orderedFilteredStories.length,
    backlog: orderedFilteredStories.filter(s => isStatus(s.status, 'backlog')).length,
    active: orderedFilteredStories.filter(s => isStatus(s.status, 'active')).length,
    done: orderedFilteredStories.filter(s => isStatus(s.status, 'done')).length
  };

  return (
    <div style={{ 
      padding: '24px', 
      backgroundColor: themeVars.bg as string,
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
            <p style={{ margin: 0, color: themeVars.muted as string, fontSize: '16px' }}>
              Manage user stories and their relationships to goals
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* View Mode Toggle */}
            <div style={{ display: 'flex', border: `1px solid ${themeVars.border}`, borderRadius: '6px', overflow: 'hidden' }}>
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
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: themeVars.text as string }}>
                  {storyCounts.total}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted as string, fontSize: '14px', fontWeight: '500' }}>
                  Total Stories
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: themeVars.muted as string }}>
                  {storyCounts.backlog}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted as string, fontSize: '14px', fontWeight: '500' }}>
                  Backlog
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: themeVars.brand as string }}>
                  {storyCounts.active}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted as string, fontSize: '14px', fontWeight: '500' }}>
                  Active
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: 'none', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--green)' }}>
                  {storyCounts.done}
                </h3>
                <p style={{ margin: 0, color: themeVars.muted as string, fontSize: '14px', fontWeight: '500' }}>
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
                  <Form.Control
                    list="stories-filter-goals"
                    value={filterGoal === 'all' ? '' : (goals.find(g => g.id === filterGoal)?.title || filterGoalInput)}
                    onChange={(e) => {
                      const typed = e.target.value;
                      setFilterGoalInput(typed);
                      if (!typed) {
                        setFilterGoal('all');
                        return;
                      }
                      const match = goals.find(g => g.title === typed || g.id === typed);
                      setFilterGoal(match ? match.id : 'all');
                    }}
                    placeholder="Search goals..."
                    style={{ border: `1px solid ${themeVars.border}` }}
                  />
                  <datalist id="stories-filter-goals">
                    {goals.map(g => (
                      <option key={g.id} value={g.title} />
                    ))}
                  </datalist>
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
                    setFilterGoalInput('');
                    setSearchTerm('');
                  }}
                  style={{ borderColor: themeVars.border as string }}
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
            backgroundColor: themeVars.panel as string, 
            borderBottom: `1px solid ${themeVars.border}`, 
            padding: '20px 24px' 
          }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600' }}>
              Stories ({orderedFilteredStories.length})
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
                <p style={{ margin: 0, color: themeVars.muted as string }}>Loading stories...</p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }} data-component="StoriesManagement">
                {viewMode === 'list' ? (
                  <ModernStoriesTable
                    stories={orderedFilteredStories}
                    goals={goals}
                    onStoryUpdate={handleStoryUpdate}
                    onStoryDelete={handleStoryDelete}
                    onStoryPriorityChange={handleStoryPriorityChange}
                    onStoryAdd={handleStoryAdd}
                    onStorySelect={setSelectedStory}
                    onEditStory={openEditStory}
                    goalId="all"
                    enableInlineTasks
                    onStoryReorder={handleStoryReorder}
                  />
                ) : (
                  <StoriesCardView 
                    stories={orderedFilteredStories}
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
        <div className="mt-3">
          <Card>
            <Card.Header className="d-flex justify-content-between align-items-center">
              <h5 className="mb-0">Tasks for: {selectedStory.title}</h5>
              <Badge bg="secondary">{tasks.filter(t => t.parentType === 'story' && t.parentId === selectedStory.id).length} tasks</Badge>
            </Card.Header>
            <Card.Body style={{ padding: 0 }}>
              <ModernTaskTable
                tasks={tasks.filter(t => t.parentType === 'story' && t.parentId === selectedStory.id)}
                stories={stories}
                goals={goals}
                sprints={[]}
                onTaskCreate={async (newTask) => {
                  // Inherit theme from linked goal
                  const linkedGoal = goals.find(g => g.id === selectedStory.goalId);
                  await addDoc(collection(db, 'tasks'), {
                    title: newTask.title,
                    description: newTask.description || '',
                    parentType: 'story',
                    parentId: (newTask as any).storyId || selectedStory.id,
                    status: 0,
                    priority: newTask.priority || 2,
                    effort: 'M',
                    dueDate: newTask.dueDate || null,
                    theme: (linkedGoal as any)?.theme ?? 1,
                    ownerUid: currentUser!.uid,
                    persona: currentPersona,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  });
                }}
                onTaskUpdate={async (taskId, updates) => {
                  await updateDoc(doc(db, 'tasks', taskId), { ...updates, updatedAt: serverTimestamp() });
                }}
                onTaskDelete={async (taskId) => {
                  await deleteDoc(doc(db, 'tasks', taskId));
                }}
                onTaskPriorityChange={async (taskId, newPriority) => {
                  await updateDoc(doc(db, 'tasks', taskId), { priority: newPriority, updatedAt: serverTimestamp() });
                }}
              />
            </Card.Body>
          </Card>
        </div>
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

      <ConfirmDialog
        show={!!confirmDelete}
        title="Delete Story?"
        message={<span>Are you sure you want to delete story <strong>{confirmDelete?.title}</strong>? This cannot be undone.</span>}
        confirmText="Delete Story"
        onConfirm={performStoryDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
};

export default StoriesManagement;
