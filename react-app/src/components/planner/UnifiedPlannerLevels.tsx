import React, { useMemo } from 'react';
import { Badge, Button } from 'react-bootstrap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format, startOfDay } from 'date-fns';
import { useLocation, useNavigate } from 'react-router-dom';
import { buildPlannerPath, normalizePlannerLevel, plannerLevelLabel, type UnifiedPlannerLevel } from '../../utils/plannerRoutes';
import UnifiedGoalPlannerLevels from './UnifiedGoalPlannerLevels';
import UnifiedRoadmapGanttView from './UnifiedRoadmapGanttView';
import SprintPlanningMatrix from '../SprintPlanningMatrix';
import SprintWeekPlanner from './SprintWeekPlanner';
import RoadmapGrid from './RoadmapGrid';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';

const toAnchorDate = (value: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const withAnchor = (level: UnifiedPlannerLevel, date: Date, search: string) => {
  const next = new URLSearchParams(search);
  next.set('anchor', format(date, 'yyyy-MM-dd'));
  return buildPlannerPath(level, next);
};

const UnifiedPlannerLevels: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const level = normalizePlannerLevel(query.get('level'));
  const consolidated = useFeatureFlag('roadmap_replaces_planner_levels');
  const embedded = query.get('embed') === '1' || query.get('embed') === 'true';
  const anchorDate = useMemo(() => {
    const explicit = toAnchorDate(query.get('anchor'));
    if (explicit) return explicit;
    if (level === 'week') return startOfDay(new Date());
    return new Date();
  }, [level, query]);

  if (level === 'roadmap') {
    return <RoadmapGrid />;
  }

  // Gantt is now a view of the roadmap rather than its own level — same surface, same view
  // switcher, one entry point. This also drops the third duplicate: UnifiedRoadmapGanttView's
  // own "Roadmap" tab rendered VisualCanvas, which is a different roadmap again from
  // RoadmapGrid. Behind the same flag as year/quarter, so `roadmap_replaces_planner_levels`
  // false restores the old tabbed page untouched.
  if (level === 'gantt') {
    return consolidated ? <RoadmapGrid initialView="gantt" /> : <UnifiedRoadmapGanttView initialSubView="gantt" />;
  }

  // `year` rendered the same component as `gantt` — a straight duplicate. `quarter` overlapped
  // what the roadmap does better. Both now point at the roadmap, behind a flag: setting
  // roadmap_replaces_planner_levels false restores the original components, which are left
  // in place untouched.
  if (level === 'year') {
    return consolidated ? <RoadmapGrid /> : <UnifiedRoadmapGanttView initialSubView="roadmap" />;
  }

  if (level === 'quarter') {
    return consolidated
      ? <RoadmapGrid />
      : <UnifiedGoalPlannerLevels level={level} anchorDate={anchorDate} embedded={embedded} />;
  }

  if (level === 'sprint') {
    return <SprintPlanningMatrix />;
  }

  if (level === 'week') {
    const endDate = addDays(anchorDate, 4);
    return (
      <div className={embedded ? 'p-2' : 'p-3'}>
        {/* Header, date range and day navigation on one row. Previously this was three stacked
            blocks — a header, an empty `<Card><Card.Body className="py-2">   </Card.Body></Card>`
            that rendered nothing but still took vertical space, and a full-width card holding
            two small nav buttons — which pushed the actual planner well down the page and
            looked nothing like the roadmap's single compact toolbar. */}
        {!embedded && (
          <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
            <div>
              <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: 700 }}>{plannerLevelLabel(level)}</h2>
              <div className="text-muted small">Backlog and calendar for the current sprint, rolling 5 days at a time.</div>
            </div>
            <div className="d-flex align-items-center gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline-secondary"
                title="Move the window back one day"
                onClick={() => navigate(withAnchor(level, addDays(anchorDate, -1), location.search))}
              >
                <ChevronLeft size={14} />
              </Button>
              <Badge bg="info" className="py-2 px-3">
                {format(anchorDate, 'dd MMM')} – {format(endDate, 'dd MMM yyyy')}
              </Badge>
              <Button
                size="sm"
                variant="outline-secondary"
                title="Move the window forward one day"
                onClick={() => navigate(withAnchor(level, addDays(anchorDate, 1), location.search))}
              >
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        )}

        <SprintWeekPlanner anchorDate={anchorDate} />
      </div>
    );
  }

  return null;
};

export default UnifiedPlannerLevels;
