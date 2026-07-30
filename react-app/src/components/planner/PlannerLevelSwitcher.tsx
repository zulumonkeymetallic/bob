import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, GanttChartSquare, LayoutGrid, Rows3, CalendarRange, Route, type LucideIcon } from 'lucide-react';
import {
  buildPlannerPath,
  normalizePlannerLevel,
  plannerLevelLabel,
  type UnifiedPlannerLevel,
} from '../../utils/plannerRoutes';

/**
 * In-page switcher for the planner's six levels.
 *
 * The planner has always been one route with a `?level=` parameter, but nothing on the page
 * ever let you change it — UnifiedPlannerLevels simply dispatches on the current value. Moving
 * between levels was only possible through the sidebar, which is why seven separate nav
 * entries existed for one screen. This is what makes a single "Planner" entry viable.
 *
 * Every other query parameter is preserved, so switching level keeps `anchor` (the day the
 * week view is centred on) and `embed` rather than silently resetting them.
 */
const LEVELS: Array<{ level: UnifiedPlannerLevel; icon: LucideIcon }> = [
  { level: 'calendar', icon: CalendarDays },
  { level: 'week', icon: CalendarRange },
  { level: 'sprint', icon: LayoutGrid },
  { level: 'quarter', icon: Rows3 },
  { level: 'year', icon: Route },
  { level: 'gantt', icon: GanttChartSquare },
];

const PlannerLevelSwitcher: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const current = normalizePlannerLevel(new URLSearchParams(location.search).get('level'));

  return (
    <div
      role="tablist"
      aria-label="Planner level"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 12,
        // Scrolls rather than wrapping into an unreachable second row on a narrow tablet track.
        overflowX: 'auto',
      }}
    >
      {LEVELS.map(({ level, icon: Icon }) => {
        const isActive = level === current;
        return (
          <button
            key={level}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => navigate(buildPlannerPath(level, location.search))}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              padding: '5px 11px',
              borderRadius: 999,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              border: '1px solid var(--border, #e5e7eb)',
              background: isActive ? 'var(--brand, #5f77dc)' : 'transparent',
              color: isActive ? '#fff' : 'var(--muted, #6c757d)',
              cursor: isActive ? 'default' : 'pointer',
              minHeight: 32,
            }}
          >
            <Icon size={12} />
            {plannerLevelLabel(level)}
          </button>
        );
      })}
    </div>
  );
};

export default PlannerLevelSwitcher;
