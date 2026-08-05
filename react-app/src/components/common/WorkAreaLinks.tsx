import React from 'react';
import { Link } from 'react-router-dom';
import { themeVars } from '../../utils/themeVars';

export type WorkArea = 'goals' | 'stories' | 'tasks';

const WORK_AREAS: { key: WorkArea; label: string; path: string }[] = [
  { key: 'goals', label: 'Goals', path: '/goals' },
  { key: 'stories', label: 'Stories', path: '/stories' },
  { key: 'tasks', label: 'Tasks', path: '/tasks' },
];

interface WorkAreaLinksProps {
  /** The page rendering this — it is the heading, so it is omitted from the links. */
  current: WorkArea;
}

/**
 * The two sibling list pages, sat beside the current page's title: Goals ▸ Stories ▸ Tasks
 * is one hierarchy read at three depths, and moving between them previously meant going
 * back out to the sidebar. Real <Link>s rather than buttons, so middle-click and
 * cmd-click open a new tab as expected.
 */
export const WorkAreaLinks: React.FC<WorkAreaLinksProps> = ({ current }) => {
  const siblings = WORK_AREAS.filter((area) => area.key !== current);

  return (
    <nav
      aria-label="Related lists"
      style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}
    >
      {siblings.map((area) => (
        <Link
          key={area.key}
          to={area.path}
          style={{
            fontSize: '15px',
            fontWeight: 500,
            color: themeVars.muted as string,
            textDecoration: 'none',
            transition: 'color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = themeVars.brand as string; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = themeVars.muted as string; }}
        >
          {area.label}
        </Link>
      ))}
    </nav>
  );
};

export default WorkAreaLinks;
