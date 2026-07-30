const { computeCriticalityScore, normaliseThemeId } = require('./scoring');
const suite = require('./scoringVectors.json');

/**
 * The server half of the shared golden vectors.
 *
 * `scoringVectors.json` is vendored from bob-ios/BOBTests/ScoringVectors.json and the two
 * copies must stay byte-identical — that is the whole point. The iOS suite
 * (BOBTests/ScoringVectorTests.swift) runs the same cases against
 * WorkItemScoring.criticalityScore, so a change to either implementation that is not
 * mirrored in the other turns one of the two builds red.
 *
 * `Date.now` is stubbed because the scorer reads the clock internally; the vectors pin
 * `nowMs` so results are deterministic.
 */
describe('computeCriticalityScore — shared golden vectors', () => {
  const realNow = Date.now;
  beforeAll(() => { Date.now = () => suite.nowMs; });
  afterAll(() => { Date.now = realNow; });

  test('the vector file is present and populated', () => {
    expect(Array.isArray(suite.vectors)).toBe(true);
    expect(suite.vectors.length).toBeGreaterThan(20);
  });

  test.each(suite.vectors.map((v) => [v.name, v]))('%s', (_name, v) => {
    expect(computeCriticalityScore(v.input)).toBe(v.expected);
  });
});

describe('normaliseThemeId', () => {
  // Firestore holds `theme` as both an id and a name. Reading only one of them is what
  // made the server and the phone score the same story ten points apart, in opposite
  // directions, on roughly two thirds of themed stories.
  test('accepts canonical ids', () => {
    expect(normaliseThemeId(1)).toBe(1);
    expect(normaliseThemeId(6)).toBe(6);
  });

  test('accepts display names', () => {
    expect(normaliseThemeId('Health & Fitness')).toBe(1);
    expect(normaliseThemeId('Hobbies & Interests')).toBe(6);
    expect(normaliseThemeId('Work (Main Gig)')).toBe(12);
  });

  test('accepts legacy fragments and numeric strings', () => {
    expect(normaliseThemeId('Growth')).toBe(9);
    expect(normaliseThemeId('3')).toBe(3);
  });

  test('absent stays absent', () => {
    // Must not collapse to 0 — theme 0 (General) is a real theme and scores differently
    // from having no theme at all.
    expect(normaliseThemeId(null)).toBeNull();
    expect(normaliseThemeId('')).toBeNull();
    expect(normaliseThemeId('not a theme')).toBeNull();
  });
});
