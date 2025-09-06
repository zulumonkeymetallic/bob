// Enhanced cache busting service for version management
import { VERSION } from '../version';

// Constants for cache busting
const CACHE_TIMESTAMP = 1725659200000; // September 6, 2025 21:00:00 UTC
const FORCE_REFRESH_KEY = `force-refresh-${CACHE_TIMESTAMP}`;
const APP_CACHE_VERSION = `${VERSION}-${CACHE_TIMESTAMP}`;

interface CacheInfo {
  version: string;
  timestamp: number;
  lastCleared: number;
}

class CacheBustingService {
  private static instance: CacheBustingService;
  private readonly CACHE_INFO_KEY = 'bob-cache-info';
  private readonly MAX_CACHE_AGE = 30 * 60 * 1000; // 30 minutes

  static getInstance(): CacheBustingService {
    if (!CacheBustingService.instance) {
      CacheBustingService.instance = new CacheBustingService();
    }
    return CacheBustingService.instance;
  }

  // Check if cache needs to be cleared
  shouldClearCache(): boolean {
    try {
      const cacheInfo = this.getCacheInfo();
      const now = Date.now();
      
      // Clear cache if version changed
      if (cacheInfo.version !== VERSION) {
        console.log('🔄 Version changed, clearing cache:', cacheInfo.version, '→', VERSION);
        return true;
      }
      
      // Clear cache if timestamp changed (new build)
      if (cacheInfo.timestamp !== CACHE_TIMESTAMP) {
        console.log('🔄 Build timestamp changed, clearing cache');
        return true;
      }
      
      // Clear cache if it's been too long
      if (now - cacheInfo.lastCleared > this.MAX_CACHE_AGE) {
        console.log('🔄 Cache expired, clearing cache');
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking cache status:', error);
      return true; // Clear cache on error to be safe
    }
  }

  // Clear all caches and update info
  async clearAllCaches(): Promise<void> {
    try {
      console.log('🧹 Clearing all caches...');
      
      // Clear browser caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
        console.log('✅ Service worker caches cleared');
      }
      
      // Clear localStorage except user preferences
      const preserveKeys = ['bob-theme-mode', 'firebase:host:bob20250810-default-rtdb'];
      const keysToRemove: string[] = [];
      
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && !preserveKeys.includes(key)) {
          keysToRemove.push(key);
        }
      }
      
      keysToRemove.forEach(key => localStorage.removeItem(key));
      console.log('✅ localStorage cleared (preserved user preferences)');
      
      // Clear sessionStorage
      sessionStorage.clear();
      console.log('✅ sessionStorage cleared');
      
      // Update cache info
      this.updateCacheInfo();
      
      console.log('🎉 Cache clearing complete');
    } catch (error) {
      console.error('Error clearing caches:', error);
    }
  }

  // Force immediate page reload with cache busting
  forceReload(): void {
    console.log('🔄 Force reloading page with cache busting...');
    
    // Add timestamp to URL to force reload
    const url = new URL(window.location.href);
    url.searchParams.set(FORCE_REFRESH_KEY, Date.now().toString());
    
    window.location.replace(url.toString());
  }

  // Get current cache info
  private getCacheInfo(): CacheInfo {
    try {
      const stored = localStorage.getItem(this.CACHE_INFO_KEY);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (error) {
      console.warn('Error reading cache info:', error);
    }
    
    // Return default if none found
    return {
      version: '',
      timestamp: 0,
      lastCleared: 0
    };
  }

  // Update cache info with current values
  private updateCacheInfo(): void {
    const cacheInfo: CacheInfo = {
      version: VERSION,
      timestamp: CACHE_TIMESTAMP,
      lastCleared: Date.now()
    };
    
    try {
      localStorage.setItem(this.CACHE_INFO_KEY, JSON.stringify(cacheInfo));
      console.log('📝 Cache info updated:', cacheInfo);
    } catch (error) {
      console.error('Error updating cache info:', error);
    }
  }

  // Initialize cache busting on app start
  async initialize(): Promise<void> {
    console.log('🚀 Initializing cache busting service...');
    console.log('📦 App version:', VERSION);
    console.log('⏰ Build timestamp:', CACHE_TIMESTAMP);
    console.log('🔧 Cache version:', APP_CACHE_VERSION);
    
    if (this.shouldClearCache()) {
      await this.clearAllCaches();
      
      // Small delay before reload to ensure cache clearing completes
      setTimeout(() => {
        this.forceReload();
      }, 1000);
    } else {
      console.log('✅ Cache is up to date');
      this.updateCacheInfo(); // Update last checked time
    }
  }

  // Manual cache clear (for user-triggered refresh)
  async manualCacheClear(): Promise<void> {
    console.log('👤 Manual cache clear requested');
    await this.clearAllCaches();
    this.forceReload();
  }
}

// Export singleton instance
export const cacheBustingService = CacheBustingService.getInstance();
