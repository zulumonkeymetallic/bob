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

// Treat anything narrower than iPad Pro landscape (1366px) as compact/mobile
const getInitialLevel = (): DetailLevel =>
  typeof window !== 'undefined' && window.innerWidth < 1366 ? 'minimal' : 'full';

export const DetailLevelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [detailLevel, setDetailLevel] = useState<DetailLevel>(getInitialLevel);

  return (
    <DetailLevelContext.Provider value={{ detailLevel, setDetailLevel }}>
      {children}
    </DetailLevelContext.Provider>
  );
};

export const useDetailLevel = () => useContext(DetailLevelContext);
