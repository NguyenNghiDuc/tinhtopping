const CACHE = 'tinhtopping-v13';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './public/icon.svg',
  './public/css/style.css',
  './public/css/history-table.css',
  './public/css/statistics-polish.css',
  './public/css/pro-tools.css',
  './js/app.js',
  './js/calculator.js',
  './js/config.js',
  './js/database.js',
  './js/storage.js',
  './js/supabase.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request, { cache: 'no-store' })
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./index.html')))
  );
});
