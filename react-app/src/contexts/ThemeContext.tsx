import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { isStatus, isTheme } from '../utils/statusHelpers';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const savedTheme = localStorage.getItem('theme') as Theme;
    return savedTheme || 'system';
  });

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    
    const applyTheme = (themeToApply: string) => {
      // Set both data-theme attribute and class for CSS targeting
      root.setAttribute('data-theme', themeToApply);
      body.setAttribute('data-theme', themeToApply);
      root.className = themeToApply;
      body.className = themeToApply;
      
      // Force Bootstrap theme update
      if (themeToApply === 'dark') {
        body.setAttribute('data-bs-theme', 'dark');
      } else {
        body.setAttribute('data-bs-theme', 'light');
      }
      
      // Dispatch theme change event for any listening components
      window.dispatchEvent(new CustomEvent('themeChange', { 
        detail: { theme: themeToApply } 
      }));
    };

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      applyTheme(systemTheme);
      
      // Listen for system theme changes
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleSystemThemeChange = (e: MediaQueryListEvent) => {
        applyTheme(e.matches ? 'dark' : 'light');
      };
      
      mediaQuery.addEventListener('change', handleSystemThemeChange);
      return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
    } else {
      applyTheme(theme);
    }
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
