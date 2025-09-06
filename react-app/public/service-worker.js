/* eslint-disable no-restricted-globals */

const CACHE_NAME = 'bob-cache-v1';
const VERSION_URL = '/version.json';

// Files to precache (will be updated by build process)
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json'
];

// Install event - precache essential files
self.addEventListener('install', (event) => {
  console.log('[SW] Install event');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => {
        console.log('[SW] Precache complete');
        // Don't auto-activate, wait for user consent
        return self.skipWaiting();
      })
  );
});

// Activate event - claim clients and clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate event');
  
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Claim all clients
      self.clients.claim()
    ])
  );
});

// Message handler for skip waiting
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Fetch event - handle network requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Never cache version.json - always fetch from network
  if (url.pathname === VERSION_URL) {
    event.respondWith(
      fetch(request, {
        cache: 'no-store'
      }).catch(() => {
        // If network fails, return a basic response
        return new Response(JSON.stringify({
          version: 'unknown',
          build: 'unknown',
          builtAt: new Date().toISOString()
        }), {
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }
  
  // For HTML files, always try network first
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone and cache successful responses
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request)
            .then((cachedResponse) => {
              return cachedResponse || new Response('Offline', { status: 503 });
            });
        })
    );
    return;
  }
  
  // For static assets, cache first
  if (url.pathname.startsWith('/static/')) {
    event.respondWith(
      caches.match(request)
        .then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          
          return fetch(request)
            .then((response) => {
              if (response.ok) {
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                  .then((cache) => cache.put(request, responseClone));
              }
              return response;
            });
        })
    );
    return;
  }
  
  // For all other requests, use default browser behavior
  // This includes Firebase auth, API calls, etc.
});
