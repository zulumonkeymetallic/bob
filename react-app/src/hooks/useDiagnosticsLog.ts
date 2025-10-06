import { useEffect, useState } from 'react';
import type { LogLevel } from '../utils/logger';

export interface DiagnosticsEntry {
  id: string;
  timestamp: number;
  level: LogLevel;
  channel: string;
  message: string;
  details?: string;
  context?: Record<string, unknown>;
}

const STORAGE_KEY = 'bob:diagnostics:v1';
const MAX_ENTRIES = 100;

const listeners = new Set<(entries: DiagnosticsEntry[]) => void>();

const hasWindow = typeof window !== 'undefined';

const readStorage = (): DiagnosticsEntry[] => {
  if (!hasWindow) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry) => entry && typeof entry.id === 'string');
    }
  } catch {
    /* ignore */
  }
  return [];
};

const writeStorage = (entries: DiagnosticsEntry[]) => {
  if (!hasWindow) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* ignore */
  }
};

const emit = (entries: DiagnosticsEntry[]) => {
  listeners.forEach((listener) => {
    try {
      listener(entries);
    } catch {
      /* swallow */
    }
  });
};

export const pushDiagnosticLog = (entry: Omit<DiagnosticsEntry, 'id'>) => {
  const current = readStorage();
  const nextEntry: DiagnosticsEntry = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ...entry,
  };
  const next = [nextEntry, ...current].slice(0, MAX_ENTRIES);
  writeStorage(next);
  emit(next);
};

export const clearDiagnosticsLog = () => {
  writeStorage([]);
  emit([]);
};

export const useDiagnosticsLog = () => {
  const [entries, setEntries] = useState<DiagnosticsEntry[]>(() => readStorage());

  useEffect(() => {
    const listener = (next: DiagnosticsEntry[]) => setEntries(next);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return {
    entries,
    clear: clearDiagnosticsLog,
    snapshot: () => readStorage(),
  };
};

export default useDiagnosticsLog;
