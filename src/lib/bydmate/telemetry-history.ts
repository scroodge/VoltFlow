import type { SupabaseClient } from "@supabase/supabase-js";

import {
  downsampleByIndex,
  MAX_TELEMETRY_CHART_POINTS,
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
/** Cap raw day fetches before client downsample (heavy charging days). */
export const MAX_DAY_RAW_SAMPLES = 5000;

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
        .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
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

  const { data: rawData, error: rawError } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("user_id", userId)
    .match(vehicleFilter)
    .gte("device_time", rawFrom)
    .lte("device_time", window.to)
    .order("device_time", { ascending: true });

  if (rawError) throw rawError;

  const rawPoints = (rawData ?? []) as TelemetryHistoryPoint[];
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

  const { data, error } = await supabase
    .from("bydmate_telemetry_samples")
    .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
    .eq("user_id", userId)
    .eq("vehicle_id", trip.vehicle_id)
    .gte("device_time", trip.started_at)
    .lte("device_time", endAt)
    .order("device_time", { ascending: true });

  if (error) throw error;
  return downsampleByIndex((data ?? []) as TelemetryHistoryPoint[], MAX_TELEMETRY_CHART_POINTS);
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
  vehicleId: string;
  from: string;
  to: string;
}) {
  const rows: TelemetryHistoryPoint[] = [];

  for (let fromIndex = 0; ; fromIndex += SUPABASE_PAGE_SIZE) {
    const toIndex = fromIndex + SUPABASE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("bydmate_telemetry_samples")
      .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
      .eq("user_id", userId)
      .eq("vehicle_id", vehicleId)
      .gte("device_time", from)
      .lte("device_time", to)
      .order("device_time", { ascending: true })
      .range(fromIndex, toIndex);

    if (error) throw error;

    const page = (data ?? []) as TelemetryHistoryPoint[];
    rows.push(...page);

    if (page.length < SUPABASE_PAGE_SIZE) {
      return rows;
    }
  }
}

export async function fetchChargingSessionSamples({
  supabase,
  userId,
  sessionId,
  vehicleId = "way",
}: {
  supabase: SupabaseClient;
  userId: string;
  sessionId: string;
  vehicleId?: string;
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
