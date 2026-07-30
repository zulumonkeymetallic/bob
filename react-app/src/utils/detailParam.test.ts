import { DETAIL_COLLECTIONS, formatDetailParam, parseDetailParam } from './detailParam';

/**
 * `?detail=` is user-facing and shareable, so it will get truncated, hand-edited and pasted
 * back in odd shapes. Every malformed form has to leave the pane closed rather than throw
 * inside an effect that runs on every route.
 */
describe('parseDetailParam', () => {
  it('parses a human-readable ref', () => {
    expect(parseDetailParam('story:ST-12345')).toEqual({ type: 'story', ref: 'ST-12345' });
  });

  it.each(['goal', 'story', 'task'] as const)('accepts the %s type', (type) => {
    expect(parseDetailParam(`${type}:AB-1`)?.type).toBe(type);
  });

  it('accepts a raw Firestore doc id, which older links still use', () => {
    const id = 'ai-test-user-12345abcdef-seed-goal-sidegig-story-0';
    expect(parseDetailParam(`task:${id}`)).toEqual({ type: 'task', ref: id });
  });

  it('splits on the first colon only, so ids containing colons survive', () => {
    expect(parseDetailParam('goal:a:b:c')).toEqual({ type: 'goal', ref: 'a:b:c' });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['no separator', 'storyST-1'],
    ['unknown type', 'sprint:SP-1'],
    ['missing ref', 'story:'],
    ['missing type', ':ST-1'],
    ['whitespace-only ref', 'story:   '],
  ])('rejects %s', (_label, input) => {
    expect(parseDetailParam(input as string | null)).toBeNull();
  });
});

describe('formatDetailParam', () => {
  it('round-trips with the parser', () => {
    const encoded = formatDetailParam('story', 'ST-90228');
    expect(parseDetailParam(encoded)).toEqual({ type: 'story', ref: 'ST-90228' });
  });
});

describe('DETAIL_COLLECTIONS', () => {
  it('maps every type to its Firestore collection', () => {
    // A wrong plural here silently resolves nothing and the pane just never opens.
    expect(DETAIL_COLLECTIONS).toEqual({ goal: 'goals', story: 'stories', task: 'tasks' });
  });
});
