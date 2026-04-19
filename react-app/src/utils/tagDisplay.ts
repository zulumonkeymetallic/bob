import { Goal, Sprint } from '../types';

const normalizeTag = (tag: string): string => String(tag || '').trim().replace(/^#/, '');

export const formatTaskTagLabel = (
  tag: string,
  goals: Goal[] = [],
  sprints: Sprint[] = []
): string => {
  const raw = normalizeTag(tag);
  if (!raw) return '';
  const lower = raw.toLowerCase();

  if (lower.startsWith('goal-')) {
    const ref = raw.slice(5);
    const match = goals.find((g) => (g as any).ref === ref || g.id === ref);
    if (match?.title) return match.title;
    return `Goal ${ref}`;
  }

  if (lower.startsWith('sprint-')) {
    const ref = raw.slice(7);
    const match = sprints.find((s) => s.ref === ref || s.id === ref || s.name === ref);
    if (match?.name) return match.name;
    if (match?.ref) return match.ref;
    return `Sprint ${ref}`;
  }

  if (lower.startsWith('sprint') && !lower.startsWith('sprint-')) {
    const suffix = raw.slice(6);
    const digits = suffix.match(/\d+/g)?.join('');
    if (digits) return `Sprint ${digits}`;
    if (suffix) return `Sprint ${suffix}`;
  }

  return raw;
};
