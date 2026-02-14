import { GLOBAL_THEMES, type GlobalTheme, migrateThemeValue } from '../constants/globalThemes';

const normalize = (input: string): string => input.toLowerCase().replace(/[^a-z0-9]+/g, '');

export const getThemePalette = (themes?: GlobalTheme[]): GlobalTheme[] => {
  return Array.isArray(themes) && themes.length ? themes : GLOBAL_THEMES;
};

export const resolveThemeDefinition = (value: any, themes?: GlobalTheme[]): GlobalTheme => {
  const palette = getThemePalette(themes);
  const defaultTheme = palette[0] || GLOBAL_THEMES[0];
  const themeMap = new Map<number, GlobalTheme>();
  palette.forEach((theme) => themeMap.set(theme.id, theme));

  if (value == null) return defaultTheme;

  if (typeof value === 'number') {
    const direct = themeMap.get(value);
    if (direct) return direct;
    const legacy = themeMap.get(migrateThemeValue(value));
    return legacy || defaultTheme;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return defaultTheme;
    const normalized = normalize(trimmed);

    const directMatch = palette.find((theme) => {
      const label = theme.label || '';
      const name = theme.name || '';
      return (
        normalize(label) === normalized
        || normalize(name) === normalized
        || normalize(String(theme.id)) === normalized
      );
    });
    if (directMatch) return directMatch;

    const numeric = Number.parseInt(trimmed, 10);
    if (Number.isFinite(numeric)) {
      const numericMatch = themeMap.get(numeric);
      if (numericMatch) return numericMatch;
      const legacyMatch = themeMap.get(migrateThemeValue(numeric));
      if (legacyMatch) return legacyMatch;
    }

    const legacyByName = themeMap.get(migrateThemeValue(trimmed));
    return legacyByName || defaultTheme;
  }

  if (typeof value === 'object' && value) {
    const possibleId = (value as any).id ?? (value as any).themeId ?? (value as any).theme_id;
    if (possibleId != null) {
      return resolveThemeDefinition(possibleId, palette);
    }
  }

  return defaultTheme;
};

export const resolveThemeFromValue = (value: any, themes?: GlobalTheme[]): GlobalTheme | null => {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  return resolveThemeDefinition(value, themes);
};

export const resolveThemeColor = (value: any, themes?: GlobalTheme[], fallback?: string): string => {
  const theme = resolveThemeDefinition(value, themes);
  return theme?.color || fallback || theme?.darkColor || '#6b7280';
};

export const resolveThemeTextColor = (value: any, themes?: GlobalTheme[], fallback?: string): string => {
  const theme = resolveThemeDefinition(value, themes);
  return theme?.textColor || fallback || '#ffffff';
};
