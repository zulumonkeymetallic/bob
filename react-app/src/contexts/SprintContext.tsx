import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit } from 'firebase/firestore';
import type { FirestoreError } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { usePersona } from './PersonaContext';
import type { Sprint } from '../types';
import logger from '../utils/logger';

interface SprintContextValue {
  selectedSprintId: string;
  setSelectedSprintId: (id: string) => void;
  sprints: Sprint[];
  sprintsById: Record<string, Sprint>;
  loading: boolean;
  error: FirestoreError | null;
}

const SprintContext = createContext<SprintContextValue | undefined>(undefined);

export const SprintProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedSprintId, setSelectedSprintIdState] = useState<string>('');
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [allSprints, setAllSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<FirestoreError | null>(null);

  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

  useEffect(() => {
    const saved = localStorage.getItem('bob_selected_sprint');
    if (saved) setSelectedSprintIdState(saved);
  }, []);

  const setSelectedSprintId = (id: string) => {
    setSelectedSprintIdState(id);
    localStorage.setItem('bob_selected_sprint', id);
  };

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setSprints([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    logger.debug('SprintContext', 'subscribing to sprints', {
      uid: currentUser?.uid,
      persona: currentPersona,
    });

    const sprintQuery = query(
      collection(db, 'sprints'),
      where('ownerUid', '==', currentUser.uid),
      where('persona', '==', currentPersona),
      orderBy('startDate', 'desc'),
      limit(60)
    );

    const normalizeTime = (value: any): number | null => {
      if (value === null || value === undefined) return null;
      if (typeof value === 'number') return value;
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
      }
      if (typeof value === 'object') {
        if (typeof value.toMillis === 'function') return value.toMillis();
        if (typeof value.toDate === 'function') {
          const date = value.toDate();
          return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : null;
        }
      }
      return null;
    };

    const normalizeTimestamp = (value: any): Date | null => {
      if (!value) return null;
      if (value instanceof Date) return value;
      if (typeof value.toDate === 'function') return value.toDate();
      const millis = normalizeTime(value);
      if (millis === null) return null;
      return new Date(millis);
    };

    try { performance.mark('sprints_subscribe_start'); } catch {}
    const unsubscribe = onSnapshot(
      sprintQuery,
      (snapshot) => {
        try { performance.mark('sprints_first_snapshot'); performance.measure('sprints_attach', 'sprints_subscribe_start', 'sprints_first_snapshot'); } catch {}
        const data = snapshot.docs.map((doc) => {
          const raw = doc.data() as any;
          return {
            id: doc.id,
            ...raw,
            startDate: normalizeTime(raw.startDate) ?? 0,
            endDate: normalizeTime(raw.endDate) ?? 0,
            planningDate: normalizeTime(raw.planningDate) ?? 0,
            retroDate: normalizeTime(raw.retroDate) ?? 0,
            createdAt: normalizeTimestamp(raw.createdAt),
            updatedAt: normalizeTimestamp(raw.updatedAt),
          } as Sprint;
        });
        setAllSprints(data);

        const now = Date.now();
        const activeSprint =
          data.find((s) => (s.status ?? 0) === 1) ||
          data.find((s) => {
            if (!s.startDate || !s.endDate) return false;
            return s.startDate <= now && s.endDate >= now;
          }) ||
          null;

        const upcoming = data
          .filter((s) => s.id !== activeSprint?.id && (s.startDate ?? 0) >= now)
          .sort((a, b) => (a.startDate ?? 0) - (b.startDate ?? 0))
          .slice(0, 5);

        let trimmed: Sprint[] = [];
        if (activeSprint) {
          trimmed = [activeSprint, ...upcoming];
        } else {
          trimmed = upcoming.slice(0, 6);
        }

        if (trimmed.length < 6) {
          const fillers = data
            .filter((s) => !trimmed.some((t) => t.id === s.id))
            .sort((a, b) => (b.startDate ?? 0) - (a.startDate ?? 0))
            .slice(0, 6 - trimmed.length);
          trimmed = [...trimmed, ...fillers];
        }

        if (selectedSprintId) {
          const selected = data.find((s) => s.id === selectedSprintId);
          if (selected && !trimmed.some((s) => s.id === selectedSprintId)) {
            trimmed = [selected, ...trimmed];
          }
        }

        // Deduplicate while preserving order
        const seen = new Set<string>();
        const deduped: Sprint[] = [];
        for (const sprint of trimmed) {
          if (seen.has(sprint.id)) continue;
          seen.add(sprint.id);
          deduped.push(sprint);
        }

        setSprints(deduped);
        setLoading(false);
        setError(null);

        // Log performance and clear marks
        try {
          const attachEntries = performance.getEntriesByName('sprints_attach');
          const last = attachEntries[attachEntries.length - 1];
          if (last) {
            logger.debug('perf', 'sprints_attach', { durationMs: Math.round(last.duration), count: deduped.length });
          }
          performance.clearMarks('sprints_subscribe_start');
          performance.clearMarks('sprints_first_snapshot');
          performance.clearMeasures('sprints_attach');
        } catch {}

        if (!selectedSprintId && deduped.length > 0) {
          setSelectedSprintId(deduped[0].id);
        } else if (
          selectedSprintId &&
          !deduped.some((s) => s.id === selectedSprintId)
        ) {
          const replacement = deduped[0];
          if (replacement) {
            setSelectedSprintId(replacement.id);
          }
        }
      },
      (err) => {
        logger.error('SprintContext', 'sprint query failed', {
          code: err.code,
          message: err.message,
          uid: currentUser?.uid,
          persona: currentPersona,
        });
        setError(err);
        setSprints([]);
        setAllSprints([]);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser?.uid, currentPersona, selectedSprintId]);

  const sprintsById = useMemo(() => {
    const map: Record<string, Sprint> = {};
    for (const sprint of allSprints.length ? allSprints : sprints) {
      map[sprint.id] = sprint;
    }
    return map;
  }, [allSprints, sprints]);

  // Rough timing for when sprints are available to consumers (selector render path)
  useEffect(() => {
    try {
      if (sprints.length > 0) {
        performance.mark('sprints_render');
        const routeStart = performance.getEntriesByName('route_start');
        if (routeStart.length) {
          performance.measure('sprints_hydrate', 'route_start', 'sprints_render');
          const entries = performance.getEntriesByName('sprints_hydrate');
          const last = entries[entries.length - 1];
          if (last) logger.debug('perf', 'sprints_hydrate', { durationMs: Math.round(last.duration), count: sprints.length });
          performance.clearMeasures('sprints_hydrate');
        }
        performance.clearMarks('sprints_render');
      }
    } catch {}
  }, [sprints.length]);

  return (
    <SprintContext.Provider
      value={{
        selectedSprintId,
        setSelectedSprintId,
        sprints,
        sprintsById,
        loading,
        error,
      }}
    >
      {children}
    </SprintContext.Provider>
  );
};

export const useSprint = (): SprintContextValue => {
  const ctx = useContext(SprintContext);
  if (!ctx) throw new Error('useSprint must be used within SprintProvider');
  return ctx;
};

export {};
