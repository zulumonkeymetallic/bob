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
  normalizePlannerDetail,
  parsePlannerSearch,
  plannerLevelLabel,
  DEFAULT_ROADMAP_DETAIL,
  ROADMAP_DETAIL_PARAM,
  type RoadmapDetail,
  type UnifiedPlannerLevel,
} from '../../utils/plannerRoutes';

type PlanDestination = {
  level: UnifiedPlannerLevel;
  label: string;
};

/**
 * The roadmap's four time axes, offered directly rather than as separate destinations.
 *
 * `Year Planner` and `Quarter Planner` used to sit in the list below as though they were their
 * own screens. They are not — both are `?level=` aliases that render the same RoadmapGrid, as
 * does `Gantt chart`. The menu was advertising four surfaces where there is one, and choosing
 * between them did not even set the axis you had just named. These entries write
 * `?detailLevel=`, so the menu and the roadmap's own toolbar drive the same state.
 */
const ROADMAP_DETAILS: Array<{ detail: RoadmapDetail; label: string }> = [
  { detail: 'year', label: 'Year' },
  { detail: 'quarter', label: 'Quarter' },
  { detail: 'sprint', label: 'Sprint' },
  { detail: 'week', label: 'Week' },
];

/** Surfaces that are genuinely their own thing, not a view of the roadmap. */
const PLAN_LEVELS: PlanDestination[] = [
  { level: 'gantt', label: 'Gantt chart' },
  // Story-level sprint capacity — a different altitude from the roadmap's sprint columns.
  { level: 'sprint', label: 'Multi Sprint Planner' },
  // react-big-calendar with Google sync and drag-resize. Overlaps the roadmap's Week axis and
  // the two should probably merge, but they are not the same component today and quietly
  // dropping this one would lose the Google side.
  { level: 'week', label: 'Weekly Plan' },
  { level: 'calendar', label: 'Calendar' },
];

interface PlanActionBarProps {
  className?: string;
}

