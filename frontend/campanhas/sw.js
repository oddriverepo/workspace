const CACHE_NAME = 'oddrive-campanhas-pwa-v2';
const OFFLINE_DRIVER_URL = '/campanhas/offline-driver.html';
const OFFLINE_GRAPHIC_URL = '/campanhas/offline-graphic.html';

const APP_SHELL = [
  '/campanhas/driver.html',
  '/campanhas/graphic.html',
  '/campanhas/assets/styles.css',
  '/campanhas/assets/mobile-portals.css',
  '/campanhas/assets/images/logo-oddrive.png',
  '/campanhas/js/driver.js',
  '/campanhas/js/graphic.js',
  '/assets/config.js',
  '/assets/pwa-bootstrap.js',
  '/campanhas/assets/icons/pwa-192.png',
  '/campanhas/assets/icons/pwa-512.png',
  '/campanhas/assets/icons/apple-touch-icon-180.png',
  OFFLINE_DRIVER_URL,
  OFFLINE_GRAPHIC_URL,
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

function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
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

async function networkFirstNavigate(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;

    const url = new URL(request.url);
    if (url.pathname.includes('/graphic')) {
      const graphicOffline = await cache.match(OFFLINE_GRAPHIC_URL);
      if (graphicOffline) return graphicOffline;
    }
    const driverOffline = await cache.match(OFFLINE_DRIVER_URL);
    if (driverOffline) return driverOffline;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

async function networkFirstAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!isSameOrigin(request)) return;

  const url = new URL(request.url);
  if (isApiRequest(url)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigate(request));
    return;
  }

  if (/\.(?:js|css)$/.test(url.pathname)) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
