/* Service worker — push, Telegram cache, and app shell for the charging cockpit. */
const TELEGRAM_CACHE = "voltflow-telegram-v2";
const APP_SHELL_CACHE = "voltflow-app-shell-v2";
const TELEGRAM_ASSETS = [
  "/telegram",
  "/manifest.webmanifest",
  "/voltflow-icon.svg",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .open(TELEGRAM_CACHE)
        .then((cache) => cache.addAll(TELEGRAM_ASSETS))
        .catch(() => undefined),
      // Never precache authenticated routes. Their HTML can contain account data and
      // Cache Storage outlives a Supabase sign-out on shared devices.
      caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(TELEGRAM_ASSETS)).catch(() => undefined),
    ]).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("voltflow-app-shell") && key !== APP_SHELL_CACHE)
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== "voltflow:clear-private-cache") return;
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("voltflow-app-shell"))
          .map((key) => caches.delete(key)),
      ),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;

  const isTelegramPage = url.pathname.startsWith("/telegram");
  const isPublicAsset =
    url.pathname.startsWith("/_next/static/") ||
    TELEGRAM_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith("/icons/");

  if (!isTelegramPage && !isPublicAsset) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          const cacheName = TELEGRAM_CACHE;
          caches.open(cacheName).then((cache) => {
            cache.put(request, copy).catch(() => undefined);
          });
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => {
          if (cached) return cached;
          if (isTelegramPage) {
            return caches
              .match("/telegram")
              .then(
                (fallback) =>
                  fallback ||
                  new Response("VoltFlow Telegram knowledge base is offline.", {
                    status: 503,
                    headers: { "Content-Type": "text/plain; charset=utf-8" },
                  }),
              );
          }
          return new Response("", { status: 504, statusText: "Offline" });
        }),
      ),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload && payload.title ? payload.title : "Charge complete";
  const body = payload && payload.body ? payload.body : "Battery reached target level.";
  const tag = payload && payload.tag ? payload.tag : "charge-complete";
  const url = payload && payload.url ? payload.url : "/dashboard";
  // Live-status updates replace in place without buzzing (renotify:false, silent:true);
  // absent fields keep the original one-shot behavior for milestone payloads.
  const renotify = payload && payload.renotify === false ? false : true;
  const silent = payload && payload.silent === true;

  // kind:"clear" removes the live-status card (drive-away). Chrome's userVisibleOnly
  // contract wants a notification per push, so show a silent one under the same tag,
  // then close everything carrying it.
  if (payload && payload.kind === "clear") {
    event.waitUntil(
      self.registration
        .showNotification(title, { body, tag, data: { url }, silent: true })
        .then(() => self.registration.getNotifications({ tag }))
        .then((notifications) => {
          for (const notification of notifications) notification.close();
        }),
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      renotify,
      silent,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const urlFromData =
    event.notification && event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) {
            return client.navigate(urlFromData).then(() => client.focus());
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlFromData);
      }
      return undefined;
    }),
  );
});
