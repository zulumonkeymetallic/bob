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

  test('maps missing callable and CORS-style failures to a deploy hint', () => {
    const result = normalizePlannerSchedulingError({
      code: 'functions/not-found',
      message: 'Fetch API cannot load the endpoint due to access control checks.',
    });

    expect(result.code).toBe('not-found');
    expect(result.message).toContain('schedulePlannerItem function has not been deployed yet');
  });
});
