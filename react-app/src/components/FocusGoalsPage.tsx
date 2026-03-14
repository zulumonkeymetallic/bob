import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Button, Card, Alert, Spinner, Tabs, Tab, ListGroup } from 'react-bootstrap';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, getDocs, getDoc, doc, updateDoc, serverTimestamp, addDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { FocusGoal, Goal, Story } from '../types';
import { useFocusGoals } from '../hooks/useFocusGoals';
import FocusGoalCountdownBanner from './FocusGoalCountdownBanner';
import FocusGoalWizard from './FocusGoalWizard';
import GoalKpiStudioPanel from './GoalKpiStudioPanel';
import KPIDesigner from './KPIDesigner';
import {
  autoCreateStoriesForGoals,
  autoCreateSprintsForFocusPeriod,
  consumeFocusWizardPrefill,
  createFocusGoal,
  deferNonFocusGoalsForPeriod,
  deactivateExistingFocusGoals,
  FocusWizardPrefill,
  persistMonzoGoalRefs,
  retryMonzoPotLinkForGoal,
  triggerFocusGoalDataRefresh,
} from '../services/focusGoalsService';
import { Plus, Edit2, Trash2, Zap } from 'lucide-react';
import {
  getActiveFocusLeafGoalIds,
  getGoalDisplayPath,
  getProtectedFocusGoalIds,
  isGoalInHierarchySet,
} from '../utils/goalHierarchy';
import { generateRef } from '../utils/referenceGenerator';

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
  const [activeSprintIds, setActiveSprintIds] = useState<string[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [showKpiDesigner, setShowKpiDesigner] = useState(false);
  const [kpiDesignerGoalId, setKpiDesignerGoalId] = useState<string | undefined>(undefined);
  const [wizardPrefill, setWizardPrefill] = useState<FocusWizardPrefill | null>(null);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [refreshingFocusData, setRefreshingFocusData] = useState(false);
  const [retryingMonzoGoalIds, setRetryingMonzoGoalIds] = useState<Set<string>>(new Set());
  const [updatingStoryIds, setUpdatingStoryIds] = useState<Set<string>>(new Set());
  const [monzoRetryMessage, setMonzoRetryMessage] = useState<string>('');
  const [focusAlignmentMessage, setFocusAlignmentMessage] = useState<string>('');
  const [monzoBudgetSummary, setMonzoBudgetSummary] = useState<any>(null);
  const [monzoGoalAlignment, setMonzoGoalAlignment] = useState<any>(null);

  const activeFocusGoalIdSet = React.useMemo(() => {
    return getActiveFocusLeafGoalIds(activeFocusGoals);
  }, [activeFocusGoals]);

  const activeFocusGoalsWithMonzoRefs = React.useMemo(
    () => goals.filter((goal) => activeFocusGoalIdSet.has(goal.id) && !!String(goal.monzoPotGoalRef || '').trim()),
    [goals, activeFocusGoalIdSet]
  );

  const monzoLinkTimeoutGoals = React.useMemo(
    () =>
      activeFocusGoalsWithMonzoRefs.filter((goal) => {
        const status = String(goal.monzoPotLinkStatus || '').toLowerCase();
        const linked = !!String(goal.monzoPotId || goal.linkedPotId || goal.potId || '').trim();
        return !linked && status === 'timeout';
      }),
    [activeFocusGoalsWithMonzoRefs]
  );

  const monzoLinkPendingGoals = React.useMemo(
    () =>
      activeFocusGoalsWithMonzoRefs.filter((goal) => {
        const status = String(goal.monzoPotLinkStatus || '').toLowerCase();
        const linked = !!String(goal.monzoPotId || goal.linkedPotId || goal.potId || '').trim();
        return !linked && status !== 'timeout';
      }),
    [activeFocusGoalsWithMonzoRefs]
  );

  const unalignedStoriesInActiveSprint = React.useMemo(() => {
    if (!activeFocusGoalIdSet.size || activeSprintIds.length === 0) return [];
    const sprintSet = new Set(activeSprintIds);
    return stories.filter((story) => {
      const inActiveSprint = !!story.sprintId && sprintSet.has(String(story.sprintId));
      const hasAlignedGoal = !!story.goalId && activeFocusGoalIdSet.has(String(story.goalId));
      return inActiveSprint && !hasAlignedGoal;
    });
  }, [stories, activeFocusGoalIdSet, activeSprintIds]);

  const kpiStudioGoals = React.useMemo(() => {
    if (activeFocusGoalIdSet.size > 0) {
      return goals.filter((goal) => activeFocusGoalIdSet.has(goal.id));
    }
    return goals.filter((goal) => Number(goal.status || 0) !== 2).slice(0, 6);
  }, [activeFocusGoalIdSet, goals]);

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

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setActiveSprintIds([]);
      return;
    }

    const sprintsQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      where('status', '==', 1)
    );

    const unsubSprints = onSnapshot(sprintsQuery, (snap) => {
      const ids = snap.docs.map((docSnap) => docSnap.id);
      setActiveSprintIds(ids);
    });

    return () => {
      unsubSprints();
    };
  }, [currentUser?.uid, currentPersona]);

  const materializePendingLeafGoals = async (focusGoal: FocusGoal) => {
    if (!currentUser?.uid) {
      return {
        goals,
        focusGoal,
      };
    }
    const pendingLeafGoals = Array.isArray(focusGoal.pendingLeafGoalsToCreate) ? focusGoal.pendingLeafGoalsToCreate : [];
    if (pendingLeafGoals.length === 0) {
      return {
        goals,
        focusGoal,
      };
    }

    const existingRefs = goals.map((goal) => String((goal as any).ref || '')).filter(Boolean);
    const tempToRealGoalId = new Map<string, string>();
    const createdGoals: Goal[] = [];

    for (const draftGoal of pendingLeafGoals) {
      const parentGoal = goals.find((goal) => goal.id === draftGoal.parentGoalId) || null;
      const ref = generateRef('goal', existingRefs);
      existingRefs.push(ref);
      const payload: any = {
        ref,
        title: draftGoal.title,
        description: '',
        theme: draftGoal.theme ?? parentGoal?.theme ?? 1,
        size: 2,
        timeToMasterHours: 20,
        confidence: 0.5,
        status: 0,
        ownerUid: currentUser.uid,
        persona: draftGoal.persona || parentGoal?.persona || currentPersona || 'personal',
        parentGoalId: draftGoal.parentGoalId,
        goalKind: draftGoal.goalKind || 'milestone',
        timeHorizon: draftGoal.timeHorizon || 'sprint',
        rollupMode: 'children_only',
        goalRequiresStory: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, 'goals'), payload);
      tempToRealGoalId.set(draftGoal.tempId, docRef.id);
      createdGoals.push({
        id: docRef.id,
        ...(payload as any),
      } as Goal);
    }

    const remapGoalId = (goalId: string) => tempToRealGoalId.get(goalId) || goalId;
    const remappedFocusGoal: FocusGoal = {
      ...focusGoal,
      goalIds: (focusGoal.goalIds || []).map(remapGoalId),
      focusLeafGoalIds: (focusGoal.focusLeafGoalIds || []).map(remapGoalId),
      goalTypeMap: Object.entries(focusGoal.goalTypeMap || {}).reduce<Record<string, 'story' | 'calendar'>>((acc, [goalId, value]) => {
        acc[remapGoalId(goalId)] = value;
        return acc;
      }, {}),
      sprintPlanByGoalId: Object.entries(focusGoal.sprintPlanByGoalId || {}).reduce<Record<string, number[]>>((acc, [goalId, value]) => {
        acc[remapGoalId(goalId)] = Array.isArray(value) ? value : [];
        return acc;
      }, {}),
      pendingLeafGoalsToCreate: [],
    };

    return {
      goals: [...goals, ...createdGoals],
      focusGoal: remappedFocusGoal,
    };
  };

  const applySprintPlanAssignments = async (focusGoalId: string, focusGoal: FocusGoal) => {
    if (!currentUser?.uid) return;
    const sprintPlanSegments = Array.isArray(focusGoal.sprintPlanSegments) ? focusGoal.sprintPlanSegments : [];
    const sprintPlanByGoalId = focusGoal.sprintPlanByGoalId || {};
    if (sprintPlanSegments.length === 0 || Object.keys(sprintPlanByGoalId).length === 0) return;

    const sprintsSnap = await getDocs(
      query(
        collection(db, 'sprints'),
        where('ownerUid', '==', currentUser.uid),
        where('persona', '==', currentPersona || 'personal'),
      ),
    );

    const plannedSprints = sprintsSnap.docs
      .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as any) }))
      .filter((sprint) => {
        const startMs = Number((sprint as any).startDate || 0);
        const endMs = Number((sprint as any).endDate || 0);
        return startMs <= new Date(focusGoal.endDate).getTime() && endMs >= new Date(focusGoal.startDate).getTime();
      })
      .sort((a, b) => Number((a as any).startDate || 0) - Number((b as any).startDate || 0));

    const assignedSprintIdsByGoalId: Record<string, string[]> = {};
    const batch = writeBatch(db);

    sprintPlanSegments.forEach((segment) => {
      const sprint = plannedSprints[segment.index];
      if (!sprint) return;
      const assignedGoalIds = Object.entries(sprintPlanByGoalId)
        .filter(([, segmentIndexes]) => Array.isArray(segmentIndexes) && segmentIndexes.includes(segment.index))
        .map(([goalId]) => goalId);
      if (assignedGoalIds.length === 0) return;

      assignedGoalIds.forEach((goalId) => {
        assignedSprintIdsByGoalId[goalId] = [...(assignedSprintIdsByGoalId[goalId] || []), sprint.id];
      });

      const existingFocusGoalIds = Array.isArray((sprint as any).focusGoalIds)
        ? (sprint as any).focusGoalIds.map((goalId: any) => String(goalId || '').trim()).filter(Boolean)
        : [];
      const nextFocusGoalIds = Array.from(new Set([...existingFocusGoalIds, ...assignedGoalIds]));
      batch.update(doc(db, 'sprints', sprint.id), {
        focusGoalIds: nextFocusGoalIds,
        updatedAt: serverTimestamp(),
      });
    });

    batch.update(doc(db, 'focusGoals', focusGoalId), {
      assignedSprintIdsByGoalId,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();
  };

  const handleWizardSave = async (focusGoal: FocusGoal) => {
    setWizardLoading(true);
    try {
      const materialized = await materializePendingLeafGoals(focusGoal);
      const normalizedFocusGoal = materialized.focusGoal;
      const planningGoals = materialized.goals;

      // Deactivate existing focus goals for this timeframe
      if (currentUser?.uid) {
        await deactivateExistingFocusGoals(currentUser.uid, normalizedFocusGoal.timeframe);
      }

      // Auto-create stories if needed
      const selectedLeafGoalIds = Array.isArray(normalizedFocusGoal.focusLeafGoalIds) && normalizedFocusGoal.focusLeafGoalIds.length > 0
        ? normalizedFocusGoal.focusLeafGoalIds
        : normalizedFocusGoal.goalIds;
      const selectedGoals = planningGoals.filter(g => selectedLeafGoalIds.includes(g.id));
      const selectedGoalTypeMap = normalizedFocusGoal.goalTypeMap || {};
      const goalsNeedingStories = selectedGoals.filter(
        g => selectedGoalTypeMap[g.id] !== 'calendar' && ((g as any).storyCount === undefined || (g as any).storyCount === 0)
      );

      let storiesCreated: string[] = [];
      if (goalsNeedingStories.length > 0 && currentUser?.uid) {
        storiesCreated = await autoCreateStoriesForGoals(goalsNeedingStories.map(g => g.id), currentUser.uid);
      }

      const monzoGoalRefs = normalizedFocusGoal.monzoPotGoalRefs || {};
      if (currentUser?.uid && Object.keys(monzoGoalRefs).length > 0) {
        await persistMonzoGoalRefs({
          userId: currentUser.uid,
          goalRefMap: monzoGoalRefs,
        });
      }

      let bucketsCreated: { [key: string]: string } = {};

      // Create focus goal
      let createdSprintIds: string[] = [];
      let deferredNonFocusCount = 0;
      let createdFocusGoalId: string | null = null;
      if (currentUser?.uid) {
        createdFocusGoalId = await createFocusGoal(
          selectedLeafGoalIds,
          normalizedFocusGoal.timeframe,
          currentUser.uid,
          storiesCreated,
          bucketsCreated,
          selectedGoalTypeMap,
          monzoGoalRefs,
          normalizedFocusGoal.focusRootGoalIds,
        );

        if (createdFocusGoalId) {
          await updateDoc(doc(db, 'focusGoals', createdFocusGoalId), {
            sprintPlanByGoalId: normalizedFocusGoal.sprintPlanByGoalId || {},
            sprintPlanSegments: normalizedFocusGoal.sprintPlanSegments || [],
            visionText: normalizedFocusGoal.visionText || null,
            updatedAt: serverTimestamp(),
          });
        }

        createdSprintIds = await autoCreateSprintsForFocusPeriod({
          userId: currentUser.uid,
          persona: currentPersona || 'personal',
          timeframe: normalizedFocusGoal.timeframe,
          startDate: new Date(normalizedFocusGoal.startDate),
          endDate: new Date(normalizedFocusGoal.endDate),
          visionText: normalizedFocusGoal.visionText,
          intentProposals: normalizedFocusGoal.intentProposals,
        });

        deferredNonFocusCount = await deferNonFocusGoalsForPeriod({
          userId: currentUser.uid,
          persona: currentPersona || 'personal',
          selectedGoalIds: getProtectedFocusGoalIds(normalizedFocusGoal),
          deferUntilMs: new Date(normalizedFocusGoal.endDate).getTime(),
          reason: `Deferred for active ${normalizedFocusGoal.timeframe} focus window`,
        });

        if (createdFocusGoalId) {
          await applySprintPlanAssignments(createdFocusGoalId, normalizedFocusGoal);
          await updateDoc(doc(db, 'focusGoals', createdFocusGoalId), {
            autoCreatedSprintIds: createdSprintIds,
            deferredNonFocusCount,
            updatedAt: serverTimestamp(),
          });
        }
      }

      console.log('[FocusGoalsPage] focus setup extras', {
        focusGoalId: createdFocusGoalId,
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

  const handleRetryMonzoLink = async (goalId: string) => {
    if (!currentUser?.uid || !goalId) return;
    setMonzoRetryMessage('');
    setRetryingMonzoGoalIds((prev) => {
      const next = new Set(prev);
      next.add(goalId);
      return next;
    });

    try {
      await retryMonzoPotLinkForGoal({
        userId: currentUser.uid,
        goalId,
        triggerMonzoSync: true,
      });
      setMonzoRetryMessage('Monzo link retry triggered. Refreshing focus data...');
      await handleManualRefresh();
    } catch (error) {
      console.error('Failed to retry Monzo pot link:', error);
      setMonzoRetryMessage(`Retry failed: ${(error as any)?.message || 'Unknown error'}`);
    } finally {
      setRetryingMonzoGoalIds((prev) => {
        const next = new Set(prev);
        next.delete(goalId);
        return next;
      });
    }
  };

  const handleRetryAllMonzoLinks = async () => {
    if (!currentUser?.uid || monzoLinkTimeoutGoals.length === 0) return;
    for (const goal of monzoLinkTimeoutGoals) {
      // Sequential retries avoid spiking callable usage and keep status messaging deterministic.
      // eslint-disable-next-line no-await-in-loop
      await handleRetryMonzoLink(goal.id);
    }
  };

  const withUpdatingStory = async (storyId: string, action: () => Promise<void>) => {
    setFocusAlignmentMessage('');
    setUpdatingStoryIds((prev) => {
      const next = new Set(prev);
      next.add(storyId);
      return next;
    });
    try {
      await action();
    } finally {
      setUpdatingStoryIds((prev) => {
        const next = new Set(prev);
        next.delete(storyId);
        return next;
      });
    }
  };

  const handleOpenKpiDesigner = (goalId?: string) => {
    setKpiDesignerGoalId(goalId);
    setShowKpiDesigner(true);
  };

  const handleAlignStoryToFocus = async (storyId: string) => {
    const targetGoalId = Array.from(activeFocusGoalIdSet)[0];
    if (!targetGoalId) {
      setFocusAlignmentMessage('No active focus goals available to align this story.');
      return;
    }

    await withUpdatingStory(storyId, async () => {
      await updateDoc(doc(db, 'stories', storyId), {
        goalId: targetGoalId,
        updatedAt: serverTimestamp(),
      });
      setFocusAlignmentMessage('Story aligned to current focus goals.');
    });
  };

  const handleRemoveStoryFromSprint = async (storyId: string) => {
    await withUpdatingStory(storyId, async () => {
      await updateDoc(doc(db, 'stories', storyId), {
        sprintId: null,
        updatedAt: serverTimestamp(),
      });
      setFocusAlignmentMessage('Story removed from active sprint.');
    });
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
              {Array.isArray(focusGoal.sprintPlanSegments) && focusGoal.sprintPlanSegments.length > 0 && focusGoal.sprintPlanByGoalId && (
                <Card className="mt-3 border-0 shadow-sm">
                  <Card.Body>
                    <div style={{ fontWeight: 600, marginBottom: 8 }}>Milestone sprint rollout</div>
                    <div style={{ fontSize: '13px', color: '#666', marginBottom: 10 }}>
                      Leaf goals are mapped to the sprint windows below for this focus period.
                    </div>
                    <ListGroup variant="flush">
                      {Object.entries(focusGoal.sprintPlanByGoalId)
                        .filter(([, segmentIndexes]) => Array.isArray(segmentIndexes) && segmentIndexes.length > 0)
                        .map(([goalId, segmentIndexes]) => {
                          const goal = goals.find((item) => item.id === goalId);
                          const labels = segmentIndexes
                            .map((segmentIndex) => focusGoal.sprintPlanSegments?.find((segment) => segment.index === segmentIndex)?.label)
                            .filter(Boolean)
                            .join(', ');
                          return (
                            <ListGroup.Item key={`${focusGoal.id}-${goalId}`} className="px-0">
                              <div style={{ fontWeight: 500 }}>{goal ? getGoalDisplayPath(goal.id, goals) : goalId}</div>
                              <div style={{ fontSize: '12px', color: '#666' }}>{labels || 'No sprint window assigned'}</div>
                            </ListGroup.Item>
                          );
                        })}
                    </ListGroup>
                  </Card.Body>
                </Card>
              )}
            </div>
          ))}

          {(monzoLinkTimeoutGoals.length > 0 || monzoLinkPendingGoals.length > 0) && (
            <Alert variant={monzoLinkTimeoutGoals.length > 0 ? 'warning' : 'info'} style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <strong>Monzo pot link status</strong>
                  <div style={{ fontSize: '13px' }}>
                    {monzoLinkTimeoutGoals.length > 0
                      ? `${monzoLinkTimeoutGoals.length} goal pot link${monzoLinkTimeoutGoals.length === 1 ? '' : 's'} timed out and can be retried.`
                      : `${monzoLinkPendingGoals.length} goal pot link${monzoLinkPendingGoals.length === 1 ? '' : 's'} pending sync.`}
                  </div>
                </div>
                {monzoLinkTimeoutGoals.length > 1 && (
                  <Button
                    size="sm"
                    variant="outline-warning"
                    disabled={retryingMonzoGoalIds.size > 0}
                    onClick={handleRetryAllMonzoLinks}
                  >
                    Retry all timed-out links
                  </Button>
                )}
              </div>

              {monzoLinkTimeoutGoals.length > 0 && (
                <ListGroup variant="flush" style={{ marginTop: '10px' }}>
                  {monzoLinkTimeoutGoals.map((goal) => {
                    const isRetrying = retryingMonzoGoalIds.has(goal.id);
                    return (
                      <ListGroup.Item key={goal.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{goal.title}</div>
                          <small style={{ color: '#666' }}>
                            Ref: {goal.monzoPotGoalRef || 'n/a'}
                            {goal.monzoPotLinkError ? ` • ${goal.monzoPotLinkError}` : ''}
                          </small>
                        </div>
                        <Button
                          size="sm"
                          variant="warning"
                          disabled={isRetrying}
                          onClick={() => handleRetryMonzoLink(goal.id)}
                        >
                          {isRetrying ? 'Retrying...' : 'Retry link now'}
                        </Button>
                      </ListGroup.Item>
                    );
                  })}
                </ListGroup>
              )}

              {monzoRetryMessage && (
                <div style={{ marginTop: '10px', fontSize: '13px' }}>{monzoRetryMessage}</div>
              )}
            </Alert>
          )}

          {unalignedStoriesInActiveSprint.length > 0 && (
            <Alert variant="warning" style={{ marginTop: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <strong>Unaligned stories in active sprint</strong>
                  <div style={{ fontSize: '13px' }}>
                    {unalignedStoriesInActiveSprint.length} stor{unalignedStoriesInActiveSprint.length === 1 ? 'y is' : 'ies are'} in your active sprint but not mapped to active focus goals.
                  </div>
                </div>
              </div>

              <ListGroup variant="flush" style={{ marginTop: '10px' }}>
                {unalignedStoriesInActiveSprint.slice(0, 10).map((story) => {
                  const busy = updatingStoryIds.has(story.id);
                  return (
                    <ListGroup.Item key={story.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{story.ref || story.referenceNumber || story.id}</div>
                        <small style={{ color: '#666' }}>{story.title}</small>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Button size="sm" variant="warning" disabled={busy} onClick={() => handleAlignStoryToFocus(story.id)}>
                          {busy ? 'Updating...' : 'Align to focus'}
                        </Button>
                        <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => handleRemoveStoryFromSprint(story.id)}>
                          Remove from sprint
                        </Button>
                      </div>
                    </ListGroup.Item>
                  );
                })}
              </ListGroup>

              {unalignedStoriesInActiveSprint.length > 10 && (
                <div style={{ marginTop: '8px', fontSize: '12px', color: '#666' }}>
                  Showing first 10 unaligned stories.
                </div>
              )}

              {focusAlignmentMessage && (
                <div style={{ marginTop: '10px', fontSize: '13px' }}>{focusAlignmentMessage}</div>
              )}
            </Alert>
          )}
        </div>
      ) : (
        <Alert variant="info" style={{ marginBottom: '32px' }}>
          <Zap size={16} className="me-2" style={{ display: 'inline' }} />
          <strong>No active focus goals yet.</strong> Click "Create Focus Goals" above to get started.
        </Alert>
      )}

      <GoalKpiStudioPanel
        ownerUid={currentUser?.uid || ''}
        goals={kpiStudioGoals}
        title={activeFocusGoalIdSet.size > 0 ? 'Focus KPI Studio' : 'Goal KPI Studio'}
        subtitle={activeFocusGoalIdSet.size > 0
          ? 'Design KPIs for your active focus goals and pin the right ones to the dashboard.'
          : 'Design KPIs for your current goals and pin the right ones to the dashboard.'}
        onCreateKpi={handleOpenKpiDesigner}
      />

      {/* Past Focus Goals */}
      {focusGoals.length > activeFocusGoals.length && (
        <div>
          <h4 style={{ marginBottom: '16px', fontWeight: '600' }}>📋 Previous Focus Goals</h4>
          <Row>
            {focusGoals
              .filter(fg => !fg.isActive)
              .map(focusGoal => {
                const protectedGoalIds = new Set(getProtectedFocusGoalIds(focusGoal));
                const selectedGoals = goals.filter((goal) => isGoalInHierarchySet(goal.id, goals, protectedGoalIds));
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
                          {selectedGoals.slice(0, 3).map((goal) => (
                            <li key={goal.id}>{getGoalDisplayPath(goal.id, goals)}</li>
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
        currentUserId={currentUser?.uid}
        onSave={handleWizardSave}
      />
      <KPIDesigner
        show={showKpiDesigner}
        onHide={() => {
          setShowKpiDesigner(false);
          setKpiDesignerGoalId(undefined);
        }}
        goals={kpiStudioGoals}
        ownerUid={currentUser?.uid || ''}
        initialGoalId={kpiDesignerGoalId}
      />
    </Container>
  );
};

export default FocusGoalsPage;
