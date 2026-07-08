/**
 * BannerToastStack
 *
 * Renders the global banners as a stack of toast cards pinned to the top-right,
 * overlaying the page rather than pushing content down.
 *
 * Behaviour:
 *   - Auto-dismiss banners fade out 10s after they gain content, unless the user
 *     dismisses them first (or hovers, which pauses the timer).
 *   - The Deferral candidates banner is persistent: it stays until actioned or
 *     manually closed.
 *   - A toast collapses to nothing while its banner renders null (no empty cards).
 */
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import CheckInBanner from './checkins/CheckInBanner';
import { CoachVerdictBanner } from './coach/CoachVerdictBanner';
import PlannerCapacityBanner from './planner/PlannerCapacityBanner';
import SprintClosureBanner from './sprints/SprintClosureBanner';
import PlannedSprintBanner from './sprints/PlannedSprintBanner';
import GlobalHealthProgressBanner from './GlobalHealthProgressBanner';
import GlobalIntegrationStatus from './GlobalIntegrationStatus';
import DeferralCandidatesBanner from './DeferralCandidatesBanner';

const AUTO_DISMISS_MS = 10000;

interface BannerToastProps {
  children: React.ReactNode;
  /** null → persistent (no auto-dismiss). */
  autoDismissMs?: number | null;
}

const BannerToast: React.FC<BannerToastProps> = ({ children, autoDismissMs = AUTO_DISMISS_MS }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [paused, setPaused] = useState(false);

  // Detect whether the wrapped banner actually rendered anything.
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const check = () => setHasContent(el.childElementCount > 0);
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // Auto-dismiss timer (skipped when persistent, empty, or hovered).
  useEffect(() => {
    if (dismissed || paused || !hasContent || !autoDismissMs) return;
    const t = window.setTimeout(() => setDismissed(true), autoDismissMs);
    return () => window.clearTimeout(t);
  }, [dismissed, paused, hasContent, autoDismissMs]);

  if (dismissed) return null;

  return (
    <div
      className="banner-toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        display: hasContent ? 'block' : 'none',
        position: 'relative',
        background: 'var(--panel, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 10,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        padding: '8px 10px',
        pointerEvents: 'auto',
      }}
    >
      <button
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        style={{
          position: 'absolute', top: 4, right: 4, zIndex: 2,
          background: 'transparent', border: 'none', borderRadius: 6,
          color: 'var(--muted, #6b7280)', cursor: 'pointer', padding: 2, lineHeight: 0,
        }}
      >
        <X size={14} />
      </button>
      <div ref={innerRef} style={{ paddingRight: 14 }}>{children}</div>
    </div>
  );
};

interface BannerToastStackProps {
  isSmallScreen: boolean;
  isLargeScreen: boolean;
  hidePlannerCapacityBanner: boolean;
  topOffset: number;
  rightOffset: number;
}

const BannerToastStack: React.FC<BannerToastStackProps> = ({
  isSmallScreen,
  isLargeScreen,
  hidePlannerCapacityBanner,
  topOffset,
  rightOffset,
}) => {
  return (
    <div
      className="banner-toast-stack"
      style={{
        position: 'fixed',
        top: topOffset,
        right: isSmallScreen ? 8 : rightOffset,
        left: isSmallScreen ? 8 : 'auto',
        width: isSmallScreen ? 'auto' : 360,
        maxWidth: isSmallScreen ? 'none' : 360,
        maxHeight: `calc(100vh - ${topOffset}px - 16px)`,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        zIndex: 1045,
        pointerEvents: 'none',
      }}
    >
      {/* Persistent — stays until actioned or closed */}
      <BannerToast autoDismissMs={null}><DeferralCandidatesBanner /></BannerToast>

      {/* Auto-dismiss after 10s */}
      <BannerToast><CheckInBanner /></BannerToast>
      <BannerToast><CoachVerdictBanner /></BannerToast>
      {!hidePlannerCapacityBanner && <BannerToast><PlannerCapacityBanner /></BannerToast>}
      <BannerToast><SprintClosureBanner /></BannerToast>
      <BannerToast><PlannedSprintBanner /></BannerToast>
      {isLargeScreen && <BannerToast><GlobalHealthProgressBanner /></BannerToast>}
      {isLargeScreen && <BannerToast><GlobalIntegrationStatus /></BannerToast>}
    </div>
  );
};

export default BannerToastStack;
