import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  orderBy,
  limit,
} from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { usePersona } from './PersonaContext';

// ============================================================
// BOB Unified Data Context
// Purpose: Replace scattered onSnapshot() listeners with
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
  refreshCollection: (collectionName: string) => Promise<void>;
  isStale: (collectionName: string, maxAgeSeconds?: number) => boolean;
  subscribeToEntity: <T>(collectionName: string, entityId: string) => T | undefined;
}

const BobDataContext = createContext<BobDataContextType | undefined>(undefined);

export const BobDataProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const { currentPersona } = usePersona();

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

  useEffect(() => {
    if (!currentUser?.uid || !currentPersona) {
      setState(s => ({ ...s, goals: [], stories: [], tasks: [], sprints: [], calendarBlocks: [], themeAllocations: [], loading: false }));
      return;
    }

    const uid = currentUser.uid;

    let unsubGoals: (() => void) | null = null;
    let unsubStories: (() => void) | null = null;
    let unsubTasks: (() => void) | null = null;
    let unsubSprints: (() => void) | null = null;
    let unsubCalendar: (() => void) | null = null;
    let unsubThemes: (() => void) | null = null;

    // Goals - persona-scoped
    try {
      unsubGoals = onSnapshot(
        query(collection(db, 'goals'), where('ownerUid', '==', uid), where('persona', '==', currentPersona), orderBy('createdAt', 'desc')),
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

    // Stories - persona-scoped, limit 500
    try {
      unsubStories = onSnapshot(
        query(collection(db, 'stories'), where('ownerUid', '==', uid), where('persona', '==', currentPersona), orderBy('createdAt', 'desc'), limit(500)),
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

    // Tasks - persona-scoped
    try {
      unsubTasks = onSnapshot(
        query(collection(db, 'tasks'), where('ownerUid', '==', uid), where('persona', '==', currentPersona), orderBy('dueDate', 'asc'), limit(1000)),
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

    // Sprints - persona-scoped
    try {
      unsubSprints = onSnapshot(
        query(collection(db, 'sprints'), where('ownerUid', '==', uid), where('persona', '==', currentPersona), orderBy('startDate', 'desc'), limit(60)),
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

    // Calendar blocks - owner-scoped (not persona-specific), limit 200
    try {
      unsubCalendar = onSnapshot(
        query(collection(db, 'calendar_blocks'), where('ownerUid', '==', uid), orderBy('start', 'asc'), limit(200)),
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

    // Theme allocations - owner-scoped
    try {
      unsubThemes = onSnapshot(
        query(collection(db, 'theme_allocations'), where('ownerUid', '==', uid), orderBy('dateKey', 'desc')),
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
  }, [currentUser?.uid, currentPersona]);

  const refreshCollection = useCallback(async (_collectionName: string) => {
    setState(s => ({ ...s, loading: true }));
    setTimeout(() => setState(s => ({ ...s, loading: false })), 500);
  }, []);

  const isStale = useCallback((collectionName: string, maxAgeSeconds: number = 60) => {
    const timestamp = timestamps[collectionName];
    if (!timestamp) return true;
    return (Date.now() - timestamp) > (maxAgeSeconds * 1000);
  }, [timestamps]);

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
    const col = collectionMap[collectionName];
    return col?.find(item => item.id === entityId) as T | undefined;
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
