import { NextRequest, NextResponse } from "next/server";

import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import { resolveUserEffectivePremium } from "@/lib/premium-entitlement-server";
import { collectPagedRows } from "@/lib/voltflowmate/paged-query";
import { downsampleByIndex } from "@/lib/voltflowmate/telemetry-ranges";

const MAX_EXPORT_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_EXPORT_ROWS = 10_000;
// Charging-session and trip summary rows are not purged by the retention jobs the way
// raw telemetry/route-track points are (see docs/PREMIUM_ADMIN.md) -- unlike those, this
// route had no free/premium distinction of its own, so a free user could already export
// full multi-year session/trip history via ?from=. Clamp explicitly to match the free
// retention window instead of relying on data having been purged.
const FREE_EXPORT_RANGE_MS = 30 * 24 * 60 * 60 * 1000;
const RAW_EXPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
// ~1 MB of JSON; a busy car writes ~12 000 raw rows a day.
const MAX_RAW_EXPORT_SAMPLES = 2_000;
const RAW_EXPORT_SCAN_LIMIT = 20_000;
const HOURLY_EXPORT_SELECT =
  "hour_start, vehicle_id, sample_count, soc_min, soc_max, soc_last, speed_max, power_avg, battery_temp_avg, cabin_temp_avg, outside_temp_avg, regen_kwh_sum, traction_kwh_sum";

type ExportSample = {
  device_time: string;
  vehicle_id: string;
  telemetry: { soc?: number | null } | null;
};

function csvEscape(value: unknown) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isPremium = await resolveUserEffectivePremium(
    access.supabase,
    access.userId,
  );

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "json" ? "json" : "csv";
  const requestedFrom =
    params.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const to = params.get("to") ?? new Date().toISOString();
  let fromMs = Date.parse(requestedFrom);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return NextResponse.json(
      { error: "Invalid export date range" },
      { status: 400 },
    );
  }
  if (toMs - fromMs > MAX_EXPORT_RANGE_MS) {
    return NextResponse.json(
      { error: "Export range is limited to 366 days" },
      { status: 413 },
    );
  }
  const freeCutoffMs = toMs - FREE_EXPORT_RANGE_MS;
  const planLimited = !isPremium && fromMs < freeCutoffMs;
  if (planLimited) fromMs = freeCutoffMs;
  const from = new Date(fromMs).toISOString();
  const vehicleId = params.get("vehicle_id")?.trim() || devVehicleId(request);
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};

  // Raw samples only for the newest 24 h, spread over that window: 10 000 raw rows were
  // 4.68 MB of JSON (over Vercel's 4.5 MB response limit) and covered only ~8 h of a
  // 1 Hz car. The whole range ships as hourly rollups, which outlive the raw purge.
  const rawFrom = new Date(
    Math.max(fromMs, toMs - RAW_EXPORT_WINDOW_MS),
  ).toISOString();
  let rawRows: ExportSample[];
  try {
    rawRows = await collectPagedRows<ExportSample>({
      limit: RAW_EXPORT_SCAN_LIMIT,
      fetchPage: async (pageFrom, pageTo) => {
        const { data, error } = await access.supabase
          .from("bydmate_telemetry_samples")
          .select("device_time, vehicle_id, telemetry")
          .eq("user_id", access.userId)
          .match(vehicleFilter)
          .gte("device_time", rawFrom)
          .lte("device_time", to)
          .order("device_time", { ascending: true })
          .range(pageFrom, pageTo);
        if (error) throw error;
        return (data ?? []) as ExportSample[];
      },
    });
  } catch (error) {
    console.error("[vehicle-export] raw sample query failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
  const samples = downsampleByIndex(rawRows, MAX_RAW_EXPORT_SAMPLES);

  const [
    { data: sessions, error: sessionsError },
    { data: trips, error: tripsError },
    { data: hourly, error: hourlyError },
  ] = await Promise.all([
    access.supabase
      .from("charging_sessions")
      .select("*")
      .eq("user_id", access.userId)
      .gte("started_at", from)
      .lte("started_at", to)
      .limit(MAX_EXPORT_ROWS),
    access.supabase
      .from("bydmate_trips")
      .select("*")
      .eq("user_id", access.userId)
      .match(vehicleFilter)
      .gte("started_at", from)
      .lte("started_at", to)
      .limit(MAX_EXPORT_ROWS),
    access.supabase
      .from("bydmate_telemetry_hourly")
      .select(HOURLY_EXPORT_SELECT)
      .eq("user_id", access.userId)
      .match(vehicleFilter)
      .gte("hour_start", from)
      .lte("hour_start", to)
      .order("hour_start", { ascending: true })
      .limit(MAX_EXPORT_ROWS),
  ]);

  // A failed section must fail the export: shipping it as an empty list hid a select of a
  // non-existent column (`location`) and every export carried zero telemetry samples.
  const queryError = sessionsError ?? tripsError ?? hourlyError;
  if (queryError) {
    console.error("[vehicle-export] query failed", queryError);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }

  const truncated =
    (sessions?.length ?? 0) >= MAX_EXPORT_ROWS ||
    (trips?.length ?? 0) >= MAX_EXPORT_ROWS ||
    (hourly?.length ?? 0) >= MAX_EXPORT_ROWS ||
    rawRows.length >= RAW_EXPORT_SCAN_LIMIT;
  const payload = {
    exported_at: new Date().toISOString(),
    from,
    to,
    vehicle_id: vehicleId,
    charging_sessions: sessions ?? [],
    trips: trips ?? [],
    telemetry_hourly: hourly ?? [],
    telemetry_samples_from: rawFrom,
    telemetry_samples: samples,
    truncated,
    plan_limited: planLimited,
  };

  if (format === "json") {
    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="voltflow-export-${from.slice(0, 10)}.json"`,
      },
    });
  }

  const lines: string[] = [];
  lines.push("section,id,started_at,ended_at,vehicle_id,metric,value");
  for (const session of sessions ?? []) {
    lines.push(
      [
        "session",
        csvEscape(session.id),
        csvEscape(session.started_at),
        csvEscape(session.stopped_at),
        csvEscape(session.car_id),
        "charged_kwh",
        csvEscape(session.charged_energy_kwh),
      ].join(","),
    );
  }
  for (const trip of trips ?? []) {
    lines.push(
      [
        "trip",
        csvEscape(trip.id),
        csvEscape(trip.started_at),
        csvEscape(trip.ended_at),
        csvEscape(trip.vehicle_id),
        "distance_km",
        csvEscape(trip.distance_km),
      ].join(","),
    );
  }
  for (const hour of hourly ?? []) {
    lines.push(
      [
        "hour",
        "",
        csvEscape(hour.hour_start),
        "",
        csvEscape(hour.vehicle_id),
        "soc_last",
        csvEscape(hour.soc_last),
      ].join(","),
    );
  }
  for (const sample of samples) {
    lines.push(
      [
        "sample",
        "",
        csvEscape(sample.device_time),
        "",
        csvEscape(sample.vehicle_id),
        "soc",
        csvEscape(sample.telemetry?.soc),
      ].join(","),
    );
  }
  if (truncated) lines.push("meta,,,,,truncated,true");
  if (planLimited) lines.push("meta,,,,,plan_limited,true");

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="voltflow-export-${from.slice(0, 10)}.csv"`,
    },
  });
}
