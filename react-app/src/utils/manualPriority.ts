export type ManualPriorityRank = 1 | 2 | 3 | 4 | 5 | null;

export function getManualPriorityRank(entity: any): ManualPriorityRank {
  const explicit = Number(entity?.userPriorityRank);
  if (explicit >= 1 && explicit <= 5) return explicit as ManualPriorityRank;
  return entity?.userPriorityFlag === true ? 1 : null;
}

export function getManualPriorityLabel(entity: any): string | null {
  const rank = getManualPriorityRank(entity);
  return rank ? `Order #${rank}` : null;
}

/** Score boost for user-ordered stories: order 1 → +500 … order 5 → +100 */
export function manualRankScoreBoost(rank: number | null | undefined): number {
  const r = Number(rank || 0);
  return r >= 1 && r <= 5 ? (6 - r) * 100 : 0;
}

export function getNextManualPriorityRank(items: any[], persona: string, excludeId?: string): 1 | 2 | 3 | 4 | 5 {
  const normalizedPersona = String(persona || 'personal');
  const used = new Set<number>();
  (items || []).forEach((item) => {
    if (!item || item.id === excludeId) return;
    if (String(item.persona || 'personal') !== normalizedPersona) return;
    const rank = getManualPriorityRank(item);
    if (rank) used.add(rank);
  });
  for (const r of [1, 2, 3, 4, 5] as const) {
    if (!used.has(r)) return r;
  }
  return 5;
}

export function findItemWithManualPriorityRank<T extends { id?: string; persona?: string }>(
  items: T[],
  persona: string,
  rank: 1 | 2 | 3 | 4 | 5,
  excludeId?: string,
): T | null {
  const normalizedPersona = String(persona || 'personal');
  return (items || []).find((item) => {
    if (!item || item.id === excludeId) return false;
    if (String(item.persona || 'personal') !== normalizedPersona) return false;
    return getManualPriorityRank(item) === rank;
  }) || null;
}
