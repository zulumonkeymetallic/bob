import React, { Profiler, act } from 'react';
import { render, cleanup } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import RoadmapV2 from '../RoadmapV2';
import { Goal, Sprint, Story } from '../../../types';
import { useRoadmapStore } from '../../../stores/roadmapStore';

const runPerfSuite = process.env.ROADMAP_PROFILE === '1';

if (typeof (global as any).ResizeObserver === 'undefined') {
  (global as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

beforeEach(() => {
  useRoadmapStore.setState({
    start: new Date(new Date().getFullYear() - 1, 0, 1),
    end: new Date(new Date().getFullYear() + 2, 11, 31),
    zoom: 'quarter',
    width: 1200,
    laneCollapse: {},
  });

  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    configurable: true,
    value: () => {},
  });
});

afterEach(() => {
  cleanup();
});

const DAY = 24 * 60 * 60 * 1000;

const sampleGoals = (count: number, themes = [0,1,2,3,4,5,6,7,8,9]): Goal[] => {
  const now = Date.now();
  return Array.from({ length: count }, (_, idx) => {
    const theme = themes[idx % themes.length];
    const start = now + idx * 3 * DAY;
    const end = start + (5 + (idx % 4)) * DAY;
    return {
      id: `goal-${idx}`,
      persona: 'personal',
      title: `Goal ${idx}`,
      description: `Generated goal ${idx}`,
      theme,
      size: 2,
      timeToMasterHours: 40,
      targetDate: new Date(end).toISOString(),
      startDate: start,
      endDate: end,
      confidence: 2,
      status: idx % 3,
      ownerUid: 'user-1',
      createdAt: now,
      updatedAt: now,
      priority: (idx % 3) + 1,
    } as Goal;
  });
};

const sampleSprints = (): Sprint[] => {
  const base = new Date().setHours(0,0,0,0);
  return Array.from({ length: 4 }, (_, idx) => {
    const start = base + idx * 14 * DAY;
    const end = start + 14 * DAY;
    return {
      id: `sprint-${idx}`,
      ref: `S-${idx}`,
      name: `Sprint ${idx + 1}`,
      status: idx === 2 ? 1 : idx > 2 ? 2 : 0,
      startDate: start,
      endDate: end,
      planningDate: start - 3 * DAY,
      retroDate: end + 2 * DAY,
      ownerUid: 'user-1',
      createdAt: base,
      updatedAt: base,
    } as Sprint;
  });
};

const sampleStories = (goals: Goal[], perGoal = 3): Story[] => {
  const now = Date.now();
  return goals.flatMap((goal, goalIdx) => (
    Array.from({ length: perGoal }, (_, idx) => ({
      id: `story-${goalIdx}-${idx}`,
      ref: `ST-${goalIdx}-${idx}`,
      persona: 'personal',
      title: `Story ${goalIdx}-${idx}`,
      goalId: goal.id,
      status: idx % 5,
      priority: (idx % 3) + 1,
      points: 3,
      wipLimit: 1,
      orderIndex: idx,
      ownerUid: 'user-1',
      createdAt: now,
      updatedAt: now,
      sprintId: idx % 2 === 0 ? 'sprint-1' : 'sprint-2',
    } as Story))
  ));
};

const noop = () => {};

const renderSample = async (goalCount: number) => {
  const goals = sampleGoals(goalCount);
  const stories = sampleStories(goals);
  const sprints = sampleSprints();
  const storiesByGoal = stories.reduce<Record<string, number>>((acc, story) => {
    acc[story.goalId] = (acc[story.goalId] || 0) + 1;
    return acc;
  }, {});
  const doneStoriesByGoal = stories.reduce<Record<string, number>>((acc, story) => {
    acc[story.goalId] = (acc[story.goalId] || 0) + (story.status >= 4 ? 1 : 0);
    return acc;
  }, {});

  const measurements: number[] = [];

  await act(async () => {
    render(
      <DndContext>
        <Profiler id="RoadmapV2" onRender={(_, __, actualDuration) => measurements.push(actualDuration)}>
          <RoadmapV2
            goals={goals}
            sprints={sprints}
            stories={stories}
            storiesByGoal={storiesByGoal}
            doneStoriesByGoal={doneStoriesByGoal}
            onItemClick={noop}
            updateGoalDates={noop}
            handleGenerateStories={noop}
            setSelectedGoalId={noop}
            setActivityGoalId={noop}
            setNoteGoalId={noop}
            setNoteDraft={noop}
            setEditGoal={noop}
            onDeleteGoal={noop}
            openGlobalActivity={noop}
            onWheel={noop as any}
            onMouseDown={noop as any}
            onTouchStart={noop as any}
            onTouchMove={noop as any}
            onTouchEnd={noop as any}
            onSwitchToRoadmap={noop}
            selectedSprintId={'sprint-1'}
          />
        </Profiler>
      </DndContext>
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return measurements;
};

(runPerfSuite ? test : test.skip)('profile RoadmapV2 render cost', async () => {
  const durations: number[] = [];
  const goalCount = Number(process.env.ROADMAP_PROFILE_GOALS ?? '24');
  durations.push(...await renderSample(goalCount));
  expect(durations.length).toBeGreaterThan(0);
  const total = durations.reduce((sum, value) => sum + value, 0);
  const avg = total / durations.length;
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ goalCount, phaseDurations: durations, total, avg }));
});
