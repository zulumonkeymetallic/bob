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

// Always starts on 'minimal' on every load, every device, no exceptions — per Jim,
// 2026-07-21. This used to persist the user's last choice to localStorage and read it
// back on the next load, which meant toggling to Compact/Full even once made that the
// de facto permanent default from then on (defeating the point of a "default"). Switching
// within a session still works via setDetailLevel; it just never survives a reload.
export const DetailLevelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('minimal');

  return (
    <DetailLevelContext.Provider value={{ detailLevel, setDetailLevel }}>
      {children}
    </DetailLevelContext.Provider>
  );
};

export const useDetailLevel = () => useContext(DetailLevelContext);
