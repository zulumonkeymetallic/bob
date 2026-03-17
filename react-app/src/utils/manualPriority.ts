export type ManualPriorityRank = 1 | 2 | 3 | null;

export function getManualPriorityRank(entity: any): ManualPriorityRank {
  const explicit = Number(entity?.userPriorityRank);
  if (explicit === 1 || explicit === 2 || explicit === 3) return explicit;
  return entity?.userPriorityFlag === true ? 1 : null;
}

export function getManualPriorityLabel(entity: any): string | null {
  const rank = getManualPriorityRank(entity);
  return rank ? `#${rank} Priority` : null;
}

export function getNextManualPriorityRank(items: any[], persona: string, excludeId?: string): 1 | 2 | 3 {
  const normalizedPersona = String(persona || 'personal');
  const used = new Set<number>();
  (items || []).forEach((item) => {
    if (!item || item.id === excludeId) return;
    if (String(item.persona || 'personal') !== normalizedPersona) return;
    const rank = getManualPriorityRank(item);
    if (rank) used.add(rank);
  });
  if (!used.has(1)) return 1;
  if (!used.has(2)) return 2;
  return 3;
}

export function findItemWithManualPriorityRank<T extends { id?: string; persona?: string }>(
  items: T[],
  persona: string,
  rank: 1 | 2 | 3,
  excludeId?: string,
): T | null {
  const normalizedPersona = String(persona || 'personal');
  return (items || []).find((item) => {
    if (!item || item.id === excludeId) return false;
    if (String(item.persona || 'personal') !== normalizedPersona) return false;
    return getManualPriorityRank(item) === rank;
  }) || null;
}
