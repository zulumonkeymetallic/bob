import React, { createContext, useContext, useEffect, useState } from 'react';

interface SprintContextValue {
  selectedSprintId: string;
  setSelectedSprintId: (id: string) => void;
}

const SprintContext = createContext<SprintContextValue | undefined>(undefined);

export const SprintProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedSprintId, setSelectedSprintIdState] = useState<string>('');

  useEffect(() => {
    const saved = localStorage.getItem('bob_selected_sprint');
    if (saved) setSelectedSprintIdState(saved);
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

