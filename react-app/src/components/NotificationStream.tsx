/**
 * NotificationStream
 *
 * Single bell icon in the toolbar that opens one popover containing every
 * active banner category stacked as a vertical stream — deferral candidates,
 * check-in, coach, sprint closure, planned sprint, focus goals, fitness KPIs,
 * health, integrations — instead of one bell per category.
 *
 * Each section wraps a self-contained banner component that renders null
 * when it has nothing to show; a MutationObserver per section reports
 * visibility up so the bell only appears (and escalates to "prominent")
 * when something is actually active.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import DeferralCandidatesBanner from './DeferralCandidatesBanner';
import CheckInBanner from './checkins/CheckInBanner';
import { CoachVerdictBanner } from './coach/CoachVerdictBanner';
import SprintClosureBanner from './sprints/SprintClosureBanner';
import PlannedSprintBanner from './sprints/PlannedSprintBanner';
import GlobalGoalFocusBanner from './GlobalGoalFocusBanner';
import GlobalFitnessKpiBanner from './GlobalFitnessKpiBanner';
import GlobalHealthProgressBanner from './GlobalHealthProgressBanner';
import GlobalIntegrationStatus from './GlobalIntegrationStatus';

interface StreamSectionProps {
  id: string;
  onVisibilityChange: (id: string, visible: boolean) => void;
  children: React.ReactNode;
}

const StreamSection: React.FC<StreamSectionProps> = ({ id, onVisibilityChange, children }) => {
  const innerRef = useRef<HTMLDivElement>(null);
  const [hasContent, setHasContent] = useState(false);

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
    onVisibilityChange(id, hasContent);
  }, [id, hasContent, onVisibilityChange]);

  return (
    <div
      style={{
        display: hasContent ? 'block' : 'none',
        paddingBottom: 8, marginBottom: 8,
        borderBottom: '1px solid var(--border, #e5e7eb)',
      }}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
};

interface NotificationStreamProps {
  isLargeScreen: boolean;
}

const NotificationStream: React.FC<NotificationStreamProps> = ({ isLargeScreen }) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);

  const handleVisibilityChange = useCallback((id: string, visible: boolean) => {
    setVisibleMap((prev) => (prev[id] === visible ? prev : { ...prev, [id]: visible }));
  }, []);

  const activeCount = useMemo(() => Object.values(visibleMap).filter(Boolean).length, [visibleMap]);
  const hasContent = activeCount > 0;
  const prominent = activeCount > 1;

  useEffect(() => {
    if (!hasContent) setOpen(false);
  }, [hasContent]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: hasContent ? 'block' : 'none' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        style={{
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30,
          background: prominent ? 'var(--bg-accent, rgba(95,119,220,0.12))' : 'transparent',
          border: prominent ? '1px solid var(--brand, #5f77dc)' : '1px solid transparent',
          borderRadius: 8,
          color: prominent ? 'var(--brand, #5f77dc)' : 'var(--text, #000)',
          cursor: 'pointer',
        }}
      >
        <Bell size={16} />
        <span
          style={{
            position: 'absolute', top: 1, right: 1,
            minWidth: 14, height: 14, padding: '0 3px',
            borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 700, lineHeight: 1,
            background: prominent ? 'var(--brand, #5f77dc)' : 'var(--muted, #9ca3af)',
            color: '#fff',
            border: '1.5px solid var(--panel, #fff)',
          }}
        >
          {activeCount}
        </span>
      </button>

      <div
        style={{
          display: open ? 'block' : 'none',
          position: 'absolute', top: '100%', right: 0, marginTop: 6,
          width: 'min(92vw, 360px)',
          maxHeight: 520,
          overflowY: 'auto',
          background: 'var(--panel, #fff)',
          border: '1px solid var(--border, #e5e7eb)',
          borderRadius: 10,
          padding: 8,
          zIndex: 1045,
        }}
      >
        <StreamSection id="deferral" onVisibilityChange={handleVisibilityChange}>
          <DeferralCandidatesBanner />
        </StreamSection>
        <StreamSection id="checkin" onVisibilityChange={handleVisibilityChange}>
          <CheckInBanner />
        </StreamSection>
        <StreamSection id="coach" onVisibilityChange={handleVisibilityChange}>
          <CoachVerdictBanner />
        </StreamSection>
        <StreamSection id="sprintClosure" onVisibilityChange={handleVisibilityChange}>
          <SprintClosureBanner />
        </StreamSection>
        <StreamSection id="plannedSprint" onVisibilityChange={handleVisibilityChange}>
          <PlannedSprintBanner />
        </StreamSection>
        <StreamSection id="focusGoals" onVisibilityChange={handleVisibilityChange}>
          <GlobalGoalFocusBanner />
        </StreamSection>
        {isLargeScreen && (
          <StreamSection id="fitness" onVisibilityChange={handleVisibilityChange}>
            <GlobalFitnessKpiBanner />
          </StreamSection>
        )}
        {isLargeScreen && (
          <StreamSection id="health" onVisibilityChange={handleVisibilityChange}>
            <GlobalHealthProgressBanner />
          </StreamSection>
        )}
        {isLargeScreen && (
          <StreamSection id="integration" onVisibilityChange={handleVisibilityChange}>
            <GlobalIntegrationStatus />
          </StreamSection>
        )}
      </div>
    </div>
  );
};

export default NotificationStream;
