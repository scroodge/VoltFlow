"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  CAR_PROMISE_DEFAULT_ENABLED,
  readCarPromiseEnabled,
  writeCarPromiseEnabled,
} from "@/lib/voltflowmate/car-promise-preference";

const CHANGE_EVENT = "voltflow:car-promise-preference";

// Fallback for when storage cannot persist: keeps the toggle working for this page load.
let memoryOverride: boolean | null = null;

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getSnapshot(): boolean {
  if (memoryOverride != null) return memoryOverride;
  return readCarPromiseEnabled(safeLocalStorage());
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Shared on/off for the corrected car promise (phase 4c). One setting drives the dashboard
 * explainer sheet and the /vehicle chip; same-tab consumers sync via a custom event,
 * other tabs via the native `storage` event.
 */
export function useCarPromiseEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => CAR_PROMISE_DEFAULT_ENABLED,
  );
  const setEnabled = useCallback((next: boolean) => {
    const persisted = writeCarPromiseEnabled(safeLocalStorage(), next);
    memoryOverride = persisted ? null : next;
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [enabled, setEnabled];
}
