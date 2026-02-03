import React, { useState, useEffect, useCallback } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup, Badge } from 'react-bootstrap';
import { Plus, Upload, List, Grid, BookOpen, Inbox, TrendingUp, CheckCircle, FolderOpen } from 'lucide-react';
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
import { themeVars } from '../utils/themeVars';
import ConfirmDialog from './ConfirmDialog';
import { arrayMove } from '@dnd-kit/sortable';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useSprint } from '../contexts/SprintContext';
import StatCard from './common/StatCard';
import PageHeader from './common/PageHeader';
import { SkeletonStatCard } from './common/SkeletonLoader';
import EmptyState from './common/EmptyState';
import { colors } from '../utils/colors';

const StoriesManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [searchParams] = useSearchParams();
  const { sprints: contextSprints, selectedSprintId: selectedSprintIdContext } = useSprint(); // Renamed to avoid conflict
  const [stories, setStories] = useState<Story[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]); // Local state for sprints
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddStoryModal, setShowAddStoryModal] = useState(false);
  const [showEditStoryModal, setShowEditStoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedStory, setSelectedStory] = useState<Story | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  const [activeSprintId, setActiveSprintId] = useState<string | null>(null);
  const [applyActiveSprintFilter, setApplyActiveSprintFilter] = useState(true); // default on
  const [goalSearch, setGoalSearch] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  // Handle query parameters from Dashboard
  useEffect(() => {
    const filter = searchParams.get('filter');
    if (filter === 'active') {
      setFilterStatus('1'); // Status 1 = In Progress for stories
    }
  }, [searchParams]);

  useEffect(() => {
    const state = ((location as unknown) as { state?: { themeId?: string } | null }).state ?? null;
    if (state?.themeId) {
      setFilterTheme(String(state.themeId));
      // Clear navigation state to avoid reapplying on re-render
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location, navigate]);

  const loadStoriesData = useCallback(() => {
    if (!currentUser) return undefined;

    setLoading(true);

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const tasksQuery = query(
      collection(db, 'tasks'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubscribeStories = onSnapshot(storiesQuery, (snapshot) => {
      console.log('🔄 Stories snapshot received, docs count:', snapshot.docs.length);
      const rawStories = snapshot.docs.map(doc => {
        const data = doc.data();
        const baseStory = {
          id: doc.id,
          ...data,
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
    }, (error) => {
      console.warn('[StoriesManagement] stories subscribe error', error?.message || error);
    });

    const unsubscribeGoals = onSnapshot(goalsQuery, (snapshot) => {
      console.log('🎯 Goals snapshot received, docs count:', snapshot.docs.length);
      const goalsData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
          updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
        };
      }) as Goal[];
      console.log('📊 Setting goals state with:', goalsData.length, 'goals');
      console.log('🎯 Goals details:', goalsData.map(g => ({ id: g.id, title: g.title })));
      setGoals(goalsData);
    }, (error) => {
      console.warn('[StoriesManagement] goals subscribe error', error?.message || error);
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
    }, (error) => {
      console.warn('[StoriesManagement] tasks subscribe error', error?.message || error);
    });

    setLoading(false);

    return () => {
      unsubscribeStories();
      unsubscribeGoals();
      unsubscribeTasks();
    };
  }, [currentUser, currentPersona]);

  useEffect(() => {
    const unsubscribe = loadStoriesData();
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [currentUser, loadStoriesData]);

  // Keep local sprints in sync with context
  useEffect(() => {
    setSprints(contextSprints);
  }, [contextSprints]);

  // Respect selected sprint from the global selector; fall back to active sprint
  useEffect(() => {
    if (selectedSprintIdContext === '') {
      setActiveSprintId(null);
      return;
    }
    if (selectedSprintIdContext) {
      setActiveSprintId(selectedSprintIdContext);
      return;
    }
    const active = sprints.find((s) => (s.status ?? 0) === 1);
    setActiveSprintId(active?.id ?? null);
  }, [sprints, selectedSprintIdContext]);

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
        persona: currentPersona || 'personal',
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
  const resolvedSprintId = applyActiveSprintFilter
    ? (selectedSprintIdContext === '' ? null : (selectedSprintIdContext || activeSprintId))
    : null;
  const filteredStories = stories.filter(story => {
    if (applyActiveSprintFilter && resolvedSprintId && story.sprintId !== resolvedSprintId) return false;
    if (filterStatus !== 'all' && !isStatus(story.status, filterStatus)) return false;
    if (filterTheme !== 'all' && String(story.theme ?? '') !== filterTheme) return false;
    // Match search term against title + goal title
    const goal = goals.find(g => g.id === story.goalId);
    const goalText = goal?.title?.toLowerCase() || '';
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (!story.title.toLowerCase().includes(term) && !goalText.includes(term)) return false;
    }
    // Goal search box
    if (goalSearch && goalSearch.trim().length > 0) {
      const term = goalSearch.toLowerCase();
      if (!goalText.includes(term)) return false;
    }
    return true;
  });

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
        <PageHeader
          title="Stories Management"
          breadcrumbs={[
            { label: 'Home', href: '/' },
            { label: 'Stories' }
          ]}
          actions={
            <>
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

              {/* Removed duplicate metrics pills to avoid double-render with header */}
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
            </>
          }
        />

        {/* Dashboard Cards */}
        <Row className="mb-4">
          {loading ? (
            <>
              <Col lg={3} md={6} className="mb-3">
                <SkeletonStatCard />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <SkeletonStatCard />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <SkeletonStatCard />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <SkeletonStatCard />
              </Col>
            </>
          ) : (
            <>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Total Stories"
                  value={storyCounts.total}
                  icon={BookOpen}
                  iconColor={colors.brand.primary}
                />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Backlog"
                  value={storyCounts.backlog}
                  icon={Inbox}
                  iconColor={colors.neutral[500]}
                />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Active"
                  value={storyCounts.active}
                  icon={TrendingUp}
                  iconColor={colors.info.primary}
                />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Done"
                  value={storyCounts.done}
                  icon={CheckCircle}
                  iconColor={colors.success.primary}
                />
              </Col>
            </>
          )}
        </Row>

        {/* Filters */}
        <Card style={{ marginBottom: '24px', border: 'none', boxShadow: 'var(--glass-shadow, 0 2px 4px var(--glass-shadow-color))' }}>
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
                      style={{ border: '1px solid var(--line)' }}
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
                    style={{ border: '1px solid var(--line)' }}
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
                    type="text"
                    placeholder="Search goals..."
                    value={goalSearch}
                    onChange={(e) => setGoalSearch(e.target.value)}
                    style={{ border: `1px solid ${themeVars.border}` }}
                  />
                  <Form.Text muted>Filters stories by goal title match.</Form.Text>
                </Form.Group>
              </Col>
            </Row>
            <Row style={{ marginTop: '16px' }}>
              <Col>
                {filterTheme !== 'all' && (
                  <div className="mb-2">
                    <Badge bg="info" text="dark" className="me-2">
                      Theme filter active
                    </Badge>
                    <Button size="sm" variant="outline-info" onClick={() => setFilterTheme('all')}>
                      Clear theme filter
                    </Button>
                  </div>
                )}
                <Button
                  variant="outline-secondary"
                  onClick={() => {
                    setFilterStatus('all');
                    setSearchTerm('');
                    setFilterTheme('all');
                    setGoalSearch('');
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
        <Card style={{ border: 'none', boxShadow: 'var(--glass-shadow, 0 2px 4px var(--glass-shadow-color))', minHeight: '600px' }}>
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
            ) : orderedFilteredStories.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="No stories found"
                description="Get started by creating your first story or adjust your filters to see more results."
                action={{
                  label: 'Add Story',
                  onClick: () => setShowAddStoryModal(true),
                  variant: 'primary'
                }}
              />
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
                  const ref = generateRef('task', []);
                  await addDoc(collection(db, 'tasks'), {
                    ref,
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
