import React, { useState, useEffect } from 'react';
import { Container, Card, Row, Col, Button, Form, InputGroup } from 'react-bootstrap';
import { useSearchParams } from 'react-router-dom';
import { Target, TrendingUp, CheckCircle, PauseCircle, FolderOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Goal } from '../types';
import ModernGoalsTable from './ModernGoalsTable';
import EditGoalModal from './EditGoalModal';
import StatCard from './common/StatCard';
import PageHeader from './common/PageHeader';
import { SkeletonStatCard } from './common/SkeletonLoader';
import EmptyState from './common/EmptyState';
import { colors } from '../utils/colors';

const GoalsManagement: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const [searchParams] = useSearchParams();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterTheme, setFilterTheme] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // Handle query parameters from Dashboard
  useEffect(() => {
    const filter = searchParams.get('filter');
    if (filter === 'active') {
      setFilterStatus('active'); // Active status for goals
    }
  }, [searchParams]);

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
    <>
      <Container fluid className="py-4">
        <PageHeader
          title="Goals Management"
          subtitle="Manage your life goals across different themes"
          breadcrumbs={[
            { label: 'Home', href: '/' },
            { label: 'Goals' }
          ]}
          actions={
            <Button variant="primary" onClick={() => setShowAddModal(true)}>
              Add Goal
            </Button>
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
                  label="Total Goals"
                  value={goalCounts.total}
                  icon={Target}
                  iconColor={colors.brand.primary}
                />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Active"
                  value={goalCounts.active}
                  icon={TrendingUp}
                  iconColor={colors.info.primary}
                />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Done"
                  value={goalCounts.done}
                  icon={CheckCircle}
                  iconColor={colors.success.primary}
                />
              </Col>
              <Col lg={3} md={6} className="mb-3">
                <StatCard
                  label="Paused"
                  value={goalCounts.paused}
                  icon={PauseCircle}
                  iconColor={colors.warning.primary}
                />
              </Col>
            </>
          )}
        </Row>

        {/* Filters */}
        <Card className="mb-4">
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
        <Card>
          <Card.Header>
            <h5 className="mb-0">Goals ({filteredGoals.length})</h5>
          </Card.Header>
          <Card.Body className="p-0">
            {loading ? (
              <div className="text-center p-4">
                <div className="spinner-border" />
                <p className="mt-2">Loading goals...</p>
              </div>
            ) : filteredGoals.length === 0 ? (
              <EmptyState
                icon={FolderOpen}
                title="No goals found"
                description="Get started by creating your first goal or adjust your filters to see more results."
                action={{
                  label: 'Add Goal',
                  onClick: () => setShowAddModal(true),
                  variant: 'primary'
                }}
              />
            ) : (
              <ModernGoalsTable
                goals={filteredGoals}
                onGoalUpdate={handleGoalUpdate}
                onGoalDelete={handleGoalDelete}
                onGoalPriorityChange={handleGoalPriorityChange}
                onEditModal={(goal) => setEditGoal(goal)}
              />
            )}
          </Card.Body>
        </Card>
      </Container>
      {/* Shared Edit Goal Modal for consistency across views */}
      <EditGoalModal
        goal={editGoal}
        show={!!editGoal || showAddModal}
        onClose={() => {
          setEditGoal(null);
          setShowAddModal(false);
        }}
        currentUserId={currentUser?.uid || ''}
        allGoals={goals}
      />
    </>
  );
};

export default GoalsManagement;
