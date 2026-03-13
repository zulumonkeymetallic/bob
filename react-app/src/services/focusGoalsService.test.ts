import { autoCreateSavinsPots, autoCreateStoriesForGoals } from './focusGoalsService';
import type { Goal } from '../types';

jest.mock('../firebase', () => ({
  db: {},
  functions: {},
}));

var mockWhere: jest.Mock;
var mockQuery: jest.Mock;
var mockCollection: jest.Mock;
var mockGetDocs: jest.Mock;

jest.mock('firebase/firestore', () => ({
  collection: (...parts: any[]) => {
    if (!mockCollection) {
      mockCollection = jest.fn((...args: any[]) => ({ parts: args }));
    }
    return mockCollection(...parts);
  },
  addDoc: jest.fn(),
  serverTimestamp: jest.fn(() => ({ _serverTimestamp: true })),
  query: (...parts: any[]) => {
    if (!mockQuery) {
      mockQuery = jest.fn((...args: any[]) => ({ parts: args }));
    }
    return mockQuery(...parts);
  },
  where: (field: string, op: string, value: unknown) => {
    if (!mockWhere) {
      mockWhere = jest.fn((f: string, o: string, v: unknown) => {
        if (v === undefined) {
          throw new Error(`where() received undefined for ${f}`);
        }
        return { field: f, op: o, value: v };
      });
    }
    return mockWhere(field, op, value);
  },
  getDocs: (queryValue: any) => {
    if (!mockGetDocs) {
      mockGetDocs = jest.fn();
    }
    return mockGetDocs(queryValue);
  },
  updateDoc: jest.fn(),
  doc: jest.fn(),
  writeBatch: jest.fn(() => ({ update: jest.fn(), commit: jest.fn() })),
  deleteField: jest.fn(() => ({ _deleteField: true })),
}));

jest.mock('firebase/functions', () => ({
  httpsCallable: jest.fn(() => jest.fn(async () => ({ data: { potId: 'pot-1' } }))),
}));

describe('focusGoalsService guards undefined values in Firestore queries', () => {
  beforeEach(() => {
    mockCollection = jest.fn((...args: any[]) => ({ parts: args }));
    mockQuery = jest.fn((...args: any[]) => ({ parts: args }));
    mockWhere = jest.fn((field: string, op: string, value: unknown) => {
      if (value === undefined) {
        throw new Error(`where() received undefined for ${field}`);
      }
      return { field, op, value };
    });
    mockGetDocs = jest.fn();
    jest.clearAllMocks();
  });

  test('autoCreateStoriesForGoals filters missing goals and never calls where with undefined', async () => {
    const goalDoc = {
      id: 'goal-1',
      data: () => ({
        title: 'Valid goal',
        persona: 'personal',
        ownerUid: 'u1',
      }),
    };

    mockGetDocs
      .mockResolvedValueOnce({ docs: [goalDoc] })
      .mockResolvedValueOnce({ docs: [] })
      .mockResolvedValueOnce({ docs: [{ id: 'existing-story' }], size: 1 });

    const result = await autoCreateStoriesForGoals(['goal-1', '' as any, 'missing-goal' as any], 'u1');

    expect(result).toEqual([]);
    expect(mockWhere).toHaveBeenCalled();
    expect(mockWhere.mock.calls.every(([, , value]) => value !== undefined)).toBe(true);
  });

  test('autoCreateSavinsPots skips goals without id and does not issue Firestore query', async () => {
    const invalidGoal = {
      id: undefined,
      title: 'No ID',
      persona: 'personal',
      ownerUid: 'u1',
      theme: 1,
      size: 1,
      timeToMasterHours: 1,
      confidence: 1,
      status: 0,
      estimatedCost: 200,
      costType: 'one_off',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Goal;

    const created = await autoCreateSavinsPots([invalidGoal], 'u1');

    expect(created).toEqual({});
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(mockWhere).not.toHaveBeenCalledWith('__name__', '==', undefined);
  });
});
