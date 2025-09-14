import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext';
import { db } from '../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

interface SprintContextValue {
  selectedSprintId: string;
  setSelectedSprintId: (id: string) => void;
}

const SprintContext = createContext<SprintContextValue | undefined>(undefined);

export const SprintProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedSprintId, setSelectedSprintIdState] = useState<string>('');
  const { currentUser } = useAuth();

  useEffect(() => {
    const saved = localStorage.getItem('bob_selected_sprint');
    if (saved !== null) {
      // Respect saved selection, including explicit empty string for "All Sprints"
      setSelectedSprintIdState(saved);
      return;
    }
    // No saved selection: auto-detect active sprint for current user
    const autoSelect = async () => {
      if (!currentUser) return;
      try {
        const q = query(collection(db, 'sprints'), where('ownerUid', '==', currentUser.uid));
        const snap = await getDocs(q);
        const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as any[];
        if (list.length === 0) return;
        // Prefer active sprint; fallback planned; else most recent by startDate
        const isActive = (s: any) => (typeof s.status === 'number' && s.status === 1) || (String(s.status).toLowerCase?.() === 'active');
        const isPlanned = (s: any) => (typeof s.status === 'number' && s.status === 0) || (String(s.status).toLowerCase?.() === 'planned');
        const active = list.find(isActive);
        const planned = list.find(isPlanned);
        const mostRecent = [...list].sort((a, b) => (Number(b.startDate) || 0) - (Number(a.startDate) || 0))[0];
        const preferred = active || planned || mostRecent;
        if (preferred?.id) {
          setSelectedSprintIdState(preferred.id);
          localStorage.setItem('bob_selected_sprint', preferred.id);
        }
      } catch {
        // ignore
      }
    };
    autoSelect();
  }, []);

  const setSelectedSprintId = (id: string) => {
    setSelectedSprintIdState(id);
    localStorage.setItem('bob_selected_sprint', id);
  };

  return (
    <SprintContext.Provider value={{ selectedSprintId, setSelectedSprintId }}>
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
