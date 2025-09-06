// Version tracking for cache busting - v3.8.3 Cache Loop Fix
export const VERSION = "3.8.3";
export const BUILD_DATE = "2025-09-04";
export const BUILD_HASH = "cache-loop-fix";
export const RELEASE_NOTES = `
## BOB v3.8.2 - Navigation Menu Refactoring

### �️ NAVIGATION IMPROVEMENTS:
- Refactored menu grouping by functionality type
- Main Dashboard at the top for quick access
- Logical grouping: Goals, Sprints, Tasks, Stories, Planning & Calendar, Settings
- Improved navigation hierarchy and user experience

### 📁 NEW MENU STRUCTURE:
1. **Main Dashboard** - Overview & Mobile View at the top
2. **Goals** - Dashboard, Management, Roadmap, Visualization
3. **Sprints** - Dashboard, Management, Kanban, Stories
4. **Tasks** - Management, List View, Personal Lists
5. **Stories** - Stories Management
6. **Planning & Calendar** - AI Planner, Calendar tools, Routes
7. **Settings** - Configuration, Analytics, Developer tools

### 🎯 USER EXPERIENCE ENHANCEMENTS:
- More intuitive navigation flow
- Related features grouped together
- Default expansion of Main Dashboard, Goals, and Tasks
- Cleaner, more organized sidebar structure

### 🔧 TECHNICAL IMPROVEMENTS:
- Maintained all existing functionality
- Better icon assignments for clarity
- Improved navigation consistency
- Enhanced menu organization logic

This release makes navigation more intuitive by grouping related features together.
`;

export const ISSUES_FIXED = [
  {
    id: "#78",
    title: "Critical: Sign Out Button Disappears in Dark Mode - Theme Consistency Issue",
    type: "bug",
    priority: "critical"
  },
  {
    id: "#74", 
    title: "Theme Inconsistency Causing UI Elements to Disappear",
    type: "bug",
    priority: "high"
  }
];

export const FEATURES_ADDED = [
  "Comprehensive theme consistency CSS system",
  "Enhanced theme-aware sign out button styling", 
  "Real-time theme validation and auto-fix",
  "Version timeout service with 30-minute checks",
  "Enhanced deployment script with GitHub integration",
  "WCAG AA compliant contrast ratios",
  "High contrast mode support"
];

