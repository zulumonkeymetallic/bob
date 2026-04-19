import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react';
import { getCssVarValue } from '../utils/themeVars';

// Theme types
export type ThemeMode = 'light' | 'dark' | 'auto';

export interface ThemeColors {
  // Background colors
  primary: string;
  secondary: string;
  surface: string;
  background: string;
  
  // Text colors
  onPrimary: string;
  onSecondary: string;
  onSurface: string;
  onBackground: string;
  
  // Accent colors
  accent: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  
  // Border colors
  border: string;
  divider: string;
  
  // Interactive states
  hover: string;
  focus: string;
  active: string;
  disabled: string;
}

export interface ThemeConfig {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
}

// Build theme tokens from CSS variables (keeps source of truth in CSS)
const buildThemeColors = (): ThemeColors => ({
  primary: getCssVarValue('--brand', '#3b82f6'),
  secondary: getCssVarValue('--muted', '#6b7280'),
  surface: getCssVarValue('--panel', '#ffffff'),
  background: getCssVarValue('--bg', '#f8fafc'),
  
  onPrimary: getCssVarValue('--on-accent', '#ffffff'),
  onSecondary: getCssVarValue('--text', '#1f2937'),
  onSurface: getCssVarValue('--text', '#1f2937'),
  onBackground: getCssVarValue('--text', '#374151'),
  
  accent: getCssVarValue('--brand', '#3b82f6'),
  success: getCssVarValue('--green', '#10b981'),
  warning: getCssVarValue('--orange', '#f59e0b'),
  danger: getCssVarValue('--red', '#ef4444'),
  info: getCssVarValue('--blue', '#06b6d4'),
  
  border: getCssVarValue('--line', '#e5e7eb'),
  divider: getCssVarValue('--line', '#f3f4f6'),
  
  hover: getCssVarValue('--card', '#f3f4f6'),
  focus: getCssVarValue('--brand', '#dbeafe'),
  active: getCssVarValue('--brand', '#3b82f6'),
  disabled: getCssVarValue('--muted', '#9ca3af')
});

// Theme context
interface ThemeContextType {
  theme: ThemeConfig;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Theme provider component
interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  // (Removed duplicate useState for themeMode)
  
  // LOGGING: Theme provider initialization
  console.log('🎨 ThemeProvider Initializing', {
    component: 'ThemeProvider',
    timestamp: new Date().toISOString()
  });
  
  // Check system preference and saved preference
  const getInitialThemeMode = (): ThemeMode => {
    const savedTheme = localStorage.getItem('bob-theme-mode') as ThemeMode;
    if (savedTheme && ['light', 'dark', 'auto'].includes(savedTheme)) {
      return savedTheme;
    }
    return 'auto';
  };
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialThemeMode);

  // LOGGING: Theme provider initialization
  useEffect(() => {
    console.log('🎨 ThemeProvider Initializing', {
      component: 'ThemeProvider',
      initialThemeMode: themeMode,
      timestamp: new Date().toISOString()
    });
  }, []);

  // Watch for changes in localStorage (multi-tab)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'bob-theme-mode') {
        const newMode = (e.newValue as ThemeMode) || 'auto';
        setThemeMode(newMode);
        console.log('🎨 ThemeProvider: Detected themeMode change from storage', { newMode });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Save theme preference
  useEffect(() => {
    localStorage.setItem('bob-theme-mode', themeMode);
    console.log('🎨 ThemeProvider: Saved themeMode to localStorage', { themeMode });
  }, [themeMode]);
  
  // Determine actual theme based on mode
  const getActualTheme = (mode: ThemeMode): 'light' | 'dark' => {
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const result = mode === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : mode;
    
    console.log('🎨 ThemeProvider: Determining actual theme', {
      mode: mode,
      systemPrefersDark: systemPrefersDark,
      result: result,
      timestamp: new Date().toISOString()
    });
    
    return result;
  };
  
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>(() => 
    getActualTheme(themeMode)
  );
  
  // Update actual theme when mode changes or system preference changes
  useEffect(() => {
    const updateActualTheme = () => {
      const newTheme = getActualTheme(themeMode);
      console.log('🎨 ThemeProvider: Updating actual theme', {
        previousTheme: actualTheme,
        newTheme: newTheme,
        themeMode: themeMode,
        timestamp: new Date().toISOString()
      });
      setActualTheme(newTheme);
    };
    
    updateActualTheme();
    
    if (themeMode === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', updateActualTheme);
      return () => mediaQuery.removeEventListener('change', updateActualTheme);
    }
  }, [themeMode]);
  
  // Save theme preference
  useEffect(() => {
    localStorage.setItem('bob-theme-mode', themeMode);
  }, [themeMode]);
  
  const handleSetThemeMode = (mode: ThemeMode) => {
    setThemeMode(mode);
  };
  
  const toggleTheme = () => {
    setThemeMode(current => {
      if (current === 'light') return 'dark';
      if (current === 'dark') return 'auto';
      return 'light'; // auto -> light
    });
  };
  
  const colors = useMemo(() => buildThemeColors(), [actualTheme]);
  const theme: ThemeConfig = {
    mode: themeMode,
    colors,
    isDark: actualTheme === 'dark'
  };
  
  // Apply CSS custom properties and root attributes
  useEffect(() => {
    const root = document.documentElement;
    // Apply saved global theme overrides for domain colors (Health/Growth/Wealth/Tribe/Home)
    try {
      const saved = localStorage.getItem('bob-global-themes');
      if (saved) {
        const map = JSON.parse(saved) as Record<string, string>;
        Object.entries(map).forEach(([key, value]) => {
          root.style.setProperty(`--theme-${key}-primary`, value);
        });
      }
    } catch {}
    // Expose as --theme-* for any legacy consumers (non-breaking)
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--theme-${key}`, value);
    });
    // Set data-theme on html for CSS contracts, and Tailwind dark class
    root.setAttribute('data-theme', actualTheme);
    if (actualTheme === 'dark') {
      root.classList.add('dark');
      document.body.setAttribute('data-bs-theme', 'dark');
      document.body.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      document.body.setAttribute('data-bs-theme', 'light');
      document.body.setAttribute('data-theme', 'light');
    }
  }, [theme.colors, actualTheme]);
  
  return (
    <ThemeContext.Provider value={{ theme, setThemeMode: handleSetThemeMode, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// Custom hook to use theme
export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

// Helper function to get theme-aware colors
export const useThemeColors = () => {
  const { theme } = useTheme();
  return theme.colors;
};

// CSS-in-JS helper for theme-aware styles
export const getThemeStyles = (theme: ThemeConfig) => ({
  // Card styles
  card: {
    backgroundColor: theme.colors.surface,
    color: theme.colors.onSurface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '8px',
    boxShadow: theme.isDark 
      ? '0 1px 3px rgba(0, 0, 0, 0.3)' 
      : '0 1px 3px rgba(0, 0, 0, 0.1)'
  },
  
  // Button styles
  button: {
    primary: {
      backgroundColor: theme.colors.primary,
      color: theme.colors.onPrimary,
      border: `1px solid ${theme.colors.primary}`
    },
    secondary: {
      backgroundColor: theme.colors.secondary,
      color: theme.colors.onSecondary,
      border: `1px solid ${theme.colors.secondary}`
    }
  },
  
  // Input styles
  input: {
    backgroundColor: theme.colors.surface,
    color: theme.colors.onSurface,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: '4px'
  },
  
  // Navigation styles
  nav: {
    backgroundColor: theme.colors.surface,
    borderRight: `1px solid ${theme.colors.border}`,
    color: theme.colors.onSurface
  }
});
