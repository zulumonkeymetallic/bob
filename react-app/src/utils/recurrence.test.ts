import { nextDueAt, makePlanId, makeAssignmentId, toDayKey } from './recurrence';

describe('recurrence utils', () => {
  test('computes next due for daily rule', () => {
    const now = new Date('2025-09-13T08:00:00Z').getTime();
    const dtstart = new Date('2025-09-10T07:00:00Z').getTime();
    const rrule = 'RRULE:FREQ=DAILY;INTERVAL=1';
    const next = nextDueAt(rrule, dtstart, now);
    expect(next).toBeGreaterThan(now - 1);
  });

  test('deterministic ids', () => {
    const userId = 'u123';
    const date = new Date('2025-09-13');
    const planId = makePlanId(userId, date);
    expect(planId).toBe('20250913-u123');

    const a1 = makeAssignmentId({ planId, itemType: 'task', itemId: 't1' });
    const a2 = makeAssignmentId({ planId, itemType: 'task', itemId: 't1' });
    expect(a1).toBe(a2);
  });

  test('toDayKey', () => {
    expect(toDayKey(new Date('2025-01-05'))).toBe('20250105');
  });
});

