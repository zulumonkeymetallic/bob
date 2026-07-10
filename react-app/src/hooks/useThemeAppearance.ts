import { useCallback, useMemo } from 'react';
import { useGlobalThemes } from './useGlobalThemes';
import { LEGACY_THEME_MAP } from '../constants/globalThemes';

export const FALLBACK_THEME_COLORS: Record<string, string> = {
  Health: '#22c55e',
  Growth: '#3b82f6',
  Wealth: '#eab308',
  Tribe: '#8b5cf6',
  Home: '#f97316',
  'Work (Main Gig)': '#0f172a',
  'Side Gig': '#14b8a6',
  'Work Shift': '#0f172a',
};

export interface ThemeAppearance {
  color: string;
  textColor: string;
  label: string;
}

/**
 * Resolves a theme name/id/legacy-name into a display colour + label.
 * Mirrors the palette logic in UnifiedPlannerPage.tsx so calendar surfaces
 * colour theme-linked events consistently.
 */
export const useThemeAppearance = () => {
  const { themes: globalThemes } = useGlobalThemes();

  const legacyThemeNameById = useMemo(() => {
    const map = new Map<number, string>();
    (Object.entries(LEGACY_THEME_MAP) as Array<[string, number]>).forEach(([legacyName, themeId]) => {
      if (!map.has(themeId)) {
        map.set(themeId, legacyName);
      }
    });
    return map;
  }, []);

  const themePalette = useMemo(() => {
    const palette = new Map<string, ThemeAppearance>();
    const isLegacyWorkShift = (value?: string | null) => String(value || '').trim().toLowerCase() === 'work shift';

    globalThemes
      .filter((theme) => !isLegacyWorkShift(theme.name) && !isLegacyWorkShift(theme.label))
      .forEach((theme) => {
        const legacyName = legacyThemeNameById.get(theme.id);
        const value = legacyName || theme.name || String(theme.id);
        const color = theme.color || FALLBACK_THEME_COLORS[legacyName || theme.name] || '#0ea5e9';
        const textColor = theme.textColor || '#ffffff';
        const label = theme.label || theme.name || value;
        palette.set(value, { color, textColor, label });
        if (theme.name) palette.set(theme.name, { color, textColor, label });
        palette.set(label, { color, textColor, label });
        palette.set(String(theme.id), { color, textColor, label });
      });

    Object.entries(FALLBACK_THEME_COLORS).forEach(([legacy, color]) => {
      if (!palette.has(legacy)) {
        palette.set(legacy, { color, textColor: '#ffffff', label: legacy });
      }
    });

    return palette;
  }, [globalThemes, legacyThemeNameById]);

  const resolveThemeAppearance = useCallback(
    (themeValue?: string | number | null): ThemeAppearance | undefined => {
      if (themeValue == null) return undefined;
      const direct = themePalette.get(String(themeValue));
      if (direct) return direct;

      const normalized = String(themeValue).trim().toLowerCase();
      const legacyEntry = Object.entries(LEGACY_THEME_MAP).find(([key]) => key.toLowerCase() === normalized);
      if (legacyEntry) {
        const byId = themePalette.get(String(legacyEntry[1]));
        if (byId) return byId;
      }
      for (const [key, appearance] of themePalette.entries()) {
        if (key.toLowerCase() === normalized) {
          return appearance;
        }
      }
      return undefined;
    },
    [themePalette],
  );

  return { resolveThemeAppearance, themePalette };
};
