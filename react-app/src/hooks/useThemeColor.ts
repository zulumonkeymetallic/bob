import { useState, useEffect, useCallback, useMemo } from 'react';
import { doc, onSnapshot, collection, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import type { ThemeSettings } from '../types/v3.0.8-types';
import { Goal, Story, Task } from '../types';
import { getThemeName } from '../utils/statusHelpers';
import { getCssVarValue } from '../utils/themeVars';

// Default theme colors pulled from CSS variables (ThemeColors.css)
const getDefaultThemesFromCss = (): ThemeSettings['themes'] => ({
  Health: {
    name: 'Health',
    primary: getCssVarValue('--theme-health-primary', '#22c55e'),
    secondary: getCssVarValue('--theme-health-dark', '#16a34a'),
    light: getCssVarValue('--theme-health-light', '#86efac'),
    lighter: getCssVarValue('--theme-health-lighter', '#dcfce7'),
    dark: getCssVarValue('--theme-health-dark', '#15803d'),
    darker: getCssVarValue('--theme-health-darker', '#14532d')
  },
  Growth: {
    name: 'Growth',
    primary: getCssVarValue('--theme-growth-primary', '#3b82f6'),
    secondary: getCssVarValue('--theme-growth-dark', '#2563eb'),
    light: getCssVarValue('--theme-growth-light', '#93c5fd'),
    lighter: getCssVarValue('--theme-growth-lighter', '#dbeafe'),
    dark: getCssVarValue('--theme-growth-dark', '#1d4ed8'),
    darker: getCssVarValue('--theme-growth-darker', '#1e3a8a')
  },
  Wealth: {
    name: 'Wealth',
    primary: getCssVarValue('--theme-wealth-primary', '#eab308'),
    secondary: getCssVarValue('--theme-wealth-dark', '#ca8a04'),
    light: getCssVarValue('--theme-wealth-light', '#fde047'),
    lighter: getCssVarValue('--theme-wealth-lighter', '#fefce8'),
    dark: getCssVarValue('--theme-wealth-dark', '#a16207'),
    darker: getCssVarValue('--theme-wealth-darker', '#713f12')
  },
  Tribe: {
    name: 'Tribe',
    primary: getCssVarValue('--theme-tribe-primary', '#8b5cf6'),
    secondary: getCssVarValue('--theme-tribe-dark', '#7c3aed'),
    light: getCssVarValue('--theme-tribe-light', '#c4b5fd'),
    lighter: getCssVarValue('--theme-tribe-lighter', '#f3f4f6'),
    dark: getCssVarValue('--theme-tribe-dark', '#6d28d9'),
    darker: getCssVarValue('--theme-tribe-darker', '#4c1d95')
  },
  Home: {
    name: 'Home',
    primary: getCssVarValue('--theme-home-primary', '#f97316'),
    secondary: getCssVarValue('--theme-home-dark', '#ea580c'),
    light: getCssVarValue('--theme-home-light', '#fed7aa'),
    lighter: getCssVarValue('--theme-home-lighter', '#fff7ed'),
    dark: getCssVarValue('--theme-home-dark', '#c2410c'),
    darker: getCssVarValue('--theme-home-darker', '#9a3412')
  },
  'Work (Main Gig)': {
    name: 'Work (Main Gig)',
    primary: getCssVarValue('--theme-work-primary', '#2563eb'),
    secondary: getCssVarValue('--theme-work-dark', '#1e40af'),
    light: getCssVarValue('--theme-work-light', '#c7d2fe'),
    lighter: getCssVarValue('--theme-work-lighter', '#e0e7ff'),
    dark: getCssVarValue('--theme-work-dark', '#1e3a8a'),
    darker: getCssVarValue('--theme-work-darker', '#1d4ed8')
  },
  'Side Gig': {
    name: 'Side Gig',
    primary: getCssVarValue('--theme-sidegig-primary', '#14b8a6'),
    secondary: getCssVarValue('--theme-sidegig-dark', '#0f766e'),
    light: getCssVarValue('--theme-sidegig-light', '#99f6e4'),
    lighter: getCssVarValue('--theme-sidegig-lighter', '#ccfbf1'),
    dark: getCssVarValue('--theme-sidegig-dark', '#0f766e'),
    darker: getCssVarValue('--theme-sidegig-darker', '#115e59')
  },
  Sleep: {
    name: 'Sleep',
    primary: getCssVarValue('--theme-sleep-primary', '#6366f1'),
    secondary: getCssVarValue('--theme-sleep-dark', '#4f46e5'),
    light: getCssVarValue('--theme-sleep-light', '#c7d2fe'),
    lighter: getCssVarValue('--theme-sleep-lighter', '#e0e7ff'),
    dark: getCssVarValue('--theme-sleep-dark', '#4338ca'),
    darker: getCssVarValue('--theme-sleep-darker', '#3730a3')
  },
  Random: {
    name: 'Random',
    primary: getCssVarValue('--theme-random-primary', '#64748b'),
    secondary: getCssVarValue('--theme-random-dark', '#475569'),
    light: getCssVarValue('--theme-random-light', '#e2e8f0'),
    lighter: getCssVarValue('--theme-random-lighter', '#f1f5f9'),
    dark: getCssVarValue('--theme-random-dark', '#334155'),
    darker: getCssVarValue('--theme-random-darker', '#1f2937')
  }
});
const DEFAULT_THEMES: ThemeSettings['themes'] = getDefaultThemesFromCss();

interface UseThemeColorProps {
  entity?: { 
    themeId?: string; 
    goalId?: string; 
    parentId?: string; 
    theme?: string; // Legacy support
  };
  fallbackTheme?: string;
}

interface ColorResult {
  primary: string;
  secondary: string;
  light: string;
  lighter: string;
  dark: string;
  darker: string;
  name: string;
  foregroundColor: string; // WCAG AA compliant text color
  contrastRatio: number;
}

interface UseThemeColorReturn {
  colors: ColorResult;
  themeSettings: ThemeSettings | null;
  loading: boolean;
  error: string | null;
  updateThemeColor: (themeId: string, colors: Partial<ThemeSettings['themes'][string]>) => Promise<void>;
  resetToDefaults: () => Promise<void>;
}

// WCAG AA contrast calculation
function getContrastRatio(color1: string, color2: string): number {
  const getLuminance = (color: string): number => {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16) / 255;
    const g = parseInt(hex.substr(2, 2), 16) / 255;
    const b = parseInt(hex.substr(4, 2), 16) / 255;
    
    const sRGB = [r, g, b].map(c => {
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    
    return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
  };
  
  const l1 = getLuminance(color1);
  const l2 = getLuminance(color2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

// Get WCAG AA compliant foreground color
function getForegroundColor(backgroundColor: string, highContrast = false): string {
  const whiteContrast = getContrastRatio(backgroundColor, '#ffffff');
  const blackContrast = getContrastRatio(backgroundColor, '#000000');
  
  const requiredRatio = highContrast ? 7 : 4.5; // AAA vs AA standard
  
  if (whiteContrast >= requiredRatio && whiteContrast > blackContrast) {
    return '#ffffff';
  } else if (blackContrast >= requiredRatio) {
    return '#000000';
  } else {
    // If neither meets the requirement, choose the better one
    return whiteContrast > blackContrast ? '#ffffff' : '#000000';
  }
}

// Resolve theme through inheritance chain
async function resolveThemeId(entity: UseThemeColorProps['entity'], currentUser: any): Promise<string> {
  // Direct theme ID
  if (entity?.themeId) {
    return entity.themeId;
  }
  
  // Legacy theme field
  if (entity?.theme) {
    return entity.theme;
  }
  
  // Inherit from parent chain: Task → Story → Goal
  if (entity?.parentId || entity?.goalId) {
    try {
      // If it's a task, get its story first
      if (entity.parentId) {
        const storyDoc = await import('firebase/firestore').then(({ getDoc, doc }) => 
          getDoc(doc(db, 'stories', entity.parentId!))
        );
        
        if (storyDoc.exists()) {
          const storyData = storyDoc.data() as Story;
          if (storyData.theme) return getThemeName(storyData.theme);
          if (storyData.goalId) {
            // Get the goal
            const goalDoc = await import('firebase/firestore').then(({ getDoc, doc }) => 
              getDoc(doc(db, 'goals', storyData.goalId))
            );
            
            if (goalDoc.exists()) {
              const goalData = goalDoc.data() as Goal;
              if (goalData.theme) return getThemeName(goalData.theme);
            }
          }
        }
      }
      
      // If it's a story, get its goal
      if (entity.goalId) {
        const goalDoc = await import('firebase/firestore').then(({ getDoc, doc }) => 
          getDoc(doc(db, 'goals', entity.goalId!))
        );
        
        if (goalDoc.exists()) {
          const goalData = goalDoc.data() as Goal;
          if (goalData.theme) return getThemeName(goalData.theme);
        }
      }
    } catch (error) {
      console.error('Error resolving theme through inheritance:', error);
    }
  }
  
  // Fallback to user's default theme
  try {
    const themeSettingsDoc = await import('firebase/firestore').then(({ getDoc, doc }) => 
      getDoc(doc(db, 'theme_settings', currentUser.uid))
    );
    
    if (themeSettingsDoc.exists()) {
      const settings = themeSettingsDoc.data() as ThemeSettings;
      return settings.defaultThemeId || 'General';
    }
  } catch (error) {
    console.error('Error getting user default theme:', error);
  }
  
  // Ultimate fallback - use General for unlinked tasks
  return 'General';
}

export const useThemeColor = (props: UseThemeColorProps = {}): UseThemeColorReturn => {
  const { entity, fallbackTheme = 'General' } = props;
  const { currentUser } = useAuth();
  const [themeSettings, setThemeSettings] = useState<ThemeSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resolvedThemeId, setResolvedThemeId] = useState<string>(fallbackTheme);

  // Resolve theme ID through inheritance chain
  useEffect(() => {
    if (!currentUser) {
      setResolvedThemeId(fallbackTheme);
      return;
    }

    const resolveTheme = async () => {
      try {
        const themeId = await resolveThemeId(entity, currentUser);
        setResolvedThemeId(themeId);
      } catch (err) {
        console.error('Error resolving theme:', err);
        setResolvedThemeId(fallbackTheme);
      }
    };

    resolveTheme();
  }, [entity, currentUser, fallbackTheme]);

  // Listen to theme settings
  useEffect(() => {
    if (!currentUser) {
      setLoading(false);
      return;
    }

    const unsubscribe = onSnapshot(
      doc(db, 'theme_settings', currentUser.uid),
      (doc) => {
        if (doc.exists()) {
          const data = doc.data() as ThemeSettings;
          const mergedThemes = {
            ...DEFAULT_THEMES,
            ...(data?.themes || {})
          };
          setThemeSettings({
            ...data,
            themes: mergedThemes
          });
        } else {
          // Create default theme settings
          setThemeSettings({
            id: currentUser.uid,
            ownerUid: currentUser.uid,
            themes: DEFAULT_THEMES,
            defaultThemeId: 'Health',
            highContrastMode: false,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error('Error loading theme settings:', err);
        setError(err.message);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [currentUser]);

  // Get computed colors
  const colors = useMemo((): ColorResult => {
    const themes = themeSettings?.themes || DEFAULT_THEMES;
    const theme = themes[resolvedThemeId] || themes[fallbackTheme] || themes['Health'];
    const highContrast = themeSettings?.highContrastMode || false;
    
    const foregroundColor = getForegroundColor(theme.primary, highContrast);
    const contrastRatio = getContrastRatio(theme.primary, foregroundColor);
    
    return {
      ...theme,
      foregroundColor,
      contrastRatio
    };
  }, [themeSettings, resolvedThemeId, fallbackTheme]);

  // Update theme color function
  const updateThemeColor = useCallback(async (themeId: string, newColors: Partial<ThemeSettings['themes'][string]>) => {
    if (!currentUser || !themeSettings) return;

    try {
      const updatedThemes = {
        ...themeSettings.themes,
        [themeId]: {
          ...themeSettings.themes[themeId],
          ...newColors
        }
      };

      await import('firebase/firestore').then(({ updateDoc, doc, serverTimestamp }) =>
        updateDoc(doc(db, 'theme_settings', currentUser.uid), {
          themes: updatedThemes,
          updatedAt: serverTimestamp()
        })
      );
    } catch (err) {
      console.error('Error updating theme color:', err);
      setError(err instanceof Error ? err.message : 'Failed to update theme');
    }
  }, [currentUser, themeSettings]);

  // Reset to defaults function
  const resetToDefaults = useCallback(async () => {
    if (!currentUser) return;

    try {
      await import('firebase/firestore').then(({ setDoc, doc, serverTimestamp }) =>
        setDoc(doc(db, 'theme_settings', currentUser.uid), {
          ownerUid: currentUser.uid,
          themes: DEFAULT_THEMES,
          defaultThemeId: 'Health',
          highContrastMode: false,
          createdAt: themeSettings?.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp()
        })
      );
    } catch (err) {
      console.error('Error resetting theme settings:', err);
      setError(err instanceof Error ? err.message : 'Failed to reset themes');
    }
  }, [currentUser, themeSettings]);

  return {
    colors,
    themeSettings,
    loading,
    error,
    updateThemeColor,
    resetToDefaults
  };
};

// Helper hook for getting theme colors without entity context
export const useThemeColors = (): { 
  themes: ThemeSettings['themes']; 
  defaultThemeId: string; 
  loading: boolean;
} => {
  const { themeSettings, loading } = useThemeColor();
  
  return {
    themes: themeSettings?.themes || DEFAULT_THEMES,
    defaultThemeId: themeSettings?.defaultThemeId || 'Health',
    loading
  };
};

// Helper function for getting theme color by ID (for static usage)
export const getThemeColorById = (themeId: string, themes?: ThemeSettings['themes']): ColorResult => {
  const themeMap = themes || DEFAULT_THEMES;
  const theme = themeMap[themeId] || themeMap['Health'];
  const foregroundColor = getForegroundColor(theme.primary);
  const contrastRatio = getContrastRatio(theme.primary, foregroundColor);
  
  return {
    ...theme,
    foregroundColor,
    contrastRatio
  };
};

export default useThemeColor;
