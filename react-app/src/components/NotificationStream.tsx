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
import { createPortal } from 'react-dom';
import { Bell, Pin, PinOff, X } from 'lucide-react';
import { Z, portalTarget } from '../utils/layoutTokens';
import WorkOnNextBanner from './WorkOnNextBanner';
import DeferralCandidatesBanner from './DeferralCandidatesBanner';
import CheckInBanner from './checkins/CheckInBanner';
import { CoachVerdictBanner } from './coach/CoachVerdictBanner';
import SprintClosureBanner from './sprints/SprintClosureBanner';
import PlannedSprintBanner from './sprints/PlannedSprintBanner';
import GlobalGoalFocusBanner from './GlobalGoalFocusBanner';
import GlobalFitnessKpiBanner from './GlobalFitnessKpiBanner';
import GlobalHealthProgressBanner from './GlobalHealthProgressBanner';
import GlobalIntegrationStatus from './GlobalIntegrationStatus';
import AiStatusBanner from './AiStatusBanner';
import { useSidebar } from '../contexts/SidebarContext';
import { useDeviceInfo } from '../utils/deviceDetection';

interface StreamSectionProps {
  id: string;
  onVisibilityChange: (id: string, visible: boolean) => void;
  /**
   * Flex order within the panel. Sections render in JSX order by default (order 0); a negative
   * value floats one to the top without moving it in the tree — remounting it would drop its
   * Firestore subscriptions and any in-flight OAuth state every time its severity changed.
   */
  order?: number;
  children: React.ReactNode;
}

