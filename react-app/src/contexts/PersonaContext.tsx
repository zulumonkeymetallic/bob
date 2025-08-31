import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Persona } from '../types';

interface PersonaContextType {
  currentPersona: Persona;
  setPersona: (persona: Persona) => void;
  togglePersona: () => void;
}

const PersonaContext = createContext<PersonaContextType | undefined>(undefined);

export const PersonaProvider = ({ children }: { children: ReactNode }) => {
  const [currentPersona, setCurrentPersona] = useState<Persona>(() => {
    const saved = localStorage.getItem('bob-persona') as Persona;
    return saved || 'personal';
  });

  const setPersona = (persona: Persona) => {
    setCurrentPersona(persona);
    localStorage.setItem('bob-persona', persona);
  };

  const togglePersona = () => {
    const newPersona = currentPersona === 'personal' ? 'work' : 'personal';
    setPersona(newPersona);
  };

  const value = {
    currentPersona,
    setPersona,
    togglePersona,
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
