// Version tracking for cache busting - v3.2.5 Critical Fixes & Activity Stream Enhancement
export const VERSION = 'v3.2.5';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Critical Fixes Applied & Activity Stream Enhanced`);
console.log(`🎯 Features: Infinite Loop Fixed, Activity Stream with Latest Comments, Reference Number Parity`);
console.log(`🚀 Architecture: v3.2.5 with Stable Activity Tracking & Enhanced UI`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force browser cache refresh and version notification
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bobLastVersion');
  const currentVersion = VERSION;
  
  if (lastVersion && lastVersion !== currentVersion) {
    console.log(`� VERSION UPDATE DETECTED: ${lastVersion} → ${currentVersion}`);
    
    // Show user notification
    if (window.confirm(`🚀 BOB has been updated to ${currentVersion}!\n\nNew features:\n• Fixed infinite activity logging loops\n• Enhanced activity stream with latest comments\n• Reference number parity across views\n• Status saving improvements\n\nReload to ensure you have the latest version?`)) {
      // Clear all caches
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => caches.delete(name));
        });
      }
      
      // Clear service worker
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          registrations.forEach(registration => registration.unregister());
        });
      }
      
      // Clear localStorage except user preferences
      const userPrefs = localStorage.getItem('userPreferences');
      localStorage.clear();
      if (userPrefs) localStorage.setItem('userPreferences', userPrefs);
      
      // Force hard reload
      window.location.reload();
    }
  }
  
  // Always update stored version
  localStorage.setItem('bobLastVersion', currentVersion);
  
  console.log(`🔧 Version check complete: ${currentVersion}`);
};

// Auto-check for updates
checkForUpdates();

// Default export to ensure module is recognized
export default {
  VERSION,
  BUILD_TIME,
  checkForUpdates
};