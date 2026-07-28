const {
  FIBONACCI_POINTS,
  POINTS_SOURCE,
  clampToFibonacci,
  shouldApplyEstimate,
  provenanceFields,
  buildEstimationPrompt,
} = require('./pointsEstimation');

/**
 * Contract tests, not golden vectors.
 *
 * LLM output cannot be pinned to expected values — that is the whole reason estimation
 * needs a contract in the first place. What *can* be pinned is the boundary: the prompt is
 * deterministic, and anything the model returns is clamped to the scale or rejected. The
 * iOS suite asserts the same rules against the Swift mirror.
 */
describe('clampToFibonacci', () => {
  test('valid values pass through', () => {
    FIBONACCI_POINTS.forEach((v) => expect(clampToFibonacci(v)).toBe(v));
  });

  test('off-scale numbers snap to the nearest valid value', () => {
    expect(clampToFibonacci(4)).toBe(3);   // equidistant 3 vs 5 — first wins, deterministically
    expect(clampToFibonacci(6)).toBe(5);
    expect(clampToFibonacci(7)).toBe(8);
    expect(clampToFibonacci(100)).toBe(21);
    expect(clampToFibonacci(0.4)).toBe(1);
  });

  test('numeric strings are accepted — models quote things', () => {
    expect(clampToFibonacci('8')).toBe(8);
    expect(clampToFibonacci(' 13 ')).toBe(13);
  });

  test('unusable output is rejected, not guessed', () => {
    // An absent estimate is honest. A fabricated one is worse than none.
    expect(clampToFibonacci('medium')).toBeNull();
    expect(clampToFibonacci('')).toBeNull();
    expect(clampToFibonacci(null)).toBeNull();
    expect(clampToFibonacci(undefined)).toBeNull();
    expect(clampToFibonacci(0)).toBeNull();
    expect(clampToFibonacci(-3)).toBeNull();
    expect(clampToFibonacci(NaN)).toBeNull();
  });
});

describe('shouldApplyEstimate', () => {
  test('manual is terminal — neither engine overwrites a human', () => {
    expect(shouldApplyEstimate(POINTS_SOURCE.MANUAL, POINTS_SOURCE.SERVER)).toBe(false);
    expect(shouldApplyEstimate(POINTS_SOURCE.MANUAL, POINTS_SOURCE.DEVICE)).toBe(false);
  });

  test('server replaces a provisional device estimate', () => {
    expect(shouldApplyEstimate(POINTS_SOURCE.DEVICE, POINTS_SOURCE.SERVER)).toBe(true);
  });

  test('device never replaces server', () => {
    // The rule that stops a phone briefly offline from undoing the nightly chain.
    expect(shouldApplyEstimate(POINTS_SOURCE.SERVER, POINTS_SOURCE.DEVICE)).toBe(false);
  });

  test('an unestimated item accepts either engine', () => {
    expect(shouldApplyEstimate(undefined, POINTS_SOURCE.DEVICE)).toBe(true);
    expect(shouldApplyEstimate(null, POINTS_SOURCE.SERVER)).toBe(true);
  });

  test('a human can always take over', () => {
    expect(shouldApplyEstimate(POINTS_SOURCE.SERVER, POINTS_SOURCE.MANUAL)).toBe(true);
  });
});

describe('provenanceFields', () => {
  test('records engine, model and time', () => {
    const at = new Date('2026-07-28T12:00:00Z');
    expect(provenanceFields({ source: POINTS_SOURCE.SERVER, model: 'gemini-2.0-flash', at }))
      .toEqual({
        pointsSource: 'server_llm',
        pointsModel: 'gemini-2.0-flash',
        pointsAt: '2026-07-28T12:00:00.000Z',
      });
  });
});

describe('buildEstimationPrompt', () => {
  test('is deterministic for the same input', () => {
    const input = { title: 'Sand the sauna', acceptanceCriteria: ['No sap remains'], subtaskCount: 2 };
    expect(buildEstimationPrompt(input)).toEqual(buildEstimationPrompt(input));
  });

  test('names every valid value so the model has the scale', () => {
    const { system } = buildEstimationPrompt({ title: 'x' });
    FIBONACCI_POINTS.forEach((v) => expect(system).toContain(String(v)));
  });

  test('survives an item with nothing but a title', () => {
    const { user } = buildEstimationPrompt({ title: 'Bare' });
    expect(user).toContain('Bare');
  });
});
