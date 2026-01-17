// Theme-aware utilities for text colors and backgrounds
import { useTheme } from '../contexts/ThemeContext';
import { getCssVarValue } from '../utils/themeVars';

export interface ThemeAwareTextColors {
  primary: string;
  secondary: string;
  muted: string;
  inverse: string;
  onBackground: string;
  onSurface: string;
  onPrimary: string;
  onSecondary: string;
}

export const useThemeAwareColors = () => {
  const { theme } = useTheme();

  // Get computed theme (resolving 'system')
  const getComputedTheme = (): 'light' | 'dark' => {
    if (theme === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return theme;
  };

  const isDark = getComputedTheme() === 'dark';

  const colors: ThemeAwareTextColors = {
    primary: getCssVarValue('--text', isDark ? '#ffffff' : '#212529'),
    secondary: getCssVarValue('--text', isDark ? '#adb5bd' : '#6c757d'),
    muted: getCssVarValue('--muted', isDark ? '#6c757d' : '#868e96'),
    inverse: isDark ? '#212529' : '#ffffff',
    onBackground: getCssVarValue('--text', isDark ? '#ffffff' : '#212529'),
    onSurface: getCssVarValue('--text', isDark ? '#ffffff' : '#212529'),
    onPrimary: getCssVarValue('--on-accent', '#ffffff'),
    onSecondary: getCssVarValue('--text', isDark ? '#ffffff' : '#212529')
  };

  const backgrounds = {
    primary: getCssVarValue('--panel', isDark ? '#212529' : '#ffffff'),
    secondary: getCssVarValue('--bg', isDark ? '#343a40' : '#f8f9fa'),
    surface: getCssVarValue('--panel', isDark ? '#495057' : '#ffffff'),
    card: getCssVarValue('--card', isDark ? '#343a40' : '#ffffff'),
    modal: getCssVarValue('--panel', isDark ? '#495057' : '#ffffff')
  };

  const borders = {
    primary: getCssVarValue('--line', isDark ? '#495057' : '#dee2e6'),
    secondary: getCssVarValue('--line', isDark ? '#6c757d' : '#e9ecef')
  };

  return {
    isDark,
    colors,
    backgrounds,
    borders,
    theme: getComputedTheme()
  };
};

// CSS class generator for theme-aware text
export const getThemeTextClass = (variant: 'primary' | 'secondary' | 'muted' | 'inverse' = 'primary') => {
  // These will be handled by CSS custom properties
  return `text-theme-${variant}`;
};

// Utility to get appropriate text color for a background
// Utility to get appropriate text color for a background
export const getContrastTextColor = (backgroundColor: string, isDark: boolean = false): string => {
  if (!backgroundColor) return getCssVarValue('--text', '#212529');

  // Handle css variables
  if (backgroundColor.startsWith('var(')) {
    // If it's a variable, we can't easily calculate contrast without computed styles.
    // In dark mode, default to white text unless we know it's a light background.
    return isDark ? '#ffffff' : '#212529';
  }

  // Convert hex to RGB
  const hex = backgroundColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return getCssVarValue('--text', '#212529');

  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Return appropriate text color
  // In dark mode, we want to be careful not to return dark text on a "medium" background
  if (isDark) {
    return luminance > 0.6 ? '#212529' : '#ffffff';
  }
  return luminance > 0.5 ? '#212529' : '#ffffff';
};

// Enhanced theme color utilities for goal themes
export const getThemeAwareGoalColor = (themeId: number, isDark: boolean): { background: string; text: string } => {
  const map = {
    0: '--theme-growth-primary',
    1: '--theme-health-primary',
    2: '--theme-home-primary',
    3: '--theme-wealth-primary',
    4: '--theme-tribe-primary',
    5: '--theme-tribe-primary',
    6: '--theme-growth-primary',
    7: '--theme-growth-primary',
    8: '--theme-home-primary',
    9: '--theme-growth-primary',
    12: '--theme-work-primary',
    13: '--theme-sleep-primary',
    14: '--theme-random-primary'
  } as const;
  const cssVar = map[(themeId as unknown as number)] || '--theme-growth-primary';
  const backgroundColor = getCssVarValue(cssVar, '#6b7280');
  const textColor = getContrastTextColor(backgroundColor, isDark);

  return {
    background: backgroundColor,
    text: textColor
  };
};

export default useThemeAwareColors;
