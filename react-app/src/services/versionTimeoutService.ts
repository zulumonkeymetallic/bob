// Enhanced Version Timeout and Update Service
// Forces clients to check for new app versions and busts cache after 30 minutes

import { VERSION, BUILD_HASH } from '../version';

// Feature flag: disable version checks in development unless explicitly enabled
// Avoid dev hot-reload loops caused by /version.json mismatches
const VERSION_CHECKS_ENABLED =
  process.env.NODE_ENV === 'production' ||
  String(process.env.REACT_APP_ENABLE_VERSION_CHECKS).toLowerCase() === 'true';

interface VersionStatus {
  currentVersion: string;
  serverVersion: string | null;
  lastCheckTime: number;
  sessionStartTime: number;
  cacheTimeout: number;
  forceUpdateNeeded: boolean;
}

export interface IVersionTimeoutService {
  getSessionInfo(): { duration: number; timeUntilTimeout: number; version: string };
  forceVersionCheck(): Promise<void>;
  destroy(): void;
}

export class VersionTimeoutService implements IVersionTimeoutService {
  private static instance: VersionTimeoutService;
  private checkInterval: NodeJS.Timeout | null = null;
  private onVisibilityChangeRef: ((this: Document, ev: Event) => any) | null = null;
  private readonly TIMEOUT_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly CHECK_INTERVAL = 5 * 60 * 1000; // Check every 5 minutes
  private readonly SERVER_CHECK_ENDPOINT = '/version.json';
  
  private constructor() {
    this.initializeService();
  }

  public static getInstance(): VersionTimeoutService {
    if (!VersionTimeoutService.instance) {
      VersionTimeoutService.instance = new VersionTimeoutService();
    }
    return VersionTimeoutService.instance;
  }

