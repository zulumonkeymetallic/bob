import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMinutes,
  differenceInMinutes,
  format,
  getDay,
  parse,
  startOfWeek,
  startOfDay,
  endOfDay,
} from 'date-fns';
import { enGB } from 'date-fns/locale';
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Card,
  Col,
  Container,
  Form,
  Modal,
  Row,
  Spinner,
} from 'react-bootstrap';
import {
  Calendar as CalendarIcon,
  CheckCircle,
  Clock,
  ExternalLink,
  Link as LinkIcon,
  ListChecks,
  RefreshCw,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Calendar as RBC, Views, dateFnsLocalizer } from 'react-big-calendar';
import withDragAndDrop from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import { useUnifiedPlannerData, type PlannerRange } from '../../hooks/useUnifiedPlannerData';
import type { ExternalCalendarEvent } from '../../hooks/useUnifiedPlannerData';
import { useAuth } from '../../contexts/AuthContext';
import { db, functions } from '../../firebase';
import { httpsCallable } from 'firebase/functions';
import {
  addDoc,
  collection,
  doc,
  updateDoc,
} from 'firebase/firestore';
import type { CalendarBlock } from '../../types';
import type { ScheduledInstanceModel } from '../../domain/scheduler/repository';
import { humanizePolicyMode } from '../../utils/schedulerPolicy';
import '../../styles/unified-planner.css';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGlobalThemes } from '../../hooks/useGlobalThemes';
import { LEGACY_THEME_MAP } from '../../constants/globalThemes';
import { pushDiagnosticLog } from '../../hooks/useDiagnosticsLog';

const locales = { 'en-GB': enGB } as const;
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales,
});

const DragAndDropCalendar = withDragAndDrop(RBC as any);

const FALLBACK_THEME_COLORS: Record<string, string> = {
  Health: '#22c55e',
  Growth: '#3b82f6',
  Wealth: '#eab308',
  Tribe: '#8b5cf6',
  Home: '#f97316',
};

interface PlannerCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  type: 'block' | 'instance' | 'external';
  color?: string;
  textColor?: string;
  themeLabel?: string;
  block?: CalendarBlock;
  instance?: ScheduledInstanceModel;
  external?: ExternalCalendarEvent;
}

interface BlockFormState {
  id?: string;
  title: string;
  theme: CalendarBlock['theme'];
  category: CalendarBlock['category'];
  flexibility: CalendarBlock['flexibility'];
  rationale: string;
  start: string;
  end: string;
  syncToGoogle: boolean;
  subTheme: string;
}

const DEFAULT_BLOCK_FORM: BlockFormState = {
  title: 'Focus Block',
  theme: 'Health',
  category: 'Fitness',
  flexibility: 'soft',
  rationale: '',
  start: '',
  end: '',
  syncToGoogle: false,
  subTheme: '',
};

type ViewType = 'day' | 'week' | 'month';

const getInitialRange = (): PlannerRange => {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const end = addDays(start, 6);
  return { start, end };
};

const toInputValue = (date: Date) => format(date, "yyyy-MM-dd'T'HH:mm");

const formatInstanceTime = (instance: ScheduledInstanceModel) => {
  try {
    if (instance.plannedStart && instance.plannedEnd) {
      const start = new Date(instance.plannedStart);
      const end = new Date(instance.plannedEnd);
      return `${format(start, 'HH:mm')} - ${format(end, 'HH:mm')}`;
    }
    if (instance.plannedStart) {
      return format(new Date(instance.plannedStart), 'HH:mm');
    }
    return 'Flexible window';
  } catch (err) {
    console.warn('Failed to format instance window', err);
    return 'Flexible window';
  }
};

const statusVariant = (status: ScheduledInstanceModel['status']) => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'missed':
    case 'cancelled':
      return 'danger';
    case 'unscheduled':
      return 'warning';
    case 'committed':
      return 'primary';
    default:
      return 'secondary';
  }
};

