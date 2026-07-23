import type { SupabaseClient } from "@supabase/supabase-js";

import {
  downsampleByIndex,
  MAX_TELEMETRY_CHART_POINTS,
  resolveLocalCalendarDayWindow,
  resolveTelemetryWindow,
  type TelemetryHistoryRange,
} from "./telemetry-ranges.ts";
import { isTelemetryHistoryCharging } from "./telemetry-charging.ts";
import { resolveChargingSessionSampleWindow } from "./telemetry-session-window.ts";
import { mapSohDailyRows, normalizeSohPercent } from "./soh-history-mapping.ts";
import { mapWithConcurrency } from "../async/map-with-concurrency.ts";
import type { BydmateDiplus, BydmateTelemetry, BydmateTelemetrySampleRow } from "../../types/database.ts";

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
// Raw `diplus` blob was dropped from bydmate_telemetry_samples to reclaim disk
// (it duplicated the flat diplus_* columns). Cell-voltage/SOC readers already
// prefer the flat columns; the live snapshot table keeps its own diplus blob.
const TELEMETRY_SAMPLE_SELECT =
  "device_time, telemetry, diplus_charge_gun_state, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v";
/** Cap raw day fetches before client downsample (heavy charging days). */
export const MAX_DAY_RAW_SAMPLES = 5000;
/** Safety cap for trip detail fetches (~5.5 h at 1 Hz). */
export const MAX_TRIP_RAW_SAMPLES = 20_000;

export type TelemetryHistoryPoint = {
  device_time: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_charge_gun_state?: string | number | null;
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

type TelemetryHistorySamplePoint = TelemetryHistoryPoint & {
  diplus_charge_gun_state?: string | number | null;
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
    const rows: TelemetryHistorySamplePoint[] = [];

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

      const page = (data ?? []) as TelemetryHistorySamplePoint[];
      rows.push(...page);

      if (page.length < SUPABASE_PAGE_SIZE || rows.length >= MAX_DAY_RAW_SAMPLES) {
        break;
      }
    }

    return downsampleByIndex(rows, MAX_TELEMETRY_CHART_POINTS).map(stripChargingContext);
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

  const rawPoints = (
    await fetchTelemetrySamplePages({
      supabase,
      userId,
      vehicleId,
      from: rawFrom,
      to: window.to,
    })
  ).map(stripChargingContext);

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

  const points = await fetchTelemetrySamplePages({
    supabase,
    userId,
    vehicleId: trip.vehicle_id,
    from: trip.started_at,
    to: endAt,
    maxRows: MAX_TRIP_RAW_SAMPLES,
  });
  return points.map(stripChargingContext);
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
}): Promise<TelemetryHistorySamplePoint[]> {
  const rows: TelemetryHistorySamplePoint[] = [];
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

    const page = (data ?? []) as TelemetryHistorySamplePoint[];
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

function stripChargingContext({
  diplus_charge_gun_state: _diplusChargeGunState,
  ...point
}: TelemetryHistorySamplePoint): TelemetryHistoryPoint {
  return point;
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

  const chargingPoints = data.filter((point) =>
    isTelemetryHistoryCharging(point.telemetry, point),
  );
  return downsampleByIndex(chargingPoints, MAX_TELEMETRY_CHART_POINTS).map(stripChargingContext);
}

const SOH_DAILY_PROBE_LIMIT = 20;
const SOH_FETCH_CONCURRENCY = 25;

export function parseSohPercent(telemetry: BydmateTelemetry): number | null {
  return normalizeSohPercent(telemetry.soh_percent);
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

async function fetchSohTelemetryHistoryFallback({
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

/** Year-range SOH chart: one latest raw SOH point per UTC day, aggregated in Postgres. */
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
  const { data, error } = await supabase.rpc("bydmate_soh_daily", {
    p_user_id: userId,
    p_vehicle_id: vehicleId,
    p_from: window.from,
    p_to: window.to,
  });

  // The direct fallback keeps a web deployment usable until its matching migration
  // is applied. It is intentionally temporary: the RPC removes the 366-query fan-out.
  // Do not turn transient database/network failures into a 366-query amplification.
  if (error && isMissingSohRpc(error)) {
    return fetchSohTelemetryHistoryFallback({ supabase, userId, vehicleId, anchorDate });
  }
  if (error) throw error;

  return mapSohDailyRows(
    (data ?? []) as { device_time: string; soh_percent: number | string | null }[],
  );
}

function isMissingSohRpc(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    (message.includes("bydmate_soh_daily") && message.includes("does not exist"))
  );
}
