import React, { useMemo } from 'react';
import { Button, Dropdown } from 'react-bootstrap';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Calendar,
  LayoutDashboard,
  LayoutGrid,
  Milestone,
  Route,
  Timer,
} from 'lucide-react';

type PlanDestination = {
  path: string;
  label: string;
};

const PLAN_LEVELS: PlanDestination[] = [
  { path: '/goals/year-planner', label: 'Year Planner' },
  { path: '/goals/roadmap-v6', label: 'Quarter/Month Roadmap' },
  { path: '/sprints/planning', label: 'Sprint Planning' },
  { path: '/planner/weekly', label: '7-Day Prioritisation' },
];

interface PlanActionBarProps {
  className?: string;
}

const normalizePath = (value: string) => (value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value);

const matchesPath = (pathname: string, candidatePath: string) => {
  const current = normalizePath(pathname);
  const target = normalizePath(candidatePath);
  return current === target || current.startsWith(`${target}/`);
};

const PlanActionBar: React.FC<PlanActionBarProps> = ({ className }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const activePlanLevel = useMemo(
    () => PLAN_LEVELS.find((entry) => matchesPath(location.pathname, entry.path)) || null,
    [location.pathname],
  );

  const buttonVariant = (path: string) => (matchesPath(location.pathname, path) ? 'primary' : 'outline-secondary');

  return (
    <div className={`d-flex align-items-center gap-2 flex-wrap ${className || ''}`.trim()}>
      <Button size="sm" variant={buttonVariant('/dashboard')} onClick={() => navigate('/dashboard')} title="Open overview dashboard">
        <LayoutDashboard size={14} className="me-1" /> Overview
      </Button>
      <Button size="sm" variant={buttonVariant('/calendar')} onClick={() => navigate('/calendar')} title="Open calendar view">
        <Calendar size={14} className="me-1" /> Calendar
      </Button>
      <Button size="sm" variant={buttonVariant('/sprints/kanban')} onClick={() => navigate('/sprints/kanban')} title="Open kanban board">
        <LayoutGrid size={14} className="me-1" /> Kanban
      </Button>
      <Dropdown>
        <Dropdown.Toggle size="sm" variant={activePlanLevel ? 'primary' : 'outline-secondary'} title="Switch planning level">
          <Milestone size={14} className="me-1" /> Plan
          {activePlanLevel ? `: ${activePlanLevel.label}` : ''}
        </Dropdown.Toggle>
        <Dropdown.Menu>
          {PLAN_LEVELS.map((entry) => (
            <Dropdown.Item
              key={entry.path}
              active={matchesPath(location.pathname, entry.path)}
              onClick={() => navigate(entry.path)}
            >
              {entry.path === '/goals/year-planner' && <Route size={14} className="me-1" />}
              {entry.path === '/goals/roadmap-v6' && <Route size={14} className="me-1" />}
              {entry.path === '/sprints/planning' && <Milestone size={14} className="me-1" />}
              {entry.path === '/planner/weekly' && <Timer size={14} className="me-1" />}
              {entry.label}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown>
    </div>
  );
};

export default PlanActionBar;
