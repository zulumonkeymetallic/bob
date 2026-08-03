/**
 * One guard against generic acceptance criteria, shared by every path that writes them.
 *
 * ## Why filler is worse than nothing
 *
 * `generateMissingAcceptanceCriteria` (nightlyOrchestration) skips any story whose
 * `acceptanceCriteria` array is non-empty. So a placeholder written on the LLM's bad day does
 * not merely look unhelpful — it permanently inoculates that story against the nightly job
 * that would have drafted real criteria. An empty array is self-healing; filler is a dead end.
 *
 * The old task→story fallback in `index.js` wrote exactly three such lines, and 213 of 669
 * stories ended up carrying those three and nothing else. The fallback now returns `[]`, and
 * this module stops the same text arriving by any other route — copied off a task that already
 * has it, or emitted by a model given a prompt too thin to answer.
 */

/**
 * Lines that describe "a story" rather than *this* story.
 *
 * The first three are the retired fallback verbatim. The rest are the shapes a model reaches
 * for when the prompt gave it nothing specific. Patterns are anchored so a real criterion that
 * merely mentions dependencies ("Blocked until the Monzo pot mapping lands") survives.
 */
const GENERIC_CRITERIA_PATTERNS = [
  /^define clear .?done.? outcome and validation steps/i,
  /^include success metrics or completion signal/i,
  /^address dependencies and blockers before sign-?off/i,
  /^(the )?(work|task|story) is (marked )?complete\.?$/i,
  /^acceptance criteria (are|to be) (defined|determined|added)/i,
  /^(tbd|tbc|n\/a|none)\.?$/i,
];

/**
 * Drop empty and generic lines. Returns a new array; never null.
 *
 * Callers should treat an empty result as "no criteria yet" and write `[]`, so the nightly
 * job picks the story up — never substitute a placeholder of their own.
 */
function rejectGenericCriteria(criteria) {
  if (!Array.isArray(criteria)) return [];
  return criteria
    .map((line) => String(line == null ? '' : line).trim())
    .filter((line) => line.length > 0)
    .filter((line) => !GENERIC_CRITERIA_PATTERNS.some((pattern) => pattern.test(line)));
}

/** True when every line in the array is generic (or the array is empty). */
function isAllGenericCriteria(criteria) {
  if (!Array.isArray(criteria) || criteria.length === 0) return true;
  return rejectGenericCriteria(criteria).length === 0;
}

module.exports = {
  GENERIC_CRITERIA_PATTERNS,
  rejectGenericCriteria,
  isAllGenericCriteria,
};
