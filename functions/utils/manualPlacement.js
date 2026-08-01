/**
 * manualPlacement — the single definition of "the user put this here, leave it alone".
 *
 * Two independent locks, because a nightly planner can undo a manual move in two
 * different ways and blocking one does nothing about the other:
 *
 *   1. ENTITY lock (`orchestrationLocked` on a story/task) stops a planner scheduling the
 *      same entity a SECOND time somewhere else. Without it the user's block survives
 *      untouched but a freshly-placed duplicate of the same story appears next to it.
 *   2. BLOCK lock (`manuallyScheduled` on a calendar_blocks doc) stops a planner deleting
 *      or relocating the block the user actually dragged. Both nightly planners sweep
 *      their own prior output every run (sprintForwardPlanner deletes every future
 *      `sprint_forward_plan` block; runCalendarPlannerJob deletes AI blocks no longer in
 *      the top set; replanExistingBlocksForUser relocates anything `aiGenerated`) and
 *      none of them could previously tell a block the user had moved from one they had
 *      placed themselves.
 *
 * Entity locks EXPIRE. They exist to protect a specific placement, not to retire an item
 * from planning forever — a permanent lock silently drops the story out of every future
 * nightly run with no UI anywhere to release it. Confirmed live 2026-08-01: of the 4
 * locked stories in the account, 3 had been frozen since April, May and June by a single
 * defer each. Block locks do not expire: a block is a placement, so its lock dies with it.
 */

'use strict';

// Sources that are NOT a human placing something by hand. Everything else is, because
// schedulePlannerItem is only ever reached from a drag, a drop, or a date chosen in the
// defer dialog — and the UI names its source per surface, of which there are already a
// dozen and counting ('weekly_planner', 'roadmap_week_grid', 'daily_plan', 'mobile_home',
// 'sprint_planning_matrix', 'kanban_card_v2', 'chore_checklist', banners, tables…).
//
// Deliberately a denylist. An allowlist inverts the failure mode into the exact bug this
// module exists to fix: add a new planner surface, forget to register its source string,
// and every placement made there is silently unprotected. Automated callers are few, all
// live in this repo's backend, and are enumerable — new UI surfaces are neither.
//
// 'replan_calendar' belongs here despite being user-TRIGGERED (the Replan button): it is a
// bulk automatic re-placement of everything, not a manual placement, so locking on it
// would freeze the whole board on one click.
const AUTOMATED_PLACEMENT_SOURCES = new Set([
  'nightly_calendar_planner',
  'unified_nightly_orchestrator',
  'nightly',
  'replan_calendar',
  'replan',
  'scheduler',
  'mac_sync',
  'ai',
  'llm',
  'theme_allocation',
  'sprint_forward_plan',
]);

// Applied to legacy locks written before orchestrationLockedUntil existed. Those records
// carry only the moment the user acted, not the placement they were protecting, so the
// window is inferred rather than known — 14 days is long enough to cover a deferred item
// still sitting in its target week, short enough that a months-old lock releases itself.
const LEGACY_LOCK_GRACE_DAYS = 14;
const MS_IN_DAY = 86_400_000;

function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? (value < 1e11 ? value * 1000 : value) : null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * True when `source` identifies a human placing an item by hand. An absent source is
 * treated as automation: every UI surface names itself, so a blank one came from a
 * caller that never thought about it.
 */
function isUserPlacementSource(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return false;
  return !AUTOMATED_PLACEMENT_SOURCES.has(normalized);
}

/**
 * The instant an entity lock stops applying, or null when it never had a usable one.
 * Prefers the explicit end of the placement being protected; falls back to the legacy
 * grace window measured from when the lock was written.
 */
function resolveOrchestrationLockUntilMs(entity) {
  const explicit = toMs(entity?.orchestrationLockedUntil);
  if (Number.isFinite(explicit)) return explicit;
  const lockedAt = toMs(entity?.orchestrationLockedAt);
  if (Number.isFinite(lockedAt)) return lockedAt + LEGACY_LOCK_GRACE_DAYS * MS_IN_DAY;
  return null;
}

/**
 * True when automated planning must leave this story/task alone right now.
 * A lock with no resolvable expiry is treated as still active — failing closed here
 * protects a user placement, whereas failing open silently overwrites it.
 */
function isOrchestrationLocked(entity, nowMs = Date.now()) {
  if (entity?.orchestrationLocked !== true) return false;
  const untilMs = resolveOrchestrationLockUntilMs(entity);
  if (untilMs == null) return true;
  return untilMs > nowMs;
}

/** True when this calendar block sits where it does because the user dragged it there. */
function isManuallyPlacedBlock(block) {
  return block?.manuallyScheduled === true;
}

module.exports = {
  AUTOMATED_PLACEMENT_SOURCES,
  LEGACY_LOCK_GRACE_DAYS,
  isUserPlacementSource,
  isOrchestrationLocked,
  isManuallyPlacedBlock,
  resolveOrchestrationLockUntilMs,
};
