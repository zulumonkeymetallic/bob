import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from 'react-bootstrap';
import { Calendar, GanttChartSquare, Maximize2, Minimize2 } from 'lucide-react';
import VisualCanvas from '../VisualCanvas';
import GoalRoadmapV6 from '../visualization/GoalRoadmapV6';

type PlannerSubView = 'roadmap' | 'gantt';

const STORAGE_KEY = 'unifiedPlannerSubView';

/**
 * /planner?level=year — combines the Roadmap (themes × quarters grid, from /canvas) and
 * the Gantt chart (from /planner?level=gantt) into one view with a switcher, so neither
 * needs its own separate nav destination. Each sub-view keeps its own native controls
 * (Gantt's year/quarter/month/week zoom bar is untouched); only the Roadmap side gets a
 * fullscreen toggle here since Gantt already has one built in.
 */
const UnifiedRoadmapGanttView: React.FC = () => {
  const [subView, setSubView] = useState<PlannerSubView>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === 'gantt' ? 'gantt' : 'roadmap';
    } catch {
      return 'roadmap';
    }
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, subView); } catch { /* noop */ }
  }, [subView]);

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
      <div className="border-bottom px-3 py-2 d-flex align-items-center gap-2 flex-wrap bg-white" style={{ zIndex: 10 }}>
        <div className="btn-group btn-group-sm" role="group" aria-label="Planner view">
          <Button
            size="sm"
            variant={subView === 'roadmap' ? 'primary' : 'outline-secondary'}
            onClick={() => setSubView('roadmap')}
          >
            <Calendar size={14} className="me-1" /> Roadmap
          </Button>
          <Button
            size="sm"
            variant={subView === 'gantt' ? 'primary' : 'outline-secondary'}
            onClick={() => setSubView('gantt')}
          >
            <GanttChartSquare size={14} className="me-1" /> Gantt
          </Button>
        </div>

        {subView === 'roadmap' && (
          <Button size="sm" variant="outline-secondary" className="ms-auto" onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={14} className="me-1" /> : <Maximize2 size={14} className="me-1" />}
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </Button>
        )}
      </div>

      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', background: '#fff' }}>
        {subView === 'roadmap'
          ? <VisualCanvas forcedLayout="roadmap" embedded />
          : <GoalRoadmapV6 />}
      </div>
    </div>
  );
};

export default UnifiedRoadmapGanttView;
