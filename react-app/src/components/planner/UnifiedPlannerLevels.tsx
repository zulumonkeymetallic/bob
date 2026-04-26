import React, { useMemo } from 'react';
import { Badge, Button, Card } from 'react-bootstrap';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addDays, format, startOfDay } from 'date-fns';
import { useLocation, useNavigate } from 'react-router-dom';
import GoalRoadmapV6 from '../visualization/GoalRoadmapV6';
import { buildPlannerPath, normalizePlannerLevel, plannerLevelLabel, type UnifiedPlannerLevel } from '../../utils/plannerRoutes';
import WeeklyPlannerSurface from './WeeklyPlannerSurface';
import UnifiedGoalPlannerLevels from './UnifiedGoalPlannerLevels';
import PlanActionBar from './PlanActionBar';
import SprintPlanningMatrix from '../SprintPlanningMatrix';

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
  const embedded = query.get('embed') === '1' || query.get('embed') === 'true';
  const anchorDate = useMemo(() => {
    const explicit = toAnchorDate(query.get('anchor'));
    if (explicit) return explicit;
    if (level === 'week') return startOfDay(new Date());
    return new Date();
  }, [level, query]);

  if (level === 'gantt') {
    return <GoalRoadmapV6 />;
  }

  if (level === 'year' || level === 'quarter') {
    return <UnifiedGoalPlannerLevels level={level} anchorDate={anchorDate} embedded={embedded} />;
  }

  if (level === 'sprint') {
    return <SprintPlanningMatrix />;
  }

  if (level === 'week') {
    const endDate = addDays(anchorDate, 3);
    return (
      <div className={embedded ? 'p-2' : 'p-3'}>
        {!embedded && (
          <>
            <div className="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3">
              <div>
                <h3 className="mb-1">{plannerLevelLabel(level)}</h3>
                <div className="text-muted small">Stories, tasks, planner blocks, and linked calendar events across the next 4 days.</div>
              </div>
              <Badge bg="info">
                {format(anchorDate, 'dd MMM')} - {format(endDate, 'dd MMM yyyy')}
              </Badge>
            </div>
            <Card className="shadow-sm border-0 mb-3">
              <Card.Body className="py-2">
                <PlanActionBar />
              </Card.Body>
            </Card>
          </>
        )}

        <Card className="shadow-sm border-0 mb-3">
          <Card.Body className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
            <Button size="sm" variant="outline-secondary" onClick={() => navigate(withAnchor(level, addDays(anchorDate, -4), location.search))}>
              <ChevronLeft size={14} className="me-1" /> Previous 4 days
            </Button>
            <div className="small text-muted">Anchor: {format(anchorDate, 'EEE d MMM yyyy')}</div>
            <Button size="sm" variant="outline-secondary" onClick={() => navigate(withAnchor(level, addDays(anchorDate, 4), location.search))}>
              Next 4 days <ChevronRight size={14} className="ms-1" />
            </Button>
          </Card.Body>
        </Card>

        <WeeklyPlannerSurface
          weekStart={anchorDate}
          embedded={embedded}
          title="4-Day Planner"
          visibleDays={4}
          initialDetailLevel="minimal"
          hideGoalTextWhenMinimal
        />
      </div>
    );
  }

  return null;
};

export default UnifiedPlannerLevels;
