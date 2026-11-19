// =====================================================
// sw.js — service worker: keeps a copy of the app on the device
// so it opens even without internet.
// When you change the app's files, bump CACHE_VERSION (v1 → v2)
// so phones drop the old copy.
// =====================================================

const CACHE_VERSION = 'v1';
const CACHE = `spendings-${CACHE_VERSION}`;

// Everything the app needs to start
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './i18n.js',
  './storage.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 1. Install: save all app files to the cache
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

// 2. Activate: delete caches from older versions
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// 3. Fetch: answer from the cache right away, and quietly refresh the cache
//    from the network in the background ("stale-while-revalidate").
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  // The exchange rate must always be fresh, so it is never cached here
  if (new URL(request.url).hostname === 'api.monobank.ua') return;

  event.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(request, { ignoreSearch: true });

      const fromNetwork = fetch(request)
        .then(response => {
          // opaque = font files from Google (they can't be inspected, but can be cached)
          if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);

      if (cached) return cached;
      const response = await fromNetwork;
      if (response) return response;

      // Offline and nothing cached: for page loads, fall back to the app itself
      if (request.mode === 'navigate') return cache.match('./index.html');
      return Response.error();
    })
  );
});