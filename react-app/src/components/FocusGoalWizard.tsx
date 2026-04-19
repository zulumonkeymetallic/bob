import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Button, Form, Alert, ProgressBar, ListGroup, Badge, Spinner, Card, Row, Col } from 'react-bootstrap';
import { ChevronRight, CheckCircle, AlertCircle, Zap, DollarSign, BookOpen, Calendar } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { Goal, FocusGoal } from '../types';
import { FocusWizardPrefill } from '../services/focusGoalsService';
import KPIDesigner from './KPIDesigner';
import { expandFocusGoalIdsToLeafGoalIds, getGoalDisplayPath, isLeafGoal } from '../utils/goalHierarchy';

interface FocusGoalWizardProps {
  show: boolean;
  onHide: () => void;
  goals: Goal[];
  existingFocusGoals: FocusGoal[];
  initialPrefill?: FocusWizardPrefill;
  currentUserId?: string;
  onSave: (focusGoal: FocusGoal) => Promise<void>;
}

type WizardStep = 'vision' | 'select' | 'goalTypes' | 'timeframe' | 'milestones' | 'review' | 'confirm';
type GoalPlanningType = 'story' | 'calendar';

interface SelectedGoalSummary {
  title: string;
  theme: number;
  requiresStory: boolean;
  estimatedCost?: number;
}

interface IntentPrompt {
  id: string;
  text: string;
}

interface IntentMatch {
  goalId: string;
  title: string;
  score: number;
  tag?: string;
}

interface IntentProposal {
  tag: string;
  title: string;
  rationale: string;
  confidence: number;
}

interface IntentResult {
  intakeId?: string;
  snapshotMeta?: {
    stale?: boolean;
    snapshotVersion?: string;
    goalsScanned?: number;
  };
  matches?: IntentMatch[];
  proposals?: IntentProposal[];
}

interface DraftLeafGoal {
  tempId: string;
  parentGoalId: string;
  title: string;
  theme: number;
  persona: 'personal' | 'work';
  goalKind: 'milestone';
  timeHorizon: 'sprint' | 'quarter' | 'year';
}

interface SprintPlanSegment {
  index: number;
  label: string;
  startDate: Date;
  endDate: Date;
}

const DRAFT_LEAF_PREFIX = 'draft-leaf:';

/**
 * Multi-step wizard for creating focus goal sets
 * - Step 1: Define the vision
 * - Step 2: Select goals to focus on
 * - Step 3: Choose story vs calendar handling per goal
 * - Step 4: Choose timeframe (sprint/quarter/year)
 * - Step 5: Review planned changes
 * - Step 6: Confirm and save
 */
