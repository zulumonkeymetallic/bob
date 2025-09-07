export type FeatureFlagName =
  | 'goals.roadmap.v2'
  | 'themes.numericId'
  | 'selectors.searchable'
  | 'dashboard.kanban'
  | 'ai.vertex.enabled'
  | 'widget.priorities';

export type FeatureFlags = Record<FeatureFlagName, boolean>;

const DEFAULTS: FeatureFlags = {
  'goals.roadmap.v2': false,
  'themes.numericId': false,
  'selectors.searchable': false,
  'dashboard.kanban': true,
  'ai.vertex.enabled': false,
  'widget.priorities': true,
};

function readLocalOverrides(): Partial<FeatureFlags> {
  try {
    const raw = localStorage.getItem('featureFlags');
    if (raw) return JSON.parse(raw);
  } catch {}
  return {};
}

export function getFlag(name: FeatureFlagName): boolean {
  const overrides = readLocalOverrides();
  if (name in overrides) return Boolean((overrides as any)[name]);
  return DEFAULTS[name];
}

export const FEATURE_FLAGS: FeatureFlags = {
  'goals.roadmap.v2': getFlag('goals.roadmap.v2'),
  'themes.numericId': getFlag('themes.numericId'),
  'selectors.searchable': getFlag('selectors.searchable'),
  'dashboard.kanban': getFlag('dashboard.kanban'),
  'ai.vertex.enabled': getFlag('ai.vertex.enabled'),
  'widget.priorities': getFlag('widget.priorities'),
};

export default FEATURE_FLAGS;

