export const matchesPersona = (doc: any, persona: string | undefined | null): boolean => {
  if (!persona) return true;
  const p = (doc as any)?.persona;
  return p == null || p === '' || p === persona;
};

export type PersonaFilter = 'all' | 'personal' | 'work';

export const matchesPersonaFilter = (doc: any, filter: PersonaFilter): boolean => {
  if (filter === 'all') return true;
  const p = (doc as any)?.persona;
  return p == null || p === '' || p === filter;
};

