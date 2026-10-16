/**
 * Caches the app shell so it opens instantly and survives a bad connection.
 * Card data and images always come from the network — never cached here, so
 * you don't end up looking at a stale list or an old price.
 */

const SHELL = 'buylist-shell-v2';
const FILES = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept Supabase or Scryfall — always live.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  // seed.json should be read fresh when an import runs.
  if (url.pathname.endsWith('seed.json')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(SHELL).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html')))
  );
});
