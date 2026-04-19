import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { format } from 'date-fns';
import { db, functions } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { CalendarBlock } from '../types';
import {
  schedulerCollections,
  type ChoreModel,
  type RoutineModel,
  type ScheduledInstanceModel,
} from '../domain/scheduler/repository';

export interface PlannerRange {
  start: Date;
  end: Date;
}

export interface ExternalCalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  calendarId?: string;
  location?: string;
  source: 'google' | 'outlook' | 'manual';
  raw?: Record<string, unknown>;
}

interface PlannerDataState {
  blocks: CalendarBlock[];
  instances: ScheduledInstanceModel[];
  chores: ChoreModel[];
  routines: RoutineModel[];
  externalEvents: ExternalCalendarEvent[];
  loading: boolean;
  error: Error | null;
  refreshExternalEvents: () => Promise<void>;
  requestPlanningRun: (options?: PlannerPlanningOptions) => Promise<string | undefined>;
}

export interface PlannerPlanningOptions {
  startDate?: string;
  days?: number;
  timezone?: string;
  includeBusy?: boolean;
}

const listUpcomingEventsCallable = () => httpsCallable(functions, 'listUpcomingEvents');
const planBlocksCallable = () => httpsCallable(functions, 'planBlocksV2');

export const useUnifiedPlannerData = (range: PlannerRange | null): PlannerDataState => {
  const { currentUser } = useAuth();
  const mountedRef = useRef(true);

  const [blocks, setBlocks] = useState<CalendarBlock[]>([]);
  const [instances, setInstances] = useState<ScheduledInstanceModel[]>([]);
  const [chores, setChores] = useState<ChoreModel[]>([]);
  const [routines, setRoutines] = useState<RoutineModel[]>([]);
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>([]);

  const [blocksLoading, setBlocksLoading] = useState(false);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [choresLoading, setChoresLoading] = useState(false);
  const [routinesLoading, setRoutinesLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const ownerUid = currentUser?.uid;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!ownerUid) {
      setBlocks([]);
      setBlocksLoading(false);
      return;
    }

    setBlocksLoading(true);
    const q = query(
      collection(db, 'calendar_blocks'),
      where('ownerUid', '==', ownerUid),
      orderBy('start', 'asc'),
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as any) })) as CalendarBlock[];
        setBlocks(rows);
        setBlocksLoading(false);
      },
      (err) => {
        setError(err);
        setBlocks([]);
        setBlocksLoading(false);
      },
    );

    return () => unsubscribe();
  }, [ownerUid]);

  useEffect(() => {
    if (!ownerUid || !range) {
      setInstances([]);
      setInstancesLoading(false);
      return;
    }

    setInstancesLoading(true);

    const startKey = format(range.start, 'yyyyMMdd');
    const endKey = format(range.end, 'yyyyMMdd');

    const unsubscribe = onSnapshot(
      schedulerCollections.userInstancesRange(db, ownerUid, startKey, endKey),
      (snap) => {
        const rows = snap.docs.map((doc) => doc.data());
        setInstances(rows);
        setInstancesLoading(false);
      },
      (err) => {
        setError(err);
        setInstances([]);
        setInstancesLoading(false);
      },
    );

    return () => unsubscribe();
  }, [ownerUid, range]);

  useEffect(() => {
    if (!ownerUid) {
      setChores([]);
      setChoresLoading(false);
      return;
    }

    setChoresLoading(true);
    const unsubscribe = onSnapshot(
      schedulerCollections.userChores(db, ownerUid),
      (snap) => {
        const rows = snap.docs.map((doc) => doc.data());
        setChores(rows);
        setChoresLoading(false);
      },
      (err) => {
        setError(err);
        setChores([]);
        setChoresLoading(false);
      },
    );

    return () => unsubscribe();
  }, [ownerUid]);

  useEffect(() => {
    if (!ownerUid) {
      setRoutines([]);
      setRoutinesLoading(false);
      return;
    }

    setRoutinesLoading(true);
    const unsubscribe = onSnapshot(
      schedulerCollections.userRoutines(db, ownerUid),
      (snap) => {
        const rows = snap.docs.map((doc) => doc.data());
        setRoutines(rows);
        setRoutinesLoading(false);
      },
      (err) => {
        setError(err);
        setRoutines([]);
        setRoutinesLoading(false);
      },
    );

    return () => unsubscribe();
  }, [ownerUid]);

  const refreshExternalEvents = useCallback(async () => {
    if (!ownerUid) {
      setExternalEvents([]);
      return;
    }

    setGoogleLoading(true);
    try {
      const callable = listUpcomingEventsCallable();
      const response = await callable({ maxResults: 100 });
      const raw = response.data as any;
      const events = Array.isArray(raw?.items)
        ? (raw.items as any[])
        : [];
      if (!mountedRef.current) return;
      setExternalEvents(
        events
          .map((item) => {
            try {
              const startDate = item.start?.dateTime || item.start?.date;
              const endDate = item.end?.dateTime || item.end?.date;
              if (!startDate || !endDate) return null;
              return {
                id: item.id || `${item.summary}-${startDate}`,
                title: item.summary || 'Untitled event',
                start: new Date(startDate),
                end: new Date(endDate),
                location: item.location || undefined,
                calendarId: item.organizer?.email || undefined,
                source: 'google' as const,
                raw: item,
              } satisfies ExternalCalendarEvent;
            } catch (err) {
              console.warn('Failed to map external event', err);
              return null;
            }
          })
          .filter(Boolean) as ExternalCalendarEvent[],
      );
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!mountedRef.current) return;
      setGoogleLoading(false);
    }
  }, [ownerUid]);

  useEffect(() => {
    refreshExternalEvents().catch((err) => {
      console.warn('Initial external event sync failed', err);
    });
  }, [refreshExternalEvents]);

  const requestPlanningRun = useCallback<PlannerDataState['requestPlanningRun']>(
    async (options = {}) => {
      if (!ownerUid) return undefined;
      const callable = planBlocksCallable();
      const response = await callable({ ...options });
      const data = response.data as any;
      return data?.solverRunId as string | undefined;
    },
    [ownerUid],
  );

  const loading = useMemo(
    () =>
      blocksLoading ||
      instancesLoading ||
      choresLoading ||
      routinesLoading ||
      googleLoading,
    [blocksLoading, instancesLoading, choresLoading, routinesLoading, googleLoading],
  );

  return {
    blocks,
    instances,
    chores,
    routines,
    externalEvents,
    loading,
    error,
    refreshExternalEvents,
    requestPlanningRun,
  };
};
