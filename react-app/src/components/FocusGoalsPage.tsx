import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Button, Card, Alert, Spinner, Tabs, Tab } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, getDocs, getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { FocusGoal, Goal, Story } from '../types';
import { useFocusGoals } from '../hooks/useFocusGoals';
import FocusGoalCountdownBanner from './FocusGoalCountdownBanner';
import FocusGoalWizard from './FocusGoalWizard';
import {
  autoCreateStoriesForGoals,
  autoCreateSavinsPots,
  autoCreateSprintsForFocusPeriod,
  consumeFocusWizardPrefill,
  createFocusGoal,
  deferNonFocusGoalsForPeriod,
  deactivateExistingFocusGoals,
  FocusWizardPrefill,
  triggerFocusGoalDataRefresh,
} from '../services/focusGoalsService';
import { Plus, Edit2, Trash2, Zap } from 'lucide-react';

/**
 * Focus Goals Page
 * Central hub for managing focus goals
 * - View active focus goals with countdown
 * - Create new focus goals
 * - Manage existing focus goals
 */
export const FocusGoalsPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { focusGoals, activeFocusGoals, loading } = useFocusGoals(currentUser?.uid);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPrefill, setWizardPrefill] = useState<FocusWizardPrefill | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [refreshingFocusData, setRefreshingFocusData] = useState(false);
  const [monzoBudgetSummary, setMonzoBudgetSummary] = useState<any>(null);
  const [monzoGoalAlignment, setMonzoGoalAlignment] = useState<any>(null);

  // Load Monzo budget summary and goal alignment (best-effort)
  useEffect(() => {
    const prefill = consumeFocusWizardPrefill();
    if (prefill) {
      setWizardPrefill(prefill);
      setShowWizard(true);
    }
  }, []);

  useEffect(() => {
    if (!currentUser?.uid) return;
    const uid = currentUser.uid;
    Promise.all([
      getDoc(doc(db, 'monzo_budget_summary', uid)),
      getDoc(doc(db, 'monzo_goal_alignment', uid)),
    ]).then(([budgetSnap, alignmentSnap]) => {
      if (budgetSnap.exists()) setMonzoBudgetSummary(budgetSnap.data());
      if (alignmentSnap.exists()) setMonzoGoalAlignment(alignmentSnap.data());
    }).catch(() => { /* Monzo not connected — ignore */ });
  }, [currentUser?.uid]);

  // Load goals and stories
  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setGoals([]);
      setStories([]);
      return;
    }

    const goalsQuery = query(
      collection(db, 'goals'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const storiesQuery = query(
      collection(db, 'stories'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona)
    );

    const unsubGoals = onSnapshot(goalsQuery, snap => {
      setGoals(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Goal[]);
    });

    const unsubStories = onSnapshot(storiesQuery, snap => {
      setStories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Story[]);
    });

    return () => {
      unsubGoals();
      unsubStories();
    };
  }, [currentUser?.uid, currentPersona]);

  const handleWizardSave = async (focusGoal: FocusGoal) => {
    setWizardLoading(true);
    try {
      // Deactivate existing focus goals for this timeframe
      if (currentUser?.uid) {
        await deactivateExistingFocusGoals(currentUser.uid, focusGoal.timeframe);
      }

      // Auto-create stories if needed
      const selectedGoals = goals.filter(g => focusGoal.goalIds.includes(g.id));
      const goalsNeedingStories = selectedGoals.filter(
        g => (g as any).storyCount === undefined || (g as any).storyCount === 0
      );

      let storiesCreated: string[] = [];
      if (goalsNeedingStories.length > 0 && currentUser?.uid) {
        storiesCreated = await autoCreateStoriesForGoals(goalsNeedingStories.map(g => g.id), currentUser.uid);
      }

      // Auto-create savings buckets if needed
      const goalsWithCosts = selectedGoals.filter(
        g => g.estimatedCost && g.estimatedCost > 0 && (g.costType === 'one_off' || g.costType === 'recurring')
      );

      let bucketsCreated: { [key: string]: string } = {};
      if (goalsWithCosts.length > 0 && currentUser?.uid) {
        bucketsCreated = await autoCreateSavinsPots(goalsWithCosts, currentUser.uid);
      }

      // Create focus goal
      let createdSprintIds: string[] = [];
      let deferredNonFocusCount = 0;
      if (currentUser?.uid) {
        await createFocusGoal(
          focusGoal.goalIds,
          focusGoal.timeframe,
          currentUser.uid,
          storiesCreated,
          bucketsCreated
        );

        createdSprintIds = await autoCreateSprintsForFocusPeriod({
          userId: currentUser.uid,
          persona: currentPersona || 'personal',
          timeframe: focusGoal.timeframe,
          startDate: new Date(focusGoal.startDate),
          endDate: new Date(focusGoal.endDate),
          visionText: focusGoal.visionText,
          intentProposals: focusGoal.intentProposals,
        });

        deferredNonFocusCount = await deferNonFocusGoalsForPeriod({
          userId: currentUser.uid,
          persona: currentPersona || 'personal',
          selectedGoalIds: focusGoal.goalIds,
          deferUntilMs: new Date(focusGoal.endDate).getTime(),
          reason: `Deferred for active ${focusGoal.timeframe} focus window`,
        });
      }

      console.log('[FocusGoalsPage] focus setup extras', {
        createdSprintIds: createdSprintIds.length,
        deferredNonFocusCount,
      });

      setShowWizard(false);
      setWizardPrefill(null);
    } catch (error) {
      console.error('Failed to save focus goal:', error);
      alert(`Failed to save focus goal: ${(error as any)?.message || 'Unknown error'}`);
    } finally {
      setWizardLoading(false);
    }
  };

  const handleManualRefresh = async () => {
    if (!currentUser?.uid) return;
    setRefreshingFocusData(true);
    try {
      await triggerFocusGoalDataRefresh({ forceSnapshotRefresh: true });
    } catch (error) {
      console.error('Failed to refresh focus-goal data:', error);
    } finally {
      setRefreshingFocusData(false);
    }
  };

  if (loading) {
    return (
      <Container style={{ padding: '20px', textAlign: 'center' }}>
        <Spinner animation="border" />
        <p>Loading focus goals...</p>
      </Container>
    );
  }

  return (
    <Container fluid style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
            <Zap size={28} style={{ color: '#ffc107' }} />
            Focus Goals
          </h2>
          <small style={{ color: '#666' }}>Select and track your top priorities</small>
        </div>
        <Button
          variant="primary"
          size="lg"
          onClick={() => {
            setWizardPrefill(null);
            setShowWizard(true);
          }}
        >
          <Plus size={18} className="me-2" />
          Create Focus Goals
        </Button>
      </div>

      {/* Active Focus Goals */}
      {activeFocusGoals.length > 0 ? (
        <div style={{ marginBottom: '32px' }}>
          <h4 style={{ marginBottom: '16px', fontWeight: '600' }}>
            🎯 Active Focus ({activeFocusGoals.length})
          </h4>
          {activeFocusGoals.map(focusGoal => (
            <div key={focusGoal.id} style={{ marginBottom: '20px' }}>
              <FocusGoalCountdownBanner
                focusGoal={focusGoal}
                goals={goals}
                stories={stories}
                onRefresh={handleManualRefresh}
                refreshing={refreshingFocusData}
                compact={false}
                monzoBudgetSummary={monzoBudgetSummary}
                monzoGoalAlignment={monzoGoalAlignment}
              />
            </div>
          ))}
        </div>
      ) : (
        <Alert variant="info" style={{ marginBottom: '32px' }}>
          <Zap size={16} className="me-2" style={{ display: 'inline' }} />
          <strong>No active focus goals yet.</strong> Click "Create Focus Goals" above to get started.
        </Alert>
      )}

      {/* Past Focus Goals */}
      {focusGoals.length > activeFocusGoals.length && (
        <div>
          <h4 style={{ marginBottom: '16px', fontWeight: '600' }}>📋 Previous Focus Goals</h4>
          <Row>
            {focusGoals
              .filter(fg => !fg.isActive)
              .map(focusGoal => {
                const selectedGoals = goals.filter(g => focusGoal.goalIds.includes(g.id));
                return (
                  <Col md={6} lg={4} key={focusGoal.id} style={{ marginBottom: '16px' }}>
                    <Card>
                      <Card.Body>
                        <div style={{ marginBottom: '12px' }}>
                          <strong>{selectedGoals.length} goals</strong>
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            {focusGoal.timeframe === 'sprint' ? '2 weeks' : focusGoal.timeframe === 'quarter' ? '13 weeks' : '52 weeks'}
                          </div>
                        </div>
                        <ul style={{ fontSize: '13px', marginBottom: '12px', paddingLeft: '20px' }}>
                          {selectedGoals.slice(0, 3).map(g => (
                            <li key={g.id}>{g.title}</li>
                          ))}
                          {selectedGoals.length > 3 && <li>+{selectedGoals.length - 3} more</li>}
                        </ul>
                        <small style={{ color: '#666' }}>
                          Completed: {new Date(focusGoal.endDate).toLocaleDateString()}
                        </small>
                      </Card.Body>
                    </Card>
                  </Col>
                );
              })}
          </Row>
        </div>
      )}

      {/* Wizard Modal */}
      <FocusGoalWizard
        show={showWizard}
        onHide={() => {
          setShowWizard(false);
          setWizardPrefill(null);
        }}
        goals={goals}
        existingFocusGoals={activeFocusGoals}
        initialPrefill={wizardPrefill || undefined}
        onSave={handleWizardSave}
        onAutoCreateStories={(goalIds) => autoCreateStoriesForGoals(goalIds, currentUser?.uid || '')}
        onAutoCreateSavingsBuckets={(goalsToProcess) => autoCreateSavinsPots(goalsToProcess, currentUser?.uid || '')}
      />
    </Container>
  );
};

export default FocusGoalsPage;
