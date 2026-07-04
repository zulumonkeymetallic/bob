/* eslint-env jest */
const { _internal } = require('./transcriptIngestion');

const {
  resolveGoalIdForCatalog,
  sanitizeAnalysis,
  buildStoryRecords,
  buildTaskRecords,
} = _internal;

const USER_GOALS = [
  { id: 'goal-japan', title: 'Japan trip planning', persona: 'personal' },
  { id: 'goal-servicenow', title: 'ServiceNow certification', persona: 'work' },
];

// buildStoryRecords/buildTaskRecords only touch `db` when a story/task carries a url,
// so a stub is enough as long as none of the fixtures below set one.
const STUB_DB = {};
const EMPTY_ENTITY_CATALOG = { tasks: [], stories: [], all: [] };

function baseStory(overrides = {}) {
  return {
    title: 'Plan Japan trip itinerary',
    description: 'Research flights, hotels, and a rough route',
    priority: 2,
    points: 3,
    acceptanceCriteria: [],
    theme: 'Travel & Adventure',
    goalId: null,
    url: null,
    ...overrides,
  };
}

function baseTask(overrides = {}) {
  return {
    title: 'Book flights to Tokyo',
    description: 'Compare flight prices for the Japan trip',
    priority: 2,
    estimateMin: 60,
    points: 1,
    effort: 'S',
    kind: 'task',
    theme: 'Travel & Adventure',
    goalId: null,
    storyTitle: null,
    dueDateIso: null,
    url: null,
    ...overrides,
  };
}

describe('resolveGoalIdForCatalog', () => {
  test('accepts a goalId present in the catalog', () => {
    expect(resolveGoalIdForCatalog('goal-japan', USER_GOALS)).toBe('goal-japan');
  });

  test('rejects a hallucinated goalId not in the catalog', () => {
    expect(resolveGoalIdForCatalog('goal-does-not-exist', USER_GOALS)).toBeNull();
  });

  test('returns null for empty/missing input', () => {
    expect(resolveGoalIdForCatalog(null, USER_GOALS)).toBeNull();
    expect(resolveGoalIdForCatalog('', USER_GOALS)).toBeNull();
    expect(resolveGoalIdForCatalog(undefined, USER_GOALS)).toBeNull();
  });
});

describe('sanitizeAnalysis goalId passthrough', () => {
  test('preserves a goalId returned by the model', () => {
    const raw = {
      entryType: 'task_list',
      stories: [baseStory({ goalId: 'goal-japan' })],
      tasks: [baseTask({ goalId: 'goal-japan' })],
    };
    const result = sanitizeAnalysis(raw, 'Plan Japan trip, book flights', [], 'Europe/London');
    expect(result.stories[0].goalId).toBe('goal-japan');
    expect(result.tasks[0].goalId).toBe('goal-japan');
  });

  test('defaults to null when the model omits goalId', () => {
    const raw = {
      entryType: 'task_list',
      stories: [baseStory({ goalId: undefined })],
      tasks: [baseTask({ goalId: undefined })],
    };
    const result = sanitizeAnalysis(raw, 'Plan Japan trip, book flights', [], 'Europe/London');
    expect(result.stories[0].goalId).toBeNull();
    expect(result.tasks[0].goalId).toBeNull();
  });
});

describe('buildStoryRecords goal linking', () => {
  const commonArgs = {
    db: STUB_DB,
    uid: 'user-1',
    persona: 'personal',
    fingerprint: 'fp-story-goal',
    existingEntityCatalog: EMPTY_ENTITY_CATALOG,
    userThemes: [],
    userGoals: USER_GOALS,
  };

  test('a story that clearly maps to an existing goal gets goalId set', async () => {
    const analysis = { stories: [baseStory({ goalId: 'goal-japan' })] };
    const { storyRecords } = await buildStoryRecords({ ...commonArgs, analysis });
    expect(storyRecords[0].payload.goalId).toBe('goal-japan');
  });

  test('a story with no goal match gets goalId set to empty string', async () => {
    const analysis = { stories: [baseStory({ goalId: null })] };
    const { storyRecords } = await buildStoryRecords({ ...commonArgs, analysis });
    expect(storyRecords[0].payload.goalId).toBe('');
  });

  test('a hallucinated goalId is rejected back to empty string', async () => {
    const analysis = { stories: [baseStory({ goalId: 'goal-invented-by-model' })] };
    const { storyRecords } = await buildStoryRecords({ ...commonArgs, analysis });
    expect(storyRecords[0].payload.goalId).toBe('');
  });
});

describe('buildTaskRecords goal linking', () => {
  const commonArgs = {
    db: STUB_DB,
    uid: 'user-1',
    persona: 'personal',
    fingerprint: 'fp-task-goal',
    timezone: 'Europe/London',
    storyMap: new Map(),
    existingEntityCatalog: EMPTY_ENTITY_CATALOG,
    userThemes: [],
    userGoals: USER_GOALS,
  };

  test('a task that clearly maps to an existing goal gets goalId, alignedToGoal and hasGoal set', async () => {
    const analysis = { tasks: [baseTask({ goalId: 'goal-japan' })] };
    const { taskRecords } = await buildTaskRecords({ ...commonArgs, analysis });
    expect(taskRecords[0].payload.goalId).toBe('goal-japan');
    expect(taskRecords[0].payload.alignedToGoal).toBe(true);
    expect(taskRecords[0].payload.hasGoal).toBe(true);
  });

  test('a task with no goal match gets goalId null and alignedToGoal/hasGoal false', async () => {
    const analysis = { tasks: [baseTask({ goalId: null })] };
    const { taskRecords } = await buildTaskRecords({ ...commonArgs, analysis });
    expect(taskRecords[0].payload.goalId).toBeNull();
    expect(taskRecords[0].payload.alignedToGoal).toBe(false);
    expect(taskRecords[0].payload.hasGoal).toBe(false);
  });

  test('a hallucinated goalId is rejected back to null with alignedToGoal/hasGoal false', async () => {
    const analysis = { tasks: [baseTask({ goalId: 'goal-invented-by-model' })] };
    const { taskRecords } = await buildTaskRecords({ ...commonArgs, analysis });
    expect(taskRecords[0].payload.goalId).toBeNull();
    expect(taskRecords[0].payload.alignedToGoal).toBe(false);
    expect(taskRecords[0].payload.hasGoal).toBe(false);
  });
});
