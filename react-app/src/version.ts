// Version tracking for cache busting - v3.1.3 Goals UI Enhancement & Navigation Fixes
export const VERSION = 'v3.1.3';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Goals UI Enhanced & Navigation Issues RESOLVED`);
console.log(`🎯 Features: Goals Card/List View Toggle, Activity Stream Integration, Enhanced Navigation`);
console.log(`🚀 Architecture: v3.1.3 with Interactive Goals Interface and Force Navigation`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force refresh if version mismatch detected
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bob_version');
  const lastCheck = localStorage.getItem('bob_last_check');
  const now = Date.now();
  
  // Check for updates every 5 minutes
  if (!lastCheck || now - parseInt(lastCheck) > 5 * 60 * 1000) {
    localStorage.setItem('bob_last_check', now.toString());
    
    if (lastVersion && lastVersion !== VERSION) {
      console.log(`🔄 Version update detected: ${lastVersion} → ${VERSION}`);
      
      if (window.confirm(`New version available (${VERSION}). Refresh to update?`)) {
        window.location.reload();
      }
    }
    
    localStorage.setItem('bob_version', VERSION);
  }
};

// Auto-check for updates
checkForUpdates();

// Default export to ensure module is recognized
export default {
  VERSION,
  BUILD_TIME,
  checkForUpdates
};

// Empty export to make this a module for isolatedModules
export {};