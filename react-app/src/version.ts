// Version tracking for cache busting - v3.5.1 Goals Refinements Implementation
export const VERSION = 'v3.5.1';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Goals Refinements Implementation Complete`);
console.log(`🎯 Features: Enhanced Latest Comments, Activity Stream Filtering, Modal Consistency, Modern Stories Integration`);
console.log(`🚀 Architecture: v3.5.1 with Goals System User Experience Refinements`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force browser cache refresh and version notification
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bobLastVersion');
  const currentVersion = VERSION;
  
  if (lastVersion && lastVersion !== currentVersion) {
    console.log(`🔄 VERSION UPDATE DETECTED: ${lastVersion} → ${currentVersion}`);
    
    // Show user notification
    if (window.confirm(`🚀 BOB has been updated to ${currentVersion}!\n\nNew features:\n• Enhanced latest comment display on goals cards\n• Activity stream filtering removes UI noise\n• Status change debugging improvements\n• Modal consistency between create/edit\n• Modern stories table integration verified\n\nReload to ensure you have the latest version?`)) {
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