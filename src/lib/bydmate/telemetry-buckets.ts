import type { TelemetryHistoryPoint } from "@/lib/bydmate/telemetry-history";
import {
  resolveTelemetryWindow,
  type TelemetryHistoryRange,
} from "@/lib/bydmate/telemetry-ranges";
import type { BydmateTripRow } from "@/types/database";

export type BucketGranularity = "hour" | "day" | "week";

export type TelemetryBucket = {
  startMs: number;
  endMs: number;
  label: string;
  socMin: number | null;
  socMax: number | null;
  socLast: number | null;
  speedMax: number | null;
  powerAvg: number | null;
  batteryTempAvg: number | null;
  outsideTempAvg: number | null;
  regenKwhSum: number;
  tractionKwhSum: number;
  sampleCount: number;
};

export type AnalyticsSummary = {
  tripCount: number;
  distanceKm: number;
  regenKwh: number;
  chargedKwh: number | null;
  avgConsumptionKwh100: number | null;
  maxSpeedKmh: number | null;
  socSwing: number | null;
  telemetryPoints: number;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function validNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validTemp(value: number | null | undefined) {
  const n = validNumber(value);
  return n != null && n >= -50 && n <= 90 ? n : null;
}

function weekStartMs(ms: number) {
  const d = new Date(ms);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function dayStartMs(ms: number) {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function hourStartMs(ms: number) {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.getTime();
}

export function bucketGranularityForRange(range: TelemetryHistoryRange): BucketGranularity {
  if (range === "day") return "hour";
  if (range === "week" || range === "month") return "day";
  return "week";
}

function bucketKey(ms: number, granularity: BucketGranularity) {
  if (granularity === "hour") return hourStartMs(ms);
  if (granularity === "day") return dayStartMs(ms);
  return weekStartMs(ms);
}

function bucketLabel(startMs: number, granularity: BucketGranularity, locale: string) {
  const d = new Date(startMs);
  if (granularity === "hour") {
    return d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  }
  if (granularity === "day") {
    return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
  }
  const end = new Date(startMs + 6 * 86400000);
  return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })}–${end.toLocaleDateString(locale, { day: "numeric" })}`;
}

function createEmptyBucket(startMs: number, granularity: BucketGranularity, locale: string): TelemetryBucket {
  const endMs =
    granularity === "hour"
      ? startMs + 3600000 - 1
      : granularity === "day"
        ? startMs + 86400000 - 1
        : startMs + 7 * 86400000 - 1;
  return {
    startMs,
    endMs,
    label: bucketLabel(startMs, granularity, locale),
    socMin: null,
    socMax: null,
    socLast: null,
    speedMax: null,
    powerAvg: null,
    batteryTempAvg: null,
    outsideTempAvg: null,
    regenKwhSum: 0,
    tractionKwhSum: 0,
    sampleCount: 0,
  };
}

function mergeIntoBucket(bucket: TelemetryBucket, point: TelemetryHistoryPoint) {
  const t = point.telemetry;
  const soc = validNumber(t.soc);
  const socMin = validNumber(point.hourly?.soc_min ?? t.soc);
  const socMax = validNumber(point.hourly?.soc_max ?? t.soc);

  if (socMin != null) bucket.socMin = bucket.socMin == null ? socMin : Math.min(bucket.socMin, socMin);
  if (socMax != null) bucket.socMax = bucket.socMax == null ? socMax : Math.max(bucket.socMax, socMax);
  if (soc != null) bucket.socLast = soc;

  const speed = validNumber(t.speed_kmh);
  if (speed != null) bucket.speedMax = bucket.speedMax == null ? speed : Math.max(bucket.speedMax, speed);

  const power = validNumber(t.power_kw);
  if (power != null) {
    const prev = bucket.powerAvg ?? 0;
    bucket.powerAvg = bucket.sampleCount === 0 ? power : (prev * bucket.sampleCount + power) / (bucket.sampleCount + 1);
  }

  const batteryTemp = validTemp(t.battery_temp_c);
  if (batteryTemp != null) {
    const prev = bucket.batteryTempAvg ?? 0;
    bucket.batteryTempAvg =
      bucket.sampleCount === 0 ? batteryTemp : (prev * bucket.sampleCount + batteryTemp) / (bucket.sampleCount + 1);
  }

  const outsideTemp = validTemp(t.outside_temp_c);
  if (outsideTemp != null) {
    const prev = bucket.outsideTempAvg ?? 0;
    bucket.outsideTempAvg =
      bucket.sampleCount === 0 ? outsideTemp : (prev * bucket.sampleCount + outsideTemp) / (bucket.sampleCount + 1);
  }

  bucket.regenKwhSum += point.regen_kwh_sum ?? 0;
  bucket.tractionKwhSum += point.traction_kwh_sum ?? 0;
  bucket.sampleCount += 1;
}

export function aggregateTelemetryBuckets(
  points: TelemetryHistoryPoint[],
  range: TelemetryHistoryRange,
  locale = "en-US",
): TelemetryBucket[] {
  if (range === "day") return [];

  const granularity = bucketGranularityForRange(range);
  const map = new Map<number, TelemetryBucket>();

  for (const point of points) {
    const ms = Date.parse(point.device_time);
    if (!Number.isFinite(ms)) continue;
    const key = bucketKey(ms, granularity);
    const bucket = map.get(key) ?? createEmptyBucket(key, granularity, locale);
    mergeIntoBucket(bucket, point);
    map.set(key, bucket);
  }

  return Array.from(map.values()).sort((a, b) => a.startMs - b.startMs);
}

export function formatHistoryRangeSubtitle(
  range: TelemetryHistoryRange,
  anchorDate: string,
  locale: string,
) {
  const window = resolveTelemetryWindow(range, anchorDate);
  const from = new Date(window.from);
  const to = new Date(window.to);
  if (range === "day") {
    return `${from.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} – ${to.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}`;
  }
  return `${from.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })} – ${to.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`;
}

export function buildAnalyticsSummary({
  points,
  trips,
  chargedKwh,
}: {
  points: TelemetryHistoryPoint[];
  trips: BydmateTripRow[];
  chargedKwh?: number | null;
}): AnalyticsSummary {
  let socMin = Infinity;
  let socMax = -Infinity;

  for (const point of points) {
    const soc = validNumber(point.telemetry.soc);
    const min = validNumber(point.hourly?.soc_min ?? point.telemetry.soc);
    const max = validNumber(point.hourly?.soc_max ?? point.telemetry.soc);
    if (min != null) socMin = Math.min(socMin, min);
    if (max != null) socMax = Math.max(socMax, max);
    if (soc != null) {
      socMin = Math.min(socMin, soc);
      socMax = Math.max(socMax, soc);
    }
  }

  let distanceKm = 0;
  let regenKwh = 0;
  let weightedConsumption = 0;
  let weightedDistance = 0;
  let maxSpeed: number | null = null;

  for (const trip of trips) {
    distanceKm += trip.distance_km ?? 0;
    regenKwh += trip.regen_energy_kwh ?? 0;
    const consumption = trip.avg_consumption_kwh_100km;
    const dist = trip.distance_km;
    if (consumption != null && dist != null && dist > 0) {
      weightedConsumption += consumption * dist;
      weightedDistance += dist;
    }
    if (trip.max_speed_kmh != null) {
      maxSpeed = maxSpeed == null ? trip.max_speed_kmh : Math.max(maxSpeed, trip.max_speed_kmh);
    }
  }

  return {
    tripCount: trips.length,
    distanceKm,
    regenKwh,
    chargedKwh: chargedKwh ?? null,
    avgConsumptionKwh100: weightedDistance > 0 ? weightedConsumption / weightedDistance : null,
    maxSpeedKmh: maxSpeed,
    socSwing: Number.isFinite(socMin) && Number.isFinite(socMax) ? socMax - socMin : null,
    telemetryPoints: points.length,
  };
}

export type TempConsumptionBucket = {
  tempLabel: string;
  tempMid: number;
  tripCount: number;
  avgConsumptionKwh100: number;
};

export function consumptionByOutsideTemp(trips: BydmateTripRow[]): TempConsumptionBucket[] {
  const bins = new Map<number, { count: number; sum: number }>();

  for (const trip of trips) {
    const consumption = trip.avg_consumption_kwh_100km;
    if (consumption == null || consumption <= 0) continue;
    // Trip row lacks avg outside temp — use placeholder bin from month; skip trips without env.
    // Route insights API attaches outside_temp_avg per trip.
    const temp = (trip as BydmateTripRow & { outside_temp_avg?: number | null }).outside_temp_avg;
    if (temp == null || !Number.isFinite(temp)) continue;
    const bin = Math.round(temp / 5) * 5;
    const row = bins.get(bin) ?? { count: 0, sum: 0 };
    row.count += 1;
    row.sum += consumption;
    bins.set(bin, row);
  }

  return Array.from(bins.entries())
    .sort(([a], [b]) => a - b)
    .map(([tempMid, row]) => ({
      tempLabel: `${tempMid}°C`,
      tempMid,
      tripCount: row.count,
      avgConsumptionKwh100: row.sum / row.count,
    }));
}
