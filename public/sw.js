// SPARKServ service worker.
//
// Two jobs, and deliberately no more:
//
//   1. PUSH — notifications arrive even when the app tab is closed, and a click
//      routes back into the app at the relevant page.
//   2. OFFLINE — a navigation the network cannot answer falls back to /offline.
//
// WHAT IT DELIBERATELY DOES NOT DO: cache pages or assets ahead of time. A worker
// that serves yesterday's HTML is worse than one that admits it is offline — in an
// app where a technician accepts a job and a customer approves an estimate, a stale
// page is a wrong answer rather than a slow one. Only /offline is cached, and only
// so the fallback itself works without a network.
//
// Its existence is also what makes the app installable (see src/app/manifest.ts).

const OFFLINE_URL = "/offline";
const OFFLINE_CACHE = "sparkserv-offline-v1";

self.addEventListener("install", (event) => {
  // `cache.add` rejects if the page cannot be fetched, which would fail the whole
  // install and leave the app with no worker at all. A missing offline page is
  // survivable; a failed install is not.
  event.waitUntil(
    caches
      .open(OFFLINE_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .catch(() => undefined)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take over from any older worker at once, and drop caches this version does not
  // know about, so a rename here never leaves the previous one behind.
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== OFFLINE_CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Only a top-level navigation, and only a GET. API calls, RSC payloads, images and
  // every write are left alone: the app handles its own failures, and intercepting a
  // POST would be dangerous.
  if (request.method !== "GET" || request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() =>
      caches.match(OFFLINE_URL).then(
        (cached) =>
          cached ??
          new Response("You are offline.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
      )
    )
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "SPARKServ", body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || "SPARKServ", {
      body: payload.body || "",
      icon: "/favicon.ico",
      data: { link: payload.link || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(link) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
