import type { SupabaseClient } from "@supabase/supabase-js";

import {
  downsampleByIndex,
  MAX_TELEMETRY_CHART_POINTS,
  resolveLocalCalendarDayWindow,
  resolveTelemetryWindow,
  type TelemetryHistoryRange,
} from "@/lib/bydmate/telemetry-ranges";
import { resolveChargingSessionSampleWindow } from "@/lib/bydmate/telemetry-session-window";
import type { BydmateDiplus, BydmateTelemetry, BydmateTelemetrySampleRow } from "@/types/database";

type HourlyRow = {
  hour_start: string;
  sample_count: number;
  soc_min: number | null;
  soc_max: number | null;
  soc_last: number | null;
  speed_max: number | null;
  power_avg: number | null;
  battery_temp_avg: number | null;
  cabin_temp_avg: number | null;
  outside_temp_avg: number | null;
  regen_kwh_sum: number | null;
  traction_kwh_sum: number | null;
};

const SUPABASE_PAGE_SIZE = 1000;
const TELEMETRY_SAMPLE_SELECT =
  "device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v";
/** Cap raw day fetches before client downsample (heavy charging days). */
export const MAX_DAY_RAW_SAMPLES = 5000;
/** Safety cap for trip detail fetches (~5.5 h at 1 Hz). */
export const MAX_TRIP_RAW_SAMPLES = 20_000;

export type TelemetryHistoryPoint = {
  device_time: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
  regen_kwh_sum?: number | null;
  traction_kwh_sum?: number | null;
  hourly?: {
    soc_min: number | null;
    soc_max: number | null;
  };
};

function hourlyToSample(row: HourlyRow): TelemetryHistoryPoint {
  return {
    device_time: row.hour_start,
    telemetry: {
      soc: row.soc_last,
      speed_kmh: row.speed_max,
      power_kw: row.power_avg,
      battery_temp_c: row.battery_temp_avg,
      cabin_temp_c: row.cabin_temp_avg,
      outside_temp_c: row.outside_temp_avg,
    },
    regen_kwh_sum: row.regen_kwh_sum,
    traction_kwh_sum: row.traction_kwh_sum,
    hourly: {
      soc_min: row.soc_min,
      soc_max: row.soc_max,
    },
  };
}

export async function fetchTelemetryHistory({
  supabase,
  userId,
  vehicleId,
  range,
  anchorDate,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  range: TelemetryHistoryRange;
  anchorDate: string;
}): Promise<TelemetryHistoryPoint[]> {
  const window = resolveTelemetryWindow(range, anchorDate);
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};

  if (range === "day") {
    const rows: TelemetryHistoryPoint[] = [];

    for (let fromIndex = 0; fromIndex < MAX_DAY_RAW_SAMPLES; fromIndex += SUPABASE_PAGE_SIZE) {
      const toIndex = Math.min(fromIndex + SUPABASE_PAGE_SIZE - 1, MAX_DAY_RAW_SAMPLES - 1);
      const { data, error } = await supabase
        .from("bydmate_telemetry_samples")
        .select(TELEMETRY_SAMPLE_SELECT)
        .eq("user_id", userId)
        .match(vehicleFilter)
        .gte("device_time", window.from)
        .lte("device_time", window.to)
        .order("device_time", { ascending: true })
        .range(fromIndex, toIndex);

      if (error) throw error;

      const page = (data ?? []) as TelemetryHistoryPoint[];
      rows.push(...page);

      if (page.length < SUPABASE_PAGE_SIZE || rows.length >= MAX_DAY_RAW_SAMPLES) {
        break;
      }
    }

    return downsampleByIndex(rows, MAX_TELEMETRY_CHART_POINTS);
  }

  const rawFrom =
    window.rawSampleDays > 0
      ? new Date(Date.parse(window.to) - window.rawSampleDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const hourlyTo = rawFrom ?? window.to;
  const { data: hourlyData, error: hourlyError } = await supabase
    .from("bydmate_telemetry_hourly")
    .select(
      "hour_start, sample_count, soc_min, soc_max, soc_last, speed_max, power_avg, battery_temp_avg, cabin_temp_avg, outside_temp_avg, regen_kwh_sum, traction_kwh_sum",
    )
    .eq("user_id", userId)
    .match(vehicleFilter)
    .gte("hour_start", window.from)
    .lte("hour_start", hourlyTo)
    .order("hour_start", { ascending: true });

  if (hourlyError) throw hourlyError;

  const hourlyPoints = ((hourlyData ?? []) as HourlyRow[]).map(hourlyToSample);

  if (!rawFrom) {
    return downsampleByIndex(hourlyPoints, MAX_TELEMETRY_CHART_POINTS);
  }

  const rawPoints = await fetchTelemetrySamplePages({
    supabase,
    userId,
    vehicleId,
    from: rawFrom,
    to: window.to,
  });

  const merged = [...hourlyPoints, ...rawPoints].sort(
    (a, b) => Date.parse(a.device_time) - Date.parse(b.device_time),
  );

  return downsampleByIndex(merged, MAX_TELEMETRY_CHART_POINTS);
}

