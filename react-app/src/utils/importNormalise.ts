/**
 * importNormalise — maps loosely-typed spreadsheet rows onto the shapes BOB actually stores.
 *
 * This exists because bulk import has been writing malformed records. The CSV importer wrote
 * `status: 'active'` and `theme: 'Growth'` as strings where both fields are numeric, set
 * `confidence` to 0.5 on a 1-3 scale, generated no `ref`, and ignored the selected type so
 * every row became a goal. Records like that render untitled and unthemed, and a task with no
 * `persona` is invisible to the Personal/Work filters the whole app is built around.
 *
 * Every function is total: it always returns a usable value and reports what it had to guess,
 * so the import preview can show the user what will actually be written before anything is.
 * Silently defaulting is how the current importer produces junk that only surfaces days later.
 */
import { GLOBAL_THEMES } from '../constants/globalThemes';
import { generateRef } from './referenceGenerator';

export type Persona = 'personal' | 'work';
export type ImportType = 'goals' | 'stories' | 'tasks';

export interface NormaliseResult<T> {
  doc: T;
  /** Human-readable notes about anything inferred or defaulted, shown in the preview. */
  warnings: string[];
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const isBlank = (v: unknown): boolean => str(v) === '';

/**
 * Theme accepts an id or a name. Matching is exact, then prefix, then substring, because the
 * shipped CSV templates use short labels ("Health", "Wealth") while the real themes are
 * "Health & Fitness" and "Finance & Wealth". Unmatched falls back to General (0) WITH a
 * warning rather than guessing — a wrong theme silently misfiles the item.
 */
export const normaliseTheme = (value: unknown): { theme: number; warning?: string } => {
  if (isBlank(value)) return { theme: 0, warning: 'no theme given, defaulted to General' };

  const raw = str(value);
  const asNum = Number(raw);
  if (Number.isInteger(asNum) && GLOBAL_THEMES.some((t) => t.id === asNum)) {
    return { theme: asNum };
  }

  const needle = raw.toLowerCase();
  const exact = GLOBAL_THEMES.find((t) => t.name.toLowerCase() === needle);
  if (exact) return { theme: exact.id };

  const prefix = GLOBAL_THEMES.find((t) => t.name.toLowerCase().startsWith(needle));
  if (prefix) return { theme: prefix.id };

  const contains = GLOBAL_THEMES.filter((t) => t.name.toLowerCase().includes(needle));
  if (contains.length === 1) return { theme: contains[0].id };
  if (contains.length > 1) {
    return {
      theme: contains[0].id,
      warning: `theme "${raw}" matched ${contains.length} themes, used "${contains[0].name}"`,
    };
  }

  return { theme: 0, warning: `theme "${raw}" not recognised, defaulted to General` };
};

/** Size: 1 Small, 2 Medium, 3 Large. Accepts S/M/L, the words, or the number. */
export const normaliseSize = (value: unknown): { size: number; warning?: string } => {
  if (isBlank(value)) return { size: 2 };
  const raw = str(value).toLowerCase();
  const asNum = Number(raw);
  if (asNum === 1 || asNum === 2 || asNum === 3) return { size: asNum };
  if (raw === 's' || raw === 'small') return { size: 1 };
  if (raw === 'm' || raw === 'med' || raw === 'medium') return { size: 2 };
  if (raw === 'l' || raw === 'large' || raw === 'xl') return { size: 3 };
  return { size: 2, warning: `size "${str(value)}" not recognised, used Medium` };
};

/**
 * Confidence: 1 Low, 2 Medium, 3 High. The old importer wrote `parseFloat(...) || 0.5`, so a
 * template row saying 0.7 stored 0.7 on a three-point scale. Fractions below 1 are read as the
 * 0-1 probability they plainly are and bucketed.
 */
export const normaliseConfidence = (value: unknown): { confidence: number; warning?: string } => {
  if (isBlank(value)) return { confidence: 2 };
  const n = Number(str(value));
  if (!Number.isFinite(n)) {
    const raw = str(value).toLowerCase();
    if (raw.startsWith('low')) return { confidence: 1 };
    if (raw.startsWith('med')) return { confidence: 2 };
    if (raw.startsWith('high')) return { confidence: 3 };
    return { confidence: 2, warning: `confidence "${str(value)}" not recognised, used Medium` };
  }
  if (n > 0 && n < 1) {
    const bucketed = n < 0.34 ? 1 : n < 0.67 ? 2 : 3;
    return { confidence: bucketed, warning: `confidence ${n} read as a 0-1 probability` };
  }
  if (n === 1 || n === 2 || n === 3) return { confidence: n };
  return { confidence: 2, warning: `confidence "${str(value)}" out of range, used Medium` };
};

const DONE_WORDS = ['done', 'complete', 'completed', 'finished', 'closed'];
const ACTIVE_WORDS = ['active', 'in progress', 'in-progress', 'doing', 'wip', 'started'];
const BLOCKED_WORDS = ['blocked', 'stuck'];

/** Goal status: 0 New, 1 Work in Progress, 2 Complete, 3 Blocked, 4 Deferred. */
export const normaliseGoalStatus = (value: unknown): { status: number; warning?: string } => {
  if (isBlank(value)) return { status: 0 };
  const raw = str(value).toLowerCase();
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 4) return { status: n };
  if (DONE_WORDS.includes(raw)) return { status: 2 };
  if (ACTIVE_WORDS.includes(raw)) return { status: 1 };
  if (BLOCKED_WORDS.includes(raw)) return { status: 3 };
  if (raw === 'deferred') return { status: 4 };
  if (raw === 'new' || raw === 'backlog' || raw === 'todo' || raw === 'planned') return { status: 0 };
  return { status: 0, warning: `status "${str(value)}" not recognised, used New` };
};

