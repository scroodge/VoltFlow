/** Relative / absolute tolerance when comparing GPS path length to odometer delta. */
export const TRIP_DISTANCE_ODOMETER_RELATIVE_TOLERANCE = 0.15;
export const TRIP_DISTANCE_ODOMETER_ABSOLUTE_TOLERANCE_KM = 0.8;

const EARTH_RADIUS_M = 6_371_000;

function finiteKm(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toRad(deg: number) {
  return (deg * Math.PI) / 180;
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function trackPathDistanceKm(points: { lat: number; lon: number }[]): number | null {
  const valid = points.filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lon));
  if (valid.length < 2) return null;

  let pathMeters = 0;
  for (let index = 1; index < valid.length; index += 1) {
    const prev = valid[index - 1];
    const current = valid[index];
    pathMeters += haversineMeters(prev.lat, prev.lon, current.lat, current.lon);
  }

  return pathMeters > 0 ? pathMeters / 1000 : null;
}

export function odometerDeltaKm(values: number[]): number | null {
  if (values.length < 2) return null;
  const delta = values.at(-1)! - values[0]!;
  return delta >= 0 && Number.isFinite(delta) ? delta : null;
}

type OdometerSample = {
  telemetry?: { odometer_km?: number | null } | null;
  diplus_mileage_km?: number | null;
  diplus?: { mileage_km?: number | null } | null;
};

export function readSampleOdometerKm(sample: OdometerSample | null | undefined): number | null {
  if (!sample) return null;

  const fromTelemetry = finiteKm(sample.telemetry?.odometer_km);
  if (fromTelemetry != null) return fromTelemetry;

  const fromColumn = finiteKm(sample.diplus_mileage_km);
  if (fromColumn != null) return fromColumn;

  const fromDiplus = finiteKm(sample.diplus?.mileage_km);
  if (fromDiplus != null) return fromDiplus;

  return null;
}

export function odometerDeltaFromSamples(samples: OdometerSample[]): number | null {
  const values = samples
    .map((sample) => readSampleOdometerKm(sample))
    .filter((value): value is number => value != null);
  return odometerDeltaKm(values);
}

export function tripDistanceSourcesAgree(
  aKm: number | null | undefined,
  bKm: number | null | undefined,
  options?: {
    relativeTolerance?: number;
    absoluteToleranceKm?: number;
  },
): boolean {
  const left = finiteKm(aKm);
  const right = finiteKm(bKm);
  if (left == null || right == null || left < 0 || right < 0) return false;

  const delta = Math.abs(left - right);
  const reference = Math.max(left, right, 0.1);
  const relativeTolerance = options?.relativeTolerance ?? TRIP_DISTANCE_ODOMETER_RELATIVE_TOLERANCE;
  const absoluteToleranceKm =
    options?.absoluteToleranceKm ?? TRIP_DISTANCE_ODOMETER_ABSOLUTE_TOLERANCE_KM;

  return delta <= absoluteToleranceKm || delta / reference <= relativeTolerance;
}

export type TripDistanceInputs = {
  gpsDistanceKm?: number | null;
  odometerDistanceKm?: number | null;
  tripCounterDistanceKm?: number | null;
  storedDistanceKm?: number | null;
};

/**
 * Prefer GPS path length when it agrees with odometer delta; otherwise fall back to odometer,
 * then trip counter / stored DB distance.
 */
export function resolvePreferredTripDistanceKm(inputs: TripDistanceInputs): number | null {
  const gpsKm = finiteKm(inputs.gpsDistanceKm);
  const odometerKm = finiteKm(inputs.odometerDistanceKm);
  const tripCounterKm = finiteKm(inputs.tripCounterDistanceKm);
  const storedKm = finiteKm(inputs.storedDistanceKm);

  if (gpsKm != null && gpsKm >= 0 && odometerKm != null && tripDistanceSourcesAgree(gpsKm, odometerKm)) {
    return gpsKm;
  }

  if (odometerKm != null && odometerKm >= 0) return odometerKm;
  if (gpsKm != null && gpsKm >= 0) return gpsKm;
  if (tripCounterKm != null && tripCounterKm >= 0) return tripCounterKm;
  if (storedKm != null && storedKm >= 0) return storedKm;

  return null;
}

export function resolveTripDistanceFromTrackAndSamples(
  trackPoints: { lat: number; lon: number }[],
  samples: OdometerSample[],
  storedDistanceKm?: number | null,
): number | null {
  return resolvePreferredTripDistanceKm({
    gpsDistanceKm: trackPathDistanceKm(trackPoints),
    odometerDistanceKm: odometerDeltaFromSamples(samples),
    storedDistanceKm,
  });
}
