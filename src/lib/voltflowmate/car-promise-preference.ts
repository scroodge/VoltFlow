/**
 * Per-device preference: show the trust-corrected car range promise (phase 4c).
 *
 * User-owned display preference → client-side localStorage, never Postgres. Default ON so the
 * correction stays discoverable; storage can be missing or throw (private window, blocked
 * site data), so every access is guarded and falls back to the default.
 */
export const CAR_PROMISE_STORAGE_KEY = "voltflow.carPromise.enabled";
export const CAR_PROMISE_DEFAULT_ENABLED = true;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseCarPromiseEnabled(
  raw: string | null | undefined,
): boolean {
  if (raw === "0") return false;
  if (raw === "1") return true;
  return CAR_PROMISE_DEFAULT_ENABLED;
}

export function readCarPromiseEnabled(
  storage: StorageLike | null | undefined,
): boolean {
  try {
    return parseCarPromiseEnabled(storage?.getItem(CAR_PROMISE_STORAGE_KEY));
  } catch {
    return CAR_PROMISE_DEFAULT_ENABLED;
  }
}

/** Returns false when the write could not be persisted (the caller keeps the in-memory value). */
export function writeCarPromiseEnabled(
  storage: StorageLike | null | undefined,
  enabled: boolean,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CAR_PROMISE_STORAGE_KEY, enabled ? "1" : "0");
    return true;
  } catch {
    return false;
  }
}
