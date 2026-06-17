import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  orderBy,
  limit,
  DocumentData
} from 'firebase/firestore';
import { db } from '../firebase';

// ============================================================
// BOB Unified Data Context
// Purpose: Replace 500+ scattered onSnapshot() listeners with
//          a single centralised subscription manager per user.
// Created: May 2026 (Firebase cost optimisation)
// ============================================================

interface Story { id: string; ref?: string; title?: string; [key: string]: any; }
interface Task { id: string; ref?: string; title?: string; [key: string]: any; }
interface Goal { id: string; ref?: string; title?: string; [key: string]: any; }
interface Sprint { id: string; ref?: string; title?: string; [key: string]: any; }
interface CalendarBlock { id: string; [key: string]: any; }

interface BobDataState {
  goals: Goal[];
  stories: Story[];
  tasks: Task[];
  sprints: Sprint[];
  calendarBlocks: CalendarBlock[];
  themeAllocations: any[];
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
}

interface BobDataContextType extends BobDataState {
  // Manual refresh for pull-to-refresh pattern
  refreshCollection: (collectionName: string) => Promise<void>;
  // Check if data is stale (> N seconds old)
  isStale: (collectionName: string, maxAgeSeconds?: number) => boolean;
  // Subscribe to specific entity by ID (for detail views)
  subscribeToEntity: <T>(
    collectionName: string, 
    entityId: string
  ) => T | undefined;
}

const BobDataContext = createContext<BobDataContextType | undefined>(undefined);

const COLLECTION_CACHE_AGE = {
  goals: 30 * 60,           // 30 min
  stories: 15 * 60,         // 15 min  
  tasks: 60,                // 1 min (high frequency updates)
  sprints: 30 * 60,         // 30 min
  calendarBlocks: 30,       // 30 sec (very dynamic)
  themeAllocations: 60 * 60 // 1 hour
};

