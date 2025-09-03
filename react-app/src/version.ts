// Version tracking for cache busting - v3.6.1 Theme-Based Gantt Chart
export const VERSION = 'v3.6.1';
export const BUILD_TIME = '2025-09-03T14:50:00.000Z'; // Static build time
export const BUILD_HASH = 'theme-based-gantt-chart-v3.6.1'; // Build hash matching actual file

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Theme-Based Gantt Chart Timeline Visualization Complete`);
console.log(`🎯 Features: Themes as Rows, Goals as Draggable Bars, Edit/Delete Buttons, VR/Touch Support`);
console.log(`🚀 Architecture: v3.6.1 with Revolutionary Theme-Based Timeline Layout`);
console.log(`📅 Build time: ${BUILD_TIME}`);
console.log(`🔨 Build hash: ${BUILD_HASH}`);

// Server version checking interface
interface ServerVersion {
  version: string;
  buildTime: string;
  buildHash: string;
  features: string[];
}

// Fetch server version with timeout and error handling
const fetchServerVersion = async (): Promise<ServerVersion | null> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    const response = await fetch('/version.json?t=' + Date.now(), {
      signal: controller.signal,
      cache: 'no-cache',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.warn(`⚠️ Server version check failed: ${response.status}`);
      return null;
    }
    
    const serverVersion = await response.json();
    console.log(`📡 Server version: ${serverVersion.version} (${serverVersion.buildHash?.substring(0,8)})`);
    return serverVersion;
    
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn('⏰ Server version check timed out');
    } else {
      console.warn('🚨 Server version check error:', error.message);
    }
    return null;
  }
};

// Enhanced force browser cache refresh with server version checking
export const checkForUpdates = async () => {
  // Prevent running if already in a clearing process
  const isClearing = localStorage.getItem('bobCacheClearing');
  if (isClearing) {
    console.log('🔄 Cache clearing in progress, skipping check...');
    return;
  }
  
  const lastVersion = localStorage.getItem('bobLastVersion');
  const lastBuildHash = localStorage.getItem('bobLastBuildHash');
  const lastPageLoad = localStorage.getItem('bobLastPageLoad');
  const lastServerCheck = localStorage.getItem('bobLastServerCheck');
  const currentVersion = VERSION;
  const currentBuildHash = BUILD_HASH;
  const currentTime = Date.now();
  
  // Prevent infinite loops - only check once per session or after 30 minutes
  const sessionCheckInterval = 30 * 60 * 1000; // 30 minutes
  const serverCheckInterval = 10 * 60 * 1000; // 10 minutes for server checks
  const hasRecentCheck = lastPageLoad && (currentTime - parseInt(lastPageLoad)) < sessionCheckInterval;
  const hasRecentServerCheck = lastServerCheck && (currentTime - parseInt(lastServerCheck)) < serverCheckInterval;
  
  console.log(`🔍 Version check: ${lastVersion}→${currentVersion}, hash: ${lastBuildHash?.substring(0,8)}→${currentBuildHash.substring(0,8)}`);
  
  // Check server version if enough time has passed
  let serverVersion: ServerVersion | null = null;
  if (!hasRecentServerCheck) {
    console.log('📡 Checking server for version updates...');
    serverVersion = await fetchServerVersion();
    localStorage.setItem('bobLastServerCheck', currentTime.toString());
  }
  
  // Only proceed if no recent check or if there are actual changes
  const versionChanged = lastVersion && lastVersion !== currentVersion;
  const buildChanged = lastBuildHash && lastBuildHash !== currentBuildHash;
  const noStoredData = !lastVersion || !lastBuildHash;
  
  // Check server version differences
  const serverVersionDifferent = serverVersion && serverVersion.version !== currentVersion;
  const serverBuildDifferent = serverVersion && serverVersion.buildHash !== currentBuildHash;
  
  if (!hasRecentCheck && (versionChanged || buildChanged || noStoredData || serverVersionDifferent || serverBuildDifferent)) {
    console.log(`🔄 Cache update needed: version=${versionChanged}, build=${buildChanged}, noData=${noStoredData}, serverVer=${serverVersionDifferent}, serverBuild=${serverBuildDifferent}`);
    
    // Mark this check to prevent loops
    localStorage.setItem('bobLastPageLoad', currentTime.toString());
    
    if (versionChanged || serverVersionDifferent) {
      const targetVersion = serverVersion?.version || currentVersion;
      // Prompt for version changes
      if (window.confirm(`🚀 BOB has been updated to ${targetVersion}!\n\nClick OK to clear cache and reload with the latest version.`)) {
        await performCacheClear(targetVersion, serverVersion?.buildHash || currentBuildHash);
        return;
      }
    } else {
      // Silent clear for build changes or missing data
      console.log('🔄 Performing silent cache validation...');
      await performCacheClear(serverVersion?.version || currentVersion, serverVersion?.buildHash || currentBuildHash, true);
      return;
    }
  }
  
  // Store current version/hash for future checks
  localStorage.setItem('bobLastVersion', serverVersion?.version || currentVersion);
  localStorage.setItem('bobLastBuildHash', serverVersion?.buildHash || currentBuildHash);
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
(async () => {
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
    await performCacheClear(VERSION, BUILD_HASH, false);
    return;
  }
  
  // Set up error handler for JavaScript syntax errors
  window.addEventListener('error', async (event) => {
    if (event.message && event.message.includes('Unexpected token')) {
      console.log('🚨 JavaScript syntax error detected - marking for next reload...');
      localStorage.setItem('bobJSError', 'true');
      // Force immediate cache clear
      await performCacheClear(VERSION, BUILD_HASH, false);
    }
  });
  
  // Run the enhanced version check
  await checkForUpdates();
})();

// Default export to ensure module is recognized
export default {
  VERSION,
  BUILD_TIME,
  checkForUpdates
};