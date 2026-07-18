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

const CACHE_VERSION = 'jms-v4-2026-07-18a';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

// Critical QC Supervisor shell — precached on install so the installed
// Android (TWA) app cold-starts instantly, even on a flaky factory network.
const QC_SHELL = [
  '/QCSupervisor.html',
  '/qc-manifest.json',
  '/assets/app.css',
  '/assets/QCSupervisor-script-1.js?v=release70',
  '/assets/register-sw.js?v=release70',
  '/assets/jms-logo.png',
  '/assets/icon-192.png',
  '/assets/icon-512.png',
  '/assets/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(STATIC_CACHE);
      // Best-effort: don't fail the install if one asset 404s.
      await Promise.allSettled(QC_SHELL.map((u) => cache.add(u)));
    } catch (e) { /* non-fatal */ }
  })());
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
