/** Small forward clock drift is tolerated; larger jumps are not live measurements. */
export const MAX_MEASUREMENT_FUTURE_SKEW_MS = 30_000;

export function measurementIsRecent(deviceTime: string | null | undefined, nowMs: number, maxAgeMs: number) {
  const measuredMs = Date.parse(deviceTime ?? "");
  const ageMs = nowMs - measuredMs;
  return Number.isFinite(nowMs) && Number.isFinite(measuredMs)
    && ageMs >= -MAX_MEASUREMENT_FUTURE_SKEW_MS && ageMs <= maxAgeMs;
}

export function snapshotMeasurementIsFresh(
  snapshot: { device_time?: string | null; received_at: string },
  nowMs: number,
  maxAgeMs: number,
) {
  return measurementIsRecent(snapshot.device_time, nowMs, maxAgeMs)
    && measurementIsRecent(snapshot.received_at, nowMs, maxAgeMs);
}
