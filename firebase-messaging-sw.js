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

console.log('[SW] Fichier chargé');

self.addEventListener('install', () => {
  console.log('[SW] install');
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  console.log('[SW] activate');
  event.waitUntil(self.clients.claim());
});
self.addEventListener('push', (event) => {
  console.log('[SW] evenement push brut recu', event.data ? event.data.text() : '(pas de data)');
});

const messaging = firebase.messaging();

// Gère les notifications reçues quand l'app est fermée ou en arrière-plan
messaging.onBackgroundMessage((payload) => {
  console.log('[SW] onBackgroundMessage recu', payload);
  const title = (payload.notification && payload.notification.title) || 'JobMarket Cameroon';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: 'icon-192.png' // chemin relatif : adapte le nom si ton icône s'appelle autrement
  };
  self.registration.showNotification(title, options)
    .then(() => console.log('[SW] notification affichee avec succes'))
    .catch(err => console.log('[SW] ECHEC affichage notification:', err.message));
});
