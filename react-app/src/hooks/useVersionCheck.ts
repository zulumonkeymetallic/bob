import { useEffect, useRef, useState } from 'react';

interface VersionInfo {
  version: string;
  build: string;
  builtAt: string;
}

interface UseVersionCheckOptions {
  checkInterval?: number; // milliseconds
  onUpdateAvailable?: (currentVersion: VersionInfo, newVersion: VersionInfo) => void;
}

const VERSION_KEY = 'bob.appVersion';
const CHECK_INTERVAL = 30 * 60 * 1000; // 30 minutes

export function useVersionCheck(options: UseVersionCheckOptions = {}) {
  const [currentVersion, setCurrentVersion] = useState<VersionInfo | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [newVersion, setNewVersion] = useState<VersionInfo | null>(null);
  const intervalRef = useRef<NodeJS.Timeout>();
  const channelRef = useRef<BroadcastChannel>();

  const { checkInterval = CHECK_INTERVAL, onUpdateAvailable } = options;

  const fetchVersion = async (): Promise<VersionInfo | null> => {
    try {
      const response = await fetch('/version.json', {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      console.warn('Failed to fetch version info:', error);
      return null;
    }
  };

  const checkForUpdates = async () => {
    const latestVersion = await fetchVersion();
    if (!latestVersion) return;

    const storedVersionStr = localStorage.getItem(VERSION_KEY);
    const storedVersion = storedVersionStr ? JSON.parse(storedVersionStr) : null;

    // If no stored version, this is first load - store current and continue
    if (!storedVersion) {
      localStorage.setItem(VERSION_KEY, JSON.stringify(latestVersion));
      setCurrentVersion(latestVersion);
      return;
    }

    // Check if versions differ
    const hasUpdate = (
      storedVersion.version !== latestVersion.version ||
      storedVersion.build !== latestVersion.build
    );

    if (hasUpdate && !updateAvailable) {
      setNewVersion(latestVersion);
      setUpdateAvailable(true);
      
      // Broadcast to other tabs
      if (channelRef.current) {
        channelRef.current.postMessage({
          type: 'UPDATE_AVAILABLE',
          newVersion: latestVersion,
          currentVersion: storedVersion
        });
      }

      // Call callback if provided
      if (onUpdateAvailable) {
        onUpdateAvailable(storedVersion, latestVersion);
      }
    }

    setCurrentVersion(storedVersion);
  };

  const applyUpdate = () => {
    if (newVersion) {
      // Update stored version
      localStorage.setItem(VERSION_KEY, JSON.stringify(newVersion));
      
      // Notify service worker to skip waiting if available
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage('SKIP_WAITING');
      }
      
      // Broadcast reload to other tabs
      if (channelRef.current) {
        channelRef.current.postMessage({ type: 'RELOAD_APP' });
      }
      
      // Wait for service worker controller change, then reload
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        }, { once: true });
        
        // Fallback reload after 2 seconds if no controller change
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        // No service worker, reload immediately
        window.location.reload();
      }
    }
  };

  const dismissUpdate = () => {
    setUpdateAvailable(false);
  };

  useEffect(() => {
    // Initialize broadcast channel
    channelRef.current = new BroadcastChannel('bob-version');
    
    channelRef.current.onmessage = (event) => {
      const { type, newVersion: receivedNewVersion, currentVersion: receivedCurrentVersion } = event.data;
      
      if (type === 'UPDATE_AVAILABLE') {
        setNewVersion(receivedNewVersion);
        setCurrentVersion(receivedCurrentVersion);
        setUpdateAvailable(true);
        
        if (onUpdateAvailable) {
          onUpdateAvailable(receivedCurrentVersion, receivedNewVersion);
        }
      } else if (type === 'RELOAD_APP') {
        window.location.reload();
      }
    };

    // Initial check
    checkForUpdates();

    // Set up periodic checks
    intervalRef.current = setInterval(checkForUpdates, checkInterval);

    // Check on window focus
    const handleFocus = () => {
      checkForUpdates();
    };
    window.addEventListener('focus', handleFocus);

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      if (channelRef.current) {
        channelRef.current.close();
      }
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkInterval, onUpdateAvailable]);

  return {
    currentVersion,
    updateAvailable,
    newVersion,
    applyUpdate,
    dismissUpdate,
    checkForUpdates
  };
}
