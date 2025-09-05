// Version tracking for cache busting
export const VERSION = '3.8.1';
export const BUILD_TIME = new Date().toISOString();
export const BUILD_HASH = 'stable-v3.8.0-main.comprehensive-ui-consistency';

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Enhanced UI Consistency & Kanban-Goals Integration`);
console.log(`🔧 Fixes: Story Kanban visual consistency, React error resolution, Sprint model integration`);
console.log(`🎯 Features: Unified card design, consistent CRUD operations, enhanced task management`);
console.log(`🚀 Architecture: Stable v3.8.0 with visual consistency updates`);
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
