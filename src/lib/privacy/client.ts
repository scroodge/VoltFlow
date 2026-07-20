"use client";

const LAST_GPS_STORAGE_KEY = "voltflow:last_gps";
const PRIVATE_CACHE_PREFIX = "voltflow-app-shell";
const PRIVATE_STORAGE_KEYS = [
  LAST_GPS_STORAGE_KEY,
  "ev-charge-preferences",
  "mate-update-dismiss",
  "voltflow.telegram.generation",
  "voltflow:kb_viewed",
  "voltflow:last_active_touch",
];

/** Remove location and authenticated page remnants from this browser profile. */
export async function clearPrivateBrowserData() {
  try {
    for (const key of PRIVATE_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private browsing; cache cleanup still proceeds.
  }

  if (!("caches" in window)) return;

  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(PRIVATE_CACHE_PREFIX))
        .map((key) => caches.delete(key)),
    );
  } catch {
    // Best-effort: an active service worker receives the same clear request below.
  }

  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    for (const worker of [registration?.active, registration?.waiting, registration?.installing]) {
      worker?.postMessage({ type: "voltflow:clear-private-cache" });
    }
  } catch {
    // Signing out must never be blocked by worker cleanup.
  }
}
