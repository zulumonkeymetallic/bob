import { excludeSoftDeleted, isSoftDeleted } from './softDelete';

/**
 * The whole point of this helper is that `deleted: true` had no effect on the web, so every
 * duplicate merged away on iOS stayed on screen. These pin the two ways that could regress:
 * failing to hide a merged item, and over-eagerly hiding a live one.
 */

describe('isSoftDeleted', () => {
  it('hides only an explicit boolean true', () => {
    expect(isSoftDeleted({ deleted: true })).toBe(true);
  });

  it('leaves live documents alone', () => {
    // `deleted` is absent on the overwhelming majority of documents — that is the normal case,
    // not an edge case, and it must never be coerced into "hidden".
    [{}, { deleted: false }, { deleted: undefined }, { deleted: null }, { deleted: 0 }]
      .forEach((doc) => expect(isSoftDeleted(doc)).toBe(false));
  });

  it('does not treat a stringy "false" from an old writer as deleted', () => {
    // Truthiness would hide this. A wrongly hidden live story is worse than a shown dead one:
    // the user cannot find it to fix it.
    expect(isSoftDeleted({ deleted: 'false' })).toBe(false);
  });

  it('survives null and undefined items', () => {
    expect(isSoftDeleted(null)).toBe(false);
    expect(isSoftDeleted(undefined)).toBe(false);
  });
});

describe('excludeSoftDeleted', () => {
  it('drops merged-away duplicates and keeps the survivor', () => {
    // The real shape of the bug: one title present many times, all but one already merged.
    const stories = [
      { id: 'a', title: 'Deep research china', deleted: true },
      { id: 'b', title: 'Deep research china', deleted: true },
      { id: 'c', title: 'Deep research china' },
    ];
    expect(excludeSoftDeleted(stories).map((s) => s.id)).toEqual(['c']);
  });

  it('returns everything when nothing is deleted', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(excludeSoftDeleted(items)).toHaveLength(2);
  });

  it('tolerates an empty or missing list', () => {
    expect(excludeSoftDeleted([])).toEqual([]);
    expect(excludeSoftDeleted(null as any)).toEqual([]);
  });
});
