import {
  SIX_MONTHS_MS,
  proposeRealignments,
  sprintLabelFor,
  targetSprintForGoal,
  type RealignSprint,
  type RealignStory,
} from './goalStoryRealignment';

const day = 24 * 60 * 60 * 1000;
const base = new Date(2026, 5, 1).getTime();   // 1 Jun 2026

const sprints: RealignSprint[] = [
  { id: 's1', name: 'S1', startDate: base, persona: 'personal' },
  { id: 's2', name: 'S2', startDate: base + 14 * day, persona: 'personal' },
  { id: 's3', name: 'S3', startDate: base + 28 * day, persona: 'personal' },
  { id: 'w1', name: 'Work 2026', startDate: base + 3 * day, persona: 'work' },
];

const isDone = (s: unknown) => Number(s) >= 4;
const story = (over: Partial<RealignStory> = {}): RealignStory =>
  ({ id: 'st1', title: 'A story', persona: 'personal', status: 1, sprintId: null, ...over });

describe('targetSprintForGoal', () => {
  it('picks the sprint starting nearest the goal', () => {
    expect(targetSprintForGoal(base + 13 * day, 'personal', sprints)).toBe('s2');
    expect(targetSprintForGoal(base + 1 * day, 'personal', sprints)).toBe('s1');
  });

  it('never crosses persona', () => {
    // w1 starts 3 days from base and is by far the nearest, but a personal story must not land
    // in the Work sprint — the exact bug the server-side rule carries a comment about.
    expect(targetSprintForGoal(base + 3 * day, 'personal', sprints)).toBe('s1');
    expect(targetSprintForGoal(base + 3 * day, 'work', sprints)).toBe('w1');
  });

  it('falls back to the backlog beyond six months', () => {
    // 400 days out, and the nearest sprint (s3, base+28d) is 372 days away — well past the
    // window. 200 days would NOT qualify: s3 is only 172 days from it, still inside six months.
    expect(targetSprintForGoal(base + 400 * day, 'personal', sprints)).toBeNull();
    expect(targetSprintForGoal(base + 200 * day, 'personal', sprints)).toBe('s3');
  });

  it('includes the boundary itself, matching the server rule’s <=', () => {
    const one: RealignSprint[] = [{ id: 'only', startDate: base, persona: 'personal' }];
    expect(targetSprintForGoal(base + SIX_MONTHS_MS, 'personal', one)).toBe('only');
    expect(targetSprintForGoal(base + SIX_MONTHS_MS + 1, 'personal', one)).toBeNull();
  });

  it('returns the backlog for a goal with no start date', () => {
    expect(targetSprintForGoal(null, 'personal', sprints)).toBeNull();
  });

  it('ignores sprints with no usable start date', () => {
    expect(targetSprintForGoal(base, 'personal', [{ id: 'x', persona: 'personal' }])).toBeNull();
  });

  it('accepts the several date shapes Firestore returns', () => {
    const iso: RealignSprint[] = [{ id: 'i', startDate: new Date(base).toISOString(), persona: 'personal' }];
    const ts: RealignSprint[] = [{ id: 't', startDate: { toMillis: () => base } as any, persona: 'personal' }];
    expect(targetSprintForGoal(base, 'personal', iso)).toBe('i');
    expect(targetSprintForGoal(base, 'personal', ts)).toBe('t');
  });
});

describe('proposeRealignments', () => {
  it('proposes only the stories that would actually change sprint', () => {
    const stories = [
      story({ id: 'a', sprintId: 's1' }),          // would move to s2
      story({ id: 'b', sprintId: 's2' }),          // already there — no proposal
    ];
    const out = proposeRealignments(base + 13 * day, stories, sprints, isDone);
    expect(out.map((p) => p.story.id)).toEqual(['a']);
    expect(out[0].fromLabel).toBe('S1');
    expect(out[0].toLabel).toBe('S2');
  });

  it('leaves finished work alone', () => {
    const out = proposeRealignments(base + 13 * day, [story({ status: 4, sprintId: 's1' })], sprints, isDone);
    expect(out).toEqual([]);
  });

  it('respects sprintAlignmentOverride — the user already said leave it', () => {
    // Re-asking every time the goal nudges is how a helpful prompt becomes noise, and it is
    // the same flag the overnight job checks.
    const out = proposeRealignments(
      base + 13 * day,
      [story({ sprintId: 's1', sprintAlignmentOverride: true })],
      sprints, isDone,
    );
    expect(out).toEqual([]);
  });

  it('proposes a move to the backlog when the goal lands out of range', () => {
    const out = proposeRealignments(base + 400 * day, [story({ sprintId: 's1' })], sprints, isDone);
    expect(out).toHaveLength(1);
    expect(out[0].toSprintId).toBeNull();
    expect(out[0].toLabel).toBe('Backlog');
  });

  it('proposes nothing when there is nothing to move', () => {
    expect(proposeRealignments(base, [], sprints, isDone)).toEqual([]);
  });
});

describe('sprintLabelFor', () => {
  it('names the sprint, or calls it Backlog', () => {
    expect(sprintLabelFor('s2', sprints)).toBe('S2');
    expect(sprintLabelFor(null, sprints)).toBe('Backlog');
    expect(sprintLabelFor('gone', sprints)).toBe('Sprint');
  });
});
