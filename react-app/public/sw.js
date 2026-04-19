// Service Worker for aggressive cache busting during development

const CACHE_NAME = 'bob-app-v' + Date.now();
const DEV_MODE = true; // Set to false for production

self.addEventListener('install', (event) => {
  console.log('🔧 Service Worker installing...');
  // Skip waiting to activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('✅ Service Worker activated');
  
  // Delete all old caches
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // Take control of all clients immediately
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // In dev mode, always fetch from network
  if (DEV_MODE) {
    event.respondWith(
      fetch(event.request.clone(), {
        cache: 'no-store',
        headers: {
          ...event.request.headers,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache'
        }
      }).catch(() => {
        // Fallback to cache if network fails
        return caches.match(event.request);
      })
    );
    return;
  }
  
  // Production caching strategy would go here
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.match(event.request).then((response) => {
        if (response) {
          // Check if cached version is older than 5 minutes
          const dateHeader = response.headers.get('date');
          const cachedDate = new Date(dateHeader).getTime();
          const now = Date.now();
          
          if (now - cachedDate > 5 * 60 * 1000) { // 5 minutes
            // Cache is old, fetch new version
            return fetch(event.request).then((fetchResponse) => {
              cache.put(event.request, fetchResponse.clone());
              return fetchResponse;
            });
          }
          
          return response;
        }
        
        // Not in cache, fetch and cache
        return fetch(event.request).then((fetchResponse) => {
          cache.put(event.request, fetchResponse.clone());
          return fetchResponse;
        });
      });
    })
  );
});

// Listen for messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});
