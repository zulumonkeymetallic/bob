import { endOfDay, startOfDay } from 'date-fns';

const MS_IN_DAY = 24 * 60 * 60 * 1000;
const MS_IN_WEEK = 7 * MS_IN_DAY;

const parseDueTimeParts = (value: any): { hour: number; minute: number } | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // Handles values like "07:30", "7:30", and malformed "07:390" (treated as 07:39).
  const colonMatch = raw.match(/^(\d{1,2})\s*:\s*(\d+)$/);
  if (colonMatch) {
    const hour = Number(colonMatch[1]);
    const minute = Number(String(colonMatch[2]).slice(0, 2).padEnd(2, '0'));
    if (Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  // Fallback for compact digit formats like "730", "0730", "073900".
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 3) {
    const hourDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const minuteDigits = digits.length === 3 ? digits.slice(1, 3) : digits.slice(2, 4);
    const hour = Number(hourDigits);
    const minute = Number(minuteDigits);
    if (Number.isFinite(hour) && Number.isFinite(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }

  return null;
};

const applyDueTimeToDateMs = (dateMs: number, dueTime: any): number => {
  const parts = parseDueTimeParts(dueTime);
  if (!parts) return dateMs;
  const date = new Date(dateMs);
  if (Number.isNaN(date.getTime())) return dateMs;
  date.setHours(parts.hour, parts.minute, 0, 0);
  return date.getTime();
};

export const resolveTaskDueMs = (task: any): number | null => {
  const raw: any = task?.dueDateMs
    ?? task?.dueDate
    ?? task?.targetDate
    ?? task?.dueAt
    ?? task?.due;
  if (!raw) return null;
  if (typeof raw === 'number') return applyDueTimeToDateMs(raw, task?.dueTime);
  if (typeof raw === 'string') {
    const parsed = new Date(raw).getTime();
    return Number.isNaN(parsed) ? null : applyDueTimeToDateMs(parsed, task?.dueTime);
  }
  if (raw instanceof Date) return applyDueTimeToDateMs(raw.getTime(), task?.dueTime);
  if (typeof raw.toDate === 'function') {
    const d = raw.toDate();
    return d instanceof Date ? applyDueTimeToDateMs(d.getTime(), task?.dueTime) : null;
  }
  if (typeof raw.toMillis === 'function') return applyDueTimeToDateMs(raw.toMillis(), task?.dueTime);
  if (raw.seconds != null) {
    const millis = (raw.seconds * 1000) + Math.floor((raw.nanoseconds || 0) / 1e6);
    return applyDueTimeToDateMs(millis, task?.dueTime);
  }
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

const startOfWeekSunday = (value: Date): number => {
  const date = startOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date.getTime();
};

const resolveRecurrenceAnchorMs = (task: any): number => {
  const anchor = resolveTaskDueMs(task)
    ?? (typeof task?.lastDoneAt === 'number' ? task.lastDoneAt : null)
    ?? (typeof task?.createdAt === 'number' ? task.createdAt : null)
    ?? Date.now();
  return startOfDay(new Date(anchor)).getTime();
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
  const interval = Math.max(1, Number(task?.repeatInterval ?? recurrence.interval ?? 1) || 1);
  if (!freq) return false;
  const anchorMs = resolveRecurrenceAnchorMs(task);
  if (freq === 'daily') {
    const dayDiff = Math.floor((dayStart - anchorMs) / MS_IN_DAY);
    return dayDiff >= 0 && dayDiff % interval === 0;
  }

  const daysRaw = ([] as any[])
    .concat(task?.daysOfWeek || [])
    .concat(task?.repeatDaysOfWeek || [])
    .concat(recurrence.daysOfWeek || []);
  const daySet = new Set(daysRaw.map(normalizeDayToken).filter(Boolean) as string[]);
  const dayToken = normalizeDayToken(day.getDay());

  if (freq === 'weekly') {
    if (!(dayToken && daySet.size > 0 && daySet.has(dayToken))) return false;
    const weeksDiff = Math.floor((startOfWeekSunday(day) - startOfWeekSunday(new Date(anchorMs))) / MS_IN_WEEK);
    return weeksDiff >= 0 && weeksDiff % interval === 0;
  }

  if (freq === 'monthly') {
    const anchor = new Date(anchorMs);
    const daysOfMonth = ([] as any[]).concat(recurrence.daysOfMonth || []).map(Number).filter(Number.isFinite);
    const targetDay = daysOfMonth.length > 0 ? day.getDate() : anchor.getDate();
    if (daysOfMonth.length > 0) {
      if (!daysOfMonth.includes(day.getDate())) return false;
    } else if (day.getDate() !== targetDay) {
      return false;
    }
    const monthsDiff = (day.getFullYear() - anchor.getFullYear()) * 12 + (day.getMonth() - anchor.getMonth());
    return monthsDiff >= 0 && monthsDiff % interval === 0;
  }

  if (freq === 'yearly') {
    const anchor = new Date(anchorMs);
    if (day.getMonth() !== anchor.getMonth() || day.getDate() !== anchor.getDate()) return false;
    const yearsDiff = day.getFullYear() - anchor.getFullYear();
    return yearsDiff >= 0 && yearsDiff % interval === 0;
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
