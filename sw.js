// Service Worker for offline support and caching

const CACHE_NAME = 'jobmarket-v1';
const NETWORK_TIMEOUT = 5000; // 5 second timeout

// URLs to cache on install
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
];

// Install event - cache essential files
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache).catch(() => {
          // Continue even if some resources fail to cache
          console.warn('Some resources failed to cache during install');
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event - Network first with proper error handling
self.addEventListener('fetch', event => {
  // Skip non-GET requests (POST, PUT, DELETE, etc.)
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip blob and data URLs
  if (event.request.url.startsWith('blob:') || event.request.url.startsWith('data:')) {
    return;
  }

  event.respondWith(
    // Try network first
    fetch(event.request, { timeout: NETWORK_TIMEOUT })
      .then(response => {
        // Only cache successful responses
        if (!response || response.status !== 200) {
          return response;
        }

        // Clone and cache the response
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache).catch(() => {});
          })
          .catch(() => {});

        return response;
      })
      .catch(() => {
        // Network failed - try cache
        return caches.match(event.request)
          .then(cachedResponse => {
            // Return cached response if found
            if (cachedResponse) {
              return cachedResponse;
            }

            // Return a proper Response object instead of undefined
            // This prevents "undefined is not a Response" errors
            return new Response(
              'Offline - Resource not available',
              { 
                status: 503, 
                statusText: 'Service Unavailable',
                headers: new Headers({ 'Content-Type': 'text/plain' })
              }
            );
          })
          .catch(() => {
            // Last resort fallback
            return new Response(
              'Offline - Service Worker Error',
              { 
                status: 500,
                statusText: 'Internal Server Error',
                headers: new Headers({ 'Content-Type': 'text/plain' })
              }
            );
          });
      })
  );
});
