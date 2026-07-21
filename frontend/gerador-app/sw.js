const CACHE_NAME = 'gerador-app-v7';
const APP_ASSETS = [
  './',
  './index.html',
  './app.js?v=7',
  './styles/app.css?v=7',
  './manifest.webmanifest?v=7',
  './icon.svg',
  '../assets/config.js',
  '../gerador/shared/web-bridge.js',
  '../gerador/lib/impactMetrics.js',
  '../assets/images/logo-oddrive.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const url = new URL(event.request.url);

  if (url.pathname.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (isAppShellRequest(event.request, url)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    cacheFirst(event.request)
  );
});

function isAppShellRequest(request, url) {
  if (request.mode === 'navigate') {
    return true;
  }

  if (url.origin !== self.location.origin) {
    return false;
  }

  return /\.(?:html|js|css|webmanifest)$/i.test(url.pathname);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return caches.match('./index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return caches.match('./index.html');
  }
}

function isCacheable(response) {
  return Boolean(response && response.status === 200 && (response.type === 'basic' || response.type === 'cors'));
}
