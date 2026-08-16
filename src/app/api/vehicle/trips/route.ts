import { NextRequest, NextResponse } from "next/server";

import { attachTripEnergy } from "@/lib/voltflowmate/attach-trip-energy";
import { devVehicleId, resolveVehicleApiAccess } from "@/lib/dev/dev-api-auth";
import type { VoltflowMateTripRow } from "@/types/database";

export async function GET(request: NextRequest) {
  const access = await resolveVehicleApiAccess(request);
  if (!access) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const date = params.get("date");
  const month = params.get("month");
  let vehicleId = params.get("vehicle_id")?.trim() || null;
  if (!vehicleId && access.devMode) {
    vehicleId = devVehicleId(request);
  }
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 1) || 1, 1), 100);
  const lite = params.get("lite") === "1";

  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [yearText, monthText] = month.split("-");
    const year = Number(yearText);
    const monthIndex = Number(monthText);
    const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
    const monthStart = `${month}-01T00:00:00.000Z`;
    const monthEnd = `${month}-${String(lastDay).padStart(2, "0")}T23:59:59.999Z`;

    let monthQuery = access.supabase
      .from("bydmate_trips")
      .select("started_at")
      .eq("user_id", access.userId)
      .gte("started_at", monthStart)
      .lte("started_at", monthEnd);

    if (vehicleId) {
      monthQuery = monthQuery.eq("vehicle_id", vehicleId);
    }

    const { data, error } = await monthQuery;
    if (error) {
      return NextResponse.json({ error: "Failed to load trip dates" }, { status: 500 });
    }

    const startedAt = ((data ?? []) as { started_at: string }[]).map((row) => row.started_at);

    return NextResponse.json({ month, startedAt });
  }

  if (!date) {
    const queryLimit = Math.min(limit * 2, 200);
    let latestQuery = access.supabase
      .from("bydmate_trips")
      .select("*")
      .eq("user_id", access.userId)
      .order("started_at", { ascending: false })
      .limit(queryLimit);

    if (vehicleId) {
      latestQuery = latestQuery.eq("vehicle_id", vehicleId);
    }

    const { data, error } = await latestQuery;
    if (error) {
      return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
    }

    const rawTrips = (data ?? []) as VoltflowMateTripRow[];
    const trips = lite
      ? rawTrips.slice(0, limit)
      : await attachTripEnergy({
          supabase: access.supabase,
          userId: access.userId,
          trips: rawTrips,
          vehicleId: vehicleId ?? undefined,
        }).then((rows) => rows.slice(0, limit));

    return NextResponse.json({ trips });
  }

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const dayStart = `${date}T00:00:00.000Z`;
  const dayEnd = `${date}T23:59:59.999Z`;

  let query = access.supabase
    .from("bydmate_trips")
    .select("*")
    .eq("user_id", access.userId)
    .lte("started_at", dayEnd)
    .or(`ended_at.is.null,ended_at.gte.${dayStart}`)
    .order("started_at", { ascending: false });

  if (vehicleId) {
    query = query.eq("vehicle_id", vehicleId);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to load trips" }, { status: 500 });
  }

  const trips = await attachTripEnergy({
    supabase: access.supabase,
    userId: access.userId,
    trips: (data ?? []) as VoltflowMateTripRow[],
    vehicleId: vehicleId ?? undefined,
  });

  return NextResponse.json({ date, trips });
}
