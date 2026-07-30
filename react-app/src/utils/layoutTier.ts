/**
 * layoutTier — the single source of truth for "what shape of screen is this?".
 *
 * Replaces seven independent definitions of "mobile" that had drifted apart (deviceDetection
 * said <768 or an iPad under 1024, SidebarLayout said <768, MobileHome said <=768, Dashboard
 * said <992, GlobalSidebar said <=576, ClickTrackingService said any touch device over 768).
 * At 768px exactly, four of those disagreed with each other.
 *
 * Three things this fixes beyond consolidation:
 *
 * 1. iPad is actually detected. The old check was `/ipad/i.test(userAgent)` alone. Since
 *    iPadOS 13 Safari defaults to "Request Desktop Website" and reports a Macintosh UA with
 *    no "iPad" in it, so an iPad browsing normally could fall down the desktop path. The
 *    maxTouchPoints test below is the standard way to catch that — a real Mac reports 0.
 *    NOTE this is additive: a UA that already says "iPad" is still an iPad, so devices that
 *    were detected before keep their exact behaviour.
 *
 * 2. Stable object identity. useDeviceInfo() built a fresh object on every resize event, so
 *    thirteen consumer trees re-rendered on every frame of a drag or rotate. The snapshot
 *    here is cached and only replaced when the derived tier actually changes — raw pixel
 *    width is deliberately NOT part of the identity, because no consumer reads it.
 *
 * 3. Rotation is observed. The old hook listened to `resize` only. iPadOS does fire resize on
 *    rotate, but orientationchange and visualViewport (software keyboard) are the events that
 *    make it reliable.
 */
import { useSyncExternalStore } from 'react';
import { BREAKPOINT } from './layoutTokens';

export type LayoutTier = 'phone' | 'tablet' | 'desktop';

export interface LayoutState {
  tier: LayoutTier;
  /** Tablet only; phone and desktop are always 1. Drives the future two-pane shell. */
  panes: 1 | 2;
  orientation: 'portrait' | 'landscape';
  isIPadOS: boolean;
  isCoarsePointer: boolean;
  /**
   * @deprecated Migration shim, delete once the tablet shell lands.
   *
   * The old deviceDetection booleans, computed with their ORIGINAL formulas. They are carried
   * here so deviceDetection.ts can move onto this store — gaining correct iPad detection,
   * stable identity and rotation handling — without changing a single rendering decision.
   * They differ from the tier deliberately: an iPad in portrait is `tier: 'tablet'` but
   * `legacyIsMobile: true`, because today it routes to the phone-style MobileHome. Phase 2
   * flips those call sites over to `tier` one at a time; nothing should read these in new code.
   */
  legacyIsMobile: boolean;
  /** @deprecated See legacyIsMobile. */
  legacyIsTablet: boolean;
}

const OVERRIDE_KEY = 'bobLayoutTierOverride';

/**
 * `?tier=phone|tablet|desktop` pins the tier for the session. This is how tablet layouts get
 * exercised without a physical iPad, and the escape hatch if detection is ever wrong in the
 * field. Read once per computation so it survives client-side navigation.
 */
const readOverride = (): LayoutTier | null => {
  if (typeof window === 'undefined') return null;
  const valid = (v: string | null): LayoutTier | null =>
    v === 'phone' || v === 'tablet' || v === 'desktop' ? v : null;

  const fromUrl = valid(new URLSearchParams(window.location.search).get('tier'));
  if (fromUrl) {
    // Persistence is best-effort and deliberately separate from the return value: Safari in
    // private mode, and any embedded/partitioned context, throw on sessionStorage access. A
    // storage failure must not discard an override the URL plainly asked for.
    try { sessionStorage.setItem(OVERRIDE_KEY, fromUrl); } catch { /* not persisted */ }
    return fromUrl;
  }

  try {
    return valid(sessionStorage.getItem(OVERRIDE_KEY));
  } catch {
    return null;
  }
};

/** True for iPad on any modern iPadOS, whether or not it admits to being one. */
export const detectIPadOS = (
  ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  maxTouchPoints: number = typeof navigator !== 'undefined' ? navigator.maxTouchPoints || 0 : 0,
): boolean => /ipad/i.test(ua) || (/macintosh/i.test(ua) && maxTouchPoints > 1);

/** Phones only — iPad is excluded because iPadOS UA strings can contain "Mobile". */
const isPhoneUA = (ua: string): boolean =>
  /iphone|ipod|android.*mobile|blackberry|iemobile|opera mini/i.test(ua);

/**
 * Pure so it can be unit-tested across real device tuples without a browser.
 *
 * Order matters. UA is consulted before width because width alone cannot separate the two
 * ends of the range: an iPhone 16 Pro Max in landscape is 932px — wider than an iPad mini in
 * portrait at 744 — and an iPad Pro 13" in landscape is 1366px, above any sane desktop line.
 */
