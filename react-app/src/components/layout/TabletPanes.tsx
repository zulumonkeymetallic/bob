/**
 * TabletPanes — the two-track list/detail shell used on the tablet tier.
 *
 * The point of this component is that a route needs to know nothing about it. The detail track
 * is fed by SidebarContext.showSidebar(), which about twenty components already call to open
 * the Activity Stream / entity detail; GlobalSidebar simply portals itself into the second
 * track instead of floating over the page. A screen that never calls showSidebar never opens
 * the track and keeps the full width, so there is no per-route opt-in to maintain.
 *
 * Grid rather than flex deliberately. The list track is `minmax(0, 1fr)`, which is what stops
 * a wide child (a Kanban board, a table) from forcing the track wider than its share. The flex
 * equivalent needs `min-width: 0` on every child to behave, and forgetting it is precisely the
 * bug class this codebase already has a history of — see the minHeight:0 incident documented
 * in SidebarLayout's rail.
 */
import React from 'react';
import { useSidebar } from '../../contexts/SidebarContext';
import { SIZE, Z } from '../../utils/layoutTokens';

export const DETAIL_PANE_ID = 'bob-detail-pane';

interface TabletPanesProps {
  /** False on phone and desktop, and whenever the shell flag is off. */
  active: boolean;
  /** 2 once there is room for a list and a detail side by side; 1 below that. */
  panes: 1 | 2;
  children: React.ReactNode;
}

const TabletPanes: React.FC<TabletPanesProps> = ({ active, panes, children }) => {
  const { isVisible, hideSidebar } = useSidebar();

  // Inactive must be a genuine no-op, not a wrapper that "does nothing" — an extra div here
  // would still change the flex chain that the shell CSS depends on.
  if (!active) return <>{children}</>;

  const splitOpen = panes === 2 && isVisible;

  return (
    <div
      className="bob-tablet-panes"
      data-detail={splitOpen ? 'open' : 'closed'}
      style={{
        display: 'grid',
        gridTemplateColumns: `minmax(0, 1fr) ${splitOpen ? `${SIZE.detailPaneW}px` : '0px'}`,
        flex: 1,
        minHeight: 0,
        // Deliberately NOT transitioned. grid-template-columns is animatable only in recent
        // engines and interpolating minmax() against a fixed track is exactly the edge case
        // they handle worst — in testing the track stayed pinned at its start value and the
        // pane rendered 1px wide until the transition was removed. Safari on iPad is the
        // target here, so the track width is applied instantly and the fade below carries the
        // motion instead; opacity is universally supported and cannot wedge the layout.
      }}
    >
      {children}
      <div
        id={DETAIL_PANE_ID}
        style={{
          minWidth: 0,
          overflow: 'hidden',
          borderLeft: splitOpen ? '1px solid var(--line, #e5e7eb)' : 'none',
          background: 'var(--panel, #fff)',
          opacity: splitOpen ? 1 : 0,
          transition: 'opacity 0.15s ease',
        }}
      />
      {/* At one pane the detail is a sheet over the list, so it needs a scrim to dismiss.
          Z.scrim sits below the docked right-hand panels, which keep their own ordering. */}
      {panes === 1 && isVisible && (
        <div
          onClick={hideSidebar}
          aria-hidden="true"
          style={{ position: 'fixed', inset: 0, zIndex: Z.scrim, background: 'rgba(0,0,0,0.32)' }}
        />
      )}
    </div>
  );
};

export default TabletPanes;
