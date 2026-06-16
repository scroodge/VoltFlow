const STORAGE_KEY = "mate-update-dismiss";

export type MateUpdateDismissState = {
  version: string;
  dismissedOn: string;
};

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readMateUpdateDismissState(): MateUpdateDismissState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MateUpdateDismissState>;
    if (
      typeof parsed.version !== "string" ||
      !parsed.version.trim() ||
      typeof parsed.dismissedOn !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parsed.dismissedOn)
    ) {
      return null;
    }
    return { version: parsed.version.trim(), dismissedOn: parsed.dismissedOn };
  } catch {
    return null;
  }
}

export function writeMateUpdateDismissState(state: MateUpdateDismissState): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage failures (private mode, etc.)
  }
}

export function shouldShowMateUpdateBanner(latestVersion: string | null | undefined): boolean {
  if (!latestVersion?.trim()) return false;
  const state = readMateUpdateDismissState();
  if (!state) return true;
  if (state.version !== latestVersion.trim()) return true;
  if (state.dismissedOn !== getLocalDateKey()) return true;
  return false;
}

export function dismissMateUpdateBanner(latestVersion: string): void {
  writeMateUpdateDismissState({
    version: latestVersion.trim(),
    dismissedOn: getLocalDateKey(),
  });
}
