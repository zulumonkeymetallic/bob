/**
 * BannerToastStack
 *
 * Collapsed bell badge, top-right, that never overlaps the header or the page
 * below it. Tapping it opens a single bounded, scrollable panel containing all
 * active banners — replacing the old always-expanded full-width toast stack,
 * which covered the header and most of the screen on narrow viewports.
 *
 * Behaviour:
 *   - Nothing renders (not even the bell) when no banner has content.
 *   - Auto-dismiss banners fade out 10s after they gain content, unless the
 *     user dismisses them first (hovering pauses the timer) or hits "Dismiss
 *     all". Timers keep running while the panel is collapsed.
 *   - Deferral candidates is persistent — excluded from "Dismiss all", stays
 *     until actioned or manually closed.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';
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
  id: string;
  children: React.ReactNode;
  /** null → persistent (no auto-dismiss). */
  autoDismissMs?: number | null;
  dismissAllTick?: number;
  onVisibilityChange: (id: string, visible: boolean) => void;
}

const BannerToast: React.FC<BannerToastProps> = ({ id, children, autoDismissMs = AUTO_DISMISS_MS, dismissAllTick, onVisibilityChange }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [paused, setPaused] = useState(false);
  const prevTickRef = useRef(dismissAllTick);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const check = () => setHasContent(el.childElementCount > 0);
    check();
    const mo = new MutationObserver(check);
    mo.observe(el, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    if (dismissed || paused || !hasContent || !autoDismissMs) return;
    const t = window.setTimeout(() => setDismissed(true), autoDismissMs);
    return () => window.clearTimeout(t);
  }, [dismissed, paused, hasContent, autoDismissMs]);

  useEffect(() => {
    if (dismissAllTick !== undefined && prevTickRef.current !== dismissAllTick) {
      prevTickRef.current = dismissAllTick;
      setDismissed(true);
    }
  }, [dismissAllTick]);

  const visible = hasContent && !dismissed;
  useEffect(() => {
    onVisibilityChange(id, visible);
  }, [id, visible, onVisibilityChange]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      style={{
        display: visible ? 'block' : 'none',
        position: 'relative',
        background: 'var(--panel, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 10,
        padding: '10px 28px 10px 10px',
        flexShrink: 0,
      }}
    >
      <button
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
        style={{
          position: 'absolute', top: 4, right: 4, zIndex: 2,
          width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent', border: 'none', borderRadius: 6,
          color: 'var(--muted, #6b7280)', cursor: 'pointer',
        }}
      >
        <X size={14} />
      </button>
      <div ref={innerRef}>{children}</div>
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

const BANNER_IDS = ['deferral', 'checkin', 'coach', 'plannerCapacity', 'sprintClosure', 'plannedSprint', 'health', 'integration'] as const;

const BannerToastStack: React.FC<BannerToastStackProps> = ({
  isSmallScreen,
  isLargeScreen,
  hidePlannerCapacityBanner,
  topOffset,
  rightOffset,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [dismissAllTick, setDismissAllTick] = useState(0);
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});

  const handleVisibilityChange = useCallback((id: string, visible: boolean) => {
    setVisibleMap((prev) => (prev[id] === visible ? prev : { ...prev, [id]: visible }));
  }, []);

  const count = useMemo(
    () => BANNER_IDS.reduce((n, id) => n + (visibleMap[id] ? 1 : 0), 0),
    [visibleMap],
  );

  useEffect(() => {
    if (count === 0) setExpanded(false);
  }, [count]);

  return (
    <div
      style={{
        position: 'fixed',
        top: topOffset,
        right: isSmallScreen ? 8 : rightOffset,
        zIndex: 1045,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 8,
      }}
    >
      {count > 0 && (
        <button
          onClick={() => setExpanded((v) => !v)}
          aria-label={`${count} alert${count !== 1 ? 's' : ''}`}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--panel, #fff)', border: '1px solid var(--border, #e5e7eb)',
            borderRadius: 18, padding: '6px 12px', cursor: 'pointer',
            color: 'var(--text)',
          }}
        >
          <Bell size={15} />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{count}</span>
        </button>
      )}

      <div
        style={{
          display: expanded && count > 0 ? 'flex' : 'none',
          flexDirection: 'column',
          width: isSmallScreen ? 'min(88vw, 360px)' : 360,
          maxHeight: `calc(100vh - ${topOffset}px - 56px)`,
          overflowY: 'auto',
          background: 'var(--surface, var(--panel, #fff))',
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 12,
          padding: 10,
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted)' }}>
            Alerts
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setDismissAllTick((t) => t + 1)}
              style={{ background: 'none', border: 'none', padding: 0, fontSize: 11, color: 'var(--brand, #5f77dc)', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Dismiss all
            </button>
            <button
              aria-label="Close"
              onClick={() => setExpanded(false)}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, background: 'transparent', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Persistent — excluded from "Dismiss all" */}
        <BannerToast id="deferral" autoDismissMs={null} onVisibilityChange={handleVisibilityChange}>
          <DeferralCandidatesBanner />
        </BannerToast>

        <BannerToast id="checkin" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><CheckInBanner /></BannerToast>
        <BannerToast id="coach" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><CoachVerdictBanner /></BannerToast>
        {!hidePlannerCapacityBanner && (
          <BannerToast id="plannerCapacity" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><PlannerCapacityBanner /></BannerToast>
        )}
        <BannerToast id="sprintClosure" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><SprintClosureBanner /></BannerToast>
        <BannerToast id="plannedSprint" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><PlannedSprintBanner /></BannerToast>
        {isLargeScreen && (
          <BannerToast id="health" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><GlobalHealthProgressBanner /></BannerToast>
        )}
        {isLargeScreen && (
          <BannerToast id="integration" dismissAllTick={dismissAllTick} onVisibilityChange={handleVisibilityChange}><GlobalIntegrationStatus /></BannerToast>
        )}
      </div>
    </div>
  );
};

export default BannerToastStack;
