import { computeTier, detectIPadOS, getLayoutState, __recomputeLayoutState } from './layoutTier';
import { BREAKPOINT } from './layoutTokens';

/**
 * The tier function is where the responsive design is actually decided, and almost none of it
 * can be proved in a browser: desktop Chrome cannot produce the combination that matters most
 * (a Macintosh user-agent reporting five touch points, which is what a real iPad sends). A
 * devtools UA override gives the string but not the touch points, so a green manual pass there
 * proves nothing. These tuples are the real validation.
 */

const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iPadClassic: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  iPadDesktopMode: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
};

const at = (width: number, height: number, ua: string, maxTouchPoints = 0) =>
  computeTier({ width, height, ua, maxTouchPoints, coarsePointer: maxTouchPoints > 0 });

describe('detectIPadOS', () => {
  it('accepts the classic iPad user-agent', () => {
    expect(detectIPadOS(UA.iPadClassic, 5)).toBe(true);
  });

  it('accepts an iPad reporting a Macintosh UA, which is the iPadOS 13+ default', () => {
    // This is the case the previous /ipad/i test missed entirely.
    expect(detectIPadOS(UA.iPadDesktopMode, 5)).toBe(true);
  });

  it('does not mistake a real Mac for an iPad', () => {
    // A Mac reports 0 touch points, which is the only thing separating it from the case above.
    expect(detectIPadOS(UA.mac, 0)).toBe(false);
  });

  it('does not mistake a touchscreen Windows laptop for an iPad', () => {
    expect(detectIPadOS(UA.windows, 10)).toBe(false);
  });
});

describe('computeTier — phones', () => {
  it('treats an iPhone in portrait as a phone', () => {
    expect(at(393, 852, UA.iPhone, 5).tier).toBe('phone');
  });

  it('treats an iPhone Pro Max in LANDSCAPE as a phone despite being 932px wide', () => {
    // 932 is wider than an iPad mini in portrait (744). Width alone cannot separate them,
    // which is why the UA test has to run first.
    expect(at(932, 430, UA.iPhone, 5).tier).toBe('phone');
  });

  it('treats an Android phone in landscape as a phone', () => {
    expect(at(915, 412, UA.androidPhone, 5).tier).toBe('phone');
  });

  it('treats a narrow desktop window as a phone', () => {
    expect(at(420, 900, UA.mac, 0).tier).toBe('phone');
  });
});

describe('computeTier — iPads', () => {
  const cases: Array<[string, number, number]> = [
    ['iPad mini portrait', 744, 1133],
    ['iPad 10th/Air portrait', 820, 1180],
    ['iPad Pro 11" portrait', 834, 1194],
    ['iPad Pro 13" portrait', 1024, 1366],
    ['iPad Air landscape', 1180, 820],
    ['iPad Pro 11" landscape', 1194, 834],
    ['iPad Pro 13" landscape', 1366, 1024],
  ];

  it.each(cases)('%s is a tablet on a classic iPad UA', (_label, w, h) => {
    expect(at(w, h, UA.iPadClassic, 5).tier).toBe('tablet');
  });

  it.each(cases)('%s is a tablet on a desktop-mode iPad UA too', (_label, w, h) => {
    // Same device, same answer, regardless of which UA Safari chose to send.
    expect(at(w, h, UA.iPadDesktopMode, 5).tier).toBe('tablet');
  });

  it('keeps iPad Pro 13" landscape (1366) off the desktop tier', () => {
    // A plain width rule would call this desktop and hand it the full desktop shell.
    expect(at(1366, 1024, UA.iPadDesktopMode, 5).tier).toBe('tablet');
  });

  it('treats a narrow Split View pane as a phone, because it genuinely is one', () => {
    expect(at(375, 1024, UA.iPadClassic, 5).tier).toBe('phone');
  });

  it.each([
    ['Split View 1/2 on iPad Air', 507],
    ['Split View 2/3 on iPad Pro', 795],
  ])('%s stays usable', (_label, w) => {
    const state = at(w, 1024, UA.iPadClassic, 5);
    expect(state.tier).toBe(w <= BREAKPOINT.phoneMax ? 'phone' : 'tablet');
  });
});

describe('computeTier — desktops', () => {
  it.each([
    ['MacBook Air', 1280],
    ['1440p', 1440],
    ['ultrawide', 2560],
  ])('%s is desktop', (_label, w) => {
    expect(at(w, 900, UA.mac, 0).tier).toBe('desktop');
  });

  it('treats a resized desktop window between 600 and 1199 as a tablet', () => {
    expect(at(1000, 900, UA.mac, 0).tier).toBe('tablet');
  });

  it('does not put a touchscreen Windows laptop on the tablet tier by width alone', () => {
    // ClickTrackingService used to call any touch device >=768 a tablet, including this.
    expect(at(1920, 1080, UA.windows, 10).tier).toBe('desktop');
  });
});

