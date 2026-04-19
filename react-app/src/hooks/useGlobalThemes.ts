import { useEffect, useState, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { GLOBAL_THEMES, type GlobalTheme } from '../constants/globalThemes';

let warnedOnce = false;
const themeCacheKey = (uid: string) => `bob-global-theme-definitions:${uid}`;

const mergeThemeDefinitions = (saved?: GlobalTheme[] | null): GlobalTheme[] => {
  if (!Array.isArray(saved) || saved.length === 0) return GLOBAL_THEMES;
  const savedById = new Map(saved.map((t) => [t.id, t]));
  const merged = GLOBAL_THEMES.map((t) => savedById.get(t.id) || t);
  const extras = saved.filter((t) => !GLOBAL_THEMES.find((d) => d.id === t.id));
  return extras.length ? [...merged, ...extras] : merged;
};

const readCachedThemes = (uid?: string | null): GlobalTheme[] | null => {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(themeCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as GlobalTheme[];
  } catch {
    return null;
  }
};

const writeCachedThemes = (uid?: string | null, themes?: GlobalTheme[]): void => {
  if (!uid || !Array.isArray(themes) || themes.length === 0) return;
  try {
    localStorage.setItem(themeCacheKey(uid), JSON.stringify(themes));
  } catch {
    // Ignore local storage failures (private mode/quota)
  }
};

export const useGlobalThemes = () => {
  const { currentUser } = useAuth();
  const [themes, setThemes] = useState<GlobalTheme[]>(GLOBAL_THEMES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser?.uid) {
      setThemes(GLOBAL_THEMES);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const ref = doc(db, 'global_themes', currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as any;
        if (Array.isArray(data.themes) && data.themes.length) {
          const merged = mergeThemeDefinitions(data.themes as GlobalTheme[]);
          setThemes(merged);
          writeCachedThemes(currentUser.uid, merged);
        } else {
          setThemes(GLOBAL_THEMES);
        }
      } else {
        setThemes(GLOBAL_THEMES);
      }
    } catch (e: any) {
      if (!warnedOnce) {
        console.warn('useGlobalThemes: failed to load themes; falling back to defaults', e);
        warnedOnce = true;
      }
      setError(e?.message || 'Failed to load themes');
      const cached = readCachedThemes(currentUser.uid);
      setThemes(mergeThemeDefinitions(cached));
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser?.uid) {
      setThemes(GLOBAL_THEMES);
      setLoading(false);
      return;
    }
    const cached = readCachedThemes(currentUser.uid);
    if (cached) {
      setThemes(mergeThemeDefinitions(cached));
    }
    load();
  }, [currentUser?.uid, load]);

  return { themes, loading, error, refresh: load };
};

export default useGlobalThemes;
