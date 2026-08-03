const { parsePriorityBonus, effectiveScore } = require('./sprintForwardPlanner');

/**
 * Pins the planner's priority arithmetic.
 *
 * This exists because the numeric branch was inverted in production: a stored `4`
 * (Critical) scored 100 and a stored `1` (Low) scored 500, so the nightly planner gave its
 * largest boost to the least important work every night. The function was not exported, so
 * no test could see it.
 *
 * The canonical numeric scale is 4 = Critical down to 1 = Low. The P-scale is the other way
 * round — P1 is the highest — which is exactly why the old code's `.replace(/^P/, '')` was
 * wrong: it collapsed two opposite scales into one.
 *
 * The iOS half of this is `PlannerScoring` in bob-ios, pinned by PlannerScoringTests.
 * Change a magnitude here and change it there, in the same commit.
 */
describe('parsePriorityBonus', () => {
  test('a bare number is the stored scale: 4 is Critical, 1 is Low', () => {
    expect(parsePriorityBonus(4)).toBe(500);
    expect(parsePriorityBonus(3)).toBe(400);
    expect(parsePriorityBonus(2)).toBe(200);
    expect(parsePriorityBonus(1)).toBe(100);
  });

  test('Critical outranks Low — the regression this file exists for', () => {
    expect(parsePriorityBonus(4)).toBeGreaterThan(parsePriorityBonus(1));
    expect(parsePriorityBonus('4')).toBeGreaterThan(parsePriorityBonus('1'));
  });

  test('the P-scale is inverted against the numeric one and must not be collapsed', () => {
    expect(parsePriorityBonus('P1')).toBe(500);
    expect(parsePriorityBonus('P2')).toBe(400);
    expect(parsePriorityBonus('P3')).toBe(200);
    expect(parsePriorityBonus('P4')).toBe(100);
    // P1 and a bare 1 mean opposite things.
    expect(parsePriorityBonus('P1')).not.toBe(parsePriorityBonus(1));
  });

  test('word forms resolve on either scale', () => {
    expect(parsePriorityBonus('critical')).toBe(500);
    expect(parsePriorityBonus('Urgent')).toBe(500);
    expect(parsePriorityBonus('HIGH')).toBe(400);
    expect(parsePriorityBonus(' medium ')).toBe(200);
    expect(parsePriorityBonus('med')).toBe(200);
    expect(parsePriorityBonus('low')).toBe(100);
  });

  test('absent or unrecognised priority scores nothing', () => {
    expect(parsePriorityBonus(null)).toBe(0);
    expect(parsePriorityBonus(undefined)).toBe(0);
    expect(parsePriorityBonus('')).toBe(0);
    expect(parsePriorityBonus('   ')).toBe(0);
    expect(parsePriorityBonus('banana')).toBe(0);
    expect(parsePriorityBonus(0)).toBe(0);
    expect(parsePriorityBonus(9)).toBe(0);
    expect(parsePriorityBonus(2.5)).toBe(0);
  });
});

describe('effectiveScore', () => {
  test('a Critical item outranks a Low one at equal AI score', () => {
    const critical = effectiveScore({ aiCriticalityScore: 50, priority: 4 });
    const low = effectiveScore({ aiCriticalityScore: 50, priority: 1 });
    expect(critical).toBeGreaterThan(low);
  });

  test('pinning beats everything unpinned', () => {
    const pinned = effectiveScore({ aiCriticalityScore: 0, priority: 0, userPriorityFlag: true });
    const best = effectiveScore({ aiCriticalityScore: 100, priority: 4 });
    expect(pinned).toBeGreaterThan(best);
  });

  test('a manual rank alone counts as pinned', () => {
    const ranked = effectiveScore({ aiCriticalityScore: 0, priority: 0, userPriorityRank: 3 });
    const unranked = effectiveScore({ aiCriticalityScore: 100, priority: 4 });
    expect(ranked).toBeGreaterThan(unranked);
  });

  test('rank 1 leads rank 5 among pinned items', () => {
    const first = effectiveScore({ userPriorityFlag: true, userPriorityRank: 1 });
    const fifth = effectiveScore({ userPriorityFlag: true, userPriorityRank: 5 });
    expect(first).toBeGreaterThan(fifth);
  });

  test('higher scores sort first, so lower-priority work falls to later days', () => {
    const pool = [
      { id: 'low', aiCriticalityScore: 80, priority: 1 },
      { id: 'critical', aiCriticalityScore: 80, priority: 4 },
      { id: 'medium', aiCriticalityScore: 80, priority: 2 },
    ].map((t) => ({ ...t, _score: effectiveScore(t) }));

    // The planner's own comparator.
    const ordered = pool.sort((a, b) => b._score - a._score).map((t) => t.id);
    expect(ordered).toEqual(['critical', 'medium', 'low']);
  });
});
