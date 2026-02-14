import { Goal } from '../types';
import type { GlobalTheme } from '../constants/globalThemes';
import { themeVars } from './themeVars';
import { resolveThemeDefinition } from './themeResolver';

export const toSentenceCase = (value: string): string => {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

export const storyStatusText = (status: any): string => {
  // Numeric legacy mapping (0..4)
  if (typeof status === 'number') {
    switch (status) {
      case 0: return 'Backlog';
      case 1: return 'Planned'; // Shown as its own label but mapped to Backlog lane
      case 2: return 'In Progress';
      case 3: return 'In Progress'; // unify former "Testing" with In Progress
      case 4: return 'Done';
      default: return 'Unknown';
    }
  }
  // String mapping with normalisation
  const s = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (!s) return 'Backlog';
  if (['backlog', 'todo', 'planned', 'new'].includes(s)) return 'Backlog';
  if (['in-progress', 'in progress', 'active', 'wip', 'testing', 'qa', 'review'].includes(s)) return 'In Progress';
  if (['blocked', 'paused', 'on-hold', 'onhold', 'stalled', 'waiting'].includes(s)) return 'Blocked';
  if (['done', 'complete', 'completed', 'closed', 'finished'].includes(s)) return 'Done';
  return toSentenceCase(s.replace(/-/g, ' '));
};

export const taskStatusText = (status: any): string => {
  // Numeric mapping common in tasks (0 Backlog/Todo, 1 In Progress, 2 Done, 3 Blocked)
  if (typeof status === 'number') {
    if (status === 3) return 'Blocked';
    if (status >= 2) return 'Done';
    if (status === 1) return 'In Progress';
    return 'Backlog';
  }
  const s = String(status || '').trim().toLowerCase().replace(/_/g, '-');
  if (!s) return 'Backlog';
  if (['backlog', 'todo', 'planned', 'new'].includes(s)) return 'Backlog';
  if (['in-progress', 'in progress', 'active', 'doing'].includes(s)) return 'In Progress';
  if (['blocked', 'paused', 'on-hold', 'onhold', 'stalled', 'waiting'].includes(s)) return 'Blocked';
  if (['done', 'complete', 'completed', 'closed', 'finished'].includes(s)) return 'Done';
  return toSentenceCase(s.replace(/-/g, ' '));
};

export const priorityLabel = (priority: any, fallback: string = 'None'): string => {
  if (priority === null || priority === undefined || priority === '') return fallback;
  if (typeof priority === 'number') {
    switch (priority) {
      case 4: return 'Critical';
      case 3: return 'High';
      case 2: return 'Medium';
      case 1: return 'Low';
      case 0: return fallback;
      default: return fallback;
    }
  }
  const normalized = String(priority).toLowerCase();
  if (normalized === 'med') return 'Medium';
  if (normalized === 'p1') return 'High';
  if (normalized === 'p0') return 'Critical';
  if (normalized === 'p2') return 'Medium';
  if (normalized === 'p3') return 'Low';
  return toSentenceCase(String(priority));
};

export const priorityPillClass = (priority: any): string => {
  let level: 'high' | 'medium' | 'low' | 'default' = 'default';
  if (typeof priority === 'number') {
    if (priority >= 3) level = 'high';
    else if (priority === 2) level = 'medium';
    else if (priority >= 0) level = 'low';
  } else if (priority != null) {
    const normalized = String(priority).toLowerCase();
    if (normalized.includes('crit') || normalized === 'p0' || normalized === 'p1' || normalized.includes('high')) {
      level = 'high';
    } else if (normalized.includes('med') || normalized.includes('medium') || normalized === 'p2') {
      level = 'medium';
    } else if (normalized.includes('low') || normalized === 'p3') {
      level = 'low';
    }
  }
  const base = 'kanban-card__meta-pill';
  if (level === 'high') return `${base} kanban-card__meta-pill--danger`;
  if (level === 'medium') return `${base} kanban-card__meta-pill--warning`;
  if (level === 'low') return `${base} kanban-card__meta-pill--success`;
  return base;
};

export const goalThemeColor = (goal?: Goal | null, themes?: GlobalTheme[]): string => {
  if (!goal) return themeVars.muted as string;
  const themeValue = (goal as any).theme ?? (goal as any).themeId ?? (goal as any).theme_id ?? (goal as any).themeLabel ?? (goal as any).themeName;
  const theme = resolveThemeDefinition(themeValue, themes);
  return theme?.color || (themeVars.muted as string);
};

const normalizeHex = (value: string): string => {
  const hex = value.replace('#', '');
  if (hex.length === 3) {
    return hex.split('').map((char) => char + char).join('');
  }
  return hex.padEnd(6, '0');
};

export const colorWithAlpha = (inputColor: string | null | undefined, alpha: number, fallback: string = '#2563eb'): string => {
  const source = (typeof inputColor === 'string' && inputColor.startsWith('#'))
    ? inputColor
    : (fallback.startsWith('#') ? fallback : '#2563eb');

  const normalized = normalizeHex(source);
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  const safeAlpha = Math.max(0, Math.min(alpha, 1));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
};
