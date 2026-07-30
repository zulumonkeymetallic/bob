/**
 * Story/task point estimation — the shared contract.
 *
 * Estimation runs in TWO places, by Jim's decision of 2026-07-28: an LLM here when the
 * user is online, and Foundation Models on the device when they are not, because BOB has
 * to work fully offline.
 *
 * The two engines will not always agree, and Foundation Models is not universally
 * available — a device whose system language and Siri language differ reports it as
 * unavailable, which is a Settings state, not hardware. Nothing here pretends otherwise.
 * Instead the contract makes disagreement survivable:
 *
 *   - **Provenance on every estimate.** You can always tell which engine produced a
 *     number, with which model, and when. Without that, two different values for the same
 *     story are indistinguishable from a bug.
 *   - **Manual always wins.** A human entry is never overwritten by either engine.
 *   - **Device estimates are provisional.** When an item next syncs, a server estimate
 *     replaces a device one. The reverse never happens.
 *   - **Output is clamped, not trusted.** An LLM asked for a point value will
 *     occasionally return 100, "medium" or prose. Anything off the grid is snapped to the
 *     nearest valid value, and anything unparseable is rejected outright — an absent
 *     estimate is honest, a fabricated one is not.
 *
 * ## The scale, corrected 2026-07-28
 *
 * This module shipped with a Fibonacci scale. That was wrong. BOB's canonical scale is
 * 0.25 increments, and it was already defined in three places:
 *
 *   - `react-app/src/utils/points.ts` — POINTS_MIN 0.25, POINTS_STEP 0.25,
 *     TASK_POINTS_MAX 8, STORY_POINTS_MAX 13, TASK_DEFAULT_POINTS 0.25.
 *   - `functions/index.js` — DEFAULT_TASK_POINTS = 0.25, and prompts specifying
 *     "decimals allowed in 0.25 increments, range 0.25-8".
 *   - `functions/nightlyOrchestration.js` — the same wording, plus a duration fallback
 *     of max(0.25, hours).
 *
 * 618 of Jim's tasks sit on exactly 0.25 — TASK_DEFAULT_POINTS, not corruption. A
 * Fibonacci clamp would have snapped every one of them to 1.
 *
 * The Swift mirror is bob-ios/BOB/Sources/Sync/PointsEstimation.swift. Change the scale or
 * the clamping here and change it there, in the same commit. `pointsEstimation.test.js`
 * and the iOS suite both pin this behaviour.
 */

const POINTS_MIN = 0.25;
const POINTS_STEP = 0.25;
const TASK_POINTS_MAX = 8;
const STORY_POINTS_MAX = 13;

const POINTS_SOURCE = {
  MANUAL: 'manual',
  SERVER: 'server_llm',
  DEVICE: 'device_fm',
};

/**
 * Snap an arbitrary model response to the scale.
 * Returns null when the value cannot be read as a number at all — better no estimate than
 * an invented one.
 */
/**
 * Snap an arbitrary model response onto the 0.25 grid and the kind's range.
 * Returns null when it cannot be read as a positive number at all.
 *
 * Rounding matches `roundToStep` in react-app/src/utils/points.ts exactly
 * (Math.round(value / step) * step, fixed to 2dp), so the two never disagree.
 */
function clampPoints(raw, kind = 'task') {
  const max = kind === 'story' ? STORY_POINTS_MAX : TASK_POINTS_MAX;
  const n = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  const bounded = Math.max(POINTS_MIN, Math.min(max, n));
  return Number((Math.round(bounded / POINTS_STEP) * POINTS_STEP).toFixed(2));
}

/** Every legal value for a kind — used by pickers and by the tests. */
function pointsScale(kind = 'task') {
  const max = kind === 'story' ? STORY_POINTS_MAX : TASK_POINTS_MAX;
  const out = [];
  for (let v = POINTS_MIN; v <= max + 1e-9; v += POINTS_STEP) {
    out.push(Number(v.toFixed(2)));
  }
  return out;
}

function shouldApplyEstimate(existingSource, nextSource) {
  if (existingSource === POINTS_SOURCE.MANUAL) return false;
  if (nextSource === POINTS_SOURCE.MANUAL) return true;
  if (nextSource === POINTS_SOURCE.SERVER) return true;
  return existingSource !== POINTS_SOURCE.SERVER;
}

/** The fields to write alongside `points`, so the estimate can be reasoned about later. */
function provenanceFields({ source, model, at = new Date() }) {
  return {
    pointsSource: source,
    pointsModel: model || null,
    pointsAt: at instanceof Date ? at.toISOString() : String(at),
  };
}

/**
 * Deterministic prompt. Kept here rather than at the call site so the device and the
 * server ask the same question — the engines differ enough without the prompts differing
 * too.
 */
function buildEstimationPrompt({ title, description, acceptanceCriteria = [], subtaskCount = 0, kind = 'task' }) {
  const criteria = acceptanceCriteria.length
    ? `\nAcceptance criteria (${acceptanceCriteria.length}):\n- ${acceptanceCriteria.join('\n- ')}`
    : '';
  const subtasks = subtaskCount > 0 ? `\nSubtasks: ${subtaskCount}` : '';
  return {
    system:
      'Estimate agile story points. Reply with JSON only: {"points": <number>}. '
      + `Range ${POINTS_MIN}\u2013${kind === 'story' ? STORY_POINTS_MAX : TASK_POINTS_MAX}, in ${POINTS_STEP} increments. `
      + '0.25 is a few minutes; 1 is about half a day; 4 is a couple of days; '
      + '8 is a week or more and should probably be split. '
      + 'Judge effort and uncertainty, not importance.',
    user: `Title: ${title || '(untitled)'}\n${description ? `Details: ${String(description).slice(0, 500)}` : ''}${criteria}${subtasks}`,
  };
}

module.exports = {
  POINTS_MIN,
  POINTS_STEP,
  TASK_POINTS_MAX,
  STORY_POINTS_MAX,
  pointsScale,
  POINTS_SOURCE,
  clampPoints,
  shouldApplyEstimate,
  provenanceFields,
  buildEstimationPrompt,
};
