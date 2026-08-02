import {
  normalizePlannerLevel,
  normalizePlannerDetail,
  parsePlannerSearch,
  buildPlannerPath,
  DEFAULT_ROADMAP_DETAIL,
  ROADMAP_DETAIL_PARAM,
} from './plannerRoutes';

describe('normalizePlannerDetail', () => {
  it('accepts every detail level the roadmap offers', () => {
    ['year', 'quarter', 'sprint', 'week'].forEach((d) => {
      expect(normalizePlannerDetail(d)).toBe(d);
    });
  });

  it('is case- and whitespace-insensitive, for hand-typed links', () => {
    expect(normalizePlannerDetail('Quarter')).toBe('quarter');
    expect(normalizePlannerDetail(' WEEK ')).toBe('week');
  });

  it('falls back to quarter rather than rendering nothing', () => {
    expect(normalizePlannerDetail(null)).toBe(DEFAULT_ROADMAP_DETAIL);
    expect(normalizePlannerDetail('')).toBe(DEFAULT_ROADMAP_DETAIL);
    expect(normalizePlannerDetail('month')).toBe(DEFAULT_ROADMAP_DETAIL);
  });
});

describe('parsePlannerSearch', () => {
  it('reads an ordinary query string', () => {
    const p = parsePlannerSearch('?level=roadmap&detailLevel=week');
    expect(p.get('level')).toBe('roadmap');
    expect(p.get('detailLevel')).toBe('week');
  });

  it('repairs the ?a=1?b=2 form', () => {
    // Without the repair this is ONE param, level="roadmap?detailLevel=week", which
    // normalizePlannerLevel rejects — so the link silently opened the calendar.
    const p = parsePlannerSearch('?level=roadmap?detailLevel=week');
    expect(p.get('level')).toBe('roadmap');
    expect(p.get('detailLevel')).toBe('week');
    expect(normalizePlannerLevel(p.get('level'))).toBe('roadmap');
  });

  it('repairs a chain of them', () => {
    const p = parsePlannerSearch('?level=roadmap?detailLevel=sprint?embed=1');
    expect(p.get('detailLevel')).toBe('sprint');
    expect(p.get('embed')).toBe('1');
  });

  it('works with or without the leading ?, and on nothing at all', () => {
    expect(parsePlannerSearch('level=gantt').get('level')).toBe('gantt');
    expect([...parsePlannerSearch('').keys()]).toEqual([]);
    expect([...parsePlannerSearch(null).keys()]).toEqual([]);
  });
});

describe('detail level round-trips through the URL', () => {
  it('survives buildPlannerPath, which is what the toolbar buttons write', () => {
    const params = parsePlannerSearch('?level=roadmap&detailLevel=quarter');
    params.set(ROADMAP_DETAIL_PARAM, 'week');
    const path = buildPlannerPath('roadmap', params);
    expect(normalizePlannerDetail(parsePlannerSearch(path.split('?')[1]).get(ROADMAP_DETAIL_PARAM)))
      .toBe('week');
  });

  it('does not use `detail`, which the entity detail pane owns', () => {
    // useDetailPaneUrlSync parses `detail` as `<type>:<ref>` and deletes anything else, so a
    // roadmap level stored there disappeared on first render. Guards the regression.
    expect(ROADMAP_DETAIL_PARAM).not.toBe('detail');
  });
});
