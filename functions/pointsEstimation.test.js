const {
  pointsScale,
  POINTS_MIN,
  POINTS_SOURCE,
  clampPoints,
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
describe('clampPoints', () => {
  test('valid values pass through', () => {
    pointsScale('task').forEach((v) => expect(clampPoints(v)).toBe(v));
  });

  it('snaps off-grid numbers to the nearest 0.25', () => {
    expect(clampPoints(0.3)).toBe(0.25);
    expect(clampPoints(0.4)).toBe(0.5);
    expect(clampPoints(1.1)).toBe(1);
    expect(clampPoints(2.6)).toBe(2.5);
    expect(clampPoints(3.13)).toBe(3.25);
  });

  it('treats 0.25 as the floor — it is TASK_DEFAULT_POINTS, not corruption', () => {
    // 618 of Jim's tasks sit on this value. A clamp that moved it would rewrite his
    // backlog, which is what the previous Fibonacci scale would have done.
    expect(POINTS_MIN).toBe(0.25);
    expect(clampPoints(0.01)).toBe(0.25);
    expect(clampPoints(0.1666)).toBe(0.25);
  });

  it('caps at the ceiling for the kind, and stories may exceed tasks', () => {
    expect(clampPoints(100, 'task')).toBe(8);
    expect(clampPoints(13, 'task')).toBe(8);
    expect(clampPoints(13, 'story')).toBe(13);
    expect(clampPoints(21, 'story')).toBe(13);
  });

  it('accepts numeric strings — models quote things', () => {
    expect(clampPoints('8')).toBe(8);
    expect(clampPoints(' 2.5 ')).toBe(2.5);
  });

  it('rejects unusable output rather than guessing', () => {
    expect(clampPoints('medium')).toBeNull();
    expect(clampPoints('')).toBeNull();
    expect(clampPoints(null)).toBeNull();
    expect(clampPoints(undefined)).toBeNull();
    expect(clampPoints(0)).toBeNull();
    expect(clampPoints(-3)).toBeNull();
    expect(clampPoints(NaN)).toBeNull();
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
    expect(system).toContain('0.25');
    expect(system).toContain('8');
  });

  test('survives an item with nothing but a title', () => {
    const { user } = buildEstimationPrompt({ title: 'Bare' });
    expect(user).toContain('Bare');
  });
});
