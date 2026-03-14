import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './AuthContext';
import { Persona } from '../types';
import logger from '../utils/logger';

interface PersonaContextType {
  currentPersona: Persona;
  setPersona: (persona: Persona) => void;
  togglePersona: () => void;
  /** True while a Work/Main Gig calendar block is active */
  workBlockActive: boolean;
}

const PersonaContext = createContext<PersonaContextType | undefined>(undefined);

function isWorkMainGig(block: any): boolean {
  const cat = String(block?.category ?? '').toLowerCase();
  const theme = String(block?.theme ?? '').toLowerCase();
  return cat === 'work (main gig)' || cat === 'work shift' || theme === 'work (main gig)';
}

export const PersonaProvider = ({ children }: { children: ReactNode }) => {
  const { currentUser } = useAuth();
  const [currentPersona, setCurrentPersona] = useState<Persona>(() => {
    const saved = localStorage.getItem('bob-persona') as Persona;
    return saved || 'personal';
  });
  const [workBlockActive, setWorkBlockActive] = useState(false);
  // Track whether startup persona check has run for this session
  const startupCheckedRef = React.useRef(false);

  const setPersona = (persona: Persona) => {
    setCurrentPersona(persona);
    localStorage.setItem('bob-persona', persona);
  };

  const togglePersona = () => {
    const newPersona = currentPersona === 'personal' ? 'work' : 'personal';
    setPersona(newPersona);
  };

  // Startup: detect whether a Work/Main Gig block is active right now, but do not
  // override the user's chosen persona.
  useEffect(() => {
    if (!currentUser?.uid || startupCheckedRef.current) return;
    startupCheckedRef.current = true;

    const now = Date.now();
    const checkActiveWorkBlock = async () => {
      try {
        // Query blocks that started before now (start <= now) — we filter end > now client-side
        const q = query(
          collection(db, 'calendar_blocks'),
          where('ownerUid', '==', currentUser.uid),
          where('start', '<=', now)
        );
        const snap = await getDocs(q);
        const activeWorkBlock = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .find((b: any) => b.end > now && isWorkMainGig(b));

        if (activeWorkBlock) {
          setWorkBlockActive(true);
          logger.debug('PersonaContext', 'Active Work/Main Gig block detected', {
            blockId: activeWorkBlock.id,
            category: (activeWorkBlock as any).category,
          });
        } else {
          setWorkBlockActive(false);
        }
      } catch (e: any) {
        // Non-fatal — persona startup check failure must not break the app
        logger.debug('PersonaContext', 'Work block startup check failed', { message: e?.message });
      }
    };
    checkActiveWorkBlock();
  }, [currentUser?.uid]);

  const value = {
    currentPersona,
    setPersona,
    togglePersona,
    workBlockActive,
  };

  return (
    <PersonaContext.Provider value={value}>
      {children}
    </PersonaContext.Provider>
  );
};

export const usePersona = () => {
  const context = useContext(PersonaContext);
  if (context === undefined) {
    throw new Error('usePersona must be used within a PersonaProvider');
  }
  return context;
};
