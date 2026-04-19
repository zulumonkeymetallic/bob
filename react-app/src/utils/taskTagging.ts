import { type GlobalTheme } from '../constants/globalThemes';
import { type Sprint } from '../types';
import { resolveThemeDefinition } from './themeResolver';

const normalizeTag = (tag: string): string => String(tag || '').trim();
const normalizeKey = (tag: string): string => normalizeTag(tag).replace(/^#/, '').toLowerCase();

const TYPE_TAGS = new Set(['task', 'chore', 'habit', 'habitual', 'routine']);
const PERSONA_TAGS = new Set(['work', 'personal']);

const buildSprintSlug = (value: string): string | null => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  const digits = trimmed.match(/\d+/g)?.join('');
  if (digits) return digits;
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return slug || null;
};

export const buildSprintTag = (sprint?: Sprint | null): string | null => {
  if (!sprint) return null;
  const ref = sprint.name || (sprint as any).title || sprint.ref || sprint.id;
  const slug = buildSprintSlug(ref);
  if (!slug) return null;
  return `sprint${slug}`;
};

export const resolveThemeLabel = (value: any, themes?: GlobalTheme[]): string | null => {
  if (value == null || (typeof value === 'string' && value.trim().length === 0)) return null;
  const resolved = resolveThemeDefinition(value, themes);
  return resolved?.label || resolved?.name || String(resolved?.id ?? '');
};

interface NormalizeTaskTagsInput {
  tags: string[];
  type?: string | null;
  persona?: string | null;
  sprint?: Sprint | null;
  themeValue?: any;
  goalRef?: string | null;
  storyRef?: string | null;
  themes?: GlobalTheme[];
}

export const normalizeTaskTags = ({
  tags,
  type,
  persona,
  sprint,
  themeValue,
  goalRef,
  storyRef,
  themes,
}: NormalizeTaskTagsInput): string[] => {
  const cleaned: string[] = [];
  const seen = new Set<string>();

  const goalKey = goalRef ? normalizeKey(goalRef) : null;
  const storyKey = storyRef ? normalizeKey(storyRef) : null;
  const themeLabel = resolveThemeLabel(themeValue, themes);
  const themeKeys = new Set(
    (themes || []).map((t) => normalizeKey(t.label || t.name || String(t.id)))
  );

  (tags || []).forEach((tag) => {
    const raw = normalizeTag(tag);
    if (!raw) return;
    const key = normalizeKey(raw);

    if (TYPE_TAGS.has(key) || PERSONA_TAGS.has(key)) return;
    if (key.startsWith('goal-') || key.startsWith('story-')) return;
    if (goalKey && key === goalKey) return;
    if (storyKey && key === storyKey) return;
    if (key.startsWith('sprint-') || key.startsWith('sprint')) return;
    if (key.startsWith('theme-')) return;
    if (themeKeys.has(key)) return;

    if (!seen.has(key)) {
      seen.add(key);
      cleaned.push(raw);
    }
  });

  const append = (value?: string | null) => {
    if (!value) return;
    const raw = normalizeTag(value);
    if (!raw) return;
    const key = normalizeKey(raw);
    if (!key || seen.has(key)) return;
    seen.add(key);
    cleaned.push(raw);
  };

  const normalizedType = String(type || '').toLowerCase();
  if (TYPE_TAGS.has(normalizedType)) {
    append(normalizedType === 'habitual' ? 'habit' : normalizedType);
  }

  const normalizedPersona = String(persona || '').toLowerCase();
  if (PERSONA_TAGS.has(normalizedPersona)) {
    append(normalizedPersona);
  }

  append(buildSprintTag(sprint));
  append(themeLabel);

  return cleaned;
};
