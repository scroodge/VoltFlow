import {
  locationSchema,
  telemetrySchema,
  type LocationPayload,
  type TelemetryPayload,
  type TelemetryPayloadData,
} from "./ingest-payload.ts";

export type TripTrackPointLike = {
  device_time: string;
  lat: number;
  lon: number;
  accuracy_m: number | null;
  bearing_deg: number | null;
  speed_kmh: number | null;
};

const MAX_ACCEPTED_ACCURACY_M = 100;
const MAX_LOW_CONFIDENCE_ACCURACY_M = 30;
const MAX_REASONABLE_GPS_SPEED_KMH = 180;
const GPS_JUMP_TOLERANCE_KM = 0.05;
const MAX_GPS_JUMP_WINDOW_MS = 10 * 60 * 1000;
const MAX_TELEMETRY_JUMP_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_SOC_FAST_JUMP_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_SOC_FAST_DELTA = 35;
const MAX_SOC_DAILY_DELTA = 70;
const MAX_ODOMETER_JUMP_KM_PER_HOUR = 300;
const ODOMETER_JUMP_TOLERANCE_KM = 5;

export type AcceptedLocation = {
  lat: number;
  lon: number;
  deviceTimeMs: number;
  speedKmh: number | null;
};

export type AcceptedTelemetry = {
  telemetry: TelemetryPayloadData;
  deviceTimeMs: number;
};

type NumericTelemetryRule = {
  min: number;
  max: number;
};

const numericTelemetryRules = {
  soc: { min: 0, max: 100 },
  speed_kmh: { min: 0, max: 260 },
  power_kw: { min: -250, max: 250 },
  battery_temp_c: { min: -50, max: 90 },
  cabin_temp_c: { min: -50, max: 90 },
  outside_temp_c: { min: -60, max: 70 },
  battery_voltage_v: { min: 0, max: 1000 },
  aux_voltage_v: { min: 6, max: 18 },
  odometer_km: { min: 0, max: 2_000_000 },
  soh_percent: { min: 0, max: 100 },
  charge_power_kw: { min: 0, max: 250 },
  kwh_charged: { min: 0, max: 500 },
  range_est_km: { min: 0, max: 1000 },
  current_trip_distance_km: { min: 0, max: 2000 },
  current_trip_consumption_kwh_100km: { min: 0, max: 80 },
} satisfies Partial<Record<keyof TelemetryPayloadData, NumericTelemetryRule>>;

const numericTelemetryKeys = Object.keys(numericTelemetryRules) as Array<
  keyof typeof numericTelemetryRules
>;

// Round float-noisy fields before storage. Raw doubles serialize to ~17-20 chars
// (e.g. cell_delta_v "0.019999999999999"), bloating the telemetry jsonb on every
// row. Decimals are chosen to preserve all real precision: cell delta to 0.1 mV,
// trip distance to 1 m. soc/temps are already short and left untouched.
const roundingRules = {
  cell_delta_v: 4,
  cell_voltage_min_v: 4,
  cell_voltage_max_v: 4,
  diplus_cell_delta_v: 4,
  diplus_min_cell_voltage_v: 4,
  diplus_max_cell_voltage_v: 4,
  range_est_km: 1,
  current_trip_distance_km: 3,
  current_trip_consumption_kwh_100km: 2,
  kwh_charged: 3,
} satisfies Partial<Record<keyof TelemetryPayloadData, number>>;

const roundingKeys = Object.keys(roundingRules) as Array<keyof typeof roundingRules>;

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function isWithinRule(value: number | null | undefined, rule: NumericTelemetryRule) {
  const n = finiteNumber(value);
  return n != null && n >= rule.min && n <= rule.max;
}

