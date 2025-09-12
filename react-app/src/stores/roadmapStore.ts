import create from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { scaleTime } from '@visx/scale';

export type ZoomLevel = 'week' | 'month' | 'quarter' | 'half' | 'year';

interface RoadmapState {
  start: Date;
  end: Date;
  zoom: ZoomLevel;
  width: number;
  setRange: (start: Date, end: Date) => void;
  setZoom: (zoom: ZoomLevel, anchor?: Date) => void;
  setWidth: (width: number) => void;
}

export const useRoadmapStore = create<RoadmapState>()(
  persist(
    (set, get) => ({
      start: new Date(new Date().getFullYear() - 1, 0, 1),
      end: new Date(new Date().getFullYear() + 2, 11, 31),
      zoom: 'quarter',
      width: 1200,
      setRange: (start, end) => set({ start, end }),
      setZoom: (zoom, anchor) => set(() => {
        const now = anchor || new Date();
        const ms = windowMs(zoom);
        const half = ms / 2;
        return {
          zoom,
          start: new Date(now.getTime() - half),
          end: new Date(now.getTime() + half)
        } as Partial<RoadmapState>;
      }),
      setWidth: (width) => set({ width })
    }),
    {
      name: 'roadmap-view',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ start: state.start, end: state.end, zoom: state.zoom }),
      // Transform Dates to ISO strings and back
      serialize: (state) => {
        const s = JSON.parse(JSON.stringify(state));
        if (s.state?.start instanceof Date) s.state.start = s.state.start.toISOString();
        if (s.state?.end instanceof Date) s.state.end = s.state.end.toISOString();
        return JSON.stringify(s);
      },
      deserialize: (str) => {
        const parsed = JSON.parse(str);
        const st = parsed.state || {};
        if (typeof st.start === 'string') st.start = new Date(st.start);
        if (typeof st.end === 'string') st.end = new Date(st.end);
        parsed.state = st;
        return parsed;
      }
    }
  )
);

export function useTimelineScale(): (d: Date) => number {
  const { start, end, width } = useRoadmapStore();
  // Recompute on state change
  const s = scaleTime<number>({ domain: [start, end], range: [0, Math.max(1, width)] });
  return (d: Date) => s(d);
}

function windowMs(zoom: ZoomLevel): number {
  const day = 24 * 60 * 60 * 1000;
  switch (zoom) {
    case 'week': return 84 * day; // ~12 weeks window
    case 'month': return 180 * day; // ~6 months
    case 'quarter': return 365 * day; // ~12 months
    case 'half': return 548 * day; // ~18 months
    case 'year': return 1095 * day; // ~3 years
    default: return 365 * day;
  }
}
