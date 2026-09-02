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

// Libellés des boutons d'action de la notification, dans les 5 langues de
// l'app. Le titre/corps de la notif sont déjà traduits côté serveur (voir
// scripts/send*.js), mais CES boutons sont construits ici, dans le service
// worker, qui ne connaît la langue du destinataire que si le serveur la
// transmet explicitement dans le payload (voir data.lang plus bas).
// "view" = libellé par défaut (job). "viewMessage"/"viewQuote" = libellés
// spécifiques aux notifs de message / devis (voir data.type plus bas).
const ACTION_I18N = {
  fr: { view: '👀 Voir le job', viewMessage: '💬 Voir le message', viewQuote: '💰 Voir le devis', dismiss: 'Fermer' },
  en: { view: '👀 View job', viewMessage: '💬 View message', viewQuote: '💰 View quote', dismiss: 'Dismiss' },
  it: { view: '👀 Vedi lavoro', viewMessage: '💬 Vedi messaggio', viewQuote: '💰 Vedi preventivo', dismiss: 'Chiudi' },
  de: { view: '👀 Job ansehen', viewMessage: '💬 Nachricht ansehen', viewQuote: '💰 Angebot ansehen', dismiss: 'Schließen' },
  zh: { view: '👀 查看工作', viewMessage: '💬 查看消息', viewQuote: '💰 查看报价', dismiss: '关闭' }
};

// Choisit le libellé du bouton "voir" selon le type de notification.
function pickViewLabel(labels, type) {
  if (type === 'message' || type === 'message-admin') return labels.viewMessage;
  if (type === 'quote' || type === 'quote-admin') return labels.viewQuote;
  return labels.view;
}

// Notifications reçues quand l'app est fermée ou en arrière-plan.
// Le serveur (scripts/send*.js) envoie désormais un message
// "data-only" (sans champ "notification") : c'est volontaire, car un
// message contenant un champ "notification" peut être affiché
// automatiquement par le navigateur EN PLUS de cet appel manuel à
// showNotification, ce qui produisait des notifications en double.
messaging.onBackgroundMessage((payload) => {
  const data = payload.data || {};
  const title = data.title || 'JobMarket Cameroon';
  const actionLabels = ACTION_I18N[data.lang] || ACTION_I18N.fr;
  const type = data.type || 'job';

  // tag = identifiant unique du sujet : un retry serveur remplace la notif au
  // lieu de l'empiler. Selon le type : par thread (message), par devis
  // (quote), ou par job (défaut historique).
  let tag;
  if (type === 'message' || type === 'message-admin') {
    tag = data.threadId ? 'thread-' + data.threadId : undefined;
  } else if (type === 'quote' || type === 'quote-admin') {
    tag = data.quoteId ? 'quote-' + data.quoteId : undefined;
  } else {
    tag = data.jobId ? 'job-' + data.jobId : undefined;
  }

  const options = {
    body: data.body || '',
    icon: 'icon-192.png', // doit correspondre exactement à un fichier présent + référencé dans manifest.json
    badge: 'icon-192.png', // petite icône monochrome affichée dans la barre de notif Android
    // Photo du job en aperçu si le serveur en fournit une (uniquement pour les
    // notifs de job) — une notif avec image se remarque beaucoup plus.
    image: data.image || undefined,
    tag,
    vibrate: [200, 100, 200],
    data,
    // Boutons d'action directement dans la notification : gagne un clic et
    // accélère la mise en contact.
    actions: [
      { action: 'view', title: pickViewLabel(actionLabels, type) },
      { action: 'dismiss', title: actionLabels.dismiss }
    ]
  };

  self.registration.showNotification(title, options).catch(() => {});

  // Met à jour le badge sur l'icône de l'app (Chrome/Edge desktop, Android).
  if ('setAppBadge' in self.navigator) {
    self.navigator.setAppBadge().catch(() => {});
  }
});

