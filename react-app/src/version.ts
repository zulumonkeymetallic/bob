// Version tracking for cache busting
export const VERSION = '3.0.0.20250831.001'; // Version 3.0.0 - Pragmatic DnD Architecture Migration
export const BUILD_TIME = new Date().toISOString();

console.log(`🚀 BOB App loaded - Version: ${VERSION}`);
console.log(`✅ Status: Pragmatic DnD Migration + Modern Architecture + Sign Out + Task Table`);
console.log(`🎯 Features: ModernKanbanPage, Pragmatic DnD, Task Table, Sign Out, Removed StoryBacklog`);
console.log(`🔧 Migration: Removed react-beautiful-dnd, Added @atlaskit/pragmatic-drag-and-drop`);
console.log(`� Architecture: Clean separation of stories/tasks, Modern UI patterns, Type safety`);
console.log(`📅 Build time: ${BUILD_TIME}`);
console.log(`🎯 Features: Sprint Dashboard, Task List View, Personal Backlog Integration, Settings Page`);
console.log(`� Fixes: C24 (Settings Menu), C28 (Dark Mode Banners) - Implemented`);
console.log(`🔴 Remaining: C25, C26, C27, C29-C34 for Version 2.1.3 planning`);
console.log(`📅 Build time: ${BUILD_TIME}`);

// Force refresh if version mismatch detected
export const checkForUpdates = () => {
  const lastVersion = localStorage.getItem('bob_version');
  const lastCheck = localStorage.getItem('bob_last_check');
  const now = Date.now();
  
  // Prevent rapid refresh loops - only check once per 5 seconds
  if (lastCheck && (now - parseInt(lastCheck)) < 5000) {
    console.log('⏱️ Skipping version check - too soon since last check');
    return;
  }
  
  localStorage.setItem('bob_last_check', now.toString());
  
  if (lastVersion && lastVersion !== VERSION) {
    console.log(`🔄 Version changed from ${lastVersion} to ${VERSION} - Refreshing...`);
    localStorage.setItem('bob_version', VERSION);
    
    // Clear caches and reload
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => caches.delete(name));
      });
    }
    
    // Force reload without cache
    window.location.reload();
  } else {
    localStorage.setItem('bob_version', VERSION);
    console.log(`✅ Version check complete - Current: ${VERSION}`);
  }
};

// Add cache-busting to fetch requests
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const [url, options = {}] = args;
  
  // Add cache-busting parameter to API calls
  if (typeof url === 'string' && (url.includes('/api/') || url.includes('firestore'))) {
    const separator = url.includes('?') ? '&' : '?';
    args[0] = `${url}${separator}_cb=${Date.now()}`;
  }
  
  // Add no-cache headers
  args[1] = {
    ...options,
    headers: {
      ...options.headers,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    }
  };
  
  return originalFetch.apply(this, args);
};