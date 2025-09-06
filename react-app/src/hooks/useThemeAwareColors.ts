// Theme-aware utilities for text colors and backgrounds
import { useTheme } from '../contexts/ModernThemeContext';

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
  
  // Get computed theme from the new theme config
  const isDark = theme.isDark;
  
  const colors: ThemeAwareTextColors = {
    primary: theme.colors.onSurface,
    secondary: theme.colors.onSecondary, 
    muted: isDark ? '#6c757d' : '#868e96',
    inverse: isDark ? '#212529' : '#ffffff',
    onBackground: theme.colors.onBackground,
    onSurface: theme.colors.onSurface,
    onPrimary: theme.colors.onPrimary,
    onSecondary: theme.colors.onSecondary
  };
  
  const backgrounds = {
    primary: theme.colors.surface,
    secondary: theme.colors.background,
    surface: theme.colors.surface,
    card: theme.colors.surface,
    modal: theme.colors.surface
  };
  
  const borders = {
    primary: theme.colors.border,
    secondary: theme.colors.divider
  };
  
  return {
    isDark,
    colors,
    backgrounds,
    borders,
    theme: theme.mode
  };
};

// CSS class generator for theme-aware text
export const getThemeTextClass = (variant: 'primary' | 'secondary' | 'muted' | 'inverse' = 'primary') => {
  // These will be handled by CSS custom properties
  return `text-theme-${variant}`;
};

// Utility to get appropriate text color for a background
export const getContrastTextColor = (backgroundColor: string, isDark: boolean = false): string => {
  // Convert hex to RGB
  const hex = backgroundColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  
  // Calculate luminance
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  
  // Return appropriate text color
  return luminance > 0.5 ? '#212529' : '#ffffff';
};

// Enhanced theme color utilities for goal themes
export const getThemeAwareGoalColor = (themeId: number, isDark: boolean): { background: string; text: string } => {
  const themeColors = [
    { bg: '#6c757d', bgDark: '#495057' }, // General
    { bg: '#dc3545', bgDark: '#c82333' }, // Health & Fitness
    { bg: '#fd7e14', bgDark: '#e8620f' }, // Career & Professional
    { bg: '#ffc107', bgDark: '#e0a800' }, // Finance & Wealth
    { bg: '#198754', bgDark: '#157347' }, // Learning & Education
    { bg: '#20c997', bgDark: '#1aa179' }, // Family & Relationships
    { bg: '#0dcaf0', bgDark: '#0aa2c0' }, // Hobbies & Interests
    { bg: '#0d6efd', bgDark: '#0b5ed7' }, // Travel & Adventure
    { bg: '#6610f2', bgDark: '#5d0ce7' }, // Home & Living
    { bg: '#d63384', bgDark: '#c42a6f' }  // Spiritual & Personal Growth
  ];
  
  const theme = themeColors[themeId] || themeColors[0];
  const backgroundColor = isDark ? theme.bgDark : theme.bg;
  const textColor = getContrastTextColor(backgroundColor, isDark);
  
  return {
    background: backgroundColor,
    text: textColor
  };
};

export default useThemeAwareColors;