export async function fetchTripSamples({
  supabase,
  userId,
  tripId,
}: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
}): Promise<TelemetryHistoryPoint[]> {
  const { data: trip, error: tripError } = await supabase
    .from("bydmate_trips")
    .select("id, user_id, vehicle_id, started_at, ended_at, last_device_time")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (tripError) throw tripError;
  if (!trip) return [];

  const endAt = trip.ended_at ?? trip.last_device_time;

  return fetchTelemetrySamplePages({
    supabase,
    userId,
    vehicleId: trip.vehicle_id,
    from: trip.started_at,
    to: endAt,
    maxRows: MAX_TRIP_RAW_SAMPLES,
  });
}

async function fetchTelemetrySamplePages({
  supabase,
  userId,
  vehicleId,
  from,
  to,
  maxRows,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  from: string;
  to: string;
  maxRows?: number;
}): Promise<TelemetryHistoryPoint[]> {
  const rows: TelemetryHistoryPoint[] = [];
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};

  for (let fromIndex = 0; ; fromIndex += SUPABASE_PAGE_SIZE) {
    const toIndex = fromIndex + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("bydmate_telemetry_samples")
      .select(TELEMETRY_SAMPLE_SELECT)
      .eq("user_id", userId)
      .match(vehicleFilter)
      .gte("device_time", from)
      .lte("device_time", to)
      .order("device_time", { ascending: true })
      .range(fromIndex, toIndex);

    if (error) throw error;

    const page = (data ?? []) as TelemetryHistoryPoint[];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) {
      break;
    }

    if (maxRows != null && rows.length >= maxRows) {
      return rows.slice(0, maxRows);
    }
  }

  return maxRows != null ? rows.slice(0, maxRows) : rows;
}

function isChargingSample(point: TelemetryHistoryPoint) {
  const telemetry = point.telemetry;
  const chargePower = telemetry.charge_power_kw ?? telemetry.power_kw;
  return telemetry.is_charging === true || (typeof chargePower === "number" && chargePower > 0);
}

async function fetchChargingTelemetrySamplePages({
  supabase,
  userId,
  vehicleId,
  from,
  to,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  from: string;
  to: string;
}) {
  return fetchTelemetrySamplePages({
    supabase,
    userId,
    vehicleId,
    from,
    to,
  });
}

export async function fetchChargingSessionSamples({
  supabase,
  userId,
  sessionId,
  vehicleId,
}: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  vehicleId: string | null;
}): Promise<TelemetryHistoryPoint[]> {
  const { data: session, error: sessionError } = await supabase
    .from("charging_sessions")
    .select("id, user_id, status, started_at, stopped_at, updated_at, created_at, current_percent, target_percent")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError) throw sessionError;
  if (!session?.started_at) return [];

  const window = resolveChargingSessionSampleWindow({
    status: session.status,
    startedAt: session.started_at,
    stoppedAt: session.stopped_at,
    updatedAt: session.updated_at,
    currentPercent: session.current_percent,
    targetPercent: session.target_percent,
  });

  const data = await fetchChargingTelemetrySamplePages({
    supabase,
    userId,
    vehicleId,
    from: window.from,
    to: window.to,
  });

  const chargingPoints = data.filter(isChargingSample);
  return downsampleByIndex(chargingPoints, MAX_TELEMETRY_CHART_POINTS);
}

const SOH_DAILY_PROBE_LIMIT = 20;
const SOH_FETCH_CONCURRENCY = 25;

export function parseSohPercent(telemetry: BydmateTelemetry): number | null {
  const raw = telemetry.soh_percent;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 100) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      return parsed;
    }
  }
  return null;
}

export function enumerateCalendarDays(fromIso: string, toIso: string): string[] {
  const days: string[] = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (cursor <= endDay) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return days;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]!, index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

async function fetchSohSampleForDay({
  supabase,
  userId,
  vehicleId,
  day,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  day: string;
}): Promise<TelemetryHistoryPoint | null> {
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};
  const dayWindow = resolveLocalCalendarDayWindow(day);

  const { data, error } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry")
    .eq("user_id", userId)
    .match(vehicleFilter)
    .gte("device_time", dayWindow.from)
    .lte("device_time", dayWindow.to)
    .order("device_time", { ascending: false })
    .limit(SOH_DAILY_PROBE_LIMIT);

  if (error) throw error;

  for (const row of (data ?? []) as BydmateTelemetrySampleRow[]) {
    const soh = parseSohPercent(row.telemetry);
    if (soh != null) {
      return {
        device_time: row.device_time,
        telemetry: { soh_percent: soh },
      };
    }
  }

  return null;
}

/** Year-range SOH chart: hourly rollups omit soh_percent, so probe one raw sample per day. */
export async function fetchSohTelemetryHistory({
  supabase,
  userId,
  vehicleId,
  anchorDate,
}: {
  supabase: SupabaseClient;
  userId: string;
  vehicleId: string | null;
  anchorDate: string;
}): Promise<TelemetryHistoryPoint[]> {
  const window = resolveTelemetryWindow("year", anchorDate);
  const days = enumerateCalendarDays(window.from, window.to);

  const points = await mapWithConcurrency(days, SOH_FETCH_CONCURRENCY, (day) =>
    fetchSohSampleForDay({ supabase, userId, vehicleId, day }),
  );

  return points.filter((point): point is TelemetryHistoryPoint => point != null);
}
