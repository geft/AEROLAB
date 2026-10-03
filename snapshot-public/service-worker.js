/* global caches, fetch, Response, self, URL */

const CACHE_NAME = 'aerolab-snapshot-shell-v2';
// The build plugin includes every emitted chunk, including lazy tabs and the worker.
const PRECACHE_URLS = ['/'];
const SNAPSHOT_PATH = '/snapshot.msgpack.gz';

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => (cacheName.startsWith('aerolab-snapshot-shell-') && cacheName !== CACHE_NAME)
            || cacheName === 'aerolab-snapshot-data-v1')
          .map(cacheName => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === SNAPSHOT_PATH) return;

  event.respondWith(
    fetch(request).then(response => {
      const responseUrl = response.url ? new URL(response.url) : null;
      if (response.ok && response.type === 'basic' && responseUrl?.origin === self.location.origin) {
        event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone())));
      }
      return response;
    }).catch(async () => {
      // Precached static files have identical bytes for every Origin header.
      // Module requests add Origin while install-time requests do not.
      const cached = await caches.match(request, { ignoreVary: PRECACHE_URLS.includes(url.pathname) });
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const appShell = await caches.match('/');
        if (appShell) return appShell;
      }
      return Response.error();
    })
  );
});
