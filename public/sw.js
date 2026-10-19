// ProtestGuard Service Worker (Offline Resilience & Caching for Cellular Jamming/Blackouts)
const CACHE_NAME = 'protestguard-v3';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // Për Socket.io dhe thirrjet API përdor network direkt
  if (url.includes('/socket.io/') || url.includes('/api/')) {
    return;
  }

  // HTML & JS e aplikacionit: Network-first, që të marrësh GJITHMONË kodin më të freskët kur ka rrjet.
  // (Cache-first i vjetër mbante versione të ngrira dhe ndryshimet nuk dukeshin deri në hard-refresh.)
  if (event.request.mode === 'navigate' || url.includes('/app.js') || url.includes('/index.html')) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
          return networkResponse;
        })
        .catch(() => caches.match(event.request).then((cached) => cached || caches.match('/index.html')))
    );
    return;
  }

  // Për asetet e tjera statike dhe hartën: Cache first, fallback to network
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      return fetch(event.request).then((networkResponse) => {
        // Cache OpenStreetMap pllakat lokalisht në pajisje për funksionim offline
        if (url.includes('tile.openstreetmap.org')) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      }).catch(() => {
        // Nëse bie interneti/antena celulare, shërbe index.html nga cache
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});
