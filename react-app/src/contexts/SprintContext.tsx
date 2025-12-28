import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where, limit, getDocs } from 'firebase/firestore';
import type { FirestoreError } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { usePersona } from './PersonaContext';
import type { Sprint } from '../types';
import logger from '../utils/logger';
import ChoiceMigration from '../config/migration';

const SPRINT_CACHE_NAMESPACE = 'bob_sprint_cache_v1';
const SPRINT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes – keeps dev refresh fast without going stale
// Feature flag: explicitly default to "All Sprints" only when set.
// Default behavior (no flag): auto-select the active sprint for better perf.
const DEFAULT_TO_ALL_SPRINTS = String((typeof process !== 'undefined' && (process as any).env?.REACT_APP_SPRINT_DEFAULT_ALL) || '')
  .toLowerCase() === 'true';

type CachedSprint = Omit<Sprint, 'createdAt' | 'updatedAt'> & {
  createdAt?: string | null;
  updatedAt?: string | null;
};

interface SprintCachePayload {
  uid: string;
  persona: string;
  updatedAt: number;
  sprints: CachedSprint[];
  allSprints: CachedSprint[];
  selectedSprintId?: string;
}

function cacheKey(uid: string, persona: string) {
  return `${SPRINT_CACHE_NAMESPACE}:${uid}:${persona}`;
}

function toCachedSprint(sprint: Sprint): CachedSprint {
  return {
    ...sprint,
    createdAt: sprint.createdAt ? sprint.createdAt.toISOString() : null,
    updatedAt: sprint.updatedAt ? sprint.updatedAt.toISOString() : null,
  };
}

function fromCachedSprint(cached: CachedSprint): Sprint {
  return {
    ...cached,
    status: ChoiceMigration.migrateSprintStatus(cached.status),
    createdAt: cached.createdAt ? new Date(cached.createdAt) : null,
    updatedAt: cached.updatedAt ? new Date(cached.updatedAt) : null,
  };
}

function loadCachedSprints(uid: string, persona: string) {
  try {
    const raw = localStorage.getItem(cacheKey(uid, persona));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SprintCachePayload;
    if (parsed.uid !== uid || parsed.persona !== persona) return null;
    if (Date.now() - parsed.updatedAt > SPRINT_CACHE_TTL_MS) return null;
    return {
      ...parsed,
      sprints: parsed.sprints.map(fromCachedSprint),
      allSprints: parsed.allSprints.map(fromCachedSprint),
    };
  } catch (e) {
    logger.debug('SprintContext', 'failed to load sprint cache', { message: (e as Error)?.message });
    return null;
  }
}

