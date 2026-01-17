// Global Theme System for BOB Productivity Platform
import { getCssVarValue } from '../utils/themeVars';

export interface GlobalTheme {
  id: number;
  name: string;
  label: string;
  color: string;
  darkColor: string;
  lightColor: string;
  textColor: string;
  description: string;
}

// Determine readable text color for a given hex background
const contrastText = (hex: string): string => {
  const toRGB = (h: string) => {
    const v = h.replace('#', '');
    const r = parseInt(v.substring(0, 2), 16);
    const g = parseInt(v.substring(2, 4), 16);
    const b = parseInt(v.substring(4, 6), 16);
    return { r, g, b };
  };
  const lum = (h: string) => {
    const { r, g, b } = toRGB(h);
    const srgb = [r, g, b].map(c => {
      const n = c / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  };
  const Lbg = lum(hex);
  const Lwhite = lum('#ffffff');
  const Lblack = lum('#000000');
  const cWhite = (Math.max(Lbg, Lwhite) + 0.05) / (Math.min(Lbg, Lwhite) + 0.05);
  const cBlack = (Math.max(Lbg, Lblack) + 0.05) / (Math.min(Lbg, Lblack) + 0.05);
  return cWhite >= cBlack ? '#ffffff' : '#000000';
};

export const GLOBAL_THEMES: GlobalTheme[] = [
  {
    id: 0,
    name: 'General',
    label: 'General',
    color: getCssVarValue('--theme-growth-primary', '#6c757d'),
    darkColor: getCssVarValue('--theme-growth-dark', '#495057'),
    lightColor: getCssVarValue('--theme-growth-light', '#adb5bd'),
    textColor: contrastText(getCssVarValue('--theme-growth-primary', '#6c757d')),
    description: 'General goals and miscellaneous items'
  },
  {
    id: 1,
    name: 'Health & Fitness',
    label: 'Health & Fitness',
    color: getCssVarValue('--theme-health-primary', '#dc3545'),
    darkColor: getCssVarValue('--theme-health-dark', '#c82333'),
    lightColor: getCssVarValue('--theme-health-light', '#f5c6cb'),
    textColor: contrastText(getCssVarValue('--theme-health-primary', '#dc3545')),
    description: 'Physical health, fitness, nutrition, and wellness goals'
  },
  {
    id: 2,
    name: 'Career & Professional',
    label: 'Career & Professional',
    color: getCssVarValue('--theme-home-primary', '#fd7e14'),
    darkColor: getCssVarValue('--theme-home-dark', '#e8620f'),
    lightColor: getCssVarValue('--theme-home-light', '#fed7aa'),
    textColor: contrastText(getCssVarValue('--theme-home-primary', '#fd7e14')),
    description: 'Career development, professional skills, and work-related goals'
  },
  {
    id: 3,
    name: 'Finance & Wealth',
    label: 'Finance & Wealth',
    color: getCssVarValue('--theme-wealth-primary', '#ffc107'),
    darkColor: getCssVarValue('--theme-wealth-dark', '#e0a800'),
    lightColor: getCssVarValue('--theme-wealth-light', '#fff3cd'),
    textColor: contrastText(getCssVarValue('--theme-wealth-primary', '#ffc107')),
    description: 'Financial planning, investments, budgeting, and wealth building'
  },
  {
    id: 4,
    name: 'Learning & Education',
    label: 'Learning & Education',
    color: getCssVarValue('--theme-tribe-primary', '#198754'),
    darkColor: getCssVarValue('--theme-tribe-dark', '#157347'),
    lightColor: getCssVarValue('--theme-tribe-light', '#d1e7dd'),
    textColor: contrastText(getCssVarValue('--theme-tribe-primary', '#198754')),
    description: 'Education, skill development, courses, and learning objectives'
  },
  {
    id: 5,
    name: 'Family & Relationships',
    label: 'Family & Relationships',
    color: getCssVarValue('--theme-tribe-primary', '#20c997'),
    darkColor: getCssVarValue('--theme-tribe-dark', '#1aa179'),
    lightColor: getCssVarValue('--theme-tribe-light', '#c3f7df'),
    textColor: contrastText(getCssVarValue('--theme-tribe-primary', '#20c997')),
    description: 'Family time, relationships, social connections, and community'
  },
  {
    id: 6,
    name: 'Hobbies & Interests',
    label: 'Hobbies & Interests',
    color: getCssVarValue('--theme-growth-primary', '#0dcaf0'),
    darkColor: getCssVarValue('--theme-growth-dark', '#0aa2c0'),
    lightColor: getCssVarValue('--theme-growth-light', '#cff4fc'),
    textColor: contrastText(getCssVarValue('--theme-growth-primary', '#0dcaf0')),
    description: 'Personal interests, hobbies, creative pursuits, and entertainment'
  },
  {
    id: 7,
    name: 'Travel & Adventure',
    label: 'Travel & Adventure',
    color: getCssVarValue('--theme-growth-primary', '#0d6efd'),
    darkColor: getCssVarValue('--theme-growth-dark', '#0b5ed7'),
    lightColor: getCssVarValue('--theme-growth-light', '#cfe2ff'),
    textColor: contrastText(getCssVarValue('--theme-growth-primary', '#0d6efd')),
    description: 'Travel plans, adventures, exploration, and cultural experiences'
  },
  {
    id: 8,
    name: 'Home & Living',
    label: 'Home & Living',
    color: getCssVarValue('--theme-home-primary', '#6610f2'),
    darkColor: getCssVarValue('--theme-home-dark', '#5d0ce7'),
    lightColor: getCssVarValue('--theme-home-light', '#e0cffc'),
    textColor: contrastText(getCssVarValue('--theme-home-primary', '#6610f2')),
    description: 'Home improvement, organization, maintenance, and living space goals'
  },
  {
    id: 9,
    name: 'Spiritual & Personal Growth',
    label: 'Spiritual & Personal Growth',
    color: getCssVarValue('--theme-growth-primary', '#d63384'),
    darkColor: getCssVarValue('--theme-growth-dark', '#c42a6f'),
    lightColor: getCssVarValue('--theme-growth-light', '#f7d6e6'),
    textColor: contrastText(getCssVarValue('--theme-growth-primary', '#d63384')),
    description: 'Personal development, spirituality, mindfulness, and self-improvement'
  },
  {
    id: 10,
    name: 'Chores',
    label: 'Chores',
    color: getCssVarValue('--theme-chores-primary', '#795548'),
    darkColor: getCssVarValue('--theme-chores-dark', '#5d4037'),
    lightColor: getCssVarValue('--theme-chores-light', '#d7ccc8'),
    textColor: contrastText(getCssVarValue('--theme-chores-primary', '#795548')),
    description: 'Household tasks, maintenance, cleaning, and routine chores'
  },
  {
    id: 11,
    name: 'Rest & Recovery',
    label: 'Rest & Recovery',
    color: getCssVarValue('--theme-rest-primary', '#607d8b'),
    darkColor: getCssVarValue('--theme-rest-dark', '#455a64'),
    lightColor: getCssVarValue('--theme-rest-light', '#cfd8dc'),
    textColor: contrastText(getCssVarValue('--theme-rest-primary', '#607d8b')),
    description: 'Downtime, relaxation, sleep, and recovery activities'
  },
  {
    id: 12,
    name: 'Work (Main Gig)',
    label: 'Work (Main Gig)',
    color: getCssVarValue('--theme-work-primary', '#2563eb'),
    darkColor: getCssVarValue('--theme-work-dark', '#1e40af'),
    lightColor: getCssVarValue('--theme-work-light', '#c7d2fe'),
    textColor: contrastText(getCssVarValue('--theme-work-primary', '#2563eb')),
    description: 'Primary job or main professional commitments'
  },
  {
    id: 13,
    name: 'Sleep',
    label: 'Sleep',
    color: getCssVarValue('--theme-sleep-primary', '#6366f1'),
    darkColor: getCssVarValue('--theme-sleep-dark', '#4f46e5'),
    lightColor: getCssVarValue('--theme-sleep-light', '#c7d2fe'),
    textColor: contrastText(getCssVarValue('--theme-sleep-primary', '#6366f1')),
    description: 'Sleep routines, bedtimes, and recovery windows'
  },
  {
    id: 14,
    name: 'Random',
    label: 'Random',
    color: getCssVarValue('--theme-random-primary', '#64748b'),
    darkColor: getCssVarValue('--theme-random-dark', '#475569'),
    lightColor: getCssVarValue('--theme-random-light', '#e2e8f0'),
    textColor: contrastText(getCssVarValue('--theme-random-primary', '#64748b')),
    description: 'Miscellaneous blocks without a specific theme'
  }
];

// Legacy theme mapping for backward compatibility
export const LEGACY_THEME_MAP = {
  'Health': 1,
  'Growth': 9, // Spiritual & Personal Growth
  'Wealth': 3, // Finance & Wealth
  'Tribe': 5, // Family & Relationships
  'Home': 8, // Home & Living
  'Career': 2,
  'Learning': 4,
  'Finance': 3,
  'Financial': 3,
  'General': 0,
  'Work': 12,
  'Work (Main Gig)': 12,
  'Main Gig': 12,
  'Sleep': 13,
  'Random': 14
};

export const LEGACY_ID_TO_NEW_ID = {
  1: 1, // Health & Fitness
  2: 9, // Growth -> Spiritual & Personal Growth
  3: 3, // Wealth -> Finance & Wealth
  4: 5, // Tribe -> Family & Relationships
  5: 8  // Home -> Home & Living
};

// Helper functions
export const getThemeById = (id: number): GlobalTheme => {
  return GLOBAL_THEMES.find(theme => theme.id === id) || GLOBAL_THEMES[0];
};

export const getThemeByName = (name: string): GlobalTheme => {
  // Try direct match first
  const directMatch = GLOBAL_THEMES.find(theme =>
    theme.name === name || theme.label === name
  );
  if (directMatch) return directMatch;

  // Try legacy mapping
  const legacyId = LEGACY_THEME_MAP[name as keyof typeof LEGACY_THEME_MAP];
  if (legacyId !== undefined) {
    return getThemeById(legacyId);
  }

  return GLOBAL_THEMES[0]; // Default to General
};

export const getThemeColor = (themeId: number, isDark: boolean = false): string => {
  const theme = getThemeById(themeId);
  return isDark ? theme.darkColor : theme.color;
};

export const getThemeTextColor = (themeId: number, backgroundIsDark: boolean = false): string => {
  const theme = getThemeById(themeId);

  // For light backgrounds with dark text colors (like yellow), use dark text
  // Derive from theme.textColor; if not sufficient, compute simple contrast
  if (!theme.textColor) return '#000000';

  // For dark backgrounds or themes with white text, use white
  return backgroundIsDark ? '#ffffff' : theme.textColor;
};

export const migrateThemeValue = (oldValue: any): number => {
  // If it's already a number, try to map it
  if (typeof oldValue === 'number') {
    return LEGACY_ID_TO_NEW_ID[oldValue as keyof typeof LEGACY_ID_TO_NEW_ID] || oldValue;
  }

  // If it's a string, use legacy mapping
  if (typeof oldValue === 'string') {
    const theme = getThemeByName(oldValue);
    return theme.id;
  }

  return 0; // Default to General
};

// Theme validation
export const isValidThemeId = (id: number): boolean => {
  return GLOBAL_THEMES.some(theme => theme.id === id);
};

// Export for external use
export default GLOBAL_THEMES;
