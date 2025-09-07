// Version tracking for cache busting - v1.1.2 Sprint Management Enhancement

// Empty export to make this a module
export {};

export const VERSION = "1.1.3";
export const BUILD_TIME = new Date().toISOString();
export const BUILD_DATE = BUILD_TIME.slice(0,10);
export const BUILD_HASH = "gantt-enhancements-20250907";
export const CACHE_TIMESTAMP = Date.now();

export const RELEASE_NOTES = `
## BOB v1.1.3 — Goals Roadmap Enhancements

### 🗺️ Gantt Improvements
- Goal cards wrap to two lines with ellipsis
- Double‑click a goal to open Edit Goal
- Drag/resize updates start/end dates and reassigns theme when dropped onto another theme row
- Current Sprint label appears beneath month header across sprint range
- Zoom via ctrl/cmd+wheel and two‑finger pinch; buttons still supported
- Timeline autoscroll centers on Today on load and zoom changes

### 🔗 Linked Stories Pane
- Clicking a goal shows a full ModernStoriesTable of linked stories under the chart
- Inline editing, delete, priority change, and quick add supported (persisted to Firestore)

### 🎨 Theme
- Unified theme provider + hydration guard to eliminate mismatches
`;

// Version Timeout Configuration
export const VERSION_TIMEOUT_MINUTES = 30;

// Cache Busting Configuration  
export const CACHE_BUSTER = `v${VERSION}-${BUILD_HASH}-${CACHE_TIMESTAMP}`;
export const FORCE_REFRESH_KEY = `force-refresh-${CACHE_TIMESTAMP}`;
export const APP_CACHE_VERSION = `${VERSION}-${CACHE_TIMESTAMP}`;

// Session Configuration
export const SESSION_DURATION_MINUTES = 120; // 2 hours

// Feature Flags
export const FEATURE_FLAGS = {
  ENHANCED_KANBAN: true,
  STORY_TASK_INTEGRATION: true,
  VERSION_TIMEOUT: true,
  ACTIVITY_STREAM: true,
  GOAL_VISUALIZATION: true,
  SPRINT_MANAGEMENT: true,
  MODERN_TABLES: true,
  NAVIGATION_GROUPING: true,
  MODERN_THEME_SYSTEM: true,
  STICKY_SIGNOUT: true
};

// Development Configuration
export const DEV_CONFIG = {
  ENABLE_CONSOLE_LOGGING: true,
  SHOW_DEBUG_INFO: false,
  BYPASS_VERSION_TIMEOUT: false
};

// Theme Configuration
export const THEME_CONFIG = {
  DEFAULT_MODE: 'auto' as const,
  STORAGE_KEY: 'bob-theme-mode',
  ENABLE_TRANSITIONS: true,
  RESPECT_SYSTEM_PREFERENCE: true
};

// Utility Functions
export const getVersionInfo = () => ({
  version: VERSION,
  buildDate: BUILD_DATE,
  buildHash: BUILD_HASH,
  fullVersion: `${VERSION} (${BUILD_HASH})`,
  releaseNotes: RELEASE_NOTES,
  cacheBuster: CACHE_BUSTER
});

export const isFeatureEnabled = (feature: keyof typeof FEATURE_FLAGS): boolean => {
  return FEATURE_FLAGS[feature] || false;
};

export const getCacheBuster = () => CACHE_BUSTER;

export const getAppInfo = () => ({
  name: 'BOB Productivity Platform',
  version: VERSION,
  buildDate: BUILD_DATE,
  buildHash: BUILD_HASH,
  environment: process.env.NODE_ENV || 'development'
});

// Default export for module compatibility
export default {
  VERSION,
  BUILD_TIME,
  BUILD_DATE,
  BUILD_HASH,
  RELEASE_NOTES,
  VERSION_TIMEOUT_MINUTES,
  CACHE_BUSTER,
  SESSION_DURATION_MINUTES,
  FEATURE_FLAGS,
  DEV_CONFIG,
  THEME_CONFIG,
  getVersionInfo,
  isFeatureEnabled,
  getCacheBuster,
  getAppInfo
};
