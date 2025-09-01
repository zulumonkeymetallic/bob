// Version tracking for cache busting - v3.5.4 Enhanced Story Management & Advanced Filtering
export const VERSION = 'v3.5.4';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Enhanced Story Management & Advanced Filtering`);
console.log(`🎯 Features: FloatingActionButton Goal/Sprint Linking, Advanced Story Table Filtering, Sortable Headers`);
console.log(`🚀 Architecture: v3.5.4 with Comprehensive Story Management Enhancement`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force browser cache refresh and version notification
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bobLastVersion');
  const currentVersion = VERSION;
  
  if (lastVersion && lastVersion !== currentVersion) {
    console.log(`🔄 VERSION UPDATE DETECTED: ${lastVersion} → ${currentVersion}`);
    
    // Show user notification
    if (window.confirm(`🚀 BOB has been updated to ${currentVersion}!\n\nNew features:\n• Force refresh to clear cache\n• UI scaffolding for CRUD operations\n• Enhanced authentication management\n• Preparation for goal testing enhancements\n\n⚠️ CACHE CLEARING REQUIRED - This will reload the page to ensure you have the latest version.`)) {
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