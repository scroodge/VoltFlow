// Helpers for comparing VoltFlow Mate APK version strings (dotted numeric, e.g.
// "0.3.9.4"). The version running on the car comes from
// bydmate_live_snapshots.mate_version; the latest available version comes from
// the mate_app_releases table.

function parseSegments(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/**
 * Compare two dotted-numeric versions. Returns a negative number if `a < b`,
 * positive if `a > b`, and 0 if equal. Missing trailing segments are treated as 0
 * so "0.3.9" === "0.3.9.0".
 */
export function compareMateVersions(a: string, b: string): number {
  const left = parseSegments(a);
  const right = parseSegments(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * True when an update is available: both versions are present and the installed
 * version is strictly older than the latest. Returns false on missing/blank
 * input so we never nag without real data.
 */
export function isMateUpdateAvailable(
  installed: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  if (!installed?.trim() || !latest?.trim()) return false;
  return compareMateVersions(installed, latest) < 0;
}
