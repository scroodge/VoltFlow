// Shared PWA install/display detection. Used by the landing install funnel and
// the "Start tracking" install-first dialog so the logic can't diverge.

/** True when the app runs as an installed PWA (standalone display). */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari exposes this non-standard flag instead of display-mode.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** True on iOS/iPadOS, where install is Share → Add to Home Screen (no event). */
export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOSDevice = /iphone|ipad|ipod/i.test(ua);
  // iPadOS 13+ reports as Mac; detect via touch points.
  const iPadOS = /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return iOSDevice || iPadOS;
}

/**
 * useSyncExternalStore subscriber for standalone state — re-reads on
 * display-mode change and after the app is installed. SSR-safe.
 */
export function subscribeDisplayMode(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener?.("change", onChange);
  window.addEventListener("appinstalled", onChange);
  return () => {
    mq.removeEventListener?.("change", onChange);
    window.removeEventListener("appinstalled", onChange);
  };
}

/** No-op subscriber for static client-only flags (e.g. iOS detection). */
export const noopSubscribe = () => () => {};
