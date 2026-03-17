/* Service Worker for SoundCount PWA.
   Caches the app shell for offline use.  Uses a cache-first strategy
   so the app loads instantly on repeat visits. */

const CACHE   = 'soundcount-v1';
const BASE    = new URL('./', self.location).href;

const ASSETS  = [
  BASE,
  BASE + 'index.html',
  BASE + 'style.css',
  BASE + 'app.js',
  BASE + 'manifest.json',
  BASE + 'icons/icon-192.png',
  BASE + 'icons/icon-512.png',
];

self.addEventListener('install', evt => {
  evt.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', evt => {
  evt.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', evt => {
  // Only handle GET requests within our scope
  if (evt.request.method !== 'GET') return;
  if (!evt.request.url.startsWith(BASE))  return;

  evt.respondWith(
    caches.match(evt.request).then(cached => cached || fetch(evt.request))
  );
});
