import { normalizePlannerSchedulingError } from './plannerScheduling';

jest.mock('../firebase', () => ({
  functions: {},
}));

describe('normalizePlannerSchedulingError', () => {
  test('maps raw internal callable failures to a user-facing planner explanation', () => {
    const result = normalizePlannerSchedulingError({
      code: 'functions/failed-precondition',
      message: 'internal',
    });

    expect(result.code).toBe('failed-precondition');
    expect(result.message.toLowerCase()).toContain('planner could not place this item automatically');
  });

  test('preserves actionable backend messages when they are provided', () => {
    const result = normalizePlannerSchedulingError({
      code: 'functions/failed-precondition',
      message: 'No feasible slot was available without conflicting with current calendar constraints.',
    });

    expect(result.message).toBe('No feasible slot was available without conflicting with current calendar constraints.');
  });
});
