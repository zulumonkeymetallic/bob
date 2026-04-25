import React, { useMemo } from 'react';
import { Button, Dropdown } from 'react-bootstrap';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  LayoutDashboard,
  LayoutGrid,
  Milestone,
  GitBranch,
  Layers3,
  Timer,
  Route,
} from 'lucide-react';
import {
  buildPlannerPath,
  normalizePlannerLevel,
  plannerLevelLabel,
  type UnifiedPlannerLevel,
} from '../../utils/plannerRoutes';

type PlanDestination = {
  level: UnifiedPlannerLevel;
  label: string;
};

const PLAN_LEVELS: PlanDestination[] = [
  { level: 'gantt', label: 'Gantt Chart' },
  { level: 'year', label: 'Year Planner' },
  { level: 'quarter', label: 'Quarter Planner' },
  { level: 'month', label: 'Month Planner' },
  { level: 'sprint', label: 'Sprint Planner' },
  { level: 'week', label: 'Week Planner' },
  { level: 'calendar', label: 'Calendar' },
];

interface PlanActionBarProps {
  className?: string;
}

const PlanActionBar: React.FC<PlanActionBarProps> = ({ className }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const currentPlannerLevel = useMemo(
    () => (location.pathname.startsWith('/planner') ? normalizePlannerLevel(query.get('level')) : null),
    [location.pathname, query],
  );
  const activePlanLevel = useMemo(
    () => (currentPlannerLevel ? PLAN_LEVELS.find((entry) => entry.level === currentPlannerLevel) || null : null),
    [currentPlannerLevel],
  );

  const buttonVariant = (target: 'dashboard' | 'planner' | 'kanban') => {
    if (target === 'dashboard') return location.pathname.startsWith('/dashboard') ? 'primary' : 'outline-secondary';
    if (target === 'planner') return location.pathname.startsWith('/planner') ? 'primary' : 'outline-secondary';
    return location.pathname.startsWith('/sprints/kanban') ? 'primary' : 'outline-secondary';
  };

  const navigateToLevel = (level: UnifiedPlannerLevel) => {
    const nextParams = new URLSearchParams(location.search);
    nextParams.set('level', level);
    navigate(buildPlannerPath(level, nextParams));
  };

  const iconForLevel = (level: UnifiedPlannerLevel) => {
    switch (level) {
      case 'gantt':
        return <Route size={14} className="me-1" />;
      case 'year':
        return <Milestone size={14} className="me-1" />;
      case 'quarter':
      case 'month':
        return <Layers3 size={14} className="me-1" />;
      case 'sprint':
        return <GitBranch size={14} className="me-1" />;
      case 'week':
        return <Timer size={14} className="me-1" />;
      case 'calendar':
      default:
        return <Calendar size={14} className="me-1" />;
    }
  };

  return (
    <div className={`d-flex align-items-center gap-2 flex-wrap ${className || ''}`.trim()}>
      <Button size="sm" variant={buttonVariant('dashboard')} onClick={() => navigate('/dashboard')} title="Open overview dashboard">
        <LayoutDashboard size={14} className="me-1" /> Overview
      </Button>
      <Button size="sm" variant={buttonVariant('planner')} onClick={() => navigate(buildPlannerPath(currentPlannerLevel || 'calendar', location.search))} title="Open unified planner">
        <Calendar size={14} className="me-1" /> Planner
      </Button>
      <Button size="sm" variant={buttonVariant('kanban')} onClick={() => navigate('/sprints/kanban')} title="Open kanban board">
        <LayoutGrid size={14} className="me-1" /> Kanban
      </Button>
      <Dropdown>
        <Dropdown.Toggle size="sm" variant={activePlanLevel ? 'primary' : 'outline-secondary'} title="Switch planning level">
          <Milestone size={14} className="me-1" /> Plan
          {activePlanLevel ? `: ${plannerLevelLabel(activePlanLevel.level)}` : ''}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          {PLAN_LEVELS.map((entry) => (
            <Dropdown.Item
              key={entry.level}
              active={currentPlannerLevel === entry.level}
              onClick={() => navigateToLevel(entry.level)}
            >
              {iconForLevel(entry.level)}
              {entry.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
};

export default PlanActionBar;