const PlanActionBar: React.FC<PlanActionBarProps> = ({ className }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const query = useMemo(() => parsePlannerSearch(location.search), [location.search]);
  const currentPlannerLevel = useMemo(
    () => (location.pathname.startsWith('/planner') ? normalizePlannerLevel(query.get('level')) : null),
    [location.pathname, query],
  );
  const isRoadmapActive = location.pathname === '/canvas'
    && new URLSearchParams(location.search).get('layout') === 'roadmap';
  // `year` and `quarter` still route to the roadmap, so the menu must show them as such
  // rather than as unrelated levels that happen to be selected.
  const isRoadmapLevel = currentPlannerLevel != null
    && ['roadmap', 'year', 'quarter'].includes(currentPlannerLevel);
  const currentDetail = useMemo(
    () => (query.get(ROADMAP_DETAIL_PARAM)
      ? normalizePlannerDetail(query.get(ROADMAP_DETAIL_PARAM))
      : currentPlannerLevel === 'year' ? 'year' : DEFAULT_ROADMAP_DETAIL),
    [query, currentPlannerLevel],
  );

  const activePlanLevel = useMemo(
    () => (currentPlannerLevel ? PLAN_LEVELS.find((entry) => entry.level === currentPlannerLevel) || null : null),
    [currentPlannerLevel],
  );
  const isWeeklyCapacityActive = location.pathname.startsWith('/planner/weekly-capacity');

  const buttonVariant = (target: 'dashboard' | 'planner' | 'kanban' | 'coach' | 'roadmap') => {
    if (target === 'dashboard') return location.pathname.startsWith('/dashboard') ? 'primary' : 'outline-secondary';
    if (target === 'planner') return location.pathname.startsWith('/planner') ? 'primary' : 'outline-secondary';
    if (target === 'coach') return location.pathname.startsWith('/health/coach') ? 'primary' : 'outline-secondary';
    if (target === 'roadmap') return (location.pathname.startsWith('/canvas') || location.pathname.startsWith('/visual-canvas')) ? 'primary' : 'outline-secondary';
    return location.pathname.startsWith('/sprints/kanban') ? 'primary' : 'outline-secondary';
  };

  const navigateToLevel = (level: UnifiedPlannerLevel) => {
    const nextParams = parsePlannerSearch(location.search);
    nextParams.set('level', level);
    navigate(buildPlannerPath(level, nextParams));
  };

  /** Roadmap at a given time axis. One destination, four axes — see ROADMAP_DETAILS. */
  const navigateToRoadmapDetail = (detail: RoadmapDetail) => {
    const nextParams = parsePlannerSearch(location.search);
    nextParams.set(ROADMAP_DETAIL_PARAM, detail);
    navigate(buildPlannerPath('roadmap', nextParams));
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
      case 'roadmap':
        return <MapIcon size={14} className="me-1" />;
      case 'calendar':
      default:
        return <Calendar size={14} className="me-1" />;
    }
  };

  // One row, always. Every button already carries a `title`, and its label collapses to an icon
  // below xl, so wrapping onto a second row buys nothing — it just makes the bar taller and
  // makes the layout jump as the label breakpoint is crossed. If the icons still do not fit,
  // the row scrolls horizontally rather than stacking.
  return (
    <div
      className={`d-flex align-items-center gap-1 flex-nowrap ${className || ''}`.trim()}
      style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' as any }}
    >
      <Button size="sm" variant={buttonVariant('dashboard')} onClick={() => navigate('/dashboard')} title="Overview dashboard">
        <LayoutDashboard size={14} /><span className="d-none d-xl-inline ms-1">Overview</span>
      </Button>
      <Button size="sm" variant={buttonVariant('planner')} onClick={() => navigate(buildPlannerPath(currentPlannerLevel || 'calendar', location.search))} title="Calendar / planner">
        <Calendar size={14} /><span className="d-none d-xl-inline ms-1">Calendar</span>
      </Button>
      <Button size="sm" variant={buttonVariant('kanban')} onClick={() => navigate('/sprints/kanban')} title="Kanban board">
        <LayoutGrid size={14} /><span className="d-none d-xl-inline ms-1">Kanban</span>
      </Button>
      <Button size="sm" variant={buttonVariant('roadmap')} onClick={() => navigate(buildPlannerPath('roadmap'))} title="Goal roadmap">
        <MapIcon size={14} /><span className="d-none d-xl-inline ms-1">Roadmap</span>
      </Button>
      <Button size="sm" variant={buttonVariant('coach')} onClick={() => navigate('/health/coach')} title="Fitness coach">
        <Brain size={14} /><span className="d-none d-xl-inline ms-1">Coach</span>
      </Button>
      <Dropdown>
        {/* The roadmap is no longer one of PLAN_LEVELS, so its label comes from the detail axis
            — "Plan: Roadmap · Quarter" rather than four indistinguishable "Plan: …" states. */}
        <Dropdown.Toggle
          size="sm"
          variant={activePlanLevel || isRoadmapActive || isRoadmapLevel ? 'primary' : 'outline-secondary'}
          title="Switch planning level"
        >
          <Milestone size={14} />
          <span className="d-none d-xl-inline ms-1">
            Plan
            {isRoadmapLevel
              ? `: Roadmap · ${ROADMAP_DETAILS.find((d) => d.detail === currentDetail)?.label ?? ''}`
              : isRoadmapActive
                ? ': Roadmap'
                : activePlanLevel ? `: ${plannerLevelLabel(activePlanLevel.level)}` : ''}
          </span>
        </Dropdown.Toggle>
        {/* strategy: 'fixed' so the menu escapes this bar's overflow-x. The bar scrolls
            horizontally when the icons do not fit, and an absolutely-positioned menu inside an
            overflow container gets clipped — the same defect that hid the notification panel
            and Sprint selector in the top toolbar. */}
        <Dropdown.Menu renderOnMount popperConfig={{ strategy: 'fixed' }}>
          <Dropdown.Header className="small text-uppercase">Roadmap</Dropdown.Header>
          {ROADMAP_DETAILS.map(({ detail, label }) => (
            <Dropdown.Item
              key={detail}
              active={isRoadmapLevel && currentDetail === detail}
              onClick={() => navigateToRoadmapDetail(detail)}
            >
              <MapIcon size={14} className="me-1" />
              {label}
            </Dropdown.Item>
          ))}
          <Dropdown.Divider />
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
