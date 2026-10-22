/* JMS Chat notifications inside the service worker. Imported by /sw.js (one worker per
 * scope: a second worker at "/" would replace the caching one).
 *
 *  - push: a chat message for a closed or hidden tab (Web Push, sent by MAIN only).
 *    Nothing is shown while a JMS tab is visible and focused: the page shows its own
 *    pop-up there.
 *  - notificationclick: focus a JMS tab and open that chat, or open a new tab on it.
 *
 * Pages hidden in the background show the same notifications themselves through
 * registration.showNotification (chat-widget.js); the tag (one per chat) keeps a push and
 * a page notification for the same chat as one entry.
 */
'use strict';

self.addEventListener('push', (event) => {
  let data = null;
  try { data = event.data ? event.data.json() : null; } catch (_e) { data = null; }
  if (!data || data.type !== 'chat' || !data.conversation_sync_id) return;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (list.some((c) => c.visibilityState === 'visible' && c.focused)) return;
    await self.registration.showNotification(data.title || 'JMS Chat', {
      body: data.body || '',
      tag: `jms-chat-${data.conversation_sync_id}`,
      renotify: true,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      data: { chat: data.conversation_sync_id }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  const chat = event.notification && event.notification.data && event.notification.data.chat;
  if (!chat || !/^[0-9a-f-]{36}$/i.test(chat)) return; // not a chat notification
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = list.find((c) => c.focused) || list[0];
    if (tab) {
      tab.postMessage({ type: 'jms-open-chat', chat });
      if ('focus' in tab) return tab.focus();
      return undefined;
    }
    // iPhone / iPad: Web Push only reaches the home-screen chat app, which signs in
    // with the chat-only session, so open that page rather than full JMS.
    const ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent || '');
    const page = ios ? '/chat_app.html' : '/index.html';
    return self.clients.openWindow(`${page}?chat=${encodeURIComponent(chat)}`);
  })());
});