  private initializeService(): void {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: do not initialize in dev
    console.log('🕐 Version Timeout Service initialized');
    console.log(`⏱️ Timeout duration: ${this.TIMEOUT_DURATION / 60000} minutes`);
    console.log(`🔄 Check interval: ${this.CHECK_INTERVAL / 60000} minutes`);
    
    // Set session start time
    const sessionStart = Date.now();
    localStorage.setItem('bobSessionStart', sessionStart.toString());
    
    // Start periodic checks
    this.startPeriodicChecks();
    
    // Check immediately
    this.performVersionCheck();
    
    // Listen for visibility changes to check when user returns
    this.onVisibilityChangeRef = () => {
      if (!document.hidden) {
        this.performVersionCheck();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChangeRef);
  }

  private startPeriodicChecks(): void {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: disabled
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
    
    this.checkInterval = setInterval(() => {
      this.performVersionCheck();
    }, this.CHECK_INTERVAL);
  }

  private async performVersionCheck(): Promise<void> {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: disabled
    try {
      const status = await this.getVersionStatus();
      
      console.log(`🔍 Version check:`, {
        current: status.currentVersion,
        server: status.serverVersion,
        sessionTime: Math.round((Date.now() - status.sessionStartTime) / 60000),
        forceUpdateNeeded: status.forceUpdateNeeded
      });
      
      // Check if timeout reached
      if (this.isTimeoutReached(status)) {
        await this.handleTimeout();
        return;
      }
      
      // Check if server version is different
      if (this.isServerVersionDifferent(status)) {
        await this.handleVersionMismatch(status);
        return;
      }
      
      // Update last check time
      localStorage.setItem('bobLastVersionCheck', Date.now().toString());
      
    } catch (error) {
      console.warn('⚠️ Version check failed:', error.message);
    }
  }

  private async getVersionStatus(): Promise<VersionStatus> {
    const sessionStart = parseInt(localStorage.getItem('bobSessionStart') || Date.now().toString());
    const lastCheck = parseInt(localStorage.getItem('bobLastVersionCheck') || '0');
    const currentTime = Date.now();
    
    // Fetch server version
    let serverVersion: string | null = null;
    try {
      const response = await fetch(`${this.SERVER_CHECK_ENDPOINT}?t=${Date.now()}`, {
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        serverVersion = data.version;
      }
    } catch (error) {
      console.warn('📡 Server version check failed:', error.message);
    }
    
    return {
      currentVersion: VERSION,
      serverVersion,
      lastCheckTime: lastCheck,
      sessionStartTime: sessionStart,
      cacheTimeout: this.TIMEOUT_DURATION,
      forceUpdateNeeded: false
    };
  }

  private isTimeoutReached(status: VersionStatus): boolean {
    const sessionDuration = Date.now() - status.sessionStartTime;
    return sessionDuration >= this.TIMEOUT_DURATION;
  }

  private isServerVersionDifferent(status: VersionStatus): boolean {
    return status.serverVersion && status.serverVersion !== status.currentVersion;
  }

  private async handleTimeout(): Promise<void> {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: disabled
    console.log('⏰ 30-minute timeout reached - forcing app refresh');
    
    // Show notification to user
    const shouldUpdate = window.confirm(
      '⏰ Your BOB session has been active for 30 minutes.\n\n' +
      'To ensure you have the latest features and fixes, the app will now refresh.\n\n' +
      'Click OK to refresh now, or Cancel to continue (app will refresh automatically in 2 minutes).'
    );
    
    if (shouldUpdate) {
      await this.forceAppRefresh('Session timeout reached');
    } else {
      // Give user 2 minutes before forcing refresh
      setTimeout(async () => {
        await this.forceAppRefresh('Automatic refresh after timeout grace period');
      }, 2 * 60 * 1000);
    }
  }

  private async handleVersionMismatch(status: VersionStatus): Promise<void> {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: disabled
    console.log(`🆕 New version available: ${status.currentVersion} → ${status.serverVersion}`);
    
    const shouldUpdate = window.confirm(
      `🚀 BOB has been updated to ${status.serverVersion}!\n\n` +
      'New features and fixes are available.\n\n' +
      'Click OK to update now, or Cancel to continue with current version.'
    );
    
    if (shouldUpdate) {
      await this.forceAppRefresh(`Version update: ${status.currentVersion} → ${status.serverVersion}`);
    }
  }

  private async forceAppRefresh(reason: string): Promise<void> {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: disabled
    console.log(`🔄 Forcing app refresh: ${reason}`);
    
    try {
      // Clear all caches
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log('🗑️ Cleared all caches');
      }
      
      // Clear service workers
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(reg => reg.unregister()));
        console.log('🔧 Unregistered service workers');
      }
      
      // Preserve essential data
      const userAuth = localStorage.getItem('firebase:authUser:AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk:[DEFAULT]');
      const userPrefs = localStorage.getItem('userPreferences');
      
      // Clear localStorage but preserve auth and prefs
      localStorage.clear();
      if (userAuth) localStorage.setItem('firebase:authUser:AIzaSyDsuR1TNHUE74awnbFaU5cA0FGya0voVFk:[DEFAULT]', userAuth);
      if (userPrefs) localStorage.setItem('userPreferences', userPrefs);
      
      // Mark refresh
      localStorage.setItem('bobLastRefresh', Date.now().toString());
      localStorage.setItem('bobRefreshReason', reason);
      
      // Force hard reload
      window.location.href = window.location.origin + window.location.pathname + `?t=${Date.now()}`;
      
    } catch (error) {
      console.error('❌ Error during app refresh:', error);
      // Fallback to simple reload
      window.location.reload();
    }
  }

  public getSessionInfo(): { duration: number; timeUntilTimeout: number; version: string } {
    const sessionStart = parseInt(localStorage.getItem('bobSessionStart') || Date.now().toString());
    const duration = Date.now() - sessionStart;
    const timeUntilTimeout = Math.max(0, this.TIMEOUT_DURATION - duration);
    
    return {
      duration: Math.round(duration / 60000), // in minutes
      timeUntilTimeout: Math.round(timeUntilTimeout / 60000), // in minutes
      version: VERSION
    };
  }

  public async forceVersionCheck(): Promise<void> {
    if (!VERSION_CHECKS_ENABLED) return; // Guard: disabled
    console.log('🔍 Manual version check triggered');
    await this.performVersionCheck();
  }

  public destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.onVisibilityChangeRef) {
      document.removeEventListener('visibilitychange', this.onVisibilityChangeRef);
      this.onVisibilityChangeRef = null;
    }
  }
}

// Lightweight no-op implementation for development to avoid loops
class NoopVersionTimeoutService implements IVersionTimeoutService {
  getSessionInfo() {
    // Provide stable defaults for UI
    return { duration: 0, timeUntilTimeout: 30, version: VERSION };
  }
  async forceVersionCheck(): Promise<void> { /* no-op */ }
  destroy(): void { /* no-op */ }
}

// Export instance (real in prod, no-op in dev)
export const versionTimeoutService: IVersionTimeoutService = VERSION_CHECKS_ENABLED
  ? VersionTimeoutService.getInstance()
  : new NoopVersionTimeoutService();

if (VERSION_CHECKS_ENABLED) {
  // Auto-initialize when module loads
  console.log('📱 Version Timeout Service loaded');
} else {
  console.log('📱 Version Timeout Service disabled in development');
}
