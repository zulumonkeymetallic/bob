import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface CapacityResult {
  data: any | null;
  loading: boolean;
  error: string | null;
}

const cache = new Map<string, any>();

const loadCapacity = async (sprintId: string) => {
  if (cache.has(sprintId)) return cache.get(sprintId);
  const fn = httpsCallable(functions, 'calculateSprintCapacity');
  const response = await fn({ sprintId });
  cache.set(sprintId, response.data);
  return response.data;
};

const clearCapacityForSprint = (sprintId: string) => {
  cache.delete(sprintId);
};

export const useSprintCapacity = (sprintId?: string): CapacityResult => {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sprintId) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    loadCapacity(sprintId)
      .then((result) => {
        if (!active) return;
        setData(result);
      })
      .catch((err) => {
        if (!active) return;
        console.error('Capacity hook error', err);
        setError(err?.message || 'Failed to load capacity data.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      clearCapacityForSprint(sprintId);
    };
  }, [sprintId]);

  return { data, loading, error };
};
