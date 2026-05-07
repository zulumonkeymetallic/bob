import React, { createContext, useContext, useState } from 'react';

export type DetailLevel = 'full' | 'compact' | 'minimal';

interface DetailLevelContextValue {
  detailLevel: DetailLevel;
  setDetailLevel: (level: DetailLevel) => void;
}

const DetailLevelContext = createContext<DetailLevelContextValue>({
  detailLevel: 'full',
  setDetailLevel: () => {},
});

const DETAIL_LEVEL_STORAGE_KEY = 'plannerDetailLevel';

const isDetailLevel = (value: unknown): value is DetailLevel => (
  value === 'full' || value === 'compact' || value === 'minimal'
);

// Default to minimal across planner/kanban surfaces unless the user has an explicit saved preference.
const getInitialLevel = (): DetailLevel => {
  if (typeof window !== 'undefined') {
    try {
      const stored = window.localStorage.getItem(DETAIL_LEVEL_STORAGE_KEY);
      if (isDetailLevel(stored)) return stored;
    } catch {}
    return 'minimal';
  }
  return 'minimal';
};

export const DetailLevelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(getInitialLevel);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(DETAIL_LEVEL_STORAGE_KEY, detailLevel);
    } catch {}
  }, [detailLevel]);

  return (
    <DetailLevelContext.Provider value={{ detailLevel, setDetailLevel }}>
      {children}
    </DetailLevelContext.Provider>
  );
};

export const useDetailLevel = () => useContext(DetailLevelContext);
