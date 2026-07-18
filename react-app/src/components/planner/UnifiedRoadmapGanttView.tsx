import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, GanttChartSquare, Maximize2, Minimize2, Target } from 'lucide-react';
import VisualCanvas from '../VisualCanvas';
import GoalRoadmapV6 from '../visualization/GoalRoadmapV6';
import GoalsManagement from '../GoalsManagement';

type PlannerSubView = 'roadmap' | 'gantt' | 'goals';

const TABS: Array<{ key: PlannerSubView; label: string; icon: React.ReactNode }> = [
  { key: 'roadmap', label: 'Roadmap', icon: <Calendar size={14} /> },
  { key: 'gantt', label: 'Gantt', icon: <GanttChartSquare size={14} /> },
  { key: 'goals', label: 'Goals', icon: <Target size={14} /> },
];

interface UnifiedRoadmapGanttViewProps {
  /** Which tab to open with (e.g. the sidebar's direct "Gannt chart" link opens straight
   * into Gantt rather than Roadmap). Recomputed fresh per route, not persisted. */
  initialSubView?: PlannerSubView;
}

/**
 * /planner?level=year (and /planner?level=gantt) — combines the Roadmap (themes × quarters
 * grid, from /canvas), the Gantt chart, and a Goals list/cards tab into one view with a
 * switcher, so none of them need a separate nav destination or a new-tab escape hatch. Each
 * tab keeps its own native controls (Gantt's year/quarter/month/week zoom bar is untouched);
 * only Roadmap gets a fullscreen toggle here since Gantt already has one built in.
 */
const UnifiedRoadmapGanttView: React.FC<UnifiedRoadmapGanttViewProps> = ({ initialSubView = 'roadmap' }) => {
  const [subView, setSubView] = useState<PlannerSubView>(initialSubView);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else if (containerRef.current.requestFullscreen) {
        await containerRef.current.requestFullscreen();
      }
    } catch (err) {
      console.warn('[UnifiedRoadmapGanttView] fullscreen toggle failed', err);
    }
  }, []);

  return (
    <div className="d-flex flex-column" style={{ height: '100vh', overflow: 'hidden' }}>
      <div
        className="px-3 py-2 d-flex align-items-center gap-2 flex-wrap"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 100,
          background: 'var(--bg-primary, #fff)',
          borderBottom: '1px solid var(--border-color, #e5e7eb)',
        }}
      >
        <div
          role="group"
          aria-label="Planner view"
          style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color, #dee2e6)' }}
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setSubView(tab.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                borderLeft: index === 0 ? 'none' : '1px solid var(--border-color, #dee2e6)',
                cursor: 'pointer',
                background: subView === tab.key ? 'var(--primary, #2563eb)' : 'var(--bg-primary, #fff)',
                color: subView === tab.key ? '#fff' : 'var(--text-primary, #212529)',
                transition: 'background 0.12s ease, color 0.12s ease',
              }}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {subView === 'roadmap' && (
          <button
            type="button"
            onClick={toggleFullscreen}
            className="ms-auto"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 8,
              border: '1px solid var(--border-color, #dee2e6)',
              background: 'var(--bg-primary, #fff)',
              color: 'var(--text-primary, #212529)',
              cursor: 'pointer',
            }}
          >
            {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        )}
      </div>

      <div ref={containerRef} style={{ flex: 1, overflow: subView === 'goals' ? 'auto' : 'hidden', background: 'var(--bg-primary, #fff)' }}>
        {subView === 'roadmap' && <VisualCanvas forcedLayout="roadmap" embedded />}
        {subView === 'gantt' && <GoalRoadmapV6 />}
        {subView === 'goals' && <GoalsManagement embedded />}
      </div>
    </div>
  );
};

export default UnifiedRoadmapGanttView;
