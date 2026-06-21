/* JMS Enterprise Service Worker
 * Goal: make repeat loads feel instant and keep the app usable during brief
 * network blips on the factory floor — WITHOUT ever serving stale live data.
 *
 * Strategy:
 *   - API / sync / non-GET / cross-origin  → network only (never cached).
 *   - Page navigations (HTML)              → network-first, fall back to cache
 *                                            (so a blip still shows the last page).
 *   - Static assets (/assets, fonts, imgs) → stale-while-revalidate
 *                                            (instant from cache, refresh in bg).
 *
 * Bump CACHE_VERSION to invalidate everything on the next activate.
 */
'use strict';

const CACHE_VERSION = 'jms-v1-2026-06-21';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

self.addEventListener('install', (event) => {
  // Activate the new worker immediately rather than waiting for old tabs.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => !k.startsWith(CACHE_VERSION)).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/assets/') ||
    /\.(?:js|css|woff2?|ttf|eot|otf|png|jpg|jpeg|gif|webp|svg|ico)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET; never interfere with POST/PUT/DELETE.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Same-origin only. Leave CDN/cross-origin to the browser/HTTP cache.
  if (url.origin !== self.location.origin) return;

  // NEVER cache live API or sync traffic — always hit the network so users
  // never see stale production data.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/sync')) return;

  // Page navigations → network-first with cache fallback for offline resilience.
  if (req.mode === 'navigate' || /\.html$/i.test(url.pathname)) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(PAGE_CACHE);
          cache.put(req, fresh.clone());
        }
        return fresh;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        throw e;
      }
    })());
    return;
  }

  // Static assets → stale-while-revalidate: serve cache instantly, refresh in bg.
  if (isStaticAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req);
      const network = fetch(req).then((resp) => {
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      }).catch(() => null);
      return cached || (await network) || fetch(req);
    })());
  }
});
