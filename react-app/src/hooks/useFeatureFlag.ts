/**
 * useFeatureFlag / useFeatureFlags
 *
 * Reads feature flags from Firestore `feature_flags/{uid}` merged with
 * `feature_flags/_global`, with hardcoded client-side defaults as fallback.
 *
 * Usage:
 *   const enabled = useFeatureFlag('gcal_linker');
 *   const { flags, loading } = useFeatureFlags();
 */

import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';

/** Flags that are on by default client-side (mirrors featureFlags.js DEFAULT_FLAGS) */
const DEFAULT_FLAGS: Record<string, boolean> = {
  monzo_goal_cost: true,
  finance_guardrail: true,
  gcal_linker: true,
  intent_broker: true,
  capacity_deferral: true,
};

interface FeatureFlagState {
  flags: Record<string, boolean>;
  loading: boolean;
}

let cache: { uid: string; flags: Record<string, boolean>; expiresAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function useFeatureFlags(): FeatureFlagState {
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;

  const [state, setState] = useState<FeatureFlagState>({
    flags: { ...DEFAULT_FLAGS },
    loading: !!uid,
  });

  useEffect(() => {
    if (!uid) {
      setState({ flags: { ...DEFAULT_FLAGS }, loading: false });
      return;
    }

    // Use in-memory cache to avoid repeated reads within the same session
    if (cache && cache.uid === uid && cache.expiresAt > Date.now()) {
      setState({ flags: cache.flags, loading: false });
      return;
    }

    let cancelled = false;

    Promise.all([
      getDoc(doc(db, 'feature_flags', '_global')),
      getDoc(doc(db, 'feature_flags', uid)),
    ])
      .then(([globalSnap, userSnap]) => {
        if (cancelled) return;

        const strip = (data: Record<string, any>) => {
          const copy = { ...data };
          delete copy.updatedAt;
          delete copy.createdAt;
          delete copy.ownerUid;
          return copy as Record<string, boolean>;
        };

        const resolved: Record<string, boolean> = {
          ...DEFAULT_FLAGS,
          ...(globalSnap.exists() ? strip(globalSnap.data() ?? {}) : {}),
          ...(userSnap.exists() ? strip(userSnap.data() ?? {}) : {}),
        };

        cache = { uid, flags: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
        setState({ flags: resolved, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ flags: { ...DEFAULT_FLAGS }, loading: false });
      });

    return () => { cancelled = true; };
  }, [uid]);

  return state;
}

/** Convenience hook for a single flag. Returns true if enabled, false otherwise. */
export function useFeatureFlag(flagName: string): boolean {
  const { flags } = useFeatureFlags();
  return flags[flagName] ?? DEFAULT_FLAGS[flagName] ?? false;
}

export default useFeatureFlag;