function hasPlausibleSocJump(
  previous: AcceptedTelemetry | undefined,
  nextSoc: number,
  deviceTimeMs: number,
) {
  const previousSoc = finiteNumber(previous?.telemetry.soc);
  if (previousSoc == null) return true;

  const elapsedMs = deviceTimeMs - previous!.deviceTimeMs;
  if (elapsedMs <= 0 || elapsedMs > MAX_TELEMETRY_JUMP_WINDOW_MS) return true;

  const delta = Math.abs(nextSoc - previousSoc);
  if (previousSoc <= 5 && nextSoc >= 20) return true;
  if (elapsedMs <= MAX_SOC_FAST_JUMP_WINDOW_MS) return delta <= MAX_SOC_FAST_DELTA;
  return delta <= MAX_SOC_DAILY_DELTA;
}

function hasPlausibleOdometerJump(
  previous: AcceptedTelemetry | undefined,
  nextOdometerKm: number,
  deviceTimeMs: number,
) {
  const previousOdometerKm = finiteNumber(previous?.telemetry.odometer_km);
  if (previousOdometerKm == null) return true;

  const elapsedMs = deviceTimeMs - previous!.deviceTimeMs;
  if (elapsedMs <= 0 || elapsedMs > MAX_TELEMETRY_JUMP_WINDOW_MS) {
    return nextOdometerKm >= previousOdometerKm - ODOMETER_JUMP_TOLERANCE_KM;
  }

  const deltaKm = nextOdometerKm - previousOdometerKm;
  if (deltaKm < -ODOMETER_JUMP_TOLERANCE_KM) return false;

  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const maxDistanceKm = MAX_ODOMETER_JUMP_KM_PER_HOUR * elapsedHours + ODOMETER_JUMP_TOLERANCE_KM;
  return deltaKm <= maxDistanceKm;
}

export function sanitizeTelemetry(
  telemetry: TelemetryPayloadData,
  previous: AcceptedTelemetry | undefined,
  deviceTimeMs: number,
) {
  const sanitized: TelemetryPayloadData = { ...telemetry };
  let droppedFields = 0;

  for (const key of numericTelemetryKeys) {
    const value = telemetry[key];
    if (value == null) continue;

    if (!isWithinRule(value, numericTelemetryRules[key])) {
      delete sanitized[key];
      droppedFields += 1;
    }
  }

  for (const key of roundingKeys) {
    const value = finiteNumber(sanitized[key] as number | null | undefined);
    if (value != null) {
      sanitized[key] = roundTo(value, roundingRules[key]) as never;
    }
  }

  const soc = finiteNumber(sanitized.soc);
  if (soc != null && !hasPlausibleSocJump(previous, soc, deviceTimeMs)) {
    delete sanitized.soc;
    droppedFields += 1;
  }

  const odometerKm = finiteNumber(sanitized.odometer_km);
  if (odometerKm != null && !hasPlausibleOdometerJump(previous, odometerKm, deviceTimeMs)) {
    delete sanitized.odometer_km;
    droppedFields += 1;
  }

  return { telemetry: sanitized, droppedFields };
}

function mergeAcceptedTelemetry(
  previous: TelemetryPayloadData | undefined,
  next: TelemetryPayloadData,
) {
  const merged: TelemetryPayloadData = { ...previous };
  for (const [key, value] of Object.entries(next) as Array<
    [keyof TelemetryPayloadData, TelemetryPayloadData[keyof TelemetryPayloadData]]
  >) {
    if (value != null) {
      merged[key] = value as never;
    }
  }

  return merged;
}

function normalizeBearing(value: number | null | undefined) {
  const bearing = finiteNumber(value);
  if (bearing == null) return null;
  return ((bearing % 360) + 360) % 360;
}

function normalizeAccuracy(value: number | null | undefined) {
  const accuracy = finiteNumber(value);
  if (accuracy == null || accuracy < 0 || accuracy > MAX_ACCEPTED_ACCURACY_M) return null;
  return accuracy;
}

