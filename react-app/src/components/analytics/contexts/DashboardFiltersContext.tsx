import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { startOfDay, endOfDay, subDays, startOfWeek, startOfMonth } from 'date-fns';

export interface DateRange {
    start: Date;
    end: Date;
    label: string;
}

export interface DashboardFilters {
    dateRange: DateRange;
    persona: string | null;
    tags: string[];
    priority: number | null;
    status: string | null;
}

interface DashboardFiltersContextType {
    filters: DashboardFilters;
    setDateRange: (range: DateRange) => void;
    setPersona: (persona: string | null) => void;
    setTags: (tags: string[]) => void;
    setPriority: (priority: number | null) => void;
    setStatus: (status: string | null) => void;
    resetFilters: () => void;
    presetRanges: Record<string, () => DateRange>;
}

const DashboardFiltersContext = createContext<DashboardFiltersContextType | undefined>(undefined);

const getDefaultDateRange = (): DateRange => ({
    start: startOfDay(subDays(new Date(), 30)),
    end: endOfDay(new Date()),
    label: 'Last 30 Days'
});

const defaultFilters: DashboardFilters = {
    dateRange: getDefaultDateRange(),
    persona: null,
    tags: [],
    priority: null,
    status: null,
};

export const DashboardFiltersProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [filters, setFilters] = useState<DashboardFilters>(defaultFilters);

    const setDateRange = useCallback((range: DateRange) => {
        setFilters(prev => ({ ...prev, dateRange: range }));
    }, []);

    const setPersona = useCallback((persona: string | null) => {
        setFilters(prev => ({ ...prev, persona }));
    }, []);

    const setTags = useCallback((tags: string[]) => {
        setFilters(prev => ({ ...prev, tags }));
    }, []);

    const setPriority = useCallback((priority: number | null) => {
        setFilters(prev => ({ ...prev, priority }));
    }, []);

    const setStatus = useCallback((status: string | null) => {
        setFilters(prev => ({ ...prev, status }));
    }, []);

    const resetFilters = useCallback(() => {
        setFilters(defaultFilters);
    }, []);

    const presetRanges: Record<string, () => DateRange> = {
        today: () => ({
            start: startOfDay(new Date()),
            end: endOfDay(new Date()),
            label: 'Today'
        }),
        yesterday: () => ({
            start: startOfDay(subDays(new Date(), 1)),
            end: endOfDay(subDays(new Date(), 1)),
            label: 'Yesterday'
        }),
        last7Days: () => ({
            start: startOfDay(subDays(new Date(), 7)),
            end: endOfDay(new Date()),
            label: 'Last 7 Days'
        }),
        last30Days: () => ({
            start: startOfDay(subDays(new Date(), 30)),
            end: endOfDay(new Date()),
            label: 'Last 30 Days'
        }),
        thisWeek: () => ({
            start: startOfWeek(new Date(), { weekStartsOn: 1 }),
            end: endOfDay(new Date()),
            label: 'This Week'
        }),
        thisMonth: () => ({
            start: startOfMonth(new Date()),
            end: endOfDay(new Date()),
            label: 'This Month'
        }),
    };

    return (
        <DashboardFiltersContext.Provider
            value={{
                filters,
                setDateRange,
                setPersona,
                setTags,
                setPriority,
                setStatus,
                resetFilters,
                presetRanges,
            }}
        >
            {children}
        </DashboardFiltersContext.Provider>
    );
};

export const useDashboardFilters = (): DashboardFiltersContextType => {
    const context = useContext(DashboardFiltersContext);
    if (!context) {
        throw new Error('useDashboardFilters must be used within DashboardFiltersProvider');
    }
    return context;
};
