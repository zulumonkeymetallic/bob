const { DateTime } = require('luxon');
const { findGap, STEPS_PER_MINUTE, MIN_DEFICIT_STEPS } = require('./eveningCheckpoint');

const TZ = 'Europe/London';
const at = (hhmm) => DateTime.fromISO(`2026-08-05T${hhmm}:00`, { zone: TZ });
const block = (from, to) => ({ start: at(from).toMillis(), end: at(to).toMillis() });

describe('findGap', () => {
  it('takes the earliest opening when the evening is clear', () => {
    const slot = findGap([], at('18:00'), at('21:00'), 30);
    expect(slot?.toFormat('HH:mm')).toBe('18:00');
  });

  it('starts after a block that is already in the way', () => {
    const slot = findGap([block('18:00', '19:00')], at('18:00'), at('21:00'), 30);
    expect(slot?.toFormat('HH:mm')).toBe('19:00');
  });

  it('finds a gap between two commitments', () => {
    const busy = [block('18:00', '18:30'), block('19:30', '21:00')];
    const slot = findGap(busy, at('18:00'), at('21:00'), 45);
    expect(slot?.toFormat('HH:mm')).toBe('18:30');
  });

  it('rejects a gap that is too short rather than squeezing in', () => {
    const busy = [block('18:00', '18:30'), block('19:00', '21:00')];
    // Thirty minutes free, sixty needed.
    expect(findGap(busy, at('18:00'), at('21:00'), 60)).toBeNull();
  });

  it('returns null when the evening is fully committed', () => {
    expect(findGap([block('18:00', '21:00')], at('18:00'), at('21:00'), 20)).toBeNull();
  });

  it('does not run past the cut-off', () => {
    // Free from 20:45, but 30 minutes would end at 21:15.
    const slot = findGap([block('18:00', '20:45')], at('18:00'), at('21:00'), 30);
    expect(slot).toBeNull();
  });

  it('ignores blocks that ended before the window opened', () => {
    const slot = findGap([block('12:00', '13:00')], at('18:00'), at('21:00'), 30);
    expect(slot?.toFormat('HH:mm')).toBe('18:00');
  });
});

describe('walk sizing', () => {
  // The duration is derived, so the derivation is worth pinning: a deficit is minutes at
  // an ordinary cadence, not a fixed-length walk.
  const minutesFor = (deficit) => Math.min(75, Math.max(10, Math.round(deficit / STEPS_PER_MINUTE)));

  it('sizes the walk to the gap', () => {
    expect(minutesFor(3000)).toBe(30);
    expect(minutesFor(4500)).toBe(45);
  });

  it('caps a large deficit rather than prescribing a route march', () => {
    // 11,000 short at 100/min is 110 minutes; nobody walks that at nine at night.
    expect(minutesFor(11000)).toBe(75);
  });

  it('keeps a small walk worth leaving the house for', () => {
    expect(minutesFor(1600)).toBe(16);
  });

  it('treats anything under the floor as noise, not a deficit', () => {
    expect(MIN_DEFICIT_STEPS).toBeGreaterThan(0);
    expect(1200).toBeLessThan(MIN_DEFICIT_STEPS);
  });
});
