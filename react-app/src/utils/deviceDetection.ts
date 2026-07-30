/**
 * deviceDetection — compatibility adapter over utils/layoutTier.
 *
 * This used to own the app's device logic. It now delegates, which buys its thirteen existing
 * consumers three fixes for free, with no call-site changes:
 *
 *   - iPad is detected even when Safari sends a Macintosh user-agent ("Request Desktop
 *     Website", the iPadOS default since 13). The old `/ipad/i.test(userAgent)` missed it.
 *   - The returned object keeps its identity across resizes that do not change anything, so
 *     consumers stop re-rendering on every frame of a drag or rotate.
 *   - Rotation and the software keyboard are observed, not just `resize`.
 *
 * Rendering decisions are UNCHANGED: isMobile/isTablet still use their original formulas
 * (see legacyIsMobile in layoutTier.ts). This file is the migration seam — new code should
 * use `useLayoutTier()` / `useLayoutState()` directly, and each consumer moves over
 * individually so any behaviour change is attributable to one commit.
 *
 * @deprecated Prefer utils/layoutTier.
 */
import { useLayoutState, getLayoutState, type LayoutState } from './layoutTier';

export interface DeviceInfo {
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** iPad specifically (any orientation). */
  isIPad: boolean;
}

// Cached per LayoutState object so the adapter preserves the store's identity guarantee —
// mapping through a fresh object literal every call would hand back the churn we just removed.
const projections = new WeakMap<LayoutState, DeviceInfo>();

const project = (state: LayoutState): DeviceInfo => {
  const cached = projections.get(state);
  if (cached) return cached;
  const info: DeviceInfo = {
    isMobile: state.legacyIsMobile,
    isTablet: state.legacyIsTablet,
    isDesktop: !state.legacyIsMobile && !state.legacyIsTablet,
    isIPad: state.isIPadOS,
  };
  projections.set(state, info);
  return info;
};

export const getDeviceInfo = (): DeviceInfo => project(getLayoutState());

export const useDeviceInfo = (): DeviceInfo => project(useLayoutState());
