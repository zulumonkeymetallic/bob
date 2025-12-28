import React, { useState, useEffect, useMemo } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal, Story } from '../types';
import ModernGoalsTable from './ModernGoalsTable';
import GoalsCardView from './GoalsCardView';
import EditGoalModal from './EditGoalModal';
import { useSprint } from '../contexts/SprintContext';
import SprintSelector from './SprintSelector';
import { isStatus, getThemeName } from '../utils/statusHelpers';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import ConfirmDialog from './ConfirmDialog';
import { arrayMove } from '@dnd-kit/sortable';
import { useSidebar } from '../contexts/SidebarContext';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const GoalsManagement: React.FC = () => {
  console.log('[GoalsManagement] Component RENDERING');
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [filterYear, setFilterYear] = useState<string>('current');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('cards');
  const [cardLayout, setCardLayout] = useState<'grid' | 'comfortable'>('grid');
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null);
  const [activeSprintGoalIds, setActiveSprintGoalIds] = useState<Set<string>>(new Set());
  const [applyActiveSprintFilter, setApplyActiveSprintFilter] = useState(true); // default on
  const { selectedSprintId, setSelectedSprintId, sprints } = useSprint();
  const { themes: globalThemes } = useGlobalThemes();
  const { isCollapsed, toggleCollapse } = useSidebar();

  // Load goals from Firestore
  useEffect(() => {
    console.log('[GoalsManagement] useEffect MOUNTING - setting up subscriptions');
    if (!currentUser) return;
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
        const rawGoals = snapshot.docs.map(doc => {
          const data = doc.data();
          const baseGoal = {
            id: doc.id,
            ...data,
            // Convert Firestore timestamps to JavaScript Date objects to prevent React error #31
            createdAt: data.createdAt?.toDate ? data.createdAt.toDate() : data.createdAt,
            updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate() : data.updatedAt,
            targetDate: data.targetDate?.toDate
              ? data.targetDate.toDate().getTime()
              : (typeof data.targetDate === 'object' && data.targetDate?.seconds != null
                ? (data.targetDate.seconds * 1000 + Math.floor((data.targetDate.nanoseconds || 0) / 1e6))
                : data.targetDate)
          } as Goal;
          if (typeof (baseGoal as any).orderIndex !== 'number') {
            (baseGoal as any).orderIndex = data.priority ?? data.rank ?? 0;
          }
          return baseGoal;
        }) as Goal[];

        const normalizedGoals = rawGoals
          .map((goal, index) => ({
            ...goal,
            orderIndex:
              typeof goal.orderIndex === 'number'
                ? goal.orderIndex
                : (goal.priority !== undefined ? Number(goal.priority) * 1000 : index * 1000),
          }))
          .sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

        setGoals(normalizedGoals);
      });

      setLoading(false);

      return () => {
        console.log('[GoalsManagement] useEffect CLEANUP - unsubscribing');
        unsubscribeGoals();
      };
    };
    loadGoalsData();
  }, [currentUser, currentPersona]);

  const activeSprintId = useMemo(() => {
    const active = sprints.find((s) => s.status === 1);
    return active?.id || null;
  }, [sprints]);

  useEffect(() => {
    const sprintId = selectedSprintId === '' ? null : (selectedSprintId || activeSprintId);
    if (!currentUser || !sprintId) {
      setActiveSprintGoalIds(new Set());
      return;
    }
    const storiesQ = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );
    const unsub = onSnapshot(storiesQ, (snap) => {
      const setIds = new Set<string>();
      snap.docs.forEach(d => {
        const s = d.data() as any;
        if (s.sprintId === sprintId && s.goalId) setIds.add(s.goalId);
      });
      setActiveSprintGoalIds(setIds);
    });
    return unsub;
  }, [currentUser, currentPersona, selectedSprintId, activeSprintId]);

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
    const g = goals.find(gl => gl.id === goalId);
    setConfirmDelete({ id: goalId, title: g?.title || goalId });
  };

  const performGoalDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteDoc(doc(db, 'goals', confirmDelete.id));
    } catch (error) {
      console.error('Error deleting goal:', error);
    } finally {
      setConfirmDelete(null);
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

  const handleGoalReorder = async (activeId: string, overId: string) => {
    try {
      const ordered = [...goals].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
      const ids = ordered.map(goal => goal.id);
      const activeIndex = ids.indexOf(activeId);
      const overIndex = ids.indexOf(overId);

      if (activeIndex === -1 || overIndex === -1) return;

      const newOrder = arrayMove(ids, activeIndex, overIndex);
      const batch = writeBatch(db);

      newOrder.forEach((id, index) => {
        batch.update(doc(db, 'goals', id), {
          orderIndex: index * 1000,
          updatedAt: serverTimestamp(),
        });
      });

      await batch.commit();
    } catch (error) {
      console.error('Error reordering goals:', error);
    }
  };

  // Apply filters to goals
  const filteredGoals = goals.filter(goal => {
    // If 'All Sprints' is selected (empty string), do NOT fall back to activeSprintId
    const sprintFilterId = selectedSprintId === '' ? null : (selectedSprintId || activeSprintId);
    if (applyActiveSprintFilter && sprintFilterId) {
      // Only include goals with stories in active sprint and not complete (status !== 2)
      if (goal.status === 2) return false;
      if (!activeSprintGoalIds.has(goal.id)) return false;
    }
    if (filterStatus !== 'all' && !isStatus(goal.status, filterStatus)) return false;
    if (filterTheme !== 'all' && getThemeName(goal.theme) !== filterTheme) return false;
    const derivedYear =
      (goal as any).targetYear ||
      ((goal as any).endDate ? new Date((goal as any).endDate as any).getFullYear() : undefined) ||
      ((goal as any).targetDate ? new Date((goal as any).targetDate as any).getFullYear() : undefined);
    if (filterYear === 'current') {
      const cy = new Date().getFullYear();
      if (derivedYear && derivedYear !== cy) return false;
    } else if (filterYear !== 'all') {
      if (derivedYear && String(derivedYear) !== filterYear) return false;
    }
    if (searchTerm && !goal.title.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  const orderedFilteredGoals = [...filteredGoals].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));

  // Get counts for dashboard cards
  const goalCounts = {
    total: orderedFilteredGoals.length,
    active: orderedFilteredGoals.filter(g => g.status === 1).length, // Work in Progress
    done: orderedFilteredGoals.filter(g => g.status === 2).length, // Complete
    paused: orderedFilteredGoals.filter(g => g.status === 3).length // Blocked
  };

  const availableYears = useMemo(() => {
    const years = new Set<string>();
    goals.forEach(g => {
      const yr =
        (g as any).targetYear ||
        ((g as any).endDate ? new Date((g as any).endDate as any).getFullYear() : undefined) ||
        ((g as any).targetDate ? new Date((g as any).targetDate as any).getFullYear() : undefined);
      if (yr) years.add(String(yr));
    });
    return Array.from(years).sort();
  }, [goals]);

  return (
    <div style={{
      padding: '24px',
      backgroundColor: 'var(--notion-bg)',
      color: 'var(--notion-text)',
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
            <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '16px' }}>
              Manage your life goals across different themes
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button
              size="sm"
              variant="outline-secondary"
              title={isCollapsed ? 'Expand details panel' : 'Collapse details panel'}
              onClick={toggleCollapse}
            >
              {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </Button>
            {/* View Mode Toggle */}
            <div style={{ display: 'flex', border: '1px solid var(--notion-border)', borderRadius: 6, overflow: 'hidden' }}>
              <Button
                size="sm"
                id="button-list"
                variant={viewMode === 'list' ? 'primary' : 'outline-secondary'}
                onClick={() => setViewMode('list')}
                style={{ borderRadius: 0 }}
              >
                List
              </Button>
              <Button
                size="sm"
                id="button-cards"
                variant={viewMode === 'cards' ? 'primary' : 'outline-secondary'}
                onClick={() => setViewMode('cards')}
                style={{ borderRadius: 0 }}
              >
                Cards
              </Button>
            </div>
            {viewMode === 'cards' && (
              <div style={{ display: 'flex', border: '1px solid var(--notion-border)', borderRadius: 6, overflow: 'hidden' }}>
                <Button
                  size="sm"
                  variant={cardLayout === 'grid' ? 'primary' : 'outline-secondary'}
                  onClick={() => setCardLayout('grid')}
                  style={{ borderRadius: 0 }}
                >
                  4 × 5 Grid
                </Button>
                <Button
                  size="sm"
                  variant={cardLayout === 'comfortable' ? 'primary' : 'outline-secondary'}
                  onClick={() => setCardLayout('comfortable')}
                  style={{ borderRadius: 0 }}
                >
                  Comfortable
                </Button>
              </div>
            )}
            <Button variant="primary" onClick={() => alert('Add new goal - coming soon')}>
              Add Goal
            </Button>
          </div>
        </div>

        {/* Dashboard Cards */}
        <Row className="mb-4">
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--notion-text)' }}>
                  {goalCounts.total}
                </h3>
                <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '14px', fontWeight: '500' }}>
                  Total Goals
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--notion-text)' }}>
                  {goalCounts.active}
                </h3>
                <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '14px', fontWeight: '500' }}>
                  Active
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--notion-text)' }}>
                  {goalCounts.done}
                </h3>
                <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '14px', fontWeight: '500' }}>
                  Done
                </p>
              </Card.Body>
            </Card>
          </Col>
          <Col lg={3} md={6} className="mb-3">
            <Card style={{ height: '100%', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
              <Card.Body style={{ textAlign: 'center', padding: '24px' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '32px', fontWeight: '700', color: 'var(--notion-text)' }}>
                  {goalCounts.paused}
                </h3>
                <p style={{ margin: 0, color: 'var(--notion-text-secondary)', fontSize: '14px', fontWeight: '500' }}>
                  Paused
                </p>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Filters */}
        <Card style={{ marginBottom: '24px', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)' }}>
          <Card.Body style={{ padding: '24px', color: 'var(--notion-text)' }}>
            <Row>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Search Goals</Form.Label>
                  <InputGroup>
                    <Form.Control
                      type="text"
                      placeholder="Search by title..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
                    />
                  </InputGroup>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Status</Form.Label>
                  <Form.Select
                    value={filterStatus}
                    onChange={(e) => setFilterStatus(e.target.value)}
                    style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
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
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Theme</Form.Label>
                  <Form.Select
                    value={filterTheme}
                    onChange={(e) => setFilterTheme(e.target.value)}
                    style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
                  >
                    <option value="all">All Themes</option>
                    {globalThemes.map(t => (
                      <option key={t.id} value={t.label}>{t.label}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Year</Form.Label>
                  <Form.Select
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value)}
                    style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
                  >
                    <option value="current">Current Year</option>
                    <option value="all">All Years</option>
                    {availableYears.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={3}>
                <Form.Group>
                  <Form.Label style={{ fontWeight: '500', marginBottom: '8px' }}>Sprint</Form.Label>
                  <div>
                    <SprintSelector
                      selectedSprintId={selectedSprintId}
                      onSprintChange={(id) => setSelectedSprintId(id)}
                    />
                  </div>
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
                  style={{ borderColor: 'var(--notion-border)', color: 'var(--notion-text)' }}
                >
                  Clear Filters
                </Button>
              </Col>
            </Row>
          </Card.Body>
        </Card>

        {/* Modern Goals Table - Full Width */}
        <Card style={{ border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', minHeight: '600px' }}>
          <Card.Header style={{
            backgroundColor: 'var(--notion-bg)',
            borderBottom: '1px solid var(--notion-border)',
            padding: '20px 24px'
          }}>
            <h5 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: 'var(--notion-text)' }}>
              Goals ({orderedFilteredGoals.length})
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
                <p style={{ margin: 0, color: 'var(--muted)' }}>Loading goals...</p>
              </div>
            ) : (
              <div style={{ height: '600px', overflow: 'auto' }}>
                {viewMode === 'list' ? (
                  <ModernGoalsTable
                    goals={orderedFilteredGoals}
                    onGoalUpdate={handleGoalUpdate}
                    onGoalDelete={handleGoalDelete}
                    onGoalPriorityChange={handleGoalPriorityChange}
                    onGoalReorder={handleGoalReorder}
                    onEditModal={(goal) => setEditGoal(goal)}
                  />
                ) : (
                  <GoalsCardView
                    goals={orderedFilteredGoals}
                    onGoalUpdate={handleGoalUpdate}
                    onGoalDelete={handleGoalDelete}
                    onGoalPriorityChange={handleGoalPriorityChange}
                    themes={globalThemes}
                    cardLayout={cardLayout}
                  />
                )}
              </div>
            )}
          </Card.Body>
        </Card>

        {/* Shared Edit Goal Modal */}
        <EditGoalModal
          goal={editGoal}
          show={!!editGoal}
          onClose={() => setEditGoal(null)}
          currentUserId={currentUser?.uid || ''}
        />

        <ConfirmDialog
          show={!!confirmDelete}
          title="Delete Goal?"
          message={<span>Are you sure you want to delete goal <strong>{confirmDelete?.title}</strong>? This cannot be undone.</span>}
          confirmText="Delete Goal"
          onConfirm={performGoalDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      </div>
    </div>
  );
};

export default GoalsManagement;
