const { toMillis } = require('./time');

const ACTIVE_STATUS_VALUES = new Set(['active', 'current', 'in-progress', 'inprogress', '1', 'true']);

function isSprintStatusActive(status) {
  return ACTIVE_STATUS_VALUES.has(String(status ?? '').toLowerCase());
}

function isSprintInWindow(sprint, nowMs = Date.now()) {
  const startMs = toMillis(sprint?.startDate ?? sprint?.start);
  const endMs = toMillis(sprint?.endDate ?? sprint?.end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return nowMs >= startMs && nowMs <= endMs;
}

function normalizeSprintPersona(value) {
  return String(value || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';
}

/**
 * A sprint's date window merely overlapping "now" does not make it active — a planned
 * (status=0) sprint scheduled for this month is not the active sprint just because today
 * falls inside its window. Only fall back to date-window matching when nothing in the set
 * carries an explicit active status, so a genuinely active sprint always wins, even if a
 * later-starting planned sprint's window also happens to include today.
 *
 * Pass `persona` ('personal' | 'work') to restrict the result to sprints of that persona
 * BEFORE the status/window logic runs — so a personal item is never treated as being in
 * an active sprint just because a work sprint is currently active (and vice versa). The
 * status-vs-window fallback is then evaluated within that persona only.
 *
 * Returns a Set of sprint doc IDs to treat as "active" for scheduling/scoring purposes.
 */
function resolveActiveSprintIds(sprintDocs, { nowMs = Date.now(), persona = null } = {}) {
  const wantPersona = persona ? normalizeSprintPersona(persona) : null;
  const statusActiveIds = [];
  const windowActiveIds = [];
  for (const doc of sprintDocs || []) {
    const id = doc?.id;
    const data = doc?.data ? (doc.data() || {}) : (doc || {});
    if (!id) continue;
    if (wantPersona && normalizeSprintPersona(data.persona) !== wantPersona) continue;
    if (isSprintStatusActive(data.status)) {
      statusActiveIds.push(id);
    } else if (isSprintInWindow(data, nowMs)) {
      windowActiveIds.push(id);
    }
  }
  return new Set(statusActiveIds.length ? statusActiveIds : windowActiveIds);
}

/**
 * Convenience wrapper returning persona-scoped active-sprint sets in one pass:
 * `{ personal: Set<id>, work: Set<id> }`. Callers that process both personas
 * together should check an entity against the set for its OWN persona.
 */
function resolveActiveSprintIdsByPersona(sprintDocs, { nowMs = Date.now() } = {}) {
  return {
    personal: resolveActiveSprintIds(sprintDocs, { nowMs, persona: 'personal' }),
    work: resolveActiveSprintIds(sprintDocs, { nowMs, persona: 'work' }),
  };
}

module.exports = {
  isSprintStatusActive,
  isSprintInWindow,
  normalizeSprintPersona,
  resolveActiveSprintIds,
  resolveActiveSprintIdsByPersona,
};
