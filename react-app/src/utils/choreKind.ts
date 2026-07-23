import { Task } from '../types';

/**
 * Returns the chore/habit/routine kind of a task, or null if it's a plain task.
 * Extracted from MobileHome.tsx (2026-07-23) so every surface that needs to treat
 * chores/habits/routines as exempt from sprint filtering shares one implementation,
 * instead of each file growing its own slightly-different copy — the same drift that
 * caused the story-status-code inconsistency fixed earlier this session.
 */
export function getChoreKind(task: Task | null | undefined): 'chore' | 'routine' | 'habit' | null {
  const raw = String((task as any)?.type || (task as any)?.task_type || '').trim().toLowerCase();
  const normalized = raw === 'habitual' ? 'habit' : raw;
  if (normalized === 'chore' || normalized === 'routine' || normalized === 'habit') return normalized;
  if (normalized) return null;
  const tags = Array.isArray((task as any)?.tags) ? (task as any).tags : [];
  const tagKeys = tags.map((tag: any) => String(tag || '').toLowerCase().replace(/^#/, ''));
  if (tagKeys.includes('chore')) return 'chore';
  if (tagKeys.includes('routine')) return 'routine';
  if (tagKeys.includes('habit') || tagKeys.includes('habitual')) return 'habit';
  return null;
}

export function isChoreHabitOrRoutine(task: Task | null | undefined): boolean {
  return getChoreKind(task) !== null;
}