export const computeTier = (input: {
  width: number;
  height: number;
  ua: string;
  maxTouchPoints: number;
  coarsePointer: boolean;
  override?: LayoutTier | null;
}): LayoutState => {
  const { width, height, ua, maxTouchPoints, coarsePointer, override } = input;
  const isIPadOS = detectIPadOS(ua, maxTouchPoints);

  let tier: LayoutTier;
  if (override) {
    tier = override;
  } else if (isPhoneUA(ua) && !isIPadOS) {
    // A phone stays a phone in landscape, however wide it reports.
    tier = 'phone';
  } else if (isIPadOS) {
    // An iPad is a tablet in both orientations. The only exception is a Split View pane
    // narrow enough to genuinely be phone-shaped.
    tier = width <= BREAKPOINT.phoneMax ? 'phone' : 'tablet';
  } else if (width <= BREAKPOINT.phoneMax) {
    tier = 'phone';
  } else if (width < BREAKPOINT.desktopMin) {
    tier = 'tablet';
  } else {
    tier = 'desktop';
  }

  return {
    tier,
    panes: tier === 'tablet' && width >= BREAKPOINT.twoPaneMin ? 2 : 1,
    orientation: height >= width ? 'portrait' : 'landscape',
    isIPadOS,
    isCoarsePointer: coarsePointer,
    // Verbatim reproduction of the old deviceDetection.ts formulas, with isIPadOS swapped in
    // for its broken UA-only predecessor. Kept in the snapshot (and in the identity key below)
    // so they stay consistent with the width that produced them.
    //
    // An explicit override drives these too. Until the tablet shell lands, every consumer
    // still reads these booleans rather than `tier`, so an override that only set `tier`
    // would change nothing on screen and `?tier=` would be untestable.
    legacyIsMobile: override
      ? override === 'phone'
      : (isPhoneUA(ua) && !isIPadOS) || width < 768 || (isIPadOS && width < 1024),
    legacyIsTablet: override
      ? override === 'tablet'
      : (isIPadOS && width >= 1024) || (!isIPadOS && width >= 768 && width < 1200),
  };
};

const readEnvironment = (): LayoutState =>
  computeTier({
    // documentElement.clientWidth avoids the pinch-zoom skew innerWidth picks up on iOS.
    width: Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth),
    height: window.innerHeight,
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints || 0,
    coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
    override: readOverride(),
  });

const SERVER_SNAPSHOT: LayoutState = {
  tier: 'desktop', panes: 1, orientation: 'landscape', isIPadOS: false, isCoarsePointer: false,
  legacyIsMobile: false, legacyIsTablet: false,
};

// Raw pixel width is deliberately absent: no consumer reads it, and including it is exactly
// what made every resize frame produce a new object. The legacy booleans ARE included, since
// they flip at 768/1024/1200 — boundaries the tier itself does not have.
const identity = (s: LayoutState) =>
  `${s.tier}|${s.panes}|${s.orientation}|${s.isIPadOS}|${s.isCoarsePointer}`
  + `|${s.legacyIsMobile}|${s.legacyIsTablet}`;

let snapshot: LayoutState = typeof window === 'undefined' ? SERVER_SNAPSHOT : readEnvironment();
const listeners = new Set<() => void>();
let frame = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const recompute = () => {
  const next = readEnvironment();
  // The whole point of the cache: a resize that does not cross a boundary must not produce a
  // new object, or every consumer re-renders for nothing.
  if (identity(next) === identity(snapshot)) return;
  snapshot = next;
  listeners.forEach((l) => l());
};

const flush = () => {
  if (frame) { cancelAnimationFrame(frame); frame = 0; }
  if (timer) { clearTimeout(timer); timer = null; }
  recompute();
};

/**
 * rAF settles within one frame of the last resize event, so rotation has no visible lag while
 * a burst still collapses into one recomputation.
 *
 * The setTimeout is not belt-and-braces, it is required for correctness: rAF is throttled to
 * zero in a hidden tab, so a resize that lands while the app is backgrounded — rotate the iPad
 * with the app in the background, resize a Split View, lock and unlock — would leave `frame`
 * set and never cleared. Every later event would then hit the guard below and be swallowed,
 * wedging the layout until a reload. Whichever timer wins cancels the other.
 */
const schedule = () => {
  if (frame || timer) return;
  frame = requestAnimationFrame(flush);
  timer = setTimeout(flush, 100);
};

const subscribe = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  if (listeners.size === 0) {
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    // Returning to a backgrounded tab is the moment the viewport is most likely to have
    // changed without us having been able to measure it.
    document.addEventListener('visibilitychange', schedule);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('orientationchange', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', schedule);
      if (frame) { cancelAnimationFrame(frame); frame = 0; }
      if (timer) { clearTimeout(timer); timer = null; }
    }
  };
};

const getSnapshot = (): LayoutState => snapshot;
const getServerSnapshot = (): LayoutState => SERVER_SNAPSHOT;

/** Reactive access. One shared set of listeners for the whole app. */
export const useLayoutState = (): LayoutState =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

export const useLayoutTier = (): LayoutTier => useLayoutState().tier;

/** Non-reactive read, for module scope and event handlers. */
export const getLayoutState = (): LayoutState =>
  typeof window === 'undefined' ? SERVER_SNAPSHOT : snapshot;

/** Test seam: forces a recomputation and returns the fresh value. */
export const __recomputeLayoutState = (): LayoutState => {
  if (typeof window !== 'undefined') recompute();
  return snapshot;
};

/** Test seams for the scheduler, which cannot be exercised through the React hook. */
export const subscribeForTest = subscribe;
export const getLayoutStateForTest = getSnapshot;
