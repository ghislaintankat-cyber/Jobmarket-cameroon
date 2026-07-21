// ===== Service Worker JobMarket Cameroon =====
// Fusionne DEUX rôles dans un seul fichier (nécessaire : un navigateur ne peut
// avoir qu'UN SEUL service worker actif par scope, donc sw.js et
// firebase-messaging-sw.js ne peuvent pas cohabiter proprement à la racine) :
//
// 1. Offline / cache (comme avant) :
//    - App shell : network-first, repli sur cache si hors-ligne
//    - Tuiles de carte (OSM + satellite Google) : cache-first avec limite d'entrées
//    - Firebase RTDB/Auth/Firestore + Cloudinary : jamais mis en cache (données fraîches)
//
// 2. Notifications push Firebase Cloud Messaging (ex firebase-messaging-sw.js)
//
// IMPORTANT : incrémentez CACHE_VERSION à chaque mise à jour de l'app.

importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.23.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyCR1Z6VlS5A7iPbUCoVm0AQcnkkUdsA0CE",
  authDomain: "jobmarketfuture.firebaseapp.com",
  databaseURL: "https://jobmarketfuture-default-rtdb.firebaseio.com",
  projectId: "jobmarketfuture",
  storageBucket: "jobmarketfuture.firebasestorage.app",
  messagingSenderId: "351669024349",
  appId: "1:351669024349:web:d4d4d08727ccc6012b7fb4"
});

const messaging = firebase.messaging();

// Notifications reçues quand l'app est fermée ou en arrière-plan
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'JobMarket Cameroon';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: 'icon-192.png' // doit correspondre exactement à un fichier présent + référencé dans manifest.json
  };
  self.registration.showNotification(title, options).catch(() => {});
});

// Au clic sur la notification : si un onglet de l'app est déjà ouvert, on le
// ramène au premier plan ; sinon on en ouvre un nouveau.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = self.registration.scope; // ex: https://.../JobMarket Cameroon/

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

// ---------- Cache / offline ----------

const CACHE_VERSION = 'v2';
const SHELL_CACHE = `jobmarket-shell-${CACHE_VERSION}`;
const TILE_CACHE = `jobmarket-tiles-${CACHE_VERSION}`;
const MAX_TILE_ENTRIES = 400;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&display=swap',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/compressorjs/1.2.1/compressor.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        SHELL_ASSETS.map((url) =>
          cache.add(url).catch((err) => console.warn('SW: échec mise en cache', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

function isMapTile(url) {
  return (
    url.hostname.endsWith('tile.openstreetmap.org') ||
    /^mt[0-3]\.google\.com$/.test(url.hostname)
  );
}

function isFirebaseOrUploadCall(url) {
  return (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    (url.hostname.includes('googleapis.com') && url.pathname.includes('identitytoolkit')) ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('cloudinary.com')
  );
}

async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILE_ENTRIES) {
    await cache.delete(keys[0]);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith('blob:') || req.url.startsWith('data:')) return;

  const url = new URL(req.url);

  if (isFirebaseOrUploadCall(url)) return;

  if (isMapTile(url)) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          // On a déjà cette tuile : on la sert immédiatement, et on tente une
          // mise à jour silencieuse en arrière-plan (sans bloquer la réponse).
          fetch(req).then((res) => {
            if (res && res.ok) { cache.put(req, res.clone()); trimTileCache(); }
          }).catch(() => {});
          return cached;
        }
        // Pas encore en cache : il faut attendre le réseau. Si le réseau
        // échoue (bloqué, hors-ligne...), on renvoie une réponse vide plutôt
        // que undefined, sinon le navigateur lève une erreur "unexpected error".
        try {
          const res = await fetch(req);
          if (res && res.ok) { cache.put(req, res.clone()); trimTileCache(); }
          return res;
        } catch (err) {
          return new Response('', { status: 504, statusText: 'Tuile indisponible hors-ligne' });
        }
      })
    );
    return;
  }

  

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  if (SHELL_ASSETS.includes(req.url) || url.origin !== self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok) caches.open(SHELL_CACHE).then((cache) => cache.put(req, res.clone()));
        return res;
      }))
    );
    return;
  }
});
