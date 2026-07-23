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
import { Bell, Pin, PinOff, X } from 'lucide-react';
import DeferralCandidatesBanner from './DeferralCandidatesBanner';
import CheckInBanner from './checkins/CheckInBanner';
import { CoachVerdictBanner } from './coach/CoachVerdictBanner';
import SprintClosureBanner from './sprints/SprintClosureBanner';
import PlannedSprintBanner from './sprints/PlannedSprintBanner';
import GlobalGoalFocusBanner from './GlobalGoalFocusBanner';
import GlobalFitnessKpiBanner from './GlobalFitnessKpiBanner';
import GlobalHealthProgressBanner from './GlobalHealthProgressBanner';
import GlobalIntegrationStatus from './GlobalIntegrationStatus';
import { useSidebar } from '../contexts/SidebarContext';

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
  // Pinned = the panel becomes a persistent right-docked sidebar instead of a transient
  // dropdown (doesn't close on outside click), similar to GlobalSidebar's Activity Stream
  // panel. Per Jim, 2026-07-23.
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('notifications_pinned') === '1'; } catch { return false; }
  });
  const { isVisible: activityStreamVisible } = useSidebar();

  const handleVisibilityChange = useCallback((id: string, visible: boolean) => {
    setVisibleMap((prev) => (prev[id] === visible ? prev : { ...prev, [id]: visible }));
  }, []);

  const activeCount = useMemo(() => Object.values(visibleMap).filter(Boolean).length, [visibleMap]);
  const hasContent = activeCount > 0;
  const prominent = activeCount > 1;

  // Both this panel and GlobalSidebar's Activity Stream dock to the right edge, so pinning
  // this one open while the Activity Stream is also open would overlap it. Collapse to a
  // slim bar in exactly that situation — reverts automatically once the Activity Stream
  // closes, since this is a pure derivation, not separate state to keep in sync.
  const collapsedToBar = pinned && open && activityStreamVisible;

  const togglePinned = () => {
    setPinned((prev) => {
      const next = !prev;
      try { localStorage.setItem('notifications_pinned', next ? '1' : '0'); } catch { /* noop */ }
      return next;
    });
  };

  useEffect(() => {
    if (!hasContent) setOpen(false);
  }, [hasContent]);

  useEffect(() => {
    if (!open || pinned) return;
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
  }, [open, pinned]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: hasContent ? 'block' : 'none' }}>
      {open && !pinned && (
        // The dropdown itself is a small, bounded panel with nothing behind it - the rest of
        // the page (including other header/card buttons that happen to sit near it, like the
        // Today's Plan card's Plan/Delta replan/Full replan row) stays fully visible AND
        // clickable, which reads as "showing through" even though there's no z-index conflict.
        // A transparent backdrop below the panel (but above the page) fixes both the visual
        // confusion and the accidental-click-through. Not shown when pinned — a pinned panel
        // is meant to stay open regardless of outside clicks, closed only via its own X.
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 1040, background: 'transparent' }}
          aria-hidden="true"
        />
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        style={{
          // No bordered/tinted "box" around the bell at any notification count — the small
          // count badge below is the indicator; the button itself always stays plain.
          position: 'relative',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 30, height: 30,
          background: 'transparent',
          border: '1px solid transparent',
          borderRadius: 8,
          color: 'var(--text, #000)',
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

      {/* Collapsed-to-a-bar state: pinned + open, but the Activity Stream sidebar is also
          open and would otherwise overlap it. A slim strip rather than fully hiding it, so
          it's clear notifications are still there and will reappear once the Activity
          Stream closes. */}
      {collapsedToBar && (
        <div
          style={{
            position: 'fixed', top: 56, right: 0, bottom: 0, width: 10,
            background: prominent ? 'var(--brand, #5f77dc)' : 'var(--muted, #9ca3af)',
            zIndex: 999, // just below GlobalSidebar (1000) — it owns the right edge right now
            cursor: 'default',
          }}
          title={`${activeCount} notification${activeCount === 1 ? '' : 's'} — collapsed while Activity Stream is open`}
        />
      )}

      <div
        style={{
          display: open && !collapsedToBar ? 'block' : 'none',
          ...(pinned
            ? { position: 'fixed', top: 56, right: 0, bottom: 0, marginTop: 0, borderRadius: 0, borderTop: 'none', borderRight: 'none', borderBottom: 'none' }
            : { position: 'absolute', top: '100%', right: 0, marginTop: 6, borderRadius: 10 }),
          width: pinned ? 340 : 'min(92vw, 360px)',
          maxHeight: pinned ? undefined : 520,
          overflowY: 'auto',
          background: 'var(--panel, #fff)',
          border: '1px solid var(--border, #e5e7eb)',
          padding: 8,
          zIndex: 1045,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 4 }}>
          <button
            onClick={togglePinned}
            title={pinned ? 'Unpin' : 'Pin to right side'}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted, #9ca3af)', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Close"
            style={{ background: 'transparent', border: 'none', color: 'var(--muted, #9ca3af)', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>
        <StreamSection id="deferral" onVisibilityChange={handleVisibilityChange}>
          <DeferralCandidatesBanner />
        </StreamSection>
        <StreamSection id="checkin" onVisibilityChange={handleVisibilityChange}>
          <CheckInBanner />
        </StreamSection>
        {/* Health/fitness grouped directly under AI Coach — per Jim, 2026-07-23. */}
        <StreamSection id="coach" onVisibilityChange={handleVisibilityChange}>
          <CoachVerdictBanner compact />
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
          <StreamSection id="integration" onVisibilityChange={handleVisibilityChange}>
            <GlobalIntegrationStatus />
          </StreamSection>
        )}
      </div>
    </div>
  );
};

export default NotificationStream;
