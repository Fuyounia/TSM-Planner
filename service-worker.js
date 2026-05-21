/* ============================================================
   TSM — Service Worker (FCM ENABLED)
   ============================================================ */

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

// TODO: replace with your Firebase config
firebase.initializeApp({
  apiKey: "AIzaSyA8Uit9CjWUGPkc-reEDndxuClg6dowzl8",
  authDomain: "tsm-planner.firebaseapp.com",
  projectId: "tsm-planner",
  messagingSenderId: "585712753497",
  appId: "1:585712753497:web:1773882934b93390a10a48"
});

const messaging = firebase.messaging();

// ── Background push handler ─────────────────────────────
messaging.onBackgroundMessage((payload) => {
  const title =
    payload.notification?.title ||
    payload.data?.title ||
    "TSM Reminder";

  const body =
    payload.notification?.body ||
    payload.data?.body ||
    "";

  self.registration.showNotification(title, {
    body,
    icon: "/favicon150-2.png",
    badge: "/favicon150-2.png",
    tag: payload.data?.tag || "tsm-notification",
    requireInteraction: true,
  });
});

// ── Cache (your original system kept) ────────────────────
const CACHE_NAME = "tsm-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(k => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      )
    )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached || fetch(event.request).catch(() => caches.match("./index.html"));
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow("./");
    })
  );
});
