import { useCallback, useMemo, useState } from 'react';
import { addMinutes, format, parse } from 'date-fns';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import type { CalendarBlock } from '../types';
import type { ExternalCalendarEvent } from './useUnifiedPlannerData';
import type { ScheduledInstanceModel } from '../domain/scheduler/repository';
import { schedulePlannerItem } from '../utils/plannerScheduling';
import { FALLBACK_THEME_COLORS, type ThemeAppearance } from './useThemeAppearance';

export const hexToRgba = (hex: string, alpha: number) => {
  if (!hex) return `rgba(99, 102, 241, ${alpha})`;
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized.padEnd(6, '0');
  const numeric = Number.parseInt(full, 16);
  if (Number.isNaN(numeric)) {
    return `rgba(99, 102, 241, ${alpha})`;
  }
  const r = (numeric >> 16) & 255;
  const g = (numeric >> 8) & 255;
  const b = numeric & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export interface PlannerCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'block' | 'instance' | 'external';
  color?: string;
  textColor?: string;
  themeLabel?: string;
  source?: string;
  block?: CalendarBlock;
  instance?: ScheduledInstanceModel;
  external?: ExternalCalendarEvent;
}

export type PlannerFeedback = { variant: 'success' | 'danger' | 'info'; message: string };

interface UsePlannerCalendarEventsParams {
  blocks: CalendarBlock[];
  instances: ScheduledInstanceModel[];
  externalEvents: ExternalCalendarEvent[];
  resolveThemeAppearance: (theme?: string | number | null) => ThemeAppearance | undefined;
  goalColorMap?: Map<string, string>;
  onFeedback?: (feedback: PlannerFeedback) => void;
  refreshExternalEvents?: () => Promise<void> | void;
  /** When true, moving/resizing a block or instance also writes the linked story/task's date via schedulePlannerItem (source: 'weekly_planner'). */
  syncEntityDate?: boolean;
}

/**
 * Shared react-big-calendar event mapping + drag/resize handlers used by planner surfaces.
 * Mirrors the logic in UnifiedPlannerPage.tsx's calendar level so the week planner can
 * render the same gcal/theme_allocation/sprint_forward_plan overlay without duplicating it inline.
 */
