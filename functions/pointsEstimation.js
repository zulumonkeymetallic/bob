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
 *   - **Manual always wins.** A human Fibonacci entry is never overwritten by either
 *     engine.
 *   - **Device estimates are provisional.** When an item next syncs, a server estimate
 *     replaces a device one. The reverse never happens.
 *   - **Output is clamped, not trusted.** An LLM asked for a Fibonacci point value will
 *     occasionally return 4, 100, "medium" or prose. Anything not on the scale is snapped
 *     to the nearest valid value, and anything unparseable is rejected outright — an
 *     absent estimate is honest, a fabricated one is not.
 *
 * The Swift mirror is bob-ios/BOB/Sources/Sync/PointsEstimation.swift. Change the scale or
 * the clamping here and change it there, in the same commit. `pointsEstimation.test.js`
 * and the iOS suite both pin this behaviour.
 */

/** The only values BOB stores. Matches `FibonacciPointPicker` on iOS. */
const FIBONACCI_POINTS = [1, 2, 3, 5, 8, 13, 21];

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
function clampToFibonacci(raw) {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return FIBONACCI_POINTS.reduce((best, v) =>
    Math.abs(v - n) < Math.abs(best - n) ? v : best, FIBONACCI_POINTS[0]);
}

/**
 * May `next` overwrite what is already on the item?
 *
 * Manual is terminal. Server replaces device (the device estimate was provisional) and
 * replaces an earlier server estimate (a re-run is a better read). Device never replaces
 * server — that is the rule that stops a phone briefly offline from undoing the nightly
 * chain's work.
 */
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
function buildEstimationPrompt({ title, description, acceptanceCriteria = [], subtaskCount = 0 }) {
  const criteria = acceptanceCriteria.length
    ? `\nAcceptance criteria (${acceptanceCriteria.length}):\n- ${acceptanceCriteria.join('\n- ')}`
    : '';
  const subtasks = subtaskCount > 0 ? `\nSubtasks: ${subtaskCount}` : '';
  return {
    system:
      'You size work in Fibonacci story points. Reply with JSON only: {"points": <number>}. '
      + `Valid values: ${FIBONACCI_POINTS.join(', ')}. `
      + '1 is under an hour; 3 is about a day; 8 is about a week; 21 is multi-week and should be split. '
      + 'Judge effort and uncertainty, not importance.',
    user: `Title: ${title || '(untitled)'}\n${description ? `Details: ${String(description).slice(0, 500)}` : ''}${criteria}${subtasks}`,
  };
}

module.exports = {
  FIBONACCI_POINTS,
  POINTS_SOURCE,
  clampToFibonacci,
  shouldApplyEstimate,
  provenanceFields,
  buildEstimationPrompt,
};