function persistSprintsToCache(uid: string, persona: string, data: { sprints: Sprint[]; allSprints: Sprint[]; selectedSprintId?: string }) {
  try {
    const payload: SprintCachePayload = {
      uid,
      persona,
      updatedAt: Date.now(),
      sprints: data.sprints.map(toCachedSprint),
      allSprints: data.allSprints.map(toCachedSprint),
      selectedSprintId: data.selectedSprintId,
    };
    localStorage.setItem(cacheKey(uid, persona), JSON.stringify(payload));
  } catch (e) {
    logger.debug('SprintContext', 'failed to persist sprint cache', { message: (e as Error)?.message });
  }
}

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
  const didFallbackCheckRef = React.useRef(false);
  const cacheHydratedRef = React.useRef(false);

  // Keep a ref of selectedSprintId to avoid resubscribing when it changes
  const selectedSprintIdRef = React.useRef<string>('');
  useEffect(() => { selectedSprintIdRef.current = selectedSprintId; }, [selectedSprintId]);

  useEffect(() => {
    // If an explicit default-to-all flag is set, keep initial '' and do not hydrate
    if (DEFAULT_TO_ALL_SPRINTS) return;
    const saved = localStorage.getItem('bob_selected_sprint');
    if (saved !== null && saved !== undefined) {
      setSelectedSprintIdState(saved);
    }
  }, []);

  const setSelectedSprintId = React.useCallback((id: string) => {
    setSelectedSprintIdState(id);
    localStorage.setItem('bob_selected_sprint', id);
  }, []);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      cacheHydratedRef.current = false;
      return;
    }

    const cached = loadCachedSprints(currentUser.uid, currentPersona);
    if (cached) {
      cacheHydratedRef.current = true;
      didFallbackCheckRef.current = false;
      setAllSprints(cached.allSprints);
      setSprints(cached.sprints);
      // Respect explicit user preference including "All Sprints" (empty string).
      // Only hydrate from cache if feature flag allows and no local preference key exists at all.
      if (!DEFAULT_TO_ALL_SPRINTS) {
        try {
          const savedPref = localStorage.getItem('bob_selected_sprint');
          if ((savedPref === null || savedPref === undefined) && typeof cached.selectedSprintId === 'string') {
            setSelectedSprintId(cached.selectedSprintId);
          }
        } catch { }
      }
      setError(null);
      setLoading(false);
    } else {
      cacheHydratedRef.current = false;
    }
  }, [currentUser?.uid, currentPersona]);

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setSprints([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(!cacheHydratedRef.current);
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

    try { performance.mark('sprints_subscribe_start'); } catch { }
    const unsubscribe = onSnapshot(
      sprintQuery,
      (snapshot) => {
        try { performance.mark('sprints_first_snapshot'); performance.measure('sprints_attach', 'sprints_subscribe_start', 'sprints_first_snapshot'); } catch { }
        const data = snapshot.docs.map((doc) => {
          const raw = doc.data() as any;
          return {
            id: doc.id,
            ...raw,
            status: ChoiceMigration.migrateSprintStatus(raw.status),
            startDate: normalizeTime(raw.startDate) ?? 0,
            endDate: normalizeTime(raw.endDate) ?? 0,
            planningDate: normalizeTime(raw.planningDate) ?? 0,
            retroDate: normalizeTime(raw.retroDate) ?? 0,
            createdAt: normalizeTimestamp(raw.createdAt),
            updatedAt: normalizeTimestamp(raw.updatedAt),
          } as Sprint;
        });
        setAllSprints(data);

        const currentSelected = selectedSprintIdRef.current;
        setSprints(data);
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
        } catch { }

        let nextSelectedId = selectedSprintIdRef.current;
        // Default to active sprint (first in deduped) when there is no saved preference
        // and the current selection is empty/undefined/null.
        const savedPref = (() => { try { return localStorage.getItem('bob_selected_sprint'); } catch { return null; } })();
        const noSavedPreference = savedPref === null || savedPref === undefined;
        if ((!nextSelectedId || nextSelectedId === '') && noSavedPreference && data.length > 0) {
          nextSelectedId = data[0].id;
          setSelectedSprintId(nextSelectedId);
        } else if (nextSelectedId && !data.some((s) => s.id === nextSelectedId)) {
          const replacement = data[0];
          if (replacement) {
            nextSelectedId = replacement.id;
            setSelectedSprintId(nextSelectedId);
          }
        }

        if (currentUser?.uid && currentPersona) {
          persistSprintsToCache(currentUser.uid, currentPersona, {
            sprints: data,
            allSprints: data,
            selectedSprintId: nextSelectedId,
          });
          cacheHydratedRef.current = true;
        }

        // Dev-only guardrail: if persona-scoped query returns 0 with no error,
        // probe ownerUid-only to detect orphaned/mismatched persona docs and log guidance.
        if (
          process.env.REACT_APP_SPRINT_DEV_GUARDRAIL === 'true' &&
          !didFallbackCheckRef.current &&
          deduped.length === 0
        ) {
          didFallbackCheckRef.current = true;
          (async () => {
            try {
              const ownerOnly = query(
                collection(db, 'sprints'),
                where('ownerUid', '==', currentUser.uid),
                orderBy('startDate', 'desc'),
                limit(20)
              );
              const snap = await getDocs(ownerOnly);
              const allMine = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              const personaMismatch = allMine.filter((d) => (d as any).persona !== currentPersona);
              if (allMine.length > 0 && personaMismatch.length > 0) {
                logger.warn('SprintContext', 'Detected sprints owned by user but not matching current persona. Consider backfilling persona.', {
                  totalOwned: allMine.length,
                  mismatchedCount: personaMismatch.length,
                  currentPersona,
                });
              }
            } catch (e: any) {
              logger.warn('SprintContext', 'Owner-only probe failed', { code: e?.code, message: e?.message });
            }
          })();
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
  }, [currentUser?.uid, currentPersona]);

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
    } catch { }
  }, [sprints.length]);

  const contextValue = React.useMemo(() => ({
    selectedSprintId,
    setSelectedSprintId,
    sprints,
    sprintsById,
    loading,
    error,
  }), [selectedSprintId, setSelectedSprintId, sprints, sprintsById, loading, error]);

  console.log('[SprintProvider] RENDERING');

  return (
    <SprintContext.Provider value={contextValue}>
      {children}
    </SprintContext.Provider>
  );
};

export const useSprint = (): SprintContextValue => {
  const ctx = useContext(SprintContext);
  if (!ctx) throw new Error('useSprint must be used within SprintProvider');
  return ctx;
};

export { };
