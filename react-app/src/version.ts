// Version tracking for cache busting
// Align version with branch build
export const VERSION = '3.8.7';
export const BUILD_TIME = new Date().toISOString();
export const BUILD_HASH = 'cc4c2c4';

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Firebase Permission Fixes & React Error Resolution`);
console.log(`🔧 Fixes: QuickActionsPanel permission error, Firebase index optimization, timestamp serialization`);
console.log(`🎯 Features: Consistent field naming (ownerUid), zero permission errors, stable data loading`);
console.log(`🚀 Architecture: Stable v3.8.9 baseline with Firebase security alignment`);
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

// Ensure this file is treated as a module
export {};