const StreamSection: React.FC<StreamSectionProps> = ({ id, onVisibilityChange, order = 0, children }) => {
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
        order,
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ top: number; right: number }>({ top: 56, right: 8 });
  const [visibleMap, setVisibleMap] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  // Pinned = the panel becomes a persistent right-docked sidebar instead of a transient
  // dropdown (doesn't close on outside click), similar to GlobalSidebar's Activity Stream
  // panel. Per Jim, 2026-07-23.
  const [pinned, setPinned] = useState(() => {
    try { return localStorage.getItem('notifications_pinned') === '1'; } catch { return false; }
  });
  const { isVisible: activityStreamVisible, isCollapsed: activityStreamCollapsed, setNotificationsPinnedOpen } = useSidebar();
  const { isMobile } = useDeviceInfo();
  // "Pinned" means "dock permanently and shift page content over" — SidebarLayout only
  // reserves that margin on screens >=768px (window.innerWidth < 768 ? '0' : ...), so on
  // mobile a pinned panel had no reserved space and just sat as a fixed 340px-wide overlay
  // (nearly the full 375px viewport) on top of the page and the FAB, with no way to see or
  // reach anything underneath. Mobile has no room to dock a permanent sidebar, so pinning
  // is a no-op there — always fall back to the ordinary transient dropdown, which already
  // sizes itself correctly (`min(92vw, 360px)`) and closes on outside click/Escape.
  const effectivePinned = pinned && !isMobile;

  const handleVisibilityChange = useCallback((id: string, visible: boolean) => {
    setVisibleMap((prev) => (prev[id] === visible ? prev : { ...prev, [id]: visible }));
  }, []);

  // An integration with no successful sync for more than 3 days outranks everything else in
  // the panel — per Jim, 2026-08-06. Everything below it is advisory; a dead Monzo or Calendar
  // feed means the numbers the rest of the stream is reasoning about are quietly wrong.
  const [integrationCritical, setIntegrationCritical] = useState(false);
  const handleIntegrationCritical = useCallback((critical: boolean) => {
    setIntegrationCritical((prev) => (prev === critical ? prev : critical));
  }, []);

  // The integrations section is always populated now that it reports healthy last-sync times as
  // well as failures, so counting it would peg the bell permanently at "prominent" and drain
  // that signal of meaning. It contributes to the count only when something is actually broken.
  const alertCount = useMemo(
    () => Object.entries(visibleMap).filter(([id, visible]) => visible && id !== 'integration').length,
    [visibleMap]
  );
  const activeCount = alertCount + (integrationCritical ? 1 : 0);
  const hasContent = Object.values(visibleMap).some(Boolean);
  const prominent = activeCount > 1 || integrationCritical;

  // Both this panel and GlobalSidebar's Activity Stream dock to the right edge. Previously,
  // pinning notifications while the Activity Stream was also open collapsed this panel down
  // to a 10px sliver — which per Jim, 2026-07-25, reads as "notifications don't show and
  // can't be pinned" rather than as a deliberate collapsed state. Instead, dock this panel
  // immediately to the LEFT of whatever width the Activity Stream is currently occupying, at
  // its normal full size — both stay genuinely visible and usable side by side.
  const activityStreamReservedWidth = activityStreamVisible ? (activityStreamCollapsed ? 60 : 400) : 0;

  // Mirror into SidebarContext so page layouts (SidebarLayout's main content margin, same
  // mechanism already used for the Activity Stream sidebar) can reserve space instead of
  // letting this panel just overlap whatever's underneath. Confirmed by Jim, 2026-07-24:
  // pinned notifications should shift content the same way the Activity Stream does.
  useEffect(() => {
    setNotificationsPinnedOpen(effectivePinned && open);
    return () => setNotificationsPinnedOpen(false);
  }, [effectivePinned, open, setNotificationsPinnedOpen]);

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
    if (!open || effectivePinned) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      // The panel is portalled to <body>, so it is NOT a DOM descendant of wrapperRef any
      // more — testing the wrapper alone would treat every click inside the panel as an
      // outside click and close it immediately.
      if (wrapperRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
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
  }, [open, effectivePinned]);

  // Anchor the transient dropdown to the bell. Portalling costs us `position: absolute;
  // top: 100%`, which only worked while the panel lived inside the wrapper, so the
  // equivalent fixed-position coordinates get measured here instead. Recomputed on scroll
  // (capture phase — the toolbar's own scroll container does not bubble) and on resize.
  useLayoutEffect(() => {
    if (!open || effectivePinned) return;
    const measure = () => {
      const el = wrapperRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchor({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, effectivePinned]);

  const host = portalTarget();

  const panel = (
    <div
      ref={panelRef}
      style={{
        // Flex column so sections can be reordered via `order` (see StreamSection) rather than
        // by moving them in the tree.
        display: open ? 'flex' : 'none',
        flexDirection: 'column',
        position: 'fixed',
        ...(effectivePinned
          ? { top: 56, right: activityStreamReservedWidth, bottom: 0, borderRadius: 0 }
          : { top: anchor.top, right: anchor.right, borderRadius: 10 }),
        width: effectivePinned ? 340 : 'min(92vw, 360px)',
        maxHeight: effectivePinned ? undefined : 520,
        overflowY: 'auto',
        background: 'var(--panel, #fff)',
        // Per-side widths only — never the `border` shorthand alongside `borderTop`/`Right`/
        // `Bottom`. The panel now stays mounted and flips between pinned and unpinned on the
        // same DOM node, and React cannot reliably clear a longhand that a shorthand also
        // set: unpinning left the docked state's `borderTop: none` behind. Docked, it shows
        // only a left edge (plus a right edge when the Activity Stream sits beside it);
        // floating, it shows all four.
        borderStyle: 'solid',
        borderColor: 'var(--border, #e5e7eb)',
        borderWidth: effectivePinned
          ? `0 ${activityStreamReservedWidth > 0 ? '1px' : '0'} 0 1px`
          : '1px',
        padding: 8,
        zIndex: Z.panel,
      }}
    >
      {/* order -2 keeps the pin/close controls above anything a section floats to the top. */}
      <div style={{ display: 'flex', order: -2, justifyContent: 'flex-end', gap: 4, marginBottom: 4 }}>
        {/* Pinning permanently docks the panel — meaningless on mobile (no room to reserve
            a permanent 340px strip), so the toggle is hidden there rather than shown as a
            no-op. */}
        {!isMobile && (
          <button
            onClick={togglePinned}
            title={pinned ? 'Unpin' : 'Pin to right side'}
            style={{ background: 'transparent', border: 'none', color: 'var(--muted, #9ca3af)', cursor: 'pointer', padding: 4, display: 'flex' }}
          >
            {pinned ? <PinOff size={14} /> : <Pin size={14} />}
          </button>
        )}
        <button
          onClick={() => setOpen(false)}
          title="Close"
          style={{ background: 'transparent', border: 'none', color: 'var(--muted, #9ca3af)', cursor: 'pointer', padding: 4, display: 'flex' }}
        >
          <X size={14} />
        </button>
      </div>
      {/* Above even "what do I pick up now": if AI is off or the user's key has failed, most
          of what follows (priorities, the daily plan, the coach) is running blind or not at
          all, so it needs saying first. Not gated on screen size — it is a blocking setup
          state, not a desktop nicety. */}
      <StreamSection id="aiStatus" onVisibilityChange={handleVisibilityChange}>
        <AiStatusBanner />
      </StreamSection>
      {/* Then: the stream's other sections all tell you something is wrong or overdue.
          This one answers "what do I pick up now", so it leads. */}
      <StreamSection id="workOnNext" onVisibilityChange={handleVisibilityChange}>
        <WorkOnNextBanner />
      </StreamSection>
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
      {/* Not gated on screen size: unlike the fitness/health KPI panels above, this is a
          broken-plumbing warning, and a dead Monzo or Calendar feed matters at least as much on
          a phone. Floats above every other section while anything is critical. */}
      <StreamSection
        id="integration"
        onVisibilityChange={handleVisibilityChange}
        order={integrationCritical ? -1 : 0}
      >
        <GlobalIntegrationStatus onCriticalChange={handleIntegrationCritical} />
      </StreamSection>
    </div>
  );

  // The panel and its backdrop are portalled to <body>. They used to render here, inside the
  // toolbar — which is `position: relative; z-index: 1010` and therefore a stacking context,
  // so the panel's own z-index was resolved *within* 1010 and lost to ordinary page content
  // (MaterialDesign.css put every .dropdown at 1055). `position: fixed` does not escape a
  // stacking context either, so the pinned dock was trapped identically. On iPad it was worse
  // again: responsive-density.css clipped the toolbar with overflow:hidden, so the panel was
  // cut to nothing at every iPad width. Rendering into <body> puts both modes in the root
  // stacking context, where Z.panel actually means something.
  //
  // Always portalled, never conditionally mounted: each StreamSection reports its own
  // visibility up via MutationObserver, and that is what decides whether the bell appears at
  // all. Unmounting the panel when closed would leave the bell permanently blind.
  const overlay = (
    <>
      {open && !effectivePinned && (
        // The dropdown itself is a small, bounded panel with nothing behind it - the rest of
        // the page (including other header/card buttons that happen to sit near it, like the
        // Today's Plan card's Plan/Delta replan/Full replan row) stays fully visible AND
        // clickable, which reads as "showing through" even though there's no z-index conflict.
        // A transparent backdrop below the panel (but above the page) fixes both the visual
        // confusion and the accidental-click-through. Not shown when pinned — a pinned panel
        // is meant to stay open regardless of outside clicks, closed only via its own X.
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: Z.scrim, background: 'transparent' }}
          aria-hidden="true"
        />
      )}
      {panel}
    </>
  );

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: hasContent ? 'block' : 'none' }}>
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
        {/* No badge at zero: the panel is now always reachable (it carries healthy last-sync
            times too), so a permanent "0" would be noise rather than a count. */}
        {activeCount > 0 && (
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
        )}
      </button>

      {host ? createPortal(overlay, host) : overlay}
    </div>
  );
};

export default NotificationStream;
