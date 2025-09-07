// Version tracking for cache busting - v1.1.2 Sprint Management Enhancement

// Empty export to make this a module
export {};

export const VERSION = "1.1.2";
export const BUILD_TIME = "2025-09-06T21:00:00.000Z";
export const BUILD_DATE = "2025-09-06";
export const BUILD_HASH = "sprint-management-fix-20250906";
export const CACHE_TIMESTAMP = 1725659200000; // September 6, 2025 21:00:00 UTC

export const RELEASE_NOTES = `
## BOB v1.1.2 - Sprint Management and Navigation Enhancement

### 🎯 Sprint Management Improvements (Issue #58):
- Enhanced Sprint Kanban page with ModernTaskTable integration
- Story selection displays filtered tasks below Kanban board
- Improved UI consistency between Goals and Sprint modules
- Fixed story-task relationship display and management

### 🧭 Navigation Improvements:
- Restructured navigation by entity types (Overview → Goals → Stories → Tasks → Sprints)
- Removed inconsistent dark theme toggle and test mode buttons
- Implemented sticky sign out button with version display
- Clean, logical navigation grouping for better user experience

### 🎨 UI/UX Enhancements:
- Consistent styling across Goals and Sprint modules
- Collapsible task display with story context
- Modern card-based design with proper spacing
- Version display under sign out button

### 🌓 Theme System:
- Ground-up dark/light theme implementation
- Auto theme detection based on system preference
- Theme persistence across sessions
- Consistent theme-aware components
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