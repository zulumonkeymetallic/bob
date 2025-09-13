import { useEffect, useState, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { GLOBAL_THEMES, type GlobalTheme } from '../constants/globalThemes';

let warnedOnce = false;

export const useGlobalThemes = () => {
  const { currentUser } = useAuth();
  const [themes, setThemes] = useState<GlobalTheme[]>(GLOBAL_THEMES);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const ref = doc(db, 'global_themes', currentUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as any;
        if (Array.isArray(data.themes) && data.themes.length) {
          setThemes(data.themes as GlobalTheme[]);
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
      setThemes(GLOBAL_THEMES);
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    load();
  }, [load]);

  return { themes, loading, error, refresh: load };
};

export default useGlobalThemes;
