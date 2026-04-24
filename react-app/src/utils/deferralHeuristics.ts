/**
 * Shared deferral heuristics — used by PlannerCapacityBanner (sprint-level scoring)
 * and DeferItemModal (per-item target generation) to ensure a consistent approach.
 *
 * Focus story/task  → defer WITHIN current sprint window (keep focus work close)
 * Non-focus item    → defer to next sprint start
 * Chore/recurring   → caller handles via buildRecurringQuickMoveOption
 */

import type { Sprint } from '../types';

// ─── Public types ─────────────────────────────────────────────────────────────

export type DeferralReasonCode =
  | 'not_focus_aligned'
  | 'low_relative_priority'
  | 'large_effort'
  | 'no_goal_link';

export interface DeferralTarget {
  key: string;
  dateMs: number;
  label: string;
  rationale: string;
  source: string;
  sprintId?: string;
}

export interface DeferralScore {
  isFocusAligned: boolean;
  isChore: boolean;
  reasonCodes: DeferralReasonCode[];
  reasonSummary: string;
  /** True if banner should surface this item as a deferral candidate */
  shouldDefer: boolean;
  /** Ordered list of suggested deferral targets, best first */
  suggestedTargets: DeferralTarget[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const startOfDayMs = (ms: number): number => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const addDays = (baseMs: number, days: number): number => {
  const d = new Date(baseMs);
  d.setDate(d.getDate() + days);
  return startOfDayMs(d.getTime());
};

const addMonths = (baseMs: number, months: number): number => {
  const d = new Date(baseMs);
  d.setMonth(d.getMonth() + months);
  return startOfDayMs(d.getTime());
};

const shortDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const normalizePriority = (value: unknown, fallback = 2): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(4, parsed)) : fallback;
};

const normalizeEffortHours = (item: any): number => {
  const direct = Number(item?.points);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const hours = Number(item?.estimatedHours);
  if (Number.isFinite(hours) && hours > 0) return hours;
  const mins = Number(item?.estimateMin);
  if (Number.isFinite(mins) && mins > 0) return Math.max(1, mins / 60);
  return 1;
};

const isChoreItem = (item: any): boolean => {
  const raw = String(item?.type || item?.task_type || '').toLowerCase().trim();
  return ['chore', 'routine', 'habit', 'habitual'].includes(raw);
};

const isItemDone = (item: any, itemType: 'story' | 'task'): boolean => {
  const val = item?.status;
  if (itemType === 'story') {
    if (typeof val === 'number') return val >= 4;
    return ['done', 'complete', 'completed', 'closed', 'finished'].includes(String(val || '').toLowerCase());
  }
  if (typeof val === 'number') return val === 2;
  return ['done', 'complete', 'completed', 'closed', 'finished'].includes(String(val || '').toLowerCase());
};

// ─── Reason helpers ───────────────────────────────────────────────────────────

export const reasonSummaryFromCodes = (codes: DeferralReasonCode[]): string => {
  if (codes.includes('not_focus_aligned')) return 'Not focus-aligned';
  if (codes.includes('low_relative_priority')) return 'Lower priority';
  if (codes.includes('large_effort')) return 'High effort';
  if (codes.includes('no_goal_link')) return 'No goal link';
  return 'Lower priority';
};

// ─── Target builders ──────────────────────────────────────────────────────────

/**
 * Focus-aligned items: prefer staying within the current sprint window.
 * The "theme block" proxy is the last few days of the current sprint — work
 * that belongs to the focus theme should be completed inside the sprint.
 * If the sprint has already ended or is very close, fall back to next sprint start.
 */
const buildFocusTargets = (
  currentSprint: Sprint | null,
  nextSprint: Sprint | null,
  focusNote: string,
): DeferralTarget[] => {
  const now = Date.now();
  const targets: DeferralTarget[] = [];

  if (currentSprint) {
    const sprintEnd = Number(currentSprint.endDate || 0);
    const daysLeft = (sprintEnd - now) / 86_400_000;

    if (daysLeft > 3) {
      // Aim for mid-point of remaining sprint so there's still time to act on it
      const midpoint = startOfDayMs(now + (sprintEnd - now) / 2);
      targets.push({
        key: 'sprint-window',
        dateMs: midpoint,
        label: `Within current sprint (by ${shortDate(sprintEnd)})`,
        rationale: `Focus-aligned — keep within the current sprint window.${focusNote}`,
        source: 'heuristic_focus',
        sprintId: currentSprint.id,
      });
    } else if (daysLeft > 0) {
      targets.push({
        key: 'sprint-end',
        dateMs: startOfDayMs(sprintEnd),
        label: `Current sprint end (${shortDate(sprintEnd)})`,
        rationale: `Focus-aligned — push to end of current sprint.${focusNote}`,
        source: 'heuristic_focus',
        sprintId: currentSprint.id,
      });
    }
  }

  if (nextSprint) {
    const nextStart = Number(nextSprint.startDate || 0);
    targets.push({
      key: 'next-sprint',
      dateMs: startOfDayMs(nextStart),
      label: `Next sprint – ${nextSprint.name} (${shortDate(nextStart)})`,
      rationale: `Focus-aligned — move to next sprint if current window is too tight.${focusNote}`,
      source: 'heuristic_focus',
      sprintId: nextSprint.id,
    });
  }

  // Fallbacks
  const today = startOfDayMs(now);
  if (!targets.length) {
    targets.push({
      key: 'two-weeks',
      dateMs: addDays(today, 14),
      label: 'In 2 weeks',
      rationale: `Focus-aligned item — defer short-term, then revisit.${focusNote}`,
      source: 'heuristic_focus',
    });
  }
  targets.push({
    key: 'three-weeks',
    dateMs: addDays(today, 21),
    label: 'In 3 weeks',
    rationale: 'Short deferral — revisit at the next planning cycle.',
    source: 'heuristic_focus',
  });

  return targets;
};

