// Version tracking for cache busting - v3.1.4 Complete Navigation Rebuild & Goals Enhancement
export const VERSION = 'v3.1.4';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Goals Enhanced & Navigation Completely Rebuilt`);
console.log(`🎯 Features: Goal→Stories Integration, Status Parity, Enhanced Cards, Force Cache Refresh`);
console.log(`🚀 Architecture: v3.1.4 with Complete Navigation System & Browser Cache Control`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force browser cache refresh and version notification
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bobLastVersion');
  const currentVersion = VERSION;
  
  if (lastVersion && lastVersion !== currentVersion) {
    console.log(`� VERSION UPDATE DETECTED: ${lastVersion} → ${currentVersion}`);
    
    // Show user notification
    if (window.confirm(`🚀 BOB has been updated to ${currentVersion}!\n\nNew features:\n• Enhanced Goals with Stories integration\n• Fixed navigation system\n• Status parity across all components\n\nReload to ensure you have the latest version?`)) {
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