import { NextRequest, NextResponse } from "next/server";

import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";

const MAX_EXPORT_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_EXPORT_ROWS = 10_000;

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

  const params = request.nextUrl.searchParams;
  const format = params.get("format") === "json" ? "json" : "csv";
  const from = params.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString();
  const to = params.get("to") ?? new Date().toISOString();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs < fromMs) {
    return NextResponse.json({ error: "Invalid export date range" }, { status: 400 });
  }
  if (toMs - fromMs > MAX_EXPORT_RANGE_MS) {
    return NextResponse.json({ error: "Export range is limited to 366 days" }, { status: 413 });
  }
  const vehicleId = params.get("vehicle_id")?.trim() || devVehicleId(request);
  const vehicleFilter = vehicleId ? { vehicle_id: vehicleId } : {};

  const [{ data: sessions }, { data: trips }, { data: samples }] = await Promise.all([
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
      .from("bydmate_telemetry_samples")
      .select("device_time, vehicle_id, telemetry, location")
      .eq("user_id", access.userId)
      .match(vehicleFilter)
      .gte("device_time", from)
      .lte("device_time", to)
      .order("device_time", { ascending: true })
      .limit(MAX_EXPORT_ROWS),
  ]);

  const truncated = (sessions?.length ?? 0) >= MAX_EXPORT_ROWS ||
    (trips?.length ?? 0) >= MAX_EXPORT_ROWS ||
    (samples?.length ?? 0) >= MAX_EXPORT_ROWS;
  const payload = {
    exported_at: new Date().toISOString(),
    from,
    to,
    vehicle_id: vehicleId,
    charging_sessions: sessions ?? [],
    trips: trips ?? [],
    telemetry_samples: samples ?? [],
    truncated,
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
  for (const sample of samples ?? []) {
    lines.push(
      [
        "sample",
        "",
        csvEscape(sample.device_time),
        "",
        csvEscape(sample.vehicle_id),
        "soc",
        csvEscape((sample.telemetry as { soc?: number })?.soc),
      ].join(","),
    );
  }
  if (truncated) lines.push("meta,,,,,truncated,true");

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="voltflow-export-${from.slice(0, 10)}.csv"`,
    },
  });
}
