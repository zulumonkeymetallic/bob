import { Goal } from '../types';
import type { GlobalTheme } from '../constants/globalThemes';
import { themeVars } from './themeVars';
import { resolveThemeDefinition } from './themeResolver';
import { workflowStatusLabel } from './workflowStatus';

export const toSentenceCase = (value: string): string => {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

// Three workflow states only — Backlog / In Progress / Done — everywhere. The legacy
// "Planned", "Testing"/"Review" and "Blocked" rungs collapse into In Progress; see
// utils/workflowStatus for the single source of truth on how each raw value maps.
export const storyStatusText = (status: any): string => workflowStatusLabel(status, 'story');

export const taskStatusText = (status: any): string => workflowStatusLabel(status, 'task');

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
  let level: 'critical' | 'high' | 'medium' | 'low' | 'default' = 'default';
  if (typeof priority === 'number') {
    if (priority >= 4) level = 'critical';
    else if (priority >= 3) level = 'high';
    else if (priority === 2) level = 'medium';
    else if (priority >= 0) level = 'low';
  } else if (priority != null) {
    const normalized = String(priority).toLowerCase();
    if (normalized.includes('crit') || normalized === 'p0' || normalized.includes('urgent')) {
      level = 'critical';
    } else if (normalized === 'p1' || normalized.includes('high')) {
      level = 'high';
    } else if (normalized.includes('med') || normalized.includes('medium') || normalized === 'p2') {
      level = 'medium';
    } else if (normalized.includes('low') || normalized === 'p3') {
      level = 'low';
    }
  }
  const base = 'kanban-card__meta-pill';
  if (level === 'critical') return `${base} kanban-card__meta-pill--danger`;
  if (level === 'high') return `${base} kanban-card__meta-pill--orange`;
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
