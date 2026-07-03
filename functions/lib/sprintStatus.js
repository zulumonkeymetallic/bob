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

/**
 * A sprint's date window merely overlapping "now" does not make it active — a planned
 * (status=0) sprint scheduled for this month is not the active sprint just because today
 * falls inside its window. Only fall back to date-window matching when nothing in the set
 * carries an explicit active status, so a genuinely active sprint always wins, even if a
 * later-starting planned sprint's window also happens to include today.
 *
 * Returns a Set of sprint doc IDs to treat as "active" for scheduling/scoring purposes.
 */
function resolveActiveSprintIds(sprintDocs, { nowMs = Date.now() } = {}) {
  const statusActiveIds = [];
  const windowActiveIds = [];
  for (const doc of sprintDocs || []) {
    const id = doc?.id;
    const data = doc?.data ? (doc.data() || {}) : (doc || {});
    if (!id) continue;
    if (isSprintStatusActive(data.status)) {
      statusActiveIds.push(id);
    } else if (isSprintInWindow(data, nowMs)) {
      windowActiveIds.push(id);
    }
  }
  return new Set(statusActiveIds.length ? statusActiveIds : windowActiveIds);
}

module.exports = {
  isSprintStatusActive,
  isSprintInWindow,
  resolveActiveSprintIds,
};