/**
 * Task status: 0 To Do, 1 In Progress, 2 Done, 3 Blocked. Note this is a DIFFERENT scale from
 * stories, where 2 is a legacy in-progress value — conflating them is what previously closed
 * items that were meant to be open, so the two live in separate functions on purpose.
 */
export const normaliseTaskStatus = (value: unknown): { status: number; warning?: string } => {
  if (isBlank(value)) return { status: 0 };
  const raw = str(value).toLowerCase();
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 0 && n <= 3) return { status: n };
  if (DONE_WORDS.includes(raw)) return { status: 2 };
  if (ACTIVE_WORDS.includes(raw)) return { status: 1 };
  if (BLOCKED_WORDS.includes(raw)) return { status: 3 };
  if (raw === 'todo' || raw === 'to do' || raw === 'backlog' || raw === 'planned') return { status: 0 };
  return { status: 0, warning: `status "${str(value)}" not recognised, used To Do` };
};

/** Story status: 0 Backlog, 1 In Progress, 4 Done. Only canonical values are ever written. */
export const normaliseStoryStatus = (value: unknown): { status: number; warning?: string } => {
  if (isBlank(value)) return { status: 0 };
  const raw = str(value).toLowerCase();
  const n = Number(raw);
  // 2 and 3 are legacy in-progress values that still exist on old docs; never write them.
  if (n === 0) return { status: 0 };
  if (n === 1 || n === 2 || n === 3) return { status: 1 };
  if (Number.isInteger(n) && n >= 4) return { status: 4 };
  if (DONE_WORDS.includes(raw)) return { status: 4 };
  if (ACTIVE_WORDS.includes(raw)) return { status: 1 };
  if (raw === 'backlog' || raw === 'todo' || raw === 'planned') return { status: 0 };
  return { status: 0, warning: `status "${str(value)}" not recognised, used Backlog` };
};

/** Effort is a letter on tasks, not a number. The old backend wrote `effort: 1`. */
export const normaliseEffort = (value: unknown): { effort: 'S' | 'M' | 'L'; warning?: string } => {
  if (isBlank(value)) return { effort: 'M' };
  const raw = str(value).toLowerCase();
  if (raw === 's' || raw === 'small' || raw === '1') return { effort: 'S' };
  if (raw === 'm' || raw === 'med' || raw === 'medium' || raw === '2') return { effort: 'M' };
  if (raw === 'l' || raw === 'large' || raw === '3') return { effort: 'L' };
  return { effort: 'M', warning: `effort "${str(value)}" not recognised, used M` };
};

