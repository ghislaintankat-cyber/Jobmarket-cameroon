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

// Force l'activation immédiate de ce service worker, sans attendre que
// tous les onglets du site soient fermés (comportement par défaut).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const messaging = firebase.messaging();

// Gère les notifications reçues quand l'app est fermée ou en arrière-plan
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'JobMarket Cameroon';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: 'icon-192.png' // chemin relatif : adapte le nom si ton icône s'appelle autrement
  };
  self.registration.showNotification(title, options);
});
