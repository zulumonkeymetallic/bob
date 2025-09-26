// Version tracking for cache busting
// Align version with branch build
export const VERSION = '3.9.1';
export const BUILD_TIME = new Date().toISOString();
export const BUILD_HASH = 'main-3.9.1';

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Bulk create FAB flow & sprint filters`);
console.log(`🔧 Fixes: Clipboard modal polish, sprint filtering for unassigned work items`);
console.log(`🎯 Features: Backlog capture docs, AI-assisted creation flows`);
console.log(`🚀 Architecture: Cache bust via ${BUILD_HASH}`);
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
