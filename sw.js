const CACHE = 'sulug-v3';
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'logo.jpg', 'icon-192.png',
  'icon-512.png', 'fonts/amiri-400.woff2', 'fonts/amiri-700.woff2', 'scanner/web.js', 'scanner/installer.txt'];
const assetUrls = new Set(ASSETS.map(asset => new URL(asset, self.registration.scope).href));
const currentUrls = new Set(['./', 'index.html', 'scanner/web.js']
  .map(asset => new URL(asset, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => /^sulug-v\d+$/.test(key) && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => clients.claim()));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  if (!assetUrls.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    if (currentUrls.has(url.href)) {
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await cache.put(url.href, response.clone());
          return response;
        }
      } catch { /* Use the cached page offline. */ }
    }
    return await cache.match(url.href) || fetch(event.request);
  }));
});
