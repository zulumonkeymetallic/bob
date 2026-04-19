import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface DrillThroughData {
    title: string;
    data: any;
    sourceWidget: string;
    filters?: Record<string, any>;
    breadcrumb?: string[];
}

interface DrillThroughContextType {
    drillStack: DrillThroughData[];
    currentDrill: DrillThroughData | null;
    drillDown: (data: DrillThroughData) => void;
    drillUp: () => void;
    drillTo: (index: number) => void;
    closeDrill: () => void;
}

const DrillThroughContext = createContext<DrillThroughContextType | undefined>(undefined);

export const DrillThroughProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [drillStack, setDrillStack] = useState<DrillThroughData[]>([]);

    const currentDrill = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;

    const drillDown = useCallback((data: DrillThroughData) => {
        setDrillStack(prev => [...prev, data]);
    }, []);

    const drillUp = useCallback(() => {
        setDrillStack(prev => prev.slice(0, -1));
    }, []);

    const drillTo = useCallback((index: number) => {
        setDrillStack(prev => prev.slice(0, index + 1));
    }, []);

    const closeDrill = useCallback(() => {
        setDrillStack([]);
    }, []);

    return (
        <DrillThroughContext.Provider
            value={{
                drillStack,
                currentDrill,
                drillDown,
                drillUp,
                drillTo,
                closeDrill,
            }}
        >
            {children}
        </DrillThroughContext.Provider>
    );
};

export const useDrillThrough = (): DrillThroughContextType => {
    const context = useContext(DrillThroughContext);
    if (!context) {
        throw new Error('useDrillThrough must be used within DrillThroughProvider');
    }
    return context;
};
