import {
  normaliseTheme,
  normaliseSize,
  normaliseConfidence,
  normaliseGoalStatus,
  normaliseTaskStatus,
  normaliseStoryStatus,
  normaliseEffort,
  normalisePriority,
  normaliseDateMs,
  buildGoalDoc,
  buildStoryDoc,
  buildTaskDoc,
  rowHasTitle,
} from './importNormalise';

const CTX = { ownerUid: 'uid-1', persona: 'personal' as const };

/**
 * These cases are the actual defects the previous importer shipped, not hypotheticals: it
 * wrote string statuses and themes into numeric fields, put a 0-1 probability on a 1-3 scale,
 * omitted `ref` and `persona` entirely, and treated every row as a goal.
 */
describe('the shapes the old importer got wrong', () => {
  it('turns a theme NAME into the numeric id, not a string', () => {
    // The shipped CSV template says "Health"; the real theme is "Health & Fitness".
    expect(normaliseTheme('Health').theme).toBe(1);
    expect(normaliseTheme('Finance & Wealth').theme).toBe(3);
    expect(typeof normaliseTheme('Health').theme).toBe('number');
  });

  it('accepts a numeric theme id unchanged', () => {
    expect(normaliseTheme(6)).toEqual({ theme: 6 });
  });

  it('warns rather than silently misfiling an unknown theme', () => {
    const r = normaliseTheme('Underwater Basketweaving');
    expect(r.theme).toBe(0);
    expect(r.warning).toMatch(/not recognised/);
  });

  it('reads a 0-1 confidence as a probability instead of storing 0.7 on a 1-3 scale', () => {
    const r = normaliseConfidence(0.7);
    expect(r.confidence).toBe(3);
    expect(r.warning).toMatch(/0-1 probability/);
    expect(normaliseConfidence(0.2).confidence).toBe(1);
    expect(normaliseConfidence(0.5).confidence).toBe(2);
  });

  it("maps the old 'active' goal status onto the numeric scale", () => {
    expect(normaliseGoalStatus('active').status).toBe(1);
    expect(normaliseGoalStatus('complete').status).toBe(2);
    expect(normaliseGoalStatus(4).status).toBe(4);
  });

  it('gives every built doc a ref and a persona', () => {
    const g = buildGoalDoc({ title: 'G' }, CTX).doc;
    const s = buildStoryDoc({ title: 'S' }, CTX).doc;
    const t = buildTaskDoc({ title: 'T' }, CTX).doc;
    expect(g.ref).toMatch(/^GR-\d{5}$/);
    expect(s.ref).toMatch(/^ST-\d{5}$/);
    expect(t.ref).toMatch(/^TK-\d{5}$/);
    // A task without persona is invisible to the Personal/Work filter.
    expect([g.persona, s.persona, t.persona]).toEqual(['personal', 'personal', 'personal']);
  });

  it('writes effort as a letter, not the number the old backend used', () => {
    expect(buildTaskDoc({ title: 'T', effort: 1 }, CTX).doc.effort).toBe('S');
    expect(normaliseEffort('Large').effort).toBe('L');
    expect(normaliseEffort(2).effort).toBe('M');
  });
});

describe('status scales stay separate', () => {
  it('never writes a legacy in-progress value onto a story', () => {
    // 2 and 3 exist on old story docs but must never be written back.
    expect(normaliseStoryStatus(2).status).toBe(1);
    expect(normaliseStoryStatus(3).status).toBe(1);
    expect(normaliseStoryStatus('done').status).toBe(4);
    expect(normaliseStoryStatus(0).status).toBe(0);
  });

  it('closes a task on 2 but an equivalent story on 4', () => {
    // Conflating these is what previously closed items that were meant to stay open.
    expect(normaliseTaskStatus('done').status).toBe(2);
    expect(normaliseStoryStatus('done').status).toBe(4);
  });

  it('maps blocked onto 3 for tasks', () => {
    expect(normaliseTaskStatus('blocked').status).toBe(3);
  });
});

describe('priority', () => {
  it('does not confuse P1 (highest) with numeric 1 (lowest)', () => {
    expect(normalisePriority('P1').priority).toBe(4);
    expect(normalisePriority('P4').priority).toBe(1);
    expect(normalisePriority(1).priority).toBe(1);
    expect(normalisePriority('critical').priority).toBe(4);
  });
});

