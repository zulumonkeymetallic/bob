// Global Theme System for BOB Productivity Platform
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

export const GLOBAL_THEMES: GlobalTheme[] = [
  {
    id: 0,
    name: 'General',
    label: 'General',
    color: '#6c757d',
    darkColor: '#495057',
    lightColor: '#adb5bd',
    textColor: '#ffffff',
    description: 'General goals and miscellaneous items'
  },
  {
    id: 1,
    name: 'Health & Fitness',
    label: 'Health & Fitness',
    color: '#dc3545',
    darkColor: '#c82333',
    lightColor: '#f5c6cb',
    textColor: '#ffffff',
    description: 'Physical health, fitness, nutrition, and wellness goals'
  },
  {
    id: 2,
    name: 'Career & Professional',
    label: 'Career & Professional',
    color: '#fd7e14',
    darkColor: '#e8620f',
    lightColor: '#fed7aa',
    textColor: '#ffffff',
    description: 'Career development, professional skills, and work-related goals'
  },
  {
    id: 3,
    name: 'Finance & Wealth',
    label: 'Finance & Wealth',
    color: '#ffc107',
    darkColor: '#e0a800',
    lightColor: '#fff3cd',
    textColor: '#212529',
    description: 'Financial planning, investments, budgeting, and wealth building'
  },
  {
    id: 4,
    name: 'Learning & Education',
    label: 'Learning & Education',
    color: '#198754',
    darkColor: '#157347',
    lightColor: '#d1e7dd',
    textColor: '#ffffff',
    description: 'Education, skill development, courses, and learning objectives'
  },
  {
    id: 5,
    name: 'Family & Relationships',
    label: 'Family & Relationships',
    color: '#20c997',
    darkColor: '#1aa179',
    lightColor: '#c3f7df',
    textColor: '#ffffff',
    description: 'Family time, relationships, social connections, and community'
  },
  {
    id: 6,
    name: 'Hobbies & Interests',
    label: 'Hobbies & Interests',
    color: '#0dcaf0',
    darkColor: '#0aa2c0',
    lightColor: '#cff4fc',
    textColor: '#212529',
    description: 'Personal interests, hobbies, creative pursuits, and entertainment'
  },
  {
    id: 7,
    name: 'Travel & Adventure',
    label: 'Travel & Adventure',
    color: '#0d6efd',
    darkColor: '#0b5ed7',
    lightColor: '#cfe2ff',
    textColor: '#ffffff',
    description: 'Travel plans, adventures, exploration, and cultural experiences'
  },
  {
    id: 8,
    name: 'Home & Living',
    label: 'Home & Living',
    color: '#6610f2',
    darkColor: '#5d0ce7',
    lightColor: '#e0cffc',
    textColor: '#ffffff',
    description: 'Home improvement, organization, maintenance, and living space goals'
  },
  {
    id: 9,
    name: 'Spiritual & Personal Growth',
    label: 'Spiritual & Personal Growth',
    color: '#d63384',
    darkColor: '#c42a6f',
    lightColor: '#f7d6e6',
    textColor: '#ffffff',
    description: 'Personal development, spirituality, mindfulness, and self-improvement'
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
  'General': 0
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
  if (theme.textColor === '#212529' && !backgroundIsDark) {
    return '#212529';
  }
  
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
