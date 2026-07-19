import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LayoutGrid, Calendar as CalendarIcon, Columns, Route, Brain } from 'lucide-react';

const LINKS = [
  { label: 'Overview', path: '/dashboard', icon: LayoutGrid },
  { label: 'Calendar', path: '/calendar', icon: CalendarIcon },
  { label: 'Kanban', path: '/sprints/kanban', icon: Columns },
  { label: 'Roadmap', path: '/planner?level=gantt', icon: Route },
  { label: 'Coach', path: '/coach', icon: Brain },
] as const;

/**
 * Quick-jump row for full desktop work-surface pages (Stories, Tasks, Goals, etc.) that
 * otherwise have no way back to the other surfaces short of the browser back button.
 * Deliberately not rendered on Dashboard (already has header nav) or Mobile (bottom tab bar).
 */
const WorkSurfaceNav: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname + location.search;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        flexWrap: 'wrap',
        marginBottom: 12,
      }}
    >
      {LINKS.map(({ label, path, icon: Icon }) => {
        const isActive = path.includes('?')
          ? currentPath === path
          : location.pathname === path || location.pathname.startsWith(`${path}/`);
        return (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            disabled={isActive}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 999,
              border: '1px solid var(--border, #e5e7eb)',
              background: isActive ? 'var(--brand, #5f77dc)' : 'transparent',
              color: isActive ? '#fff' : 'var(--muted, #6c757d)',
              cursor: isActive ? 'default' : 'pointer',
            }}
          >
            <Icon size={12} />
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default WorkSurfaceNav;