/** Priority: 4 Critical, 3 High, 2 Medium, 1 Low. Accepts P1-P4, words, or the number. */
export const normalisePriority = (value: unknown): { priority: number; warning?: string } => {
  if (isBlank(value)) return { priority: 2 };
  const raw = str(value).toLowerCase();
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 1 && n <= 4) return { priority: n };
  // P1 is the HIGHEST priority in the P-scale but 1 is the LOWEST on the numeric scale, so
  // these must not be treated as interchangeable.
  const p = raw.match(/^p([1-4])$/);
  if (p) return { priority: 5 - Number(p[1]) };
  if (raw === 'critical' || raw === 'urgent') return { priority: 4 };
  if (raw === 'high') return { priority: 3 };
  if (raw === 'med' || raw === 'medium' || raw === 'normal') return { priority: 2 };
  if (raw === 'low') return { priority: 1 };
  return { priority: 2, warning: `priority "${str(value)}" not recognised, used Medium` };
};

/** Dates are stored as epoch millis on tasks and ISO yyyy-mm-dd on goals. */
export const normaliseDateMs = (value: unknown): { ms: number | null; warning?: string } => {
  if (isBlank(value)) return { ms: null };
  const parsed = new Date(str(value));
  if (Number.isNaN(parsed.getTime())) {
    return { ms: null, warning: `date "${str(value)}" could not be read, left empty` };
  }
  return { ms: parsed.getTime() };
};

export const normaliseDateIso = (value: unknown): { iso: string | null; warning?: string } => {
  const { ms, warning } = normaliseDateMs(value);
  return { iso: ms == null ? null : new Date(ms).toISOString().slice(0, 10), warning };
};

