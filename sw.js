const CACHE_NAME = 'jobmarket-v1';
const ASSETS = [
  './',
  './index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// 1. Installation : On met le site en mémoire dans le téléphone
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. Stratégie "Network-First" (Réseau d'abord, sinon Mémoire)
// Idéal pour JobMarket : prend les dernières offres en ligne, mais si la 2G/5G coupe, affiche le site directement !
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request).catch(() => {
      return caches.match(e.request);
    })
  );
});
