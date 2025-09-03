// Version tracking for cache busting - v3.5.8 Story-Task Management & Dashboard Refactor
export const VERSION = 'v3.5.8';
export const BUILD_TIME = '2025-09-03T09:00:00.000Z'; // Static build time
export const BUILD_HASH = 'stable-v3.5.8-main.story-task-management'; // Build hash matching actual file

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Story-Task Management & Dashboard Refactor Complete`);
console.log(`🎯 Features: Story Task Panels, EditStoryModal, Modern Dashboard Tables, Card/List View Toggle`);
console.log(`🚀 Architecture: v3.5.8 with Enhanced Story Management & Task Integration`);
console.log(`📅 Build time: ${BUILD_TIME}`);
console.log(`🔨 Build hash: ${BUILD_HASH}`);

// Force browser cache refresh and version notification with smart loop prevention
export const checkForUpdates = () => {
  // Prevent running if already in a clearing process
  const isClearing = localStorage.getItem('bobCacheClearing');
  if (isClearing) {
    console.log('🔄 Cache clearing in progress, skipping check...');
    return;
  }
  
  const lastVersion = localStorage.getItem('bobLastVersion');
  const lastBuildHash = localStorage.getItem('bobLastBuildHash');
  const lastPageLoad = localStorage.getItem('bobLastPageLoad');
  const currentVersion = VERSION;
  const currentBuildHash = BUILD_HASH;
  const currentTime = Date.now();
  
  // Prevent infinite loops - only check once per session or after 30 minutes
  const sessionCheckInterval = 30 * 60 * 1000; // 30 minutes
  const hasRecentCheck = lastPageLoad && (currentTime - parseInt(lastPageLoad)) < sessionCheckInterval;
  
  console.log(`🔍 Version check: ${lastVersion}→${currentVersion}, hash: ${lastBuildHash?.substring(0,8)}→${currentBuildHash.substring(0,8)}`);
  
  // Only proceed if no recent check or if there are actual changes
  const versionChanged = lastVersion && lastVersion !== currentVersion;
  const buildChanged = lastBuildHash && lastBuildHash !== currentBuildHash;
  const noStoredData = !lastVersion || !lastBuildHash;
  
  if (!hasRecentCheck && (versionChanged || buildChanged || noStoredData)) {
    console.log(`🔄 Cache update needed: version=${versionChanged}, build=${buildChanged}, noData=${noStoredData}`);
    
    // Mark this check to prevent loops
    localStorage.setItem('bobLastPageLoad', currentTime.toString());
    
    if (versionChanged) {
      // Prompt for version changes
      if (window.confirm(`🚀 BOB has been updated to ${currentVersion}!\n\nClick OK to clear cache and reload with the latest version.`)) {
        performCacheClear(currentVersion, currentBuildHash);
        return;
      }
    } else {
      // Silent clear for build changes or missing data
      console.log('🔄 Performing silent cache validation...');
      performCacheClear(currentVersion, currentBuildHash, true);
      return;
    }
  }
  
  // Store current version/hash for future checks
  localStorage.setItem('bobLastVersion', currentVersion);
  localStorage.setItem('bobLastBuildHash', currentBuildHash);
  if (!hasRecentCheck) {
    localStorage.setItem('bobLastPageLoad', currentTime.toString());
  }
};

// Enhanced cache clearing function with loop prevention and aggressive clearing
const performCacheClear = async (version: string, buildHash: string, silent: boolean = false) => {
  try {
    if (!silent) console.log('🧹 Starting comprehensive cache clearing...');
    
    // Mark that we're clearing cache to prevent loops
    localStorage.setItem('bobCacheClearing', 'true');
    
    // Clear all browser caches with more aggressive approach
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      console.log(`🗑️ Clearing ${cacheNames.length} cache(s):`, cacheNames);
      await Promise.all(cacheNames.map(async (name) => {
        await caches.delete(name);
        console.log(`✅ Cleared cache: ${name}`);
      }));
    }
    
    // Clear service worker and force update
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      console.log(`🔧 Unregistering ${registrations.length} service worker(s)`);
      await Promise.all(registrations.map(async (registration) => {
        await registration.unregister();
        console.log(`✅ Unregistered: ${registration.scope}`);
      }));
    }
    
    // Clear localStorage except user preferences and auth
    const userPrefs = localStorage.getItem('userPreferences');
    const authState = localStorage.getItem('firebase:authUser:AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk:[DEFAULT]');
    
    // Store new version/hash before clearing
    localStorage.clear();
    if (userPrefs) localStorage.setItem('userPreferences', userPrefs);
    if (authState) localStorage.setItem('firebase:authUser:AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk:[DEFAULT]', authState);
    
    localStorage.setItem('bobLastVersion', version);
    localStorage.setItem('bobLastBuildHash', buildHash);
    localStorage.setItem('bobLastPageLoad', Date.now().toString());
    localStorage.setItem('bobCacheCleared', Date.now().toString());
    
    console.log('✅ Cache clearing completed - forcing reload...');
    
    // Force hard reload with aggressive cache bypass
    setTimeout(() => {
      window.location.href = window.location.href + '?t=' + Date.now();
    }, 100);
    
  } catch (error) {
    console.error('❌ Error during cache clearing:', error);
    // Remove clearing flag on error
    localStorage.removeItem('bobCacheClearing');
    // Fallback to simple reload with timestamp
    window.location.href = window.location.href + '?t=' + Date.now();
  }
};

// Auto-check for updates with cleanup and aggressive cache validation
(() => {
  // Clean up any stuck clearing flags (in case page reloaded during clearing)
  const clearingFlag = localStorage.getItem('bobCacheClearing');
  if (clearingFlag) {
    console.log('🧹 Cleaning up stuck cache clearing flag...');
    localStorage.removeItem('bobCacheClearing');
  }
  
  // Check if we're getting JavaScript syntax errors (indicates cached HTML instead of JS)
  const hasJSError = localStorage.getItem('bobJSError');
  if (hasJSError) {
    console.log('🚨 Previous JavaScript syntax error detected - forcing aggressive cache clear...');
    localStorage.removeItem('bobJSError');
    // Force immediate cache clear without checking intervals
    performCacheClear(VERSION, BUILD_HASH, false);
    return;
  }
  
  // Set up error handler for JavaScript syntax errors
  window.addEventListener('error', (event) => {
    if (event.message && event.message.includes('Unexpected token')) {
      console.log('🚨 JavaScript syntax error detected - marking for next reload...');
      localStorage.setItem('bobJSError', 'true');
      // Force immediate cache clear
      performCacheClear(VERSION, BUILD_HASH, false);
    }
  });
  
  // Run the version check
  checkForUpdates();
})();

// Default export to ensure module is recognized
export default {
  VERSION,
  BUILD_TIME,
  checkForUpdates
};