import { rankSearchRows, visibleForPersona, type SearchRow } from './searchIndex';

const row = (
  title: string,
  overrides: Partial<SearchRow> = {},
): SearchRow => ({ id: title, type: 'task', title, ...overrides });

describe('rankSearchRows', () => {
  const rows: SearchRow[] = [
    row('Book hotel in Beijing (close to tourist attractions and airport)', { ref: 'TK-30027' }),
    row('Rebook the bloodwork', { ref: 'TK-40001' }),
    row('Book', { ref: 'TK-40002' }),
    row('Trim the hedges', { ref: 'TK-9ZVEMS', updatedAt: 200 }),
    row('Garden tidy-up', { ref: 'TK-50003', description: 'Cut back the hedges along the drive' }),
    row('Download bank statements', { ref: 'ST-12345', type: 'story', updatedAt: 100 }),
  ];

  it('finds a fragment anywhere in the title', () => {
    const hits = rankSearchRows(rows, 'hedges').map((x) => x.title);
    expect(hits).toContain('Trim the hedges');
  });

  it('is case-insensitive', () => {
    expect(rankSearchRows(rows, 'HEDGES').length).toBe(rankSearchRows(rows, 'hedges').length);
  });

  it('ranks exact title, then prefix, then word boundary, then mid-word', () => {
    const hits = rankSearchRows(rows, 'book').map((x) => x.title);
    expect(hits[0]).toBe('Book');
    expect(hits[1]).toBe('Book hotel in Beijing (close to tourist attractions and airport)');
    // "Rebook" only contains the letters mid-word, so it sinks below both.
    expect(hits.indexOf('Rebook the bloodwork')).toBeGreaterThan(1);
  });

  it('ranks a title hit above a description-only hit', () => {
    const hits = rankSearchRows(rows, 'hedges').map((x) => x.title);
    expect(hits).toEqual(['Trim the hedges', 'Garden tidy-up']);
  });

  it('matches on the ref, so a pasted TK- id finds the item', () => {
    expect(rankSearchRows(rows, 'TK-9ZVEMS').map((x) => x.title)).toEqual(['Trim the hedges']);
  });

  it('breaks ties on recency, newest first', () => {
    const tied = [
      row('Alpha review', { updatedAt: 100 }),
      row('Alpha planning', { updatedAt: 300 }),
      row('Alpha build', { updatedAt: 200 }),
    ];
    expect(rankSearchRows(tied, 'alpha').map((x) => x.title))
      .toEqual(['Alpha planning', 'Alpha build', 'Alpha review']);
  });

  it('returns nothing rather than everything when there is no match', () => {
    expect(rankSearchRows(rows, 'zzzznope')).toEqual([]);
  });

  it('returns nothing for an empty query — this feeds a dropdown, not a list page', () => {
    expect(rankSearchRows(rows, '   ')).toEqual([]);
  });

  it('does not blow up on regex metacharacters typed into the box', () => {
    expect(() => rankSearchRows(rows, 'c++ (draft)')).not.toThrow();
    expect(rankSearchRows(rows, '[')).toEqual([]);
  });

  it('searches across every entity type in one pass', () => {
    const hits = rankSearchRows(rows, 'bank');
    expect(hits.map((x) => x.type)).toEqual(['story']);
  });
});

describe('visibleForPersona', () => {
  const rows: SearchRow[] = [
    row('Personal thing', { persona: 'personal' }),
    row('Work thing', { persona: 'work' }),
    row('Legacy thing with no persona at all', { persona: null }),
  ];

  it('keeps documents with no persona — most older records have none', () => {
    const titles = visibleForPersona(rows, 'personal').map((x) => x.title);
    expect(titles).toEqual(['Personal thing', 'Legacy thing with no persona at all']);
  });

  it('excludes the other persona', () => {
    expect(visibleForPersona(rows, 'personal').map((x) => x.title)).not.toContain('Work thing');
  });

  it('filters nothing when no persona is set yet', () => {
    expect(visibleForPersona(rows, null)).toHaveLength(3);
  });
});
