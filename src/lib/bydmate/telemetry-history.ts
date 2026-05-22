import type { SupabaseClient } from "@supabase/supabase-js";

import {
  downsampleByIndex,
  MAX_TELEMETRY_CHART_POINTS,
  resolveTelemetryWindow,
  type TelemetryHistoryRange,
} from "@/lib/bydmate/telemetry-ranges";
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
};

export type TelemetryHistoryPoint = {
  device_time: string;
  telemetry: BydmateTelemetry;
  diplus?: BydmateDiplus;
  diplus_min_cell_voltage_v?: number | null;
  diplus_max_cell_voltage_v?: number | null;
  diplus_cell_delta_v?: number | null;
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
    const { data, error } = await supabase
      .from("bydmate_telemetry_samples")
      .select("device_time, telemetry, diplus, diplus_min_cell_voltage_v, diplus_max_cell_voltage_v, diplus_cell_delta_v")
      .eq("user_id", userId)
      .match(vehicleFilter)
      .gte("device_time", window.from)
      .lte("device_time", window.to)
      .order("device_time", { ascending: true });

    if (error) throw error;
    const points = (data ?? []) as Pick<BydmateTelemetrySampleRow, "device_time" | "telemetry">[];
    return downsampleByIndex(points, MAX_TELEMETRY_CHART_POINTS);
  }

  const rawFrom =
    window.rawSampleDays > 0
      ? new Date(Date.parse(window.to) - window.rawSampleDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const hourlyTo = rawFrom ?? window.to;
  const { data: hourlyData, error: hourlyError } = await supabase
    .from("bydmate_telemetry_hourly")
    .select(
      "hour_start, sample_count, soc_min, soc_max, soc_last, speed_max, power_avg, battery_temp_avg, cabin_temp_avg, outside_temp_avg",
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
