import { rankGoals, type GoalOption } from './goalPickerCache';

const g = (title: string, ref?: string): GoalOption => ({ id: title, title, ref });

describe('rankGoals', () => {
  const goals: GoalOption[] = [
    g('Improve CTA conversion', 'GR-11111'),
    g('Rebuild the home office', 'GR-22222'),
    g('CTA experiments backlog', 'GR-33333'),
    g('Punctate lesion research', 'GR-44444'),
    g('Get to 12% body fat', 'GR-55555'),
  ];

  it('finds a fragment anywhere in the title', () => {
    // The complaint that prompted this: "cta" has to find "Improve CTA conversion". A native
    // <datalist> left matching to the browser, and the value it produced then had to EXACTLY
    // equal a goal title before the form resolved it to an id.
    const hits = rankGoals(goals, 'cta').map((x) => x.title);
    expect(hits).toContain('Improve CTA conversion');
    expect(hits).toContain('CTA experiments backlog');
  });

  it('is case-insensitive', () => {
    expect(rankGoals(goals, 'CTA').length).toBe(rankGoals(goals, 'cta').length);
  });

  it('ranks a prefix above a word-boundary hit above a mid-word one', () => {
    const hits = rankGoals(goals, 'cta').map((x) => x.title);
    // "CTA experiments" starts with it; "Improve CTA conversion" has it on a word boundary;
    // "Punctate" only contains the letters mid-word.
    expect(hits[0]).toBe('CTA experiments backlog');
    expect(hits[1]).toBe('Improve CTA conversion');
    expect(hits.indexOf('Punctate lesion research')).toBeGreaterThan(1);
  });

  it('matches on the ref, so a pasted GR- id finds the goal', () => {
    expect(rankGoals(goals, 'GR-22222').map((x) => x.title)).toEqual(['Rebuild the home office']);
  });

  it('returns everything, alphabetically, for an empty query', () => {
    const all = rankGoals(goals, '   ');
    expect(all).toHaveLength(goals.length);
    expect(all[0].title).toBe('CTA experiments backlog');
  });

  it('returns nothing rather than everything when there is no match', () => {
    expect(rankGoals(goals, 'zzzznope')).toEqual([]);
  });

  it('does not blow up on regex metacharacters typed into the box', () => {
    // The word-boundary test builds a RegExp from the query; an unescaped "(" threw.
    expect(() => rankGoals(goals, 'body fat (2026)')).not.toThrow();
    expect(() => rankGoals(goals, '*')).not.toThrow();
    expect(rankGoals([g('Get to 12% body fat (2026)')], '(2026)')).toHaveLength(1);
  });

  it('does not mutate the list it was given', () => {
    const original = [...goals];
    rankGoals(goals, '');
    expect(goals).toEqual(original);
  });
});
