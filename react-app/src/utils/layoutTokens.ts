/**
 * layoutTokens — the single place that decides what sits on top of what.
 *
 * Before this file the app carried ~14 ad-hoc z-index literals spread across components and
 * three stylesheets, several of which were mutually contradictory and one of which (the
 * Sprint selector's 2000) had no effect at all. The rules below are what those numbers were
 * groping towards.
 *
 * TWO THINGS TO KNOW BEFORE ADDING A NUMBER HERE
 *
 * 1. A z-index only competes with its siblings inside the nearest ancestor that forms a
 *    stacking context. `position` + `z-index`, `transform`, `filter`, `opacity < 1`,
 *    `backdrop-filter`, `will-change`, `contain` and `isolation` all create one. The desktop
 *    toolbar is `position: relative; z-index: TOOLBAR`, so everything rendered inside it —
 *    notification panel, Sprint selector menu, search results — is capped at TOOLBAR no
 *    matter what value it asks for. `position: fixed` does NOT escape this.
 *    => Anything that must float over the whole page is portalled to document.body
 *       (see portalTarget below) and only then does its value here mean anything.
 *
 * 2. Values at and above 1050 belong to Bootstrap. Do not squat on them.
 *       dropdown 1000 · sticky 1020 · fixed 1030 · offcanvas-backdrop 1040
 *       offcanvas 1045 · modal-backdrop 1050 · modal 1055 · popover 1070 · tooltip 1080
 *    GlobalSidebar renders five different modals (Edit{Story,Goal,Task}, GoalChat, Research)
 *    and a delete confirm, all of which portal to body at Bootstrap's 1055 — so the sidebar
 *    itself must stay below 1050 or it covers its own dialogs.
 */

/**
 * Tier boundaries, in CSS px. Every layout breakpoint in the app should come from here.
 *
 * phoneMax 599 — the widest phone in portrait is ~480; the narrowest iPad in portrait is 744
 *   (mini). 600 sits in the empty middle with clearance on both sides. 768 would be wrong: it
 *   puts the iPad mini on the phone tier. 600 also correctly calls an iPad slide-over pane
 *   (~320–400) a phone, which it genuinely is.
 * twoPaneMin 900 — a sub-mode, not a tier. Chrome costs rail 56 + detail 380 = 436, so at 834
 *   (iPad Pro 11" portrait) the list would get 398px, narrower than an iPhone. Keyed on width
 *   rather than orientation so Split View and Stage Manager sizes land correctly.
 * desktopMin 1200 — iPad Pro 11" landscape is 1194 and iPad Air is 1180; a 1024 line would
 *   call both of them desktop, which is the bug this replaces. 1200 is already the app's de
 *   facto desktop line, so real desktops see no change.
 */
export const BREAKPOINT = {
  phoneMax: 599,
  tabletMin: 600,
  twoPaneMin: 900,
  desktopMin: 1200,
} as const;

/** Fixed chrome dimensions. Mirrored to CSS custom properties by applyLayoutTokens(). */
export const SIZE = {
  railW: 56,
  sidebarW: 250,
  detailPaneW: 380,
  overlayPanelW: 420,
  mobileHeaderH: 60,
  tabBarH: 64,
} as const;

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/**
 * Publishes SIZE/SPACE as CSS custom properties so stylesheets stop hardcoding the same
 * numbers. MOBILE_TAB_BAR_HEIGHT (MobileHome.tsx) and the literal 64px in MaterialDesign.css's
 * FAB offset are the same measurement duplicated across the JS/CSS boundary; this is how they
 * become one value. TypeScript stays authoritative at runtime.
 */
export const applyLayoutTokens = (): void => {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  Object.entries(SIZE).forEach(([k, v]) => root.style.setProperty(`--bob-${k}`, `${v}px`));
  Object.entries(SPACE).forEach(([k, v]) => root.style.setProperty(`--bob-space-${k}`, `${v}px`));
};

export const Z = {
  /** Page content. Nothing in a route should set a z-index above this. */
  pageMax: 900,

  /** Right-docked Activity Stream in its desktop/tablet form, and its inner chrome. */
  sidebarRight: 1000,
  sidebarRightControls: 1002,

  /** Desktop top toolbar. Above the docked sidebar so its controls stay clickable when the
   *  Activity Stream is open — the original reason this number exists. */
  toolbar: 1010,

  /** Fixed bottom bars (mobile tab bar, fitness tab bar). Bootstrap $zindex-fixed. */
  bottomBar: 1030,

  /** Fixed mobile top header. Above page content and the bottom bars, but deliberately BELOW
   *  Bootstrap's offcanvas (1045): it used to sit at 1050, which covered both the nav
   *  Offcanvas and the full-screen Activity Stream — burying the only control that closes
   *  them. */
  mobileHeader: 1035,

  /** Scrim behind a floating panel. Bootstrap $zindex-offcanvas-backdrop. */
  scrim: 1040,

  /** Full-viewport sliding panels: the Activity Stream on phone, and portalled toolbar
   *  popovers. Bootstrap $zindex-offcanvas — which is exactly what these are. Must stay
   *  below modal-backdrop (1050) so dialogs opened from inside them still appear on top. */
  panel: 1045,

  /**
   * Dropdown menus that must clear page content. Above MaterialDesign.css's own
   * `.dropdown-menu` at 1060 — which is why a menu sitting at `panel` (1045) still rendered
   * BEHIND the roadmap grid and read as transparent. Below Bootstrap's tooltip (1080) so
   * tooltips still win. A menu inside a `position: fixed` container is capped by that
   * container's stacking context regardless, so this only decides order among siblings.
   */
  menu: 1075,

  /**
   * A portalled popover anchored to a control INSIDE a modal — a combobox list, a date picker.
   *
   * It has to clear 9999, not Bootstrap's 1055, because `styles/KanbanFixes.css` raises every
   * `.modal` to `z-index: 9999 !important` app-wide (and the backdrop to 9998). That override
   * squats far above the range this file documents, so a popover at `menu` renders behind the
   * dialog it belongs to and reads as simply not opening.
   *
   * The right fix is to delete that override and let modals sit at 1055; until then this is the
   * number that works. Nothing else should go above it.
   */
  menuInModal: 10000,
} as const;

/**
 * Shared portal host for popovers that must escape the toolbar's stacking context and its
 * ancestors' overflow. Rendering into document.body puts them in the root stacking context,
 * where the values above actually apply.
 */
export const portalTarget = (): HTMLElement | null =>
  typeof document !== 'undefined' ? document.body : null;
