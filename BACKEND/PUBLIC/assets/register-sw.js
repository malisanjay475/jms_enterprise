/* Registers the JMS service worker (instant repeat loads + offline resilience).
 * Safe no-op on browsers without SW support or on insecure non-localhost origins.
 * The SW itself never caches /api or /sync, so live data is always fresh.
 */
(function () {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  // SW requires a secure context. Allow http on localhost for dev.
  var secure = window.isSecureContext ||
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';
  if (!secure) return;
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function (err) {
      // Non-fatal: app works fine without the SW.
      if (window.console && console.warn) console.warn('[SW] registration failed:', err);
    });
  });
})();