describe('computeTier — boundaries', () => {
  it('switches phone→tablet exactly at the documented breakpoint', () => {
    expect(at(BREAKPOINT.phoneMax, 900, UA.mac, 0).tier).toBe('phone');
    expect(at(BREAKPOINT.tabletMin, 900, UA.mac, 0).tier).toBe('tablet');
  });

  it('switches tablet→desktop exactly at the documented breakpoint', () => {
    expect(at(BREAKPOINT.desktopMin - 1, 900, UA.mac, 0).tier).toBe('tablet');
    expect(at(BREAKPOINT.desktopMin, 900, UA.mac, 0).tier).toBe('desktop');
  });

  it('has no gap at 768, where four of the old thresholds disagreed', () => {
    expect(at(767, 900, UA.mac, 0).tier).toBe('tablet');
    expect(at(768, 900, UA.mac, 0).tier).toBe('tablet');
    expect(at(769, 900, UA.mac, 0).tier).toBe('tablet');
  });
});

describe('computeTier — panes', () => {
  it('gives a wide tablet two panes', () => {
    expect(at(1024, 1366, UA.iPadClassic, 5).panes).toBe(2);
  });

  it('gives a narrow tablet one pane, since a detail pane would leave no list', () => {
    // 834 - rail 56 - detail 380 = 398px of list, narrower than an iPhone.
    expect(at(834, 1194, UA.iPadClassic, 5).panes).toBe(1);
  });

  it('never gives phone or desktop two panes', () => {
    expect(at(393, 852, UA.iPhone, 5).panes).toBe(1);
    expect(at(1920, 1080, UA.mac, 0).panes).toBe(1);
  });
});

describe('computeTier — orientation and override', () => {
  it('reports orientation from the viewport, not the UA', () => {
    expect(at(820, 1180, UA.iPadClassic, 5).orientation).toBe('portrait');
    expect(at(1180, 820, UA.iPadClassic, 5).orientation).toBe('landscape');
  });

  it('lets an explicit override win over everything', () => {
    const forced = computeTier({
      width: 1920, height: 1080, ua: UA.mac, maxTouchPoints: 0,
      coarsePointer: false, override: 'tablet',
    });
    expect(forced.tier).toBe('tablet');
  });

  it('drives the legacy booleans too, so ?tier= actually changes what renders', () => {
    // Every consumer still reads legacyIsMobile/legacyIsTablet rather than `tier`. An override
    // that only set `tier` would be invisible on screen and impossible to test.
    const asPhone = computeTier({
      width: 1920, height: 1080, ua: UA.mac, maxTouchPoints: 0, coarsePointer: false, override: 'phone' });
    expect([asPhone.legacyIsMobile, asPhone.legacyIsTablet]).toEqual([true, false]);

    const asTablet = computeTier({
      width: 390, height: 844, ua: UA.iPhone, maxTouchPoints: 5, coarsePointer: true, override: 'tablet' });
    expect([asTablet.legacyIsMobile, asTablet.legacyIsTablet]).toEqual([false, true]);

    const asDesktop = computeTier({
      width: 390, height: 844, ua: UA.iPhone, maxTouchPoints: 5, coarsePointer: true, override: 'desktop' });
    expect([asDesktop.legacyIsMobile, asDesktop.legacyIsTablet]).toEqual([false, false]);
  });
});

describe('snapshot identity — the re-render fix', () => {
  /**
   * useDeviceInfo() returned a brand-new object for every resize event, so all thirteen
   * consumer trees re-rendered on every frame of a window drag or an iPad rotation. Object
   * identity is the mechanism that stops that, so it is what the test asserts: within a tier
   * the reference must be reused, and crossing a boundary must replace it exactly once.
   */
  const setWidth = (w: number) => {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
  };

  it('reuses the same object across resizes that do not cross a boundary', () => {
    setWidth(1300);
    const initial = __recomputeLayoutState();
    for (let w = 1300; w < 1360; w++) {
      setWidth(w);
      __recomputeLayoutState();
    }
    expect(getLayoutState()).toBe(initial);
    expect(getLayoutState().tier).toBe('desktop');
  });

  it('replaces the object exactly once when a boundary is crossed', () => {
    setWidth(1300);
    const desktop = __recomputeLayoutState();
    setWidth(1000);
    const tablet = __recomputeLayoutState();
    expect(tablet).not.toBe(desktop);
    expect(tablet.tier).toBe('tablet');

    // Further movement inside the new tier must not churn again.
    for (let w = 1000; w < 1040; w++) {
      setWidth(w);
      __recomputeLayoutState();
    }
    expect(getLayoutState()).toBe(tablet);
  });
});