// Au clic sur la notification : direction le bon écran selon le TYPE de notif.
//   - message  -> ouvre la conversation (#thread=<threadId>)
//   - quote    -> ouvre l'annonce concernée (#job=<jobId>)  [le devis y est rattaché]
//   - job (défaut) -> ouvre l'annonce (#job=<jobId>)  [comportement historique inchangé]
// Si un onglet de l'app est déjà ouvert, on le ramène au premier plan et on
// lui poste l'info (évite de recharger toute la page) ; sinon on ouvre un
// nouvel onglet directement sur le bon hash, qu'index.html/app.js sait
// interpréter au chargement.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  // Clic sur le bouton "Fermer" : rien de plus à faire.
  if (event.action === 'dismiss') return;

  const d = event.notification.data || {};
  const type = d.type || 'job';
  const jobId = d.jobId;
  const threadId = d.threadId;
  const variant = d.variant;
  const variantParam = variant ? '&variant=' + encodeURIComponent(variant) : '';

  // Construit le hash de destination selon le type.
  let hashPart;
  if ((type === 'message' || type === 'message-admin') && threadId) {
    hashPart = '#thread=' + encodeURIComponent(threadId) + '&src=push' + variantParam;
  } else if (jobId) {
    hashPart = '#job=' + jobId + '&src=push' + variantParam;
  } else {
    hashPart = '#src=push' + variantParam;
  }
  const targetUrl = self.registration.scope + hashPart;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
          // App déjà ouverte : on lui poste tout le contexte nécessaire pour
          // ouvrir le bon écran sans recharger.
          if ('postMessage' in client) {
            client.postMessage({
              type: 'open-notif',      // nouveau type générique
              notifType: type,         // 'message' | 'quote' | 'job' | ...
              jobId: jobId || null,
              threadId: threadId || null,
              variant: variant || null
            });
          }
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

const CACHE_VERSION = 'v43';
const SHELL_CACHE = `jobmarket-shell-${CACHE_VERSION}`;
const TILE_CACHE = `jobmarket-tiles-${CACHE_VERSION}`;
const MAX_TILE_ENTRIES = 400;
const IMAGE_CACHE = `jobmarket-images-${CACHE_VERSION}`;
const MAX_IMAGE_ENTRIES = 250;

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
          .filter((key) => key !== SHELL_CACHE && key !== TILE_CACHE && key !== IMAGE_CACHE)
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

// Images Cloudinary (annonces, portfolios, profils) : URLs déjà transformées
// (w_500,h_300,q_auto,f_auto...) donc stables et idempotentes — idéales pour
// un cache. Avant, elles passaient dans isFirebaseOrUploadCall et n'étaient
// JAMAIS mises en cache : chaque visite re-téléchargeait TOUTES les photos,
// un vrai poids sur 3G/4G. Mêmes URL = mêmes images, donc cache-first +
// revalidation silencieuse en arrière-plan (comme les tuiles de carte).
function isCloudinaryImage(url) {
  return url.hostname.includes('cloudinary.com') && url.pathname.includes('/upload/');
}

async function trimTileCache() {
  const cache = await caches.open(TILE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_TILE_ENTRIES) {
    await cache.delete(keys[0]);
  }
}

async function trimImageCache() {
  const cache = await caches.open(IMAGE_CACHE);
  const keys = await cache.keys();
  if (keys.length > MAX_IMAGE_ENTRIES) {
    await cache.delete(keys[0]);
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.url.startsWith('blob:') || req.url.startsWith('data:')) return;

  const url = new URL(req.url);

  if (isCloudinaryImage(url)) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) {
          // Déjà en cache : réponse immédiate + revalidation silencieuse
          // en arrière-plan (l'image peut évoluer — ex : nouvelle photo).
          fetch(req).then((res) => {
            if (res && res.ok) { cache.put(req, res.clone()); trimImageCache(); }
          }).catch(() => {});
          return cached;
        }
        // Pas encore en cache : réseau. En cas d'échec (hors-ligne), on
        // renvoie une réponse vide plutôt qu'une erreur qui casserait l'image.
        try {
          const res = await fetch(req);
          if (res && res.ok) { cache.put(req, res.clone()); trimImageCache(); }
          return res;
        } catch (err) {
          return new Response('', { status: 504, statusText: 'Image indisponible hors-ligne' });
        }
      })
    );
    return;
  }

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
