import React from 'react';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FocusGoalWizard from './FocusGoalWizard';
import type { Goal, FocusGoal } from '../types';

jest.mock('./KPIDesigner', () => () => null);

const mockHttpsCallable = jest.fn();

jest.mock('firebase/functions', () => ({
  httpsCallable: (...args: any[]) => mockHttpsCallable(...args),
}));

jest.mock('../firebase', () => ({
  functions: {},
}));

describe('FocusGoalWizard integration flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockHttpsCallable.mockImplementation((_functions: any, fnName: string) => {
      if (fnName === 'getIntentBrokerPrompts') {
        return async () => ({
          data: {
            prompts: [
              { id: 'prompt-1', text: 'Default intent prompt' },
            ],
          },
        });
      }
      if (fnName === 'intentBrokerSuggestFocus') {
        return async () => ({
          data: {
            intakeId: 'intake-1',
            matches: [],
            proposals: [],
          },
        });
      }
      return async () => ({ data: {} });
    });
  });

  test('walks vision-first flow and saves story/calendar goal type map', async () => {
    const goals: Goal[] = [
      {
        id: 'goal-1',
        title: 'Build endurance',
        persona: 'personal',
        theme: 1,
        size: 2,
        timeToMasterHours: 20,
        confidence: 2,
        status: 1,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Goal,
      {
        id: 'goal-2',
        title: 'Plan race calendar',
        persona: 'personal',
        theme: 1,
        size: 1,
        timeToMasterHours: 8,
        confidence: 2,
        status: 1,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Goal,
      {
        id: 'goal-3',
        title: 'Build savings pot',
        persona: 'personal',
        theme: 3,
        size: 1,
        timeToMasterHours: 6,
        estimatedCost: 1200,
        costType: 'one_off',
        confidence: 2,
        status: 1,
        ownerUid: 'u1',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Goal,
    ];

    const onSave = jest.fn(async (_focusGoal: FocusGoal) => undefined);

    render(
      <FocusGoalWizard
        show
        onHide={() => undefined}
        goals={goals}
        existingFocusGoals={[]}
        currentUserId="u1"
        onSave={onSave}
      />
    );

    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalledWith({}, 'getIntentBrokerPrompts');
    });

    await userEvent.type(
      screen.getByPlaceholderText('Describe the result you want and why it matters now...'),
      'Improve race readiness this sprint'
    );
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await userEvent.click(screen.getByText('Build endurance'));
    await userEvent.click(screen.getByText('Plan race calendar'));
    await userEvent.click(screen.getByText('Build savings pot'));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    const calendarGoalRow = screen.getByText('Plan race calendar').closest('.list-group-item') as HTMLElement | null;
    expect(calendarGoalRow).not.toBeNull();
    if (calendarGoalRow) {
      await userEvent.click(within(calendarGoalRow).getByLabelText('Calendar-time (events and KPIs only)'));
    }

    const storyGoalRow = screen.getByText('Build endurance').closest('.list-group-item') as HTMLElement | null;
    expect(storyGoalRow).not.toBeNull();
    if (storyGoalRow) {
      await userEvent.click(within(storyGoalRow).getByLabelText('Story-based (will create Sprint story)'));
    }

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByText(/^quarter$/i));
    await userEvent.click(screen.getByRole('button', { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByText(/Story-based goals:/i)).toBeInTheDocument();
      expect(screen.getByText(/Calendar-time goals:/i)).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole('button', { name: /next/i }));
    await userEvent.click(screen.getByRole('button', { name: /save focus goals/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const savedFocusGoal = onSave.mock.calls[0][0] as FocusGoal;

    expect(savedFocusGoal.goalIds).toEqual(expect.arrayContaining(['goal-1', 'goal-2', 'goal-3']));
    expect(savedFocusGoal.timeframe).toBe('quarter');
    expect(savedFocusGoal.goalTypeMap).toMatchObject({
      'goal-1': 'story',
      'goal-2': 'calendar',
      'goal-3': 'story',
    });
  });
});
