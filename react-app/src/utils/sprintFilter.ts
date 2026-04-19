import type { Sprint } from '../types';

export function isPlanningSprint(sprint: Sprint): boolean {
  const status = Number((sprint as any)?.status ?? 0);
  return status === 0 || status === 1;
}

export function planningSprints(sprints: Sprint[]): Sprint[] {
  return (sprints || []).filter(isPlanningSprint);
}

export function pickDefaultPlanningSprintId(sprints: Sprint[]): string {
  const pool = planningSprints(sprints);
  const active = pool.find((sprint) => Number((sprint as any)?.status ?? 0) === 1);
  return active?.id || pool[0]?.id || '';
}
