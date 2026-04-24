import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import type { PlannerConstraintMode } from '../utils/plannerScheduling';
import { computeItemDeferral } from '../utils/deferralHeuristics';
import { useAuth } from '../contexts/AuthContext';
import { usePersona } from '../contexts/PersonaContext';
import { useSprint } from '../contexts/SprintContext';
import { isGoalInHierarchySet } from '../utils/goalHierarchy';
import type { Goal, Sprint } from '../types';

type ItemType = 'task' | 'story';

interface DeferralOption {
  key: string;
  dateMs: number;
  label: string;
  rationale: string;
  source?: string;
  utilizationPercent?: number;
  targetBucket?: 'morning' | 'afternoon' | 'evening' | 'anytime' | null;
  constraintMode?: PlannerConstraintMode | null;
  exactTargetStartMs?: number | null;
  exactTargetEndMs?: number | null;
}

interface DeferApplyPayload {
  dateMs: number;
  rationale: string;
  source: string;
  targetBucket?: 'morning' | 'afternoon' | 'evening' | 'anytime' | null;
  constraintMode?: PlannerConstraintMode | null;
  exactTargetStartMs?: number | null;
  exactTargetEndMs?: number | null;
}

type TaskRecurrenceShape = {
  dueDate?: number | null;
  repeatFrequency?: string | null;
  repeatInterval?: number | null;
  type?: string | null;
  task_type?: string | null;
  tags?: string[] | null;
};

interface DeferItemModalProps {
  show: boolean;
  onHide: () => void;
  itemType: ItemType;
  itemId: string;
  itemTitle: string;
  allowAdvancedSearch?: boolean;
  /** Sprint context from the caller — used for sprint-aware target generation */
  sprintContext?: {
    currentSprint: Sprint | null;
    nextSprint: Sprint | null;
  };
  focusContext?: {
    isFocusAligned?: boolean;
    activeFocusGoals?: Array<{
      id: string;
      title?: string | null;
      focusRootGoalIds?: string[];
      focusLeafGoalIds?: string[];
      goalIds?: string[];
    }>;
  };
  onApply: (payload: DeferApplyPayload) => Promise<void>;
}

type FocusContextPayload = NonNullable<DeferItemModalProps['focusContext']>;

