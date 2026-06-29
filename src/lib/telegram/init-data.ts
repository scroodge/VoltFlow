/**
 * Read the raw, server-verifiable Telegram `initData` string.
 *
 * Two sources, in order:
 *   1. window.Telegram.WebApp.initData — present once telegram-web-app.js has
 *      loaded and parsed the launch params.
 *   2. The URL hash — Telegram appends `#tgWebAppData=<url-encoded initData>` to
 *      the Mini App URL. This is available synchronously at page load with NO
 *      SDK, so it works even if telegram-web-app.js never loads (CSP, network,
 *      or a WebView that just doesn't run it). The value is itself a percent-
 *      encoded querystring (`query_id=...&user=...&auth_date=...&hash=...`) —
 *      exactly what the backend HMAC-verifies — so one decode layer is correct.
 *
 * Returns "" when neither source has data (e.g. a plain browser), letting
 * callers fall back to standard login.
 */
export function readTelegramInitData(): string {
  if (typeof window === "undefined") return "";

  const fromSdk = window.Telegram?.WebApp?.initData;
  if (fromSdk) return fromSdk;

  const hash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  if (!hash) return "";

  const fromHash = new URLSearchParams(hash).get("tgWebAppData");
  return fromHash ?? "";
}

/** True when the page was opened inside a Telegram Mini App WebView. */
export function isTelegramWebView(): boolean {
  return readTelegramInitData() !== "";
}
