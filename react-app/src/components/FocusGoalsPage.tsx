import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Button, Card, Alert, Spinner, ListGroup, Form } from 'react-bootstrap';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { collection, query, where, onSnapshot, getDocs, getDoc, doc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { FocusGoal, Goal, Story } from '../types';
import { useFocusGoals } from '../hooks/useFocusGoals';
import FocusGoalCountdownBanner from './FocusGoalCountdownBanner';
import FocusGoalWizard from './FocusGoalWizard';
import KPIDesigner from './KPIDesigner';
import GoalsCardView from './GoalsCardView';
import { useGlobalThemes } from '../hooks/useGlobalThemes';
import {
  autoCreateStoriesForGoals,
  autoCreateSprintsForFocusPeriod,
  consumeFocusWizardPrefill,
  createFocusGoal,
  deleteFocusGoal,
  deferNonFocusGoalsForPeriod,
  deactivateExistingFocusGoals,
  FocusWizardPrefill,
  persistMonzoGoalRefs,
  retryMonzoPotLinkForGoal,
  triggerFocusGoalDataRefresh,
  updateFocusGoal,
} from '../services/focusGoalsService';
import { getActiveFocusLeafGoalIds, getProtectedFocusGoalIds, isGoalInHierarchySet } from '../utils/goalHierarchy';
import { Plus, Zap } from 'lucide-react';

const DAY_MS = 24 * 60 * 60 * 1000;

const toMillis = (value: any): number => {
  if (!value) return Number.NaN;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? Number.NaN : parsed;
};

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
  const navigate = useNavigate();
  const location = useLocation();
  const { focusGoals, activeFocusGoals, loading } = useFocusGoals(currentUser?.uid);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [stories, setStories] = useState<Story[]>([]);
  const [activeSprintIds, setActiveSprintIds] = useState<string[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [wizardPrefill, setWizardPrefill] = useState<FocusWizardPrefill | null>(null);
  const [editingFocusGoal, setEditingFocusGoal] = useState<FocusGoal | null>(null);
  const [showKpiDesigner, setShowKpiDesigner] = useState(false);
  const [kpiDesignerGoalId, setKpiDesignerGoalId] = useState<string | undefined>(undefined);
  const [wizardLoading, setWizardLoading] = useState(false);
  const [refreshingFocusData, setRefreshingFocusData] = useState(false);
  const [deletingFocusGoalId, setDeletingFocusGoalId] = useState<string | null>(null);
  const [retryingMonzoGoalIds, setRetryingMonzoGoalIds] = useState<Set<string>>(new Set());
  const [updatingStoryIds, setUpdatingStoryIds] = useState<Set<string>>(new Set());
  const [monzoRetryMessage, setMonzoRetryMessage] = useState<string>('');
  const [focusAlignmentMessage, setFocusAlignmentMessage] = useState<string>('');
  const [monzoBudgetSummary, setMonzoBudgetSummary] = useState<any>(null);
  const [monzoGoalAlignment, setMonzoGoalAlignment] = useState<any>(null);
  const { themes: globalThemes } = useGlobalThemes();
  // Shares the same persistence key as the Goals page so the detail level follows the user across pages
  const [goalsDetailLevel, setGoalsDetailLevel] = useState<'minimal' | 'medium' | 'full'>(() => {
    try {
      const stored = localStorage.getItem('bob_goals_detail_level');
      if (stored === 'minimal' || stored === 'medium' || stored === 'full') return stored;
    } catch {}
    return 'medium';
  });
  useEffect(() => {
    try { localStorage.setItem('bob_goals_detail_level', goalsDetailLevel); } catch {}
  }, [goalsDetailLevel]);

  const activeFocusLeafGoalIdSet = React.useMemo(
    () => getActiveFocusLeafGoalIds(activeFocusGoals),
    [activeFocusGoals]
  );

  const activeProtectedGoalIdSet = React.useMemo(() => {
    const ids = new Set<string>();
    activeFocusGoals.forEach((focusGoal) => {
      getProtectedFocusGoalIds(focusGoal).forEach((goalId) => ids.add(goalId));
    });
    return ids;
  }, [activeFocusGoals]);

  const activeFocusGoalsWithMonzoRefs = React.useMemo(
    () => goals.filter((goal) => activeFocusLeafGoalIdSet.has(goal.id) && !!String(goal.monzoPotGoalRef || '').trim()),
    [goals, activeFocusLeafGoalIdSet]
  );

  const kpiStudioGoals = React.useMemo(
    () => (activeProtectedGoalIdSet.size > 0
      ? goals.filter((goal) => isGoalInHierarchySet(goal.id, goals, activeProtectedGoalIdSet))
      : goals),
    [activeProtectedGoalIdSet, goals]
  );

  // Aggregated sprint-window caption per leaf goal, across every active focus goal — replaces
  // the old per-focus-goal "Milestone sprint rollout" card (which duplicated this same goal
  // set, just with a separate GoalsCardView render). Folded into the one consolidated KPI
  // studio card below instead, via GoalsCardView's subtitleByGoalId prop.
  const sprintWindowSubtitleByGoalId = React.useMemo(() => {
    const subtitles: Record<string, string> = {};
    activeFocusGoals.forEach((focusGoal) => {
      if (!Array.isArray(focusGoal.sprintPlanSegments) || !focusGoal.sprintPlanSegments.length || !focusGoal.sprintPlanByGoalId) return;
      Object.entries(focusGoal.sprintPlanByGoalId).forEach(([goalId, segmentIndexes]) => {
        if (!Array.isArray(segmentIndexes) || !segmentIndexes.length) return;
        const labels = segmentIndexes
          .map((segmentIndex) => focusGoal.sprintPlanSegments?.find((segment) => segment.index === segmentIndex)?.label)
          .filter(Boolean)
          .join(', ');
        if (labels) subtitles[goalId] = labels;
      });
    });
    return subtitles;
  }, [activeFocusGoals]);

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
    if (!activeProtectedGoalIdSet.size || activeSprintIds.length === 0) return [];
    const sprintSet = new Set(activeSprintIds);
    return stories.filter((story) => {
      const inActiveSprint = !!story.sprintId && sprintSet.has(String(story.sprintId));
      const hasAlignedGoal = !!story.goalId && isGoalInHierarchySet(String(story.goalId), goals, activeProtectedGoalIdSet);
      return inActiveSprint && !hasAlignedGoal;
    });
  }, [stories, activeProtectedGoalIdSet, activeSprintIds, goals]);

  // Load Monzo budget summary and goal alignment (best-effort)
  useEffect(() => {
    const prefill = consumeFocusWizardPrefill();
    if (prefill) {
      setEditingFocusGoal(null);
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

  const closeWizard = () => {
    setShowWizard(false);
    setWizardPrefill(null);
    setEditingFocusGoal(null);
  };

  const handleWizardSave = async (focusGoal: FocusGoal) => {
    setWizardLoading(true);
    try {
      if (!currentUser?.uid) return;

      const selectedLeafGoalIds = Array.isArray(focusGoal.focusLeafGoalIds) && focusGoal.focusLeafGoalIds.length > 0
        ? focusGoal.focusLeafGoalIds
        : focusGoal.goalIds;
      const selectedRootGoalIds = Array.isArray(focusGoal.focusRootGoalIds) && focusGoal.focusRootGoalIds.length > 0
        ? focusGoal.focusRootGoalIds
        : selectedLeafGoalIds;
      const selectedGoalTypeMap = focusGoal.goalTypeMap || {};

      if (!editingFocusGoal) {
        await deactivateExistingFocusGoals(currentUser.uid, focusGoal.timeframe);
      }

      // Auto-create stories if needed
      const selectedGoals = goals.filter(g => selectedLeafGoalIds.includes(g.id));
      const goalsNeedingStories = selectedGoals.filter(
        g => selectedGoalTypeMap[g.id] !== 'calendar' && ((g as any).storyCount === undefined || (g as any).storyCount === 0)
      );

      let storiesCreated: string[] = [];
      if (goalsNeedingStories.length > 0) {
        storiesCreated = await autoCreateStoriesForGoals(goalsNeedingStories.map(g => g.id), currentUser.uid);
      }

      const monzoGoalRefs = focusGoal.monzoPotGoalRefs || {};
      if (Object.keys(monzoGoalRefs).length > 0) {
        await persistMonzoGoalRefs({
          userId: currentUser.uid,
          goalRefMap: monzoGoalRefs,
        });
      }

      let bucketsCreated: { [key: string]: string } = {};
      const endDateMs = toMillis(focusGoal.endDate);
      const normalizedDaysRemaining = Number.isFinite(endDateMs)
        ? Math.max(0, Math.ceil((endDateMs - Date.now()) / DAY_MS))
        : focusGoal.daysRemaining || 0;
      const focusGoalPayload: FocusGoal = {
        ...focusGoal,
        goalIds: selectedLeafGoalIds,
        focusRootGoalIds: selectedRootGoalIds,
        focusLeafGoalIds: selectedLeafGoalIds,
        storiesCreatedFor: Array.from(new Set([...(editingFocusGoal?.storiesCreatedFor || []), ...storiesCreated])),
        potIdsCreatedFor: editingFocusGoal?.potIdsCreatedFor || bucketsCreated,
        monzoPotGoalRefs: monzoGoalRefs,
        daysRemaining: normalizedDaysRemaining,
        deferredNonFocusCount: editingFocusGoal?.deferredNonFocusCount || 0,
      };

      // Create focus goal
      let createdSprintIds: string[] = [];
      let deferredNonFocusCount = 0;
      if (editingFocusGoal?.id) {
        await updateFocusGoal(editingFocusGoal.id, focusGoalPayload);
      } else {
        await createFocusGoal(
          selectedLeafGoalIds,
          focusGoal.timeframe,
          currentUser.uid,
          focusGoalPayload.storiesCreatedFor,
          bucketsCreated,
          selectedGoalTypeMap,
          monzoGoalRefs,
          focusGoalPayload,
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

        if (Number.isFinite(endDateMs)) {
          deferredNonFocusCount = await deferNonFocusGoalsForPeriod({
            userId: currentUser.uid,
            persona: currentPersona || 'personal',
            selectedGoalIds: selectedLeafGoalIds,
            deferUntilMs: endDateMs,
            reason: `Deferred for active ${focusGoal.timeframe} focus window`,
          });
        }
      }

      console.log('[FocusGoalsPage] focus setup extras', {
        focusGoalId: editingFocusGoal?.id || 'new',
        createdSprintIds: createdSprintIds.length,
        deferredNonFocusCount,
      });

      closeWizard();
      // If opened from the AI Coach setup page, return there so the user can activate the coach
      if (new URLSearchParams(location.search).get('from') === 'coach') {
        navigate('/ai-coach');
      }
    } catch (error) {
      console.error('Failed to save focus goal:', error);
      alert(`Failed to save focus goal: ${(error as any)?.message || 'Unknown error'}`);
    } finally {
      setWizardLoading(false);
    }
  };

  const handleEditFocusGoal = (focusGoal: FocusGoal) => {
    const rootIds = Array.isArray(focusGoal.focusRootGoalIds) && focusGoal.focusRootGoalIds.length > 0
      ? focusGoal.focusRootGoalIds
      : focusGoal.goalIds;
    setEditingFocusGoal(focusGoal);
    setWizardPrefill({
      title: focusGoal.title,
      visionText: focusGoal.visionText,
      timeframe: focusGoal.timeframe,
      endDateMs: toMillis(focusGoal.endDate),
      autoSelectGoalIds: rootIds,
      goalTypeMap: focusGoal.goalTypeMap || {},
      sprintPlanByGoalId: focusGoal.sprintPlanByGoalId || {},
      source: 'focus-goal-edit',
    });
    setShowWizard(true);
  };

  const handleDeleteFocusGoal = async (focusGoal: FocusGoal) => {
    if (!focusGoal?.id) return;
    const confirmed = window.confirm(
      `Delete the focus set "${focusGoal.title || 'Untitled focus set'}"? This removes only the focus set record and leaves goals, stories, and sprints intact.`
    );
    if (!confirmed) return;

    setDeletingFocusGoalId(focusGoal.id);
    try {
      await deleteFocusGoal(focusGoal.id);
      if (editingFocusGoal?.id === focusGoal.id) {
        closeWizard();
      }
    } catch (error) {
      console.error('Failed to delete focus goal:', error);
      alert(`Failed to delete focus goal: ${(error as any)?.message || 'Unknown error'}`);
    } finally {
      setDeletingFocusGoalId(null);
    }
  };

  const handleGoalUpdate = async (goalId: string, updates: Partial<Goal>) => {
    try {
      await updateDoc(doc(db, 'goals', goalId), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating goal:', error);
    }
  };

  const handleGoalDelete = async (goalId: string) => {
    const goal = goals.find((g) => g.id === goalId);
    const confirmed = window.confirm(`Delete goal "${goal?.title || goalId}"? This cannot be undone.`);
    if (!confirmed) return;
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
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating goal priority:', error);
    }
  };

  const handleOpenKpiDesigner = (goalId?: string) => {
    setKpiDesignerGoalId(goalId);
    setShowKpiDesigner(true);
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

  const handleAlignStoryToFocus = async (storyId: string) => {
    const targetGoalId = Array.from(activeFocusLeafGoalIdSet)[0];
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
            setEditingFocusGoal(null);
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <h4 style={{ margin: 0, fontWeight: '600' }}>
              🎯 Active Focus ({activeFocusGoals.length})
            </h4>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Form.Label htmlFor="focus-goals-detail-level" style={{ margin: 0, fontSize: '12px', fontWeight: 500, color: 'var(--notion-text-secondary, #666)' }}>
                Detail
              </Form.Label>
              <Form.Select
                id="focus-goals-detail-level"
                size="sm"
                value={goalsDetailLevel}
                onChange={(e) => setGoalsDetailLevel(e.target.value as 'minimal' | 'medium' | 'full')}
                style={{ width: 'auto', border: '1px solid var(--notion-border)', background: 'var(--notion-bg)', color: 'var(--notion-text)' }}
              >
                <option value="minimal">Minimal</option>
                <option value="medium">Medium</option>
                <option value="full">Full</option>
              </Form.Select>
            </div>
          </div>
          {activeFocusGoals.map(focusGoal => (
            <div key={focusGoal.id} style={{ marginBottom: '20px' }}>
              <FocusGoalCountdownBanner
                focusGoal={focusGoal}
                goals={goals}
                stories={stories}
                onEdit={() => handleEditFocusGoal(focusGoal)}
                onDelete={() => handleDeleteFocusGoal(focusGoal)}
                onRefresh={handleManualRefresh}
                refreshing={refreshingFocusData}
                compact={false}
                monzoBudgetSummary={monzoBudgetSummary}
                monzoGoalAlignment={monzoGoalAlignment}
              />
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

      {/* Consolidated with what used to be the separate per-focus-goal "Milestone sprint
          rollout" card — that duplicated this same goal set with its own GoalsCardView
          render. One hierarchy-grouped view now: same goal card everywhere in the app
          (medium detail by default, via goalsDetailLevel), with a Design KPI quick-action
          and the sprint-window caption folded in via subtitleByGoalId. */}
      <Card className="border-0 shadow-sm mb-4">
        <Card.Body>
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
            <div>
              <div className="fw-semibold">
                {activeFocusLeafGoalIdSet.size > 0 ? 'Focus KPI Studio' : 'Goal KPI Studio'}
              </div>
              <div className="text-muted small">
                {activeFocusLeafGoalIdSet.size > 0
                  ? 'Design KPIs for your active focus goals and pin the right ones to the dashboard.'
                  : 'Design KPIs for your current goals and pin the right ones to the dashboard.'}
              </div>
            </div>
            <Form.Select
              size="sm"
              value={goalsDetailLevel}
              onChange={(e) => setGoalsDetailLevel(e.target.value as 'minimal' | 'medium' | 'full')}
              style={{ width: 'auto' }}
            >
              <option value="minimal">Minimal</option>
              <option value="medium">Medium</option>
              <option value="full">Full</option>
            </Form.Select>
          </div>
          <GoalsCardView
            goals={kpiStudioGoals}
            onGoalUpdate={handleGoalUpdate}
            onGoalDelete={handleGoalDelete}
            onGoalPriorityChange={handleGoalPriorityChange}
            themes={globalThemes}
            focusGoalIds={Array.from(activeFocusLeafGoalIdSet)}
            groupByParent
            onDesignKpi={handleOpenKpiDesigner}
            cardLayout={goalsDetailLevel === 'full' ? 'comfortable' : 'grid'}
            showDescriptions={goalsDetailLevel !== 'minimal'}
            subtitleByGoalId={sprintWindowSubtitleByGoalId}
          />
        </Card.Body>
      </Card>

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
                          <strong>{focusGoal.title?.trim() || `${selectedGoals.length} goals`}</strong>
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
                          Completed: {Number.isFinite(toMillis(focusGoal.endDate)) ? new Date(toMillis(focusGoal.endDate)).toLocaleDateString() : 'Unknown'}
                        </small>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                          <Button size="sm" variant="outline-primary" onClick={() => handleEditFocusGoal(focusGoal)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="outline-danger"
                            disabled={deletingFocusGoalId === focusGoal.id}
                            onClick={() => handleDeleteFocusGoal(focusGoal)}
                          >
                            {deletingFocusGoalId === focusGoal.id ? 'Deleting…' : 'Delete'}
                          </Button>
                        </div>
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
        onHide={closeWizard}
        goals={goals}
        existingFocusGoals={editingFocusGoal ? activeFocusGoals.filter((focusGoal) => focusGoal.id !== editingFocusGoal.id) : activeFocusGoals}
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
