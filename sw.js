// =====================================================
// sw.js — service worker: keeps a copy of the app on the device
// so it opens even without internet.
// The app's own files always come fresh from the internet when it's available,
// so after a git push the new version shows up on the next launch.
// Bump CACHE_VERSION only when you add or rename files in APP_FILES.
// =====================================================

const CACHE_VERSION = 'v4';
const CACHE = `spendings-${CACHE_VERSION}`;

// Everything the app needs to start
const APP_FILES = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './i18n.js',
  './storage.js',
  './sync.js',
  './mono.js',
  './theme.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// 1. Install: save all app files to the cache
//    (cache: 'reload' = take them from the server, not from the browser's own cache)
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      cache.addAll(APP_FILES.map(file => new Request(file, { cache: 'reload' })))
    )
  );
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

// 3. Fetch
//    The app's own files: from the network first, so you always get the newest version;
//    if there's no internet, from the cache.
//    The font and the login library rarely change: from the cache first.
//    Everything else (Supabase data, the monobank rate) always goes to the network.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const ownFile = url.origin === self.location.origin;
  const library = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(url.hostname);

  if (ownFile) event.respondWith(networkFirst(request));
  else if (library) event.respondWith(cacheFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    // Offline page load: fall back to the app itself
    if (request.mode === 'navigate') return cache.match('./index.html');
    return Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // opaque = font files from Google (they can't be inspected, but can be cached)
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}