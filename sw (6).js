// Offline-Speicher für die App-Dateien (keine Nutzerdaten).
const CACHE = 'zeiterfassung-v2';
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'jspdf.umd.min.js', 'manifest.webmanifest',
  'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'logo.jpg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Erst Netz (damit Updates ankommen), bei Offline aus dem Speicher.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
