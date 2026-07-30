import type { Sprint } from '../types';

export function isPlanningSprint(sprint: Sprint): boolean {
  const status = Number((sprint as any)?.status ?? 0);
  return status === 0 || status === 1;
}

/**
 * Planning-relevant sprints, ordered the way someone picking one actually thinks: the sprint
 * they are IN first, then the ones coming up soonest.
 *
 * The filter previously returned Firestore's own order, which is descending, so the active
 * sprint sorted last — below ten planned sprints stretching into 2028. Selecting the current
 * sprint meant scrolling to the bottom of the list every time.
 */
export function planningSprints(sprints: Sprint[]): Sprint[] {
  return (sprints || [])
    .filter(isPlanningSprint)
    .slice()
    .sort((a, b) => {
      const aActive = Number((a as any)?.status ?? 0) === 1;
      const bActive = Number((b as any)?.status ?? 0) === 1;
      if (aActive !== bActive) return aActive ? -1 : 1;
      // Then soonest-starting first, so "the next one" is always the next row down.
      const aStart = Number((a as any)?.startDate ?? 0);
      const bStart = Number((b as any)?.startDate ?? 0);
      if (aStart !== bStart) return aStart - bStart;
      return String((a as any)?.name ?? '').localeCompare(String((b as any)?.name ?? ''));
    });
}

/** How many sprints the selector shows before collapsing: the current one plus the next three. */
export const SPRINT_SELECTOR_DEFAULT_VISIBLE = 4;

/**
 * The slice of an already-ordered sprint list the selector should render.
 *
 * The full list runs to a dozen planned sprints years out, which buries the two or three
 * anyone actually switches between. The currently selected sprint is always included even if
 * it falls past the cut-off — collapsing the list must never hide the row that is ticked.
 */
export function visibleSprintWindow(
  ordered: Sprint[],
  selectedId: string | undefined,
  showAll: boolean,
  limit: number = SPRINT_SELECTOR_DEFAULT_VISIBLE,
): Sprint[] {
  const list = ordered || [];
  if (showAll || list.length <= limit) return list;

  const head = list.slice(0, limit);
  if (selectedId && !head.some((s) => s.id === selectedId)) {
    const selected = list.find((s) => s.id === selectedId);
    if (selected) return [...head, selected];
  }
  return head;
}

export function pickDefaultPlanningSprintId(sprints: Sprint[]): string {
  const pool = planningSprints(sprints);
  const active = pool.find((sprint) => Number((sprint as any)?.status ?? 0) === 1);
  return active?.id || pool[0]?.id || '';
}