export const DEPLOYMENT_INFO = {
  environment: "production",
  firebase_project: "bob20250810",
  hosting_url: "https://bob20250810.web.app",
  deployment_date: "2025-01-27",
  git_branch: "main",
  build_size: "538.91 kB (+102 B)",
  css_size: "38.47 kB (+986 B)"
};

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Critical Production Fixes Complete with Emergency Systems`);
console.log(`🎯 Features: Emergency Task Creation, Enhanced Error Handling, Theme Debugging, Null-Safe Tracking`);
console.log(`🚀 Architecture: v3.8.0 with Production-Ready Emergency Fallback Systems`);
console.log(`📅 Build date: ${BUILD_DATE}`);
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

// Enhanced cache clearing function with loop prevention and safe reloading
const performCacheClear = async (version: string, buildHash: string, silent: boolean = false) => {
  try {
    if (!silent) console.log('🧹 Starting safe cache clearing...');
    
    // Check if we're already in a clearing loop
    const clearingAttempts = parseInt(localStorage.getItem('bobClearingAttempts') || '0');
    if (clearingAttempts >= 3) {
      console.warn('🚨 Too many cache clearing attempts - stopping to prevent loop');
      localStorage.removeItem('bobClearingAttempts');
      localStorage.removeItem('bobCacheClearing');
      // Just do a simple reload without cache clearing
      window.location.reload();
      return;
    }
    
    // Increment clearing attempts
    localStorage.setItem('bobClearingAttempts', (clearingAttempts + 1).toString());
    localStorage.setItem('bobCacheClearing', 'true');
    
    // Clear browser caches
    if ('caches' in window) {
      const cacheNames = await caches.keys();
      if (cacheNames.length > 0) {
        console.log(`🗑️ Clearing ${cacheNames.length} cache(s)`);
        await Promise.all(cacheNames.map(async (name) => {
          await caches.delete(name);
        }));
      }
    }
    
    // Clear service worker registrations
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        console.log(`🔧 Unregistering ${registrations.length} service worker(s)`);
        await Promise.all(registrations.map(async (registration) => {
          await registration.unregister();
        }));
      }
    }
    
    // Preserve essential data before clearing localStorage
    const userPrefs = localStorage.getItem('userPreferences');
    const authState = localStorage.getItem('firebase:authUser:AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk:[DEFAULT]');
    
    // Clear localStorage
    localStorage.clear();
    
    // Restore essential data
    if (userPrefs) localStorage.setItem('userPreferences', userPrefs);
    if (authState) localStorage.setItem('firebase:authUser:AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk:[DEFAULT]', authState);
    
    // Set new version info
    localStorage.setItem('bobLastVersion', version);
    localStorage.setItem('bobLastBuildHash', buildHash);
    localStorage.setItem('bobLastPageLoad', Date.now().toString());
    localStorage.setItem('bobCacheCleared', Date.now().toString());
    
    console.log('✅ Cache clearing completed - performing safe reload...');
    
    // Safe reload with cache bypass
    setTimeout(() => {
      window.location.href = window.location.pathname + '?cb=' + Date.now();
    }, 500);
    
  } catch (error) {
    console.error('❌ Error during cache clearing:', error);
    // Remove clearing flags on error
    localStorage.removeItem('bobCacheClearing');
    localStorage.removeItem('bobClearingAttempts');
    // Fallback to simple reload without cache bypass
    setTimeout(() => {
      window.location.reload();
    }, 1000);
  }
};

// Auto-check for updates with enhanced loop prevention
(async () => {
  // Clean up any stuck clearing flags and check for loops
  const clearingFlag = localStorage.getItem('bobCacheClearing');
  const clearingAttempts = parseInt(localStorage.getItem('bobClearingAttempts') || '0');
  
  if (clearingFlag) {
    console.log('🧹 Cleaning up stuck cache clearing flag...');
    localStorage.removeItem('bobCacheClearing');
    
    // If too many attempts, reset everything
    if (clearingAttempts >= 3) {
      console.warn('🚨 Too many clearing attempts detected - resetting cache state');
      localStorage.removeItem('bobClearingAttempts');
      localStorage.setItem('bobLastVersion', VERSION);
      localStorage.setItem('bobLastBuildHash', BUILD_HASH);
      localStorage.setItem('bobLastPageLoad', Date.now().toString());
      return; // Skip version check this time
    }
  }
  
  // Check if we're in a reload loop (page loaded multiple times in short period)
  const lastPageLoad = localStorage.getItem('bobLastPageLoad');
  const reloadCount = parseInt(localStorage.getItem('bobReloadCount') || '0');
  
  if (lastPageLoad && (Date.now() - parseInt(lastPageLoad)) < 5000) {
    // Page reloaded within 5 seconds
    const newReloadCount = reloadCount + 1;
    localStorage.setItem('bobReloadCount', newReloadCount.toString());
    
    if (newReloadCount >= 3) {
      console.warn('🚨 Reload loop detected - skipping version check to break cycle');
      localStorage.removeItem('bobReloadCount');
      localStorage.setItem('bobLastVersion', VERSION);
      localStorage.setItem('bobLastBuildHash', BUILD_HASH);
      localStorage.setItem('bobLastPageLoad', Date.now().toString());
      return;
    }
  } else {
    // Reset reload count if enough time has passed
    localStorage.removeItem('bobReloadCount');
  }
  
  // Check for JavaScript errors (indicates cached HTML instead of JS)
  const hasJSError = localStorage.getItem('bobJSError');
  if (hasJSError) {
    console.log('🚨 Previous JavaScript syntax error detected - attempting recovery...');
    localStorage.removeItem('bobJSError');
    
    // Only try to clear cache once for JS errors
    const jsErrorAttempts = parseInt(localStorage.getItem('bobJSErrorAttempts') || '0');
    if (jsErrorAttempts < 2) {
      localStorage.setItem('bobJSErrorAttempts', (jsErrorAttempts + 1).toString());
      await performCacheClear(VERSION, BUILD_HASH, false);
      return;
    } else {
      console.warn('🚨 Too many JS error recovery attempts - continuing with current version');
      localStorage.removeItem('bobJSErrorAttempts');
    }
  }
  
  // Set up error handler for JavaScript syntax errors
  window.addEventListener('error', async (event) => {
    if (event.message && event.message.includes('Unexpected token')) {
      console.log('🚨 JavaScript syntax error detected - marking for recovery...');
      localStorage.setItem('bobJSError', 'true');
    }
  });
  
  // Run the enhanced version check with safety measures
  try {
    await checkForUpdates();
  } catch (error) {
    console.error('❌ Version check failed:', error);
    // Don't trigger cache clear on version check errors
  }
})();

// Default export to ensure module is recognized
export default {
  VERSION,
  BUILD_DATE,
  checkForUpdates
};