const toInputDate = (ms: number) => {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const startOfDayMs = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const addDays = (baseMs: number, days: number) => {
  const d = new Date(baseMs);
  d.setDate(d.getDate() + days);
  return startOfDayMs(d.getTime());
};

const addMonths = (baseMs: number, months: number) => {
  const d = new Date(baseMs);
  d.setMonth(d.getMonth() + months);
  return startOfDayMs(d.getTime());
};

const getChoreKind = (task: TaskRecurrenceShape): 'chore' | 'routine' | 'habit' | null => {
  const raw = String(task?.type || task?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  if (normalized) return null;
  const tags = Array.isArray(task?.tags) ? task.tags : [];
  const tagKeys = tags.map((tag) => String(tag || '').toLowerCase().replace(/^#/, ''));
  if (tagKeys.includes('chore')) return 'chore';
  if (tagKeys.includes('routine')) return 'routine';
  if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
  return null;
};

const normalizeRecurringFrequency = (task: TaskRecurrenceShape): 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null => {
  const directRaw = String((task as any)?.repeatFrequency || (task as any)?.recurrence?.frequency || (task as any)?.recurrence?.freq || '').trim().toLowerCase();
  const direct = directRaw === 'day'
    ? 'daily'
    : directRaw === 'week'
      ? 'weekly'
      : directRaw === 'month'
        ? 'monthly'
        : directRaw === 'year'
          ? 'yearly'
          : directRaw;
  const interval = Math.max(1, Number((task as any)?.repeatInterval || (task as any)?.recurrence?.interval || 1) || 1);
  if (direct === 'quarterly') return 'quarterly';
  if (direct === 'monthly' && interval >= 3) return 'quarterly';
  if (direct === 'daily' || direct === 'weekly' || direct === 'monthly' || direct === 'yearly') return direct;

  const rrule = String((task as any)?.rrule || '').toUpperCase();
  if (rrule.includes('FREQ=DAILY')) return 'daily';
  if (rrule.includes('FREQ=WEEKLY')) return 'weekly';
  if (rrule.includes('FREQ=MONTHLY')) {
    const match = rrule.match(/INTERVAL=(\d+)/);
    const rruleInterval = Number(match?.[1] || interval) || interval;
    return rruleInterval >= 3 ? 'quarterly' : 'monthly';
  }
  if (rrule.includes('FREQ=YEARLY') || rrule.includes('FREQ=ANNUAL')) return 'yearly';
  return null;
};

const buildRecurringQuickMoveOption = (task: TaskRecurrenceShape | null | undefined): DeferralOption | null => {
  if (!task || !getChoreKind(task)) return null;
  const interval = Math.max(1, Number(task.repeatInterval || 1));
  const frequency = normalizeRecurringFrequency(task);
  if (!frequency) return null;

  const dueMs = Number(task.dueDate || 0);
  const todayMs = startOfDayMs(Date.now());
  const baseMs = Number.isFinite(dueMs) && dueMs > 0 ? Math.max(todayMs, startOfDayMs(dueMs)) : todayMs;

  if (frequency === 'daily') {
    const days = Math.max(1, interval);
    const dateMs = addDays(baseMs, days);
    return {
      key: 'recurring-quick-move',
      dateMs,
      label: `Quick move (+${days} day${days === 1 ? '' : 's'})`,
      rationale: `Daily recurrence quick defer to the next due window (+${days} day${days === 1 ? '' : 's'}).`,
      source: 'recurring_quick_move',
    };
  }

  if (frequency === 'weekly') {
    const days = 7 * Math.max(1, interval);
    const dateMs = addDays(baseMs, days);
    return {
      key: 'recurring-quick-move',
      dateMs,
      label: `Quick move (+${Math.max(1, interval)} week${Math.max(1, interval) === 1 ? '' : 's'})`,
      rationale: `Weekly recurrence quick defer to the next weekly instance (+${Math.max(1, interval)} week${Math.max(1, interval) === 1 ? '' : 's'}).`,
      source: 'recurring_quick_move',
    };
  }

  if (frequency === 'quarterly') {
    const days = 42;
    const dateMs = addDays(baseMs, days);
    return {
      key: 'recurring-quick-move',
      dateMs,
      label: 'Quick move (+6 weeks)',
      rationale: 'Quarterly recurrence quick defer applies a +6 week move.',
      source: 'recurring_quick_move',
    };
  }

  if (frequency === 'monthly') {
    const days = 21;
    const dateMs = addDays(baseMs, days);
    return {
      key: 'recurring-quick-move',
      dateMs,
      label: 'Quick move (+3 weeks)',
      rationale: 'Monthly recurrence quick defer applies a +3 week move.',
      source: 'recurring_quick_move',
    };
  }

  if (frequency === 'yearly') {
    const months = 3;
    const dateMs = addMonths(baseMs, months);
    return {
      key: 'recurring-quick-move',
      dateMs,
      label: 'Quick move (+3 months)',
      rationale: 'Yearly recurrence quick defer applies a +3 month move.',
      source: 'recurring_quick_move',
    };
  }

  return null;
};

const DeferItemModal: React.FC<DeferItemModalProps> = ({
  show,
  onHide,
  itemType,
  itemId,
  itemTitle,
  allowAdvancedSearch = false,
  sprintContext,
  focusContext,
  onApply,
}) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();
  const { sprints } = useSprint();

  // Resolve current and next sprint using the same heuristic as PlannerCapacityBanner
  const resolvedSprintContext = useMemo(() => {
    if (sprintContext) return sprintContext;
    const now = Date.now();
    const open = [...sprints]
      .filter((s) => {
        const raw = String((s as any).status ?? '').toLowerCase().trim();
        return !['closed', 'complete', 'completed', 'done', 'cancelled', 'canceled', 'archived'].includes(raw)
          && !(typeof s.status === 'number' && s.status >= 2);
      })
      .sort((a, b) => Number(a.startDate || 0) - Number(b.startDate || 0));
    const current =
      open.find((s) => {
        const raw = String((s as any).status ?? '').toLowerCase().trim();
        return ['active', 'current', 'in-progress', 'in progress'].includes(raw) || (typeof s.status === 'number' && s.status === 1);
      }) ||
      open.find((s) => {
        const start = Number(s.startDate || 0);
        const end = Number(s.endDate || 0);
        return start > 0 && end > 0 && now >= start && now <= end;
      }) ||
      open[0] ||
      null;
    const next = current
      ? open.find((s) => Number(s.startDate || 0) > Number(current.startDate || 0)) || null
      : null;
    return { currentSprint: current ?? null, nextSprint: next };
  }, [sprintContext, sprints]);

  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<DeferralOption[]>([]);
  const [topOptions, setTopOptions] = useState<DeferralOption[]>([]);
  const [moreOptions, setMoreOptions] = useState<DeferralOption[]>([]);
  const [quickMoveOption, setQuickMoveOption] = useState<DeferralOption | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [customDate, setCustomDate] = useState<string>('');
  const [showMoreSuggestions, setShowMoreSuggestions] = useState(false);
  const [inferredFocusContext, setInferredFocusContext] = useState<FocusContextPayload | null>(null);
  const effectiveFocusContext = focusContext || inferredFocusContext || undefined;
  const hasFocusPressure = !effectiveFocusContext?.isFocusAligned && (effectiveFocusContext?.activeFocusGoals?.length || 0) > 0;

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    let nextQuickMoveOption: DeferralOption | null = null;
    const normalizeGoalId = (value: unknown) => String(value || '').trim();
    const extractFocusGoalIds = (focusGoal: any): string[] => {
      const rootIds = Array.isArray(focusGoal?.focusRootGoalIds) ? focusGoal.focusRootGoalIds : [];
      const leafIds = Array.isArray(focusGoal?.focusLeafGoalIds) ? focusGoal.focusLeafGoalIds : [];
      const fallbackIds = Array.isArray(focusGoal?.goalIds) ? focusGoal.goalIds : [];
      return [...rootIds, ...leafIds, ...fallbackIds].map(normalizeGoalId).filter(Boolean);
    };

    const inferFocusContext = async (): Promise<FocusContextPayload | null> => {
      if (!currentUser?.uid || !itemId) return null;
      let itemGoalId = '';
      try {
        if (itemType === 'story') {
          const storySnap = await getDoc(doc(db, 'stories', itemId));
          if (storySnap.exists()) {
            const storyData = storySnap.data() as any;
            itemGoalId = normalizeGoalId(storyData?.goalId);
          }
        } else {
          const taskSnap = await getDoc(doc(db, 'tasks', itemId));
          if (taskSnap.exists()) {
            const taskData = taskSnap.data() as any;
            itemGoalId = normalizeGoalId(taskData?.goalId);
            if (!itemGoalId) {
              const storyId = normalizeGoalId(taskData?.storyId || (taskData?.parentType === 'story' ? taskData?.parentId : ''));
              if (storyId) {
                const storySnap = await getDoc(doc(db, 'stories', storyId));
                if (storySnap.exists()) {
                  const storyData = storySnap.data() as any;
                  itemGoalId = normalizeGoalId(storyData?.goalId);
                }
              }
            }
          }
        }
      } catch (lookupError) {
        console.warn('[DeferItemModal] infer_focus_item_lookup_failed', { itemType, itemId, lookupError });
      }

      let activeFocusGoals: FocusContextPayload['activeFocusGoals'] = [];
      try {
        const focusSnap = await getDocs(query(collection(db, 'focusGoals'), where('ownerUid', '==', currentUser.uid)));
        activeFocusGoals = focusSnap.docs
          .map((snap) => ({ id: snap.id, ...(snap.data() as any) }))
          .filter((focusGoal) => {
            const focusPersona = String(focusGoal?.persona || '').trim().toLowerCase();
            if (!currentPersona || !focusPersona) return true;
            return focusPersona === currentPersona;
          })
          .filter((focusGoal) => focusGoal?.isActive !== false)
          .map((focusGoal) => ({
            id: focusGoal.id,
            title: String(focusGoal.title || '').trim() || null,
            focusRootGoalIds: Array.isArray(focusGoal.focusRootGoalIds) ? focusGoal.focusRootGoalIds : [],
            focusLeafGoalIds: Array.isArray(focusGoal.focusLeafGoalIds) ? focusGoal.focusLeafGoalIds : [],
            goalIds: Array.isArray(focusGoal.goalIds) ? focusGoal.goalIds : [],
          }));
      } catch (focusLookupError) {
        console.warn('[DeferItemModal] infer_focus_lookup_failed', { focusLookupError, uid: currentUser.uid });
        return null;
      }

      if (!activeFocusGoals.length) return { isFocusAligned: true, activeFocusGoals: [] };

      const focusIds = new Set<string>();
      activeFocusGoals.forEach((goal) => {
        extractFocusGoalIds(goal).forEach((id) => focusIds.add(id));
      });
      let isFocusAligned = false;
      if (itemGoalId) {
        try {
          const goalsQuery = currentPersona
            ? query(
                collection(db, 'goals'),
                where('ownerUid', '==', currentUser.uid),
                where('persona', '==', currentPersona)
              )
            : query(
                collection(db, 'goals'),
                where('ownerUid', '==', currentUser.uid)
              );
          const goalsSnap = await getDocs(goalsQuery);
          const goalRows = goalsSnap.docs.map((snap) => ({ id: snap.id, ...(snap.data() as any) })) as Goal[];
          isFocusAligned = goalRows.length > 0
            ? isGoalInHierarchySet(itemGoalId, goalRows, focusIds)
            : focusIds.has(itemGoalId);
        } catch (goalLookupError) {
          console.warn('[DeferItemModal] infer_focus_goal_lookup_failed', { itemGoalId, goalLookupError });
          isFocusAligned = focusIds.has(itemGoalId);
        }
      }
      return {
        isFocusAligned,
        activeFocusGoals,
      };
    };

    const buildOptions = (
      quick: DeferralOption | null,
      nextFocusContext: FocusContextPayload | null,
    ): { topOptions: DeferralOption[]; moreOptions: DeferralOption[] } => {
      // Build focus leaf ID set from inferred context
      const focusLeafIds = new Set<string>();
      (nextFocusContext?.activeFocusGoals || []).forEach((fg) => {
        const ids = [
          ...(Array.isArray(fg.focusLeafGoalIds) ? fg.focusLeafGoalIds : []),
          ...(Array.isArray(fg.goalIds) ? fg.goalIds : []),
        ];
        ids.forEach((id) => { if (id) focusLeafIds.add(String(id).trim()); });
      });

      // Use shared heuristic — resolvedSprintContext always has a value (from hook or prop)
      if (resolvedSprintContext.currentSprint || resolvedSprintContext.nextSprint) {
        const score = computeItemDeferral({
          item: { goalId: '' },   // focus alignment already determined via inferFocusContext
          itemType,
          currentSprint: resolvedSprintContext.currentSprint,
          nextSprint: resolvedSprintContext.nextSprint,
          focusLeafIds,
        });

        // Map DeferralTarget → DeferralOption (compatible shape)
        const mapped: DeferralOption[] = score.suggestedTargets.map((t) => ({
          key: t.key,
          dateMs: t.dateMs,
          label: t.label,
          rationale: t.rationale,
          source: t.source,
        }));

        const top = quick ? [quick, ...mapped.slice(0, 2)] : mapped.slice(0, 3);
        const more = quick ? mapped.slice(2) : mapped.slice(3);
        return { topOptions: top, moreOptions: more };
      }

      // Fallback: generic date-based options when no sprint context
      const today = startOfDayMs(Date.now());
      const focusNote = nextFocusContext && !nextFocusContext.isFocusAligned
        ? ' This item is outside your active focus goals.'
        : '';
      const top: DeferralOption[] = [
        { key: 'tomorrow', dateMs: addDays(today, 1), label: 'Tomorrow', rationale: `Push to tomorrow to free up today.${focusNote}`, source: 'on_device' },
        { key: 'next-week', dateMs: addDays(today, 7), label: 'Next week', rationale: `Move to next week.${focusNote}`, source: 'on_device' },
        { key: 'two-weeks', dateMs: addDays(today, 14), label: 'In 2 weeks', rationale: `Defer by two weeks.${focusNote}`, source: 'on_device' },
      ];
      const more: DeferralOption[] = [
        { key: 'three-weeks', dateMs: addDays(today, 21), label: 'In 3 weeks', rationale: 'Defer for three weeks.', source: 'on_device' },
        { key: 'next-month', dateMs: addMonths(today, 1), label: 'Next month', rationale: 'Defer for a full month.', source: 'on_device' },
      ];
      return quick
        ? { topOptions: [quick, ...top], moreOptions: more }
        : { topOptions: top, moreOptions: more };
    };

    const loadOptions = async () => {
      setLoading(true);
      setError(null);
      setInferredFocusContext(null);
      try {
        if (itemType === 'task' && itemId) {
          try {
            const taskSnap = await getDoc(doc(db, 'tasks', itemId));
            if (taskSnap.exists()) {
              nextQuickMoveOption = buildRecurringQuickMoveOption(taskSnap.data() as TaskRecurrenceShape);
            }
          } catch (lookupErr) {
            console.warn('[DeferItemModal] recurring_task_lookup_failed', { itemId, lookupErr });
          }
        }

        const nextFocusContext = focusContext || await inferFocusContext();
        if (cancelled) return;
        setInferredFocusContext(focusContext ? null : nextFocusContext);

        const { topOptions: top, moreOptions: more } = buildOptions(nextQuickMoveOption, nextFocusContext);

        const allOptions = [...top, ...more.filter((o) => !top.find((t) => t.key === o.key))];
        setQuickMoveOption(nextQuickMoveOption);
        setOptions(allOptions);
        setTopOptions(top);
        setMoreOptions(more);
        setSelectedKey(top[0]?.key || 'custom');
        setShowMoreSuggestions(false);
      } catch (err: any) {
        if (cancelled) return;
        console.error('[DeferItemModal] suggestions_failed', { itemType, itemId, err });
        setError('Could not generate defer suggestions.');
        const fallback = nextQuickMoveOption ? [nextQuickMoveOption] : [];
        setQuickMoveOption(nextQuickMoveOption);
        setOptions(fallback);
        setTopOptions(fallback);
        setMoreOptions([]);
        setSelectedKey(nextQuickMoveOption?.key || 'custom');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadOptions();
    return () => {
      cancelled = true;
    };
  }, [show, itemId, itemType, itemTitle, focusContext, currentUser?.uid, currentPersona]);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.key === selectedKey) || null,
    [options, selectedKey]
  );

  const handleApply = async () => {
    setError(null);
    let dateMs: number | null = null;
    let rationale = '';
    let source = 'custom';
    let targetBucket: DeferralOption['targetBucket'] = null;
    let constraintMode: PlannerConstraintMode | null = null;
    let exactTargetStartMs: number | null = null;
    let exactTargetEndMs: number | null = null;

    if (selectedKey === 'custom') {
      if (!customDate) {
        setError('Choose a custom defer date.');
        return;
      }
      const parsed = Date.parse(`${customDate}T12:00:00`);
      if (Number.isNaN(parsed)) {
        setError('Custom date is invalid.');
        return;
      }
      dateMs = startOfDayMs(parsed);
      rationale = 'Custom date selected by user.';
    } else if (selectedOption) {
      dateMs = Number(selectedOption.exactTargetStartMs || selectedOption.dateMs);
      rationale = selectedOption.rationale || selectedOption.label;
      source = selectedOption.source || 'capacity_forecast';
      targetBucket = selectedOption.targetBucket || null;
      constraintMode = selectedOption.constraintMode || null;
      exactTargetStartMs = selectedOption.exactTargetStartMs || null;
      exactTargetEndMs = selectedOption.exactTargetEndMs || null;
    }

    if (!dateMs || Number.isNaN(dateMs)) {
      setError('Select a valid defer target.');
      return;
    }

    setApplying(true);
    try {
      await onApply({
        dateMs,
        rationale,
        source,
        targetBucket,
        constraintMode,
        exactTargetStartMs,
        exactTargetEndMs,
      });
      onHide();
    } catch (err: any) {
      console.error('[DeferItemModal] apply_failed', { itemType, itemId, err });
      setError(err?.message || 'Failed to defer this item.');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title style={{ fontSize: 16 }}>Defer intelligently</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="mb-2" style={{ fontSize: 13 }}>
          <strong>{itemTitle || `Untitled ${itemType}`}</strong>
        </div>
        <p className="text-muted small mb-3">
          Suggestions are ranked to reduce near-term overload using sprint windows and calendar utilization.
        </p>
        {hasFocusPressure && (
          <Alert variant="info" className="py-2 small">
            This item is outside your active focus goals. Deferring it can free capacity for focus work.
          </Alert>
        )}

        {error && <Alert variant="warning" className="py-2">{error}</Alert>}

        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner animation="border" size="sm" />
            Loading defer suggestions...
          </div>
        ) : (
          <>
            {topOptions.map((opt) => (
              <Form.Check
                key={opt.key}
                type="radio"
                name="defer-option"
                id={`defer-option-${opt.key}`}
                checked={selectedKey === opt.key}
                onChange={() => setSelectedKey(opt.key)}
                className="mb-2"
                label={
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="text-muted"> ({new Date(opt.dateMs).toLocaleDateString()})</span>
                    <div className="text-muted small">{opt.rationale}</div>
                  </span>
                }
              />
            ))}

            {moreOptions.length > 0 && (
              <div className="mt-2 mb-2">
                <Button
                  variant="link"
                  size="sm"
                  className="p-0"
                  onClick={() => setShowMoreSuggestions((prev) => !prev)}
                >
                  {showMoreSuggestions
                    ? 'Hide additional suggestions'
                    : `Show ${moreOptions.length} more suggestion${moreOptions.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            )}

            {showMoreSuggestions && moreOptions.map((opt) => (
              <Form.Check
                key={opt.key}
                type="radio"
                name="defer-option"
                id={`defer-option-${opt.key}`}
                checked={selectedKey === opt.key}
                onChange={() => setSelectedKey(opt.key)}
                className="mb-2"
                label={
                  <span>
                    <strong>{opt.label}</strong>
                    <span className="text-muted"> ({new Date(opt.dateMs).toLocaleDateString()})</span>
                    <div className="text-muted small">{opt.rationale}</div>
                  </span>
                }
              />
            ))}

            <Form.Check
              type="radio"
              name="defer-option"
              id="defer-option-custom"
              checked={selectedKey === 'custom'}
              onChange={() => setSelectedKey('custom')}
              className="mt-3"
              label="Pick a custom date"
            />

            {selectedKey === 'custom' && (
              <Form.Control
                type="date"
                className="mt-2"
                value={customDate}
                min={toInputDate(Date.now())}
                onChange={(e) => setCustomDate(e.target.value)}
              />
            )}

          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" size="sm" onClick={onHide} disabled={applying}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleApply} disabled={loading || applying}>
          {applying ? <Spinner animation="border" size="sm" className="me-1" /> : null}
          Apply move/defer
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default DeferItemModal;
