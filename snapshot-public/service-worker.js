/* global caches, fetch, Response, self, URL */

const CACHE_NAME = 'aerolab-snapshot-shell-v1';
const SNAPSHOT_PATH = '/snapshot.json';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => Promise.all(
        cacheNames
          .filter(cacheName => cacheName.startsWith('aerolab-snapshot-') && cacheName !== CACHE_NAME)
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
      const cached = await caches.match(request);
      if (cached) return cached;
      if (request.mode === 'navigate') {
        const appShell = await caches.match('/');
        if (appShell) return appShell;
      }
      return Response.error();
    })
  );
});
