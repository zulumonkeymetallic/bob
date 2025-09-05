// Version tracking for cache busting
export const VERSION = '3.0.2.20250905.001';
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Navigation & Menu Structure Fixed`);
console.log(`🔧 Fixes: Stories moved under Goals, Admin page removed, Data corruption fixed`);
console.log(`🎯 Features: Clean navigation structure, consistent menu organization`);
console.log(`🚀 Architecture: Stable v3.0.2 ready for production`);
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