describe('column matching', () => {
  it('is case- and separator-insensitive', () => {
    const doc = buildTaskDoc({ Title: 'T', 'Due Date': '2026-09-01', estimate_min: 45 }, CTX).doc;
    expect(doc.title).toBe('T');
    expect(doc.estimateMin).toBe(45);
    expect(doc.dueDate).toBe(new Date('2026-09-01').getTime());
  });

  it('falls back through alternative header names', () => {
    expect(buildGoalDoc({ goal: 'From goal column' }, CTX).doc.title).toBe('From goal column');
    expect(buildTaskDoc({ task: 'From task column' }, CTX).doc.title).toBe('From task column');
  });

  it('reports an unreadable date instead of storing NaN', () => {
    const r = normaliseDateMs('not a date');
    expect(r.ms).toBeNull();
    expect(r.warning).toMatch(/could not be read/);
  });
});

describe('rows without a title', () => {
  it('are detectable so they can be skipped, not written as Untitled', () => {
    expect(rowHasTitle('goals', { title: '' })).toBe(false);
    expect(rowHasTitle('goals', { title: '   ' })).toBe(false);
    expect(rowHasTitle('tasks', { task: 'x' })).toBe(true);
  });

  it('are flagged in the warnings', () => {
    expect(buildGoalDoc({}, CTX).warnings.join(' ')).toMatch(/no title/);
  });
});

describe('size', () => {
  it('accepts letters, words and numbers', () => {
    expect(normaliseSize('L').size).toBe(3);
    expect(normaliseSize('small').size).toBe(1);
    expect(normaliseSize(2).size).toBe(2);
    expect(normaliseSize('').size).toBe(2);
  });
});

describe('links', () => {
  it('marks a task aligned only when it actually has a parent', () => {
    expect(buildTaskDoc({ title: 'T' }, CTX).doc.alignedToGoal).toBe(false);
    expect(buildTaskDoc({ title: 'T', storyId: 'abc' }, CTX).doc.alignedToGoal).toBe(true);
  });

  it('warns when a story would land unlinked', () => {
    expect(buildStoryDoc({ title: 'S' }, CTX).warnings.join(' ')).toMatch(/unlinked/);
    expect(buildStoryDoc({ title: 'S', goalId: 'g1' }, CTX).warnings.join(' ')).not.toMatch(/unlinked/);
  });
});

describe('the quoted-comma bug the old split(",") parser had', () => {
  // Not hypothetical: the previous importer did `line.split(',')` then stripped quotes, so one
  // comma inside a quoted field shifted every later column by one and nothing surfaced it.
  const Papa = require('papaparse');

  it('keeps columns aligned when a quoted field contains a comma', () => {
    const csv = [
      'title,description,theme,size',
      '"Build fund","Save 6 months, then review","Finance & Wealth","M"',
    ].join('\n');

    const rows = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
    const doc = buildGoalDoc(rows[0], CTX).doc;

    expect(doc.title).toBe('Build fund');
    expect(doc.description).toBe('Save 6 months, then review');
    // The old parser put "then review" here and shunted theme into size.
    expect(doc.theme).toBe(3);
    expect(doc.size).toBe(2);
  });

  it('parses the shipped goals template into correctly typed documents', () => {
    const csv = [
      'title,description,theme,size,timeToMasterHours,confidence,status,targetDate',
      '"Complete Marathon Training","Train for a marathon","Health & Fitness","L",180,2,"new","2026-12-31"',
    ].join('\n');

    const rows = Papa.parse(csv, { header: true, skipEmptyLines: true }).data;
    const { doc, warnings } = buildGoalDoc(rows[0], CTX);

    expect(doc.theme).toBe(1);
    expect(doc.size).toBe(3);
    expect(doc.confidence).toBe(2);
    expect(doc.status).toBe(0);
    expect(doc.targetDate).toBe('2026-12-31');
    expect(doc.ref).toMatch(/^GR-\d{5}$/);
    // A clean template row should need no guessing at all.
    expect(warnings).toEqual([]);
  });
});
