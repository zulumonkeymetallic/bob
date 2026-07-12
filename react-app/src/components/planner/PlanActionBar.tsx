import React, { useMemo } from 'react';
import { Button, Dropdown } from 'react-bootstrap';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Brain,
  Calendar,
  LayoutDashboard,
  LayoutGrid,
  Map as MapIcon,
  Milestone,
  GitBranch,
  Layers3,
  Timer,
  Route,
  Wand2,
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
  { level: 'gantt', label: 'Gannt chart' },
  { level: 'year', label: 'Year Planner' },
  { level: 'quarter', label: 'Quarter Planner' },
  { level: 'sprint', label: 'Multi Sprint Planner' },
  { level: 'week', label: '4-Day Planner' },
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
  const isWeeklyCapacityActive = location.pathname.startsWith('/planner/weekly-capacity');

  const buttonVariant = (target: 'dashboard' | 'planner' | 'kanban' | 'coach' | 'roadmap') => {
    if (target === 'dashboard') return location.pathname.startsWith('/dashboard') ? 'primary' : 'outline-secondary';
    if (target === 'planner') return location.pathname.startsWith('/planner') ? 'primary' : 'outline-secondary';
    if (target === 'coach') return location.pathname.startsWith('/coach') ? 'primary' : 'outline-secondary';
    if (target === 'roadmap') return (location.pathname.startsWith('/canvas') || location.pathname.startsWith('/visual-canvas')) ? 'primary' : 'outline-secondary';
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
    <div className={`d-flex align-items-center gap-1 flex-wrap ${className || ''}`.trim()}>
      <Button size="sm" variant={buttonVariant('dashboard')} onClick={() => navigate('/dashboard')} title="Overview dashboard">
        <LayoutDashboard size={14} /><span className="d-none d-xl-inline ms-1">Overview</span>
      </Button>
      <Button size="sm" variant={buttonVariant('planner')} onClick={() => navigate(buildPlannerPath(currentPlannerLevel || 'calendar', location.search))} title="Calendar / planner">
        <Calendar size={14} /><span className="d-none d-xl-inline ms-1">Calendar</span>
      </Button>
      <Button size="sm" variant={buttonVariant('kanban')} onClick={() => navigate('/sprints/kanban')} title="Kanban board">
        <LayoutGrid size={14} /><span className="d-none d-xl-inline ms-1">Kanban</span>
      </Button>
      <Button size="sm" variant={buttonVariant('roadmap')} onClick={() => navigate('/canvas?layout=roadmap')} title="Goal roadmap">
        <MapIcon size={14} /><span className="d-none d-xl-inline ms-1">Roadmap</span>
      </Button>
      <Button size="sm" variant={buttonVariant('coach')} onClick={() => navigate('/coach')} title="Coach hub">
        <Brain size={14} /><span className="d-none d-xl-inline ms-1">Coach</span>
      </Button>
      <Dropdown>
        <Dropdown.Toggle size="sm" variant={activePlanLevel ? 'primary' : 'outline-secondary'} title="Switch planning level">
          <Milestone size={14} /><span className="d-none d-xl-inline ms-1">Plan{activePlanLevel ? `: ${plannerLevelLabel(activePlanLevel.level)}` : ''}</span>
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
          <Dropdown.Divider />
          <Dropdown.Item
            active={isWeeklyCapacityActive}
            onClick={() => navigate('/planner/weekly-capacity')}
          >
            <Calendar size={14} className="me-1" />
            Weekly Capacity
          </Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item onClick={() => navigate('/sprints/management?wizard=true')}>
            <Wand2 size={14} className="me-1" />
            Plan Sprint (Wizard)
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
};

export default PlanActionBar;