export const BobDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<BobDataState>({
    goals: [],
    stories: [],
    tasks: [],
    sprints: [],
    calendarBlocks: [],
    themeAllocations: [],
    loading: true,
    error: null,
    lastUpdated: null
  });

  const [timestamps, setTimestamps] = useState<Record<string, number>>({});

  // Centralised subscription manager
  useEffect(() => {
    let unsubGoals: (() => void) | null = null;
    let unsubStories: (() => void) | null = null;
    let unsubTasks: (() => void) | null = null;
    let unsubSprints: (() => void) | null = null;
    let unsubCalendar: (() => void) | null = null;
    let unsubThemes: (() => void) | null = null;

    const initialiseSubscriptions = async () => {
      // Wait for auth to settle
      const authModule = await import('../contexts/AuthContext');
      const { useAuth } = authModule;
      
      // This won't work directly in useEffect - need different approach
      console.log('[BobData] Initialising centralised subscriptions...');
    };

    // For now, basic setup - will be enhanced with proper auth handling
    const uid = localStorage.getItem('bob_current_user_uid') as string | null;
    if (!uid) {
      setState(s => ({ ...s, loading: false }));
      return;
    }

    // Goals - low frequency, cache-friendly
    try {
      const goalsQuery = query(
        collection(db, 'goals'),
        where('ownerUid', '==', uid),
        orderBy('createdAt', 'desc')
      );
      unsubGoals = onSnapshot(
        goalsQuery,
        (snap) => {
          const goals = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Goal) }));
          setState(s => ({ ...s, goals, lastUpdated: Date.now() }));
          setTimestamps(t => ({ ...t, goals: Date.now() }));
        },
        (err) => console.warn('[BobData] Goals snapshot error:', err?.message)
      );
    } catch (error) {
      console.error('[BobData] Failed to subscribe to goals:', error);
    }

    // Stories
    try {
      const storiesQuery = query(
        collection(db, 'stories'),
        where('ownerUid', '==', uid),
        orderBy('createdAt', 'desc'),
        limit(500)
      );
      unsubStories = onSnapshot(
        storiesQuery,
        (snap) => {
          const stories = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Story) }));
          setState(s => ({ ...s, stories, lastUpdated: Date.now() }));
          setTimestamps(t => ({ ...t, stories: Date.now() }));
        },
        (err) => console.warn('[BobData] Stories snapshot error:', err?.message)
      );
    } catch (error) {
      console.error('[BobData] Failed to subscribe to stories:', error);
    }

    // Tasks - higher frequency
    try {
      const tasksQuery = query(
        collection(db, 'tasks'),
        where('ownerUid', '==', uid),
        orderBy('dueDate', 'asc'),
        limit(1000)
      );
      unsubTasks = onSnapshot(
        tasksQuery,
        (snap) => {
          const tasks = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Task) }));
          setState(s => ({ ...s, tasks, loading: false, lastUpdated: Date.now() }));
          setTimestamps(t => ({ ...t, tasks: Date.now() }));
        },
        (err) => console.warn('[BobData] Tasks snapshot error:', err?.message)
      );
    } catch (error) {
      console.error('[BobData] Failed to subscribe to tasks:', error);
    }

    // Sprints
    try {
      const sprintsQuery = query(
        collection(db, 'sprints'),
        where('ownerUid', '==', uid),
        orderBy('startDate', 'desc')
      );
      unsubSprints = onSnapshot(
        sprintsQuery,
        (snap) => {
          const sprints = snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Sprint) }));
          setState(s => ({ ...s, sprints, lastUpdated: Date.now() }));
          setTimestamps(t => ({ ...t, sprints: Date.now() }));
        },
        (err) => console.warn('[BobData] Sprints snapshot error:', err?.message)
      );
    } catch (error) {
      console.error('[BobData] Failed to subscribe to sprints:', error);
    }

    // Calendar blocks - very dynamic
    try {
      const calendarQuery = query(
        collection(db, 'calendar_blocks'),
        where('ownerUid', '==', uid),
        orderBy('start', 'asc'),
        limit(200)
      );
      unsubCalendar = onSnapshot(
        calendarQuery,
        (snap) => {
          const blocks = snap.docs.map((doc) => ({ id: doc.id, ownerUid: uid, updatedAt: Date.now(), ...(doc.data() as CalendarBlock) }));
          setState(s => ({ ...s, calendarBlocks: blocks, lastUpdated: Date.now() }));
          setTimestamps(t => ({ ...t, calendarBlocks: Date.now() }));
        },
        (err) => console.warn('[BobData] Calendar blocks snapshot error:', err?.message)
      );
    } catch (error) {
      console.error('[BobData] Failed to subscribe to calendar_blocks:', error);
    }

    // Theme allocations
    try {
      const themesQuery = query(
        collection(db, 'theme_allocations'),
        where('ownerUid', '==', uid),
        orderBy('dateKey', 'desc')
      );
      unsubThemes = onSnapshot(
        themesQuery,
        (snap) => {
          const themes = snap.docs.map((doc) => ({ id: doc.id, ownerUid: uid, updatedAt: Date.now(), ...(doc.data()) }));
          setState(s => ({ ...s, themeAllocations: themes, loading: false, lastUpdated: Date.now() }));
          setTimestamps(t => ({ ...t, themeAllocations: Date.now() }));
        },
        (err) => console.warn('[BobData] Theme allocations snapshot error:', err?.message)
      );
    } catch (error) {
      console.error('[BobData] Failed to subscribe to theme_allocations:', error);
    }

    return () => {
      unsubGoals?.();
      unsubStories?.();
      unsubTasks?.();
      unsubSprints?.();
      unsubCalendar?.();
      unsubThemes?.();
    };
  }, []);

  // Manual refresh helper (for pull-to-refresh)
  const refreshCollection = useCallback(async (collectionName: string) => {
    setState(s => ({ ...s, loading: true }));
    // Trigger re-render, real data comes from live subscription
    setTimeout(() => setState(s => ({ ...s, loading: false })), 500);
  }, []);

  // Staleness check
  const isStale = useCallback((collectionName: string, maxAgeSeconds: number = 60) => {
    const timestamp = timestamps[collectionName];
    if (!timestamp) return true;
    return (Date.now() - timestamp) > (maxAgeSeconds * 1000);
  }, [timestamps]);

  // Entity lookup (avoid individual subscriptions)
  const subscribeToEntity = useCallback(<T,>(
    collectionName: string,
    entityId: string
  ): T | undefined => {
    const collectionMap: Record<string, any[]> = {
      goals: state.goals,
      stories: state.stories,
      tasks: state.tasks,
      sprints: state.sprints,
      calendar_blocks: state.calendarBlocks,
    };
    const collection = collectionMap[collectionName];
    return collection?.find(item => item.id === entityId) as T | undefined;
  }, [state]);

  const contextValue: BobDataContextType = {
    ...state,
    refreshCollection,
    isStale,
    subscribeToEntity
  };

  return (
    <BobDataContext.Provider value={contextValue}>
      {children}
    </BobDataContext.Provider>
  );
};

export const useBobData = (): BobDataContextType => {
  const context = useContext(BobDataContext);
  if (!context) {
    throw new Error('useBobData must be used within a BobDataProvider');
  }
  return context;
};
