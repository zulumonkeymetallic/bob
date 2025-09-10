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

// Domain theme helpers (Health/Growth/Wealth/Tribe/Home)
const normalizeDomain = (name: string) => name.toLowerCase().trim();

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