const hexToRgba = (hex: string, alpha: number) => {
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

const UnifiedPlannerPage: React.FC = () => {
  const { currentUser } = useAuth();
  const { themes: globalThemes } = useGlobalThemes();

  const legacyThemeNameById = useMemo(() => {
    const map = new Map<number, string>();
    (Object.entries(LEGACY_THEME_MAP) as Array<[string, number]>).forEach(([legacyName, themeId]) => {
      if (!map.has(themeId)) {
        map.set(themeId, legacyName);
      }
    });
    return map;
  }, []);

  const themeOptions = useMemo(
    () => {
      if (globalThemes.length === 0) {
        return Object.entries(FALLBACK_THEME_COLORS).map(([value, color]) => ({
          id: value,
          value,
          label: value,
          color,
          textColor: '#ffffff',
        }));
      }

      return globalThemes.map((theme) => {
        const legacyName = legacyThemeNameById.get(theme.id);
        const value = legacyName || theme.name || String(theme.id);
        return {
          id: theme.id,
          value,
          label: theme.label || theme.name || value,
          color: theme.color || FALLBACK_THEME_COLORS[legacyName || theme.name] || '#0ea5e9',
          textColor: theme.textColor || '#ffffff',
        };
      });
    },
    [globalThemes, legacyThemeNameById],
  );

  const themePalette = useMemo(() => {
    const palette = new Map<string, { color: string; textColor: string; label: string }>();

    themeOptions.forEach((option) => {
      palette.set(option.value, { color: option.color, textColor: option.textColor, label: option.label });
    });

    globalThemes.forEach((theme) => {
      const color = theme.color || '#0ea5e9';
      const textColor = theme.textColor || '#ffffff';
      const label = theme.label || theme.name || String(theme.id);
      if (theme.name) palette.set(theme.name, { color, textColor, label });
      palette.set(label, { color, textColor, label });
      palette.set(String(theme.id), { color, textColor, label });
    });

    Object.entries(FALLBACK_THEME_COLORS).forEach(([legacy, color]) => {
      if (!palette.has(legacy)) {
        palette.set(legacy, { color, textColor: '#ffffff', label: legacy });
      }
    });

    return palette;
  }, [globalThemes, themeOptions]);

  const blockDefaultTheme = useMemo(
    () => themeOptions[0]?.value ?? DEFAULT_BLOCK_FORM.theme,
    [themeOptions],
  );

  const resolveThemeAppearance = useCallback(
    (themeValue?: string | number | null) => {
      if (themeValue == null) return undefined;
      const direct = themePalette.get(String(themeValue));
      if (direct) return direct;

      const normalized = String(themeValue).trim().toLowerCase();
      // Attempt a case-insensitive match
      for (const [key, appearance] of themePalette.entries()) {
        if (key.toLowerCase() === normalized) {
          return appearance;
        }
      }
      return undefined;
    },
    [themePalette],
  );

  const [range, setRange] = useState<PlannerRange>(() => getInitialRange());
  const [view, setView] = useState<ViewType>(Views.WEEK as ViewType);
  const [blockForm, setBlockForm] = useState<BlockFormState>(() => ({
    ...DEFAULT_BLOCK_FORM,
    theme: blockDefaultTheme as CalendarBlock['theme'],
  }));
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerSaving, setComposerSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'danger' | 'info'; message: string } | null>(null);
  const [activeEvent, setActiveEvent] = useState<PlannerCalendarEvent | null>(null);
  const [planning, setPlanning] = useState(false);
  const [rebalanceLoading, setRebalanceLoading] = useState(false);

  useEffect(() => {
    setBlockForm((prev) => {
      if (prev.id) return prev;
      if (resolveThemeAppearance(prev.theme)) return prev;
      if (prev.theme === blockDefaultTheme) return prev;
      return { ...prev, theme: blockDefaultTheme as CalendarBlock['theme'] };
    });
  }, [blockDefaultTheme, resolveThemeAppearance]);

  const planner = useUnifiedPlannerData(range);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const state = ((location as unknown) as { state?: { focus?: string } | null }).state ?? null;
    if (!state?.focus) return;

    if (state.focus === 'today' || state.focus === 'checklist') {
      const today = new Date();
      setView('day');
      setRange({ start: startOfDay(today), end: endOfDay(today) });
    }

    navigate(location.pathname, { replace: true, state: null });
  }, [location, navigate]);

  const events: PlannerCalendarEvent[] = useMemo(() => {
    const blockEvents = planner.blocks.map((block) => {
      const start = new Date(block.start);
      const end = new Date(block.end);
      const title = (block as any).title || `${block.category} • ${block.theme}`;
      const appearance = resolveThemeAppearance(block.theme || block.subTheme);
      return {
        id: block.id,
        title,
        start,
        end,
        type: 'block' as const,
        color: appearance?.color || FALLBACK_THEME_COLORS[block.theme] || '#14b8a6',
        textColor: appearance?.textColor || '#ffffff',
        themeLabel: appearance?.label,
        block,
      } satisfies PlannerCalendarEvent;
    });

    const instanceEvents = planner.instances
      .filter((instance) => instance.plannedStart || instance.occurrenceDate)
      .map((instance) => {
        const block = instance.blockId ? planner.blocks.find((b) => b.id === instance.blockId) : undefined;
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

    const externalEvents = planner.externalEvents.map((external) => ({
      id: external.id,
      title: external.title,
      start: external.start,
      end: external.end,
      type: 'external' as const,
      external,
    } satisfies PlannerCalendarEvent));

    return [...externalEvents, ...blockEvents, ...instanceEvents];
  }, [planner.blocks, planner.externalEvents, planner.instances, resolveThemeAppearance]);

  const scheduledToday = useMemo(() => {
    const todayKey = format(new Date(), 'yyyyMMdd');
    return planner.instances.filter((instance) => instance.occurrenceDate === todayKey);
  }, [planner.instances]);

  const completionRate = useMemo(() => {
    if (scheduledToday.length === 0) return 0;
    const completed = scheduledToday.filter((instance) => instance.status === 'completed').length;
    return Math.round((completed / scheduledToday.length) * 100);
  }, [scheduledToday]);

  const unscheduledItems = useMemo(
    () => planner.instances.filter((instance) => instance.status === 'unscheduled'),
    [planner.instances],
  );

  const topChores = useMemo(() => planner.chores.slice(0, 5), [planner.chores]);
  const topRoutines = useMemo(() => planner.routines.slice(0, 5), [planner.routines]);

  const resetComposer = useCallback(() => {
    setBlockForm({
      ...DEFAULT_BLOCK_FORM,
      theme: blockDefaultTheme as CalendarBlock['theme'],
    });
    setComposerOpen(false);
    setComposerSaving(false);
  }, [blockDefaultTheme]);

  const handleRangeChange = useCallback(
    (nextRange: any) => {
      if (Array.isArray(nextRange) && nextRange.length > 0) {
        const start = nextRange[0];
        const end = nextRange[nextRange.length - 1];
        setRange({ start: new Date(start), end: new Date(end) });
      } else if (nextRange?.start && nextRange?.end) {
        setRange({ start: new Date(nextRange.start), end: new Date(nextRange.end) });
      }
    },
    [],
  );

  const openComposerForSlot = useCallback((start: Date, end: Date) => {
    setBlockForm({
      ...DEFAULT_BLOCK_FORM,
      theme: blockDefaultTheme as CalendarBlock['theme'],
      start: toInputValue(start),
      end: toInputValue(end),
    });
    setComposerOpen(true);
  }, [blockDefaultTheme]);

  const openComposerForBlock = useCallback((block: CalendarBlock) => {
    const mergedTheme = resolveThemeAppearance(block.theme)
      ? block.theme
      : blockDefaultTheme;
    setBlockForm({
      id: block.id,
      title: (block as any).title || `${block.category} • ${block.theme}`,
      theme: mergedTheme as CalendarBlock['theme'],
      category: block.category,
      flexibility: block.flexibility,
      rationale: block.rationale || '',
      start: toInputValue(new Date(block.start)),
      end: toInputValue(new Date(block.end)),
      syncToGoogle: Boolean((block as any).syncToGoogle),
      subTheme: block.subTheme || '',
    });
    setComposerOpen(true);
  }, [blockDefaultTheme, resolveThemeAppearance]);

  const handleSelectSlot = useCallback(
    ({ start, end }: { start: Date; end: Date }) => {
      if (!currentUser) return;
      const safeEnd = end && differenceInMinutes(end, start) > 0 ? end : addMinutes(start, 60);
      openComposerForSlot(start, safeEnd);
    },
    [currentUser, openComposerForSlot],
  );

  const handleSelectEvent = useCallback((event: PlannerCalendarEvent) => {
    setActiveEvent(event);
    if (event.type === 'block' && event.block) {
      openComposerForBlock(event.block);
    }
  }, [openComposerForBlock]);

  const updateBlockTiming = useCallback(
    async (event: PlannerCalendarEvent, start: Date, end: Date) => {
      if (!event.block) return;
      try {
        const blockRef = doc(db, 'calendar_blocks', event.block.id);
        await updateDoc(blockRef, {
          start: start.getTime(),
          end: end.getTime(),
          updatedAt: Date.now(),
        });
        setFeedback({ variant: 'success', message: 'Block updated successfully.' });
      } catch (err) {
        console.error('Failed to update block timing', err);
        setFeedback({ variant: 'danger', message: 'Could not update block timing. Please try again.' });
      }
    },
    [],
  );

  const updateInstanceTiming = useCallback(
    async (event: PlannerCalendarEvent, start: Date, end: Date) => {
      if (!event.instance) return;
      try {
        const instanceRef = doc(db, 'scheduled_instances', event.instance.id);
        await updateDoc(instanceRef, {
          plannedStart: start.toISOString(),
          plannedEnd: end.toISOString(),
          occurrenceDate: format(start, 'yyyyMMdd'),
          updatedAt: Date.now(),
        });
        setFeedback({ variant: 'success', message: 'Scheduled item repositioned.' });
      } catch (err) {
        console.error('Failed to update instance timing', err);
        setFeedback({ variant: 'danger', message: 'Unable to update scheduled item.' });
      }
    },
    [],
  );

  const handleEventMove = useCallback(
    async ({ event, start, end }: { event: PlannerCalendarEvent; start: Date; end: Date }) => {
      if (event.type === 'external') {
        setFeedback({ variant: 'info', message: 'Editing external events happens in Google Calendar.' });
        return;
      }
      if (event.type === 'block') {
        await updateBlockTiming(event, start, end);
        // Optional Google Calendar sync for blocks marked to sync
        try {
          const block: any = event.block || {};
          if (block.syncToGoogle) {
            const startIso = new Date(start).toISOString();
            const endIso = new Date(end).toISOString();
            if (block.googleEventId) {
              const updateEv = httpsCallable(functions, 'updateCalendarEvent');
              await updateEv({ eventId: block.googleEventId, start: startIso, end: endIso });
            } else {
              const createEv = httpsCallable(functions, 'createCalendarEvent');
              const res: any = await createEv({ summary: block.title || 'Focus Block', start: startIso, end: endIso });
              const evId = res?.data?.event?.id;
              if (evId && block.id) {
                await updateDoc(doc(db, 'calendar_blocks', block.id), { googleEventId: evId, updatedAt: Date.now() });
              }
            }
            // Ensure extendedProperties and metadata are refreshed via server push for this day
            try {
              const syncDay = format(start, 'yyyy-MM-dd');
              const pushDay = httpsCallable(functions, 'syncPlanToGoogleCalendar');
              await pushDay({ day: syncDay });
            } catch {}
          }
        } catch (err) {
          console.warn('Planner: Google sync failed/skipped for block move', err);
        }
      } else if (event.type === 'instance') {
        await updateInstanceTiming(event, start, end);
        // Try to reflect instance move to Google Calendar if linked
        try {
          const startIso = new Date(start).toISOString();
          const endIso = new Date(end).toISOString();
          const eid = event.instance?.external?.gcalEventId;
          if (eid) {
            const updateEv = httpsCallable(functions, 'updateCalendarEvent');
            await updateEv({ eventId: eid, start: startIso, end: endIso });
          } else {
            // Create event if missing and store id back into scheduled_instances.external.gcalEventId
            const createEv = httpsCallable(functions, 'createCalendarEvent');
            const res: any = await createEv({ summary: event.instance?.title || 'Planned Session', start: startIso, end: endIso });
            const newId = res?.data?.event?.id;
            if (newId && event.instance?.id) {
              const ref = doc(db, 'scheduled_instances', event.instance.id);
              await updateDoc(ref, { external: { ...(event.instance.external || {}), gcalEventId: newId, lastSyncedAt: { ...(event.instance.external?.lastSyncedAt || {}), gcal: Date.now() } } });
            }
          }
          // Also refresh block parent metadata for this day
          try {
            const syncDay = format(start, 'yyyy-MM-dd');
            const pushDay = httpsCallable(functions, 'syncPlanToGoogleCalendar');
            await pushDay({ day: syncDay });
          } catch {}
        } catch (err) {
          console.warn('Planner: Google sync failed/skipped for instance move', err);
        }
      }
    },
    [updateBlockTiming, updateInstanceTiming],
  );

  const handleEventResize = useCallback(
    async ({ event, start, end }: { event: PlannerCalendarEvent; start: Date; end: Date }) => {
      await handleEventMove({ event, start, end });
    },
    [handleEventMove],
  );

  const handleComposerSubmit = useCallback(async () => {
    if (!currentUser) return;
    if (!blockForm.start || !blockForm.end) return;

    const start = new Date(blockForm.start);
    const end = new Date(blockForm.end);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      setFeedback({ variant: 'danger', message: 'Please provide valid dates for the block.' });
      return;
    }

    if (end <= start) {
      setFeedback({ variant: 'danger', message: 'End time must be after start time.' });
      return;
    }

    setComposerSaving(true);

    const makeDedupeKey = (title: string, startMs: number, endMs: number) => {
      const raw = `${currentUser?.uid || ''}:${Math.round(startMs/60000)}:${Math.round(endMs/60000)}:${(title||'').slice(0,24)}`;
      let h = 0; for (let i=0;i<raw.length;i++) h = (h*33 + raw.charCodeAt(i)) >>> 0;
      return h.toString(36);
    };

    const payload: Record<string, unknown> = {
      googleEventId: null,
      syncToGoogle: blockForm.syncToGoogle,
      taskId: null,
      goalId: null,
      storyId: null,
      habitId: null,
      subTheme: blockForm.subTheme || null,
      persona: 'personal',
      theme: blockForm.theme,
      category: blockForm.category,
      start: start.getTime(),
      end: end.getTime(),
      dedupeKey: makeDedupeKey(blockForm.title, start.getTime(), end.getTime()),
      flexibility: blockForm.flexibility,
      status: 'proposed',
      colorId: null,
      visibility: 'default',
      createdBy: 'user',
      rationale: blockForm.rationale || null,
      version: 1,
      supersededBy: null,
      ownerUid: currentUser.uid,
      title: blockForm.title,
      updatedAt: Date.now(),
    };

    try {
      if (blockForm.id) {
        const ref = doc(db, 'calendar_blocks', blockForm.id);
        await updateDoc(ref, payload);
        setFeedback({ variant: 'success', message: 'Block updated successfully.' });
      } else {
        const ref = collection(db, 'calendar_blocks');
        const now = Date.now();
        await addDoc(ref, {
          ...payload,
          createdAt: now,
        });
        setFeedback({ variant: 'success', message: 'New block created.' });
      }
      resetComposer();
    } catch (err) {
      console.error('Failed to save block', err);
      pushDiagnosticLog({
        channel: 'ai-planner',
        level: 'error',
        timestamp: Date.now(),
        message: 'Failed to save focus block configuration.',
        details: err instanceof Error ? err.message : String(err),
      });
      setFeedback({ variant: 'danger', message: 'Unable to save the block. Please try again.' });
    } finally {
      setComposerSaving(false);
    }
  }, [blockForm, currentUser, resetComposer]);

  const handleInstanceStatusChange = useCallback(
    async (instance: ScheduledInstanceModel, status: ScheduledInstanceModel['status']) => {
      try {
        const ref = doc(db, 'scheduled_instances', instance.id);
        await updateDoc(ref, {
          status,
          statusUpdatedAt: Date.now(),
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.error('Failed to update instance status', err);
        setFeedback({ variant: 'danger', message: 'Could not update checklist item. Try again.' });
      }
    },
    [],
  );

  const handleAutoPlan = useCallback(async () => {
    setPlanning(true);
    try {
      const solverRunId = await planner.requestPlanningRun({
        startDate: format(range.start, 'yyyy-MM-dd'),
        days: 3,
        includeBusy: true,
      });
      if (solverRunId) {
        setFeedback({ variant: 'success', message: `AI planning queued (run ${solverRunId.slice(0, 8)}…).` });
      } else {
        setFeedback({ variant: 'info', message: 'AI planning triggered. Check back in a few moments.' });
      }
    } catch (err) {
      console.error('AI planning failed', err);
      pushDiagnosticLog({
        channel: 'ai-planner',
        level: 'error',
        timestamp: Date.now(),
        message: 'AI scheduler returned an error while auto-planning.',
        details: err instanceof Error ? err.message : String(err),
        context: {
          startDate: format(range.start, 'yyyy-MM-dd'),
          days: 3,
        },
      });
      setFeedback({ variant: 'danger', message: 'AI scheduler is unavailable right now. Please retry shortly.' });
    } finally {
      setPlanning(false);
    }
  }, [planner, range.start]);

  const eventStyleGetter = useCallback((event: PlannerCalendarEvent) => {
    if (event.type === 'external') {
      return {
        style: {
          backgroundColor: 'rgba(37, 99, 235, 0.12)',
          borderColor: '#1d4ed8',
          color: '#1d4ed8',
        },
      };
    }

    const baseColor = event.color || '#6366f1';
    const textColor = event.textColor || '#ffffff';

    if (event.type === 'instance') {
      const status = event.instance?.status;
      if (status === 'completed') {
        return {
          style: {
            backgroundColor: hexToRgba(baseColor, 0.85),
            borderColor: baseColor,
            color: textColor,
          },
        };
      }
      if (status === 'missed' || status === 'cancelled') {
        return {
          style: {
            backgroundColor: hexToRgba('#ef4444', 0.9),
            borderColor: '#dc2626',
            color: '#ffffff',
          },
        };
      }
      if (status === 'unscheduled') {
        return {
          style: {
            backgroundColor: hexToRgba(baseColor, 0.18),
            borderColor: baseColor,
            color: textColor,
          },
        };
      }
    }

    return {
      style: {
        backgroundColor: hexToRgba(baseColor, 0.85),
        borderColor: baseColor,
        color: textColor,
      },
    };
  }, []);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const handleRebalanceNextDay = useCallback(async () => {
    setRebalanceLoading(true);
    try {
      const solverRunId = await planner.requestPlanningRun({ days: 1, includeBusy: true });
      if (solverRunId) {
        setFeedback({ variant: 'success', message: `24h rebalance queued (run ${solverRunId.slice(0, 8)}…).` });
      } else {
        setFeedback({ variant: 'info', message: 'AI is recalibrating the next 24 hours.' });
      }
    } catch (err) {
      console.error('Failed to rebalance planner window', err);
      pushDiagnosticLog({
        channel: 'ai-planner',
        level: 'warn',
        timestamp: Date.now(),
        message: 'Failed to trigger 24h planner rebalance.',
        details: err instanceof Error ? err.message : String(err),
      });
      setFeedback({ variant: 'danger', message: 'Could not trigger the 24h rebalance. Try again shortly.' });
    } finally {
      setRebalanceLoading(false);
    }
  }, [planner]);

  return (
    <Container fluid className="py-4 unified-planner">
      <Row className="g-4">
        <Col lg={8} xl={9}>
          <Card className="shadow-sm border-0 h-100">
            <Card.Header className="d-flex flex-wrap align-items-center justify-content-between gap-3">
              <div className="d-flex align-items-center gap-3">
                <span className="planner-icon-circle">
                  <CalendarIcon size={18} />
                </span>
                <div>
                  <div className="fw-semibold">Unified Planner</div>
                  <small className="text-muted">
                    Drag, drop, and orchestrate your day across Google Calendar, AI routines, and focus blocks.
                  </small>
                </div>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={() => planner.refreshExternalEvents()}
                  disabled={planner.loading}
                >
                  <RefreshCw size={16} className="me-1" /> Sync Google
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAutoPlan}
                  disabled={planner.loading || planning}
                >
                  {planning ? (
                    <Spinner size="sm" animation="border" className="me-2" />
                  ) : (
                    <Sparkles size={16} className="me-1" />
                  )}
                  Auto-plan with AI
                </Button>
              </div>
            </Card.Header>
            {feedback && (
              <Alert
                variant={feedback.variant}
                onClose={clearFeedback}
                dismissible
                className="mb-0 rounded-0"
              >
                {feedback.message}
              </Alert>
            )}
            <Card.Body className="p-0">
              {planner.loading && events.length === 0 ? (
                <div className="calendar-placeholder d-flex align-items-center justify-content-center text-muted flex-column py-5">
                  <Spinner animation="border" size="sm" className="mb-2" />
                  <div>Loading planner data…</div>
                </div>
              ) : (
                <div className="planner-calendar-wrapper">
                  <div className="d-flex justify-content-between align-items-center px-3 py-2 border-bottom">
                    <div className="d-flex align-items-center gap-2">
                      <ButtonGroup size="sm">
                        <Button
                          variant={view === Views.DAY ? 'primary' : 'outline-primary'}
                          onClick={() => setView(Views.DAY as ViewType)}
                        >
                          Day
                        </Button>
                        <Button
                          variant={view === Views.WEEK ? 'primary' : 'outline-primary'}
                          onClick={() => setView(Views.WEEK as ViewType)}
                        >
                          Week
                        </Button>
                        <Button
                          variant={view === Views.MONTH ? 'primary' : 'outline-primary'}
                          onClick={() => setView(Views.MONTH as ViewType)}
                        >
                          Month
                        </Button>
                      </ButtonGroup>
                    </div>
                    <Button size="sm" variant="outline-primary" onClick={() => openComposerForSlot(new Date(), addMinutes(new Date(), 60))}>
                      + New Block
                    </Button>
                  </div>
                  <DragAndDropCalendar
                    localizer={localizer}
                    events={events}
                    view={view}
                    defaultView={Views.WEEK}
                    date={range.start}
                    onView={(next) => setView(next as ViewType)}
                    onRangeChange={handleRangeChange}
                    selectable
                    resizable
                    step={30}
                    popup
                    onEventDrop={handleEventMove}
                    onEventResize={handleEventResize}
                    onSelectSlot={handleSelectSlot}
                    onSelectEvent={handleSelectEvent}
                    eventPropGetter={eventStyleGetter}
                    style={{ height: 'calc(100vh - 220px)' }}
                    min={new Date(1970, 1, 1, 5, 0)}
                    max={new Date(1970, 1, 1, 23, 30)}
                    formats={{
                      timeGutterFormat: (date) => format(date, 'HH:mm'),
                      eventTimeRangeFormat: ({ start, end }) => `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')}`,
                    }}
                  />
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
        <Col lg={4} xl={3}>
          <Card className="shadow-sm border-0 mb-4">
            <Card.Header className="d-flex align-items-center justify-content-between">
              <div className="fw-semibold d-flex align-items-center gap-2">
                <ListChecks size={18} /> Today&apos;s Focus
              </div>
              <Badge bg={completionRate === 100 ? 'success' : completionRate > 0 ? 'info' : 'secondary'} pill>
                {completionRate}%
              </Badge>
            </Card.Header>
            <Card.Body className="p-3 d-flex flex-column gap-3">
              {scheduledToday.length === 0 ? (
                <div className="text-muted small">AI hasn&apos;t planned anything today. Press “Auto-plan with AI” to populate your calendar.</div>
              ) : (
                scheduledToday.map((instance) => {
                  const isCompleted = instance.status === 'completed';
                  return (
                    <div key={instance.id} className={`focus-item p-3 rounded ${isCompleted ? 'completed' : ''}`}>
                      <div className="d-flex justify-content-between align-items-start">
                        <div>
                          <div className="fw-semibold">{instance.title || instance.sourceId}</div>
                          <div className="text-muted small d-flex align-items-center gap-2">
                            <Clock size={14} /> {formatInstanceTime(instance)}
                          </div>
                        </div>
                        <Badge bg={statusVariant(instance.status)}>{instance.status}</Badge>
                      </div>
                      <div className="d-flex gap-2 mt-2">
                        <Form.Check
                          type="checkbox"
                          id={`instance-${instance.id}`}
                          label="Completed"
                          checked={isCompleted}
                          onChange={(event) =>
                            handleInstanceStatusChange(
                              instance,
                              event.target.checked ? 'completed' : 'planned',
                            )
                          }
                        />
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => handleInstanceStatusChange(instance, 'missed')}
                        >
                          Skip
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </Card.Body>
          </Card>

          <Card className="shadow-sm border-0 mb-4">
            <Card.Header className="fw-semibold">AI Automations & Suggestions</Card.Header>
            <Card.Body className="d-flex flex-column gap-3">
              <div>
                <div className="text-uppercase text-muted small fw-semibold mb-1">Pending insertions</div>
                {unscheduledItems.length === 0 ? (
                  <div className="text-muted small">AI has placed all chores and routines. Great job!</div>
                ) : (
                  <ul className="list-unstyled small mb-0">
                    {unscheduledItems.map((item) => {
                      const typeLabel = item.sourceType.charAt(0).toUpperCase() + item.sourceType.slice(1);
                      const policyLabel = item.schedulingContext?.policyMode
                        ? humanizePolicyMode(item.schedulingContext.policyMode)
                        : null;
                      const reasonLabel = item.statusReason || 'Waiting for block';
                      return (
                        <li key={item.id} className="border rounded p-2 mb-2">
                          <div className="d-flex justify-content-between align-items-start gap-2">
                            <div className="d-flex flex-column">
                              <span className="fw-semibold">{item.title || item.sourceId}</span>
                              <span className="text-muted small">{typeLabel}{policyLabel ? ` · ${policyLabel}` : ''}</span>
                              {reasonLabel && (
                                <span className="text-warning small">{reasonLabel}</span>
                              )}
                            </div>
                            <Badge bg="warning" text="dark">{typeLabel}</Badge>
                          </div>
                          {(item.deepLink || item.mobileCheckinUrl) && (
                            <div className="d-flex gap-2 flex-wrap mt-2">
                              {item.deepLink && (
                                <Button
                                  as="a"
                                  href={item.deepLink}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  size="sm"
                                  variant="outline-primary"
                                >
                                  <LinkIcon size={14} className="me-1" /> Open item
                                </Button>
                              )}
                              {item.mobileCheckinUrl && (
                                <Button
                                  as="a"
                                  href={item.mobileCheckinUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  size="sm"
                                  variant="outline-success"
                                >
                                  <Smartphone size={14} className="me-1" /> Check-in
                                </Button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-uppercase text-muted small fw-semibold mb-1">Top priorities</div>
                {topChores.length === 0 && topRoutines.length === 0 ? (
                  <div className="text-muted small">No recurring chores or routines defined yet.</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {topChores.map((chore) => (
                      <div key={chore.id} className="d-flex justify-content-between small chore-pill">
                        <div>
                          <div className="fw-semibold">{chore.title}</div>
                          <div className="text-muted">Priority P{chore.priority}</div>
                        </div>
                        <Badge bg="info">Chore</Badge>
                      </div>
                    ))}
                    {topRoutines.map((routine) => (
                      <div key={routine.id} className="d-flex justify-content-between small chore-pill">
                        <div>
                          <div className="fw-semibold">{routine.title}</div>
                          <div className="text-muted">Target {routine.dailyTarget ?? 1}</div>
                        </div>
                        <Badge bg="success">Routine</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button
                variant="outline-primary"
                size="sm"
                onClick={handleRebalanceNextDay}
                disabled={rebalanceLoading}
              >
                {rebalanceLoading ? <Spinner size="sm" animation="border" className="me-1" /> : null}
                Rebalance next 24h
              </Button>
            </Card.Body>
          </Card>

          {activeEvent && (
            <Card className="shadow-sm border-0">
              <Card.Header className="fw-semibold">Event details</Card.Header>
              <Card.Body className="d-flex flex-column gap-3">
                <div>
                  <div className="fw-semibold">{activeEvent.title}</div>
                  <div className="text-muted small">
                    {format(activeEvent.start, 'EEE, MMM d • HH:mm')} – {format(activeEvent.end, 'HH:mm')}
                  </div>
                </div>
                {activeEvent.type === 'external' && activeEvent.external?.raw?.htmlLink && (
                  <Button
                    as="a"
                    href={String(activeEvent.external.raw.htmlLink)}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    variant="outline-secondary"
                  >
                    <ExternalLink size={16} className="me-1" /> Open in Google Calendar
                  </Button>
                )}
                {activeEvent.type === 'instance' && activeEvent.instance && (
                  <>
                    <div className="d-flex gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => handleInstanceStatusChange(activeEvent.instance!, 'completed')}
                      >
                        <CheckCircle size={16} className="me-1" /> Mark done
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-secondary"
                        onClick={() => handleInstanceStatusChange(activeEvent.instance!, 'missed')}
                      >
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={async () => {
                          const s = addMinutes(new Date(activeEvent.start), 15);
                          const e = addMinutes(new Date(activeEvent.end), 15);
                          await handleEventMove({ event: activeEvent, start: s, end: e });
                        }}
                      >
                        Shift +15m
                      </Button>
                    </div>
                    {(activeEvent.instance.deepLink || activeEvent.instance.mobileCheckinUrl) && (
                      <div className="d-flex gap-2 flex-wrap">
                        {activeEvent.instance.deepLink && (
                          <Button
                            as="a"
                            href={activeEvent.instance.deepLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="sm"
                            variant="outline-primary"
                          >
                            <LinkIcon size={16} className="me-1" /> Open item
                          </Button>
                        )}
                        {activeEvent.instance.mobileCheckinUrl && (
                          <Button
                            as="a"
                            href={activeEvent.instance.mobileCheckinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="sm"
                            variant="outline-success"
                          >
                            <Smartphone size={16} className="me-1" /> Mobile check-in
                          </Button>
                        )}
                      </div>
                    )}
                    {activeEvent.themeLabel && (
                      <div className="text-muted small">
                        Theme{' '}
                        <Badge bg="light" text="dark">{activeEvent.themeLabel}</Badge>
                      </div>
                    )}
                    <div className="text-muted small">
                      Status: {activeEvent.instance.status
                        .replace(/_/g, ' ')
                        .replace(/\b\w/g, (char) => char.toUpperCase())}
                    </div>
                    {activeEvent.instance.schedulingContext?.policyMode && (
                      <div className="text-muted small">
                        Policy: {humanizePolicyMode(activeEvent.instance.schedulingContext.policyMode)}
                      </div>
                    )}
                    {activeEvent.instance.status === 'unscheduled' && activeEvent.instance.statusReason && (
                      <div className="text-warning small">
                        Reason: {activeEvent.instance.statusReason}
                      </div>
                    )}
                  </>
                )}
                {activeEvent.type === 'block' && activeEvent.block && (
                  <>
                    <div className="text-muted small">
                      Theme{' '}
                      <Badge bg="light" text="dark">
                        {activeEvent.themeLabel || activeEvent.block.theme}
                      </Badge>
                    </div>
                    <div className="d-flex gap-2 mt-2">
                      <Button
                        size="sm"
                        variant="outline-primary"
                        onClick={async () => {
                          const s = addMinutes(new Date(activeEvent.start), 15);
                          const e = addMinutes(new Date(activeEvent.end), 15);
                          await handleEventMove({ event: activeEvent, start: s, end: e });
                        }}
                      >
                        Shift +15m
                      </Button>
                    </div>
                  </>
                )}
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>

      <Modal show={composerOpen} onHide={resetComposer} centered>
        <Modal.Header closeButton>
          <Modal.Title>{blockForm.id ? 'Edit focus block' : 'New focus block'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form className="d-flex flex-column gap-3">
            <Form.Group>
              <Form.Label>Title</Form.Label>
              <Form.Control
                value={blockForm.title}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, title: event.target.value }))}
              />
            </Form.Group>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Theme</Form.Label>
                  <Form.Select
                    value={blockForm.theme}
                    onChange={(event) => setBlockForm((prev) => ({ ...prev, theme: event.target.value as CalendarBlock['theme'] }))}
                  >
                    {themeOptions.map((theme) => (
                      <option key={theme.value} value={theme.value}>
                        {theme.label}
                      </option>
                    ))}
                  </Form.Select>
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Category</Form.Label>
                  <Form.Select
                    value={blockForm.category}
                    onChange={(event) => setBlockForm((prev) => ({ ...prev, category: event.target.value as CalendarBlock['category'] }))}
                  >
                    <option value="Fitness">Fitness</option>
                    <option value="Wellbeing">Wellbeing</option>
                    <option value="Tribe">Tribe</option>
                    <option value="Chores">Chores</option>
                    <option value="Gaming">Gaming</option>
                    <option value="Sauna">Sauna</option>
                    <option value="Sleep">Sleep</option>
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>
            <Row className="g-3">
              <Col md={6}>
                <Form.Group>
                  <Form.Label>Start</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={blockForm.start}
                    onChange={(event) => setBlockForm((prev) => ({ ...prev, start: event.target.value }))}
                  />
                </Form.Group>
              </Col>
              <Col md={6}>
                <Form.Group>
                  <Form.Label>End</Form.Label>
                  <Form.Control
                    type="datetime-local"
                    value={blockForm.end}
                    onChange={(event) => setBlockForm((prev) => ({ ...prev, end: event.target.value }))}
                  />
                </Form.Group>
              </Col>
            </Row>
            <Form.Group>
              <Form.Label>Notes / rationale</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={blockForm.rationale}
                onChange={(event) => setBlockForm((prev) => ({ ...prev, rationale: event.target.value }))}
              />
            </Form.Group>
            <Form.Check
              type="switch"
              id="planner-sync-switch"
              label="Sync with Google Calendar"
              checked={blockForm.syncToGoogle}
              onChange={(event) => setBlockForm((prev) => ({ ...prev, syncToGoogle: event.target.checked }))}
            />
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={resetComposer}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleComposerSubmit} disabled={composerSaving}>
            {composerSaving ? <Spinner size="sm" animation="border" /> : 'Save block'}
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
};

export default UnifiedPlannerPage;
