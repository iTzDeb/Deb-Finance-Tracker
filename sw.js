const CACHE = 'finance-v19';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './import.html', './manifest.json', './icon-180.png', './icon-192.png', './icon-512.png'])));
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
  if (e.request.method !== 'GET' || url.includes('script.google.com') || url.includes('googleusercontent') || url.includes('vercel.app') || url.includes('callback=')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