/**
 * Non-focus items: move to the next sprint start. That's the clearest
 * signal — this work is not in the current focus and should wait its turn.
 */
const buildNonFocusTargets = (
  currentSprint: Sprint | null,
  nextSprint: Sprint | null,
  reasonNote: string,
): DeferralTarget[] => {
  const today = startOfDayMs(Date.now());
  const targets: DeferralTarget[] = [];

  if (nextSprint) {
    const nextStart = Number(nextSprint.startDate || 0);
    targets.push({
      key: 'next-sprint',
      dateMs: startOfDayMs(nextStart),
      label: `Next sprint – ${nextSprint.name} (${shortDate(nextStart)})`,
      rationale: `Not focus-aligned — move to next sprint.${reasonNote}`,
      source: 'heuristic_non_focus',
      sprintId: nextSprint.id,
    });
  }

  if (currentSprint) {
    const sprintEnd = Number(currentSprint.endDate || 0);
    if (sprintEnd > Date.now() + 86_400_000) {
      targets.push({
        key: 'sprint-end',
        dateMs: startOfDayMs(sprintEnd),
        label: `Current sprint end (${shortDate(sprintEnd)})`,
        rationale: `Defer to end of current sprint.${reasonNote}`,
        source: 'heuristic_non_focus',
        sprintId: currentSprint.id,
      });
    }
  }

  targets.push(
    {
      key: 'two-weeks',
      dateMs: addDays(today, 14),
      label: 'In 2 weeks',
      rationale: `Defer for two weeks.${reasonNote}`,
      source: 'heuristic_non_focus',
    },
    {
      key: 'next-month',
      dateMs: addMonths(today, 1),
      label: 'Next month',
      rationale: 'Defer for a full month.',
      source: 'heuristic_non_focus',
    },
  );

  return targets;
};

// ─── Main export ──────────────────────────────────────────────────────────────

export interface ComputeItemDeferralParams {
  item: any;
  itemType: 'story' | 'task';
  currentSprint: Sprint | null;
  nextSprint: Sprint | null;
  /** Pre-computed set of active focus leaf goal IDs (from getActiveFocusLeafGoalIds) */
  focusLeafIds: Set<string>;
}

export const computeItemDeferral = (params: ComputeItemDeferralParams): DeferralScore => {
  const { item, itemType, currentSprint, nextSprint, focusLeafIds } = params;

  const isChore = itemType === 'task' && isChoreItem(item);
  const isDone = isItemDone(item, itemType);

  if (isDone || isChore) {
    return {
      isFocusAligned: true,
      isChore,
      reasonCodes: [],
      reasonSummary: '',
      shouldDefer: false,
      suggestedTargets: [],
    };
  }

  const priority = normalizePriority(item?.priority, 2);
  const hours = normalizeEffortHours(item);
  const goalId = String(item?.goalId || '').trim();
  const isFocusAligned = focusLeafIds.size === 0 || (!!goalId && focusLeafIds.has(goalId));

  const reasonCodes: DeferralReasonCode[] = [];
  if (!isFocusAligned && focusLeafIds.size > 0) reasonCodes.push('not_focus_aligned');
  if (priority <= 2) reasonCodes.push('low_relative_priority');
  if (!goalId) reasonCodes.push('no_goal_link');
  if (hours > 8) reasonCodes.push('large_effort');

  // Critical items (priority 4) are never deferral candidates
  // High priority + focus-aligned items are protected
  const shouldDefer =
    priority < 4 &&
    !(priority >= 3 && isFocusAligned && focusLeafIds.size > 0) &&
    reasonCodes.length > 0;

  const reasonSummary = reasonSummaryFromCodes(reasonCodes);

  const focusNote = isFocusAligned ? '' : ' Freeing capacity for focus work.';
  const reasonNote = reasonCodes.length ? ` Reason: ${reasonSummary.toLowerCase()}.` : '';

  const suggestedTargets = isFocusAligned
    ? buildFocusTargets(currentSprint, nextSprint, focusNote)
    : buildNonFocusTargets(currentSprint, nextSprint, reasonNote);

  return {
    isFocusAligned,
    isChore,
    reasonCodes,
    reasonSummary,
    shouldDefer,
    suggestedTargets,
  };
};