export const usePlannerCalendarEvents = ({
  blocks,
  instances,
  externalEvents,
  resolveThemeAppearance,
  goalColorMap,
  onFeedback,
  refreshExternalEvents,
  syncEntityDate = false,
}: UsePlannerCalendarEventsParams) => {
  const [lastActionPatch, setLastActionPatch] = useState<{ id: string; prevStart: Date; prevEnd: Date } | null>(null);

  const emitFeedback = useCallback((feedback: PlannerFeedback) => {
    onFeedback?.(feedback);
  }, [onFeedback]);

  const events: PlannerCalendarEvent[] = useMemo(() => {
    const displayBlocks = blocks.filter((block) => {
      const source = String((block as any).source || '').toLowerCase();
      const entryMethod = String((block as any).entry_method || '').toLowerCase();
      const isGcal = source === 'gcal' || entryMethod === 'google_calendar';
      const blockId = String((block as any).id || '');
      const isMirrorBlock = blockId.startsWith('sched_') || blockId.startsWith('chore_');
      if (isMirrorBlock) return false;
      if (isGcal) {
        const hasLink = Boolean(block.taskId || block.storyId || block.goalId || (block as any).deepLink);
        return hasLink;
      }
      return true;
    });

    const blockEvents = displayBlocks.map((block) => {
      const start = new Date(block.start);
      const end = new Date(block.end);
      const title = (block as any).title || `${block.category} • ${block.theme}`;
      const appearance = resolveThemeAppearance(
        block.theme ?? (block as any).theme_id ?? block.subTheme ?? block.category,
      );
      const goalColor = block.goalId ? goalColorMap?.get(block.goalId) : undefined;
      return {
        id: block.id,
        title,
        start,
        end,
        type: 'block' as const,
        source: (block as any).source,
        color: goalColor
          || appearance?.color
          || FALLBACK_THEME_COLORS[String(block.theme || block.category)] || '#14b8a6',
        textColor: appearance?.textColor || '#ffffff',
        themeLabel: appearance?.label,
        block,
      } satisfies PlannerCalendarEvent;
    });

    const instanceEvents = instances
      .filter((instance) => instance.plannedStart || instance.occurrenceDate)
      .map((instance) => {
        const block = instance.blockId ? blocks.find((b) => b.id === instance.blockId) : undefined;
        const base = instance.occurrenceDate
          ? parse(instance.occurrenceDate, 'yyyyMMdd', new Date())
          : new Date(instance.plannedStart || Date.now());
        const start = instance.plannedStart ? new Date(instance.plannedStart) : addMinutes(base, 8 * 60);
        const end = instance.plannedEnd
          ? new Date(instance.plannedEnd)
          : addMinutes(new Date(start), instance.durationMinutes || 30);

        const enrichedInstance = instance as ScheduledInstanceModel & {
          theme?: string | number | null;
          storyTheme?: string | number | null;
          goalTheme?: string | number | null;
          sourceTheme?: string | number | null;
          tags?: string[];
        };

        const inferredTheme = (() => {
          if (enrichedInstance.theme) return enrichedInstance.theme;
          if (enrichedInstance.sourceTheme) return enrichedInstance.sourceTheme;
          if (enrichedInstance.storyTheme) return enrichedInstance.storyTheme;
          if (enrichedInstance.goalTheme) return enrichedInstance.goalTheme;
          if (Array.isArray(enrichedInstance.tags)) {
            const tagMatch = enrichedInstance.tags.find((tag) => Boolean(resolveThemeAppearance(tag)));
            if (tagMatch) return tagMatch;
          }
          if (block?.theme) return block.theme;
          if (block?.category) return block.category;
          return null;
        })();

        const appearance = resolveThemeAppearance(inferredTheme);
        const fallbackColor = enrichedInstance.sourceType === 'chore'
          ? '#f59e0b'
          : enrichedInstance.sourceType === 'routine'
            ? '#0ea5e9'
            : '#38bdf8';

        const title = instance.title
          || (instance.sourceType === 'chore' ? 'Chore' : instance.sourceType === 'routine' ? 'Routine' : 'Planned work');

        return {
          id: instance.id,
          title,
          start,
          end,
          type: 'instance' as const,
          color: appearance?.color || (block ? resolveThemeAppearance(block.theme)?.color : undefined) || fallbackColor,
          textColor: appearance?.textColor || '#ffffff',
          themeLabel: appearance?.label,
          block,
          instance,
        } satisfies PlannerCalendarEvent;
      });

    const linkedGcalIds = new Set<string>();
    instances.forEach((i) => {
      if (i.external?.gcalEventId) linkedGcalIds.add(i.external.gcalEventId);
    });
    displayBlocks.forEach((b) => {
      if (b.googleEventId) linkedGcalIds.add(b.googleEventId);
    });

    const externalEventsMapped = externalEvents
      .filter((external) => {
        if (linkedGcalIds.has(external.id)) return false;
        const blockIdFromExt = (external.raw as any)?.extendedProperties?.private?.blockId;
        if (blockIdFromExt && blocks.some((b) => b.id === blockIdFromExt)) return false;
        return true;
      })
      .map((external) => {
        const raw = external.raw as any;
        const privateMeta = raw?.extendedProperties?.private || {};
        const themeCandidate =
          privateMeta.theme
          ?? privateMeta.themeId
          ?? privateMeta.theme_id
          ?? privateMeta['bob-theme']
          ?? privateMeta['bob-theme-id']
          ?? privateMeta['bob_theme_id']
          ?? privateMeta['bob-category']
          ?? privateMeta.category
          ?? privateMeta.themeName
          ?? external.title;
        const appearance = resolveThemeAppearance(themeCandidate);
        return {
          id: external.id,
          title: external.title,
          start: external.start,
          end: external.end,
          type: 'external' as const,
          color: appearance?.color,
          textColor: appearance?.textColor,
          external,
        } satisfies PlannerCalendarEvent;
      });

    return [...externalEventsMapped, ...blockEvents, ...instanceEvents];
  }, [blocks, externalEvents, instances, resolveThemeAppearance, goalColorMap]);

  const eventStyleGetter = useCallback((event: PlannerCalendarEvent) => {
    const overlaps = (a: PlannerCalendarEvent, b: PlannerCalendarEvent) => {
      if (!a || !b) return false;
      return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
    };
    const hasConflict = events.some((e) => e.id !== event.id && overlaps(e, event) && e.type !== 'external' && event.type !== 'external');

    if (event.type === 'external') {
      if (event.color) {
        return {
          className: 'planner-event-external',
          style: { backgroundColor: event.color, borderColor: event.color, color: event.textColor || '#1e3a8a' },
        };
      }
      return {
        className: 'planner-event-external',
        style: { backgroundColor: 'rgba(191, 219, 254, 0.4)', borderColor: '#60a5fa', color: '#1e3a8a' },
      };
    }

    const baseColor = event.color || '#6366f1';
    const textColor = event.textColor || '#ffffff';

    if (event.type === 'instance') {
      const status = event.instance?.status;
      if (status === 'completed') {
        return { style: { backgroundColor: hexToRgba(baseColor, 0.95), borderColor: baseColor, color: textColor } };
      }
      if (status === 'missed' || status === 'cancelled') {
        return { style: { backgroundColor: hexToRgba('#ef4444', 0.9), borderColor: '#dc2626', color: '#ffffff' } };
      }
      if (status === 'unscheduled') {
        return { style: { backgroundColor: hexToRgba(baseColor, 0.18), borderColor: baseColor, color: textColor } };
      }
    }

    // Theme-allocation blocks are lower-commitment than gcal/sprint-forward-planned blocks — render lighter.
    if (event.type === 'block' && String(event.source || '').toLowerCase() === 'theme_allocation') {
      return {
        className: 'planner-event-theme-allocation',
        style: {
          backgroundColor: hexToRgba(baseColor, 0.35),
          borderColor: hexToRgba(baseColor, 0.6),
          color: textColor,
          borderStyle: 'dashed',
        },
      };
    }

    return {
      style: {
        backgroundColor: hexToRgba(baseColor, 0.95),
        borderColor: hasConflict ? '#dc2626' : baseColor,
        boxShadow: hasConflict ? '0 0 0 2px rgba(220,38,38,0.3) inset' : undefined,
        color: textColor,
      },
    };
  }, [events]);

  const syncLinkedEntityDate = useCallback(async (
    link: { storyId?: string | null; taskId?: string | null; id?: string | null },
    start: Date,
    end: Date,
  ) => {
    if (!syncEntityDate) return;
    const itemType: 'story' | 'task' | null = link.storyId ? 'story' : link.taskId ? 'task' : null;
    const itemId = link.storyId || link.taskId;
    if (!itemType || !itemId) return;
    try {
      await schedulePlannerItem({
        itemType,
        itemId,
        targetDateMs: start.getTime(),
        intent: 'move',
        source: 'weekly_planner',
        linkedBlockId: link.id || null,
        exactTargetStartMs: start.getTime(),
        exactTargetEndMs: end.getTime(),
      });
    } catch (err) {
      console.error('Failed to sync planned date to linked entity', err);
      emitFeedback({ variant: 'danger', message: 'Calendar entry moved, but the linked item\'s planned date could not be updated.' });
    }
  }, [syncEntityDate, emitFeedback]);

  const updateBlockTiming = useCallback(async (event: PlannerCalendarEvent, start: Date, end: Date) => {
    if (!event.block) return;
    try {
      const blockRef = doc(db, 'calendar_blocks', event.block.id);
      await updateDoc(blockRef, { start: start.getTime(), end: end.getTime(), updatedAt: Date.now() });
      await syncLinkedEntityDate(event.block, start, end);
      emitFeedback({ variant: 'success', message: 'Calendar entry updated successfully.' });
    } catch (err) {
      console.error('Failed to update block timing', err);
      emitFeedback({ variant: 'danger', message: 'Could not update calendar entry timing. Please try again.' });
    }
  }, [emitFeedback, syncLinkedEntityDate]);

  const updateInstanceTiming = useCallback(async (event: PlannerCalendarEvent, start: Date, end: Date) => {
    if (!event.instance) return;
    try {
      const instanceRef = doc(db, 'scheduled_instances', event.instance.id);
      await updateDoc(instanceRef, {
        plannedStart: start.toISOString(),
        plannedEnd: end.toISOString(),
        occurrenceDate: format(start, 'yyyyMMdd'),
        updatedAt: Date.now(),
      });
      if (event.instance.storyId) {
        await syncLinkedEntityDate({ storyId: event.instance.storyId }, start, end);
      }
      emitFeedback({ variant: 'success', message: 'Scheduled item repositioned.' });
    } catch (err) {
      console.error('Failed to update instance timing', err);
      emitFeedback({ variant: 'danger', message: 'Unable to update scheduled item.' });
    }
  }, [emitFeedback, syncLinkedEntityDate]);

  const updateExternalEventTiming = useCallback(async (event: PlannerCalendarEvent, start: Date, end: Date) => {
    const external = event.external;
    const eventId = external?.id || event.id;
    if (!external || !eventId) {
      emitFeedback({ variant: 'danger', message: 'External event is missing a Google Calendar ID.' });
      return;
    }
    const raw: any = external.raw || {};
    const isAllDay = Boolean(raw?.start?.date) && !raw?.start?.dateTime;
    if (isAllDay) {
      emitFeedback({ variant: 'info', message: 'All-day events must be edited in Google Calendar.' });
      return;
    }
    try {
      const updateEv = httpsCallable(functions, 'updateCalendarEvent');
      await updateEv({ eventId, start: start.toISOString(), end: end.toISOString() });
      emitFeedback({ variant: 'success', message: 'Google Calendar event updated.' });
      await refreshExternalEvents?.();
    } catch (err) {
      console.warn('Failed to update external event', err);
      emitFeedback({ variant: 'danger', message: 'Unable to update Google Calendar event. Edit it in Google Calendar instead.' });
    }
  }, [emitFeedback, refreshExternalEvents]);

  const handleEventMove = useCallback(async ({ event, start, end }: { event: PlannerCalendarEvent; start: Date; end: Date }) => {
    setLastActionPatch({ id: event.id, prevStart: event.start, prevEnd: event.end });
    if (event.type === 'external') {
      await updateExternalEventTiming(event, start, end);
      return;
    }
    if (event.type === 'block') {
      await updateBlockTiming(event, start, end);
      try {
        const block: any = event.block || {};
        if (block.syncToGoogle !== false) {
          const startIso = new Date(start).toISOString();
          const endIso = new Date(end).toISOString();
          if (block.googleEventId) {
            const updateEv = httpsCallable(functions, 'updateCalendarEvent');
            await updateEv({ eventId: block.googleEventId, start: startIso, end: endIso, summary: block.title || 'Calendar entry' });
          }
          try {
            const syncDay = format(start, 'yyyy-MM-dd');
            const pushDay = httpsCallable(functions, 'syncPlanToGoogleCalendar');
            await pushDay({ day: syncDay });
          } catch { /* best-effort gcal metadata refresh */ }
        }
      } catch (err) {
        console.warn('Planner: Google sync failed/skipped for block move', err);
      }
    } else if (event.type === 'instance') {
      await updateInstanceTiming(event, start, end);
      try {
        const startIso = new Date(start).toISOString();
        const endIso = new Date(end).toISOString();
        const eid = event.instance?.external?.gcalEventId;
        if (eid) {
          const updateEv = httpsCallable(functions, 'updateCalendarEvent');
          await updateEv({ eventId: eid, start: startIso, end: endIso });
        } else {
          const createEv = httpsCallable(functions, 'createCalendarEvent');
          const res: any = await createEv({ summary: event.instance?.title || 'Planned Session', start: startIso, end: endIso });
          const newId = res?.data?.event?.id;
          if (newId && event.instance?.id) {
            const ref = doc(db, 'scheduled_instances', event.instance.id);
            await updateDoc(ref, { external: { ...(event.instance.external || {}), gcalEventId: newId, lastSyncedAt: { ...(event.instance.external?.lastSyncedAt || {}), gcal: Date.now() } } });
          }
        }
        try {
          const syncDay = format(start, 'yyyy-MM-dd');
          const pushDay = httpsCallable(functions, 'syncPlanToGoogleCalendar');
          await pushDay({ day: syncDay });
        } catch { /* best-effort gcal metadata refresh */ }
      } catch (err) {
        console.warn('Planner: Google sync failed/skipped for instance move', err);
      }
    }
  }, [updateBlockTiming, updateExternalEventTiming, updateInstanceTiming]);

  const handleEventResize = useCallback(async ({ event, start, end }: { event: PlannerCalendarEvent; start: Date; end: Date }) => {
    await handleEventMove({ event, start, end });
  }, [handleEventMove]);

  return {
    events,
    eventStyleGetter,
    handleEventMove,
    handleEventResize,
    lastActionPatch,
  };
};
