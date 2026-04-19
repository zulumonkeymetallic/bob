// Service worker registration utility

export interface ServiceWorkerRegistration {
  registration: globalThis.ServiceWorkerRegistration | null;
  isSupported: boolean;
  isRegistered: boolean;
}

let swRegistration: globalThis.ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  const isSupported = 'serviceWorker' in navigator;
  
  if (!isSupported) {
    console.log('[SW] Service workers not supported');
    return {
      registration: null,
      isSupported: false,
      isRegistered: false
    };
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js', {
      scope: '/'
    });

    swRegistration = registration;

    console.log('[SW] Registration successful:', registration.scope);

    // Set up update checking
    registration.addEventListener('updatefound', () => {
      console.log('[SW] Update found');
      const newWorker = registration.installing;
      
      if (newWorker) {
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            console.log('[SW] New content available, waiting for activation');
            // The useVersionCheck hook will handle showing the update prompt
          }
        });
      }
    });

    // Check for updates periodically
    setInterval(() => {
      registration.update();
    }, 30 * 60 * 1000); // Every 30 minutes

    // Check for updates on window focus
    window.addEventListener('focus', () => {
      registration.update();
    });

    return {
      registration,
      isSupported: true,
      isRegistered: true
    };

  } catch (error) {
    console.error('[SW] Registration failed:', error);
    return {
      registration: null,
      isSupported: true,
      isRegistered: false
    };
  }
}

export function getServiceWorkerRegistration(): globalThis.ServiceWorkerRegistration | null {
  return swRegistration;
}

export function unregisterServiceWorker(): Promise<boolean> {
  if (!swRegistration) {
    return Promise.resolve(false);
  }

  return swRegistration.unregister();
}