const numberOr = (value: unknown, fallback: number): number => {
  const n = Number(str(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export interface BuildContext {
  ownerUid: string;
  persona: Persona;
  /** Refs already in use, so generated ones do not collide. */
  existingRefs?: string[];
}

/** Row keys are matched case-insensitively and ignoring spaces/underscores. */
const pick = (row: Record<string, unknown>, ...keys: string[]): unknown => {
  const flat: Record<string, unknown> = {};
  Object.entries(row).forEach(([k, v]) => {
    flat[k.toLowerCase().replace(/[\s_-]/g, '')] = v;
  });
  for (const key of keys) {
    const hit = flat[key.toLowerCase().replace(/[\s_-]/g, '')];
    if (!isBlank(hit)) return hit;
  }
  return '';
};

export const buildGoalDoc = (
  row: Record<string, unknown>,
  ctx: BuildContext,
): NormaliseResult<Record<string, unknown>> => {
  const warnings: string[] = [];
  const push = (w?: string) => { if (w) warnings.push(w); };

  const title = str(pick(row, 'title', 'goal', 'name', 'text'));
  if (!title) warnings.push('no title — row will be skipped');

  const theme = normaliseTheme(pick(row, 'theme', 'area', 'category'));
  const size = normaliseSize(pick(row, 'size'));
  const confidence = normaliseConfidence(pick(row, 'confidence'));
  const status = normaliseGoalStatus(pick(row, 'status'));
  const target = normaliseDateIso(pick(row, 'targetDate', 'target', 'due', 'dueDate'));
  push(theme.warning); push(size.warning); push(confidence.warning);
  push(status.warning); push(target.warning);

  const kpis = [1, 2, 3]
    .map((i) => ({
      name: str(pick(row, `kpi${i}Name`)),
      target: Number(str(pick(row, `kpi${i}Target`))) || 0,
      unit: str(pick(row, `kpi${i}Unit`)),
    }))
    .filter((k) => k.name);

  return {
    doc: {
      ref: generateRef('goal', ctx.existingRefs),
      title,
      description: str(pick(row, 'description', 'notes')),
      persona: ctx.persona,
      theme: theme.theme,
      size: size.size,
      timeToMasterHours: numberOr(pick(row, 'timeToMasterHours', 'hours'), 40),
      confidence: confidence.confidence,
      status: status.status,
      targetDate: target.iso,
      kpis,
      ownerUid: ctx.ownerUid,
      orderIndex: 0,
    },
    warnings,
  };
};

export const buildStoryDoc = (
  row: Record<string, unknown>,
  ctx: BuildContext & { goalId?: string },
): NormaliseResult<Record<string, unknown>> => {
  const warnings: string[] = [];
  const push = (w?: string) => { if (w) warnings.push(w); };

  const title = str(pick(row, 'title', 'story', 'name'));
  if (!title) warnings.push('no title — row will be skipped');

  const status = normaliseStoryStatus(pick(row, 'status'));
  const priority = normalisePriority(pick(row, 'priority'));
  const theme = normaliseTheme(pick(row, 'theme', 'area'));
  push(status.warning); push(priority.warning);
  // A story with no theme inherits from its goal at read time, so this default is not worth
  // warning about the way it is on a goal.

  const acceptanceCriteria = [1, 2, 3, 4, 5]
    .map((i) => str(pick(row, `acceptanceCriteria${i}`, `ac${i}`)))
    .filter(Boolean);

  const goalId = str(pick(row, 'goalId')) || ctx.goalId || '';
  if (!goalId) warnings.push('no goal link — will sit unlinked in the backlog');

  return {
    doc: {
      ref: generateRef('story', ctx.existingRefs),
      title,
      description: str(pick(row, 'description', 'notes')),
      persona: ctx.persona,
      goalId,
      theme: theme.theme,
      status: status.status,
      priority: priority.priority,
      points: Number(str(pick(row, 'points'))) || 0,
      acceptanceCriteria,
      orderIndex: 0,
      ownerUid: ctx.ownerUid,
    },
    warnings,
  };
};

export const buildTaskDoc = (
  row: Record<string, unknown>,
  ctx: BuildContext & { parentId?: string },
): NormaliseResult<Record<string, unknown>> => {
  const warnings: string[] = [];
  const push = (w?: string) => { if (w) warnings.push(w); };

  const title = str(pick(row, 'title', 'task', 'name'));
  if (!title) warnings.push('no title — row will be skipped');

  const status = normaliseTaskStatus(pick(row, 'status'));
  const priority = normalisePriority(pick(row, 'priority'));
  const effort = normaliseEffort(pick(row, 'effort'));
  const theme = normaliseTheme(pick(row, 'theme', 'area'));
  const due = normaliseDateMs(pick(row, 'dueDate', 'due', 'when'));
  push(status.warning); push(priority.warning); push(effort.warning); push(due.warning);

  const parentId = str(pick(row, 'parentId', 'storyId')) || ctx.parentId || '';
  const parentType = (str(pick(row, 'parentType')).toLowerCase() === 'project' ? 'project' : 'story');

  return {
    doc: {
      ref: generateRef('task', ctx.existingRefs),
      title,
      description: str(pick(row, 'description', 'notes')),
      // Without persona the task is invisible to the Personal/Work filter, which is the single
      // most damaging omission the old import made.
      persona: ctx.persona,
      parentType,
      parentId,
      status: status.status,
      priority: priority.priority,
      effort: effort.effort,
      estimateMin: numberOr(pick(row, 'estimateMin', 'estimate', 'minutes'), 30),
      theme: theme.theme,
      dueDate: due.ms,
      alignedToGoal: Boolean(parentId),
      hasGoal: Boolean(parentId),
      aiLinkConfidence: 0,
      source: 'web',
      syncState: 'clean',
      createdBy: ctx.ownerUid,
      ownerUid: ctx.ownerUid,
    },
    warnings,
  };
};

export const buildDoc = (
  type: ImportType,
  row: Record<string, unknown>,
  ctx: BuildContext,
): NormaliseResult<Record<string, unknown>> => {
  if (type === 'goals') return buildGoalDoc(row, ctx);
  if (type === 'stories') return buildStoryDoc(row, ctx);
  return buildTaskDoc(row, ctx);
};

/** A row with no usable title is skipped rather than written as an "Untitled" record. */
export const rowHasTitle = (type: ImportType, row: Record<string, unknown>): boolean => {
  const keys = type === 'goals'
    ? ['title', 'goal', 'name', 'text']
    : type === 'stories'
      ? ['title', 'story', 'name']
      : ['title', 'task', 'name'];
  return !isBlank(pick(row, ...keys));
};
