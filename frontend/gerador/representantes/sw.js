const CACHE_NAME = 'oddrive-request-pwa-v1';
const OFFLINE_URL = '/gerador/representantes/offline.html';

const APP_SHELL = [
  '/gerador/representantes/portal.html',
  '/gerador/styles/theme.css',
  '/gerador/styles/globals.css',
  '/assets/config.js',
  '/assets/pwa-bootstrap.js',
  '/gerador/public/brand/pwa-192.png',
  '/gerador/public/brand/pwa-512.png',
  OFFLINE_URL,
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => (key !== CACHE_NAME ? caches.delete(key) : Promise.resolve())));
    await self.clients.claim();
  })());
});

function isSameOrigin(request) {
  try {
    return new URL(request.url).origin === self.location.origin;
  } catch {
    return false;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    fetch(request).then(response => {
      if (response && response.ok) cache.put(request, response.clone());
    }).catch(() => {});
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!isSameOrigin(request)) return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
        const offline = await cache.match(OFFLINE_URL);
        if (offline) return offline;
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  event.respondWith(cacheFirst(request));
});
