// Version tracking for cache busting
export const VERSION = '3.0.1.20250831.001';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Critical Defects Fixed - Task Display, Edit Functions, Add Note, Dark Theme`);
console.log(`🔧 Fixes: D001 (Task Display), D002 (Edit Buttons), D003 (Add Note Error), D004 (Dark Theme)`);
console.log(`🎯 Features: Fixed task filtering (parentId), persona field, Bootstrap dark theme overrides`);
console.log(`🚀 Architecture: Stable v3.0.1 ready for next phase development`);
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