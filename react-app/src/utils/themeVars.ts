// Centralized theme variable helpers for consistent theming

// Returns a CSS variable reference string like "var(--text)"
export const cssVar = (name: string) => `var(${name})`;

// Common theme variables
export const themeVars = {
  bg: 'var(--bg)',
  panel: 'var(--panel)',
  card: 'var(--card)',
  border: 'var(--line)',
  text: 'var(--text)',
  muted: 'var(--muted)',
  brand: 'var(--brand)',
  onAccent: 'var(--on-accent)'
};

// Helper to create rgba using the card RGB triplet
export const rgbaCard = (alpha: number) => `rgba(var(--card-rgb), ${alpha})`;

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