export function hasPlausibleCoordinates(location: LocationPayload) {
  const lat = finiteNumber(location.lat);
  const lon = finiteNumber(location.lon);
  if (lat == null || lon == null) return false;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return false;
  if (lat === 0 && lon === 0) return false;

  const accuracy = finiteNumber(location.accuracy_m);
  if (accuracy != null && (accuracy < 0 || accuracy > MAX_ACCEPTED_ACCURACY_M)) return false;
  if (accuracy != null && accuracy > MAX_LOW_CONFIDENCE_ACCURACY_M && location.bearing_deg == null) {
    return false;
  }

  return true;
}

function distanceKm(from: Pick<AcceptedLocation, "lat" | "lon">, to: Pick<AcceptedLocation, "lat" | "lon">) {
  const earthRadiusKm = 6371;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function hasPlausibleJump(previous: AcceptedLocation | undefined, next: AcceptedLocation) {
  if (!previous) return true;

  const elapsedMs = next.deviceTimeMs - previous.deviceTimeMs;
  if (elapsedMs <= 0 || elapsedMs > MAX_GPS_JUMP_WINDOW_MS) return true;

  const elapsedHours = elapsedMs / (60 * 60 * 1000);
  const speedLimitKmh = Math.min(
    MAX_REASONABLE_GPS_SPEED_KMH,
    Math.max(previous.speedKmh ?? 0, next.speedKmh ?? 0) * 2 + 30,
  );
  const maxDistanceKm = speedLimitKmh * elapsedHours + GPS_JUMP_TOLERANCE_KM;
  return distanceKm(previous, next) <= maxDistanceKm;
}

function withoutCoordinates(location: LocationPayload) {
  const rest: LocationPayload = { ...location };
  delete rest.lat;
  delete rest.lon;
  delete rest.accuracy_m;
  delete rest.bearing_deg;
  return rest;
}

export function sanitizeLocation(
  location: LocationPayload,
  previous: AcceptedLocation | undefined,
  deviceTimeMs: number,
  telemetry: TelemetryPayloadData,
) {
  if (!hasPlausibleCoordinates(location)) {
    return { location: withoutCoordinates(location), accepted: null };
  }

  const accepted = {
    lat: location.lat!,
    lon: location.lon!,
    deviceTimeMs,
    speedKmh: isWithinRule(telemetry.speed_kmh, numericTelemetryRules.speed_kmh)
      ? telemetry.speed_kmh!
      : null,
  };

  if (!hasPlausibleJump(previous, accepted)) {
    return { location: withoutCoordinates(location), accepted: null };
  }

  return {
    location: {
      ...location,
      lat: accepted.lat,
      lon: accepted.lon,
      accuracy_m: normalizeAccuracy(location.accuracy_m),
      bearing_deg: normalizeBearing(location.bearing_deg),
    },
    accepted,
  };
}

export function sanitizePayloadLocations(
  payloads: TelemetryPayload[],
  previousLocations: Map<string, AcceptedLocation>,
) {
  let droppedLocations = 0;
  const ordered = payloads
    .map((payload, index) => ({
      payload,
      index,
      deviceTimeMs: Date.parse(payload.device_time),
    }))
    .sort((a, b) => a.deviceTimeMs - b.deviceTimeMs);

  const sanitized = [...payloads];
  for (const item of ordered) {
    const previous = previousLocations.get(item.payload.vehicle_id);
    const result = sanitizeLocation(
      item.payload.location ?? {},
      previous,
      item.deviceTimeMs,
      item.payload.telemetry ?? {},
    );

    if (result.accepted) {
      previousLocations.set(item.payload.vehicle_id, result.accepted);
    } else if (item.payload.location?.lat != null || item.payload.location?.lon != null) {
      droppedLocations += 1;
    }

    sanitized[item.index] = {
      ...item.payload,
      location: result.location,
    };
  }

  return { payloads: sanitized, droppedLocations };
}

export function sanitizeTripTrackPoints<T extends TripTrackPointLike>(points: T[]) {
  let droppedPointCount = 0;
  let previous: AcceptedLocation | undefined;
  const sanitized: T[] = [];

  for (const point of points) {
    const deviceTimeMs = Date.parse(point.device_time);
    const result = sanitizeLocation(
      {
        lat: point.lat,
        lon: point.lon,
        accuracy_m: point.accuracy_m,
        bearing_deg: point.bearing_deg,
      },
      previous,
      deviceTimeMs,
      { speed_kmh: point.speed_kmh },
    );

    if (result.accepted) {
      previous = result.accepted;
      sanitized.push(point);
    } else {
      droppedPointCount += 1;
    }
  }

  return { points: sanitized, droppedPointCount };
}

/** Keep all persisted track points for map display; only drop invalid coordinates. */
export function filterDisplayTripTrackPoints<T extends TripTrackPointLike>(points: T[]) {
  let droppedPointCount = 0;
  const filtered: T[] = [];

  for (const point of points) {
    const lat = finiteNumber(point.lat);
    const lon = finiteNumber(point.lon);
    if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180 || (lat === 0 && lon === 0)) {
      droppedPointCount += 1;
      continue;
    }

    filtered.push(point);
  }

  return { points: filtered, droppedPointCount };
}

