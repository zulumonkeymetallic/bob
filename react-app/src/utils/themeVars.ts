// Centralized theme variable helpers for consistent theming

// Returns a CSS variable reference string like "var(--text)"
export const cssVar = (name: string) => `var(${name})`;

// Common theme variables
// Every one of these carries a fallback. Without one, `color: var(--muted)` is invalid at
// computed-value time wherever --muted is not defined on the subtree, and `color` then falls
// back to INHERIT rather than to nothing — which is how card action icons ended up rendering
// white-on-white. A fallback only takes effect in exactly that broken case, so adding them
// cannot change any subtree where the variables are properly defined.
export const themeVars = {
  bg: 'var(--bg, #f8f9fa)',
  panel: 'var(--panel, #f3f4f6)',
  card: 'var(--card, #ffffff)',
  border: 'var(--line, #e5e7eb)',
  text: 'var(--text, #1a1a1a)',
  muted: 'var(--muted, #6b7280)',
  brand: 'var(--brand, #5f77dc)',
  onAccent: 'var(--on-accent, #ffffff)'
};

// Helper to create rgba using the card RGB triplet
export const rgbaCard = (alpha: number) => `rgba(var(--card-rgb), ${alpha})`;

/**
 * A "this one is selected / current / being dropped on" wash: the brand colour mixed into
 * whatever surface sits behind it.
 *
 * Use this instead of `var(--accent-soft, #dbeafe)`. Neither theme defines `--accent-soft`, so
 * that pattern always resolves to its light-blue literal — which reads as an almost-white box
 * in dark mode, with `--text` light grey printed on it and effectively invisible. Mixing into
 * the surface keeps the highlight legible in both themes without a per-theme branch.
 */
export const accentTint = (surface: string = themeVars.card, percent: number = 18) =>
  `color-mix(in srgb, ${themeVars.brand} ${percent}%, ${surface})`;

// Domain theme helpers (maps extended theme labels to base CSS keys)
const normalizeDomain = (name: string) => {
  const raw = String(name || '').toLowerCase().trim();
  if (!raw) return 'growth';
  if (raw.includes('side gig') || raw.includes('side-gig') || raw.includes('sidegig')) return 'sidegig';
  if (raw.includes('work')) return 'work';
  if (raw.includes('health') || raw.includes('fitness')) return 'health';
  if (raw.includes('wealth') || raw.includes('finance')) return 'wealth';
  if (raw.includes('tribe') || raw.includes('family') || raw.includes('relationship')) return 'tribe';
  if (raw.includes('home')) return 'home';
  if (raw.includes('sleep')) return 'sleep';
  if (raw.includes('random')) return 'random';
  if (raw.includes('rest') || raw.includes('recovery')) return 'sleep';
  if (raw.includes('spirit') || raw.includes('growth') || raw.includes('learn') || raw.includes('education') || raw.includes('hobby') || raw.includes('travel') || raw.includes('adventure')) return 'growth';
  return raw.replace(/[^a-z0-9]/g, '') || 'growth';
};

export const domainThemePrimaryVar = (name: string) => {
  const key = normalizeDomain(name);
  return `var(--theme-${key}-primary)`;
};

export const domainThemeLightVar = (name: string) => {
  const key = normalizeDomain(name);
  return `var(--theme-${key}-light)`;
};

export const domainThemeLighterVar = (name: string) => {
  const key = normalizeDomain(name);
  return `var(--theme-${key}-lighter)`;
};

// Read the computed value of a CSS variable from :root
export const getCssVarValue = (varName: string, fallback: string = ''): string => {
  try {
    if (typeof window === 'undefined' || !document?.documentElement) return fallback;
    const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    return value || fallback;
  } catch {
    return fallback;
  }
};