export const FocusGoalWizard: React.FC<FocusGoalWizardProps> = ({
  show,
  onHide,
  goals,
  existingFocusGoals,
  initialPrefill,
  currentUserId,
  onSave,
}) => {
  const [step, setStep] = useState<WizardStep>('vision');
  const [selectedGoalIds, setSelectedGoalIds] = useState<Set<string>>(new Set());
  const [goalTypeMap, setGoalTypeMap] = useState<Record<string, GoalPlanningType>>({});
  const [selectedGoalsData, setSelectedGoalsData] = useState<Record<string, SelectedGoalSummary>>({});
  const [timeframe, setTimeframe] = useState<'sprint' | 'quarter' | 'year'>('sprint');
  const [loading, setLoading] = useState(false);
  const [loadingPrompts, setLoadingPrompts] = useState(false);
  const [matching, setMatching] = useState(false);
  const [error, setError] = useState('');
  const [copiedGoalRef, setCopiedGoalRef] = useState<string | null>(null);
  const [focusTitle, setFocusTitle] = useState('');
  const [visionText, setVisionText] = useState('');
  const [customEndDateInput, setCustomEndDateInput] = useState('');
  const [prompts, setPrompts] = useState<IntentPrompt[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [intentResult, setIntentResult] = useState<IntentResult | null>(null);
  const [useModernStoryTableHandoff, setUseModernStoryTableHandoff] = useState(true);
  const [goalSearchTerm, setGoalSearchTerm] = useState('');
  const [prefillMatchTriggered, setPrefillMatchTriggered] = useState(false);
  const [showKpiDesigner, setShowKpiDesigner] = useState(false);
  const [draftLeafGoals, setDraftLeafGoals] = useState<DraftLeafGoal[]>([]);
  const [draftLeafTitleByParentId, setDraftLeafTitleByParentId] = useState<Record<string, string>>({});
  const [sprintPlanByGoalId, setSprintPlanByGoalId] = useState<Record<string, number[]>>({});
  const [prefillStructureApplied, setPrefillStructureApplied] = useState(false);

  // Reset on modal open
  useEffect(() => {
    if (show) {
      setStep('vision');
      setSelectedGoalIds(new Set());
      setGoalTypeMap({});
      setSelectedGoalsData({});
      setTimeframe('sprint');
      setError('');
      setCopiedGoalRef(null);
      setFocusTitle('');
      setVisionText('');
      setCustomEndDateInput('');
      setPrompts([]);
      setSelectedPromptId('');
      setIntentResult(null);
      setUseModernStoryTableHandoff(true);
      setGoalSearchTerm('');
      setPrefillMatchTriggered(false);
      setShowKpiDesigner(false);
      setDraftLeafGoals([]);
      setDraftLeafTitleByParentId({});
      setSprintPlanByGoalId({});
      setPrefillStructureApplied(false);
    }
  }, [show]);

  const planningGoals = useMemo<Goal[]>(() => {
    const draftPlanningGoals: Goal[] = draftLeafGoals.map((draft) => ({
      id: draft.tempId,
      ref: draft.tempId,
      ownerUid: currentUserId || '',
      persona: draft.persona,
      title: draft.title,
      theme: draft.theme,
      size: 2,
      timeToMasterHours: 20,
      confidence: 0.5,
      status: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      parentGoalId: draft.parentGoalId,
      goalKind: draft.goalKind,
      timeHorizon: draft.timeHorizon,
      rollupMode: 'children_only',
      goalRequiresStory: true,
    }));
    return [...goals, ...draftPlanningGoals];
  }, [currentUserId, draftLeafGoals, goals]);

  useEffect(() => {
    if (!show || !initialPrefill) return;
    if (initialPrefill.title) setFocusTitle(initialPrefill.title);
    if (initialPrefill.timeframe) setTimeframe(initialPrefill.timeframe);
    if (initialPrefill.visionText) setVisionText(initialPrefill.visionText);
    if (initialPrefill.searchTerm) setGoalSearchTerm(initialPrefill.searchTerm);
    if (initialPrefill.goalTypeMap) setGoalTypeMap(initialPrefill.goalTypeMap);
    if (initialPrefill.sprintPlanByGoalId) setSprintPlanByGoalId(initialPrefill.sprintPlanByGoalId);
    if (initialPrefill.endDateMs) {
      const nextDate = new Date(initialPrefill.endDateMs);
      if (!Number.isNaN(nextDate.getTime())) setCustomEndDateInput(nextDate.toISOString().slice(0, 10));
    }
  }, [show, initialPrefill]);

  useEffect(() => {
    if (!show || !initialPrefill || prefillStructureApplied) return;

    const requestedGoalIds = Array.isArray(initialPrefill.autoSelectGoalIds)
      ? initialPrefill.autoSelectGoalIds.map((goalId) => String(goalId || '').trim()).filter(Boolean)
      : [];
    const requestedMilestones = Array.isArray(initialPrefill.queuedLeafMilestones)
      ? initialPrefill.queuedLeafMilestones.map((title) => String(title || '').trim()).filter(Boolean)
      : [];

    if (requestedGoalIds.length > 0) {
      const allGoalsReady = requestedGoalIds.every((goalId) => goals.some((goal) => goal.id === goalId));
      if (!allGoalsReady) return;
    }

    if (requestedGoalIds.length > 0) {
      setSelectedGoalIds((prev) => {
        const next = new Set(prev);
        requestedGoalIds.forEach((goalId) => next.add(goalId));
        return next;
      });
    }

    if (requestedMilestones.length > 0 && requestedGoalIds.length === 1) {
      const parentGoal = goals.find((goal) => goal.id === requestedGoalIds[0]) || null;
      if (parentGoal) {
        setDraftLeafGoals((prev) => {
          if (prev.length > 0) return prev;
          const existingTitles = goals
            .filter((goal) => String(goal.parentGoalId || '') === parentGoal.id)
            .map((goal) => String(goal.title || '').trim().toLowerCase());
          const draftTitles = requestedMilestones.filter((title) => !existingTitles.includes(title.toLowerCase()));
          return draftTitles.map((title, index) => ({
            tempId: `${DRAFT_LEAF_PREFIX}${parentGoal.id}:${Date.now() + index}`,
            parentGoalId: parentGoal.id,
            title,
            theme: parentGoal.theme,
            persona: parentGoal.persona,
            goalKind: 'milestone',
            timeHorizon: timeframe === 'year' ? 'quarter' : 'sprint',
          }));
        });
      }
    }

    setPrefillStructureApplied(true);
  }, [goals, initialPrefill, prefillStructureApplied, show, timeframe]);

  const loadPrompts = async () => {
    setLoadingPrompts(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'getIntentBrokerPrompts');
      const res: any = await fn({});
      const nextPrompts = Array.isArray(res?.data?.prompts) ? res.data.prompts : [];
      setPrompts(nextPrompts);
      setSelectedPromptId(nextPrompts[0]?.id || '');
    } catch (e: any) {
      setError(e?.message || 'Failed to load Intent Broker prompts');
    } finally {
      setLoadingPrompts(false);
    }
  };

  useEffect(() => {
    if (!show) return;
    loadPrompts();
  }, [show]);

  // Calculate timeframe dates
  const timeframeInfo = useMemo(() => {
    const now = new Date();
    const daysInMs = {
      sprint: 14 * 24 * 60 * 60 * 1000,
      quarter: 91 * 24 * 60 * 60 * 1000,
      year: 365 * 24 * 60 * 60 * 1000
    };
    const customEndMs = customEndDateInput ? Date.parse(`${customEndDateInput}T12:00:00`) : Number.NaN;
    const endDate = Number.isFinite(customEndMs) && customEndMs > now.getTime()
      ? new Date(customEndMs)
      : new Date(now.getTime() + daysInMs[timeframe]);
    const daysRemaining = Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

    return {
      label:
        Number.isFinite(customEndMs) && customEndMs > now.getTime()
          ? `Custom window (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`
          : timeframe === 'sprint'
            ? `2 weeks (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`
            : timeframe === 'quarter'
              ? `13 weeks (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`
              : `1 year (${now.toLocaleDateString()} - ${endDate.toLocaleDateString()})`,
      startDate: now,
      endDate,
      daysRemaining
    };
  }, [customEndDateInput, timeframe]);

  const sprintPlanSegments = useMemo<SprintPlanSegment[]>(() => {
    const segments: SprintPlanSegment[] = [];
    const startMs = timeframeInfo.startDate.getTime();
    const endMs = timeframeInfo.endDate.getTime();
    const segmentLengthMs = timeframe === 'sprint'
      ? Math.max(1, endMs - startMs + 1)
      : 14 * 24 * 60 * 60 * 1000;
    let cursor = startMs;
    let index = 0;
    while (cursor <= endMs) {
      const segmentStart = new Date(cursor);
      const rawEnd = timeframe === 'sprint' ? endMs : Math.min(endMs, cursor + segmentLengthMs - 1);
      const segmentEnd = new Date(rawEnd);
      segments.push({
        index,
        label: timeframe === 'sprint'
          ? `Current sprint window`
          : `Sprint ${index + 1} (${segmentStart.toLocaleDateString()} - ${segmentEnd.toLocaleDateString()})`,
        startDate: segmentStart,
        endDate: segmentEnd,
      });
      cursor = rawEnd + 1;
      index += 1;
      if (timeframe === 'sprint') break;
    }
    return segments;
  }, [timeframe, timeframeInfo.endDate, timeframeInfo.startDate]);

  // Get selected goals
  const selectedGoals = useMemo(
    () => goals.filter(g => selectedGoalIds.has(g.id)),
    [goals, selectedGoalIds]
  );

  const selectedLeafGoalIds = useMemo(
    () => expandFocusGoalIdsToLeafGoalIds(Array.from(selectedGoalIds), planningGoals),
    [planningGoals, selectedGoalIds],
  );

  const selectedLeafGoals = useMemo(
    () => planningGoals.filter((goal) => selectedLeafGoalIds.includes(goal.id)),
    [planningGoals, selectedLeafGoalIds],
  );

  useEffect(() => {
    const nextData: Record<string, SelectedGoalSummary> = {};
    for (const goal of goals) {
      if (!selectedGoalIds.has(goal.id)) continue;
      nextData[goal.id] = {
        title: goal.title,
        theme: goal.theme,
        requiresStory: goal.goalRequiresStory !== false,
        estimatedCost: goal.estimatedCost,
      };
    }
    setSelectedGoalsData(nextData);
  }, [goals, selectedGoalIds]);

  useEffect(() => {
    setGoalTypeMap((prev) => {
      const next: Record<string, GoalPlanningType> = {};
      let changed = false;
      for (const goal of selectedLeafGoals) {
        const existing = prev[goal.id];
        next[goal.id] = existing || (goal.goalRequiresStory === false ? 'calendar' : 'story');
        if (next[goal.id] !== existing) changed = true;
      }
      if (Object.keys(prev).length !== Object.keys(next).length) changed = true;
      return changed ? next : prev;
    });
  }, [selectedLeafGoals]);

  useEffect(() => {
    if (selectedLeafGoals.length === 0 || sprintPlanSegments.length === 0) {
      setSprintPlanByGoalId({});
      return;
    }
    setSprintPlanByGoalId((prev) => {
      const next: Record<string, number[]> = {};
      const segmentIndexes = sprintPlanSegments.map((segment) => segment.index);
      const leafCount = selectedLeafGoals.length;
      selectedLeafGoals.forEach((goal, goalIndex) => {
        const existing = Array.isArray(prev[goal.id]) ? prev[goal.id].filter((idx) => segmentIndexes.includes(idx)) : [];
        if (existing.length > 0) {
          next[goal.id] = existing;
          return;
        }
        if (sprintPlanSegments.length === 1) {
          next[goal.id] = [sprintPlanSegments[0].index];
          return;
        }
        const chunkStart = Math.floor((goalIndex * sprintPlanSegments.length) / leafCount);
        const chunkEndExclusive = Math.floor(((goalIndex + 1) * sprintPlanSegments.length) / leafCount);
        const assigned = segmentIndexes.slice(chunkStart, Math.max(chunkStart + 1, chunkEndExclusive));
        next[goal.id] = assigned.length > 0 ? assigned : [segmentIndexes[Math.min(goalIndex, segmentIndexes.length - 1)]];
      });
      return next;
    });
  }, [selectedLeafGoals, sprintPlanSegments]);

  // Count goals needing stories
  const goalsNeedingStories = useMemo(
    () => selectedLeafGoals.filter(g => goalTypeMap[g.id] === 'story' && ((g as any).storyCount === undefined || (g as any).storyCount === 0)),
    [selectedLeafGoals, goalTypeMap]
  );

  const calendarTimeGoals = useMemo(
    () => selectedLeafGoals.filter((goal) => goalTypeMap[goal.id] === 'calendar'),
    [selectedLeafGoals, goalTypeMap]
  );

  // Count goals with costs needing savings buckets
  const goalsWithCosts = useMemo(
    () =>
      selectedGoals.filter(
        g =>
          g.estimatedCost && g.estimatedCost > 0 && (g.costType === 'one_off' || g.costType === 'recurring')
      ),
    [selectedGoals]
  );

  const monzoGoalRefs = useMemo(() => {
    return goalsWithCosts.reduce<Record<string, string>>((acc, goal) => {
      const persistedRef = String(goal.monzoPotGoalRef || '').trim();
      acc[goal.id] = persistedRef || `GOAL-${goal.id}`;
      return acc;
    }, {});
  }, [goalsWithCosts]);

  const gapAnalysis = useMemo(() => {
    const missingKpis = selectedLeafGoals.filter((g) => {
      const legacy = Array.isArray((g as any).kpis) ? (g as any).kpis : [];
      const modern = Array.isArray((g as any).kpisV2) ? (g as any).kpisV2 : [];
      return legacy.length === 0 && modern.length === 0;
    });
    const missingStories = goalsNeedingStories;
    const missingBuckets = goalsWithCosts.filter((g) => !g.linkedPotId && !g.potId);
    return {
      missingKpis,
      missingStories,
      missingBuckets,
    };
  }, [selectedLeafGoals, goalsNeedingStories, goalsWithCosts]);

  const handleSelectGoal = (goalId: string) => {
    const newSet = new Set(selectedGoalIds);
    if (newSet.has(goalId)) {
      newSet.delete(goalId);
    } else {
      newSet.add(goalId);
    }
    setSelectedGoalIds(newSet);
    setGoalTypeMap((prev) => {
      if (!newSet.has(goalId)) {
        const { [goalId]: _removed, ...rest } = prev;
        return rest;
      }
      const goal = goals.find((item) => item.id === goalId);
      if (goal && isLeafGoal(goal.id, planningGoals)) {
        return {
          ...prev,
          [goalId]: prev[goalId] || (goal.goalRequiresStory === false ? 'calendar' : 'story'),
        };
      }
      const next = { ...prev };
      expandFocusGoalIdsToLeafGoalIds([goalId], planningGoals).forEach((leafId) => {
        const leafGoal = planningGoals.find((item) => item.id === leafId);
        next[leafId] = next[leafId] || (leafGoal?.goalRequiresStory === false ? 'calendar' : 'story');
      });
      return next;
    });
  };

  const handleGoalTypeChange = (goalId: string, nextType: GoalPlanningType) => {
    setGoalTypeMap((prev) => ({
      ...prev,
      [goalId]: nextType,
    }));
  };

  const handleAddDraftLeafGoal = (parentGoal: Goal) => {
    const title = String(draftLeafTitleByParentId[parentGoal.id] || '').trim();
    if (!title) {
      setError('Enter a child milestone title before adding it.');
      return;
    }
    const tempId = `${DRAFT_LEAF_PREFIX}${parentGoal.id}:${Date.now()}`;
    const nextDraft: DraftLeafGoal = {
      tempId,
      parentGoalId: parentGoal.id,
      title,
      theme: parentGoal.theme,
      persona: parentGoal.persona,
      goalKind: 'milestone',
      timeHorizon: timeframe === 'year' ? 'quarter' : 'sprint',
    };
    setDraftLeafGoals((prev) => [...prev, nextDraft]);
    setDraftLeafTitleByParentId((prev) => ({ ...prev, [parentGoal.id]: '' }));
    setGoalTypeMap((prev) => ({ ...prev, [tempId]: prev[tempId] || 'story' }));
    setError('');
  };

  const handleRemoveDraftLeafGoal = (tempId: string) => {
    setDraftLeafGoals((prev) => prev.filter((draft) => draft.tempId !== tempId));
    setGoalTypeMap((prev) => {
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
    setSprintPlanByGoalId((prev) => {
      const next = { ...prev };
      delete next[tempId];
      return next;
    });
  };

  const toggleSprintPlanAssignment = (goalId: string, segmentIndex: number) => {
    setSprintPlanByGoalId((prev) => {
      const existing = Array.isArray(prev[goalId]) ? prev[goalId] : [];
      const nextIds = existing.includes(segmentIndex)
        ? existing.filter((index) => index !== segmentIndex)
        : [...existing, segmentIndex].sort((a, b) => a - b);
      return {
        ...prev,
        [goalId]: nextIds,
      };
    });
  };

  const handleNext = async () => {
    setError('');

    if (step === 'vision') {
      if (!focusTitle.trim()) {
        setError('Please provide a short program name before continuing.');
        return;
      }
      if (!visionText.trim()) {
        setError('Please provide a short vision before continuing.');
        return;
      }
      setStep('select');
    } else if (step === 'select') {
      if (selectedGoalIds.size === 0) {
        setError('Please select at least 1 goal');
        return;
      }
      setStep('goalTypes');
    } else if (step === 'goalTypes') {
      if (selectedLeafGoals.some((goal) => !goalTypeMap[goal.id])) {
        setError('Please choose a planning mode for each selected goal.');
        return;
      }
      setStep('timeframe');
    } else if (step === 'timeframe') {
      setStep('milestones');
    } else if (step === 'milestones') {
      if (selectedLeafGoals.length === 0) {
        setError('Create or confirm at least one leaf goal for execution.');
        return;
      }
      if (selectedLeafGoals.some((goal) => !Array.isArray(sprintPlanByGoalId[goal.id]) || sprintPlanByGoalId[goal.id].length === 0)) {
        setError('Assign each leaf goal to at least one sprint window before continuing.');
        return;
      }
      setStep('review');
    } else if (step === 'review') {
      setStep('confirm');
    }
  };

  const runIntentMatching = async () => {
    if (!visionText.trim()) {
      setError('Add your vision text first.');
      return;
    }

    setMatching(true);
    setError('');
    try {
      const fn = httpsCallable(functions, 'intentBrokerSuggestFocus');
      const res: any = await fn({
        visionText: visionText.trim(),
        selectedPromptId,
        promptIds: prompts.map((p) => p.id),
      });
      const nextResult = (res?.data || null) as IntentResult;
      setIntentResult(nextResult);

      const matchedGoalIds = (nextResult?.matches || [])
        .map((match) => String(match.goalId || '').trim())
        .filter(Boolean);
      if (matchedGoalIds.length > 0) {
        setSelectedGoalIds((prev) => {
          const next = new Set(prev);
          matchedGoalIds.forEach((goalId) => next.add(goalId));
          return next;
        });
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to run intent matching');
    } finally {
      setMatching(false);
    }
  };

  const copyGoalRef = async (goalRef: string) => {
    if (!goalRef) return;
    try {
      await navigator.clipboard.writeText(goalRef);
      setCopiedGoalRef(goalRef);
      window.setTimeout(() => setCopiedGoalRef(null), 1800);
    } catch {
      setError('Failed to copy goal ref.');
    }
  };

  useEffect(() => {
    if (!show) return;
    if (!initialPrefill?.autoRunMatch) return;
    if (prefillMatchTriggered) return;
    if (!visionText.trim()) return;
    if (!selectedPromptId) return;
    if (loadingPrompts || matching) return;
    setPrefillMatchTriggered(true);
    runIntentMatching();
  }, [
    show,
    initialPrefill?.autoRunMatch,
    prefillMatchTriggered,
    visionText,
    selectedPromptId,
    loadingPrompts,
    matching,
  ]);

  const handleBack = () => {
    if (step === 'select') setStep('vision');
    else if (step === 'goalTypes') setStep('select');
    else if (step === 'timeframe') setStep('goalTypes');
    else if (step === 'milestones') setStep('timeframe');
    else if (step === 'review') setStep('milestones');
    else if (step === 'confirm') setStep('review');
  };

  const handleSave = async () => {
    setLoading(true);
    setError('');
    try {
      const selectedLeafGoalIdSet = new Set(selectedLeafGoalIds);
      const filteredSprintPlanByGoalId = Object.entries(sprintPlanByGoalId).reduce<Record<string, number[]>>((acc, [goalId, segmentIndexes]) => {
        if (!selectedLeafGoalIdSet.has(goalId)) return acc;
        acc[goalId] = Array.isArray(segmentIndexes) ? segmentIndexes : [];
        return acc;
      }, {});
      const filteredDraftLeafGoals = draftLeafGoals.filter((draft) => {
        return selectedGoalIds.has(draft.parentGoalId) && selectedLeafGoalIdSet.has(draft.tempId);
      });
      const focusGoal: FocusGoal = {
        id: `focus-${Date.now()}`,
        ownerUid: currentUserId || '',
        persona: 'personal',
        title: focusTitle.trim() || undefined,
        goalIds: selectedLeafGoalIds,
        focusRootGoalIds: Array.from(selectedGoalIds),
        focusLeafGoalIds: selectedLeafGoalIds,
        goalTypeMap,
        timeframe: timeframe,
        startDate: timeframeInfo.startDate,
        endDate: timeframeInfo.endDate,
        daysRemaining: timeframeInfo.daysRemaining,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        storiesCreatedFor: [],
        potIdsCreatedFor: {},
        visionText: visionText.trim() || undefined,
        intentBrokerIntakeId: intentResult?.intakeId || undefined,
        intentMatches: intentResult?.matches || [],
        intentProposals: intentResult?.proposals || [],
        storyTableHandoff: useModernStoryTableHandoff,
        monzoPotGoalRefs: monzoGoalRefs,
        sprintPlanByGoalId: filteredSprintPlanByGoalId,
        sprintPlanSegments: sprintPlanSegments.map((segment) => ({
          index: segment.index,
          label: segment.label,
          startDate: segment.startDate.getTime(),
          endDate: segment.endDate.getTime(),
        })),
        pendingLeafGoalsToCreate: filteredDraftLeafGoals.map((draft) => ({
          tempId: draft.tempId,
          parentGoalId: draft.parentGoalId,
          title: draft.title,
          theme: draft.theme,
          persona: draft.persona,
          goalKind: draft.goalKind,
          timeHorizon: draft.timeHorizon,
        })),
      };

      await onSave(focusGoal);
      if (useModernStoryTableHandoff && typeof window !== 'undefined') {
        window.localStorage.setItem('focusWizardStoryTableHandoff', '1');
      }
      onHide();
    } catch (e) {
      setError(`Failed to save focus goals: ${(e as any)?.message || 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  const progressPercent = {
    vision: 14,
    select: 28,
    goalTypes: 42,
    timeframe: 56,
    milestones: 72,
    review: 86,
    confirm: 100
  };

  return (
    <Modal show={show} onHide={onHide} size="lg" backdrop="static">
      <Modal.Header closeButton>
        <Modal.Title>
          <Zap size={20} className="me-2" style={{ display: 'inline', color: '#ffc107' }} />
          Focus Goals Wizard
        </Modal.Title>
      </Modal.Header>

      <Modal.Body style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {/* Progress bar */}
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
            <span style={{ fontWeight: '600' }}>
              {step === 'vision'
                ? 'Step 1: Define Vision + Match'
                : step === 'select'
                  ? 'Step 2: Select Goals'
                  : step === 'goalTypes'
                    ? 'Step 3: Goal Planning Types'
                    : step === 'timeframe'
                      ? 'Step 4: Choose Timeframe'
                      : step === 'milestones'
                        ? 'Step 5: Milestones + Sprint Plan'
                        : step === 'review'
                          ? 'Step 6: Review Checklist'
                          : 'Step 7: Confirm'}
            </span>
            <span style={{ color: '#666' }}>{progressPercent[step]}%</span>
          </div>
          <ProgressBar now={progressPercent[step]} />
        </div>

        {error && <Alert variant="danger">{error}</Alert>}

        {/* Step 1: Vision + Intent Broker */}
        {step === 'vision' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              Capture the outcome you want first, then optionally run AI matching against your current goal snapshot.
            </p>

            <Form.Group className="mb-3">
              <Form.Label>Program name</Form.Label>
              <Form.Control
                type="text"
                value={focusTitle}
                onChange={(e) => setFocusTitle(e.target.value)}
                placeholder="Project 45 v2"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Vision (free text)</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                placeholder="Describe the result you want and why it matters now..."
                value={visionText}
                onChange={(e) => setVisionText(e.target.value)}
              />
            </Form.Group>

            <div className="d-flex justify-content-between align-items-center mb-2">
              <strong>Intent prompt</strong>
              <Button size="sm" variant="outline-secondary" onClick={loadPrompts} disabled={loadingPrompts}>
                {loadingPrompts ? 'Refreshing...' : 'Refresh prompts'}
              </Button>
            </div>

            {loadingPrompts ? (
              <div className="py-2"><Spinner animation="border" size="sm" /> Loading prompts...</div>
            ) : (
              <Form.Select
                className="mb-3"
                value={selectedPromptId}
                onChange={(e) => setSelectedPromptId(e.target.value)}
              >
                {prompts.map((p) => (
                  <option key={p.id} value={p.id}>{p.text}</option>
                ))}
              </Form.Select>
            )}

            <div className="d-flex justify-content-end mb-3">
              <Button variant="primary" onClick={runIntentMatching} disabled={!visionText.trim() || matching}>
                {matching ? 'Analyzing...' : 'Run AI Match'}
              </Button>
            </div>

            {intentResult?.snapshotMeta && (
              <Alert variant={intentResult.snapshotMeta.stale ? 'warning' : 'success'}>
                Snapshot {intentResult.snapshotMeta.stale ? 'stale' : 'fresh'} • v{intentResult.snapshotMeta.snapshotVersion || 'n/a'} • goals scanned: {intentResult.snapshotMeta.goalsScanned || 0}
              </Alert>
            )}

            {(intentResult?.matches || []).length > 0 && (
              <Alert variant="info">
                <strong>Existing goal matches</strong>
                <div style={{ fontSize: 12, marginTop: 4, marginBottom: 6 }}>
                  Matched goals are auto-selected in the next step.
                </div>
                <ul style={{ marginBottom: 0, marginTop: 8 }}>
                  {(intentResult?.matches || []).slice(0, 5).map((m) => (
                    <li key={m.goalId}>{m.title} (score {m.score})</li>
                  ))}
                </ul>
              </Alert>
            )}

            {(intentResult?.proposals || []).length > 0 && (
              <Alert variant="warning">
                <strong>New-goal proposals</strong>
                <ul style={{ marginBottom: 0, marginTop: 8 }}>
                  {(intentResult?.proposals || []).slice(0, 3).map((p, idx) => (
                    <li key={`${p.title}-${idx}`}>{p.title} ({Math.round((p.confidence || 0) * 100)}% confidence)</li>
                  ))}
                </ul>
              </Alert>
            )}
          </div>
        )}

        {/* Step 2: Select Goals */}
        {step === 'select' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              Select which goals you want to focus on. You can choose 1 or more goals to track together.
            </p>

            {goals.length === 0 ? (
              <Alert variant="info">
                <AlertCircle size={16} className="me-2" style={{ display: 'inline' }} />
                No goals found. Create some goals first!
              </Alert>
            ) : (
              <>
              <Form.Group className="mb-2">
                <Form.Control
                  type="text"
                  value={goalSearchTerm}
                  onChange={(e) => setGoalSearchTerm(e.target.value)}
                  placeholder="Search goals by title..."
                />
              </Form.Group>
              <ListGroup>
                {goals
                  .filter(g => g.status !== 2) // Hide completed goals
                  .filter(g => {
                    if (!goalSearchTerm.trim()) return true;
                    return String(g.title || '').toLowerCase().includes(goalSearchTerm.toLowerCase());
                  })
                  .map(goal => (
                    <ListGroup.Item
                      key={goal.id}
                      style={{
                        cursor: 'pointer',
                        background: selectedGoalIds.has(goal.id) ? '#e7f5ff' : undefined,
                        borderColor: selectedGoalIds.has(goal.id) ? '#0066cc' : undefined
                      }}
                      onClick={() => handleSelectGoal(goal.id)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Form.Check
                          type="checkbox"
                          checked={selectedGoalIds.has(goal.id)}
                          readOnly
                          style={{ margin: 0 }}
                        />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '500' }}>{goal.title}</div>
                          <div style={{ fontSize: '12px', color: '#666' }}>
                            Theme: {goal.theme || 'Not set'} • Status: {goal.status || 'New'}
                          </div>
                        </div>
                        {selectedGoalIds.has(goal.id) && (
                          <CheckCircle size={20} style={{ color: '#0066cc' }} />
                        )}
                      </div>
                    </ListGroup.Item>
                  ))}
              </ListGroup>
              </>
            )}

            <div style={{ marginTop: '16px', padding: '12px', background: '#f8f9fa', borderRadius: '8px' }}>
              <strong>{selectedGoalIds.size}</strong> root goal{selectedGoalIds.size !== 1 ? 's' : ''} selected
              {' • '}
              <strong>{selectedLeafGoals.length}</strong> leaf goal{selectedLeafGoals.length !== 1 ? 's' : ''} in execution scope
            </div>

            {selectedLeafGoals.length > 0 && (
              <Alert variant="secondary" className="mt-3 mb-0">
                <div className="fw-semibold">Execution scope</div>
                <div className="small text-muted mb-2">
                  Focus alignment, KPI execution, and story planning will run against these leaf goals.
                </div>
                <ul className="mb-0 small">
                  {selectedLeafGoals.slice(0, 6).map((goal) => (
                    <li key={goal.id}>{getGoalDisplayPath(goal.id, planningGoals)}</li>
                  ))}
                  {selectedLeafGoals.length > 6 && <li>+{selectedLeafGoals.length - 6} more</li>}
                </ul>
              </Alert>
            )}
          </div>
        )}

        {/* Step 3: Goal planning types */}
        {step === 'goalTypes' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              Decide which selected goals should create Sprint stories and which should stay calendar-time only.
            </p>

            <ListGroup>
              {selectedLeafGoals.map((goal) => (
                <ListGroup.Item key={goal.id} style={{ padding: '16px' }}>
                  <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ fontWeight: 600 }}>{getGoalDisplayPath(goal.id, planningGoals)}</div>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                        Theme: {selectedGoalsData[goal.id]?.theme || goal.theme || 'Not set'}
                        {selectedGoalsData[goal.id]?.estimatedCost ? ` • Cost: £${Number(selectedGoalsData[goal.id].estimatedCost).toLocaleString()}` : ''}
                      </div>
                    </div>
                    <div style={{ minWidth: 280 }}>
                      <Form.Check
                        type="radio"
                        id={`goal-type-story-${goal.id}`}
                        name={`goal-type-${goal.id}`}
                        label="Story-based (will create Sprint story)"
                        checked={goalTypeMap[goal.id] === 'story'}
                        onChange={() => handleGoalTypeChange(goal.id, 'story')}
                        className="mb-2"
                      />
                      <Form.Check
                        type="radio"
                        id={`goal-type-calendar-${goal.id}`}
                        name={`goal-type-${goal.id}`}
                        label="Calendar-time (events and KPIs only)"
                        checked={goalTypeMap[goal.id] === 'calendar'}
                        onChange={() => handleGoalTypeChange(goal.id, 'calendar')}
                      />
                    </div>
                  </div>
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}

        {/* Step 4: Choose Timeframe */}
        {step === 'timeframe' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              How long do you want to focus on these goals?
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
              {(['sprint', 'quarter', 'year'] as const).map(tf => (
                <Card
                  key={tf}
                  style={{
                    cursor: 'pointer',
                    border: timeframe === tf ? '2px solid #0066cc' : '1px solid #ddd',
                    background: timeframe === tf ? '#e7f5ff' : undefined
                  }}
                  onClick={() => setTimeframe(tf)}
                >
                  <Card.Body style={{ padding: '12px', textAlign: 'center' }}>
                    <Calendar size={24} style={{ marginBottom: '8px', color: timeframe === tf ? '#0066cc' : '#666' }} />
                    <div style={{ fontWeight: '600', textTransform: 'capitalize' }}>{tf}</div>
                    <div style={{ fontSize: '12px', color: '#666' }}>
                      {tf === 'sprint' ? '2 weeks' : tf === 'quarter' ? '13 weeks' : '52 weeks'}
                    </div>
                  </Card.Body>
                </Card>
              ))}
            </div>

            <Alert variant="info" style={{ marginTop: '16px' }}>
              <div style={{ fontWeight: '600', marginBottom: '6px' }}>📅 {timeframeInfo.label}</div>
              <div style={{ fontSize: '12px' }}>
                That's <strong>{timeframeInfo.daysRemaining} days</strong> to achieve your focus goals
              </div>
            </Alert>

            <Form.Group className="mt-3">
              <Form.Label>Exact target end date (optional override)</Form.Label>
              <Form.Control
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={customEndDateInput}
                onChange={(e) => setCustomEndDateInput(e.target.value)}
              />
              <Form.Text className="text-muted">
                Leave blank to use the standard {timeframe} window. Set a date here for milestone programs like birthdays or race targets.
              </Form.Text>
            </Form.Group>
          </div>
        )}

        {step === 'milestones' && (
          <div>
            <p style={{ color: '#666', marginBottom: '16px' }}>
              Confirm the leaf milestones that will execute this focus period, then map each one to sprint windows.
            </p>

            <Alert variant="secondary" className="mb-3">
              <div className="fw-semibold">Execution rule</div>
              <div className="small text-muted">
                Parent goals stay strategic. Leaf goals are the milestones that get stories, KPIs, daily-plan alignment, and sprint focus.
              </div>
            </Alert>

            <div className="mb-4">
              {selectedGoals.map((rootGoal) => {
                const rootPath = getGoalDisplayPath(rootGoal.id, planningGoals);
                const rootLeafGoals = selectedLeafGoals.filter((goal) => {
                  const path = getGoalDisplayPath(goal.id, planningGoals);
                  return goal.id === rootGoal.id || path === rootPath || path.startsWith(`${rootPath} >`);
                });
                return (
                  <Card key={rootGoal.id} className="mb-3">
                    <Card.Body>
                      <div className="d-flex justify-content-between align-items-start gap-3 flex-wrap">
                        <div>
                          <div className="fw-semibold">{rootPath}</div>
                          <div className="small text-muted">
                            {rootLeafGoals.length} leaf goal{rootLeafGoals.length !== 1 ? 's' : ''} in execution scope
                          </div>
                        </div>
                        <Badge bg="light" text="dark">
                          {isLeafGoal(rootGoal.id, planningGoals) ? 'Leaf goal' : 'Parent goal'}
                        </Badge>
                      </div>

                      {rootLeafGoals.length > 0 && (
                        <ul className="small mt-3 mb-3">
                          {rootLeafGoals.map((goal) => (
                            <li key={goal.id}>{getGoalDisplayPath(goal.id, planningGoals)}</li>
                          ))}
                        </ul>
                      )}

                      <Row className="g-2 align-items-end">
                        <Col md={9}>
                          <Form.Label className="small">Add child milestone leaf goal</Form.Label>
                          <Form.Control
                            value={draftLeafTitleByParentId[rootGoal.id] || ''}
                            onChange={(e) => setDraftLeafTitleByParentId((prev) => ({ ...prev, [rootGoal.id]: e.target.value }))}
                            placeholder="e.g. Sprint triathlon, 70.3 block, Base phase"
                          />
                        </Col>
                        <Col md={3}>
                          <Button variant="outline-primary" className="w-100" onClick={() => handleAddDraftLeafGoal(rootGoal)}>
                            Add milestone
                          </Button>
                        </Col>
                      </Row>
                    </Card.Body>
                  </Card>
                );
              })}
            </div>

            {draftLeafGoals.length > 0 && (
              <Alert variant="info" className="mb-3">
                {draftLeafGoals.length} new leaf milestone{draftLeafGoals.length !== 1 ? 's' : ''} will be created when you save this focus set.
              </Alert>
            )}

            <h6 style={{ fontWeight: 600 }}>Sprint rollout</h6>
            <div className="small text-muted mb-3">
              Assign each leaf goal to one or more sprint windows in this focus period.
            </div>

            <div className="mb-3 d-flex flex-wrap gap-2">
              {sprintPlanSegments.map((segment) => (
                <Badge key={segment.index} bg="light" text="dark">
                  {segment.label}
                </Badge>
              ))}
            </div>

            <ListGroup>
              {selectedLeafGoals.map((goal) => (
                <ListGroup.Item key={goal.id}>
                  <div className="fw-semibold mb-2">{getGoalDisplayPath(goal.id, planningGoals)}</div>
                  <div className="d-flex flex-wrap gap-2">
                    {sprintPlanSegments.map((segment) => {
                      const assigned = Array.isArray(sprintPlanByGoalId[goal.id]) && sprintPlanByGoalId[goal.id].includes(segment.index);
                      return (
                        <Button
                          key={`${goal.id}-${segment.index}`}
                          size="sm"
                          variant={assigned ? 'primary' : 'outline-secondary'}
                          onClick={() => toggleSprintPlanAssignment(goal.id, segment.index)}
                        >
                          {segment.label}
                        </Button>
                      );
                    })}
                  </div>
                  {String(goal.id).startsWith(DRAFT_LEAF_PREFIX) && (
                    <div className="mt-2">
                      <Button size="sm" variant="outline-danger" onClick={() => handleRemoveDraftLeafGoal(goal.id)}>
                        Remove draft milestone
                      </Button>
                    </div>
                  )}
                </ListGroup.Item>
              ))}
            </ListGroup>
          </div>
        )}

        {/* Step 6: Review Changes */}
        {step === 'review' && (
          <div>
            <div style={{ marginBottom: '20px' }}>
              <h6 style={{ fontWeight: '600', marginBottom: '12px' }}>
                <Zap size={16} className="me-2" style={{ display: 'inline' }} />
                Strict Stage Checklist
              </h6>
              <ListGroup>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Goals selected: <strong>{selectedGoalIds.size}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Story-based leaf goals: <strong>{selectedLeafGoals.filter((goal) => goalTypeMap[goal.id] === 'story').length}</strong>
                  {' • '}
                  Calendar-time leaf goals: <strong>{calendarTimeGoals.length}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Timeframe locked: <strong>{timeframeInfo.label}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Sprint windows planned: <strong>{sprintPlanSegments.length}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Vision captured: <strong>{visionText.trim() ? 'Yes' : 'No'}</strong>
                </ListGroup.Item>
                <ListGroup.Item style={{ padding: '8px 12px' }}>
                  <CheckCircle size={14} className="me-2" style={{ display: 'inline', color: '#28a745' }} />
                  Intent matching run: <strong>{intentResult?.intakeId ? 'Yes' : 'Pending'}</strong>
                </ListGroup.Item>
              </ListGroup>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h6 style={{ fontWeight: 600 }}>Story planning matrix handoff</h6>
              <Form.Check
                type="switch"
                id="wizard-modern-story-toggle"
                label="Enable modern story table handoff after save"
                checked={useModernStoryTableHandoff}
                onChange={(e) => setUseModernStoryTableHandoff(e.target.checked)}
              />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h6 style={{ fontWeight: 600 }}>AI gap analysis</h6>
              <ul style={{ marginBottom: 0, fontSize: '13px' }}>
                <li>{gapAnalysis.missingStories.length} selected goals currently have no stories</li>
                <li>{gapAnalysis.missingKpis.length} selected goals currently have no KPI definitions</li>
                <li>{gapAnalysis.missingBuckets.length} cost-based goals currently have no linked savings bucket</li>
                <li>{draftLeafGoals.length} new leaf milestone{draftLeafGoals.length !== 1 ? 's' : ''} queued for creation</li>
              </ul>
            </div>

            <div style={{ marginBottom: '20px' }}>
              <h6 style={{ fontWeight: 600 }}>Sprint rollout</h6>
              <ul style={{ marginBottom: 0, fontSize: '13px' }}>
                {selectedLeafGoals.map((goal) => (
                  <li key={goal.id}>
                    {getGoalDisplayPath(goal.id, planningGoals)}: {(sprintPlanByGoalId[goal.id] || [])
                      .map((segmentIndex) => sprintPlanSegments.find((segment) => segment.index === segmentIndex)?.label)
                      .filter(Boolean)
                      .join(', ') || 'No sprint window assigned'}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <h6 style={{ fontWeight: 600 }}>KPI setup</h6>
              <p style={{ marginBottom: 8, color: '#666', fontSize: 13 }}>
                Add KPI definitions for selected goals before confirming your focus set. KPIs can now be pinned to the dashboard as cards or charts.
              </p>
              {draftLeafGoals.length > 0 && (
                <Alert variant="secondary" className="py-2">
                  Draft milestone goals must be saved first. KPI design here applies to already-persisted leaf goals only.
                </Alert>
              )}
              <Button variant="outline-primary" size="sm" onClick={() => setShowKpiDesigner(true)}>
                Add KPIs to track progress
              </Button>
            </div>

            {/* Stories to Create */}
            {goalsNeedingStories.length > 0 && (
              <Alert variant="warning" style={{ marginBottom: '12px' }}>
                <BookOpen size={16} className="me-2" style={{ display: 'inline' }} />
                <strong>{goalsNeedingStories.length} story-based goals have no stories yet.</strong>
                <br />
                These stories will be created only after you confirm and save.
                <ul style={{ marginTop: '8px', marginBottom: 0, fontSize: '12px' }}>
                  {goalsNeedingStories.map(g => (
                    <li key={g.id}>{getGoalDisplayPath(g.id, planningGoals)}</li>
                  ))}
                </ul>
              </Alert>
            )}

            {calendarTimeGoals.length > 0 && (
              <Alert variant="info" style={{ marginBottom: '12px' }}>
                <Calendar size={16} className="me-2" style={{ display: 'inline' }} />
                <strong>{calendarTimeGoals.length} goals are calendar-time only.</strong>
                <br />
                These goals will skip story auto-creation and rely on events and KPIs.
              </Alert>
            )}

            {/* Savings Buckets to Create */}
            {goalsWithCosts.length > 0 && (
              <Alert variant="warning">
                <DollarSign size={16} className="me-2" style={{ display: 'inline' }} />
                <strong>{goalsWithCosts.length} goals have costs.</strong>
                <br />
                Create Monzo pots manually using the refs below. BOB will persist and auto-link against these refs on sync.
                <ul style={{ marginTop: '8px', marginBottom: 0, fontSize: '12px' }}>
                  {goalsWithCosts.map(g => (
                    <li key={g.id} style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{g.title}</span>
                      {': £'}
                      {(g.estimatedCost || 0).toLocaleString()}
                      {' • ref '}
                      <code>{monzoGoalRefs[g.id]}</code>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        style={{ marginLeft: 8, padding: '1px 6px', fontSize: 11 }}
                        onClick={() => copyGoalRef(monzoGoalRefs[g.id])}
                      >
                        {copiedGoalRef === monzoGoalRefs[g.id] ? 'Copied' : 'Copy'}
                      </Button>
                    </li>
                  ))}
                </ul>
                <div style={{ marginTop: 8 }}>
                  <a href="https://monzo.com/" target="_blank" rel="noreferrer">Open Monzo</a>
                </div>
              </Alert>
            )}

            {goalsNeedingStories.length === 0 && calendarTimeGoals.length === 0 && goalsWithCosts.length === 0 && (
              <Alert variant="info">
                <CheckCircle size={16} className="me-2" style={{ display: 'inline' }} />
                All selected goals already have the required story and savings setup.
              </Alert>
            )}
          </div>
        )}

        {/* Step 7: Confirm */}
        {step === 'confirm' && (
          <div>
            <Alert variant="success">
              <h6>🎯 Ready to Focus!</h6>
              <p style={{ marginBottom: '12px' }}>
                You're all set. Your focus goals will be:
              </p>
              <ul style={{ marginBottom: '12px' }}>
                {selectedLeafGoals.map(g => (
                  <li key={g.id}>{getGoalDisplayPath(g.id, planningGoals)}</li>
                ))}
              </ul>
              <p style={{ marginBottom: 0 }}>
                <strong>Timeframe:</strong> {timeframeInfo.label}
                <br />
                <strong>Program:</strong> {focusTitle.trim() || 'Untitled focus program'}
                <br />
                <strong>Vision:</strong> {visionText.trim() || 'Not provided'}
                <br />
                <strong>Intent Intake:</strong> {intentResult?.intakeId || 'Not run'}
                <br />
                <strong>Story-based leaf goals:</strong> {selectedLeafGoals.filter((goal) => goalTypeMap[goal.id] === 'story').length}
                {' • '}
                <strong>Calendar-time leaf goals:</strong> {calendarTimeGoals.length}
                <br />
                <strong>New leaf milestones:</strong> {draftLeafGoals.length}
                <br />
                <strong>Updates:</strong> Your KPIs will sync nightly, and progress will show in your daily email.
              </p>
            </Alert>

            {(goalsNeedingStories.length > 0 || goalsWithCosts.length > 0) && (
              <Alert variant="warning">
                Saving will create {goalsNeedingStories.length} story records and store {goalsWithCosts.length} Monzo goal refs for manual pot linking.
              </Alert>
            )}
          </div>
        )}
      </Modal.Body>

      <KPIDesigner
        show={showKpiDesigner}
        onHide={() => setShowKpiDesigner(false)}
        goals={selectedLeafGoals.filter((goal) => !String(goal.id).startsWith(DRAFT_LEAF_PREFIX))}
        ownerUid={currentUserId || ''}
      />

      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={loading}>
          Cancel
        </Button>

        {step !== 'vision' && (
          <Button variant="outline-secondary" onClick={handleBack} disabled={loading}>
            ← Back
          </Button>
        )}

        {step !== 'confirm' ? (
          <Button
            variant="primary"
            onClick={handleNext}
            disabled={
              loading || (step === 'select' && selectedGoalIds.size === 0)
            }
          >
            Next <ChevronRight size={16} style={{ display: 'inline', marginLeft: '6px' }} />
          </Button>
        ) : (
          <Button
            variant="success"
            onClick={handleSave}
            disabled={loading}
          >
            {loading ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                Saving...
              </>
            ) : (
              <>
                ✓ Save Focus Goals
              </>
            )}
          </Button>
        )}
      </Modal.Footer>
    </Modal>
  );
};

export default FocusGoalWizard;
