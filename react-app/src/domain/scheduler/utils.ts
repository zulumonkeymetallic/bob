import { addMinutes, isBefore, isAfter, parseISO } from 'date-fns';
import { BlockModel, BlockTimeWindow, QuietHoursWindow } from './types';

export const minutesBetween = (start: Date, end: Date) => Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));

export const hhmmToMinutes = (hhmm: string): number => {
  const [hh = '0', mm = '0'] = hhmm.split(':');
  return Number(hh) * 60 + Number(mm);
};

export const minutesToHhmm = (minutes: number): string => {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

export const isWithinQuietHours = (
  quietHours: QuietHoursWindow[] | undefined,
  candidateStart: Date,
  candidateEnd: Date,
): boolean => {
  if (!quietHours || quietHours.length === 0) return false;
  const day = candidateStart.getDay() === 0 ? 7 : candidateStart.getDay();
  for (const window of quietHours) {
    if (window.daysOfWeek && window.daysOfWeek.length > 0 && !window.daysOfWeek.includes(day)) {
      continue;
    }
    const startMinutes = hhmmToMinutes(window.startTime);
    const endMinutes = hhmmToMinutes(window.endTime);
    const startOfDay = new Date(candidateStart);
    startOfDay.setHours(0, 0, 0, 0);
    const quietStart = addMinutes(startOfDay, startMinutes);
    const quietEnd = addMinutes(startOfDay, endMinutes);
    if (
      (isBefore(candidateStart, quietEnd) && isAfter(candidateStart, quietStart)) ||
      (isBefore(candidateEnd, quietEnd) && isAfter(candidateEnd, quietStart)) ||
      (isBefore(quietStart, candidateStart) && isAfter(quietEnd, candidateEnd))
    ) {
      return true;
    }
  }
  return false;
};

export interface BlockWindowExpansion {
  window: BlockTimeWindow;
  start: Date;
  end: Date;
}

export const expandBlockWindows = (block: BlockModel, day: Date): BlockWindowExpansion[] => {
  const expansions: BlockWindowExpansion[] = [];
  const localDay = new Date(day);
  localDay.setHours(0, 0, 0, 0);
  const dayOfWeek = localDay.getDay() === 0 ? 7 : localDay.getDay();
  for (const window of block.windows) {
    if (!window.daysOfWeek.includes(dayOfWeek)) continue;
    if (window.startDate && parseISO(window.startDate) > localDay) continue;
    if (window.endDate && parseISO(window.endDate) < localDay) continue;
    const startMinutes = hhmmToMinutes(window.startTime);
    const endMinutes = hhmmToMinutes(window.endTime);
    const start = addMinutes(new Date(localDay), startMinutes);
    const end = addMinutes(new Date(localDay), endMinutes);
    expansions.push({ window, start, end });
  }
  return expansions;
};