describe('the scheduler must not wedge in a hidden tab', () => {
  /**
   * requestAnimationFrame is throttled to zero while a tab is hidden. A coalescing scheduler
   * that only guards on "is a frame pending" therefore latches: one resize while backgrounded
   * leaves the pending flag set for ever, and every later resize is swallowed. Symptom on a
   * real device is a layout stuck in the previous orientation until reload. The timeout is
   * what guarantees the queue always drains, so this asserts updates still land when rAF
   * never fires.
   */
  const realRaf = window.requestAnimationFrame;

  afterEach(() => {
    window.requestAnimationFrame = realRaf;
    jest.useRealTimers();
  });

  it('still updates when requestAnimationFrame never fires', async () => {
    jest.useFakeTimers();
    // Hand out handles but never invoke the callback, exactly as a hidden tab does.
    window.requestAnimationFrame = (() => 1) as unknown as typeof window.requestAnimationFrame;

    const { subscribeForTest, getLayoutStateForTest } = await import('./layoutTier');
    const seen: number[] = [];
    const unsubscribe = subscribeForTest(() => seen.push(1));

    Object.defineProperty(window, 'innerWidth', { value: 400, configurable: true, writable: true });
    window.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(150);
    expect(getLayoutStateForTest().tier).toBe('phone');

    // The wedge only showed up on the SECOND event, once the flag was stuck.
    Object.defineProperty(window, 'innerWidth', { value: 1400, configurable: true, writable: true });
    window.dispatchEvent(new Event('resize'));
    jest.advanceTimersByTime(150);
    expect(getLayoutStateForTest().tier).toBe('desktop');
    expect(seen.length).toBeGreaterThanOrEqual(2);

    unsubscribe();
  });
});

describe('parity with the behaviour this replaces', () => {
  /**
   * The one case that must not change: Jim's iPad reports a real iPad UA, and the Kanban's
   * iPad defaults (Triage table, Done hidden, filter chrome collapsed) are gated on
   * isIPad && isTablet. Both must stay true in landscape or that regresses.
   */
  it.each([[1024], [1180], [1194]])('keeps iPad landscape at %ipx on the tablet tier', (w) => {
    const state = at(w, 820, UA.iPadClassic, 5);
    expect(state.isIPadOS).toBe(true);
    expect(state.tier).toBe('tablet');
  });
});

describe('the tablet shell must follow the device, with no URL parameter', () => {
  /**
   * The shell is switched on by default, so these are the cases that decide whether a real
   * device gets it. An iPad must resolve to 'tablet' from detection alone — no ?shell=, no
   * setting — and critically at ANY width, because an iPad Pro 12.9" in landscape reports
   * 1366px and would otherwise fall past the desktop boundary into the wrong shell.
   */
  const ipad = (width: number, height: number) => computeTier({
    width, height, ua: UA.mac, maxTouchPoints: 5, coarsePointer: true,
  });

  it.each([
    ['iPad mini portrait', 744, 1133],
    ['iPad Air portrait', 820, 1180],
    ['iPad Air landscape', 1180, 820],
    ['iPad Pro 11 landscape', 1194, 834],
    ['iPad Pro 12.9 landscape', 1366, 1024],
  ])('%s is a tablet', (_label, w, h) => {
    expect(ipad(w, h).tier).toBe('tablet');
  });

  it('keeps an iPad Pro out of the desktop tier despite being wider than desktopMin', () => {
    // 1366 > 1200, so a width-only rule would hand this a desktop shell and a mouse-sized UI.
    expect(ipad(1366, 1024).tier).not.toBe('desktop');
    expect(ipad(1366, 1024).panes).toBe(2);
  });

  it('still gives a real desktop the desktop shell', () => {
    expect(computeTier({
      width: 1366, height: 768, ua: UA.mac, maxTouchPoints: 0, coarsePointer: false,
    }).tier).toBe('desktop');
  });

  it('drops to one pane in a narrow Split View but stays a tablet', () => {
    const split = ipad(700, 1080);
    expect(split.tier).toBe('tablet');
    expect(split.panes).toBe(1);
  });
});
