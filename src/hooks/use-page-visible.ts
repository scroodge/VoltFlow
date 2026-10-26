"use client";

import { useSyncExternalStore } from "react";

export function subscribe(onStoreChange: () => void) {
  document.addEventListener("visibilitychange", onStoreChange);
  return () => document.removeEventListener("visibilitychange", onStoreChange);
}

export function getSnapshot() {
  return document.visibilityState === "visible";
}

export function getServerSnapshot() {
  return true;
}

/** True when the tab/PWA window is visible — use to pause background polling. */
export function usePageVisible() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
