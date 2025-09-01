// Version tracking for cache busting - v3.2.8 Goals Card View Default, Migration Bypass, Auto-Generated IDs, Side Door Access
export const VERSION = 'v3.2.8';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Goals Card View Default, Migration Bypass, Auto-Generated IDs, Side Door Access`);
console.log(`🎯 Features: Card View Default, Migration Optimized, Auto-Generated Reference IDs, AI Testing Support`);
console.log(`🚀 Architecture: v3.2.8 with Enhanced UX & Testing Capabilities`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force browser cache refresh and version notification
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bobLastVersion');
  const currentVersion = VERSION;
  
  if (lastVersion && lastVersion !== currentVersion) {
    console.log(`🔄 VERSION UPDATE DETECTED: ${lastVersion} → ${currentVersion}`);
    
    // Show user notification
    if (window.confirm(`🚀 BOB has been updated to ${currentVersion}!\n\nNew features:\n• Goals default to card view for better visual experience\n• Database migration system optimized (bypassed for performance)\n• Auto-generated reference IDs with modern format (GR-26LGIP)\n• Side door authentication for AI testing capabilities\n• Comprehensive test script for automated validation\n\nReload to ensure you have the latest version?`)) {
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