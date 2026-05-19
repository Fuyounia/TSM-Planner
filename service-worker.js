/* ============================================================
   TSM — Service Worker
   Handles background push notifications and basic caching
   ============================================================ */

const CACHE_NAME = 'tsm-v2';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './favicon.ico', './favicon38.png', './favicon75.png'];

// ── Install: pre-cache core assets ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

// ── Activate: remove old caches ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: network-first, fallback to cache ─────────────────
self.addEventListener('fetch', event => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Cache fresh responses for our assets
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Notification click: focus or open the app ───────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const action = event.action;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // If app is already open, focus it
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      // Otherwise open a new window
      return self.clients.openWindow('./');
    })
  );
});

// ── Push messages (future backend support) ──────────────────
self.addEventListener('push', event => {
  if (!event.data) return;
  try {
    const data = event.data.json();
    event.waitUntil(
      self.registration.showNotification(data.title || 'TSM Reminder', {
        body:             data.body || '',
        icon:             './favicon75.png',
        badge:            './favicon38.png',
        requireInteraction: data.requireInteraction || false,
        tag:              data.tag || 'tsm-push',
      })
    );
  } catch (e) {
    // plain text push
    event.waitUntil(
      self.registration.showNotification('TSM Reminder', { body: event.data.text() })
    );
  }
});
