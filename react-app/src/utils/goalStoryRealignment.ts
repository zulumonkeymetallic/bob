/**
 * goalStoryRealignment — which stories a goal's move would drag with it, and where to.
 *
 * Moving a goal changes when its work is meant to happen, but the stories underneath it keep
 * whatever sprint they were already in. Overnight, functions/alignStoriesToGoalSprints.js
 * quietly fixes that. This module computes the SAME answer synchronously so the user can see
 * and approve it at the moment they move the goal, instead of discovering it the next morning.
 *
 * THE RULE IS DELIBERATELY COPIED, NOT INVENTED. It mirrors resolveTargetForGoalPersona in
 * that job exactly: the sprint whose startDate is nearest the goal's startDate, within the
 * same persona, within ±6 months, else the backlog. A second, cleverer rule here would mean
 * the screen proposes one thing and the overnight job does another — and the overnight job
 * always gets the last word.
 *
 * Declining a story is not a no-op either: it sets `sprintAlignmentOverride`, which is the
 * flag that job already checks before touching a story. Without it, "leave this one alone"
 * would last until 02:00.
 */

/** ±6 months, matching SIX_MONTHS_MS in alignStoriesToGoalSprints.js. */
export const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

export interface RealignSprint {
  id: string;
  name?: string;
  ref?: string;
  startDate?: unknown;
  persona?: string;
}

export interface RealignStory {
  id: string;
  ref?: string;
  title?: string;
  sprintId?: string | null;
  persona?: string;
  status?: unknown;
  sprintAlignmentOverride?: boolean;
}

export interface RealignProposal {
  story: RealignStory;
  fromSprintId: string | null;
  toSprintId: string | null;
  fromLabel: string;
  toLabel: string;
}

const normalizePersona = (v: unknown): string =>
  String(v || 'personal').toLowerCase() === 'work' ? 'work' : 'personal';

const millis = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isNaN(n) ? null : n; }
  const anyV = v as any;
  if (typeof anyV?.toMillis === 'function') return anyV.toMillis();
  if (typeof anyV?.toDate === 'function') return anyV.toDate().getTime();
  return null;
};

export const sprintLabelFor = (sprintId: string | null, sprints: RealignSprint[]): string => {
  if (!sprintId) return 'Backlog';
  const s = sprints.find((x) => x.id === sprintId);
  return s?.name || s?.ref || 'Sprint';
};

/**
 * The sprint the overnight job would choose for a story of `persona` under a goal starting at
 * `goalStartMs`. Null means backlog — either the goal has no start date, or nothing is within
 * six months of it.
 */
export function targetSprintForGoal(
  goalStartMs: number | null,
  persona: string,
  sprints: RealignSprint[],
): string | null {
  if (goalStartMs == null) return null;
  const want = normalizePersona(persona);
  let best: RealignSprint | null = null;
  let bestDelta = Infinity;
  for (const s of sprints) {
    if (normalizePersona(s.persona) !== want) continue;
    const startMs = millis(s.startDate);
    if (startMs == null) continue;
    const d = Math.abs(startMs - goalStartMs);
    if (d < bestDelta) { best = s; bestDelta = d; }
  }
  return best && bestDelta <= SIX_MONTHS_MS ? best.id : null;
}

/**
 * Stories that would actually move, given a goal's new start date.
 *
 * Excludes three groups, each for a reason the overnight job shares:
 *  - done stories: rescheduling finished work is meaningless
 *  - stories already in the target sprint: nothing to approve
 *  - stories with `sprintAlignmentOverride`: the user has already said leave this one alone,
 *    and re-asking every time the goal nudges is how a helpful prompt becomes noise
 */
export function proposeRealignments(
  goalStartMs: number | null,
  stories: RealignStory[],
  sprints: RealignSprint[],
  isDone: (status: unknown) => boolean,
): RealignProposal[] {
  const proposals: RealignProposal[] = [];
  for (const story of stories) {
    if (isDone(story.status)) continue;
    if (story.sprintAlignmentOverride === true) continue;
    const to = targetSprintForGoal(goalStartMs, story.persona ?? 'personal', sprints);
    const from = story.sprintId || null;
    if ((to || null) === from) continue;
    proposals.push({
      story,
      fromSprintId: from,
      toSprintId: to,
      fromLabel: sprintLabelFor(from, sprints),
      toLabel: sprintLabelFor(to, sprints),
    });
  }
  return proposals;
}
