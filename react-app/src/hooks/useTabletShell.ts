/**
 * useTabletShell — decides whether the two-pane tablet shell is live.
 *
 * The shell follows the DEVICE, with no user action required: layoutTier identifies a tablet
 * from the user agent, touch points and pointer type — including iPadOS, which reports a
 * Macintosh user agent and so needs the touch check to be recognised at all — and an iPad is
 * treated as a tablet in both orientations regardless of width.
 *
 * The `tablet_shell` flag stays as a kill switch, defaulted on, for a device that turns out to
 * behave badly. The `?shell=` parameter below is a debug escape hatch for forcing the shell on
 * or off while testing; it is not how anyone is expected to reach this.
 */
import { useLocation } from 'react-router-dom';
import { useLayoutState } from '../utils/layoutTier';
import { useFeatureFlag } from './useFeatureFlag';

const LOCAL_KEY = 'bobTabletShell';

/**
 * Routes that stay single-pane on tablet, so their detail opens as an overlay sheet instead of
 * splitting the view. An opt-OUT list, not an opt-in one: the default is that a screen works in
 * the split, and only surfaces that genuinely need the full width are listed.
 *
 * These are the wide, horizontally-laid-out surfaces. The Sprint Kanban in particular is
 * deliberately here: its iPad behaviour (Triage table, Done column hidden, filter chrome
 * collapsed) is tuned and signed off, and squeezing its board and filter rail into a 588px
 * track at 1024 wrecks it — the chrome wraps into an unusable vertical stack. The calendar and
 * planner grids and the canvas have the same problem for the same reason.
 */
const SINGLE_PANE_PREFIXES = [
  '/sprints/kanban',
  '/sprints/management',
  '/planner',
  '/calendar',
  '/canvas',
  '/visual-canvas',
  '/goals/roadmap',
  '/goals/timeline',
  '/travel',
];

/**
 * Debug only. `?shell=1` / `?shell=0` pins the shell for the session, independent of the flag,
 * so it can be toggled repeatedly against different viewport widths while testing. Normal use
 * never involves this — the shell is chosen from the device.
 */
const readLocalOverride = (): boolean | null => {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('shell');
  if (raw === '1' || raw === '0') {
    try { sessionStorage.setItem(LOCAL_KEY, raw); } catch { /* not persisted */ }
    return raw === '1';
  }
  try {
    const stored = sessionStorage.getItem(LOCAL_KEY);
    return stored === '1' ? true : stored === '0' ? false : null;
  } catch {
    return null;
  }
};

export interface TabletShellState {
  /** True only when the tablet shell should actually render. */
  active: boolean;
  /** Pane count for the shell; meaningless when inactive. */
  panes: 1 | 2;
}

export const useTabletShell = (): TabletShellState => {
  const { tier, panes } = useLayoutState();
  const flagEnabled = useFeatureFlag('tablet_shell');
  const { pathname } = useLocation();
  const override = readLocalOverride();
  const enabled = override ?? flagEnabled;

  const forcedSinglePane = SINGLE_PANE_PREFIXES.some((p) => pathname.startsWith(p));

  return {
    active: enabled && tier === 'tablet',
    // The shell still applies (rail, density, tier class); only the split is suppressed, so
    // these routes keep the full width and their detail arrives as an overlay sheet.
    panes: forcedSinglePane ? 1 : panes,
  };
};

export default useTabletShell;
