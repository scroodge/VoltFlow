type OdometerSample = {
  device_time: string;
  telemetry?: { odometer_km?: number | null } | null;
};

/**
 * Odometer at the start of a charge: the earliest in-session sample that reports a
 * positive, finite `odometer_km`. The car is parked while charging, so the reading does
 * not move during the session and the first one is the start value.
 */
export function sessionStartOdometerKm(
  samples: readonly OdometerSample[],
): number | null {
  let bestMs = Infinity;
  let bestKm: number | null = null;
  for (const sample of samples) {
    const km = sample.telemetry?.odometer_km;
    if (typeof km !== "number" || !Number.isFinite(km) || km <= 0) continue;
    const ms = Date.parse(sample.device_time);
    if (!Number.isFinite(ms) || ms >= bestMs) continue;
    bestMs = ms;
    bestKm = km;
  }
  return bestKm;
}
