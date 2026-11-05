const CACHE = 'finance-v10';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './manifest.json'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const url = e.request.url;
  // Never cache data requests; they always go to the network
  if (e.request.method !== 'GET' || url.includes('script.google.com') || url.includes('googleusercontent')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
