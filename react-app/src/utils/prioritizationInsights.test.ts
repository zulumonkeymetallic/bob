import { buildSprintDeferRecommendations } from './prioritizationInsights';
import type { Goal, Story, Task } from '../types';

describe('buildSprintDeferRecommendations', () => {
  test('prefers non-focus, low-score work for deferral when sprint is over capacity', () => {
    const goals: Goal[] = [
      {
        id: 'goal-focus',
        title: 'Focus goal',
        persona: 'personal',
        theme: 1,
        size: 1,
        timeToMasterHours: 10,
        confidence: 2,
        status: 1,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Goal,
      {
        id: 'goal-side',
        title: 'Side quest',
        persona: 'personal',
        theme: 2,
        size: 1,
        timeToMasterHours: 10,
        confidence: 2,
        status: 1,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Goal,
    ];

    const stories: Story[] = [
      {
        id: 'story-focus',
        ref: 'ST-1',
        persona: 'personal',
        title: 'Aligned focus story',
        goalId: 'goal-focus',
        status: 1,
        priority: 4,
        points: 5,
        wipLimit: 3,
        sprintId: 'sprint-1',
        orderIndex: 1,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
        aiCriticalityScore: 92,
      } as Story,
      {
        id: 'story-side',
        ref: 'ST-2',
        persona: 'personal',
        title: 'Non-focus side story',
        goalId: 'goal-side',
        status: 1,
        priority: 1,
        points: 3,
        wipLimit: 3,
        sprintId: 'sprint-1',
        orderIndex: 2,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
        aiCriticalityScore: 12,
      } as Story,
    ];

    const tasks: Task[] = [
      {
        id: 'task-side',
        ref: 'TA-1',
        persona: 'personal',
        parentType: 'project',
        parentId: 'proj-1',
        title: 'Standalone side task',
        status: 0,
        priority: 1,
        effort: 'M',
        estimateMin: 120,
        source: 'web',
        aiLinkConfidence: 0,
        hasGoal: true,
        syncState: 'clean',
        serverUpdatedAt: Date.now(),
        createdBy: 'test',
        ownerUid: 'u1',
        sprintId: 'sprint-1',
        goalId: 'goal-side',
        aiCriticalityScore: 8,
      } as Task,
    ];

    const result = buildSprintDeferRecommendations({
      goals,
      stories,
      tasks,
      activeFocusGoalIds: new Set(['goal-focus']),
      selectedSprintId: 'sprint-1',
      nextSprint: { id: 'sprint-2', name: 'Sprint 2', startDate: Date.now() + 86400000 },
      capacitySummary: { total: 8, allocated: 14 },
    });

    expect(result.overCapacityHours).toBe(6);
    expect(result.recommended.slice(0, 2).map((item) => item.title)).toEqual(
      expect.arrayContaining(['Standalone side task', 'Non-focus side story']),
    );
    expect(result.recommended.some((item) => item.title === 'Aligned focus story')).toBe(false);
  });
});
