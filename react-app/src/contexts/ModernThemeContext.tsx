import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

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

// Light theme colors
const lightTheme: ThemeColors = {
  primary: '#0066cc',
  secondary: '#6c757d',
  surface: '#ffffff',
  background: '#f8fafc',
  
  onPrimary: '#ffffff',
  onSecondary: '#ffffff',
  onSurface: '#1f2937',
  onBackground: '#374151',
  
  accent: '#3b82f6',
  success: '#10b981',
  warning: '#f59e0b',
  danger: '#ef4444',
  info: '#06b6d4',
  
  border: '#e5e7eb',
  divider: '#f3f4f6',
  
  hover: '#f3f4f6',
  focus: '#dbeafe',
  active: '#3b82f6',
  disabled: '#9ca3af'
};

// Dark theme colors
const darkTheme: ThemeColors = {
  primary: '#3b82f6',
  secondary: '#6b7280',
  surface: '#1f2937',
  background: '#111827',
  
  onPrimary: '#ffffff',
  onSecondary: '#ffffff',
  onSurface: '#f9fafb',
  onBackground: '#e5e7eb',
  
  accent: '#60a5fa',
  success: '#34d399',
  warning: '#fbbf24',
  danger: '#f87171',
  info: '#22d3ee',
  
  border: '#374151',
  divider: '#4b5563',
  
  hover: '#374151',
  focus: '#1e40af',
  active: '#60a5fa',
  disabled: '#6b7280'
};

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
  const [themeMode, setThemeMode] = useState<ThemeMode>('light');
  
  // Check system preference and saved preference
  useEffect(() => {
    const savedTheme = localStorage.getItem('bob-theme-mode') as ThemeMode;
    if (savedTheme && ['light', 'dark', 'auto'].includes(savedTheme)) {
      setThemeMode(savedTheme);
    } else {
      // Default to auto mode
      setThemeMode('auto');
    }
  }, []);
  
  // Determine actual theme based on mode
  const getActualTheme = (mode: ThemeMode): 'light' | 'dark' => {
    if (mode === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  };
  
  const [actualTheme, setActualTheme] = useState<'light' | 'dark'>(() => 
    getActualTheme(themeMode)
  );
  
  // Update actual theme when mode changes or system preference changes
  useEffect(() => {
    const updateActualTheme = () => {
      setActualTheme(getActualTheme(themeMode));
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
  
  const theme: ThemeConfig = {
    mode: themeMode,
    colors: actualTheme === 'dark' ? darkTheme : lightTheme,
    isDark: actualTheme === 'dark'
  };
  
  // Apply CSS custom properties to document root
  useEffect(() => {
    const root = document.documentElement;
    Object.entries(theme.colors).forEach(([key, value]) => {
      root.style.setProperty(`--theme-${key}`, value);
    });
    
    // Apply theme class to body
    document.body.className = document.body.className.replace(/\btheme-(light|dark)\b/g, '');
    document.body.classList.add(`theme-${actualTheme}`);
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