export function sanitizePayloadTelemetry(
  payloads: TelemetryPayload[],
  previousTelemetry: Map<string, AcceptedTelemetry>,
) {
  let droppedTelemetryFields = 0;
  const ordered = payloads
    .map((payload, index) => ({
      payload,
      index,
      deviceTimeMs: Date.parse(payload.device_time),
    }))
    .sort((a, b) => a.deviceTimeMs - b.deviceTimeMs);

  const sanitized = [...payloads];
  for (const item of ordered) {
    const previous = previousTelemetry.get(item.payload.vehicle_id);
    const result = sanitizeTelemetry(item.payload.telemetry ?? {}, previous, item.deviceTimeMs);
    droppedTelemetryFields += result.droppedFields;

    sanitized[item.index] = {
      ...sanitized[item.index],
      telemetry: result.telemetry,
    };

    previousTelemetry.set(item.payload.vehicle_id, {
      telemetry: mergeAcceptedTelemetry(previous?.telemetry, result.telemetry),
      deviceTimeMs: item.deviceTimeMs,
    });
  }

  return { payloads: sanitized, droppedTelemetryFields };
}

export function acceptedLocationFromSnapshot(row: {
  vehicle_id: string;
  device_time: string;
  telemetry: unknown;
  location: unknown;
}) {
  const parsed = locationSchema.safeParse(row.location);
  if (!parsed.success || !hasPlausibleCoordinates(parsed.data)) return null;

  const deviceTimeMs = Date.parse(row.device_time);
  if (!Number.isFinite(deviceTimeMs)) return null;

  const telemetry = telemetrySchema.safeParse(row.telemetry);
  const speedKmh = telemetry.success && isWithinRule(telemetry.data.speed_kmh, numericTelemetryRules.speed_kmh)
    ? telemetry.data.speed_kmh!
    : null;

  return {
    vehicleId: row.vehicle_id,
    location: {
      lat: parsed.data.lat!,
      lon: parsed.data.lon!,
      deviceTimeMs,
      speedKmh,
    },
  };
}

export function acceptedTelemetryFromSnapshot(row: {
  vehicle_id: string;
  device_time: string;
  telemetry: unknown;
}) {
  const parsed = telemetrySchema.safeParse(row.telemetry);
  if (!parsed.success) return null;

  const deviceTimeMs = Date.parse(row.device_time);
  if (!Number.isFinite(deviceTimeMs)) return null;

  return {
    vehicleId: row.vehicle_id,
    telemetry: {
      telemetry: parsed.data,
      deviceTimeMs,
    },
  };
}
