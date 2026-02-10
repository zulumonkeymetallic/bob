import { endOfDay, startOfDay } from 'date-fns';

export const resolveTaskDueMs = (task: any): number | null => {
  const raw: any = task?.dueDateMs
    ?? task?.dueDate
    ?? task?.targetDate
    ?? task?.dueAt
    ?? task?.due;
  if (!raw) return null;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw.toDate === 'function') {
    const d = raw.toDate();
    return d instanceof Date ? d.getTime() : null;
  }
  if (typeof raw.toMillis === 'function') return raw.toMillis();
  if (raw.seconds != null) return (raw.seconds * 1000) + Math.floor((raw.nanoseconds || 0) / 1e6);
  return null;
};

const normalizeDayToken = (value: any): string | null => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    const idx = Math.max(0, Math.min(6, value % 7));
    return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][idx];
  }
  const raw = String(value).toLowerCase().trim();
  if (!raw) return null;
  if (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].includes(raw)) return raw;
  if (raw.startsWith('su')) return 'sun';
  if (raw.startsWith('mo')) return 'mon';
  if (raw.startsWith('tu')) return 'tue';
  if (raw.startsWith('we')) return 'wed';
  if (raw.startsWith('th')) return 'thu';
  if (raw.startsWith('fr')) return 'fri';
  if (raw.startsWith('sa')) return 'sat';
  return null;
};

export const isRecurringDueOnDate = (task: any, day: Date, dueMs?: number | null): boolean => {
  const dayStart = startOfDay(day).getTime();
  const dayEnd = endOfDay(day).getTime();
  const resolvedDue = dueMs ?? resolveTaskDueMs(task);
  if (resolvedDue) {
    return resolvedDue >= dayStart && resolvedDue <= dayEnd;
  }
  const recurrence = (task?.recurrence || {}) as any;
  const freqRaw = task?.repeatFrequency || recurrence.frequency || recurrence.freq || '';
  const freq = String(freqRaw || '').toLowerCase();
  if (!freq) return false;
  if (freq === 'daily') return true;

  const daysRaw = ([] as any[])
    .concat(task?.daysOfWeek || [])
    .concat(task?.repeatDaysOfWeek || [])
    .concat(recurrence.daysOfWeek || []);
  const daySet = new Set(daysRaw.map(normalizeDayToken).filter(Boolean) as string[]);
  const dayToken = normalizeDayToken(day.getDay());

  if (freq === 'weekly') {
    if (dayToken && daySet.size > 0) return daySet.has(dayToken);
    return false;
  }

  if (freq === 'monthly') {
    const dayOfMonth = day.getDate();
    const daysOfMonth = ([] as any[]).concat(recurrence.daysOfMonth || []);
    if (daysOfMonth.length) return daysOfMonth.map(Number).includes(dayOfMonth);
    return false;
  }

  if (freq === 'yearly') {
    return false;
  }

  return false;
};

export const resolveRecurringDueMs = (task: any, day: Date, fallbackMs?: number | null): number | null => {
  const dueMs = resolveTaskDueMs(task);
  if (dueMs) return dueMs;
  if (isRecurringDueOnDate(task, day, dueMs)) {
    return fallbackMs ?? startOfDay(day).getTime();
  }
  return null;
};
